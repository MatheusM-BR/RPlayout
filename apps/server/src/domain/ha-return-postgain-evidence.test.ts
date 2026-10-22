// NOT_RUN: receipt contracts only; no native work or media files accessed.
import {it,expect} from 'vitest'
import {createHash} from 'node:crypto'
import {returnAudioMountKey,type ReturnAudioMount} from './ha-return-audio-mounts.js'
import {bindReturnPostGainEvidence,returnPostGainEvidenceSchema,returnPostGainJobIdentity,summarizeReturnPostGain} from './ha-return-postgain-evidence.js'
import type {planReturnPostGainAudio,ReturnPostGainJob} from './ha-return-postgain-plan.js'
function fixture(){
  const parts={revisionId:'rev',itemId:'item',role:'MASTER' as const,outputPair:1,contentHash:'a'.repeat(64),audioTrack:0,routing:{mode:'DEFAULT' as const},trim:{inNs:0,outNs:2e9},gainDb:-3,mode:'MANUAL'}
  const mount:ReturnAudioMount={...parts,key:returnAudioMountKey(parts),path:'D:/PRIVATE/media.mxf'},configuration={gainDb:-3,ceilingDbtp:-1},profileFingerprint='b'.repeat(64),evidenceMac='c'.repeat(43),autoDecisionId=null
  const key=createHash('sha256').update(JSON.stringify(['isolated-postgain:v1',mount.key,profileFingerprint,evidenceMac,autoDecisionId,configuration])).digest('hex'),job:ReturnPostGainJob={key,mount,configuration,profileFingerprint,evidenceMac,autoDecisionId}
  const plan={profile:{channelId:'ch',targetLufs:-23,ceilingDbtp:-1,audioChannels:2,rate:{num:25,den:1}},profileFingerprint,jobs:[job],issues:[],postGainQualified:false,busQualified:false,transitionQualified:false,publicationAuthorized:false} as ReturnType<typeof planReturnPostGainAudio>
  const runtimeHash='d'.repeat(64),proof={mountKey:mount.key,contentHash:mount.contentHash,audioTrack:0,routing:mount.routing,trim:mount.trim,runtimeHash,checkedAt:'2026-10-11T12:00:00.000Z',reading:{ok:true,integratedLufs:-23,lra:3,truePeakDbtp:-5,sampleFrames:96000,rate:48000,channels:2,trim:mount.trim,processing:{kind:'ISOLATED_POSTGAIN_LIMITED_STEREO',gainDb:-3,ceilingDbtp:-1,lookaheadMs:5,releaseMs:50,limiterReductionDb:0,initialState:'RESET',tailFlushed:false,busQualified:false,transitionQualified:false,publicationAuthorized:false}},postGainMeasured:true,isolatedLimiterRendered:true,postGainQualified:false,busQualified:false,transitionQualified:false,editorialApproved:false,publicationAuthorized:false}
  const evidence={version:1,profileFingerprint,runtimeHash,entries:[{job:returnPostGainJobIdentity(job),status:'MEASURED',receipt:proof}],issues:[],postGainQualified:false,busQualified:false,transitionQualified:false,publicationAuthorized:false}
  return {job,plan,evidence}
}
it('receipt is path-free and bound to exact trusted plan, not an approval — NOT_RUN',()=>{
  const {plan,evidence}=fixture(),bound=bindReturnPostGainEvidence(plan,evidence)
  expect(JSON.stringify(bound)).not.toContain('PRIVATE');expect(bound.summary.measured).toBe(1)
  expect(bound.summary.editorialApproved).toBe(false);expect(bound.summary.publicationAuthorized).toBe(false)
  expect(()=>returnPostGainEvidenceSchema.parse({...evidence,path:'D:/PRIVATE'})).toThrow()
  expect(()=>bindReturnPostGainEvidence({...plan,issues:[{revisionId:'rev',itemId:'item',errors:['BLOCKED'],warnings:[]}]},evidence)).toThrow()
})
it('rejects inconsistent DSP, runtime, mount identity, coverage and qualification — NOT_RUN',()=>{
  const f=fixture()
  for(const change of [(e:typeof f.evidence)=>{e.entries[0]!.receipt.reading.processing.gainDb=0},(e:typeof f.evidence)=>{e.entries[0]!.receipt.runtimeHash='e'.repeat(64)},(e:typeof f.evidence)=>{e.entries[0]!.job.mount.outputPair=2},(e:typeof f.evidence)=>{e.entries[0]!.receipt.reading.sampleFrames=90000},(e:typeof f.evidence)=>{e.entries[0]!.receipt.reading.processing.tailFlushed=true}]){
    const bad=structuredClone(f.evidence);change(bad);expect(()=>returnPostGainEvidenceSchema.parse(bad)).toThrow()
  }
  expect(()=>returnPostGainEvidenceSchema.parse({...f.evidence,postGainQualified:true})).toThrow()
  expect(()=>returnPostGainEvidenceSchema.parse({...f.evidence,entries:[...f.evidence.entries,...f.evidence.entries]})).toThrow()
})
it('failure has no receipt, counts preserve failure, ordering/omission are not accepted — NOT_RUN',()=>{
  const {plan,evidence}=fixture(),failed={...evidence,entries:[{...evidence.entries[0]!,status:'FAILED',receipt:null}]}
  expect(summarizeReturnPostGain(failed).failed).toBe(1)
  expect(()=>returnPostGainEvidenceSchema.parse({...failed,entries:[{...failed.entries[0]!,receipt:evidence.entries[0]!.receipt}]})).toThrow()
  expect(()=>bindReturnPostGainEvidence(plan,{...evidence,entries:[]})).toThrow()
  expect(()=>bindReturnPostGainEvidence({...plan,profileFingerprint:'e'.repeat(64)},evidence)).toThrow()
})
