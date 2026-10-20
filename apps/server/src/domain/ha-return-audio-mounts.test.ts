// NOT_RUN: pure plans only. No file/decoder/mix or hardware executed.
import {it,expect} from 'vitest'
import {planReturnAudioMounts} from './ha-return-audio-mounts.js'
import type {MediaAsset} from '@rplayout/protocol'
import type {readReturnCandidateOrigin} from './ha-return-candidate-origin.js'
const hash='a'.repeat(64),rate={num:25,den:1}
const asset=()=>({id:'a',contentHash:hash,kind:'VIDEO',path:'D:/PRIVATE_LOCAL/a.mxf',durationNs:8e9,durationFrames:200,defaultTrim:{in:0,out:200},defaultAudio:{mode:'MANUAL',gainDb:0,measured:null},probeError:null,audioMetadata:{hasAudio:true,channels:4,tracks:[{index:0,channels:4,rate:48000},{index:1,channels:4,rate:48000}]}} as unknown as MediaAsset)
const origin=()=>({entries:[{revision:{id:'rev'},payload:{rate,audioChannels:8,items:[{id:'item',type:'VT',mediaId:'a',trim:{in:25,out:75},audioTrack:1,audio:{mode:'MANUAL',gainDb:-3,measured:null,routing:{mode:'STEREO_3_4'},auxiliaryPairs:[{outputPair:2,inputPair:1,gainDb:-6}]}}],assets:[{...asset(),path:'C:/FOREIGN/a.mxf'}]}}]} as unknown as ReturnType<typeof readReturnCandidateOrigin>)
it('exact selected track/cut and auxiliary matrix use local path, not foreign metadata — NOT_RUN',()=>{
  const source=origin(),before=JSON.stringify(source),plan=planReturnAudioMounts(source,new Map([['a:'+hash,asset()]]))
  expect(plan.mounts).toHaveLength(2)
  expect(plan.mounts[0]).toMatchObject({audioTrack:1,role:'MASTER',outputPair:1,trim:{inNs:1e9,outNs:3e9},gainDb:-3,path:'D:/PRIVATE_LOCAL/a.mxf',routing:{mode:'STEREO_3_4'}})
  expect(plan.mounts[1]).toMatchObject({role:'AUXILIARY',outputPair:2,gainDb:-6,routing:{mode:'MATRIX',matrix:[[1,0,0,0],[0,1,0,0]]}})
  expect(plan.mounts[0]?.key).not.toBe(plan.mounts[1]?.key)
  expect(plan.busQualified).toBe(false);expect(plan.postGainQualified).toBe(false);expect(JSON.stringify(source)).toBe(before)
})
it('missing local version and too short cut remain explicit, not guessed measured — NOT_RUN',()=>{
  expect(planReturnAudioMounts(origin(),new Map()).issues[0]?.errors).toContain('LOCAL_AUDIO_MEDIA_UNPROVEN')
  const source=origin();source.entries[0]!.payload.items[0]={...source.entries[0]!.payload.items[0]!,trim:{in:25,out:26}}
  const result=planReturnAudioMounts(source,new Map([['a:'+hash,asset()]]))
  expect(result.mounts).toEqual([]);expect(result.issues[0]?.warnings).toContain('LOCAL_AUDIO_SHORT_CUT_QUALIFICATION_PENDING')
})
it('duration override changes every measured cut/key; out-of-file never schedules measurement — NOT_RUN',()=>{
  const source=origin(),assets=new Map([['a:'+hash,asset()]]),before=planReturnAudioMounts(source,assets)
  source.entries[0]!.payload.items[0]={...source.entries[0]!.payload.items[0]!,durationOverride:25}
  const shortened=planReturnAudioMounts(source,assets)
  expect(shortened.mounts).toHaveLength(2)
  expect(shortened.mounts.every(mount=>mount.trim.inNs===1e9&&mount.trim.outNs===2e9)).toBe(true)
  expect(shortened.mounts[0]?.key).not.toBe(before.mounts[0]?.key)
  expect(shortened.mounts[1]?.key).not.toBe(before.mounts[1]?.key)
  source.entries[0]!.payload.items[0]={...source.entries[0]!.payload.items[0]!,durationOverride:176}
  const invalid=planReturnAudioMounts(source,assets)
  expect(invalid.mounts).toEqual([]);expect(invalid.issues[0]?.errors).toContain('LOCAL_AUDIO_MOUNT_INVALID')
})
