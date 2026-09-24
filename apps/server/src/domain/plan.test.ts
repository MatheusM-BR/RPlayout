import { describe, expect, it } from 'vitest'
import type { Channel, MediaAsset, Rundown, RundownItem } from '@rplayout/protocol'
import { buildView } from './plan.js'

const channel = { id: 'ch', rate: { num: 25, den: 1 }, targetLufs: -23, ceilingDbtp: -1 } as Channel
const rundown = { id: 'r', channelId: 'ch', plannedStart: 0, loop: true } as Rundown
const item = (id: string): RundownItem => ({ id, rundownId: 'r', order: Number(id), title: id,
  type: 'VT', mediaId: id, sourceRef: null, trim: null, audio: null, durationOverride: 250,
  minDuration: 0, anchor: { kind: 'FLOW' }, onOverrun: 'PUSH', elastic: null, blockId: null,
  fit: 'PILLARBOX', audioTrack: null, locked: false, autoNext: true, loop: false, notes: null })

describe('planejamento com arquivos indisponíveis', () => {
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


