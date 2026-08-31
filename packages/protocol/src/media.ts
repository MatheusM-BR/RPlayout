import type { Frames } from './rate.js'

/** Ponto de entrada e de saída, em frames, sobre a timeline do arquivo. */
export interface Trim {
  readonly in: Frames
  readonly out: Frames
}

export const trimDuration = (trim: Trim): Frames => Math.max(0, trim.out - trim.in)

export type LoudnessScope = 'FILE' | 'TRIM'

/** Resultado de uma análise EBU R128. */
export interface LoudnessMeasurement {
  /** Loudness integrada do programa, em LUFS. */
  readonly integratedLufs: number
  /** Loudness range — a faixa dinâmica, em LU. */
  readonly lra: number
  /** Pico verdadeiro, em dBTP, medido com oversampling. */
  readonly truePeakDbtp: number
  /** Se foi medido o arquivo inteiro ou só o trecho que vai ao ar. */
  readonly scope: LoudnessScope
  readonly measuredAt: string
}

export type AudioMode =
  /** Ganho calculado a partir da medição de loudness. */
  | 'AUTO'
  /** Ganho digitado pelo operador. */
  | 'MANUAL'
  /** Sem nivelamento — o arquivo vai ao ar como está. */
  | 'OFF'

export interface AudioLevel {
  readonly mode: AudioMode
  readonly gainDb: number
  readonly measured: LoudnessMeasurement | null
  /** Quais pares de canais SDI entram no mix. Vazio significa todos. */
  readonly channelMap?: readonly number[]
}

export const NO_AUDIO_LEVEL: AudioLevel = { mode: 'OFF', gainDb: 0, measured: null }

export type MediaKind = 'VIDEO' | 'AUDIO' | 'STILL'

export interface MediaAsset {
  readonly id: string
  /** SHA-256 do conteúdo: reconhece o mesmo arquivo renomeado ou movido. */
  readonly contentHash: string
  readonly path: string
  readonly title: string
  readonly kind: MediaKind
  readonly durationFrames: Frames
  readonly categoryId: string | null

  /** Corte padrão do acervo. Item novo criado a partir dele já nasce cortado. */
  readonly defaultTrim: Trim | null
  /** Nivelamento padrão do acervo. */
  readonly defaultAudio: AudioLevel | null
  /** Medição do arquivo inteiro, feita no ingest. */
  readonly loudnessFile: LoudnessMeasurement | null

  /** Pontas de preto e de silêncio detectadas, como sugestão de corte. */
  readonly suggestedTrim: Trim | null
  readonly createdAt: string
}

/** De onde veio o valor que está valendo — a interface mostra isso como selo. */
export type ValueSource = 'ITEM' | 'ASSET' | 'FILE' | 'NONE'

export interface Resolved<T> {
  readonly value: T
  readonly source: ValueSource
}

/** Precedência do corte: item > padrão do asset > arquivo inteiro. */
export function resolveTrim(
  itemTrim: Trim | null | undefined,
  asset: Pick<MediaAsset, 'defaultTrim' | 'durationFrames'>,
): Resolved<Trim> {
  if (itemTrim) return { value: itemTrim, source: 'ITEM' }
  if (asset.defaultTrim) return { value: asset.defaultTrim, source: 'ASSET' }
  return { value: { in: 0, out: asset.durationFrames }, source: 'FILE' }
}

/**
 * Precedência do nivelamento: item > padrão do asset > sem nivelamento.
 *
 * Quando cai no padrão do asset, a medição do arquivo é anexada — é ela que o
 * modo AUTO usa para calcular o ganho.
 */
export function resolveAudio(
  itemAudio: AudioLevel | null | undefined,
  asset: Pick<MediaAsset, 'defaultAudio' | 'loudnessFile'>,
): Resolved<AudioLevel> {
  // A medição do arquivo é do arquivo, não do nível. Um AUTO gravado sem
  // medição é um AUTO que ainda não sabe o que fazer — aqui ele passa a saber.
  const withMeasurement = (level: AudioLevel): AudioLevel =>
    level.measured ? level : { ...level, measured: asset.loudnessFile }

  if (itemAudio) return { value: withMeasurement(itemAudio), source: 'ITEM' }
  if (asset.defaultAudio) return { value: withMeasurement(asset.defaultAudio), source: 'ASSET' }
  return {
    value: withMeasurement(NO_AUDIO_LEVEL),
    source: asset.loudnessFile ? 'FILE' : 'NONE',
  }
}

export interface AutoGain {
  readonly gainDb: number
  /** true quando o true peak limitou o ganho antes de chegar no alvo. */
  readonly capped: boolean
  readonly projectedLufs: number
  readonly projectedPeakDbtp: number
  readonly reason: string | null
}

const round1 = (n: number): number => Math.round(n * 10) / 10

/**
 * Ganho estático para levar a loudness medida até o alvo do canal.
 *
 * O ganho é limitado pelo pico verdadeiro: se subir até o alvo estouraria o
 * ceiling, sobe só até onde dá e diz por quê. Empurrar o resto para o limiter
 * seria trocar um problema de gain staging por distorção.
 */
export function computeAutoGain(
  measured: LoudnessMeasurement | null,
  targetLufs: number,
  ceilingDbtp: number,
): AutoGain {
  if (!measured) {
    return {
      gainDb: 0,
      capped: false,
      projectedLufs: 0,
      projectedPeakDbtp: 0,
      reason: 'Sem medição de loudness — rode a análise antes de nivelar.',
    }
  }

  const desired = targetLufs - measured.integratedLufs
  const headroom = ceilingDbtp - measured.truePeakDbtp

  if (desired > headroom) {
    const gainDb = round1(headroom)
    return {
      gainDb,
      capped: true,
      projectedLufs: round1(measured.integratedLufs + gainDb),
      projectedPeakDbtp: round1(ceilingDbtp),
      reason:
        `O arquivo já vem quente: subir até ${targetLufs} LUFS passaria de ` +
        `${ceilingDbtp} dBTP. Ganho limitado a ${gainDb} dB.`,
    }
  }

  const gainDb = round1(desired)
  return {
    gainDb,
    capped: false,
    projectedLufs: round1(targetLufs),
    projectedPeakDbtp: round1(measured.truePeakDbtp + gainDb),
    reason: null,
  }
}

/** O ganho que o engine realmente aplica no `volume` daquele item. */
export function effectiveGainDb(
  audio: AudioLevel,
  targetLufs: number,
  ceilingDbtp: number,
): number {
  switch (audio.mode) {
    case 'OFF':
      return 0
    case 'MANUAL':
      return audio.gainDb
    case 'AUTO':
      return computeAutoGain(audio.measured, targetLufs, ceilingDbtp).gainDb
  }
}

/** Escopo de aplicação de uma edição de corte ou de nível. */
export type EditScope =
  /** Só este item do rundown. */
  | 'ITEM'
  /** Todos os itens que apontam para o mesmo arquivo, neste rundown. */
  | 'RUNDOWN'
  /** Todos os itens que apontam para o mesmo arquivo, em todos os rundowns. */
  | 'ALL_RUNDOWNS'
  /** Grava como padrão do acervo: item novo já nasce assim. */
  | 'ASSET_DEFAULT'
