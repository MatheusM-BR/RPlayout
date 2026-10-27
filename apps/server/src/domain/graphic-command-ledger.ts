import {randomUUID} from 'node:crypto'
import {and,desc,eq,sql} from 'drizzle-orm'
import type {Db} from '../db/client.js'
import {operatorDecisions,healthEvents} from '../db/schema.js'
import {installationVault} from './secret-vault.js'
import {CollaborativeEditError} from './collaborative-edit.js'
import {EngineCommandRejected} from './engine.js'
import {isRecoveryRehearsal} from './recovery-rehearsal.js'
import {executionHostIdentity} from './execution-host.js'
import {SecondaryEventLedger} from './secondary-event-ledger.js'
import {graphicCapture,graphicDisplaySchema,type GraphicDisplaySnapshot} from './graphic-composition.js'
import {readExecutionOwner} from '../db/execution-ownership.js'
import type {GraphicRecoveryContext} from './graphic-recovery-incident.js'

type Phase='ACCEPTED'|'SENDING'|'CONFIRMED'|'SIMULATED'|'REJECTED'|'UNCERTAIN'|'REVIEWED'
export interface GraphicCommandReceipt {id:string;state:Phase;replayed:boolean;physicalOutputValidated:false}
const phases:Phase[]=['REVIEWED','CONFIRMED','SIMULATED','REJECTED','UNCERTAIN','SENDING','ACCEPTED']
const inFlight=new Set<string>()
const processBoot=randomUUID()
const rejected=(status:number,error:string,command?:GraphicCommandReceipt):never=>{throw new CollaborativeEditError(status,{error,...(command?{graphicCommand:command}:{})})}
export class GraphicCommandLedger {
  constructor(private readonly db:Db,private readonly channelId:string){}
  private row(id:string,phase:Phase){return this.db.select().from(operatorDecisions).where(and(eq(operatorDecisions.id,id+':'+phase),eq(operatorDecisions.rundownId,'@graphics:'+this.channelId),eq(operatorDecisions.kind,'GRAPHIC_COMMAND_'+phase))).get()}
  private unresolved(){
    return this.db.$client.prepare('SELECT id FROM graphic_command_pending WHERE scope=? LIMIT 1').get('@graphics:'+this.channelId) as {id:string}|undefined
  }
  /** Live-tick gate (several calls per tick at 20 Hz). One round trip covers
   * the pending command and the quiet secondary case; any HA journal or
   * FIRING row falls through to SecondaryEventLedger's full decision. */
  hasUnresolved():boolean{
    const gate=this.db.$client.prepare("SELECT EXISTS(SELECT 1 FROM graphic_command_pending WHERE scope=?) AS pending,EXISTS(SELECT 1 FROM operator_decisions WHERE rundown_id='@ha' AND kind LIKE 'HA_SECONDARY_%') AS ha,EXISTS(SELECT 1 FROM secondary_event_runs WHERE channel_id=? AND state='FIRING') AS firing").get('@graphics:'+this.channelId,this.channelId) as {pending:number;ha:number;firing:number}
    if(gate.pending)return true
    if(!gate.ha&&!gate.firing)return false
    return new SecondaryEventLedger(this.db,this.channelId).hasUnconfirmed()
  }
  latestNativeCompositionId():string|null {
    const row=this.db.$client.prepare("SELECT id FROM operator_decisions INDEXED BY graphic_command_composition_order WHERE rundown_id=? AND kind='GRAPHIC_COMMAND_CONFIRMED' ORDER BY rowid DESC LIMIT 1").get('@graphics:'+this.channelId) as {id:string}|undefined
    return row?row.id.slice(0,-10):null
  }
  confirmedContext(id:string):GraphicRecoveryContext|null {
    const terminal=this.row(id,'CONFIRMED'),context=terminal?.payload.executionContext as GraphicRecoveryContext|undefined
    if(!context||typeof context.executionId!=='string'||!context.executionId||typeof context.itemId!=='string'||!context.itemId||!(context.revisionId===null||typeof context.revisionId==='string'))return null
    if(context.startedAt!==undefined&&(!Number.isSafeInteger(context.startedAt)||context.startedAt<0))return null
    return structuredClone(context)
  }
  confirmedCueIds(executionId:string,itemId:string,revisionId:string|null):Set<string>{
    // Payloads are encrypted by the schema codec. Never use SQL JSON extraction
    // or introduce a plaintext duplicate to query operator selections.
    const rows=this.db.select().from(operatorDecisions).where(and(eq(operatorDecisions.rundownId,'@graphics:'+this.channelId),eq(operatorDecisions.kind,'GRAPHIC_COMMAND_ACCEPTED'))).all()
    const ids=new Set<string>()
    for(const row of rows){
      const selection=row.payload.selection as {action?:string;executionId?:string;itemId?:string;revisionId?:string|null;cue?:{id?:unknown}}|undefined
      if(row.payload.native===true&&selection?.action==='LEGACY_CUE'&&selection.executionId===executionId&&selection.itemId===itemId&&selection.revisionId===revisionId&&typeof selection.cue?.id==='string'&&this.row(row.id.slice(0,-9),'CONFIRMED'))ids.add(selection.cue.id)
    }
    return ids
  }
  confirmedDisplay(id:string):GraphicDisplaySnapshot {
    const pending=this.unresolved(),acceptedPending=pending?this.row(pending.id.slice(0,-9),'ACCEPTED'):null
    const selection=acceptedPending?.payload.selection as {action?:string;sourceReceipt?:string}|undefined
    const ownRestore=pending&&inFlight.has(pending.id.slice(0,-9))&&selection?.action==='COMPOSITION_RESTORE'&&selection.sourceReceipt===id
    if((pending&&!ownRestore)||new SecondaryEventLedger(this.db,this.channelId).hasUnconfirmed())throw new Error('Grafismo inconclusivo; composição anterior não será restaurada.')
    if(this.latestNativeCompositionId()!==id)throw new Error('Composição mudou após o checkpoint; nenhuma imagem histórica será reenviada.')
    const accepted=this.row(id,'ACCEPTED'),terminal=this.row(id,'CONFIRMED')
    if(!accepted||accepted.payload.native!==true||!terminal)throw new Error('Composição sem recibo nativo confirmado deste canal.')
    // REVIEWED acknowledges an incident, not the physical result of its send.
    // Only a later explicitly confirmed composition can establish a new head.
    // Use insertion order, not clock timestamps; retain encrypted payload codec.
    const newer=this.db.select().from(operatorDecisions).where(and(eq(operatorDecisions.rundownId,'@graphics:'+this.channelId),eq(operatorDecisions.kind,'GRAPHIC_COMMAND_ACCEPTED'),sql`rowid > (SELECT rowid FROM operator_decisions WHERE id=${id+':CONFIRMED'} AND rundown_id=${'@graphics:'+this.channelId} AND kind='GRAPHIC_COMMAND_CONFIRMED')`)).all()
    for(const row of newer)if(row.payload.native===true&&this.row(row.id.slice(0,-9),'REVIEWED'))throw new Error('Incidente reconhecido não confirma o destino; composição antiga não será restaurada. Faça uma intervenção explícita e confirme o novo resultado.')
    return graphicDisplaySchema.parse(terminal.payload.composition)
  }
  read(id:string):GraphicCommandReceipt|null{
    const accepted=this.row(id,'ACCEPTED');if(!accepted||accepted.rundownId!=='@graphics:'+this.channelId)return null
    const state=phases.find(phase=>this.row(id,phase))!
    return {id,state,replayed:true,physicalOutputValidated:false}
  }
  private append(id:string,phase:Phase,actor:string|null,payload:Record<string,unknown>={}){
    this.db.insert(operatorDecisions).values({id:id+':'+phase,rundownId:'@graphics:'+this.channelId,kind:'GRAPHIC_COMMAND_'+phase,actorUsername:actor,createdAt:new Date().toISOString(),payload:{channelId:this.channelId,...payload}}).run()
  }
  reviewToken(receipt:GraphicCommandReceipt){return installationVault(false).reviewIdentity(JSON.stringify([this.channelId,receipt.id,receipt.state]),'graphic-command-review:v1')}
  list(){return this.db.select().from(operatorDecisions).where(and(eq(operatorDecisions.rundownId,'@graphics:'+this.channelId),eq(operatorDecisions.kind,'GRAPHIC_COMMAND_ACCEPTED'))).orderBy(desc(operatorDecisions.createdAt)).limit(50).all().map(row=>{const receipt=this.read(row.id.slice(0,-9))!;return {...receipt,createdAt:row.createdAt,actor:row.actorUsername,reviewToken:this.reviewToken(receipt)}})}
  review(id:string,token:string,note:string,actor:string|null,authorize:()=>void){
    return this.db.transaction(()=>{
      authorize();if(isRecoveryRehearsal(this.db.$client))rejected(409,'Conferência bloqueada na quarentena.')
      const current=this.read(id)
      if(!current)rejected(404,'Comando não pertence a este canal.')
      if(!['ACCEPTED','SENDING','UNCERTAIN'].includes(current!.state)||inFlight.has(id)||this.reviewToken(current!)!==token)rejected(409,'Comando mudou ou ainda está sendo executado; atualize a conferência.')
      if(current!.state!=='UNCERTAIN'){
        const owner=this.row(id,'ACCEPTED')!.payload
        const sameProcess=owner.processBoot===processBoot&&owner.processId===process.pid&&owner.host===executionHostIdentity()
        let gone=false
        if(owner.host===executionHostIdentity()&&Number.isSafeInteger(owner.processId)&&Number(owner.processId)>0)try{process.kill(Number(owner.processId),0)}catch(error){gone=(error as NodeJS.ErrnoException).code==='ESRCH'}
        if(!sameProcess&&!gone)rejected(409,'Dono do comando local ainda existe, é remoto ou não teve parada comprovada; conferência recusada.')
      }
      this.append(id,'REVIEWED',actor,{previousState:current!.state,note,signalRecovered:false,physicalOutputValidated:false})
      return this.read(id)!
    },{behavior:'immediate'})
  }
  async execute<T>(input:{key:unknown;actorId:string|null;actorName:string|null;selection:object;native:boolean;secondaryRunId?:string;context?:()=>GraphicRecoveryContext|null},authorize:()=>void,work:(beforeSend:()=>void)=>Promise<T>):Promise<{receipt:GraphicCommandReceipt;result?:T}>{
    if(input.key!==undefined&&(typeof input.key!=='string'||!/^[a-zA-Z0-9_-]{8,128}$/.test(input.key)))rejected(400,'Chave do comando inválida.')
    const vault=installationVault(false),id='graphic-command:'+vault.reviewIdentity(JSON.stringify([this.channelId,input.actorId,input.key??randomUUID()]),'graphic-command-key:v1')
    const fingerprint=vault.reviewIdentity(JSON.stringify(input.selection),'graphic-command-selection:v1')
    const acceptedContext=input.context?.()??null
    const replay=this.db.transaction(()=>{
      authorize();if(isRecoveryRehearsal(this.db.$client))rejected(409,'Comandos bloqueados na quarentena de restauração.')
      const existing=this.row(id,'ACCEPTED')
      if(existing){
        if(existing.payload.fingerprint!==fingerprint)rejected(409,'A chave já pertence a outro comando; nada foi reenviado.')
        return this.read(id)!
      }
      const unresolved=this.unresolved()
      if(unresolved)rejected(409,'Há comando gráfico sem resultado confirmado. Consulte o histórico; nenhum novo comando foi enviado.',this.read(unresolved.id.slice(0,-9))!)
      if(new SecondaryEventLedger(this.db,this.channelId).hasUnconfirmed())rejected(409,'Há evento secundário sem confirmação durável neste canal. Confira a automação e o destino; nenhum novo comando gráfico foi enviado.')
      if(input.secondaryRunId)new SecondaryEventLedger(this.db,this.channelId).assertActiveGraphicBinding(input.secondaryRunId,input.selection)
      this.append(id,'ACCEPTED',input.actorName,{fingerprint,selection:input.selection,actorId:input.actorId,native:input.native,processId:process.pid,processBoot,host:executionHostIdentity(),...(input.secondaryRunId?{secondaryRunId:input.secondaryRunId}:{})})
      return null
    },{behavior:'immediate'})
    if(replay){
      if(!['CONFIRMED','SIMULATED'].includes(replay.state))rejected(409,'Pedido anterior sem confirmação de execução; reenvio automático recusado.',replay)
      return {receipt:replay}
    }
    let sending=false
    let executionContext:GraphicRecoveryContext|null=null
    inFlight.add(id)
    const beforeSend=()=>{
      authorize();if(sending)return
      this.db.transaction(()=>{
        authorize()
        if(new SecondaryEventLedger(this.db,this.channelId).hasUnconfirmed())rejected(409,'Evento secundário sem confirmação surgiu durante a espera; envio gráfico recusado.')
        if(input.secondaryRunId)new SecondaryEventLedger(this.db,this.channelId).assertActiveGraphicBinding(input.secondaryRunId,input.selection)
        executionContext=input.context?.()??null
        if(input.context&&JSON.stringify(executionContext)!==JSON.stringify(acceptedContext))throw new Error('Ocorrência mudou antes do envio; comando gráfico antigo recusado.')
        this.append(id,'SENDING',input.actorName,{executionContext});sending=true
      },{behavior:'immediate'})
    }
    try{
      const capture:{display?:GraphicDisplaySnapshot}={}
      const result=await graphicCapture.run(capture,()=>work(beforeSend))
      if(!sending)throw new Error('Comando sem etapa de envio confirmada.')
      const state:Phase=input.native?'CONFIRMED':'SIMULATED'
      this.db.transaction(()=>{
        if(input.context&&JSON.stringify(input.context())!==JSON.stringify(executionContext))throw new Error('Ocorrência de PGM mudou durante o comando; resultado não será atribuído à execução anterior.')
        this.append(id,state,input.actorName,{executionContext,...(capture.display?{composition:capture.display}:{})})
        // Couple the receipt pointer to a checkpoint owned by this live process.
        // A crash after ACK/bookkeeping cannot leave it pointing at an older SHOW.
        if(state==='CONFIRMED'&&capture.display){
          const row=this.db.$client.prepare('SELECT payload FROM channel_checkpoints WHERE channel_id=?').get(this.channelId) as {payload:string}|undefined
          if(row){const saved=JSON.parse(row.payload),owner=readExecutionOwner(this.db.$client,this.channelId)
            if(saved.playing&&saved.realEngine&&owner&&saved.ownerRunId===owner.id)this.db.$client.prepare('UPDATE channel_checkpoints SET payload=? WHERE channel_id=?').run(JSON.stringify({...saved,graphicReceiptId:id}),this.channelId)
          }
        }
      },{behavior:'immediate'})
      return {receipt:{id,state,replayed:false,physicalOutputValidated:false},result}
    }catch(error){
      const state:Phase=sending&&!(error instanceof EngineCommandRejected)?'UNCERTAIN':'REJECTED'
      try{this.db.transaction(()=>{
        this.append(id,state,input.actorName)
        if(state==='UNCERTAIN')this.db.insert(healthEvents).values({id:id+':alarm',channelId:this.channelId,component:'SECONDARY_EVENT',state:'graphic_command_uncertain',severity:'CRITICAL',message:'Comando gráfico sem confirmação durável; confira o engine e a imagem antes de uma nova intervenção. Não haverá reenvio automático.',occurredAt:new Date().toISOString()}).run()
      },{behavior:'immediate'})}catch{/* SENDING/ACCEPTED remain protected after storage failure. */}
      if(!sending&&error instanceof CollaborativeEditError)throw error
      return rejected(409,state==='UNCERTAIN'?'Resultado gráfico incerto; confira a imagem e o histórico. Nenhum reenvio automático.':'Comando gráfico recusado; estado anterior preservado.',{id,state,replayed:false,physicalOutputValidated:false})
    }finally{inFlight.delete(id)}
  }
}
