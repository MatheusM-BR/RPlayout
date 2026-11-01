import type { MonitorTier } from '@rplayout/protocol'

/**
 * Escolha de nível de um monitor do navegador e a troca automática por
 * qualidade da conexão, com histerese.
 *
 * Tudo aqui é puro (sem WebRTC nem DOM) para ser testado; o `Whep` só junta
 * as estatísticas do `RTCPeerConnection` e aplica a decisão.
 */

export type MonitorRole = 'pgm' | 'pvw' | 'qc' | 'multiview'
export const TIER_ORDER: readonly MonitorTier[] = ['lite', 'std', 'ref']
const rank = (tier: MonitorTier) => TIER_ORDER.indexOf(tier)

export interface ViewingContext {
  role: MonitorRole
  /** Largura do monitor na tela, em pixels CSS. */
  elementWidth: number
  /** `matchMedia('(pointer: coarse)')` ou user agent de celular. */
  mobile: boolean
  /** `navigator.connection` quando o navegador expõe. */
  effectiveType?: string | null
  saveData?: boolean
  downlinkMbps?: number | null
}

/**
 * Nível inicial pelo contexto.
 * - QC: REFERÊNCIA (é para julgar imagem).
 * - Celular, economia de dados, rede 2g/3g ou janela pequena: LEVE.
 * - PGM/PVW grandes na rede local: PADRÃO.
 */
export function initialTier(context: ViewingContext): MonitorTier {
  if (context.role === 'qc') return 'ref'
  const slow = context.saveData || (context.effectiveType != null && /(^|-)(2g|3g)$/.test(context.effectiveType)) || (context.downlinkMbps != null && context.downlinkMbps < 2)
  if (context.mobile || slow) return 'lite'
  if (context.role === 'multiview') return 'lite'
  return context.elementWidth >= 480 ? 'std' : 'lite'
}

/** Amostra de um segundo, já em taxas. */
export interface LinkSample {
  /** Fração de pacotes perdidos no intervalo (0–1). */
  loss: number
  /** Jitter de chegada RTP, ms. */
  jitterMs: number
  /** Fração de quadros descartados no intervalo (0–1). */
  dropped: number
  /** Quadros decodificados por segundo. */
  fps: number
  /** Cadência esperada do nível (0 = desconhecida). */
  expectedFps: number
  /** Banda disponível estimada (bps), quando o navegador expõe. */
  availableBps?: number | null
  /** Bitrate recebido no intervalo (bps). */
  receivedBps: number
  /** Atraso médio do jitter buffer no intervalo, ms. */
  jitterBufferMs?: number | null
}

/** Bitrate nominal de cada nível (teto), para comparar com a banda disponível. */
export const TIER_CEILING_BPS: Record<MonitorTier, number> = { ref: 8_000_000, std: 3_000_000, lite: 450_000 }

export function sampleIsBad(sample: LinkSample, tier: MonitorTier): boolean {
  if (sample.loss > 0.03) return true
  if (sample.jitterMs > 40) return true
  if (sample.dropped > 0.05) return true
  if (sample.expectedFps > 0 && sample.fps > 0 && sample.fps < sample.expectedFps * 0.8) return true
  if (sample.availableBps != null && sample.availableBps > 0 && sample.availableBps < sample.receivedBps * 1.1 && sample.availableBps < TIER_CEILING_BPS[tier]) return true
  return false
}

export function sampleIsGood(sample: LinkSample): boolean {
  return sample.loss < 0.005 && sample.jitterMs < 15 && sample.dropped < 0.01 && (sample.expectedFps <= 0 || sample.fps >= sample.expectedFps * 0.95)
}

export interface TierControllerOptions {
  /** Amostras ruins seguidas para descer. */
  downAfter?: number
  /** Amostras boas seguidas para subir. */
  upAfter?: number
  /** Depois de descer, quanto tempo sem tentar subir (amostras). */
  holdAfterDown?: number
}

/**
 * Controle automático com histerese: desce rápido (3 s ruins), sobe devagar
 * (15 s bons) e, depois de uma descida, espera 30 s antes de tentar de novo.
 * Nunca passa do teto (o nível que o contexto ou o operador escolheu).
 */
export class TierController {
  private bad = 0
  private good = 0
  private hold = 0
  private readonly downAfter: number
  private readonly upAfter: number
  private readonly holdAfterDown: number
  tier: MonitorTier

  constructor(public ceiling: MonitorTier, options: TierControllerOptions = {}) {
    this.tier = ceiling
    this.downAfter = options.downAfter ?? 3
    this.upAfter = options.upAfter ?? 15
    this.holdAfterDown = options.holdAfterDown ?? 30
  }

  setCeiling(ceiling: MonitorTier): void {
    this.ceiling = ceiling
    this.tier = ceiling
    this.bad = this.good = this.hold = 0
  }

  /** Alimenta uma amostra; devolve o nível novo quando muda. */
  push(sample: LinkSample): MonitorTier | null {
    if (this.hold > 0) this.hold -= 1
    if (sampleIsBad(sample, this.tier)) {
      this.good = 0
      this.bad += 1
      if (this.bad >= this.downAfter && rank(this.tier) > 0) {
        this.tier = TIER_ORDER[rank(this.tier) - 1]!
        this.bad = 0
        this.hold = this.holdAfterDown
        return this.tier
      }
      return null
    }
    this.bad = 0
    if (sampleIsGood(sample)) {
      this.good += 1
      if (this.good >= this.upAfter && this.hold === 0 && rank(this.tier) < rank(this.ceiling)) {
        this.tier = TIER_ORDER[rank(this.tier) + 1]!
        this.good = 0
        return this.tier
      }
    } else {
      this.good = 0
    }
    return null
  }
}

/** Contadores cumulativos do `inbound-rtp` de vídeo e do par de candidatos. */
export interface RawStats {
  at: number
  packetsReceived: number
  packetsLost: number
  jitter: number
  framesDecoded: number
  framesDropped: number
  framesReceived: number
  bytesReceived: number
  jitterBufferDelay: number
  jitterBufferEmittedCount: number
  totalDecodeTime: number
  freezeCount: number
  availableIncomingBitrate: number | null
  rttMs: number | null
  frameWidth: number
  frameHeight: number
}

/** Lê o que importa de um `RTCStatsReport` (ou qualquer iterável de stats). */
export function readRawStats(report: Iterable<Record<string, unknown>> | { forEach(cb: (value: Record<string, unknown>) => void): void }, at: number): RawStats | null {
  let video: Record<string, unknown> | null = null
  let pair: Record<string, unknown> | null = null
  const visit = (value: Record<string, unknown>) => {
    if (value.type === 'inbound-rtp' && (value.kind === 'video' || value.mediaType === 'video')) video = value
    if (value.type === 'candidate-pair' && (value.nominated || value.selected) && value.state === 'succeeded') pair = value
  }
  if ('forEach' in report) report.forEach(visit)
  else for (const value of report) visit(value)
  if (!video) return null
  const v = video as Record<string, unknown>, p = pair as Record<string, unknown> | null
  const n = (key: string, from: Record<string, unknown> | null = v) => (typeof from?.[key] === 'number' ? (from[key] as number) : 0)
  return {
    at,
    packetsReceived: n('packetsReceived'), packetsLost: n('packetsLost'), jitter: n('jitter'),
    framesDecoded: n('framesDecoded'), framesDropped: n('framesDropped'), framesReceived: n('framesReceived'),
    bytesReceived: n('bytesReceived'), jitterBufferDelay: n('jitterBufferDelay'), jitterBufferEmittedCount: n('jitterBufferEmittedCount'),
    totalDecodeTime: n('totalDecodeTime'), freezeCount: n('freezeCount'),
    availableIncomingBitrate: p && typeof p.availableIncomingBitrate === 'number' ? (p.availableIncomingBitrate as number) : null,
    rttMs: p && typeof p.currentRoundTripTime === 'number' ? (p.currentRoundTripTime as number) * 1000 : null,
    frameWidth: n('frameWidth'), frameHeight: n('frameHeight'),
  }
}

/** O que a tela técnica mostra de cada monitor aberto. */
export interface MonitorStats {
  fps: number
  dropped: number
  droppedTotal: number
  jitterMs: number
  jitterBufferMs: number | null
  decodeMs: number | null
  kbps: number
  loss: number
  width: number
  height: number
  freezeCount: number
  rttMs: number | null
  availableKbps: number | null
}

export function deriveStats(prev: RawStats, curr: RawStats, expectedFps: number): { stats: MonitorStats; sample: LinkSample } {
  const seconds = Math.max(0.001, (curr.at - prev.at) / 1000)
  const packets = Math.max(0, curr.packetsReceived - prev.packetsReceived)
  const lost = Math.max(0, curr.packetsLost - prev.packetsLost)
  const decoded = Math.max(0, curr.framesDecoded - prev.framesDecoded)
  const dropped = Math.max(0, curr.framesDropped - prev.framesDropped)
  const emitted = curr.jitterBufferEmittedCount - prev.jitterBufferEmittedCount
  const bps = Math.max(0, curr.bytesReceived - prev.bytesReceived) * 8 / seconds
  const loss = packets + lost > 0 ? lost / (packets + lost) : 0
  const jitterBufferMs = emitted > 0 ? ((curr.jitterBufferDelay - prev.jitterBufferDelay) / emitted) * 1000 : null
  const decodeMs = decoded > 0 ? ((curr.totalDecodeTime - prev.totalDecodeTime) / decoded) * 1000 : null
  const fps = decoded / seconds
  const stats: MonitorStats = {
    fps, dropped: dropped / seconds, droppedTotal: curr.framesDropped, jitterMs: curr.jitter * 1000, jitterBufferMs, decodeMs,
    kbps: bps / 1000, loss, width: curr.frameWidth, height: curr.frameHeight, freezeCount: curr.freezeCount, rttMs: curr.rttMs,
    availableKbps: curr.availableIncomingBitrate != null ? curr.availableIncomingBitrate / 1000 : null,
  }
  const sample: LinkSample = {
    loss, jitterMs: curr.jitter * 1000, dropped: decoded + dropped > 0 ? dropped / (decoded + dropped) : 0,
    fps, expectedFps, availableBps: curr.availableIncomingBitrate, receivedBps: bps, jitterBufferMs,
  }
  return { stats, sample }
}

// ---------------------------------------------------------------------------
// Relógio de teste: a faixa que o engine grava no alto da imagem.
// Mesmo desenho de apps/engine/src/monitor.rs (`stamp_i420`).
// ---------------------------------------------------------------------------

export const CLOCK_BITS = 42
export const CLOCK_BLOCKS = CLOCK_BITS + 4

export function clockBlock(width: number, height: number): number {
  const b = Math.min(Math.floor(width / (CLOCK_BLOCKS + 2)), Math.floor(height / 10))
  return Math.max(4, b - (b % 2))
}

/**
 * Lê o horário (ms, módulo 2^42) de pixels RGBA da faixa. `rgba` cobre o
 * retângulo [0, width) × [0, rows) da imagem no tamanho nativo do vídeo.
 */
export function readClockRgba(rgba: Uint8ClampedArray | Uint8Array, stride: number, width: number, height: number): number | null {
  const block = clockBlock(width, height)
  const bit = (index: number): boolean | null => {
    const x = index * block + (block >> 1), y = block >> 1
    const offset = (y * stride + x) * 4
    if (offset + 2 >= rgba.length) return null
    const luma = 0.2126 * rgba[offset]! + 0.7152 * rgba[offset + 1]! + 0.0722 * rgba[offset + 2]!
    return luma > 126
  }
  const last = CLOCK_BLOCKS - 1
  if (bit(0) !== true || bit(1) !== false || bit(last - 1) !== false || bit(last) !== true) return null
  let ms = 0
  for (let i = 0; i < CLOCK_BITS; i++) {
    const value = bit(i + 2)
    if (value === null) return null
    ms = ms * 2 + (value ? 1 : 0)
  }
  return ms
}

/** Atraso de vidro a vidro: horário de exibição menos o horário gravado. */
export function glassToGlassMs(stampMs: number, displayWallMs: number): number {
  const mod = 2 ** CLOCK_BITS
  let delta = (displayWallMs % mod) - stampMs
  if (delta < -mod / 2) delta += mod
  return delta
}
