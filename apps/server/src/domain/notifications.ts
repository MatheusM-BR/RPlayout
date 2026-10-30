import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { escalationForRole, escalationTier, type AccessRole, type EscalationTier } from '@rplayout/protocol'
import type { Db } from '../db/client.js'
import { healthEvents } from '../db/schema.js'
import { IncidentError } from './health-incidents.js'

export interface OpenNotification {
  id: string; channelId: string | null; component: string; state: string; severity: 'CRITICAL'
  occurredAt: string; minutesOpen: number; tier: EscalationTier; forMe: boolean
}

/** Quedas de sinal do PGM ainda abertas (sem ciente e sem recuperação), com o
 * nível de escalonamento atual. O escopo de canal é aplicado antes do limite. */
export function readOpenNotifications(db: Db, channelIds: string[] | null, channelId: string | undefined, role: AccessRole, nowMs = Date.now(), limit = 50): OpenNotification[] {
  if (channelId && channelIds !== null && !channelIds.includes(channelId)) throw new IncidentError(403, 'Sem acesso aos incidentes deste canal.')
  if (channelIds?.length === 0) return []
  const scope = channelId ? eq(healthEvents.channelId, channelId) : channelIds !== null ? inArray(healthEvents.channelId, channelIds) : undefined
  const rows = db.select().from(healthEvents).where(and(scope, eq(healthEvents.component, 'SIGNAL'), eq(healthEvents.severity, 'CRITICAL'),
    inArray(healthEvents.state, ['black', 'freeze', 'silence']), isNull(healthEvents.acknowledgedAt), isNull(healthEvents.resolvedAt)))
    .orderBy(desc(healthEvents.occurredAt), desc(healthEvents.id)).limit(Math.min(100, Math.max(1, limit))).all()
  const out: OpenNotification[] = []
  for (const row of rows) {
    const at = Date.parse(row.occurredAt)
    const tier = escalationTier(row.component, row.state, row.severity, at, nowMs)
    if (!tier) continue
    out.push({ id: row.id, channelId: row.channelId, component: row.component, state: row.state, severity: 'CRITICAL', occurredAt: row.occurredAt,
      minutesOpen: Math.max(0, Math.floor((nowMs - at) / 60_000)), tier, forMe: role !== 'DENIED' && escalationForRole(role, tier) })
  }
  return out
}
