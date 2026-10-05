import { describe, expect, it } from 'vitest'
import { RATE, type PlanItem, type ProtectedTimingZone } from '@rplayout/protocol'
import { resolve } from './resolve.js'
const rate = RATE['25']
const zone: ProtectedTimingZone = { id:'journal', label:'Jornal protegido', from:0, to:1000, priority:3 }
const clip: PlanItem = { id:'clip', order:0, duration:1000, minDuration:100, anchor:{kind:'FLOW'}, onOverrun:'TRIM_PREV', isFiller:false, elastic:null, locked:false }
const target: PlanItem = { ...clip, id:'anchor', order:1, duration:100, anchor:{kind:'SOFT',at:800,tolerance:0,priority:3} }
const run = (zones: ProtectedTimingZone[], items = [clip,target]) => resolve({ rate, items, plannedStart:0, now:null, onAir:null, protectedZones:zones })
describe('zona de horário com prioridade formal', () => {
  it('preserva item contra âncora de igual prioridade e mantém conflito explícito', () => {
    const result = run([zone])
    expect(result.items[0]?.duration).toBe(1000)
    expect(result.conflicts.some(conflict => conflict.kind === 'ANCHOR_MISSED')).toBe(true)
    expect(result.protections).toContainEqual({itemId:'clip',zoneId:'journal',label:'Jornal protegido',priority:3,status:'PRESERVED',changedFrames:0})
  })
  it('prioridade superior pode compensar, mas registra violação e razão', () => {
    const result=run([{...zone,priority:2}])
    expect(result.items[0]?.duration).toBe(800)
    expect(result.protections?.find(row=>row.itemId==='clip')).toMatchObject({status:'OVERRIDDEN',changedFrames:200})
    expect(result.conflicts).toContainEqual(expect.objectContaining({kind:'PROTECTED_ZONE_OVERRIDDEN',itemId:'clip',frames:200}))
    expect(result.compensationReport?.status).toBe('RESOLVED_WITH_WARNINGS')
  })
  it.each(['FIXED','HARD_TIME'] as const)('live %s continua mandatório inclusive contra proteção 5', kind => {
    const result=run([{...zone,priority:5}],[clip,{...target,eventType:kind,anchor:{kind,at:800}}])
    expect(result.items[0]?.duration).toBe(800)
    expect(result.items[1]?.start).toBe(800)
    expect(result.conflicts.some(conflict=>conflict.kind==='PROTECTED_ZONE_OVERRIDDEN')).toBe(true)
  })
  it('zona preserva filler contra alongamento da mesma prioridade', () => {
    const result=run([zone],[{...clip,isFiller:true,elastic:{min:100,max:2000}},{...target,anchor:{kind:'SOFT',at:1200,tolerance:0,priority:3}}])
    expect(result.items[0]?.duration).toBe(1000)
    expect(result.conflicts.some(conflict=>conflict.kind==='GAP')).toBe(true)
  })
  it('limite final é exclusivo, e o mesmo input reproduz o mesmo resultado', () => {
    const result=run([{...zone,from:1000,to:1100}])
    expect(result.items[0]?.duration).toBe(800)
    expect(result.protections?.some(row=>row.itemId==='clip')).toBe(false)
    expect(run([zone])).toEqual(run([zone]))
  })
  it('recusa janela invertida em vez de ignorar proteção silenciosamente', () => {
    expect(()=>run([{...zone,to:0}])).toThrow('Zona protegida inválida')
  })
})
