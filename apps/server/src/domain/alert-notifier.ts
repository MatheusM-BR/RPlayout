import { and, desc, eq, gt, inArray, isNull, ne } from 'drizzle-orm'
import { escalationTier, type EscalationTier } from '@rplayout/protocol'
import type { Db } from '../db/client.js'
import { healthEvents } from '../db/schema.js'
import { emitIntegrationEvent } from './integrations.js'
import { sanitizeDiagnostic } from './sanitize-diagnostic.js'

/** Leva os alertas para fora da tela. Cada incidente CRITICAL/WARN novo vira
 * um evento de integração (`alert.critical` / `alert.warning`); enquanto ninguém
 * der ciente nem a condição resolver, `alert.reminder` repete a cada
 * `reminderMs` (padrão 2 min), no máximo `maxReminders` vezes. As entregas usam
 * a fila de integrações (persistida, com novas tentativas). Integrações e
 * reenvios de entrega não geram alerta, para não haver laço.
 * Queda de sinal do PGM sem ciente também sobe de nível: `alert.escalated`
 * uma única vez por nível (SUPERVISOR aos 2 min, ADMIN aos 7), calculado de
 * `occurredAt`. O teto de lembretes não limita a escalada. */
export interface AlertNotifierOptions { reminderMs?: number; maxReminders?: number; now?: () => number }

const QUIET = ['INTEGRATION']
const LEVEL: Record<EscalationTier, number> = { OPERATOR: 0, SUPERVISOR: 1, ADMIN: 2 }
const SEED_LIMIT = 50
const keyOf = (row: { id: string; occurredAt: string }) => `${row.id}|${row.occurredAt}`

export class AlertNotifier {
  private cursor: string
  private timer: ReturnType<typeof setInterval> | null = null
  private reminders = new Map<string, { count: number; last: number }>()
  private escalations = new Map<string, { id: string; level: number }>()
  private seeding: Promise<void> | null = null
  private running = false
  private readonly reminderMs: number
  private readonly maxReminders: number
  private readonly now: () => number

  constructor(private readonly db: Db, options: AlertNotifierOptions = {}) {
    this.reminderMs = options.reminderMs ?? 120_000
    this.maxReminders = options.maxReminders ?? 5
    this.now = options.now ?? Date.now
    // Começa agora: reiniciar o servidor não reenviaria o histórico inteiro.
    this.cursor = new Date(this.now()).toISOString()
  }

  start(intervalMs = 10_000) {
    if (this.timer) return
    this.seeding = this.seed()
    this.timer = setInterval(() => { void this.tick() }, intervalMs)
    this.timer.unref()
  }
  /** Reconstrói do banco os CRITICAL de sinal abertos, no nível em que já estão:
   * reinício não reenvia nível anterior nem histórico. */
  private async seed(): Promise<void> {
    try {
      const open = await this.db.select().from(healthEvents)
        .where(and(eq(healthEvents.severity, 'CRITICAL'), eq(healthEvents.component, 'SIGNAL'), isNull(healthEvents.acknowledgedAt), isNull(healthEvents.resolvedAt), isNull(healthEvents.observationEndedAt)))
        .orderBy(desc(healthEvents.occurredAt)).limit(SEED_LIMIT)
      for (const row of open) {
        const tier = escalationTier(row.component, row.state, row.severity, Date.parse(row.occurredAt), this.now())
        if (tier) this.escalations.set(keyOf(row), { id: row.id, level: LEVEL[tier] })
      }
    } catch { /* sem reconstrução, o pior caso é reenviar o nível atual uma vez */ }
  }
  close() { if (this.timer) clearInterval(this.timer); this.timer = null }

  async tick(): Promise<number> {
    if (this.running) return 0
    this.running = true
    let sent = 0
    try {
      if (this.seeding) await this.seeding
      const fresh = await this.db.select().from(healthEvents)
        .where(and(gt(healthEvents.occurredAt, this.cursor), inArray(healthEvents.severity, ['CRITICAL', 'WARN']), ne(healthEvents.component, QUIET[0]!)))
        .orderBy(healthEvents.occurredAt).limit(50)
      for (const row of fresh) {
        if (row.occurredAt > this.cursor) this.cursor = row.occurredAt
        await emitIntegrationEvent(this.db, row.severity === 'CRITICAL' ? 'alert.critical' : 'alert.warning', describe(row), row.channelId)
        if (row.severity === 'CRITICAL') this.reminders.set(row.id, { count: 0, last: this.now() })
        if (escalationTier(row.component, row.state, row.severity, Date.parse(row.occurredAt), this.now()) && !this.escalations.has(keyOf(row))) this.escalations.set(keyOf(row), { id: row.id, level: 0 })
        sent++
      }
      if (this.reminders.size) {
        const open = await this.db.select().from(healthEvents)
          .where(and(inArray(healthEvents.id, [...this.reminders.keys()]), isNull(healthEvents.acknowledgedAt), isNull(healthEvents.resolvedAt)))
          .orderBy(desc(healthEvents.occurredAt))
        const stillOpen = new Set(open.map(row => row.id))
        for (const id of [...this.reminders.keys()]) if (!stillOpen.has(id)) this.reminders.delete(id)
        for (const row of open) {
          const state = this.reminders.get(row.id)!
          if (this.now() - state.last < this.reminderMs) continue
          state.count++; state.last = this.now()
          await emitIntegrationEvent(this.db, 'alert.reminder', { ...describe(row), reminder: state.count, minutesOpen: Math.round((this.now() - Date.parse(row.occurredAt)) / 60_000) }, row.channelId)
          sent++
          if (state.count >= this.maxReminders) this.reminders.delete(row.id)
        }
      }
      sent += await this.escalate()
    } catch { /* alerta externo nunca derruba o playout */ }
    finally { this.running = false }
    return sent
  }

  /** Um envio por transição de nível; some ao dar ciente ou resolver. */
  private async escalate(): Promise<number> {
    if (!this.escalations.size) return 0
    const ids = [...new Set([...this.escalations.values()].map(entry => entry.id))]
    const open = await this.db.select().from(healthEvents)
      .where(and(inArray(healthEvents.id, ids), isNull(healthEvents.acknowledgedAt), isNull(healthEvents.resolvedAt), isNull(healthEvents.observationEndedAt)))
    const live = new Set(open.map(keyOf))
    for (const key of [...this.escalations.keys()]) if (!live.has(key)) this.escalations.delete(key)
    let sent = 0
    for (const row of open) {
      const entry = this.escalations.get(keyOf(row))
      if (!entry) continue
      const tier = escalationTier(row.component, row.state, row.severity, Date.parse(row.occurredAt), this.now())
      if (!tier || LEVEL[tier] <= entry.level) continue
      entry.level = LEVEL[tier]
      await emitIntegrationEvent(this.db, 'alert.escalated', { ...describe(row), tier, minutesOpen: Math.floor((this.now() - Date.parse(row.occurredAt)) / 60_000) }, row.channelId)
      sent++
    }
    return sent
  }
}

function describe(row: typeof healthEvents.$inferSelect) {
  return {
    incidentId: row.id,
    severity: row.severity,
    component: row.component,
    state: row.state,
    message: row.message ? sanitizeDiagnostic(String(row.message)) : null,
    occurredAt: row.occurredAt,
  }
}

/** Texto curto para mensageiro (Telegram). */
export function alertText(event: string, payload: Record<string, unknown>, channelId: string | null): string {
  const inner = (payload.payload ?? payload) as Record<string, unknown>
  const head = event === 'alert.critical' ? '🔴 RPlayout CRÍTICO' : event === 'alert.warning' ? '🟠 RPlayout aviso' : event === 'alert.reminder' ? `⏰ RPlayout sem ciente há ${inner.minutesOpen ?? '?'} min` : event === 'alert.escalated' ? `🚨 RPlayout escalado para ${inner.tier ?? '?'} · sem ciente há ${inner.minutesOpen ?? '?'} min` : `RPlayout ${event}`
  const where = inner.component ? `${inner.component}${inner.state ? ' · ' + inner.state : ''}` : ''
  const lines = [head, where, typeof inner.message === 'string' ? inner.message : '', channelId ? `canal ${channelId.slice(0, 8)}` : ''].filter(Boolean)
  return lines.join('\n').slice(0, 3500)
}
