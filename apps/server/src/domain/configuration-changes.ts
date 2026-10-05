import {randomUUID} from 'node:crypto'
import {hostname} from 'node:os'
import {eq} from 'drizzle-orm'
import type {Db} from '../db/client.js'
import {operatorDecisions} from '../db/schema.js'
import {CollaborativeEditError} from './collaborative-edit.js'
import {sanitizeDiagnostic} from './sanitize-diagnostic.js'

type Transaction=Parameters<Parameters<Db['transaction']>[0]>[0]
type Reader=Pick<Db,'select'>
type Writer=Pick<Transaction,'select'|'update'|'insert'>
interface Owner {host:string;pid:number;boot:string;enginePids:number[]}
interface Slot {channelId:string;runId:string;state:'APPLYING'|'UNCERTAIN'|'IDLE';owner:Owner;reason:string|null;phase:string}
const slotKey=(id:string)=>`configuration-slot:${id}`
const runKey=(id:string)=>`configuration-run:${id}`
const conflict=(reason:string,runId?:string)=>new CollaborativeEditError(409,{error:reason,...(runId?{configurationRunId:runId}:{}),configurationUncertain:true})
const processGone=(pid:number)=>{try{process.kill(pid,0);return false}catch(error){return (error as NodeJS.ErrnoException).code==='ESRCH'}}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A durable local/multi-writer fence, NOT a distributed HA lease. There is no
 * expiration that can steal ownership from a slow/live/unknown process. */
export class ConfigurationChanges {
  private readonly owner={host:hostname(),pid:process.pid,boot:randomUUID()}
  private readonly active=new Map<string,string>()
  constructor(private readonly db:Db){}
  private read(channelId:string,db:Reader=this.db):Slot|null{
    const row=db.select().from(operatorDecisions).where(eq(operatorDecisions.id,slotKey(channelId))).get()
    if(!row)return null
    const value=row.payload as unknown as Slot
    if(row.kind!=='CHANNEL_CONFIGURATION_SLOT' || row.rundownId!=='@configuration' || !value || value.channelId!==channelId || typeof value.runId!=='string' || !uuid.test(value.runId) || typeof value.phase!=='string' || !(value.reason===null || typeof value.reason==='string') || !['APPLYING','UNCERTAIN','IDLE'].includes(value.state) || !value.owner || typeof value.owner.host!=='string' || !Number.isSafeInteger(value.owner.pid) || value.owner.pid<1 || typeof value.owner.boot!=='string' || !uuid.test(value.owner.boot) || !Array.isArray(value.owner.enginePids) || value.owner.enginePids.some(pid=>!Number.isSafeInteger(pid)||pid<1))throw conflict('Registro de configuração inválido. Restaure um backup validado; nenhuma operação será presumida.')
    return value
  }
  owns(channelId:string):boolean{const slot=this.read(channelId);return Boolean(slot && this.active.get(channelId)===slot.runId && slot.owner.boot===this.owner.boot)}
  status(channelId:string){
    const slot=this.read(channelId),blocked=Boolean(slot && slot.state!=='IDLE')
    return {state:slot?.state??'IDLE',runId:blocked?slot!.runId:null,reason:blocked?(slot!.reason??'Há uma configuração em andamento ou sem conclusão durável. Aguarde ou confira a operação inconclusiva; nenhuma troca será repetida automaticamente.'):null,
      ownerLocal:blocked?slot!.owner.host===this.owner.host:null,reconcilable:blocked?this.canReconcile(slot!):false,phase:blocked?slot!.phase:null}
  }
  private canReconcile(slot:Slot):boolean{
    if(this.active.has(slot.channelId))return false
    if(slot.owner.host!==this.owner.host)return false
    if(slot.owner.boot===this.owner.boot)return true // execute's awaited callback has ended
    return processGone(slot.owner.pid) && slot.owner.enginePids.every(processGone)
  }
  blockedReason(channelId:string):string|null{return this.status(channelId).reason}
  canRecover(channelId:string):boolean{
    const slot=this.read(channelId)
    return !slot || slot.state==='IDLE' || this.owns(channelId) && slot.state==='APPLYING' && !['HOT_DISPATCHED','RECONCILING','INSERT_PREPARING','INSERT_SWITCHING'].includes(slot.phase)
  }
  trackEngine(channelId:string,pid:number|null):void{
    if(pid===null || !this.owns(channelId))return
    this.db.transaction(tx=>{
      const slot=this.read(channelId,tx)!
      if(!slot.owner.enginePids.includes(pid))tx.update(operatorDecisions).set({payload:{...slot,owner:{...slot.owner,enginePids:[...slot.owner.enginePids,pid]}}}).where(eq(operatorDecisions.id,slotKey(channelId))).run()
    },{behavior:'immediate'})
  }
  async execute<T>(channelId:string,enginePid:number|null,actor:string|null,action:string,work:(lease:ConfigurationLease)=>Promise<T>,reconcile?:{runId:string;authorize:(tx:Transaction)=>void}):Promise<T>{
    const runId=randomUUID(),createdAt=new Date().toISOString()
    this.db.transaction(tx=>{
      const previous=this.read(channelId,tx)
      if(reconcile){
        reconcile.authorize(tx)
        if(!previous || previous.state==='IDLE' || previous.runId!==reconcile.runId || !this.canReconcile(previous))throw conflict('Esta operação mudou ou seus processos anteriores ainda estão vivos/desconhecidos. Não é seguro liberar a configuração.',previous?.runId)
        tx.update(operatorDecisions).set({payload:{...tx.select().from(operatorDecisions).where(eq(operatorDecisions.id,runKey(previous.runId))).get()?.payload,state:'CLOSED_UNCERTAIN',acknowledgedAt:createdAt,acknowledgedBy:actor}}).where(eq(operatorDecisions.id,runKey(previous.runId))).run()
      }else if(previous && previous.state!=='IDLE')throw conflict(this.status(channelId).reason!,previous.runId)
      const slot:Slot={channelId,runId,state:'APPLYING',owner:{...this.owner,enginePids:enginePid===null?[]:[enginePid]},reason:null,phase:reconcile?'RECONCILING':'CLAIMED'}
      const value={id:slotKey(channelId),rundownId:'@configuration',kind:'CHANNEL_CONFIGURATION_SLOT',actorUsername:actor,createdAt,payload:slot as unknown as Record<string,unknown>}
      tx.insert(operatorDecisions).values(value).onConflictDoUpdate({target:operatorDecisions.id,set:{payload:value.payload,actorUsername:actor,createdAt}}).run()
      tx.insert(operatorDecisions).values({id:runKey(runId),rundownId:'@configuration',kind:'CHANNEL_CONFIGURATION_OPERATION',actorUsername:actor,createdAt,payload:{channelId,runId,action,state:'APPLYING',phase:slot.phase,...(reconcile?{reconcilesRunId:reconcile.runId}:{})}}).run()
    },{behavior:'immediate'})
    this.active.set(channelId,runId)
    const lease=new ConfigurationLease(this.db,channelId,runId,(db)=>this.read(channelId,db))
    let failed=false
    try{return await work(lease)}catch(error){failed=true;throw error}finally{
      try{if(!lease.uncertain)lease.finish(failed?'FAILED':'FINISHED')}
      finally{this.active.delete(channelId)}
    }
  }
}

export class ConfigurationLease {
  uncertain=false
  constructor(private readonly db:Db,readonly channelId:string,readonly runId:string,private readonly read:(db:Reader)=>Slot|null){}
  assertOwned(tx:Reader):void{
    const slot=this.read(tx)
    if(!slot || slot.runId!==this.runId || slot.state!=='APPLYING')throw conflict('A posse da configuração mudou. Nenhuma gravação/troca adicional será autorizada.',slot?.runId)
  }
  record(tx:Writer,phase:string,details:Record<string,unknown>={}):void{
    this.assertOwned(tx)
    const slot=this.read(tx)!,row=tx.select().from(operatorDecisions).where(eq(operatorDecisions.id,runKey(this.runId))).get()
    if(!row || row.kind!=='CHANNEL_CONFIGURATION_OPERATION')throw conflict('Registro da operação de configuração ausente.',this.runId)
    tx.update(operatorDecisions).set({payload:{...slot,phase}}).where(eq(operatorDecisions.id,slotKey(this.channelId))).run()
    tx.update(operatorDecisions).set({payload:{...row.payload,...details,phase}}).where(eq(operatorDecisions.id,row.id)).run()
  }
  markUncertain(reason:string):void{
    // Set before touching SQLite: failed persistence must not release a slot
    // whose native side effect can no longer be proved.
    this.uncertain=true
    this.db.transaction(tx=>{
      this.assertOwned(tx)
      const slot=this.read(tx)!,row=tx.select().from(operatorDecisions).where(eq(operatorDecisions.id,runKey(this.runId))).get()
      const message=sanitizeDiagnostic(reason)
      tx.update(operatorDecisions).set({payload:{...slot,state:'UNCERTAIN',reason:message}}).where(eq(operatorDecisions.id,slotKey(this.channelId))).run()
      if(row)tx.update(operatorDecisions).set({payload:{...row.payload,state:'UNCERTAIN',reason:message}}).where(eq(operatorDecisions.id,row.id)).run()
    },{behavior:'immediate'})
  }
  finish(state:string):void{
    this.db.transaction(tx=>{
      this.assertOwned(tx)
      const slot=this.read(tx)!,row=tx.select().from(operatorDecisions).where(eq(operatorDecisions.id,runKey(this.runId))).get()
      if(!row)throw conflict('Registro de conclusão da configuração ausente.',this.runId)
      tx.update(operatorDecisions).set({payload:{...slot,state:'IDLE',reason:null}}).where(eq(operatorDecisions.id,slotKey(this.channelId))).run()
      tx.update(operatorDecisions).set({payload:{...row.payload,state,finishedAt:new Date().toISOString()}}).where(eq(operatorDecisions.id,row.id)).run()
    },{behavior:'immediate'})
  }
}
