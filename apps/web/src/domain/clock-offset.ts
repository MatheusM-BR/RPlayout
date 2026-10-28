import { useEffect, useState } from 'react'

/** Diferença entre o relógio desta estação e o do servidor (ms; positivo =
 * estação adiantada). As contagens de parede (fim da grade, próximo fixo)
 * usam o relógio da estação, então um PC fora de hora mente na tela. */
export interface ClockOffset { offsetMs: number; rttMs: number; checkedAt: number }

export function estimateOffset(sentMs: number, receivedMs: number, serverIso: string): ClockOffset | null {
  const serverMs = Date.parse(serverIso)
  const rttMs = receivedMs - sentMs
  if (!Number.isFinite(serverMs) || rttMs < 0 || rttMs > 2000) return null
  return { offsetMs: Math.round((sentMs + receivedMs) / 2 - serverMs), rttMs, checkedAt: receivedMs }
}

export type ClockLevel = 'ok' | 'warn' | 'bad' | 'unknown'
export const clockLevel = (offset: ClockOffset | null): ClockLevel =>
  !offset ? 'unknown' : Math.abs(offset.offsetMs) < 1000 ? 'ok' : Math.abs(offset.offsetMs) < 5000 ? 'warn' : 'bad'

let current: ClockOffset | null = null
const listeners = new Set<(value: ClockOffset | null) => void>()
let timer: number | null = null
async function measure(): Promise<void> {
  try {
    const sent = Date.now()
    const response = await fetch('/api/health', { cache: 'no-store', credentials: 'same-origin' })
    const received = Date.now()
    if (!response.ok) return
    const body = await response.json() as { checkedAt?: string }
    const sample = body.checkedAt ? estimateOffset(sent, received, body.checkedAt) : null
    if (sample) { current = sample; for (const listener of listeners) listener(current) }
  } catch { /* sem rede: mantém a última medida */ }
}

/** Mede ao abrir e a cada minuto; uma medida compartilhada pela tela toda. */
export function useClockOffset(): ClockOffset | null {
  const [value, setValue] = useState<ClockOffset | null>(current)
  useEffect(() => {
    listeners.add(setValue)
    if (timer === null) { void measure(); timer = window.setInterval(() => void measure(), 60_000) }
    return () => { listeners.delete(setValue); if (!listeners.size && timer !== null) { window.clearInterval(timer); timer = null } }
  }, [])
  return value
}
