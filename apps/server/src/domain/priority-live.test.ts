import { describe, expect, it } from 'vitest'
import { priorityLives } from './priority-live.js'
import type { RundownView } from './plan.js'
const today = new Date(2026,8,30,12,0,0).getTime()
function view(date = '2026-09-30') { return { channel: { rate: { num: 25, den: 1 } }, rundown: { id: 'grade', date }, items: [
  { item: { id: 'flow', type: 'LIVE', sourceRef: 'ndi:FLOW', anchor: { kind: 'FLOW' } } },
  { item: { id: 'future', type: 'LIVE', liveConfig: { sourceEndpoint: 'omt:FUTURE' }, anchor: { kind: 'HARD_TIME', at: 13*3600*25 } } },
  { item: { id: 'earlier', type: 'LIVE', liveEndpoint: 'srt://HOST', anchor: { kind: 'FIXED', at: 12*3600*25 } } },
  { item: { id: 'soft', type: 'LIVE', sourceRef: 'ndi:SOFT', anchor: { kind: 'SOFT', at: 10*3600*25 } } },
  { item: { id: 'vt', type: 'VT', anchor: { kind: 'HARD_TIME', at: 12*3600*25 } } },
] } as unknown as RundownView }
describe('âncoras prioritárias de live', () => {
  it('ordena apenas LIVE FIXED/HARD_TIME e resolve aliases de fonte sem alterar CUE', () => {
    const list = priorityLives(view(), today)
    expect(list.map(row => row.itemId)).toEqual(['earlier','future'])
    expect(list[0]?.atMs).toBe(today)
    expect(list[1]?.atMs).toBe(today+3_600_000)
  })
  it('mantém a data absoluta: a janela do transporte não deve disparar amanhã hoje ou repetir ontem', () => {
    const tomorrow = new Date(2026,9,1,12,0,0).getTime()
    expect(priorityLives(view('2026-10-01'), today)[0]?.atMs).toBe(tomorrow)
    expect(priorityLives(view(), tomorrow)[0]?.atMs).toBe(today)
    expect(priorityLives(view(), tomorrow).filter(anchor => anchor.atMs > tomorrow - 1000 && anchor.atMs <= tomorrow)).toEqual([])
  })
  it('conserva âncora >24h e sua identidade antes e depois da virada', () => {
    const grade = view()
    Object.assign(grade.items[2]!.item, {anchor:{kind:'FIXED',at:28*3600*25}})
    const previous = priorityLives(grade, today).find(row => row.itemId === 'earlier')!
    const next = priorityLives(grade, new Date(2026,9,1,4,0,0).getTime()).find(row => row.itemId === 'earlier')!
    expect(next.atMs).toBe(new Date(2026,9,1,4,0,0).getTime())
    expect(next).toEqual(previous)
  })
  it('não normaliza data impossível nem âncora negativa', () => {
    expect(priorityLives(view('2026-02-30'), today)).toEqual([])
    const grade = view(); Object.assign(grade.items[2]!.item, {anchor:{kind:'FIXED',at:-25}})
    expect(priorityLives(grade,today).map(row => row.itemId)).toEqual(['future'])
  })
})
