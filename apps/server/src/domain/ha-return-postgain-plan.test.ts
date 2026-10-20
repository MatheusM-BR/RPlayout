// NOT_RUN: pure post-gain plan contracts only; no audio/native/files execution.
import {it,expect} from 'vitest'
import {randomUUID} from 'node:crypto'
import type {MediaAsset} from '@rplayout/protocol'
import type {readReturnCandidateOrigin} from './ha-return-candidate-origin.js'
import type {HaReturnMediaReviews} from './ha-return-media-review.js'
import {planReturnAudioMounts} from './ha-return-audio-mounts.js'
import {planReturnPostGainAudio,captureReturnPostGainProfile} from './ha-return-postgain-plan.js'
import type {HaSnapshot} from './ha-replication.js'
function fixture(mode:'MANUAL'|'OFF'|'AUTO'='MANUAL'){
  const hash='a'.repeat(64),rate={num:25,den:1},asset={id:'a',contentHash:hash,kind:'VIDEO',path:'D:/PRIVATE/a.mxf',durationNs:8e9,durationFrames:200,defaultTrim:{in:0,out:200},defaultAudio:{mode:'MANUAL',gainDb:0,measured:null},probeError:null,audioMetadata:{hasAudio:true,channels:4,tracks:[{index:0,channels:4,rate:48000}]}} as unknown as MediaAsset
  const origin={channel:{id:'ch'},entries:[{revision:{id:'rev'},payload:{rate,audioChannels:8,items:[{id:'vt',type:'VT',mediaId:'a',trim:{in:25,out:75},audio:{mode,gainDb:-3,measured:null,routing:{mode:'STEREO_3_4'},auxiliaryPairs:[{inputPair:1,outputPair:2,gainDb:-6}]}}],assets:[asset]}}]} as unknown as ReturnType<typeof readReturnCandidateOrigin>
  const assets=new Map([['a:'+hash,asset]]),plan=planReturnAudioMounts(origin,assets),entries=plan.mounts.map(({path,...mount})=>({mount,status:'MEASURED',receipt:{mountKey:mount.key,contentHash:mount.contentHash,audioTrack:mount.audioTrack,routing:mount.routing,trim:mount.trim,runtimeHash:'b'.repeat(64),checkedAt:'2026-10-11T12:00:00.000Z',reading:{ok:true,integratedLufs:-20,lra:4,truePeakDbtp:-2,sampleFrames:96000,rate:48000,channels:2,trim:mount.trim},preGainMeasured:true,postGainQualified:false,busQualified:false,editorialApproved:false,publicationAuthorized:false}}))
  const receipt={request:{mediaReviewId:randomUUID(),applicationId:randomUUID(),channelId:'ch'},result:{bytesAndDecodeComplete:true,evidenceMac:'c'.repeat(43),applicationDatabaseHash:'d'.repeat(64)},evidence:{localAssets:[...assets],audio:{version:1,runtimeHash:'b'.repeat(64),issues:plan.issues,entries}}} as unknown as ReturnType<HaReturnMediaReviews['privateEvidence']>
  const profile={channelId:'ch',targetLufs:-23,ceilingDbtp:-1,audioChannels:8 as const,rate}
  return {origin,receipt,profile}
}
it('profile comes from one exact local channel without defaults or foreign identity — NOT_RUN',()=>{
  const channel={id:'ch',targetLufs:-23,ceilingDbtp:-1,audioChannels:8,rateNum:25,rateDen:1},row={channelId:'ch',configuration:{channel}}
  const snapshot={channels:[row]} as unknown as HaSnapshot
  expect(captureReturnPostGainProfile(snapshot,'ch')).toEqual({channelId:'ch',targetLufs:-23,ceilingDbtp:-1,audioChannels:8,rate:{num:25,den:1}})
  expect(()=>captureReturnPostGainProfile({...snapshot,channels:[]},'ch')).toThrow('único')
  expect(()=>captureReturnPostGainProfile({...snapshot,channels:[snapshot.channels[0]!,snapshot.channels[0]!]},'ch')).toThrow('único')
  expect(()=>captureReturnPostGainProfile({channels:[{...row,configuration:{channel:{...channel,id:'foreign'}}}]} as unknown as HaSnapshot,'ch')).toThrow('Identidade')
  expect(()=>captureReturnPostGainProfile({channels:[{...row,configuration:{channel:{...channel,targetLufs:undefined}}}]} as unknown as HaSnapshot,'ch')).toThrow()
})
it('effective gain preserves manual/master and independent auxiliary, OFF is zero — NOT_RUN',()=>{
  const f=fixture(),before=JSON.stringify(f.origin),plan=planReturnPostGainAudio(f.origin,f.receipt,f.profile)
  expect(plan.jobs.map(job=>job.configuration.gainDb)).toEqual([-3,-6]);expect(JSON.stringify(f.origin)).toBe(before);expect(plan.busQualified).toBe(false)
  const off=fixture('OFF');expect(planReturnPostGainAudio(off.origin,off.receipt,off.profile).jobs.map(job=>job.configuration.gainDb)).toEqual([0,-6])
  expect(planReturnPostGainAudio(f.origin,f.receipt,{...f.profile,targetLufs:-14}).jobs[0]?.key).not.toBe(plan.jobs[0]?.key)
})
it('AUTO missing exact measurement blocks master until explicit decision, never guesses zero — NOT_RUN',()=>{
  const f=fixture('AUTO'),before=planReturnPostGainAudio(f.origin,f.receipt,f.profile)
  expect(before.issues.some(issue=>issue.errors.includes('LOCAL_POSTGAIN_AUTO_DECISION_REQUIRED'))).toBe(true)
  expect(before.jobs.every(job=>job.mount.role!=='MASTER')).toBe(true)
  const mount=f.receipt.evidence.audio!.entries.find(entry=>entry.mount.role==='MASTER')!
  const request={decisionId:randomUUID(),mediaReviewId:f.receipt.request.mediaReviewId,channelId:'ch',evidenceMac:f.receipt.result.evidenceMac,mountKeys:[mount.mount.key],reason:'Adotar medição local do corte'}
  const after=planReturnPostGainAudio(f.origin,f.receipt,f.profile,request)
  expect(after.jobs.find(job=>job.mount.role==='MASTER')?.configuration.gainDb).toBe(-3)
  expect(after.jobs.every(job=>job.autoDecisionId===request.decisionId)).toBe(true)
  expect(after.postGainQualified).toBe(false);expect(after.publicationAuthorized).toBe(false)
})
it('profile/cadence/bus cannot silently change the frozen edition — NOT_RUN',()=>{
  const f=fixture()
  for(const patch of [{channelId:'other'},{audioChannels:2},{rate:{num:50,den:1}},{ceilingDbtp:1}])expect(()=>planReturnPostGainAudio(f.origin,f.receipt,{...f.profile,...patch})).toThrow()
})
