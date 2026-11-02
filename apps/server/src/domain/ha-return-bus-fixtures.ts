// NOT_RUN reusable synthetic fixture; never hardware/PCM evidence.
import {returnAudioMountKey} from './ha-return-audio-mounts.js'
import {returnBusJobKey,type ReturnBusJob,type planReturnBusAudio} from './ha-return-bus-plan.js'
import {returnBusJobIdentity} from './ha-return-bus-evidence.js'
export function busEvidenceFixture(){
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

