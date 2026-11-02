export function engineIndicator(process: { state: string; details?: Record<string, unknown> } | undefined, error = false) {
  if (error || process?.state === 'error') return { label: 'ENGINE COM ALERTA', ok: false }
  if (process?.details?.transport === 'SIMULATED') return { label: 'TRANSPORTE SIMULADO', ok: false }
  if (process?.state === 'running') return { label: 'ENGINE EM EXECUÇÃO', ok: true }
  return { label: 'ENGINE SEM CONFIRMAÇÃO', ok: false }
}

export type LiveEngineState = 'OK' | 'ALERT' | 'RESTARTING' | 'FAILED'
/** Estado do engine pela leitura de 3 s (/api/processes). Sem a linha do canal
 * enquanto a amostra de 10 s ainda tem o engine, o canal está sendo recriado
 * (REINICIAR do Monitor): antes o cabeçalho mostrava "OK · 1↻" e o cartão
 * "Engine não iniciado" ao mesmo tempo. */
export function liveEngineStateOf(processes: ReadonlyArray<{ kind: string; channelId?: string | null; details?: Record<string, unknown> | null }> | null, channelId: string): LiveEngineState | null {
  if (!processes) return null
  const row = processes.find(entry => entry.kind === 'ENGINE' && entry.channelId === channelId)
  if (!row) return 'RESTARTING'
  const state = row.details?.engineState
  return typeof state === 'string' && ['OK', 'ALERT', 'RESTARTING', 'FAILED'].includes(state) ? state as LiveEngineState : null
}
