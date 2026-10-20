import { and, asc, eq, inArray, lte } from 'drizzle-orm'
import { randomUUID,createHash } from 'node:crypto'
import type { Db } from '../db/client.js'
import { healthEvents, integrationDeliveries, integrations,operatorDecisions } from '../db/schema.js'
import {executionHostIdentity} from './execution-host.js'
import {diagnoseIntegrationOwner} from './integration-diagnostic.js'

export class IntegrationOutbox {
  private closed = false
  private active:Promise<void>|null=null
  get isDraining(){return this.active!==null}
  settled():Promise<void>{return this.active??Promise.resolve()}
  private timer: ReturnType<typeof setInterval> | null = null
  private lastRetentionAt = 0
  private readonly owner={host:executionHostIdentity(),pid:process.pid,boot:randomUUID()}
  private readonly controllers = new Set<AbortController>()
  constructor(private readonly db: Db) {
    // A process may have died after POST but before recording its response.
    // Preserve the stable delivery ID on retry: this is at-least-once, not an
    // impossible exactly-once guarantee for arbitrary external endpoints.
    this.recover()
  }
  private rehearsal(){return Boolean(this.db.$client.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ha_recovery_origin'").get())}
  private recover(){this.db.transaction(()=>{
    if(this.rehearsal())return
    const rows=this.db.select().from(integrationDeliveries).where(eq(integrationDeliveries.state,'SENDING')).all()
    for(const row of rows){
      if(diagnoseIntegrationOwner(row).ownership!=='LOCAL_DEAD')continue
      const changed=this.db.$client.prepare("UPDATE integration_deliveries SET state=CASE WHEN attempts>=8 THEN 'FAILED' ELSE 'QUEUED' END,last_error='Envio interrompido; destinatário deve deduplicar pelo identificador.',owner_host=NULL,owner_pid=NULL,owner_boot=NULL WHERE id=? AND state='SENDING' AND owner_host=? AND owner_pid=? AND owner_boot=?").run(row.id,row.ownerHost,row.ownerPid,row.ownerBoot)
      if(changed.changes!==1)continue
      this.db.insert(operatorDecisions).values({id:'integration-auto-recovery:'+randomUUID(),rundownId:'@integrations',kind:'INTEGRATION_DELIVERY_AUTO_RECOVERED',actorUsername:null,createdAt:new Date().toISOString(),payload:{deliveryId:row.id,integrationId:row.integrationId,channelId:row.channelId,attempts:row.attempts,nextState:row.attempts>=8?'FAILED':'QUEUED',proof:'LOCAL_PROCESS_ABSENT',previousOwnerFingerprint:createHash('sha256').update(JSON.stringify([row.ownerHost,row.ownerPid,row.ownerBoot])).digest('hex'),originalTargetAndPayloadPreserved:true,deliverySemantics:'at-least-once',processKilled:false,automaticTake:false}}).run()
    }
  },{behavior:'immediate'})}
  private owns(id:string){return Boolean(this.db.$client.prepare("SELECT 1 FROM integration_deliveries WHERE id=? AND state='SENDING' AND owner_host=? AND owner_pid=? AND owner_boot=?").get(id,this.owner.host,this.owner.pid,this.owner.boot))}
  start() {
    if (this.timer || this.closed || this.rehearsal()) return
    void this.tick()
    this.timer = setInterval(() => { void this.tick() },1000)
    this.timer.unref()
  }
  close() {
    this.closed = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    for (const controller of this.controllers) controller.abort()
  }
  tick():Promise<void>{
    if(this.active)return this.active
    if(this.closed||this.rehearsal())return Promise.resolve()
    return this.active=this.work().finally(()=>{this.active=null})
  }
  private async work() {
    try {
      this.recover()
      if (Date.now() - this.lastRetentionAt >= 3_600_000) {
        // Keep pending/failing events until resolved; only old confirmed or
        // cancelled deliveries are eligible for bounded queue retention.
        await this.db.delete(integrationDeliveries).where(and(
          inArray(integrationDeliveries.state, ['DELIVERED', 'CANCELLED']),
          lte(integrationDeliveries.createdAt, new Date(Date.now() - 30 * 86_400_000).toISOString()),
        ))
        this.lastRetentionAt = Date.now()
      }
      const rows = await this.db.select().from(integrationDeliveries)
        .where(and(eq(integrationDeliveries.state,'QUEUED'),lte(integrationDeliveries.nextAttemptAt,new Date().toISOString())))
        .orderBy(asc(integrationDeliveries.nextAttemptAt)).limit(4)
      if (this.closed) return
      await Promise.all(rows.map(row => this.deliver(row)))
    } catch { /* A bad queue/config must not terminate the playout timer. */ }
  }
  private async deliver(row: typeof integrationDeliveries.$inferSelect) {
    const claimed=this.db.transaction(()=>{
      if(this.closed||this.rehearsal())return null
      const current=this.db.select().from(integrationDeliveries).where(eq(integrationDeliveries.id,row.id)).get()
      if(!current||current.state!=='QUEUED'||Date.parse(current.nextAttemptAt)>Date.now())return null
      const configuration=this.db.select().from(integrations).where(eq(integrations.id,current.integrationId)).get()
      const valid=configuration&&configuration.url===current.target&&(current.manualTest||configuration.enabled&&configuration.events.includes(current.event))
      if(!valid){this.db.update(integrationDeliveries).set({state:'CANCELLED',lastError:'Integração/destino alterado, removido/desativado ou evento retirado.'}).where(eq(integrationDeliveries.id,current.id)).run();return null}
      if(current.attempts>=8){this.db.update(integrationDeliveries).set({state:'FAILED',lastError:'Limite de tentativas atingido. Reenvio exige conferência.'}).where(eq(integrationDeliveries.id,current.id)).run();return null}
      const attempts=current.attempts+1
      this.db.update(integrationDeliveries).set({state:'SENDING',attempts,ownerHost:this.owner.host,ownerPid:this.owner.pid,ownerBoot:this.owner.boot}).where(eq(integrationDeliveries.id,current.id)).run()
      return {...current,attempts}
    },{behavior:'immediate'})
    if(!claimed)return
    row=claimed
    const attempts=row.attempts
    const controller = new AbortController(); this.controllers.add(controller)
    const timeout = setTimeout(() => controller.abort(),5000)
    let error: string | null = null
    try {
      const url = new URL(row.target)
      if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw new Error('unsupported destination')
      const response = await fetch(url,{ method:'POST',redirect:'error',signal:controller.signal,
        headers:{'content-type':'application/json','user-agent':'RPlayout-Gateway/1','idempotency-key':row.id},body:JSON.stringify(row.payload) })
      error = response.ok ? null : `Destino respondeu HTTP ${response.status}.`
      // Do not buffer an arbitrarily large response from the external service.
      await response.body?.cancel()
    } catch { error = controller.signal.aborted ? 'Destino não respondeu em 5 segundos.' : 'Destino indisponível, URL inválida ou redirecionamento recusado.' }
    finally { clearTimeout(timeout); this.controllers.delete(controller) }
    if(this.closed)error='Servidor encerrando; confirmação remota pode ser inconclusiva.'
    this.db.transaction(()=>{
    if(!this.owns(row.id))return // A late response never certifies another claim.
    if (!error) {
      this.db.update(integrationDeliveries).set({state:'DELIVERED',deliveredAt:new Date().toISOString(),lastError:null}).where(eq(integrationDeliveries.id,row.id)).run()
      if (attempts > 1) this.db.insert(healthEvents).values({ id:randomUUID(),channelId:row.channelId,component:'INTEGRATION',state:'recovered',severity:'INFO',message:`Entrega ${row.id} confirmada após ${attempts} tentativas.`,occurredAt:new Date().toISOString() }).run()
    } else {
      const failed = attempts >= 8
      this.db.update(integrationDeliveries).set({state:failed?'FAILED':'QUEUED',lastError:error,nextAttemptAt:new Date(Date.now()+Math.min(300_000,5000*2**(attempts-1))).toISOString()}).where(eq(integrationDeliveries.id,row.id)).run()
      if (attempts === 1 || failed) this.db.insert(healthEvents).values({ id:randomUUID(),channelId:row.channelId,component:'INTEGRATION',state:failed?'failed':'retrying',severity:failed?'CRITICAL':'WARN',message:`Entrega ${row.id}: ${error}${failed?' Reenvio manual necessário.':' Reenvio automático agendado.'}`,occurredAt:new Date().toISOString() }).run()
    }
    },{behavior:'immediate'})
  }
}
