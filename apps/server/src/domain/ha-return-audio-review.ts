import {z} from 'zod'
import {validateAudioRouting,audioRoutingKey,type AudioRouting} from '@rplayout/protocol'
import {planReturnAudioMounts} from './ha-return-audio-mounts.js'
import {runReturnAudioMount,returnAudioReadingSchema,readReturnAudioMount} from './ha-return-audio-probe.js'
import {localFileStamp,probeRuntimeHash} from './ha-local-probe.js'

const count=z.number().int().nonnegative().max(100000),hash=z.string().regex(/^[a-f0-9]{64}$/),integer=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const routing=z.object({mode:z.enum(['DEFAULT','STEREO_1_2','STEREO_3_4','DOWNMIX_MONO','LEFT_ONLY','RIGHT_ONLY','MATRIX','PAIR_MIX']),matrix:z.array(z.array(z.number().finite()).max(64)).max(2).optional(),pairs:z.array(z.number().int()).max(32).optional()}).strict().refine(v=>!validateAudioRouting(v))
const trim=z.object({inNs:integer,outNs:integer}).strict().refine(v=>v.outNs-v.inNs>=400000000)
const mount=z.object({key:hash,revisionId:z.string().min(1).max(256),itemId:z.string().min(1).max(1024),role:z.enum(['MASTER','AUXILIARY']),outputPair:z.number().int().min(1).max(8),contentHash:hash,audioTrack:z.number().int().min(0).max(63),routing,trim,gainDb:z.number().finite().min(-60).max(12),mode:z.enum(['AUTO','MANUAL','OFF'])}).strict()
export const returnAudioMountIdentitySchema=mount
const receipt=z.object({mountKey:hash,contentHash:hash,audioTrack:z.number().int().min(0).max(63),routing,trim,runtimeHash:hash,checkedAt:z.string().datetime(),reading:returnAudioReadingSchema,preGainMeasured:z.literal(true),postGainQualified:z.literal(false),busQualified:z.literal(false),editorialApproved:z.literal(false),publicationAuthorized:z.literal(false)}).strict().refine(v=>{try{readReturnAudioMount(v.reading,v.trim);return true}catch{return false}})
export const returnAudioSummarySchema=z.object({required:count,measured:count,failed:count,unavailable:count,planBlocked:count,shortCuts:count,postGainQualified:z.literal(false),busQualified:z.literal(false),publicationAuthorized:z.literal(false)}).strict().refine(v=>v.required===v.measured+v.failed+v.unavailable)
export const returnAudioEvidenceSchema=z.object({version:z.literal(1),runtimeHash:hash.nullable(),issues:z.array(z.object({revisionId:z.string(),itemId:z.string(),errors:z.array(z.string()),warnings:z.array(z.string())}).strict()).max(100000),entries:z.array(z.object({mount,status:z.enum(['MEASURED','FAILED','UNAVAILABLE']),receipt:receipt.nullable()}).strict().refine(v=>v.status==='MEASURED'?!!v.receipt&&v.receipt.mountKey===v.mount.key&&v.receipt.contentHash===v.mount.contentHash&&v.receipt.audioTrack===v.mount.audioTrack&&audioRoutingKey(v.receipt.routing)===audioRoutingKey(v.mount.routing)&&JSON.stringify(v.receipt.trim)===JSON.stringify(v.mount.trim):v.receipt===null)).max(100000)}).strict().refine(v=>new Set(v.entries.map(row=>row.mount.key)).size===v.entries.length&&v.entries.every(row=>!row.receipt||row.receipt.runtimeHash===v.runtimeHash))
export function summarizeReturnAudio(raw:unknown){
  const evidence=returnAudioEvidenceSchema.parse(raw)
  return returnAudioSummarySchema.parse({required:evidence.entries.length,measured:evidence.entries.filter(row=>row.status==='MEASURED').length,failed:evidence.entries.filter(row=>row.status==='FAILED').length,unavailable:evidence.entries.filter(row=>row.status==='UNAVAILABLE').length,planBlocked:evidence.issues.filter(row=>row.errors.length).length,shortCuts:evidence.issues.filter(row=>row.warnings.includes('LOCAL_AUDIO_SHORT_CUT_QUALIFICATION_PENDING')).length,postGainQualified:false,busQualified:false,publicationAuthorized:false})
}
/** Serial under existing media review. Private paths remain only in the plan,
 * never in persisted receipts or aggregate API response. No AUTO substitution. */
export async function reviewReturnAudio(plan:ReturnType<typeof planReturnAudioMounts>,binary:string|null,signal:AbortSignal,alive:()=>void,runner:typeof runReturnAudioMount=runReturnAudioMount){
  signal.throwIfAborted();alive()
  let stamp:string|null=null,runtimeHash:string|null=null
  if(binary&&plan.mounts.length)try{stamp=await localFileStamp(binary);runtimeHash=await probeRuntimeHash(binary)}catch{signal.throwIfAborted();alive();binary=null}
  const entries:z.infer<typeof returnAudioEvidenceSchema>['entries']=[]
  for(const job of plan.mounts){
    signal.throwIfAborted();alive()
    const {path,...identity}=job,selected=mount.parse(identity)
    let status:'MEASURED'|'FAILED'|'UNAVAILABLE'='UNAVAILABLE',reading:z.infer<typeof receipt>|null=null
    if(binary)try{
      reading=receipt.parse(await runner(binary,job,signal,alive))
      if(reading.mountKey!==selected.key||reading.contentHash!==selected.contentHash||reading.audioTrack!==selected.audioTrack||audioRoutingKey(reading.routing as AudioRouting)!==audioRoutingKey(selected.routing)||JSON.stringify(reading.trim)!==JSON.stringify(selected.trim)||reading.runtimeHash!==runtimeHash)throw new Error('Medidor não confirmou montagem/runtime selecionados.')
      status='MEASURED'
    }catch{signal.throwIfAborted();alive();status='FAILED';reading=null}
    entries.push({mount:selected,status,receipt:reading})
  }
  if(binary&&plan.mounts.length&&(await localFileStamp(binary)!==stamp||await probeRuntimeHash(binary)!==runtimeHash))throw new Error('Runtime de áudio mudou durante revisão.')
  signal.throwIfAborted();alive()
  const evidence=returnAudioEvidenceSchema.parse({version:1,runtimeHash,issues:plan.issues,entries})
  return {evidence,summary:summarizeReturnAudio(evidence)}
}
