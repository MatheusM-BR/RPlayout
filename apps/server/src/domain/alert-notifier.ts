import { and, desc, gt, inArray, isNull, ne } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { healthEvents } from '../db/schema.js'
import { emitIntegrationEvent } from './integrations.js'
import { sanitizeDiagnostic } from './sanitize-diagnostic.js'

/** Leva os alertas para fora da tela. Cada incidente CRITICAL/WARN novo vira
 * um evento de integração (`alert.critical` / `alert.warning`); enquanto ninguém
 * der ciente nem a condição resolver, `alert.reminder` repete a cada
 * `reminderMs` (padrão 2 min), no máximo `maxReminders` vezes. As entregas usam
 * a fila de integrações (persistida, com novas tentativas). Integrações e
 * reenvios de entrega não geram alerta, para não haver laço. */
export interface AlertNotifierOptions { reminderMs?: number; maxReminders?: number; now?: () => number }

const QUIET = ['INTEGRATION']

export class AlertNotifier {
  private cursor: string
  private timer: ReturnType<typeof setInterval> | null = null
  private reminders = new Map<string, { count: number; last: number }>()
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
    this.timer = setInterval(() => { void this.tick() }, intervalMs)
    this.timer.unref()
  }
  close() { if (this.timer) clearInterval(this.timer); this.timer = null }

  async tick(): Promise<number> {
    if (this.running) return 0
    this.running = true
    let sent = 0
    try {
      const fresh = await this.db.select().from(healthEvents)
        .where(and(gt(healthEvents.occurredAt, this.cursor), inArray(healthEvents.severity, ['CRITICAL', 'WARN']), ne(healthEvents.component, QUIET[0]!)))
        .orderBy(healthEvents.occurredAt).limit(50)
      for (const row of fresh) {
        if (row.occurredAt > this.cursor) this.cursor = row.occurredAt
        await emitIntegrationEvent(this.db, row.severity === 'CRITICAL' ? 'alert.critical' : 'alert.warning', describe(row), row.channelId)
        if (row.severity === 'CRITICAL') this.reminders.set(row.id, { count: 0, last: this.now() })
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
    } catch { /* alerta externo nunca derruba o playout */ }
    finally { this.running = false }
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
  const head = event === 'alert.critical' ? '🔴 RPlayout CRÍTICO' : event === 'alert.warning' ? '🟠 RPlayout aviso' : event === 'alert.reminder' ? `⏰ RPlayout sem ciente há ${inner.minutesOpen ?? '?'} min` : `RPlayout ${event}`
  const where = inner.component ? `${inner.component}${inner.state ? ' · ' + inner.state : ''}` : ''
  const lines = [head, where, typeof inner.message === 'string' ? inner.message : '', channelId ? `canal ${channelId.slice(0, 8)}` : ''].filter(Boolean)
  return lines.join('\n').slice(0, 3500)
}
