// NOT_RUN: explicit policy contracts only; no native audio or channel approval.
import {it,expect} from 'vitest'
import {assessReturnBusAudio,captureReturnBusPolicy,captureReturnBusPolicyOrPending,returnBusPolicySchema} from './ha-return-bus-policy.js'
import {busEvidenceFixture} from './ha-return-bus-fixtures.js'
import type {HaSnapshot} from './ha-replication.js'
const policy=()=>({channelId:'ch',configurationRevision:7,audioChannels:8,pairs:Array.from({length:4},(_,index)=>({outputPair:index+1,loudness:index===0?{minLufs:-25,maxLufs:-21}:null,maxTruePeakDbtp:-1}))})
it('evaluates actual receipts against each pair, never QC or PGM — NOT_RUN',()=>{
  const {plan,evidence}=busEvidenceFixture(),assessment=assessReturnBusAudio(plan,evidence,policy())
  expect(assessment.withinProfile).toBe(1);expect(assessment.isolatedAssessmentComplete).toBe(true)
  expect(assessment.editorialApproved).toBe(false);expect(assessment.publicationAuthorized).toBe(false);expect(assessment.transitionQualified).toBe(false)
  const stricter={...policy(),pairs:policy().pairs.map(pair=>({...pair,maxTruePeakDbtp:-4}))}
  const failed=assessReturnBusAudio(plan,evidence,stricter)
  expect(failed.withinProfile).toBe(0);expect(failed.entries[0]!.pairs.every(pair=>pair.errors.includes('LOCAL_BUS_TRUE_PEAK_OUT_OF_PROFILE'))).toBe(true)
  const range={...policy(),pairs:policy().pairs.map(pair=>pair.outputPair===2?{...pair,loudness:{minLufs:-30,maxLufs:-25}}:pair)}
  expect(assessReturnBusAudio(plan,evidence,range).entries[0]!.pairs[1]!.errors).toContain('LOCAL_BUS_LOUDNESS_OUT_OF_PROFILE')
})
it('missing receipt, blocked or empty plan cannot pass assessment — NOT_RUN',()=>{
  const {plan,evidence}=busEvidenceFixture(),row=evidence.entries[0]!
  const missing=assessReturnBusAudio(plan,{...evidence,entries:[{...row,status:'FAILED',receipt:null}]},policy())
  expect(missing.failed).toBe(1);expect(missing.isolatedAssessmentComplete).toBe(false)
  const issues=[{revisionId:'rev',itemId:'vt',errors:['blocked'],warnings:[]}]
  expect(assessReturnBusAudio({...plan,issues},{...evidence,issues},policy()).isolatedAssessmentComplete).toBe(false)
  expect(assessReturnBusAudio({...plan,jobs:[]},{...evidence,entries:[]},policy()).isolatedAssessmentComplete).toBe(false)
  expect(()=>assessReturnBusAudio(plan,evidence,{...policy(),channelId:'foreign'})).toThrow()
})
it('only absence is pending; malformed policy or missing revision is rejected — NOT_RUN',()=>{
  const snapshot={channels:[{channelId:'ch',configuration:{channel:{id:'ch',audioChannels:8,qcProfile:null}}}]} as unknown as HaSnapshot
  expect(captureReturnBusPolicyOrPending(snapshot,'ch',7)).toBeNull()
  expect(()=>captureReturnBusPolicyOrPending(snapshot,'ch',NaN)).toThrow()
  const malformed={channels:[{channelId:'ch',configuration:{channel:{id:'ch',audioChannels:8,qcProfile:{renderedBusPairs:[]}}}}]} as unknown as HaSnapshot
  expect(()=>captureReturnBusPolicyOrPending(malformed,'ch',7)).toThrow()
})
it('requires explicit ordered policy for every pair without guessing auxiliary loudness — NOT_RUN',()=>{
  const parsed=returnBusPolicySchema.parse(policy());expect(parsed.pairs[0]?.loudness).toEqual({minLufs:-25,maxLufs:-21});expect(parsed.pairs[1]?.loudness).toBeNull()
  for(const value of [{...policy(),pairs:policy().pairs.slice(1)},{...policy(),pairs:policy().pairs.map(pair=>({...pair,outputPair:1}))},{...policy(),audioChannels:2},{...policy(),configurationRevision:-1},{...policy(),publicationAuthorized:true}])expect(()=>returnBusPolicySchema.parse(value)).toThrow()
})
it('invalid ranges/peaks cannot qualify as policy — NOT_RUN',()=>{
  for(const rule of [{loudness:{minLufs:-10,maxLufs:-30}},{loudness:{minLufs:NaN,maxLufs:-21}},{maxTruePeakDbtp:1},{maxTruePeakDbtp:Infinity}])expect(()=>returnBusPolicySchema.parse({...policy(),pairs:policy().pairs.map(pair=>pair.outputPair===1?{...pair,...rule}:pair)})).toThrow()
})
it('captures only one exact local channel with explicitly configured pairs — NOT_RUN',()=>{
  const row={channelId:'ch',configuration:{channel:{id:'ch',audioChannels:8,qcProfile:{renderedBusPairs:policy().pairs}}}},snapshot={channels:[row]} as unknown as HaSnapshot
  expect(captureReturnBusPolicy(snapshot,'ch',7)).toEqual(policy())
  expect(()=>captureReturnBusPolicy({...snapshot,channels:[]},'ch',7)).toThrow()
  expect(()=>captureReturnBusPolicy({...snapshot,channels:[snapshot.channels[0]!,snapshot.channels[0]!]},'ch',7)).toThrow()
  for(const channel of [{...row.configuration.channel,id:'foreign'},{...row.configuration.channel,qcProfile:{}},{...row.configuration.channel,audioChannels:2}])expect(()=>captureReturnBusPolicy({channels:[{...row,configuration:{channel}}]} as unknown as HaSnapshot,'ch',7)).toThrow()
})
