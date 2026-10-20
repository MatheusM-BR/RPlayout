import { describe, expect, it } from 'vitest'
import { assessQc, DEFAULT_QC_PROFILE, qcApproved } from './qc.js'
import type { MediaAsset } from './media.js'
const video = { kind: 'VIDEO', durationNs: 10e9, probeError: null, probe: { width: 1920, height: 1080, codec: 'video/x-h264', rate: { num: 30000, den: 1001 }, interlaceMode: 'progressive', hasAudio: true }, loudnessFile: null } as MediaAsset
describe('perfil técnico de QC', () => {
  it.each([
    ['sonda ausente',{probe:null}],
    ['duração desconhecida',{durationNs:null}],
    ['codec ausente',{probe:{...video.probe!,codec:null,audioChannels:2}}],
    ['áudio sem número de canais',{probe:{...video.probe!,audioChannels:0}}],
  ])('perfil rigoroso recusa %s; modo legado avisa sem inventar metadados',(_name,incomplete)=>{
    const asset={...video,...incomplete}
    expect(assessQc(asset,{...DEFAULT_QC_PROFILE,requireProbe:true}).playable).toBe(false)
    expect(assessQc(asset).playable).toBe(true)
  })
  it('sonda completa com ausência explícita de áudio atende perfil que permite silêncio',()=>{
    const asset={...video,probe:{...video.probe!,hasAudio:false,audioChannels:0}}
    expect(assessQc(asset,{...DEFAULT_QC_PROFILE,requireProbe:true}).playable).toBe(true)
    expect(assessQc(asset,{...DEFAULT_QC_PROFILE,requireProbe:true,requireAudio:true}).playable).toBe(false)
  })
  it.each([{num:0,den:0},{num:25,den:0},{num:NaN,den:1},{num:Infinity,den:1},{num:25,den:1.5}])('não libera cadência inválida como compatível: %s',rate=>{
    const asset={...video,probe:{...video.probe!,rate}}
    expect(assessQc(asset).playable).toBe(false)
    expect(assessQc(asset,{...DEFAULT_QC_PROFILE,fps:25}).errors).toContain('Cadência exigida: 25 fps.')
  })
  it.each([0,-1,NaN,Infinity])('não libera duração inválida: %s',durationNs=>{
    const asset={...video,durationNs}
    expect(assessQc(asset).playable).toBe(false)
    expect(assessQc(asset,{...DEFAULT_QC_PROFILE,minDurationSeconds:1}).playable).toBe(false)
  })
  it('não libera geometria zero/indefinida',()=>{
    expect(assessQc({...video,probe:{...video.probe!,width:0}}).playable).toBe(false)
    expect(assessQc({...video,probe:{...video.probe!,height:NaN}}).playable).toBe(false)
  })
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
    const asset = { ...video, loudnessFile: { integratedLufs: -10, truePeakDbtp: 1, lra: 4, scope: 'FILE' as const, measuredAt: '2026-10-08T12:00:00Z' } }
    expect(assessQc(asset, { ...DEFAULT_QC_PROFILE, requireLoudness: true }).errors).toHaveLength(2)
    expect(qcApproved('APPROVED_WITH_NOTES')).toBe(true)
    for (const state of ['PENDING', 'ANALYSIS', 'REJECTED', 'FAILED', 'BLOCKED']) expect(qcApproved(state)).toBe(false)
  })
  const measurement={integratedLufs:-23,truePeakDbtp:-3,lra:4,scope:'FILE' as const,measuredAt:'2026-10-08T12:00:00Z'}
  it.each([
    ['trecho',{scope:'TRIM' as const}],
    ['data ausente',{measuredAt:''}],
    ['LRA negativo',{lra:-1}],
    ['LRA NaN',{lra:NaN}],
    ['LUFS NaN',{integratedLufs:NaN}],
    ['true peak infinito',{truePeakDbtp:Infinity}],
    ['outra versão',{input:{contentHash:'other',audioTrack:0,routing:{mode:'DEFAULT' as const}}}],
  ])('exige medição válida do original, não %s',(_name,invalid)=>{
    const asset={...video,contentHash:'current',loudnessFile:{...measurement,...invalid}}
    expect(assessQc(asset,{...DEFAULT_QC_PROFILE,requireLoudness:true}).playable).toBe(false)
    expect(assessQc(asset).playable).toBe(true) // Optional measurement remains policy, not a forced channel change.
  })
  it('medição válida FILE da versão atual pode atender o perfil',()=>{
    const asset={...video,contentHash:'current',loudnessFile:{...measurement,input:{contentHash:'current',audioTrack:0,routing:{mode:'DEFAULT' as const}}}}
    expect(assessQc(asset,{...DEFAULT_QC_PROFILE,requireLoudness:true}).errors).toEqual([])
  })
})
