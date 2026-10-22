import {z} from 'zod'
import {audioRoutingKey} from '@rplayout/protocol'
import {returnAudioMountIdentitySchema} from './ha-return-audio-review.js'
import {returnAudioMountKey} from './ha-return-audio-mounts.js'
import {readReturnBus,returnBusConfigSchema,returnBusReadingSchema} from './ha-return-bus-reading.js'
import {returnBusJobKey,type ReturnBusJob,type planReturnBusAudio} from './ha-return-bus-plan.js'

const hash=z.string().regex(/^[a-f0-9]{64}$/),count=z.number().int().nonnegative().max(100000)
const identity=z.object({key:hash,mount:returnAudioMountIdentitySchema,configuration:returnBusConfigSchema,profileFingerprint:hash,evidenceMac:z.string().regex(/^[A-Za-z0-9_-]{43}$/),autoDecisionId:z.string().uuid().nullable()}).strict()
const receipt=z.object({mountKey:hash,contentHash:hash,audioTrack:z.number().int().min(0).max(63),routing:returnAudioMountIdentitySchema.shape.routing,trim:returnAudioMountIdentitySchema.shape.trim,runtimeHash:hash,checkedAt:z.string().datetime(),reading:returnBusReadingSchema,isolatedBusRendered:z.literal(true),postGainQualified:z.literal(false),busQualified:z.literal(false),transitionQualified:z.literal(false),avQualified:z.literal(false),editorialApproved:z.literal(false),publicationAuthorized:z.literal(false)}).strict()
const entry=z.object({job:identity,status:z.enum(['MEASURED','FAILED']),receipt:receipt.nullable()}).strict().refine(row=>{
  const job=row.job,proof=row.receipt,config=job.configuration,mount=job.mount
  if(mount.role!=='MASTER'||mount.outputPair!==1||mount.key!==returnAudioMountKey(mount)||job.key!==returnBusJobKey({...job,mount:{...mount,path:''}})||config.audioTrack!==mount.audioTrack||audioRoutingKey(config.routing)!==audioRoutingKey(mount.routing)||config.trim.inNs!==mount.trim.inNs||config.trim.outNs!==mount.trim.outNs)return false
  if(row.status==='FAILED')return proof===null
  if(!proof||proof.mountKey!==mount.key||proof.contentHash!==mount.contentHash||proof.audioTrack!==mount.audioTrack||audioRoutingKey(proof.routing)!==audioRoutingKey(mount.routing)||proof.trim.inNs!==mount.trim.inNs||proof.trim.outNs!==mount.trim.outNs)return false
  try{readReturnBus(proof.reading,config);return true}catch{return false}
})
export const returnBusEvidenceSchema=z.object({version:z.literal(1),profileFingerprint:hash,runtimeHash:hash,entries:z.array(entry).max(100000),issues:z.array(z.object({revisionId:z.string().min(1).max(256),itemId:z.string().min(1).max(1024),errors:z.array(z.string().max(512)).max(1000),warnings:z.array(z.string().max(512)).max(1000)}).strict()).max(100000),busQualified:z.literal(false),transitionQualified:z.literal(false),avQualified:z.literal(false),publicationAuthorized:z.literal(false)}).strict().refine(value=>new Set(value.entries.map(row=>row.job.key)).size===value.entries.length&&value.entries.every(row=>row.job.profileFingerprint===value.profileFingerprint&&(!row.receipt||row.receipt.runtimeHash===value.runtimeHash)))
export const returnBusSummarySchema=z.object({required:count,measured:count,failed:count,planBlocked:count,busQualified:z.literal(false),transitionQualified:z.literal(false),avQualified:z.literal(false),editorialApproved:z.literal(false),publicationAuthorized:z.literal(false)}).strict().refine(value=>value.required===value.measured+value.failed)
export function returnBusJobIdentity(job:ReturnBusJob){const {path,...mount}=job.mount;return identity.parse({...job,mount})}
export function summarizeReturnBus(raw:unknown){const value=returnBusEvidenceSchema.parse(raw);return returnBusSummarySchema.parse({required:value.entries.length,measured:value.entries.filter(row=>row.status==='MEASURED').length,failed:value.entries.filter(row=>row.status==='FAILED').length,planBlocked:value.issues.filter(row=>row.errors.length).length,busQualified:false,transitionQualified:false,avQualified:false,editorialApproved:false,publicationAuthorized:false})}
/** No imported receipt is reusable without exact current private server plan. */
export function bindReturnBusEvidence(plan:ReturnType<typeof planReturnBusAudio>,raw:unknown){
  const value=returnBusEvidenceSchema.parse(raw)
  if(value.profileFingerprint!==plan.profileFingerprint||value.entries.length!==plan.jobs.length||JSON.stringify(value.issues)!==JSON.stringify(plan.issues))throw new Error('Evidência bus não corresponde ao plano atual.')
  for(let index=0;index<plan.jobs.length;index++)if(JSON.stringify(value.entries[index]!.job)!==JSON.stringify(returnBusJobIdentity(plan.jobs[index]!)))throw new Error('Evidência bus diverge do perfil/corte/mix/decisão.')
  return {evidence:value,summary:summarizeReturnBus(value)}
}
