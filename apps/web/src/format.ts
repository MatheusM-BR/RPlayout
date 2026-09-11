import { formatClock, formatDuration, type Frames, type Rate } from '@rplayout/protocol'

export const clock = (frames: Frames, rate: Rate): string => formatClock(frames, rate)
export const dur = (frames: Frames, rate: Rate): string => formatDuration(frames, rate)

/** Ganho sempre com sinal: +2.0 e -3.2 lêem melhor do que 2 e -3.2. */
export const db = (value: number, digits = 1): string =>
  `${value > 0 ? '+' : ''}${value.toFixed(digits)}`

export const lufs = (value: number): string => value.toFixed(1)

/** Desvio em relação à âncora, já com o sinal que o operador espera ler. */
export function deviation(frames: Frames, rate: Rate): string {
  if (frames === 0) return 'no ponto'
  const sign = frames > 0 ? '+' : '−'
  return `${sign}${formatDuration(Math.abs(frames), rate)}`
}
