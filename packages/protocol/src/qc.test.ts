import { describe, expect, it } from 'vitest'
import { assessQc, DEFAULT_QC_PROFILE, qcApproved } from './qc.js'
import type { MediaAsset } from './media.js'
const video = { kind: 'VIDEO', durationNs: 10e9, probeError: null, probe: { width: 1920, height: 1080, codec: 'video/x-h264', rate: { num: 30000, den: 1001 }, interlaceMode: 'progressive', hasAudio: true }, loudnessFile: null } as MediaAsset
describe('perfil técnico de QC', () => {
  it('não inventa medição ausente; distingue aviso de obrigação configurada', () => {
    expect(assessQc(video).playable).toBe(true)
    expect(assessQc(video).warnings.join(' ')).toContain('não medida')
    expect(assessQc(video, { ...DEFAULT_QC_PROFILE, requireLoudness: true }).playable).toBe(false)
  })
  it('verifica codec, geometria, cadência fracionária, interlace, áudio e duração', () => {
    expect(assessQc(video, { ...DEFAULT_QC_PROFILE, codecs: ['video/x-h264'], width: 1920, height: 1080, fps: 29.97, scan: 'PROGRESSIVE', minDurationSeconds: 10, requireAudio: true }).errors).toEqual([])
    const invalid = { ...video, durationNs: 1e9, probe: { ...video.probe!, codec: null, width: 640, height: 360, hasAudio: false, interlaceMode: 'mixed' as const } }
    expect(assessQc(invalid, { ...DEFAULT_QC_PROFILE, codecs: ['video/x-h264'], width: 1920, height: 1080, fps: 25, scan: 'INTERLACED', requireAudio: true, minDurationSeconds: 5 }).errors).toHaveLength(7)
  })
  it('valida faixa de loudness/pico do original e estados que podem ir ao PGM', () => {
    const asset = { ...video, loudnessFile: { integratedLufs: -10, truePeakDbtp: 1, lra: 4, scope: 'FILE' as const, measuredAt: 'now' } }
    expect(assessQc(asset, { ...DEFAULT_QC_PROFILE, requireLoudness: true }).errors).toHaveLength(2)
    expect(qcApproved('APPROVED_WITH_NOTES')).toBe(true)
    for (const state of ['PENDING', 'ANALYSIS', 'REJECTED', 'FAILED', 'BLOCKED']) expect(qcApproved(state)).toBe(false)
  })
})
