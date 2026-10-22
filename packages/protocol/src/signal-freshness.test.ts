import {describe,expect,it} from 'vitest'
import {signalBufferIsRecent,signalSampleAge} from './signal-freshness.js'

const now=Date.parse('2026-10-06T15:00:00Z')
describe('shared source freshness contract',()=>{
  it('adds delivery elapsed time to native buffer age',()=>{
    const age=signalSampleAge(new Date(now-600).toISOString(),now)
    expect(age).toBe(600)
    expect(signalBufferIsRecent(true,1500,age)).toBe(false)
    expect(signalBufferIsRecent(true,1400,age)).toBe(true)
    expect(signalBufferIsRecent(false,0,0)).toBe(false)
  })
  it.each(['invalid',new Date(now+1).toISOString(),new Date(now-2501).toISOString()])('does not certify invalid, future or expired clocks: %s',timestamp=>{
    const age=signalSampleAge(timestamp,now)
    expect(age).toBeNull()
    expect(signalBufferIsRecent(true,0,age)).toBe(false)
  })
  it.each([null,NaN,Infinity,-1,2001])('rejects unmeasured or invalid buffer age: %s',age=>{
    expect(signalBufferIsRecent(true,age,0)).toBe(false)
  })
})
