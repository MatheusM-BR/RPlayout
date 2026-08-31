import { describe, expect, it } from 'vitest'
import {
  computeAutoGain,
  effectiveGainDb,
  resolveAudio,
  resolveTrim,
  trimDuration,
  type AudioLevel,
  type LoudnessMeasurement,
  type MediaAsset,
} from './media.js'

const measurement = (
  integratedLufs: number,
  truePeakDbtp: number,
  scope: 'FILE' | 'TRIM' = 'FILE',
): LoudnessMeasurement => ({
  integratedLufs,
  lra: 6,
  truePeakDbtp,
  scope,
  measuredAt: '2026-08-31T00:00:00.000Z',
})

const asset = (overrides: Partial<MediaAsset> = {}): MediaAsset => ({
  id: 'asset-1',
  contentHash: 'a'.repeat(64),
  path: 'D:/media/vt.mxf',
  title: 'VT',
  kind: 'VIDEO',
  durationFrames: 5000,
  categoryId: null,
  defaultTrim: null,
  defaultAudio: null,
  loudnessFile: null,
  suggestedTrim: null,
  createdAt: '2026-08-31T00:00:00.000Z',
  ...overrides,
})

describe('ganho automático', () => {
  it('leva a loudness medida até o alvo do canal', () => {
    const gain = computeAutoGain(measurement(-18, -3), -23, -1)
    expect(gain.gainDb).toBe(-5)
    expect(gain.capped).toBe(false)
    expect(gain.projectedLufs).toBe(-23)
    expect(gain.projectedPeakDbtp).toBe(-8)
  })

  it('para no true peak quando o arquivo já vem quente, e diz por quê', () => {
    const gain = computeAutoGain(measurement(-30, -6), -23, -1)
    expect(gain.capped).toBe(true)
    expect(gain.gainDb).toBe(5)
    expect(gain.projectedPeakDbtp).toBe(-1)
    // Não chega no alvo: subir mais seria entregar o problema ao limiter.
    expect(gain.projectedLufs).toBe(-25)
    expect(gain.reason).toContain('quente')
  })

  it('sem medição não inventa ganho', () => {
    const gain = computeAutoGain(null, -23, -1)
    expect(gain.gainDb).toBe(0)
    expect(gain.reason).toContain('Sem medição')
  })

  it('atenua quando o arquivo já passa do ceiling', () => {
    const gain = computeAutoGain(measurement(-30, -0.5), -23, -1)
    expect(gain.gainDb).toBe(-0.5)
    expect(gain.capped).toBe(true)
  })
})

describe('ganho efetivo por modo', () => {
  const measured = measurement(-18, -3)

  it('OFF não mexe no áudio', () => {
    const audio: AudioLevel = { mode: 'OFF', gainDb: 9, measured }
    expect(effectiveGainDb(audio, -23, -1)).toBe(0)
  })

  it('MANUAL usa o que o operador digitou', () => {
    const audio: AudioLevel = { mode: 'MANUAL', gainDb: -2.5, measured }
    expect(effectiveGainDb(audio, -23, -1)).toBe(-2.5)
  })

  it('AUTO recalcula e ignora o ganho gravado', () => {
    const audio: AudioLevel = { mode: 'AUTO', gainDb: 99, measured }
    expect(effectiveGainDb(audio, -23, -1)).toBe(-5)
  })
})

describe('precedência do corte', () => {
  it('item ganha do padrão do asset', () => {
    const resolved = resolveTrim(
      { in: 100, out: 400 },
      asset({ defaultTrim: { in: 50, out: 4000 } }),
    )
    expect(resolved.source).toBe('ITEM')
    expect(trimDuration(resolved.value)).toBe(300)
  })

  it('sem corte no item, vale o padrão do asset', () => {
    const resolved = resolveTrim(null, asset({ defaultTrim: { in: 50, out: 4000 } }))
    expect(resolved.source).toBe('ASSET')
    expect(resolved.value).toEqual({ in: 50, out: 4000 })
  })

  it('sem nada, vale o arquivo inteiro', () => {
    const resolved = resolveTrim(null, asset())
    expect(resolved.source).toBe('FILE')
    expect(resolved.value).toEqual({ in: 0, out: 5000 })
  })
})

describe('precedência do nivelamento', () => {
  const itemAudio: AudioLevel = { mode: 'MANUAL', gainDb: -3, measured: null }
  const assetAudio: AudioLevel = { mode: 'AUTO', gainDb: 0, measured: measurement(-18, -3) }

  it('item ganha do padrão do asset', () => {
    const resolved = resolveAudio(itemAudio, asset({ defaultAudio: assetAudio }))
    expect(resolved.source).toBe('ITEM')
    expect(resolved.value.gainDb).toBe(-3)
  })

  it('sem nível no item, vale o padrão do asset', () => {
    const resolved = resolveAudio(null, asset({ defaultAudio: assetAudio }))
    expect(resolved.source).toBe('ASSET')
    expect(resolved.value.mode).toBe('AUTO')
  })

  it('sem padrão, anexa a medição do arquivo para o AUTO poder ser ligado', () => {
    const file = measurement(-20, -4)
    const resolved = resolveAudio(null, asset({ loudnessFile: file }))
    expect(resolved.source).toBe('FILE')
    expect(resolved.value.mode).toBe('OFF')
    expect(resolved.value.measured).toEqual(file)
  })

  it('AUTO herdado do acervo recebe a medição do arquivo', () => {
    const file = measurement(-19.8, -1.2)
    const semMedicao: AudioLevel = { mode: 'AUTO', gainDb: 0, measured: null }
    const resolved = resolveAudio(null, asset({ defaultAudio: semMedicao, loudnessFile: file }))
    expect(resolved.value.measured).toEqual(file)
    expect(effectiveGainDb(resolved.value, -23, -1)).toBe(-3.2)
  })

  it('sem medição nenhuma, a origem é NONE', () => {
    expect(resolveAudio(null, asset()).source).toBe('NONE')
  })
})
