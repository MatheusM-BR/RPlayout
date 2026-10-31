import type {QcProfile} from '@rplayout/protocol'

/**
 * Loudness da escuta do QC (ITU-R BS.1770 / EBU Tech 3341) e apresentação
 * dos números do arquivo.
 *
 * O integrado (I), o true peak e o LRA do arquivo vêm do servidor, que mede o
 * original inteiro. Momentânea (M, 400 ms) e curta (S, 3 s) aqui são da
 * ESCUTA -- o áudio que o navegador está tocando, em geral o proxy AAC --, com
 * o filtro K da BS.1770 aplicado no próprio Web Audio. Servem para achar o
 * trecho alto, não para certificar o arquivo.
 */

/** Coeficientes do filtro K (dois biquads) para a taxa dada; iguais aos da BS.1770 em 48 kHz. */
export function kWeightingCoefficients(sampleRate: number): {shelf: {b: number[]; a: number[]}; highpass: {b: number[]; a: number[]}} {
  let f0 = 1681.974450955533, q = 0.7071752369554196
  const gain = 3.999843853973347
  let k = Math.tan(Math.PI * f0 / sampleRate)
  const vh = Math.pow(10, gain / 20), vb = Math.pow(vh, 0.4996667741545416)
  let a0 = 1 + k / q + k * k
  const shelf = {
    b: [(vh + vb * k / q + k * k) / a0, 2 * (k * k - vh) / a0, (vh - vb * k / q + k * k) / a0],
    a: [1, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0],
  }
  f0 = 38.13547087602444; q = 0.5003270373238773
  k = Math.tan(Math.PI * f0 / sampleRate)
  a0 = 1 + k / q + k * k
  const highpass = {b: [1, -2, 1], a: [1, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0]}
  return {shelf, highpass}
}

export function meanSquare(samples: Float32Array, count = samples.length): number {
  const start = Math.max(0, samples.length - count)
  let sum = 0
  for (let index = start; index < samples.length; index++) { const value = samples[index]!; if (Number.isFinite(value)) sum += value * value }
  return samples.length > start ? sum / (samples.length - start) : 0
}

/** Loudness de um par estéreo a partir das potências médias já filtradas por K. */
export function loudnessFromPower(power: number): number {
  return power > 0 ? -0.691 + 10 * Math.log10(power) : -Infinity
}

/** Curta (3 s) a partir das leituras momentâneas recentes: média das potências. */
export class ShortTermLoudness {
  private readings: Array<{at: number; power: number}> = []
  push(at: number, power: number) {
    this.readings.push({at, power})
    while (this.readings.length && at - this.readings[0]!.at > 3000) this.readings.shift()
  }
  reset() { this.readings = [] }
  /** Só responde com pelo menos ~2,6 s de leituras: antes disso não é S. */
  value(): number | null {
    if (this.readings.length < 2 || this.readings.at(-1)!.at - this.readings[0]!.at < 2600) return null
    return loudnessFromPower(this.readings.reduce((sum, reading) => sum + reading.power, 0) / this.readings.length)
  }
}

/** Abaixo do gate absoluto (−70 LUFS) o integrado não existe. */
export const ABSOLUTE_GATE_LUFS = -70

export function formatLoudness(value: number | null | undefined, unit = 'LUFS'): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  if (value === -Infinity) return `−∞ ${unit}`
  if (value < ABSOLUTE_GATE_LUFS) return `< −70 ${unit}`
  return `${value.toFixed(1).replace('-', '−')} ${unit}`
}

/** Integrado do arquivo: −70 é o piso do medidor, não uma medida. */
export function formatFileIntegrated(value: number | null | undefined, compact = false): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return value <= ABSOLUTE_GATE_LUFS + 0.05 ? (compact ? '−∞ LUFS' : '−∞ · abaixo do gate') : formatLoudness(value)
}

/** True peak/pico: o servidor devolve −90 para silêncio digital. */
export function formatPeak(value: number | null | undefined, unit: string): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—'
  if (value === -Infinity || value <= -89.9) return `−∞ ${unit}`
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(1)} ${unit}`
}

export type QcTone = 'ok' | 'warn' | 'bad' | 'none'
/** Integrado dentro/fora da faixa do perfil de QC do canal (ex.: −25..−21). */
export function loudnessTone(value: number | null | undefined, profile: Pick<QcProfile, 'minLufs' | 'maxLufs'>): QcTone {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'none'
  if (value <= ABSOLUTE_GATE_LUFS + 0.05) return 'warn'
  return value >= profile.minLufs && value <= profile.maxLufs ? 'ok' : 'warn'
}
/** True peak acima do teto do perfil é vermelho. */
export function truePeakTone(value: number | null | undefined, profile: Pick<QcProfile, 'maxTruePeakDbtp'>): QcTone {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'none'
  return value <= profile.maxTruePeakDbtp ? 'ok' : 'bad'
}
export const TONE_CLASS: Record<QcTone, string> = {
  ok: 'text-status-ok-bright', warn: 'text-armed-amber', bad: 'text-on-air-crimson', none: 'text-outline',
}
