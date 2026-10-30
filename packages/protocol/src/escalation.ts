import type { Role } from './permissions.js'

/** Nível de escalonamento de uma queda de sinal do PGM sem ciente. */
export type EscalationTier = 'OPERATOR' | 'SUPERVISOR' | 'ADMIN'

export const ESCALATION_SUPERVISOR_MS = 120_000
export const ESCALATION_ADMIN_MS = 420_000
const SIGNAL_STATES = ['black', 'freeze', 'silence']

/** Só o sinal do PGM (SIGNAL black/freeze/silence) em CRITICAL escala:
 * OPERATOR (<2:00), SUPERVISOR (2:00 a <7:00), ADMIN (>=7:00). Demais: null. */
export function escalationTier(component: string, state: string, severity: string, occurredAtMs: number, nowMs: number): EscalationTier | null {
  if (component !== 'SIGNAL' || severity !== 'CRITICAL' || !SIGNAL_STATES.includes(state)) return null
  if (!Number.isFinite(occurredAtMs) || !Number.isFinite(nowMs)) return null
  const elapsed = nowMs - occurredAtMs
  if (elapsed >= ESCALATION_ADMIN_MS) return 'ADMIN'
  if (elapsed >= ESCALATION_SUPERVISOR_MS) return 'SUPERVISOR'
  return 'OPERATOR'
}

const rank: Record<EscalationTier, number> = { OPERATOR: 0, SUPERVISOR: 1, ADMIN: 2 }
/** O incidente é "para mim" quando meu papel alcança o nível. PROGRAMMER fica no nível de operador. */
export function escalationForRole(role: Role | 'DENIED', tier: EscalationTier): boolean {
  const mine = role === 'ADMIN' ? 2 : role === 'SUPERVISOR' ? 1 : role === 'DENIED' ? -1 : 0
  return mine >= rank[tier]
}
