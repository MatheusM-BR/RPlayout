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

export interface OutputProfile {
  readonly id: string
  readonly channelId: string
  readonly name: string
  readonly kind: 'RTMP' | 'SRT' | 'SDI' | 'FILE'
  /** Destino: URL, ou id do sub-dispositivo Decklink. */
  readonly target: string
  readonly width: number
  readonly height: number
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

  /** Alvo de loudness: -23 LUFS para TV, -14 para plataformas. */
  readonly targetLufs: number
  /** Teto de true peak do limiter, em dBTP. */
  readonly ceilingDbtp: number
  /** Look-ahead do limiter, compensado por delay igual no vídeo. */
  readonly limiterLookaheadMs: number

  /** Sub-dispositivo Decklink de saída, quando existe. Define o clock mestre. */
  readonly programSdiDeviceId: string | null
  readonly createdAt: string
}

/**
 * De onde vem o relógio do canal. Com saída SDI, a placa é o mestre; sem ela,
 * sobra o relógio do sistema.
 */
export type ClockSource = 'DECKLINK' | 'SYSTEM'

export const clockSource = (channel: Pick<Channel, 'programSdiDeviceId'>): ClockSource =>
  channel.programSdiDeviceId ? 'DECKLINK' : 'SYSTEM'
