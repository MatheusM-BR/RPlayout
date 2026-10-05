import { describe, expect, it } from 'vitest'
import type { Channel, MediaAsset, Rundown, RundownItem } from '@rplayout/protocol'
import { buildView } from './plan.js'
import { cacheSequence } from './cache-plan.js'

const channel = { id: 'ch', rate: { num: 25, den: 1 }, targetLufs: -23, ceilingDbtp: -1 } as Channel
const rundown = { id: 'rd', channelId: 'ch', plannedStart: 0, loop: true } as Rundown
const item = (id: string): RundownItem => ({ id, rundownId: 'rd', order: Number(id), title: id, type: 'VT', mediaId: id, sourceRef: null, trim: null, audio: null, durationOverride: 250, minDuration: 0, anchor: { kind: 'FLOW' }, onOverrun: 'PUSH', elastic: null, blockId: null, fit: 'PILLARBOX', audioTrack: null, locked: false, autoNext: true, loop: false, notes: null })
const assets = new Map(['1','2','3'].map(id => [id, { id, path: `${id}.mp4`, contentHash: 'a'.repeat(64), kind: 'VIDEO', durationFrames: 250, defaultTrim: null, defaultAudio: null } as MediaAsset]))
const view = (items: RundownItem[]) => buildView(rundown,channel,items,assets,null,null)

describe('autonomia da sequência operacional', () => {
  it('começa no item no ar e desconta o cursor sem inventar repetição da grade', () => {
    const sequence = cacheSequence(view([item('1'),item('2'),item('3')]), { itemId:'2',elapsed:75 })
    expect(sequence.map(entry => [entry.asset?.id,entry.durationSeconds])).toEqual([['2',7],['3',10]])
    expect(cacheSequence(null,null)).toEqual([])
    expect(cacheSequence(view([item('1')]), { itemId:'removed',elapsed:0 })).toEqual([])
  })
  it('live interrompe prova de arquivo e parada manual limita a sequência', () => {
    const live = { ...item('2'), type: 'LIVE' as const, mediaId:null,sourceRef:'ndi:ESTÚDIO' }
    expect(cacheSequence(view([item('1'),live,item('3')]),null).map(entry => entry.asset?.id ?? null)).toEqual(['1',null,'3'])
    const manual = cacheSequence(view([{...item('1'),autoNext:false},item('2')]),null)
    expect(manual.map(entry => entry.asset?.id ?? null)).toEqual(['1',null])
  })
  it('lacuna entre âncoras não vira horas de arquivo disponível', () => {
    const sequence = cacheSequence(view([item('1'), {...item('2'), anchor:{kind:'FIXED',at:750}}]),null)
    expect(sequence.map(entry => [entry.asset?.id ?? null,entry.durationSeconds])).toEqual([['1',10],[null,20],['2',10]])
  })
})
