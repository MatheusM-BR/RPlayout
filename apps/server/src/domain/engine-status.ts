/**
 * Estado único do engine mostrado ao plantonista (cabeçalho, cartões do
 * Monitor, processos, logs). Uma fonte só evita a tela dizer "PARADO", "NO AR"
 * e "error" ao mesmo tempo.
 */
export type EngineState = 'OK' | 'ALERT' | 'RESTARTING' | 'FAILED'
export interface EngineStatus {
  state: EngineState
  /** Último erro do engine (nulo quando subiu limpo). */
  message: string | null
  /** Último comando recusado, recente. Não altera `state`. */
  rejection: { message: string; at: string } | null
}
/** Transportes sem estado próprio (simulado) derivam da saúde básica. */
export function engineStatusOf(transport: { health(): { error: string | null; ready: boolean }; engineStatus?: () => EngineStatus }): EngineStatus {
  if (typeof transport.engineStatus === 'function') return transport.engineStatus()
  const health = transport.health()
  return { state: !health.ready ? 'RESTARTING' : health.error ? 'ALERT' : 'OK', message: health.error, rejection: null }
}
/** Rótulo curto em português, igual em todas as telas. */
export const ENGINE_STATE_LABEL: Record<EngineState, string> = { OK: 'OK', ALERT: 'ALERTA', RESTARTING: 'REINICIANDO', FAILED: 'FALHA' }
