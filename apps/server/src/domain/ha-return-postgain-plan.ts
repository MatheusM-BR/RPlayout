import {createHash} from 'node:crypto'
import {z} from 'zod'
import {effectiveGainDb,hasMatchingAudioMeasurement,resolveAudio,type MediaAsset} from '@rplayout/protocol'
import type {readReturnCandidateOrigin} from './ha-return-candidate-origin.js'
import type {HaReturnMediaReviews} from './ha-return-media-review.js'
import {bindReturnAudioEvidence} from './ha-return-audio-application.js'
import {planReturnAudioMounts,type ReturnAudioMount} from './ha-return-audio-mounts.js'
import {prepareReturnAutoDecision} from './ha-return-auto-decision.js'
import {returnPostGainConfig,runReturnPostGainAudioMount} from './ha-return-audio-probe.js'
import {localFileStamp,probeRuntimeHash} from './ha-local-probe.js'
import {bindReturnPostGainEvidence,returnPostGainJobIdentity} from './ha-return-postgain-evidence.js'
import type {HaSnapshot} from './ha-replication.js'

/** Server-captured local configuration, not an HTTP body or default inferred
 * from foreign channel metadata. Caller must reconfirm its identity. */
export const returnPostGainProfile=z.object({channelId:z.string().min(1).max(128),targetLufs:z.number().finite().min(-70).max(0),ceilingDbtp:z.number().finite().min(-30).max(0),audioChannels:z.union([z.literal(2),z.literal(8),z.literal(16)]),rate:z.object({num:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),den:z.number().int().positive().max(Number.MAX_SAFE_INTEGER)}).strict()}).strict()
/** Only the local server snapshot; never pass a request body as snapshot. */
export function captureReturnPostGainProfile(snapshot:HaSnapshot,channelId:string){
  const channels=snapshot.channels.filter(row=>row.channelId===channelId)
  if(channels.length!==1)throw new Error('Perfil pós-ganho exige um único canal local.')
  const local=z.object({id:z.string(),targetLufs:z.number(),ceilingDbtp:z.number(),audioChannels:z.number(),rateNum:z.number(),rateDen:z.number()}).passthrough().parse(channels[0]!.configuration.channel)
  if(local.id!==channelId)throw new Error('Identidade do canal local diverge do snapshot.')
  return returnPostGainProfile.parse({channelId,targetLufs:local.targetLufs,ceilingDbtp:local.ceilingDbtp,audioChannels:local.audioChannels,rate:{num:local.rateNum,den:local.rateDen}})
}
export interface ReturnPostGainJob {key:string;mount:ReturnAudioMount;configuration:z.infer<typeof returnPostGainConfig>;profileFingerprint:string;evidenceMac:string;autoDecisionId:string|null}
type Origin=ReturnType<typeof readReturnCandidateOrigin>
type Receipt=ReturnType<HaReturnMediaReviews['privateEvidence']>
export function planReturnPostGainAudio(origin:Origin,receipt:Receipt,profileRaw:unknown,autoDecisionRaw?:unknown){
  const profile=returnPostGainProfile.parse(profileRaw)
  if(profile.channelId!==origin.channel.id||receipt.request.channelId!==profile.channelId||!receipt.result.bytesAndDecodeComplete||origin.entries.some(entry=>entry.payload.rate?.num!==profile.rate.num||entry.payload.rate?.den!==profile.rate.den||entry.payload.audioChannels!==profile.audioChannels))throw new Error('Perfil/cadência/barramento não correspondem às edições revisadas.')
  const assets=new Map(receipt.evidence.localAssets.map(([key,value])=>[key,value as unknown as MediaAsset])),bound=bindReturnAudioEvidence(origin,assets,receipt.evidence.audio)
  if(!bound)throw new Error('Evidência de montagem ausente; nova revisão necessária.')
  const plan=planReturnAudioMounts(origin,assets),auto=autoDecisionRaw===undefined?null:prepareReturnAutoDecision(origin,receipt,autoDecisionRaw),profileFingerprint=createHash('sha256').update(JSON.stringify(profile)).digest('hex')
  const receipts=new Map(bound.evidence.entries.map(row=>[row.mount.key,row])),jobs:ReturnPostGainJob[]=[],issues=structuredClone(plan.issues)
  for(const mount of plan.mounts){
    const issue={revisionId:mount.revisionId,itemId:mount.itemId,errors:[] as string[],warnings:[] as string[]};issues.push(issue)
    try{
      const proof=receipts.get(mount.key)
      if(proof?.status!=='MEASURED'||!proof.receipt)throw new Error('LOCAL_POSTGAIN_PREGAIN_EVIDENCE_MISSING')
      const edition=origin.entries.find(entry=>entry.revision.id===mount.revisionId),item=edition?.payload.items.find(item=>item.id===mount.itemId)
      if(!edition||!item)throw new Error('LOCAL_POSTGAIN_CONTINGENCY_CONTRACT_PENDING')
      if(item.sourceRef||item.liveEndpoint||item.liveConfig?.sourceEndpoint)throw new Error('LOCAL_POSTGAIN_LIVE_CONTRACT_PENDING')
      const original=edition.payload.assets?.find(asset=>asset.id===item.mediaId),asset=original?assets.get(original.id+':'+original.contentHash):undefined
      if(!asset||asset.contentHash!==mount.contentHash)throw new Error('LOCAL_POSTGAIN_MEDIA_UNPROVEN')
      let gainDb=mount.gainDb
      if(mount.role==='MASTER'){
        const override=auto?.overrides.find(row=>row.revisionId===mount.revisionId&&row.itemId===mount.itemId)
        const audio=override?.audio??resolveAudio(item.audio,asset,item.audioTrack??0,mount.trim).value
        if(audio.mode==='AUTO'&&!hasMatchingAudioMeasurement(audio,asset.contentHash,item.audioTrack??0,mount.trim))throw new Error('LOCAL_POSTGAIN_AUTO_DECISION_REQUIRED')
        gainDb=effectiveGainDb(audio,profile.targetLufs,profile.ceilingDbtp)
      }
      const parsed=returnPostGainConfig.safeParse({gainDb,ceilingDbtp:profile.ceilingDbtp,tailPolicy:'COMPENSATE_AND_FLUSH'})
      if(!parsed.success)throw new Error('LOCAL_POSTGAIN_EFFECTIVE_GAIN_UNSUPPORTED')
      const configuration=parsed.data,autoDecisionId=auto?.request.decisionId??null
      const key=createHash('sha256').update(JSON.stringify(['isolated-postgain:v1',mount.key,profileFingerprint,receipt.result.evidenceMac,autoDecisionId,configuration])).digest('hex')
      jobs.push({key,mount,configuration,profileFingerprint,evidenceMac:receipt.result.evidenceMac,autoDecisionId})
      issue.warnings.push('LOCAL_POSTGAIN_BUS_TRANSITION_AV_QUALIFICATION_PENDING')
    }catch(error){issue.errors.push(error instanceof Error&&/^LOCAL_POSTGAIN_[A-Z_]+$/.test(error.message)?error.message:'LOCAL_POSTGAIN_PLAN_INVALID')}
    if(jobs.length>100000||issues.length>100000)throw new Error('Plano pós-ganho excede limite; não truncar como completo.')
  }
  if(new Set(jobs.map(job=>job.key)).size!==jobs.length)throw new Error('Jobs pós-ganho duplicados.')
  return {profile,profileFingerprint,jobs,issues,postGainQualified:false as const,busQualified:false as const,transitionQualified:false as const,publicationAuthorized:false as const}
}
/** Internal, serial native work. Results remain private until a durable,
 * authenticated workflow persists them; not an API response or approval. */
export async function measureReturnPostGainPlan(plan:ReturnType<typeof planReturnPostGainAudio>,binary:string,signal:AbortSignal,alive:()=>void){
  signal.throwIfAborted();alive()
  const stamp=await localFileStamp(binary),runtimeHash=await probeRuntimeHash(binary)
  const entries:Array<{job:ReturnType<typeof returnPostGainJobIdentity>;status:'MEASURED'|'FAILED';receipt:Awaited<ReturnType<typeof runReturnPostGainAudioMount>>|null}>=[]
  for(const job of plan.jobs){
    signal.throwIfAborted();alive()
    try{
      const receipt=await runReturnPostGainAudioMount(binary,job.mount,job.configuration,signal,alive)
      if(receipt.runtimeHash!==runtimeHash||receipt.mountKey!==job.mount.key||receipt.reading.processing.gainDb!==job.configuration.gainDb||receipt.reading.processing.ceilingDbtp!==job.configuration.ceilingDbtp)throw new Error('Recibo pós-ganho não corresponde ao plano/runtime.')
      entries.push({job:returnPostGainJobIdentity(job),status:'MEASURED',receipt})
    }catch{signal.throwIfAborted();alive();entries.push({job:returnPostGainJobIdentity(job),status:'FAILED',receipt:null})}
  }
  if(await localFileStamp(binary)!==stamp||await probeRuntimeHash(binary)!==runtimeHash)throw new Error('Runtime mudou durante medição pós-ganho.')
  signal.throwIfAborted();alive()
  return bindReturnPostGainEvidence(plan,{version:1,profileFingerprint:plan.profileFingerprint,runtimeHash,entries,issues:plan.issues,postGainQualified:false,busQualified:false,transitionQualified:false,publicationAuthorized:false})
}
