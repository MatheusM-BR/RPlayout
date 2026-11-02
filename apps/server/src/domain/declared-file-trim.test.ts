// NOT_RUN: declared file mounting contracts, no native media or hardware.
import {it,expect} from 'vitest'
import type {MediaAsset} from '@rplayout/protocol'
import {declaredFileTrim,executionTrim} from './execution-trim.js'
const rate={num:25,den:1},asset={kind:'VIDEO',defaultTrim:{in:25,out:150},durationFrames:500,durationNs:null} as MediaAsset
it('declared duration agrees with execution and preserves original trim — NOT_RUN',()=>{
  const item={trim:{in:25,out:150},durationOverride:75},before=JSON.stringify(item),cut=declaredFileTrim(item,asset,rate)
  expect(cut).toEqual({in:25,out:100})
  expect(executionTrim({item,asset,trim:item.trim} as Parameters<typeof executionTrim>[0],undefined,rate)).toEqual(cut)
  expect(JSON.stringify(item)).toBe(before)
  expect(declaredFileTrim({...item,durationOverride:200},asset,rate)).toEqual({in:25,out:225})
})
it('unset duration uses declared/default cut, explicit invalid duration never falls back — NOT_RUN',()=>{
  expect(declaredFileTrim({trim:null,durationOverride:null},asset,rate)).toEqual({in:25,out:150})
  expect(declaredFileTrim({trim:null},asset,rate)).toEqual({in:25,out:150})
  for(const durationOverride of [0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER])expect(()=>declaredFileTrim({trim:null,durationOverride},asset,rate)).toThrow()
  expect(()=>declaredFileTrim({trim:{in:25,out:150},durationOverride:476},asset,rate)).toThrow('excede')
})
it('default trim cadence is converted before duration override — NOT_RUN',()=>{
  expect(declaredFileTrim({trim:null,durationOverride:50},{...asset,defaultTrim:{in:50,out:300},defaultTrimRate:{num:50,den:1}},rate)).toEqual({in:25,out:75})
})
