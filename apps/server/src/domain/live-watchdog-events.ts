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
type Sqlite = import('better-sqlite3').Database
function persistOutage(sqlite: Sqlite, channelId: string, event: RecordedWatchdogEvent) {
  const outage = event.outage!
  const iso = (ms: number | null) => ms === null ? null : new Date(ms).toISOString()
  if (outage.phase === 'OPEN') {
    // Linha as-run do item ao vivo no ar quando a parada começou.
    const row = event.itemId ? sqlite.prepare('SELECT id FROM as_run WHERE channel_id=? AND item_id=? AND started_at<=? ORDER BY started_at DESC LIMIT 1').get(channelId, event.itemId, iso(event.at)) as { id: string } | undefined : undefined
    sqlite.prepare('INSERT OR IGNORE INTO live_outages(id,channel_id,as_run_id,item_id,source_key,source_name,started_at,ended_at,reasons,action,closed_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(outage.id, channelId, row?.id ?? null, event.itemId, event.sourceKey, event.sourceName, iso(outage.startedAt), null, JSON.stringify(outage.reasons), outage.action, null, new Date(event.at).toISOString())
  } else sqlite.prepare('UPDATE live_outages SET reasons=?,action=?,ended_at=COALESCE(?,ended_at),closed_by=COALESCE(?,closed_by) WHERE id=? AND channel_id=?')
    .run(JSON.stringify(outage.reasons), outage.action, iso(outage.endedAt), outage.closedBy, outage.id, channelId)
}

export class LiveWatchdogRecorder {
  private readonly open = new Map<string, string>()
  constructor(private readonly db: Db, private readonly channelId: string) {}

  persist(events: readonly RecordedWatchdogEvent[], context: { rundownId: string | null; itemId: string | null }): number {
    if (!events.length) return 0
    let written = 0
    this.db.transaction(tx => {
      for (const event of events) {
        const occurredAt = new Date(event.at).toISOString()
        // Paradas: só a entrada do PGM, presas à linha as-run do item que estava no ar.
        if (event.kind === 'OUTAGE') {
          if (event.bus !== 'pgm' || !event.outage) continue
          persistOutage(this.db.$client, this.channelId, event)
          continue
        }
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
