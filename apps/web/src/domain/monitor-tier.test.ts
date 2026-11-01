import { describe, expect, it } from 'vitest'
import { TierController, initialTier, sampleIsBad, deriveStats, readRawStats, readClockRgba, clockBlock, CLOCK_BITS, CLOCK_BLOCKS, glassToGlassMs, type LinkSample, type RawStats } from './monitor-tier.js'

const good: LinkSample = { loss: 0, jitterMs: 3, dropped: 0, fps: 50, expectedFps: 50, receivedBps: 4_000_000, availableBps: null }
const bad: LinkSample = { ...good, loss: 0.08 }

describe('nível inicial pelo contexto', () => {
  it('QC é REFERÊNCIA; PGM/PVW grandes na LAN são PADRÃO; celular e rede ruim são LEVE', () => {
    expect(initialTier({ role: 'qc', elementWidth: 300, mobile: true })).toBe('ref')
    expect(initialTier({ role: 'pgm', elementWidth: 960, mobile: false })).toBe('std')
    expect(initialTier({ role: 'pvw', elementWidth: 360, mobile: false })).toBe('lite')
    expect(initialTier({ role: 'pgm', elementWidth: 1200, mobile: true })).toBe('lite')
    expect(initialTier({ role: 'pgm', elementWidth: 1200, mobile: false, effectiveType: '3g' })).toBe('lite')
    expect(initialTier({ role: 'pgm', elementWidth: 1200, mobile: false, saveData: true })).toBe('lite')
    expect(initialTier({ role: 'pgm', elementWidth: 1200, mobile: false, effectiveType: '4g' })).toBe('std')
  })
})

describe('troca automática com histerese', () => {
  it('desce depois de 3 s ruins, não sobe antes de 30 s e sobe só após 15 s bons, até o teto', () => {
    const c = new TierController('ref')
    expect(c.push(bad)).toBeNull()
    expect(c.push(bad)).toBeNull()
    expect(c.push(bad)).toBe('std')
    for (let i = 0; i < 29; i++) expect(c.push(good)).toBeNull()
    expect(c.push(good)).toBe('ref')
    for (let i = 0; i < 40; i++) expect(c.push(good)).toBeNull()
    expect(c.tier).toBe('ref')
  })

  it('uma amostra ruim no meio zera a contagem; oscilação curta não troca de nível', () => {
    const c = new TierController('std')
    for (let i = 0; i < 20; i++) { expect(c.push(bad)).toBe(i % 2 === 1 ? null : null); expect(c.push(good)).toBeNull() }
    expect(c.tier).toBe('std')
  })

  it('não desce abaixo do leve', () => {
    const c = new TierController('lite')
    for (let i = 0; i < 10; i++) expect(c.push(bad)).toBeNull()
    expect(c.tier).toBe('lite')
  })

  it('banda disponível menor que a recebida conta como ruim; quadros abaixo de 80% também', () => {
    expect(sampleIsBad({ ...good, availableBps: 3_000_000, receivedBps: 4_000_000 }, 'ref')).toBe(true)
    expect(sampleIsBad({ ...good, fps: 30 }, 'ref')).toBe(true)
    expect(sampleIsBad({ ...good, dropped: 0.1 }, 'ref')).toBe(true)
    expect(sampleIsBad(good, 'ref')).toBe(false)
  })
})

describe('estatísticas do WebRTC', () => {
  const raw = (patch: Partial<RawStats>): RawStats => ({ at: 0, packetsReceived: 0, packetsLost: 0, jitter: 0, framesDecoded: 0, framesDropped: 0, framesReceived: 0, bytesReceived: 0, jitterBufferDelay: 0, jitterBufferEmittedCount: 0, totalDecodeTime: 0, freezeCount: 0, availableIncomingBitrate: null, rttMs: null, frameWidth: 1920, frameHeight: 1080, ...patch })
  it('converte contadores cumulativos em taxas por segundo', () => {
    const { stats, sample } = deriveStats(raw({}), raw({ at: 1000, packetsReceived: 990, packetsLost: 10, framesDecoded: 50, framesDropped: 0, bytesReceived: 500_000, jitterBufferDelay: 2.5, jitterBufferEmittedCount: 50, totalDecodeTime: 0.2, jitter: 0.004 }), 50)
    expect(stats.fps).toBe(50)
    expect(stats.kbps).toBe(4000)
    expect(stats.jitterBufferMs).toBe(50)
    expect(stats.decodeMs).toBeCloseTo(4)
    expect(sample.loss).toBeCloseTo(0.01)
    expect(sample.jitterMs).toBeCloseTo(4)
  })
  it('lê inbound-rtp de vídeo e o par de candidatos escolhido', () => {
    const report = new Map<string, Record<string, unknown>>([
      ['a', { type: 'inbound-rtp', kind: 'audio', packetsReceived: 5 }],
      ['v', { type: 'inbound-rtp', kind: 'video', packetsReceived: 7, framesDecoded: 3, frameWidth: 1280, frameHeight: 720 }],
      ['p', { type: 'candidate-pair', nominated: true, state: 'succeeded', availableIncomingBitrate: 9_000_000, currentRoundTripTime: 0.002 }],
    ])
    const out = readRawStats(report, 10)!
    expect(out).toMatchObject({ packetsReceived: 7, framesDecoded: 3, frameWidth: 1280, availableIncomingBitrate: 9_000_000, rttMs: 2 })
    expect(readRawStats(new Map(), 0)).toBeNull()
  })
})

describe('relógio de teste gravado na imagem', () => {
  /** Mesmo desenho do engine (stamp_i420), em RGBA. */
  function stamp(width: number, height: number, ms: number): Uint8ClampedArray {
    const rgba = new Uint8ClampedArray(width * height * 4).fill(90)
    const block = clockBlock(width, height)
    for (let index = 0; index < CLOCK_BLOCKS; index++) {
      const white = index === 0 || index === CLOCK_BLOCKS - 1 ? true : index === 1 || index === CLOCK_BLOCKS - 2 ? false : Math.floor(ms / 2 ** (CLOCK_BITS - 1 - (index - 2))) % 2 === 1
      for (let y = 0; y < block; y++) for (let x = index * block; x < (index + 1) * block; x++) rgba.fill(white ? 235 : 16, (y * width + x) * 4, (y * width + x) * 4 + 3)
    }
    return rgba
  }
  it('lê de volta o horário gravado em cada nível', () => {
    for (const [w, h] of [[428, 240], [960, 540], [1280, 720], [1920, 1080]] as const) {
      const ms = 1_761_926_400_123 % 2 ** CLOCK_BITS
      expect(readClockRgba(stamp(w, h, ms), w, w, h)).toBe(ms)
    }
    expect(readClockRgba(new Uint8ClampedArray(428 * 240 * 4), 428, 428, 240)).toBeNull()
  })
  it('atraso de vidro a vidro atravessa a volta do módulo', () => {
    expect(glassToGlassMs(1000, 1180)).toBe(180)
    expect(glassToGlassMs(2 ** CLOCK_BITS - 50, 2 ** CLOCK_BITS + 70)).toBe(120)
  })
})
