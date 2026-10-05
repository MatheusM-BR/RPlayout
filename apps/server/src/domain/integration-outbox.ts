import { and, asc, eq, inArray, lte } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import type { Db } from '../db/client.js'
import { healthEvents, integrationDeliveries, integrations } from '../db/schema.js'

export class IntegrationOutbox {
  private closed = false
  private running = false
  private timer: ReturnType<typeof setInterval> | null = null
  private lastRetentionAt = 0
  private readonly controllers = new Set<AbortController>()
  constructor(private readonly db: Db) {
    // A process may have died after POST but before recording its response.
    // Preserve the stable delivery ID on retry: this is at-least-once, not an
    // impossible exactly-once guarantee for arbitrary external endpoints.
    db.update(integrationDeliveries).set({ state:'QUEUED' }).where(eq(integrationDeliveries.state,'SENDING')).run()
  }
  start() {
    if (this.timer || this.closed) return
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
  async tick() {
    if (this.closed || this.running) return
    this.running = true
    try {
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
    finally { this.running = false }
  }
  private async deliver(row: typeof integrationDeliveries.$inferSelect) {
    const configuration = await this.db.select().from(integrations).where(eq(integrations.id,row.integrationId)).limit(1)
    if (this.closed) return
    if (!configuration[0]?.enabled || !configuration[0].events.includes(row.event)) {
      this.db.update(integrationDeliveries).set({state:'CANCELLED',lastError:'Integração removida/desativada ou evento retirado da configuração.'}).where(eq(integrationDeliveries.id,row.id)).run()
      return
    }
    const attempts = row.attempts+1
    this.db.update(integrationDeliveries).set({state:'SENDING',attempts}).where(eq(integrationDeliveries.id,row.id)).run()
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
    if (this.closed) return // SENDING will be recovered on the next startup.
    if (!error) {
      this.db.update(integrationDeliveries).set({state:'DELIVERED',deliveredAt:new Date().toISOString(),lastError:null}).where(eq(integrationDeliveries.id,row.id)).run()
      if (attempts > 1) this.db.insert(healthEvents).values({ id:randomUUID(),channelId:row.channelId,component:'INTEGRATION',state:'recovered',severity:'INFO',message:`Entrega ${row.id} confirmada após ${attempts} tentativas.`,occurredAt:new Date().toISOString() }).run()
    } else {
      const failed = attempts >= 8
      this.db.update(integrationDeliveries).set({state:failed?'FAILED':'QUEUED',lastError:error,nextAttemptAt:new Date(Date.now()+Math.min(300_000,5000*2**(attempts-1))).toISOString()}).where(eq(integrationDeliveries.id,row.id)).run()
      if (attempts === 1 || failed) this.db.insert(healthEvents).values({ id:randomUUID(),channelId:row.channelId,component:'INTEGRATION',state:failed?'failed':'retrying',severity:failed?'CRITICAL':'WARN',message:`Entrega ${row.id}: ${error}${failed?' Reenvio manual necessário.':' Reenvio automático agendado.'}`,occurredAt:new Date().toISOString() }).run()
    }
  }
}
