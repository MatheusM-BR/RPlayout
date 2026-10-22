// NOT_RUN: private receipt contracts; no filesystem, native child or audio run.
import {it,expect} from 'vitest'
import {reviewReturnAudio,returnAudioEvidenceSchema,summarizeReturnAudio} from './ha-return-audio-review.js'
import type {planReturnAudioMounts} from './ha-return-audio-mounts.js'
const plan=()=>({mounts:[{key:'a'.repeat(64),revisionId:'rev',itemId:'item',role:'MASTER',outputPair:1,contentHash:'b'.repeat(64),audioTrack:1,routing:{mode:'STEREO_3_4'},trim:{inNs:1e9,outNs:3e9},gainDb:-3,mode:'MANUAL',path:'D:/PRIVATE_LOCAL_AUDIO/file.mxf'}],issues:[],postGainQualified:false,busQualified:false,publicationAuthorized:false} as ReturnType<typeof planReturnAudioMounts>)
it('absence is explicit, private path excluded, no AUTO/bus grant — NOT_RUN',async()=>{
  const result=await reviewReturnAudio(plan(),null,new AbortController().signal,()=>{})
  expect(result.summary).toMatchObject({required:1,measured:0,unavailable:1,postGainQualified:false,busQualified:false,publicationAuthorized:false})
  expect(JSON.stringify(result)).not.toContain('PRIVATE_LOCAL_AUDIO')
  expect(result.evidence.entries[0]?.mount.audioTrack).toBe(1)
})
it('measurement without receipt cannot count as success — NOT_RUN',async()=>{
  const result=await reviewReturnAudio(plan(),null,new AbortController().signal,()=>{})
  const bad={...result.evidence,entries:result.evidence.entries.map(entry=>({...entry,status:'MEASURED'}))}
  expect(returnAudioEvidenceSchema.safeParse(bad).success).toBe(false)
  expect(()=>summarizeReturnAudio(bad)).toThrow()
})
it('planning and short-cut blockers remain distinct from native counts — NOT_RUN',async()=>{
  const source=plan();source.mounts=[];source.issues=[{revisionId:'rev',itemId:'a',errors:['LOCAL_AUDIO_MEDIA_UNPROVEN'],warnings:[]},{revisionId:'rev',itemId:'b',errors:[],warnings:['LOCAL_AUDIO_SHORT_CUT_QUALIFICATION_PENDING']}]
  expect((await reviewReturnAudio(source,null,new AbortController().signal,()=>{})).summary).toMatchObject({required:0,measured:0,planBlocked:1,shortCuts:1})
})
