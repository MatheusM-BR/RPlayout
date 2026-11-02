import {createHash} from 'node:crypto'
import {z} from 'zod'
import {audioRoutingKey} from '@rplayout/protocol'
import {returnAudioMountIdentitySchema} from './ha-return-audio-review.js'
import {returnAudioMountKey} from './ha-return-audio-mounts.js'
import {readReturnPostGainAudioMount,returnPostGainConfig,returnPostGainReadingSchema} from './ha-return-audio-probe.js'
import type {planReturnPostGainAudio,ReturnPostGainJob} from './ha-return-postgain-plan.js'

const hash=z.string().regex(/^[a-f0-9]{64}$/),count=z.number().int().nonnegative().max(100000)
const trim=returnAudioMountIdentitySchema.shape.trim,routing=returnAudioMountIdentitySchema.shape.routing
const receipt=z.object({mountKey:hash,contentHash:hash,audioTrack:z.number().int().min(0).max(63),routing,trim,runtimeHash:hash,checkedAt:z.string().datetime(),reading:returnPostGainReadingSchema,postGainMeasured:z.literal(true),isolatedLimiterRendered:z.literal(true),postGainQualified:z.literal(false),busQualified:z.literal(false),transitionQualified:z.literal(false),editorialApproved:z.literal(false),publicationAuthorized:z.literal(false)}).strict()
const identity=z.object({key:hash,mount:returnAudioMountIdentitySchema,configuration:returnPostGainConfig,profileFingerprint:hash,evidenceMac:z.string().regex(/^[A-Za-z0-9_-]{43}$/),autoDecisionId:z.string().uuid().nullable()}).strict()
const entry=z.object({job:identity,status:z.enum(['MEASURED','FAILED']),receipt:receipt.nullable()}).strict().refine(row=>{
  const job=row.job,proof=row.receipt
  if(job.mount.key!==returnAudioMountKey(job.mount)||job.key!==postGainIdentityKey(job))return false
  if(row.status==='FAILED')return proof===null
  if(!proof||proof.mountKey!==job.mount.key||proof.contentHash!==job.mount.contentHash||proof.audioTrack!==job.mount.audioTrack||audioRoutingKey(proof.routing)!==audioRoutingKey(job.mount.routing)||JSON.stringify(proof.trim)!==JSON.stringify(job.mount.trim))return false
  try{readReturnPostGainAudioMount(proof.reading,job.mount.trim,job.configuration);return true}catch{return false}
})
export const returnPostGainEvidenceSchema=z.object({version:z.literal(1),profileFingerprint:hash,runtimeHash:hash,entries:z.array(entry).max(100000),issues:z.array(z.object({revisionId:z.string().min(1).max(256),itemId:z.string().min(1).max(1024),errors:z.array(z.string().max(512)).max(1000),warnings:z.array(z.string().max(512)).max(1000)}).strict()).max(100000),postGainQualified:z.literal(false),busQualified:z.literal(false),transitionQualified:z.literal(false),publicationAuthorized:z.literal(false)}).strict().refine(value=>new Set(value.entries.map(row=>row.job.key)).size===value.entries.length&&value.entries.every(row=>row.job.profileFingerprint===value.profileFingerprint&&(!row.receipt||row.receipt.runtimeHash===value.runtimeHash)))
export const returnPostGainSummarySchema=z.object({required:count,measured:count,failed:count,planBlocked:count,postGainQualified:z.literal(false),busQualified:z.literal(false),transitionQualified:z.literal(false),editorialApproved:z.literal(false),publicationAuthorized:z.literal(false)}).strict().refine(value=>value.required===value.measured+value.failed)

function postGainIdentityKey(job:z.infer<typeof identity>){return createHash('sha256').update(JSON.stringify(['isolated-postgain:v1',job.mount.key,job.profileFingerprint,job.evidenceMac,job.autoDecisionId,job.configuration])).digest('hex')}
/** Persistable identity excludes local paths. Recompute/bind against the current
 * trusted server plan before accepting a historical receipt for any use. */
export function returnPostGainJobIdentity(job:ReturnPostGainJob){const {path,...mount}=job.mount;return identity.parse({...job,mount})}
export function summarizeReturnPostGain(raw:unknown){const value=returnPostGainEvidenceSchema.parse(raw);return returnPostGainSummarySchema.parse({required:value.entries.length,measured:value.entries.filter(row=>row.status==='MEASURED').length,failed:value.entries.filter(row=>row.status==='FAILED').length,planBlocked:value.issues.filter(row=>row.errors.length).length,postGainQualified:false,busQualified:false,transitionQualified:false,editorialApproved:false,publicationAuthorized:false})}
export function bindReturnPostGainEvidence(plan:ReturnType<typeof planReturnPostGainAudio>,raw:unknown){
  const value=returnPostGainEvidenceSchema.parse(raw)
  if(value.profileFingerprint!==plan.profileFingerprint||value.entries.length!==plan.jobs.length||JSON.stringify(value.issues)!==JSON.stringify(plan.issues))throw new Error('Evidência pós-ganho não corresponde ao plano atual.')
  for(let index=0;index<plan.jobs.length;index++)if(JSON.stringify(value.entries[index]!.job)!==JSON.stringify(returnPostGainJobIdentity(plan.jobs[index]!)))throw new Error('Evidência pós-ganho diverge do corte/mix/perfil/decisão selecionados.')
  return {evidence:value,summary:summarizeReturnPostGain(value)}
}
