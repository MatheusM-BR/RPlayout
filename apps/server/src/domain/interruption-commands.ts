import {hostname} from 'node:os'
import {randomUUID,createHash} from 'node:crypto'
import type Database from 'better-sqlite3'
import {eq} from 'drizzle-orm'
import type {Db} from '../db/client.js'
import {operatorDecisions} from '../db/schema.js'
import {CollaborativeEditError} from './collaborative-edit.js'
import {sanitizeDiagnostic} from './sanitize-diagnostic.js'

type Phase='PREPARING'|'SWITCHING'|'CONFIRMED'|'FAILED'|'UNCERTAIN'|'CLOSED_UNCERTAIN'
interface Intent {channelId:string;interruptionId:string;action:'RESUME'|'DISCARD';reviewToken:string}
interface Run extends Intent {requestId:string;hash:string;phase:Phase;actor:string|null;owner:{host:string;pid:number;boot:string;enginePid:number|null};nativeProgramConfirmed?:boolean;message?:string;finishedAt?:string;acknowledgedBy?:string|null;acknowledgedAt?:string;physicalOutputValidated:false}
const key=(id:string)=>`interruption-command:${id}`,slot=(id:string)=>`interruption-slot:${id}`
const error=(message:string)=>new CollaborativeEditError(409,{error:message})
const gone=(pid:number)=>{try{process.kill(pid,0);return false}catch(e){return (e as NodeJS.ErrnoException).code==='ESRCH'}}

/** A durable command/slot, not a timed retry. Unknown TAKE is never replayed.
 * Claim, interrupted state and audit share the same immediate transaction. */
export class InterruptionCommands {
  private readonly owner={host:hostname(),pid:process.pid,boot:randomUUID()}
  private readonly active=new Set<string>()
  constructor(private readonly db:Db,private readonly sqlite:Database.Database){}
  private read(id:string):Run|null{
    const row=this.db.select().from(operatorDecisions).where(eq(operatorDecisions.id,key(id))).get()
    if(!row)return null
    const p=row.payload as unknown as Run
    if(row.kind!=='INTERRUPTION_COMMAND' || !p || p.requestId!==id || !p.owner || !['PREPARING','SWITCHING','CONFIRMED','FAILED','UNCERTAIN','CLOSED_UNCERTAIN'].includes(p.phase) || typeof p.owner.host!=='string' || !Number.isSafeInteger(p.owner.pid) || p.owner.pid<1 || typeof p.owner.boot!=='string' || p.owner.enginePid!==null && (!Number.isSafeInteger(p.owner.enginePid)||p.owner.enginePid<1))throw error('Registro de retorno inválido. Nenhum TAKE será presumido ou repetido.')
    return p
  }
  publicRun(run:Run){return {requestId:run.requestId,action:run.action,phase:run.phase,nativeProgramConfirmed:run.nativeProgramConfirmed??false,physicalOutputValidated:false,message:run.message??null}}
  current(interruptionId:string):Run|null{
    const row=this.db.select().from(operatorDecisions).where(eq(operatorDecisions.id,slot(interruptionId))).get()
    if(!row)return null
    if(row.kind!=='INTERRUPTION_COMMAND_SLOT' || typeof row.payload.requestId!=='string')throw error('Registro de posse do retorno inválido.')
    const run=this.read(row.payload.requestId)
    if(!run || run.interruptionId!==interruptionId)throw error('Registro do retorno ausente ou incompatível.')
    return run
  }
  canReconcile(interruptionId:string):boolean{
    const run=this.current(interruptionId)
    if(!run || !['PREPARING','SWITCHING','UNCERTAIN'].includes(run.phase) || this.active.has(run.requestId) || run.owner.host!==this.owner.host)return false
    return run.owner.boot===this.owner.boot || gone(run.owner.pid) && (run.owner.enginePid===null || gone(run.owner.enginePid))
  }
  blockedReason(channelId:string):string|null{
    return this.sqlite.prepare("SELECT id FROM interrupted_items WHERE channel_id=? AND state IN ('RESUMING','UNCERTAIN') LIMIT 1").get(channelId)?'Há retorno de VT em andamento ou com TAKE inconclusivo. Confira o registro; nenhuma nova entrada/recuperação será automática. Pare o PGM e limpe o CUE para encerrar uma pendência.':null
  }
  private write(run:Run):void{
    const result=this.db.update(operatorDecisions).set({payload:run as unknown as Record<string,unknown>}).where(eq(operatorDecisions.id,key(run.requestId))).run()
    if(result.changes!==1)throw error('Registro de retorno não pôde ser confirmado.')
  }
  async execute(requestId:string,intent:Intent,actor:string|null,enginePid:number|null,authorize:()=>void,claim:()=>void,work:(lifecycle:{validate:()=>void;beforeTake:()=>void;confirmed:(native:boolean)=>void})=>Promise<void>){
    const hash=createHash('sha256').update(JSON.stringify([intent,actor])).digest('hex')
    const claimed=this.db.transaction(()=>{
      authorize()
      const duplicate=this.read(requestId)
      if(duplicate){if(duplicate.hash!==hash || duplicate.actor!==actor)throw error('O identificador já pertence a outro retorno/decisão. Nenhum TAKE foi repetido.');return {run:duplicate,duplicate:true}}
      const blocked=this.blockedReason(intent.channelId);if(intent.action==='RESUME' && blocked)throw error(blocked)
      claim()
      const run:Run={...intent,requestId,hash,actor,owner:{...this.owner,enginePid},phase:intent.action==='RESUME'?'PREPARING':'CONFIRMED',physicalOutputValidated:false}
      const now=new Date().toISOString(),row=this.sqlite.prepare('SELECT rundown_id,item_id,state FROM interrupted_items WHERE id=? AND channel_id=?').get(intent.interruptionId,intent.channelId) as {rundown_id:string;item_id:string;state:string}|undefined
      if(!row || row.state!=='PENDING')throw error('Este retorno mudou ou já foi resolvido. Atualize a conferência.')
      const state=intent.action==='RESUME'?'RESUMING':'DISCARDED'
      this.sqlite.prepare('UPDATE interrupted_items SET state=?,resolved_at=?,resolved_by=? WHERE id=?').run(state,state==='DISCARDED'?now:null,state==='DISCARDED'?actor:null,intent.interruptionId)
      this.db.insert(operatorDecisions).values({id:key(requestId),rundownId:row.rundown_id,itemId:row.item_id,kind:'INTERRUPTION_COMMAND',actorUsername:actor,createdAt:now,payload:run as unknown as Record<string,unknown>}).run()
      this.db.insert(operatorDecisions).values({id:slot(intent.interruptionId),rundownId:row.rundown_id,itemId:row.item_id,kind:'INTERRUPTION_COMMAND_SLOT',actorUsername:actor,createdAt:now,payload:{channelId:intent.channelId,interruptionId:intent.interruptionId,requestId}}).onConflictDoUpdate({target:operatorDecisions.id,set:{payload:{channelId:intent.channelId,interruptionId:intent.interruptionId,requestId},actorUsername:actor,createdAt:now}}).run()
      return {run,duplicate:false}
    },{behavior:'immediate'})
    if(claimed.duplicate || intent.action==='DISCARD')return {run:this.publicRun(claimed.run),deduplicated:claimed.duplicate}
    const assertOwner=()=>{const run=this.current(intent.interruptionId);if(!run || run.requestId!==requestId || !['PREPARING','SWITCHING'].includes(run.phase))throw error('A posse ou fase do retorno mudou; nenhum novo comando será enviado.');return run}
    const validate=()=>this.db.transaction(()=>{authorize();assertOwner();claim()},{behavior:'immediate'})
    this.active.add(requestId)
    try{
      await work({validate,beforeTake:()=>this.db.transaction(()=>{authorize();const run=assertOwner();claim();if(run.phase!=='PREPARING')throw error('TAKE de retorno já despachado.');this.write({...run,phase:'SWITCHING'})},{behavior:'immediate'}),confirmed:native=>this.db.transaction(()=>{
        const run=assertOwner();if(run.phase!=='SWITCHING')throw error('Retorno sem intenção de TAKE registrada.')
        const changed=this.sqlite.prepare("UPDATE interrupted_items SET state='RESUMED',resolved_at=?,resolved_by=? WHERE id=? AND channel_id=? AND state='RESUMING'").run(new Date().toISOString(),actor,intent.interruptionId,intent.channelId)
        if(changed.changes!==1)throw error('O retorno mudou após o TAKE; resultado permanece inconclusivo.')
        this.write({...run,phase:'CONFIRMED',nativeProgramConfirmed:native,finishedAt:new Date().toISOString()})
      },{behavior:'immediate'})})
      const run=this.read(requestId)!
      if(run.phase!=='CONFIRMED')throw new Error('Retorno não recebeu confirmação do PGM.')
      return {run:this.publicRun(run),deduplicated:false}
    }catch(failure){
      const run=this.read(requestId),message=sanitizeDiagnostic(failure instanceof Error?failure.message:'Retorno não confirmado.')
      if(run?.phase==='CONFIRMED')return {run:{...this.publicRun(run),message:'PGM confirmou o retorno, mas a limpeza de preview precisa de atenção: '+message},deduplicated:false}
      this.db.transaction(()=>{
        const current=assertOwner(),phase=current.phase==='PREPARING'?'FAILED':'UNCERTAIN'
        this.write({...current,phase,message,finishedAt:new Date().toISOString()})
        this.sqlite.prepare('UPDATE interrupted_items SET state=? WHERE id=? AND channel_id=? AND state=\'RESUMING\'').run(phase==='FAILED'?'PENDING':'UNCERTAIN',intent.interruptionId,intent.channelId)
      },{behavior:'immediate'})
      if(failure instanceof CollaborativeEditError && run?.phase==='PREPARING')throw failure
      return {run:this.publicRun(this.read(requestId)!),deduplicated:false}
    }finally{this.active.delete(requestId)}
  }
  acknowledge(channelId:string,interruptionId:string,requestId:string,actor:string|null,authorize:()=>void){
    return this.db.transaction(()=>{
      authorize();const run=this.current(interruptionId)
      if(!run || run.channelId!==channelId || run.requestId!==requestId || !this.canReconcile(interruptionId))throw error('Pedido mudou ou seus processos anteriores estão ativos/desconhecidos. Não é seguro encerrar a pendência.')
      const result=this.sqlite.prepare("UPDATE interrupted_items SET state='CLOSED_UNCERTAIN',resolved_at=?,resolved_by=? WHERE id=? AND channel_id=? AND state IN ('RESUMING','UNCERTAIN')").run(new Date().toISOString(),actor,interruptionId,channelId)
      if(result.changes!==1)throw error('A pendência mudou; nenhum retorno será reaberto.')
      this.write({...run,phase:'CLOSED_UNCERTAIN',acknowledgedBy:actor,acknowledgedAt:new Date().toISOString(),message:'Pendência reconhecida com PGM parado/CUE limpo. Não confirmou sucesso nem reabriu o cursor para repetição.'})
      return {closed:true,automaticTake:false,physicalOutputValidated:false}
    },{behavior:'immediate'})
  }
}
