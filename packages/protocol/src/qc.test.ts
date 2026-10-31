import { describe, expect, it } from 'vitest'
import { assessQc, DEFAULT_QC_PROFILE, defaultQcProfileFor, qcApproved } from './qc.js'
import { effectiveFieldOrder } from './channel.js'
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
  describe('avisos sempre calculados (A2)',()=>{
    const channel={width:1920,height:1080,rate:{num:30000,den:1001},scan:'PROGRESSIVE' as const,audioChannels:2}
    const measured=(integratedLufs:number,truePeakDbtp:number)=>({...video,contentHash:'h',probe:{...video.probe!,audioChannels:2},loudnessFile:{integratedLufs,truePeakDbtp,lra:3,scope:'FILE' as const,measuredAt:'2026-10-08T12:00:00Z',input:{contentHash:'h',audioTrack:0,routing:{mode:'DEFAULT' as const}}}})
    it('loudness/TP fora da faixa avisa mesmo com requireLoudness=false, sem bloquear',()=>{
      const loud=assessQc(measured(2.3,-1.08))
      expect(loud.playable).toBe(true)
      expect(loud.warnings.some(w=>w.includes('2.3 LUFS fora da faixa -25 a -21'))).toBe(true)
      const quiet=assessQc(measured(-41.1,-40.6))
      expect(quiet.warnings.some(w=>w.includes('-41.1 LUFS fora da faixa'))).toBe(true)
      const peak=assessQc(measured(-23,-0.2))
      expect(peak.warnings.some(w=>w.includes('True peak -0.2 dBTP excede -1'))).toBe(true)
      expect(assessQc(measured(-23,-3),DEFAULT_QC_PROFILE,channel).warnings).toEqual([])
    })
    it('com requireLoudness=true continua erro, sem duplicar em aviso',()=>{
      const r=assessQc(measured(2.3,-1.08),{...DEFAULT_QC_PROFILE,requireLoudness:true})
      expect(r.errors).toHaveLength(1);expect(r.warnings.filter(w=>w.includes('LUFS'))).toEqual([])
    })
    it('silêncio do arquivo (gate) vira aviso de mudo',()=>{
      const r=assessQc(measured(-70,-90),DEFAULT_QC_PROFILE,channel)
      expect(r.warnings.join(' ')).toContain('mudo')
      expect(r.warnings.join(' ')).not.toContain('fora da faixa')
    })
    it('compara cadência, raster, varredura e canais de áudio com o canal',()=>{
      const sd={...measured(-23,-3),probe:{...video.probe!,width:720,height:480,rate:{num:15000,den:1001},interlaceMode:'interleaved' as const,audioChannels:1}}
      const w=assessQc(sd,DEFAULT_QC_PROFILE,channel).warnings.join('\n')
      expect(w).toContain('Cadência 14,985 fps difere do canal (29,97 fps)')
      expect(w).toContain('Raster 720x480 difere do canal (1920x1080)')
      expect(w).toContain('num canal progressivo')
      expect(w).toContain('1 canal(is)')
      expect(assessQc(sd,DEFAULT_QC_PROFILE,channel).playable).toBe(true)
      const p25={...measured(-23,-3),probe:{...video.probe!,audioChannels:2,rate:{num:25,den:1}}}
      expect(assessQc(p25,DEFAULT_QC_PROFILE,channel).warnings).toEqual(['Cadência 25 fps difere do canal (29,97 fps): haverá conversão de cadência.'])
      // Restrição explícita do perfil continua erro, sem aviso duplicado.
      const strict=assessQc(p25,{...DEFAULT_QC_PROFILE,fps:29.97},channel)
      expect(strict.errors).toContain('Cadência exigida: 29.97 fps.');expect(strict.warnings).toEqual([])
    })
    it('perfil padrão deriva a faixa do alvo do canal; progressivo não exibe ordem de campos (B5)',()=>{
      expect(defaultQcProfileFor(-23)).toMatchObject({minLufs:-25,maxLufs:-21})
      expect(defaultQcProfileFor(-14)).toMatchObject({minLufs:-16,maxLufs:-12,requireLoudness:false})
      expect(defaultQcProfileFor(NaN)).toBe(DEFAULT_QC_PROFILE)
      expect(effectiveFieldOrder({scan:'PROGRESSIVE',fieldOrder:'TFF'})).toBeNull()
      expect(effectiveFieldOrder({scan:'INTERLACED',fieldOrder:'BFF'})).toBe('BFF')
    })
  })
})
