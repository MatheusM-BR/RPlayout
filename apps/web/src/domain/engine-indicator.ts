export function engineIndicator(process: { state: string; details?: Record<string, unknown> } | undefined, error = false) {
  if (error || process?.state === 'error') return { label: 'ENGINE COM ALERTA', ok: false }
  if (process?.details?.transport === 'SIMULATED') return { label: 'TRANSPORTE SIMULADO', ok: false }
  if (process?.state === 'running') return { label: 'ENGINE EM EXECUÇÃO', ok: true }
  return { label: 'ENGINE SEM CONFIRMAÇÃO', ok: false }
}
