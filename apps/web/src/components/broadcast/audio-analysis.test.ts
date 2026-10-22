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
    expect(monitorAudioStatistics(new Float32Array(4), new Float32Array(4))).toEqual({ peakL: -100, peakR: -100, phase: null, active: true })
    expect(monitorAudioStatistics(new Float32Array(), new Float32Array()).active).toBe(false)
  })
})
