// NOT_RUN: schema roundtrip, not a backup/restore execution.
import {it,expect} from 'vitest'
import {qcProfileSchema} from './editorial-schemas.js'
import {DEFAULT_QC_PROFILE} from '@rplayout/protocol'
it('local/project QC schema preserves explicit pair policies through JSON — NOT_RUN',()=>{
  for(const length of [1,4,8]){
    const renderedBusPairs=Array.from({length},(_,index)=>({outputPair:index+1,loudness:index===0?{minLufs:-25,maxLufs:-21}:null,maxTruePeakDbtp:-1}))
    const profile={...DEFAULT_QC_PROFILE,renderedBusPairs}
    expect(qcProfileSchema.parse(JSON.parse(JSON.stringify(profile))).renderedBusPairs).toEqual(renderedBusPairs)
    expect(qcProfileSchema.innerType().strict().parse(profile).renderedBusPairs).toEqual(renderedBusPairs)
  }
  expect(qcProfileSchema.parse(DEFAULT_QC_PROFILE).renderedBusPairs).toBeUndefined()
})
it('malformed policy is refused rather than silently stripped — NOT_RUN',()=>{
  for(const renderedBusPairs of [[],[{outputPair:2,loudness:null,maxTruePeakDbtp:-1}],[{outputPair:1,loudness:{minLufs:-10,maxLufs:-30},maxTruePeakDbtp:-1}],[{outputPair:1,loudness:null,maxTruePeakDbtp:1}]])expect(()=>qcProfileSchema.parse({...DEFAULT_QC_PROFILE,renderedBusPairs})).toThrow()
})
