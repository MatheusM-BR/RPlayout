import { useSyncExternalStore } from 'react'

/** Estado do ar visto por todas as telas: o cabeçalho de qualquer aba mostra o
 * mesmo NO AR / FORA DO AR que o Master, em vez de "PGM: N/D" onde a tela não
 * recebe o transporte. `null` = ainda sem leitura do servidor. */
let current: boolean | null = null
const listeners = new Set<() => void>()
export function setAirState(value: boolean | null): void {
  if (value === current) return
  current = value
  for (const listener of listeners) listener()
}
export function useAirState(): boolean | null {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => current, () => current)
}
