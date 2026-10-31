import {formatTimecode, parseTimecode, type Rate} from '@rplayout/protocol'

/** Drop-frame só existe em 29,97 e 59,94 (SMPTE ST 12-1); 23,976 conta sem drop. */
export function qcDropFrame(rate: Rate): boolean {
  return rate.den === 1001 && (Math.round(rate.num / rate.den) === 30 || Math.round(rate.num / rate.den) === 60)
}

/** TC do QC: HH:MM:SS:FF, com `;FF` em drop-frame. Índice de quadro a partir de 0. */
export function qcTimecode(frame: number, rate: Rate): string {
  if (!(rate.num > 0) || !(rate.den > 0) || !Number.isFinite(frame)) return '--:--:--:--'
  if (qcDropFrame(rate) || rate.den === 1) return formatTimecode(Math.max(0, Math.round(frame)), rate)
  // Não-inteiro sem drop (23,976 etc.): contagem nominal sem descarte.
  const nominal = Math.round(rate.num / rate.den), total = Math.max(0, Math.round(frame))
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(Math.floor(total / (nominal * 3600)))}:${pad(Math.floor(total / (nominal * 60)) % 60)}:${pad(Math.floor(total / nominal) % 60)}:${pad(total % nominal)}`
}

export function qcParseTimecode(text: string, rate: Rate): number | null {
  if (qcDropFrame(rate) || rate.den === 1) return parseTimecode(text, rate)
  const match = /^(\d{1,2}):(\d{1,2}):(\d{1,2})[:;.](\d{1,2})$/.exec(text.trim())
  if (!match) return null
  const nominal = Math.round(rate.num / rate.den), [hours, minutes, seconds, frames] = match.slice(1).map(Number) as [number, number, number, number]
  if (minutes > 59 || seconds > 59 || frames >= nominal) return null
  return ((hours * 60 + minutes) * 60 + seconds) * nominal + frames
}

/** Rótulo da cadência: "29,97 DF", "25", "23,976". */
export function qcRateLabel(rate: Rate): string {
  const fps = rate.num / rate.den
  const text = Number.isInteger(fps) ? String(fps) : fps.toFixed(3).replace(/0+$/, '').replace('.', ',')
  return `${text}${qcDropFrame(rate) ? ' DF' : ''}`
}

/** Quantidade de quadros de uma duração na cadência do arquivo. */
export function qcFrameCount(durationNs: number | null | undefined, rate: Rate): number | null {
  if (typeof durationNs !== 'number' || !Number.isFinite(durationNs) || durationNs <= 0 || !(rate.num > 0) || !(rate.den > 0)) return null
  return Math.max(1, Math.ceil(durationNs * rate.num / (rate.den * 1e9) - 1e-6))
}

/** Novo quadro após um passo, sempre dentro do arquivo. */
export function qcStepFrame(current: number, delta: number, total: number): number {
  return Math.max(0, Math.min(Math.max(0, total - 1), Math.round(current) + Math.round(delta)))
}
