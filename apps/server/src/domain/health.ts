export type Severity = 'INFO' | 'WARN' | 'CRITICAL'

export function severityOf(component: string, state: string, message: string | null): Severity {
  if (state === 'error' || state === 'stopped' || state === 'retrying' || state === 'failed') return 'CRITICAL'
  if (state === 'connecting' || state === 'degraded' || message) return 'WARN'
  return 'INFO'
}

/**
 * Transição do incidente de ENGINE a partir da saúde atual. Só uma mudança
 * real (pronto ⇄ erro, ou erro com outra mensagem) vira evento: o watchdog
 * relançar o processo troca PID e contador, mas é a mesma queda.
 */
export function engineIncidentTransition(previous: string | undefined, health: { error: string | null; ready: boolean; restarts: number }, pid: number | null):
  { signature: string; state: 'error' | 'running'; message: string; record: boolean } | null {
  if (health.error) {
    const signature = `error|${health.error}`
    return previous === signature ? null : { signature, state: 'error', message: health.error, record: true }
  }
  if (!health.ready || previous === 'running') return null
  const where = pid === null ? '' : `PID ${pid}`
  const message = previous === undefined
    ? `Engine pronto${where ? ` (${where})` : ''}.`
    : `Engine pronto novamente${where ? ` (${where}` : ' ('}${where ? '; ' : ''}reinícios nesta sessão: ${health.restarts}).`
  return { signature: 'running', state: 'running', message, record: true }
}
