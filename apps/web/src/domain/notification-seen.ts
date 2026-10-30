/** "Visto" por estação: silencia o som local de uma pendência. Não vai ao
 * servidor e não é ciente. Chave = id + horário (os ids de sinal são reaproveitados). */
export interface SeenStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
const STORAGE_KEY = 'rplayout.notifications.seen'
const MAX_SEEN = 200

export const seenKey = (n: { id: string; occurredAt: string }): string => `${n.id}|${n.occurredAt}`

export function readSeen(storage: SeenStorage | null | undefined): Set<string> {
  try {
    const raw = storage?.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [])
  } catch { return new Set() }
}

/** Grava e devolve o conjunto novo; guarda só os mais recentes. Falha de storage não propaga. */
export function markSeen(storage: SeenStorage | null | undefined, key: string): Set<string> {
  const next = readSeen(storage); next.delete(key); next.add(key)
  const kept = [...next].slice(-MAX_SEEN)
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(kept)) } catch { /* sem storage: vale só até recarregar */ }
  return new Set(kept)
}

export function browserSeenStorage(): SeenStorage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null }
}
