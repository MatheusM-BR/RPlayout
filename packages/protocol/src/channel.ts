import { fps, type Rate } from './rate.js'

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

/**
 * Bitrate que um formato pede para não aparecer bloco na imagem.
 *
 * Um número fixo mente sobre o custo: 4 Mbps são folgados num 480p30 e ficam
 * pobres num 1080p50, que tem oito vezes mais pixels por segundo. A conta é a
 * clássica de bits por pixel: quanto pixel entra por segundo, vezes quanto bit
 * cada um custa.
 *
 * 0,08 bit por pixel é o que o x264 em `veryfast` -- que é o preset de quem
 * codifica ao vivo -- precisa para um conteúdo normal de TV não mostrar bloco
 * em movimento de câmera. Preset rápido paga em bitrate o que economiza em
 * CPU, e num playout a CPU é do ar.
 *
 * O piso de 2 Mbps existe porque abaixo disso nem um 360p se segura; o teto de
 * 25 Mbps porque acima disso a rede é o gargalo, não a imagem.
 */
export function suggestedBitrateKbps(
  width: number,
  height: number,
  rate: Rate,
): number {
  const pixelsPorSegundo = Math.max(1, width) * Math.max(1, height) * fps(rate)
  const kbps = (pixelsPorSegundo * 0.08) / 1000
  // Arredonda para múltiplo de 250: número redondo é o que alguém digita, e a
  // diferença é invisível na imagem.
  const redondo = Math.round(kbps / 250) * 250
  return Math.min(25_000, Math.max(2_000, redondo))
}

/**
 * Tamanho de um monitor: o do canal reduzido até caber em 480 de altura.
 *
 * Monitor é janela de navegador, não saída. A proporção do canal importa --
 * monitor esticado engana quem confere enquadramento --, mas a resolução não:
 * 1080p numa janela de trezentos pixels é banda e CPU jogadas fora nas duas
 * pontas, e com quatro canais abertos era o navegador que engasgava.
 *
 * Sai em números pares porque a subamostragem de croma do H.264 exige.
 */
export function monitorSize(width: number, height: number): [number, number] {
  const TETO = 480
  if (height <= TETO || height <= 0 || width <= 0) {
    return [width - (width % 2), height - (height % 2)]
  }
  // Arredonda para cima até o par seguinte: 1920x1080 em 480 de altura dá
  // 853,33, e o valor consagrado é 854. Arredondar para baixo daria 852, que
  // não está errado mas foge do número que todo mundo reconhece.
  const escalada = Math.ceil((width * TETO) / height)
  return [escalada + (escalada % 2), TETO]
}
