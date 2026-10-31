import { describe, expect, it } from 'vitest'
import type { Channel, MediaAsset, Rundown, RundownItem } from '@rplayout/protocol'
import { buildView,assertTrimAudio } from './plan.js'

const channel = { id: 'ch', rate: { num: 25, den: 1 }, targetLufs: -23, ceilingDbtp: -1 } as Channel
const rundown = { id: 'r', channelId: 'ch', plannedStart: 0, loop: true } as Rundown
const item = (id: string): RundownItem => ({ id, rundownId: 'r', order: Number(id), title: id,
  type: 'VT', mediaId: id, sourceRef: null, trim: null, audio: null, durationOverride: 250,
  minDuration: 0, anchor: { kind: 'FLOW' }, onOverrun: 'PUSH', elastic: null, blockId: null,
  fit: 'PILLARBOX', audioTrack: null, locked: false, autoNext: true, loop: false, notes: null })

describe('planejamento com arquivos indisponíveis', () => {
  it('TRIM AUTO calcula ganho no corte vinculado e não aceita outra duração operacional',()=>{
    const routing={mode:'STEREO_1_2' as const},audio={mode:'AUTO' as const,gainDb:0,analysisId:'job',routing,measured:{scope:'TRIM' as const,integratedLufs:-28,lra:2,truePeakDbtp:-6,measuredAt:new Date().toISOString(),input:{contentHash:'hash',audioTrack:0,routing,trim:{inNs:1e9,outNs:3e9}}}}
    const asset={id:'asset',contentHash:'hash',kind:'VIDEO',durationFrames:250,durationNs:10e9,defaultTrim:null,defaultAudio:null,probeError:null} as MediaAsset
    const selected={...item('1'),mediaId:'asset',trim:{in:25,out:75},durationOverride:null,audio}
    const view=buildView(rundown,channel,[selected],new Map([['asset',asset]]),null,null)
    expect(view.items[0]?.gainDb).toBe(5);expect(view.schedule.items[0]?.state).not.toBe('DROPPED')
    expect(()=>assertTrimAudio(view.items[0]!,{in:25,out:100},channel.rate)).toThrow('medição de áudio')
    const changed=buildView(rundown,channel,[{...selected,durationOverride:75}],new Map([['asset',asset]]),null,null)
    expect(changed.schedule.items[0]?.state).toBe('DROPPED');expect(changed.schedule.conflicts.some(row=>row.message.includes('medição de áudio'))).toBe(true)
  })
  it('usa duração nativa montada no PGM sem alterar o corte editorial',()=>{
    const asset={id:'asset',kind:'VIDEO',durationFrames:500,durationNs:null,defaultTrim:null,defaultAudio:null,probeError:null} as MediaAsset
    const value={...item('1'),mediaId:'asset',durationOverride:250,trim:{in:0,out:250}}
    const view=buildView(rundown,channel,[value],new Map([['asset',asset]]),50,{itemId:'1',startedAt:0,elapsed:50,mountedDuration:75})
    expect(view.schedule.items[0]).toMatchObject({duration:75,plannedDuration:250,mountedDuration:75})
    expect(view.items[0]?.trim).toEqual({in:0,out:250})
  })
  it('corte impossível é pulado sem reservar tempo ou mover o próximo FLOW',()=>{
    const asset={id:'asset',kind:'VIDEO',durationFrames:250,durationNs:null,defaultTrim:null,defaultAudio:null,probeError:null} as MediaAsset
    const broken={...item('1'),mediaId:'asset',durationOverride:300,elastic:{min:25,max:400}}
    const next={...item('2'),mediaId:'asset'}
    const view=buildView(rundown,channel,[broken,next],new Map([['asset',asset]]),null,null)
    expect(view.schedule.items[0]).toMatchObject({state:'DROPPED',duration:0})
    expect(view.schedule.items[1]).toMatchObject({start:0,duration:250})
    expect(view.schedule.conflicts.some(row=>row.kind==='MEDIA_UNAVAILABLE'&&row.itemId==='1')).toBe(true)
  })
  it('filler não fabrica tempo além do fim do arquivo e conserva gap para corrigir',()=>{
    const asset={id:'asset',kind:'VIDEO',durationFrames:250,durationNs:null,defaultTrim:null,defaultAudio:null,probeError:null} as MediaAsset
    const filler={...item('1'),mediaId:'asset',type:'FILLER' as const,durationOverride:50,trim:{in:25,out:75},elastic:{min:25,max:500}}
    const boundary={...item('2'),mediaId:'asset',anchor:{kind:'FIXED' as const,at:400}}
    const view=buildView(rundown,channel,[filler,boundary],new Map([['asset',asset]]),null,null)
    expect(view.schedule.items[0]?.duration).toBe(225)
    expect(view.schedule.conflicts.some(row=>row.frames>0)).toBe(true)
    expect(filler.elastic.max).toBe(500)
  })
  it('pula referências removidas e não reserva tempo inexistente', () => {
    const view = buildView(rundown, channel, [item('1'), item('2')], new Map(), null, null)
    expect(view.schedule.items.every((row) => row.state === 'DROPPED' && row.duration === 0)).toBe(true)
    expect(view.schedule.conflicts.filter((row) => row.kind === 'MEDIA_UNAVAILABLE')).toHaveLength(2)
  })
  it('preserva o item que já está no ar quando seu arquivo desaparece', () => {
    const asset = { id: '1', probeError: 'arquivo ausente', durationFrames: 250,
      durationNs: 10e9, defaultTrim: null, defaultAudio: null, loudnessFile: null } as MediaAsset
    const view = buildView(rundown, channel, [item('1')], new Map([['1', asset]]), 25,
      { itemId: '1', startedAt: 0, elapsed: 25 })
    expect(view.schedule.items[0]?.state).not.toBe('DROPPED')
    expect(view.schedule.conflicts.some((row) => row.kind === 'MEDIA_UNAVAILABLE')).toBe(false)
  })

  it('gera relatório de compensação com cascata de sacrifício e suporte a LIVE e HARD_TIME', () => {
    const liveItem: RundownItem = {
      ...item('live-1'),
      type: 'LIVE',
      eventType: 'LIVE',
      mediaId: null,
      sourceRef: 'srt://test:9000',
      liveConfig: {
        sourceType: 'SRT',
        sourceEndpoint: 'srt://test:9000',
        estimatedDuration: 500,
        autoFollowOnEnd: true,
      },
    }

    const fillerItem: RundownItem = {
      ...item('filler-1'),
      type: 'FILLER',
      eventType: 'FILLER',
      durationOverride: 200,
      minDuration: 50,
      elastic: { min: 50, max: 500 },
      mediaId: null,
    }

    const hardTimeItem: RundownItem = {
      ...item('hard-1'),
      eventType: 'HARD_TIME',
      anchor: { kind: 'HARD_TIME', at: 600 },
      durationOverride: 500,
      mediaId: null,
    }

    const view = buildView(
      { ...rundown, plannedStart: 0, loop: false },
      channel,
      [liveItem, fillerItem, hardTimeItem],
      new Map(),
      null,
      null,
    )

    expect(view.schedule.compensationReport).toBeDefined()
    expect(view.schedule.compensationReport?.actions.length).toBeGreaterThan(0)
    // O filler deve ter sido encolhido de 200 para 100 para o HARD_TIME entrar em 600 (live 500 + filler 100 = 600)
    const resolvedFiller = view.schedule.items.find((i) => i.id === 'filler-1')!
    expect(resolvedFiller.duration).toBe(100)
    const resolvedHard = view.schedule.items.find((i) => i.id === 'hard-1')!
    expect(resolvedHard.start).toBe(600)
  })
})


