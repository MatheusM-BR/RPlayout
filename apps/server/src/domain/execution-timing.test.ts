import {it,expect} from 'vitest'
import {executionTimingKey,freezeExecutionTiming} from './execution-timing.js'
import type {RundownView} from './plan.js'
const view=()=>({rundown:{id:'rd'},channel:{rate:{num:25,den:1}},items:[{item:{id:'vt',durationOverride:125},trim:{in:0,out:125}}],schedule:{items:[{id:'vt',duration:75,state:'PENDING'}]}} as unknown as RundownView)
it('clock projection does not invalidate preparation or mutate its frozen cut',()=>{
  const current=view(),frozen=freezeExecutionTiming(current)
  Object.assign(current.schedule.items[0]!,{duration:50,state:'DONE'})
  expect(executionTimingKey(current)).toBe(frozen.key)
  expect(frozen.schedule.items[0]?.duration).toBe(75)
})
it('actual declared cut and timeline edits invalidate the frozen contract',()=>{
  const current=view(),frozen=freezeExecutionTiming(current)
  Object.assign(current.items[0]!.trim,{out:100})
  expect(executionTimingKey(current)).not.toBe(frozen.key)
})
