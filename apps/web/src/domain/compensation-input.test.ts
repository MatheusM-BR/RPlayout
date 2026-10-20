import {describe,it,expect} from 'vitest'
import {compensationDeltaFrames,compensationPresets,compensationActionHint,compensationSecondsForAction} from './compensation-input.js'
import type {RundownItem} from '@rplayout/protocol'
describe('guided fast timing adjustments retain review/confirmation',()=>{
 it('action changes preserve comma decimals and invalid text for explicit validation',()=>{
  expect(compensationSecondsForAction('TRIM','2,50')).toBe('-2,50')
  expect(compensationSecondsForAction('ACCEPT_DELAY','-2,50')).toBe('2,50')
  expect(compensationSecondsForAction('TRIM','inválido')).toBe('-inválido')
  expect(compensationSecondsForAction('FILLER','-2,50')).toBe('-2,50')
 })
 it('advisory hints follow explicit flags, reject live cuts and fixed delays',()=>{
  // Only fields read by the advisory helper; not a simulated published revision.
  const vt={type:'VT',locked:false,protected:false,trimmable:true,optional:true,onOverrun:'PUSH',anchor:{kind:'FLOW'},mediaId:'asset',sourceRef:null,liveEndpoint:null,loop:false,elastic:null} as RundownItem
  expect(compensationActionHint(vt,'TRIM')).toBeNull()
  expect(compensationActionHint({...vt,type:'LIVE'},'TRIM')).toContain('ao vivo')
  expect(compensationActionHint({...vt,locked:true},'TRIM')).toContain('protegido')
  expect(compensationActionHint({...vt,timingFlags:{trimmable:false,optional:false,protected:false}},'TRIM')).toContain('corte permitido')
  expect(compensationActionHint({...vt,anchor:{kind:'FIXED',at:100}},'DROP_OPTIONAL')).toContain('horário obrigatório')
  expect(compensationActionHint(vt,'ACCEPT_DELAY')).toContain('flexível')
  expect(compensationActionHint({...vt,type:'FILLER',elastic:{min:100,max:500}},'FILLER')).toBeNull()
  expect(compensationActionHint({...vt,type:'FILLER',elastic:{min:100,max:500},loop:true},'FILLER')).toContain('finito')
 })
 it('converts seconds at channel cadence, not a guessed 25fps',()=>{
  expect(compensationDeltaFrames('TRIM','-2,5',{num:25,den:1})).toBe(-63)
  expect(compensationDeltaFrames('FILLER','2.5',{num:25,den:1})).toBe(63)
  expect(compensationDeltaFrames('FILLER','120',{num:30000,den:1001})).toBe(3596)
  expect(compensationDeltaFrames('TRIM','-5',{num:25,den:1})).toBe(-125)
  expect(compensationDeltaFrames('DROP_OPTIONAL','',{num:25,den:1})).toBe(0)
 })
 it('rounds fractional frame ties symmetrically in both directions',()=>{
  for(const rate of [{num:25,den:1},{num:30000,den:1001}]){
   for(const seconds of ['0.02','2.5','2.503','120.1']){
    const positive=compensationDeltaFrames('FILLER',seconds,rate)
    expect(compensationDeltaFrames('FILLER','-'+seconds,rate)).toBe(-positive)
   }
  }
 })
 it.each(['',' ','0','601','-601','NaN','Infinity','1,000.5','1.000,5','1e2','0x10'])('rejects invalid seconds %s',text=>{
  expect(()=>compensationDeltaFrames('FILLER',text,{num:25,den:1})).toThrow()
 })
 it('rejects wrong action sign and subframe or invalid cadence',()=>{
  expect(()=>compensationDeltaFrames('TRIM','30',{num:25,den:1})).toThrow('negativos')
  expect(()=>compensationDeltaFrames('ACCEPT_DELAY','-30',{num:25,den:1})).toThrow('positivos')
  expect(()=>compensationDeltaFrames('FILLER','0.001',{num:25,den:1})).toThrow('quadro')
  expect(()=>compensationDeltaFrames('FILLER','30',{num:25,den:0})).toThrow('Cadência')
 })
 it('offers 2–3min and seconds with only permitted signs',()=>{
  expect(compensationPresets('TRIM')).toEqual([-5,-15,-30,-120,-180])
  expect(compensationPresets('ACCEPT_DELAY')).toEqual([5,15,30,120,180])
  expect(compensationPresets('DROP_OPTIONAL')).toEqual([])
  expect(compensationPresets('FILLER')).toContain(120)
  expect(compensationPresets('FILLER')).toContain(-180)
 })
})
