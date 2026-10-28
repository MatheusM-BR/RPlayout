/** Sinais de master control calculados a partir do estado do PGM. */

export type FinalCount = 'last10' | 'last5' | null

/** Contagem final do item no ar: âmbar nos últimos 10 s, piscando nos últimos 5 s.
 * Só para itens de 30 s ou mais: num intervalo de vinhetas e spots curtos a
 * tela piscaria o tempo todo e o alarme perderia o sentido. */
export function finalCount(remainingFrames: number, fps: number, playing: boolean, overrunFrames: number, durationFrames = Infinity): FinalCount {
  if (!playing || overrunFrames > 0 || remainingFrames <= 0 || !(fps > 0) || durationFrames < 30 * fps) return null
  const seconds = remainingFrames / fps
  return seconds <= 5 ? 'last5' : seconds <= 10 ? 'last10' : null
}

/** Aviso de fim da grade (sem loop): 'warn' nos últimos 15 min, 'urgent' nos últimos 2. */
export function gradeEndWarning(endMs: number | null, nowMs: number): { level: 'warn' | 'urgent'; leftMs: number } | null {
  if (endMs === null || !Number.isFinite(endMs)) return null
  const leftMs = endMs - nowMs
  if (leftMs <= 0 || leftMs > 15 * 60_000) return null
  return { level: leftMs <= 120_000 ? 'urgent' : 'warn', leftMs }
}

export const mmss = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** Próximo compromisso de horário (âncora FIXED ou HARD_TIME) ainda por vir.
 * `startMs` é quando a grade resolvida vai de fato entrar; `deviationMs`
 * positivo é atraso em relação ao horário marcado. */
export interface NextFixed { itemId: string; title: string; kind: 'FIXED' | 'HARD_TIME'; atMs: number; leftMs: number; deviationMs: number; hit: boolean }
export function nextFixedCommitment(
  items: readonly { id: string; title: string; anchor: { kind: string; at?: number } }[],
  resolved: ReadonlyMap<string, { anchorHit: boolean; deviation: number }>,
  frameToMs: (frames: number) => number,
  nowMs: number,
): NextFixed | null {
  let best: NextFixed | null = null
  for (const item of items) {
    if ((item.anchor.kind !== 'FIXED' && item.anchor.kind !== 'HARD_TIME') || typeof item.anchor.at !== 'number') continue
    const atMs = frameToMs(item.anchor.at)
    if (!Number.isFinite(atMs) || atMs <= nowMs) continue
    if (best && atMs >= best.atMs) continue
    const row = resolved.get(item.id)
    const deviationMs = row ? frameToMs(row.deviation) - frameToMs(0) : 0
    best = { itemId: item.id, title: item.title, kind: item.anchor.kind, atMs, leftMs: atMs - nowMs, deviationMs, hit: row ? row.anchorHit : true }
  }
  return best
}

/** `HH:MM:SS` acima de uma hora, `MM:SS` abaixo. */
export const countdownText = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60
  const p = (n: number) => String(n).padStart(2, '0')
  return h ? `${p(h)}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`
}
