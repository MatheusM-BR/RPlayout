import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { healthEvents, operatorDecisions } from '../db/schema.js'
import type { RecordedWatchdogEvent } from './live-watchdog.js'

/**
 * Registro do watchdog: toda transição e ação vai para o log de decisões (a
 * trilha do as-run/auditoria) e o que exige atenção vira incidente.
 *
 * Sem avalanche: a máquina só emite eventos em mudança real (com histerese),
 * uma condição vira UM incidente aberto até normalizar, e SUSPEITA não abre
 * incidente -- só ESPERA, CONTINGÊNCIA, falha de ação e condição confirmada.
 */
export class LiveWatchdogRecorder {
  private readonly open = new Map<string, string>()
  constructor(private readonly db: Db, private readonly channelId: string) {}

  persist(events: readonly RecordedWatchdogEvent[], context: { rundownId: string | null; itemId: string | null }): number {
    if (!events.length) return 0
    let written = 0
    this.db.transaction(tx => {
      for (const event of events) {
        const occurredAt = new Date(event.at).toISOString()
        tx.insert(operatorDecisions).values({ id: randomUUID(), rundownId: context.rundownId ?? '@execution', itemId: context.itemId,
          kind: 'LIVE_WATCHDOG_' + event.kind, actorUsername: event.kind === 'OPERATOR' ? null : '@watchdog', createdAt: occurredAt,
          payload: { channelId: this.channelId, source: event.sourceName, sourceId: event.sourceId, bus: event.bus, message: event.message,
            ...(event.detection ? { detection: event.detection } : {}), ...(event.from ? { from: event.from, to: event.to } : {}),
            ...(event.durationMs !== undefined ? { durationMs: Math.round(event.durationMs) } : {}), ...(event.thresholdMs !== undefined ? { thresholdMs: event.thresholdMs } : {}) } }).run()
        written++
        const key = `${event.bus}|${event.sourceKey}|${event.detection ?? ''}`
        if (event.kind === 'CONDITION' && event.detection) {
          if (this.open.has(key)) continue
          const id = 'live-watchdog:' + randomUUID()
          tx.insert(healthEvents).values({ id, channelId: this.channelId, component: 'LIVE_WATCHDOG', state: event.detection.toLowerCase(),
            severity: event.bus === 'pvw' ? 'WARN' : event.severity, message: (event.bus === 'pvw' ? '[PVW] ' : '') + event.message, occurredAt }).run()
          this.open.set(key, id)
        } else if (event.kind === 'CONDITION_CLEARED' && event.detection) {
          const id = this.open.get(key)
          if (!id) continue
          this.open.delete(key)
          tx.update(healthEvents).set({ resolvedAt: occurredAt }).where(eq(healthEvents.id, id)).run()
          tx.insert(healthEvents).values({ id: id + ':recovered', channelId: this.channelId, component: 'LIVE_WATCHDOG', state: event.detection.toLowerCase() + '_recovered',
            severity: 'INFO', message: event.message, occurredAt, resolvedAt: occurredAt }).onConflictDoNothing().run()
        } else if (event.kind === 'ACTION_FAILED' || (event.kind === 'TRANSITION' && event.to && (event.to === 'ESPERA' || event.to === 'CONTINGENCIA' || (event.to === 'OK' && event.from === 'RETORNO')))) {
          const state = event.kind === 'ACTION_FAILED' ? 'action_failed' : event.to === 'OK' ? 'retorno' : event.to!.toLowerCase()
          tx.insert(healthEvents).values({ id: 'live-watchdog:' + randomUUID(), channelId: this.channelId, component: 'LIVE_WATCHDOG', state,
            severity: event.kind === 'ACTION_FAILED' ? 'CRITICAL' : event.to === 'OK' ? 'INFO' : 'CRITICAL', message: event.message, occurredAt,
            ...(event.to === 'OK' ? { resolvedAt: occurredAt } : {}) }).run()
        }
      }
    })
    return written
  }
}
