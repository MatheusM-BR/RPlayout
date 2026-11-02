import {createHash} from 'node:crypto'
import {knownInputAudioChannels,resolveAudio,type MediaAsset} from '@rplayout/protocol'
import {planReturnPostGainAudio} from './ha-return-postgain-plan.js'
import {returnBusConfigSchema,type ReturnBusConfig} from './ha-return-bus-reading.js'
import {runReturnBusMount} from './ha-return-audio-probe.js'
import {localFileStamp,probeRuntimeHash} from './ha-local-probe.js'
import type {ReturnAudioMount} from './ha-return-audio-mounts.js'
import {bindReturnBusEvidence,returnBusJobIdentity} from './ha-return-bus-evidence.js'

export interface ReturnBusJob{key:string;mount:ReturnAudioMount;configuration:ReturnBusConfig;profileFingerprint:string;evidenceMac:string;autoDecisionId:string|null}
export function returnBusJobKey(job:Omit<ReturnBusJob,'key'>){return createHash('sha256').update(JSON.stringify(['isolated-rendered-bus:v1',job.mount.key,job.profileFingerprint,job.evidenceMac,job.autoDecisionId,returnBusConfigSchema.parse(job.configuration)])).digest('hex')}
/** Frozen origin, private byte/decode review and explicit local profile only.
 * Reuses effective AUTO/OFF/MANUAL decisions; no default for missing evidence. */
export function planReturnBusAudio(...args:Parameters<typeof planReturnPostGainAudio>){
  const [origin,receipt]=args,base=planReturnPostGainAudio(...args)
  const assets=new Map(receipt.evidence.localAssets.map(([key,value])=>[key,value as unknown as MediaAsset]))
  const jobs:ReturnBusJob[]=[],issues=structuredClone(base.issues)
  for(const master of base.jobs.filter(job=>job.mount.role==='MASTER')){
    const mount=master.mount,issue={revisionId:mount.revisionId,itemId:mount.itemId,errors:[] as string[],warnings:[] as string[]};issues.push(issue)
    try{
      const edition=origin.entries.find(entry=>entry.revision.id===mount.revisionId),item=edition?.payload.items.find(item=>item.id===mount.itemId)
      const original=edition?.payload.assets?.find(asset=>asset.id===item?.mediaId),asset=original?assets.get(original.id+':'+original.contentHash):undefined
      if(!edition||!item||!asset||asset.contentHash!==mount.contentHash)throw new Error('LOCAL_BUS_MEDIA_UNPROVEN')
      const inputChannels=knownInputAudioChannels(asset,mount.audioTrack)
      if(inputChannels===undefined||inputChannels===0)throw new Error('LOCAL_BUS_INPUT_CHANNELS_UNPROVEN')
      const pairs=resolveAudio(item.audio,asset,mount.audioTrack,mount.trim).value.auxiliaryPairs??[]
      // Every declared auxiliary must have its own exact pre-gain proof.
      // The reused plan omits a job when that proof/contract is unavailable.
      const auxiliary=base.jobs.filter(job=>job.mount.revisionId===mount.revisionId&&job.mount.itemId===mount.itemId&&job.mount.role==='AUXILIARY')
      if(auxiliary.length!==pairs.length||pairs.some(pair=>!auxiliary.some(job=>job.mount.outputPair===pair.outputPair&&job.mount.contentHash===mount.contentHash&&job.mount.audioTrack===mount.audioTrack&&job.mount.trim.inNs===mount.trim.inNs&&job.mount.trim.outNs===mount.trim.outNs&&job.configuration.gainDb===(pair.gainDb??0))))throw new Error('LOCAL_BUS_AUXILIARY_EVIDENCE_MISSING')
      const configuration=returnBusConfigSchema.parse({audioTrack:mount.audioTrack,inputChannels,audioChannels:base.profile.audioChannels,routing:mount.routing,auxiliaryPairs:pairs,gainDb:master.configuration.gainDb,ceilingDbtp:base.profile.ceilingDbtp,trim:mount.trim})
      const identity={mount,configuration,profileFingerprint:base.profileFingerprint,evidenceMac:master.evidenceMac,autoDecisionId:master.autoDecisionId}
      jobs.push({...identity,key:returnBusJobKey(identity)})
      issue.warnings.push('LOCAL_BUS_CONTINUOUS_TRANSITION_AV_QUALIFICATION_PENDING')
    }catch(error){issue.errors.push(error instanceof Error&&/^LOCAL_BUS_[A-Z_]+$/.test(error.message)?error.message:'LOCAL_BUS_PLAN_INVALID')}
    if(jobs.length>100000||issues.length>100000)throw new Error('Plano bus excede limite; não truncar como pronto.')
  }
  if(new Set(jobs.map(job=>job.key)).size!==jobs.length)throw new Error('Jobs bus duplicados.')
  return {profile:base.profile,profileFingerprint:base.profileFingerprint,jobs,issues,busQualified:false as const,transitionQualified:false as const,avQualified:false as const,publicationAuthorized:false as const}
}
/** Private serial measurement; durable workflow must register intent first. */
export async function measureReturnBusPlan(plan:ReturnType<typeof planReturnBusAudio>,binary:string,signal:AbortSignal,alive:()=>void){
  signal.throwIfAborted();alive();const stamp=await localFileStamp(binary),runtimeHash=await probeRuntimeHash(binary)
  const entries:Array<{job:ReturnType<typeof returnBusJobIdentity>;status:'MEASURED'|'FAILED';receipt:Awaited<ReturnType<typeof runReturnBusMount>>|null}>=[]
  for(const job of plan.jobs){
    signal.throwIfAborted();alive()
    try{const receipt=await runReturnBusMount(binary,job.mount,job.configuration,signal,alive);if(receipt.runtimeHash!==runtimeHash)throw new Error('Runtime bus divergente.');entries.push({job:returnBusJobIdentity(job),status:'MEASURED',receipt})}
    catch{signal.throwIfAborted();alive();entries.push({job:returnBusJobIdentity(job),status:'FAILED',receipt:null})}
  }
  if(await localFileStamp(binary)!==stamp||await probeRuntimeHash(binary)!==runtimeHash)throw new Error('Runtime mudou durante medição bus.')
  signal.throwIfAborted();alive()
  return bindReturnBusEvidence(plan,{version:1,profileFingerprint:plan.profileFingerprint,runtimeHash,entries,issues:plan.issues,busQualified:false,transitionQualified:false,avQualified:false,publicationAuthorized:false})
}
