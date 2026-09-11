import type { Channel } from '@rplayout/protocol'

/**
 * Uma leitura do medidor, no formato que a interface desenha. Pico verdadeiro,
 * loudness em três janelas e a redução de ganho do limiter — que é a métrica
 * que diz se o nivelamento está funcionando.
 */
export interface MeterReading {
  readonly peakDbfs: readonly number[]
  readonly momentaryLufs: number
  readonly shortTermLufs: number
  readonly integratedLufs: number
  /** Faixa de loudness (EBU Tech 3342), em LU. Diz se o programa respira. */
  readonly rangeLu: number
  readonly truePeakDbtp: number
  /** Redução de ganho do limiter, em dB. Zero é o estado saudável. */
  readonly gainReductionDb: number
  /** Correlação de fase do estéreo. Negativo denuncia mono invertido. */
  readonly correlation: number
}

export const SILENCE: MeterReading = {
  peakDbfs: [-90, -90],
  momentaryLufs: -70,
  shortTermLufs: -70,
  integratedLufs: -70,
  rangeLu: 0,
  truePeakDbtp: -90,
  gainReductionDb: 0,
  correlation: 1,
}

/**
 * Medidor simulado para a F1, enquanto o engine não existe. Parte da loudness
 * real do arquivo somada ao ganho de nivelamento, então subir ou descer o
 * ganho na interface mexe no medidor — que é o que precisa ser validado agora.
 */
export function simulateMeter(
  channel: Channel,
  sourceLufs: number | null,
  sourceTruePeak: number | null,
  gainDb: number,
  phase: number,
): MeterReading {
  if (sourceLufs === null) return SILENCE

  const wobble = (offset: number, amount: number): number =>
    Math.sin(phase * 0.9 + offset) * amount + Math.sin(phase * 3.7 + offset) * (amount * 0.35)

  const levelled = sourceLufs + gainDb
  const momentary = levelled + wobble(0, 2.6)
  const shortTerm = levelled + wobble(1.3, 1.1)

  const peak = (sourceTruePeak ?? sourceLufs + 10) + gainDb
  const peakL = peak + wobble(0.4, 1.8)
  const peakR = peak + wobble(2.1, 1.8)
  const truePeak = Math.max(peakL, peakR)

  // O limiter só trabalha quando o pico passa do teto — e é exatamente isso
  // que a interface precisa mostrar como alerta.
  const gainReduction = Math.max(0, truePeak - channel.ceilingDbtp)

  return {
    peakDbfs: [
      Math.min(peakL, channel.ceilingDbtp),
      Math.min(peakR, channel.ceilingDbtp),
    ],
    momentaryLufs: momentary,
    shortTermLufs: shortTerm,
    integratedLufs: levelled,
    rangeLu: 0,
    truePeakDbtp: Math.min(truePeak, channel.ceilingDbtp),
    gainReductionDb: gainReduction,
    correlation: 0.82 + Math.sin(phase * 0.31) * 0.14,
  }
}
