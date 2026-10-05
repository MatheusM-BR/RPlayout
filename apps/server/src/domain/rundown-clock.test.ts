import { describe, expect, it } from 'vitest'
import { rundownClock, rundownFrames, rundownMidnight } from './rundown-clock.js'
import { buildView } from './plan.js'
import type { Channel, Rundown } from '@rplayout/protocol'

const rate = { num: 25, den: 1 }
describe('relógio ancorado à data da grade', () => {
  it('continua acima de 24h à meia-noite, inclusive em cadência fracionária', () => {
    const before = new Date(2026,8,30,23,59,59), after = new Date(2026,9,1,0,0,1)
    expect(rundownFrames('2026-09-30',rate,before)).toBe(24*3600*25-25)
    expect(rundownFrames('2026-09-30',rate,after)).toBe(24*3600*25+25)
    expect(rundownFrames('2026-09-30',{num:30000,den:1001},after)).toBe(Math.round((after.getTime()-rundownMidnight('2026-09-30')!)*30/1001))
  })
  it('rebasa somente a cópia do planejamento e conserva elapsed/item/objeto do transporte', () => {
    const original = { itemId: 'pgm', startedAt: -250, elapsed: 500 }
    const clock = rundownClock('2026-09-30',rate,new Date(2026,9,1,0,0,1),original)
    expect(clock.onAir).toEqual({itemId:'pgm',elapsed:500,startedAt:24*3600*25+25-500})
    expect(original).toEqual({itemId:'pgm',startedAt:-250,elapsed:500})
  })
  it('usa números negativos para data futura sem adiantar seu plannedStart', () => {
    const now = rundownFrames('2026-10-02',rate,new Date(2026,9,1,12,0,0))!
    expect(now).toBe(-12*3600*25)
    const view = buildView({id:'grade',date:'2026-10-02',plannedStart:3600*25} as Rundown,
      {rate,targetLufs:-23,ceilingDbtp:-1} as Channel,[],new Map(),now,null)
    expect(view.schedule.endsAt).toBe(3600*25)
  })
  it('rejeita calendário impossível, relógio e rate inválidos sem inventar hoje', () => {
    for (const date of ['2026-02-30','2026-13-01','02/10/2026','']) expect(rundownMidnight(date)).toBeNull()
    expect(rundownMidnight('2024-02-29')).not.toBeNull()
    expect(rundownFrames('2026-10-02',rate,new Date(NaN))).toBeNull()
    expect(rundownFrames('2026-10-02',{num:25,den:0})).toBeNull()
    expect(rundownClock('2026-02-30',rate,new Date(),{itemId:'pgm',elapsed:25,startedAt:0})).toEqual({now:null,onAir:null})
  })
})
