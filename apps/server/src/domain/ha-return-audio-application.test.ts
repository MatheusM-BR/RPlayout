// NOT_RUN: pure semantic binding only, no file/PCM/native or hardware execution.
import {it,expect} from 'vitest'
import {bindReturnAudioEvidence,applyReturnAudioMounts} from './ha-return-audio-application.js'
import {planReturnAudioMounts} from './ha-return-audio-mounts.js'
import type {readReturnCandidateOrigin} from './ha-return-candidate-origin.js'
import type {MediaAsset} from '@rplayout/protocol'
const hash='a'.repeat(64)
function fixture(){
  const asset={id:'a',contentHash:hash,kind:'VIDEO',path:'D:/PRIVATE/a.mxf',durationNs:8e9,durationFrames:200,defaultTrim:{in:0,out:200},defaultAudio:{mode:'MANUAL',gainDb:0,measured:null},probeError:null,audioMetadata:{hasAudio:true,channels:4,tracks:[{index:0,channels:4,rate:48000}]}} as unknown as MediaAsset
  const origin={entries:[{revision:{id:'rev'},payload:{rate:{num:25,den:1},audioChannels:8,items:[{id:'item',type:'VT',mediaId:'a',trim:{in:25,out:75},audio:{mode:'MANUAL',gainDb:-3,measured:null,routing:{mode:'STEREO_3_4'},auxiliaryPairs:[{inputPair:1,outputPair:2,gainDb:0}]}}],assets:[asset]}}]} as unknown as ReturnType<typeof readReturnCandidateOrigin>
  const assets=new Map([['a:'+hash,asset]]),plan=planReturnAudioMounts(origin,assets)
  const entries=plan.mounts.map(({path,...mount})=>({mount,status:'MEASURED',receipt:{mountKey:mount.key,contentHash:mount.contentHash,audioTrack:mount.audioTrack,routing:mount.routing,trim:mount.trim,runtimeHash:'b'.repeat(64),checkedAt:new Date().toISOString(),reading:{ok:true,integratedLufs:-23,lra:4,truePeakDbtp:-2,sampleFrames:96000,rate:48000,channels:2,trim:mount.trim},preGainMeasured:true,postGainQualified:false,busQualified:false,editorialApproved:false,publicationAuthorized:false}}))
  return {origin,assets,evidence:{version:1,runtimeHash:'b'.repeat(64),issues:plan.issues,entries}}
}
it('binds master/auxiliary separately; no editorial mode or AUTO measurement overwritten — NOT_RUN',()=>{
  const f=fixture(),before=JSON.stringify(f.origin),bound=bindReturnAudioEvidence(f.origin,f.assets,f.evidence)!
  const checks=[{itemId:'item',errors:['SELECTED_AUDIO_MEASUREMENT_MISSING'],warnings:['LOCAL_SELECTED_MIX_RENDER_PENDING'],livePending:false}]
  applyReturnAudioMounts(checks,bound.byRevision.get('rev')!,bound.evidence.issues)
  expect(bound.byRevision.get('rev')).toHaveLength(2)
  expect(checks[0]?.warnings).not.toContain('LOCAL_SELECTED_MIX_RENDER_PENDING')
  expect(checks[0]?.warnings).toContain('LOCAL_SELECTED_AUDIO_POSTGAIN_BUS_QUALIFICATION_PENDING')
  expect(checks[0]?.errors).toContain('SELECTED_AUDIO_MEASUREMENT_MISSING')
  expect(JSON.stringify(f.origin)).toBe(before)
})
it('different cut/gain/edition/order and copied key with altered contents are rejected — NOT_RUN',()=>{
  const f=fixture()
  const gain=fixture();gain.origin.entries[0]!.payload.items[0]={...gain.origin.entries[0]!.payload.items[0]!,audio:{...gain.origin.entries[0]!.payload.items[0]!.audio!,gainDb:-6}}
  expect(()=>bindReturnAudioEvidence(gain.origin,gain.assets,f.evidence)).toThrow('Recibo')
  expect(()=>bindReturnAudioEvidence(f.origin,f.assets,{...f.evidence,entries:[...f.evidence.entries].reverse()})).toThrow('Recibo')
  const changed={...f.evidence,entries:f.evidence.entries.map(entry=>({...entry,mount:{...entry.mount,gainDb:-4}}))}
  expect(()=>bindReturnAudioEvidence(f.origin,f.assets,changed)).toThrow('Recibo')
  expect(()=>bindReturnAudioEvidence(f.origin,f.assets,{...f.evidence,entries:[]})).toThrow('Plano')
})
it('legacy remains without proof and missing target has no fallback — NOT_RUN',()=>{
  const f=fixture();expect(bindReturnAudioEvidence(f.origin,f.assets,undefined)).toBeNull()
  const bound=bindReturnAudioEvidence(f.origin,f.assets,f.evidence)!
  expect(()=>applyReturnAudioMounts([],bound.byRevision.get('rev')!,bound.evidence.issues)).toThrow('ausente')
})
