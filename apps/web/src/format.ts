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

/** Formatação amigável de padrão broadcast (1080i59.94 / 1080p59.94). */
export function formatStandardRate(rate: Rate, scan?: string, height = 1080): string {
  const interlaced = scan === 'INTERLACED'
  const cadence = (rate.num / rate.den * (interlaced ? 2 : 1)).toFixed(2).replace(/\.00$/, '')
  return `${height}${interlaced ? 'i' : 'p'}${cadence}`
}

export function rateFpsLabel(rate: Rate, scan?: string): string {
  return formatStandardRate(rate, scan)
}

/** Data e hora local da estação para um instante ISO (registros guardam UTC). */
export function localDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleString('pt-BR', { hour12: false })
}

/** Data (AAAA-MM-DD) e hora (HH:MM) locais para filtrar registros em UTC. */
export function localParts(iso: string): { date: string; time: string } {
  const at = new Date(iso), two = (value: number) => String(value).padStart(2, '0')
  return { date: `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`, time: `${two(at.getHours())}:${two(at.getMinutes())}` }
}
