import type { Rate } from './rate.js'

export type SourceKind = 'SDI' | 'NDI' | 'SRT' | 'RTMP' | 'FILE' | 'SLATE'

export interface SourceRef {
  readonly kind: SourceKind
  /** Identificador dentro do tipo: índice do sub-dispositivo, nome NDI, URL. */
  readonly ref: string
  readonly label: string
}

/** `sdi:2` → { kind: 'SDI', ref: '2' }. Formato estável entre server e engine. */
export function parseSourceRef(value: string): { kind: SourceKind; ref: string } | null {
  const idx = value.indexOf(':')
  if (idx <= 0) return null
  const kind = value.slice(0, idx).toUpperCase()
  const ref = value.slice(idx + 1)
  const known: readonly string[] = ['SDI', 'NDI', 'SRT', 'RTMP', 'FILE', 'SLATE']
  if (!known.includes(kind)) return null
  return { kind: kind as SourceKind, ref }
}

export type EncoderKind = 'NVENC' | 'X264' | 'NONE'

/** Como a imagem é varrida. */
export type Scan = 'PROGRESSIVE' | 'INTERLACED'

/** Ordem dos campos. 1080i é TFF; só formatos SD antigos são BFF. */
export type FieldOrder = 'TFF' | 'BFF'

export interface OutputProfile {
  readonly id: string
  readonly channelId: string
  readonly name: string
  readonly kind: 'RTMP' | 'SRT' | 'SDI' | 'FILE'
  /** Destino: URL, ou id do sub-dispositivo Decklink. */
  readonly target: string
  readonly width: number
  readonly height: number
  /** Varredura desta saída. Pode diferir da do canal. */
  readonly scan: Scan
  readonly fieldOrder: FieldOrder
  readonly bitrateKbps: number
  readonly encoder: EncoderKind
  readonly gopFrames: number
  /**
   * Limiter ligado nesta saída. Desligue quando o destino já faz processamento
   * de loudness — limitar duas vezes piora o resultado.
   */
  readonly limiterEnabled: boolean
  readonly enabled: boolean
}

export interface Channel {
  readonly id: string
  readonly name: string
  readonly rate: Rate
  readonly width: number
  readonly height: number
  /**
   * Varredura da saída.
   *
   * Num canal entrelaçado, `rate` continua sendo a cadência de **quadros** --
   * 1080i5994 é 29,97 quadros e 59,94 campos --, e é essa que a grade conta. A
   * composição roda no dobro, dentro do engine, e esse número não sai de lá.
   */
  readonly scan: Scan
  readonly fieldOrder: FieldOrder

  /** Alvo de loudness: -23 LUFS para TV, -14 para plataformas. */
  readonly targetLufs: number
  /** Teto de true peak do limiter, em dBTP. */
  readonly ceilingDbtp: number
  /** Look-ahead do limiter, compensado por delay igual no vídeo. */
  readonly limiterLookaheadMs: number

  /** Sub-dispositivo Decklink de saída, quando existe. Define o clock mestre. */
  readonly programSdiDeviceId: string | null
  /** Arte de apresentação técnica, quando nada está no ar. Nulo deixa no preto. */
  readonly slateTemplateId: string | null
  readonly createdAt: string
}

/**
 * De onde vem o relógio do canal. Com saída SDI, a placa é o mestre; sem ela,
 * sobra o relógio do sistema.
 */
export type ClockSource = 'DECKLINK' | 'SYSTEM'

export const clockSource = (channel: Pick<Channel, 'programSdiDeviceId'>): ClockSource =>
  channel.programSdiDeviceId ? 'DECKLINK' : 'SYSTEM'

/**
 * Nome do formato como se fala em broadcast: `1080i5994`, `1080p50`, `720p2997`.
 *
 * A armadilha está no `i`: o número que acompanha é a cadência de **campos**,
 * não de quadros. 1080i5994 são 29,97 quadros por segundo -- que é o que o
 * canal guarda em `rate` e o que a grade conta -- e 59,94 campos. Escrever
 * "1080i2997" seria tecnicamente coerente e ninguém do mercado entenderia.
 */
export function formatVideoFormat(
  channel: Pick<Channel, 'height' | 'rate' | 'scan'>,
): string {
  const interlaced = channel.scan === 'INTERLACED'
  const num = interlaced ? channel.rate.num * 2 : channel.rate.num
  const fps = num / channel.rate.den

  // NTSC fracionário vira o número sem vírgula, como o mercado escreve.
  const label =
    channel.rate.den === 1001
      ? String(Math.round(fps * 100))
      : String(Math.round(fps))

  return `${channel.height}${interlaced ? 'i' : 'p'}${label}`
}
