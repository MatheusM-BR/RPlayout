// NOT_RUN: pure identity/proof binding; no native work or publication.
import {it,expect} from 'vitest'
import {returnAudioMountKey} from './ha-return-audio-mounts.js'
import {returnBusJobKey,type ReturnBusJob,type planReturnBusAudio} from './ha-return-bus-plan.js'
import {bindReturnBusEvidence,returnBusEvidenceSchema,returnBusJobIdentity} from './ha-return-bus-evidence.js'
function fixture(){
  const contentHash='a'.repeat(64),profileFingerprint='b'.repeat(64),runtimeHash='c'.repeat(64),trim={inNs:1e9,outNs:3e9},routing={mode:'DEFAULT' as const}
  const mountIdentity={revisionId:'rev',itemId:'vt',role:'MASTER' as const,outputPair:1,contentHash,audioTrack:0,routing,trim,gainDb:-3,mode:'MANUAL'}
  const mount={...mountIdentity,key:returnAudioMountKey(mountIdentity),path:'D:/PRIVATE/a.mxf'}
  const configuration={audioTrack:0,inputChannels:2,audioChannels:8 as const,routing,auxiliaryPairs:[],gainDb:-3,ceilingDbtp:-1,trim}
  const fields={mount,configuration,profileFingerprint,evidenceMac:'d'.repeat(43),autoDecisionId:null},job:ReturnBusJob={...fields,key:returnBusJobKey(fields)}
  const plan={profile:{channelId:'ch',targetLufs:-23,ceilingDbtp:-1,audioChannels:8,rate:{num:25,den:1}},profileFingerprint,jobs:[job],issues:[],busQualified:false,transitionQualified:false,avQualified:false,publicationAuthorized:false} as ReturnType<typeof planReturnBusAudio>
  const {audioChannels,trim:cut,...settings}=configuration
  const receipt={mountKey:mount.key,contentHash,audioTrack:0,routing,trim,runtimeHash,checkedAt:'2026-10-11T12:00:00.000Z',reading:{ok:true,rate:48000,channels:audioChannels,trim:cut,sampleFrames:96000,startupFramesRemoved:240,flushedFrames:240,limiterReductionDb:0,pairs:Array.from({length:4},(_,index)=>({outputPair:index+1,integratedLufs:-23,lra:0,truePeakDbtp:-3,sampleFrames:96000})),processing:{...settings,kind:'ISOLATED_RENDERED_BUS',initialState:'RESET',sourceCoverageConfirmed:true,trimStage:'AFTER_ITEM_MIX',decodeFromStart:true,tailFlushed:true,pairLinked:true,busQualified:false,transitionQualified:false,avQualified:false,publicationAuthorized:false}},isolatedBusRendered:true,postGainQualified:false,busQualified:false,transitionQualified:false,avQualified:false,editorialApproved:false,publicationAuthorized:false}
  const evidence={version:1,profileFingerprint,runtimeHash,entries:[{job:returnBusJobIdentity(job),status:'MEASURED',receipt}],issues:[],busQualified:false,transitionQualified:false,avQualified:false,publicationAuthorized:false}
  return {plan,job,receipt,evidence}
}
it('binds exact current plan and path-free result without approval — NOT_RUN',()=>{
  const {plan,evidence}=fixture(),bound=bindReturnBusEvidence(plan,evidence)
  expect(bound.summary.measured).toBe(1);expect(bound.summary.publicationAuthorized).toBe(false)
  expect(JSON.stringify(bound)).not.toContain('PRIVATE')
})
it('rejects changed processing/runtime, stale plan and approval claims — NOT_RUN',()=>{
  const {plan,evidence,receipt}=fixture(),row=evidence.entries[0]!
  for(const changed of [{...receipt,runtimeHash:'e'.repeat(64)},{...receipt,publicationAuthorized:true},{...receipt,reading:{...receipt.reading,processing:{...receipt.reading.processing,gainDb:0}}},{...receipt,reading:{...receipt.reading,pairs:receipt.reading.pairs.slice(1)}}])expect(()=>bindReturnBusEvidence(plan,{...evidence,entries:[{...row,receipt:changed}]})).toThrow()
  expect(()=>bindReturnBusEvidence({...plan,issues:[{revisionId:'rev',itemId:'vt',errors:['blocked'],warnings:[]}]},evidence)).toThrow()
  expect(()=>returnBusEvidenceSchema.parse({...evidence,entries:[row,row]})).toThrow()
})
it('failed work has no receipt; no missing/forged job can close the plan — NOT_RUN',()=>{
  const {plan,evidence}=fixture(),row=evidence.entries[0]!
  const failed={...evidence,entries:[{...row,status:'FAILED',receipt:null}]}
  expect(bindReturnBusEvidence(plan,failed).summary.failed).toBe(1)
  expect(()=>bindReturnBusEvidence(plan,{...failed,entries:[{...row,status:'FAILED'}]})).toThrow()
  expect(()=>bindReturnBusEvidence(plan,{...evidence,entries:[]})).toThrow()
  expect(()=>bindReturnBusEvidence(plan,{...evidence,entries:[{...row,job:{...row.job,key:'f'.repeat(64)}}]})).toThrow()
})
