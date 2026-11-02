import { describe, expect, it } from 'vitest'
import { monitorAudioStatistics } from './audio-analysis.js'
describe('medição de áudio do monitor', () => {
  it('mede canais separados e correlação real, não índices do espectro', () => {
    const result = monitorAudioStatistics(new Float32Array([0.5, -0.5]), new Float32Array([-0.25, 0.25]))
    expect(result.peakL).toBeCloseTo(-6.0206)
    expect(result.peakR).toBeCloseTo(-12.0412)
    expect(result.phase).toBe(-1)
    expect(monitorAudioStatistics(new Float32Array([1, -1]), new Float32Array([1, -1])).phase).toBe(1)
  })
  it('silêncio não inventa fase nem pico audível', () => {
    expect(monitorAudioStatistics(new Float32Array(4), new Float32Array(4))).toMatchObject({ peakL: -Infinity, peakR: -Infinity, phase: null, muted: 'LR', active: true })
    expect(monitorAudioStatistics(new Float32Array(), new Float32Array()).active).toBe(false)
  })
  it('com um canal mudo a correlação é indefinida (nunca "+1.00 positiva")', () => {
    const tone = Float32Array.from({ length: 480 }, (_, index) => 0.1 * Math.sin(index / 5))
    const result = monitorAudioStatistics(tone, new Float32Array(480))
    expect(result.phase).toBeNull()
    expect(result.muted).toBe('R')
    expect(result.peakR).toBe(-Infinity)
    expect(result.peakL).toBeCloseTo(-20, 0)
  })
})
