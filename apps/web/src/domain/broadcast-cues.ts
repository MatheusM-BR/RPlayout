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
