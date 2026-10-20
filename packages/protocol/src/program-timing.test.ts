import {it,expect} from 'vitest'
import {programDurationFrames} from './program-timing.js'
it('uses mounted duration for countdown and end-relative events',()=>{
  expect(programDurationFrames({itemId:'vt',startedAt:0,elapsed:25,mountedDuration:75},125)).toBe(75)
})
it('live/simulator without mounted bounds retains planned estimate',()=>{
  expect(programDurationFrames({itemId:'live',startedAt:0,elapsed:25},1250)).toBe(1250)
})
it('does not display NaN, infinity or invalid negative duration',()=>{
  for(const duration of [NaN,Infinity,-1,0.5])expect(programDurationFrames({itemId:'vt',startedAt:0,elapsed:0,mountedDuration:duration},1250)).toBe(0)
})
