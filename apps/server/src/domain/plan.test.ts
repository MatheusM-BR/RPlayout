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
})

