import {it,expect} from 'vitest'
import {resolve} from './resolve.js'
import type {PlanItem,ResolveInput} from '@rplayout/protocol'
const item=(id:string,duration:number,extra:Partial<PlanItem>={}):PlanItem=>({id,order:id==='pgm'?0:1,title:id,duration,minDuration:25,anchor:{kind:'FLOW'},onOverrun:'PUSH',elastic:null,isFiller:false,locked:false,...extra})
const run=(items:PlanItem[],extra:Partial<ResolveInput>={})=>resolve({items,rate:{num:25,den:1},now:null,plannedStart:0,onAir:{itemId:'pgm',startedAt:0,elapsed:25,mountedDuration:750},...extra})
it('projects future FLOW from mounted duration while preserving nominal intention',()=>{
  const result=run([item('pgm',1250),item('next',250)])
  expect(result.items[0]).toMatchObject({duration:750,plannedDuration:1250,mountedDuration:750,state:'ON_AIR',end:750})
  expect(result.items[1]?.start).toBe(750)
})
it('cannot silently extend an already mounted elastic filler to fill a gap',()=>{
  const result=run([item('pgm',50,{isFiller:true,elastic:{min:25,max:500}}),item('next',75,{anchor:{kind:'FIXED',at:400}})],{onAir:{itemId:'pgm',startedAt:0,elapsed:25,mountedDuration:300}})
  expect(result.items[0]).toMatchObject({duration:300,plannedDuration:50,mountedDuration:300})
  expect(result.conflicts.some(row=>row.kind==='GAP'&&row.frames===100)).toBe(true)
})
it('priority interruption projection is distinct from actual decoder bound',()=>{
  const result=run([item('pgm',1250),item('next',250,{anchor:{kind:'HARD_TIME',at:500}})])
  expect(result.items[0]).toMatchObject({duration:500,mountedDuration:750,state:'ON_AIR'})
  expect(result.items[1]?.start).toBe(500)
})
it('a missed hard anchor cannot mark confirmed native PGM as dropped',()=>{
  const result=run([item('pgm',1250),item('next',250,{anchor:{kind:'HARD_TIME',at:900}})],{onAir:{itemId:'pgm',startedAt:1000,elapsed:25,mountedDuration:750}})
  expect(result.items[0]).toMatchObject({mountedDuration:750,state:'ON_AIR'})
  expect(result.conflicts.some(row=>row.frames>0)).toBe(true)
})
it('elapsed beyond a native bound does not fabricate additional media frames',()=>{
  const result=run([item('pgm',1250)],{onAir:{itemId:'pgm',startedAt:0,elapsed:800,mountedDuration:750}})
  expect(result.items[0]?.duration).toBe(750)
})
it('rejects malformed mounted duration rather than recalculating nominal',()=>{
  expect(()=>run([item('pgm',1250)],{onAir:{itemId:'pgm',startedAt:0,elapsed:25,mountedDuration:0}})).toThrow('Duração montada')
})
