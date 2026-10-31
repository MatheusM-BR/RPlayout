import Database from 'better-sqlite3'
import {drizzle} from 'drizzle-orm/better-sqlite3'
import {eq} from 'drizzle-orm'
import {z} from 'zod'
import {createHash} from 'node:crypto'
import {resolve} from 'node:path'
import * as schema from '../db/schema.js'
import {copySealedReturnDatabase} from './ha-return-private-copy.js'
import {haReturnCandidateOriginRequest,readReturnCandidateOrigin} from './ha-return-candidate-origin.js'
import {haReturnBoundCandidateJob} from './ha-return-bound-candidate.js'
import {haReturnMediaReviewRequest,haReturnMediaReviewResult,decodePrivateReturnMediaEvidence} from './ha-return-media-review.js'
import {prepareReturnMediaVariants} from './ha-return-media-variants.js'
import {installationVault} from './secret-vault.js'
import {Checkpoints} from './checkpoints.js'
import {haResumeIntent} from './ha-recovery-cursor.js'
import {haReturnAutoDecisionRequest} from './ha-return-auto-decision.js'

const hash=z.string().regex(/^[a-f0-9]{64}$/)
export const haReturnMediaCandidateJob=z.object({mediaApplicationId:z.string().uuid(),applicationId:z.string().uuid(),candidate:haReturnCandidateOriginRequest,sourceDatabaseHash:hash,sourceDatabaseBytes:z.number().int().positive().max(256*1024*1024),vaultFingerprint:hash,recordedAt:z.string().datetime(),rate:z.object({num:z.number().int().positive(),den:z.number().int().positive()}).strict(),audioChannels:z.union([z.literal(2),z.literal(8),z.literal(16)]),mediaReview:haReturnMediaReviewRequest,reviewResult:haReturnMediaReviewResult,autoDecision:haReturnAutoDecisionRequest.optional(),encodedEvidence:z.string().max(16*1024*1024)}).strict().refine(v=>v.applicationId===v.mediaReview.applicationId&&v.candidate.channelId===v.mediaReview.channelId&&v.reviewResult.applicationDatabaseHash===v.sourceDatabaseHash)
/** Creates another quarantined derivative from bound.db; original files and
 * authority journals are never adopted or modified. Private worker only. */
export function materializeReturnMediaCandidate(source:Database.Database,sourceFile:string,targetFile:string,raw:unknown){
  const job=haReturnMediaCandidateJob.parse(raw),vault=installationVault(false)
  if(vault.fingerprint!==job.vaultFingerprint||resolve(source.name)!==resolve(sourceFile))throw new Error('Cofre/conexão de origem divergente.')
  const receipt=decodePrivateReturnMediaEvidence(job.mediaReview,job.reviewResult,job.encodedEvidence,job.sourceDatabaseHash)
  if(!receipt.result.bytesAndDecodeComplete||!job.autoDecision&&receipt.result.blockedMounts)throw new Error('Mídia/QC ainda bloqueados.')
  const copy=copySealedReturnDatabase(sourceFile,targetFile,{hash:job.sourceDatabaseHash,bytes:job.sourceDatabaseBytes,sourceId:job.applicationId,targetId:job.mediaApplicationId,sourceName:'bound.db',targetName:'media.db'})
  const target=new Database(resolve(targetFile),{fileMustExist:true}),db=drizzle(target,{schema})
  try{
    const rows=target.prepare('SELECT id,payload FROM ha_return_bound_origin LIMIT 2').all() as Array<{id:number;payload:string}>
    if(rows.length!==1||rows[0]!.id!==1)throw new Error('Proveniência de aplicação ausente.')
    const bound=z.object({version:z.literal(1),job:haReturnBoundCandidateJob,revisionIds:z.array(z.tuple([z.string(),z.string()])).max(128),inputBindingsApplied:z.literal(true),mediaValidated:z.literal(false),outputsApplied:z.literal(false),nativePrepared:z.literal(false),authorityTransferred:z.literal(false)}).strict().parse(JSON.parse(vault.decrypt(rows[0]!.payload,'ha-return-bound-origin:v1:'+job.applicationId)))
    if(bound.job.applicationId!==job.applicationId||JSON.stringify(bound.job.candidate)!==JSON.stringify(job.candidate)||bound.job.vaultFingerprint!==job.vaultFingerprint)throw new Error('Aplicação não corresponde ao candidato/cofre.')
    const origin=readReturnCandidateOrigin(target,job.candidate),prepared=prepareReturnMediaVariants(origin,receipt,bound.job.plan,job.rate,job.audioChannels,job.autoDecision)
    if(bound.revisionIds.length!==origin.entries.length||new Set(bound.revisionIds.map(([id])=>id)).size!==bound.revisionIds.length)throw new Error('Mapeamento incompleto.')
    const mapping=new Map<string,string>()
    target.pragma('query_only = OFF');target.pragma('trusted_schema = OFF');target.pragma('foreign_keys = ON');target.pragma('synchronous = FULL')
    db.transaction(tx=>{
      for(const variant of prepared.variants){
        const previous=bound.revisionIds.find(([id])=>id===variant.sourceRevisionId)?.[1],revision=previous?tx.select().from(schema.operationalPlaylistRevisions).where(eq(schema.operationalPlaylistRevisions.id,previous)).get():null
        if(!revision||revision.rundownId!==variant.payload.rundown.id)throw new Error('Edição da aplicação divergente.')
        const id='ha-return-media:'+createHash('sha256').update(JSON.stringify([job.mediaApplicationId,variant.id,receipt.result.evidenceMac])).digest('hex');mapping.set(variant.sourceRevisionId,id)
        if(tx.update(schema.operationalPlaylistRevisions).set({id,payload:variant.payload as unknown as Record<string,unknown>}).where(eq(schema.operationalPlaylistRevisions.id,previous!)).run().changes!==1)throw new Error('Edição não gravada.')
      }
      const execution=origin.entries.find(entry=>entry.revision.id===origin.job.request.executionRevisionId)!
      new Checkpoints(target).write({version:1,channelId:job.candidate.channelId,rundownId:execution.revision.rundownId,revisionId:mapping.get(execution.revision.id)!,itemId:null,elapsed:0,playing:false,realEngine:false})
      target.exec('CREATE TABLE ha_return_media_origin(id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL)')
      const cursor=origin.job.request.cursorPolicy==='RECEIVED_LAST_CONFIRMED'?origin.originalCursor:null
      target.prepare('INSERT INTO ha_return_media_origin VALUES(1,?)').run(vault.encrypt(JSON.stringify({version:1,job,revisionIds:[...mapping],intent:haResumeIntent(cursor,job.candidate.channelId,mapping,job.recordedAt),checks:prepared.variants.flatMap(variant=>variant.checks.map(check=>({...check,revisionId:variant.sourceRevisionId}))),mediaEvidenceApplied:true,...(job.autoDecision?{autoDecisionId:job.autoDecision.decisionId,autoAppliedMounts:prepared.autoAppliedMounts}:{}),...(receipt.result.graphics?{graphicRenderEvidenceApplied:true,graphics:receipt.result.graphics}:{}),...(receipt.result.audio?{audioEvidenceApplied:true,audio:receipt.result.audio}:{}),outputsApplied:false,nativePrepared:false,authorityTransferred:false,publicationAuthorized:false}),'ha-return-media-origin:v1:'+job.mediaApplicationId))
    })
    const channel=db.select().from(schema.channels).where(eq(schema.channels.id,job.candidate.channelId)).get()
    if(!channel?.archivedAt||channel.programSdiDeviceId||target.pragma('integrity_check',{simple:true})!=='ok'||(target.pragma('foreign_key_check') as unknown[]).length)throw new Error('Canal/integridade da derivada inválidos.')
    for(const name of ['output_profiles','live_sources','execution_owner_runs','distribution_owner_runs','as_run'])if((target.prepare('SELECT count(*) n FROM '+name).get() as {n:number}).n)throw new Error('Execução/saída indevida na derivada.')
    target.pragma('wal_checkpoint(TRUNCATE)');target.pragma('journal_mode = DELETE');copy.verifySource();copy.verifyTarget()
    const checks=prepared.variants.flatMap(variant=>variant.checks)
    return {version:1 as const,autoDecisionId:job.autoDecision?.decisionId,autoAppliedMounts:prepared.autoAppliedMounts??0,mediaApplicationId:job.mediaApplicationId,applicationId:job.applicationId,mediaReviewId:job.mediaReview.mediaReviewId,candidate:job.candidate,bindingPlanId:bound.job.plan.planId,bindingDigest:bound.job.plan.bindingDigest,evidenceMac:receipt.result.evidenceMac,selectedRevisions:prepared.variants.length,checkedMounts:checks.length,blockedMounts:checks.filter(check=>check.errors.length).length,livePending:checks.filter(check=>check.livePending).length,mixPending:checks.filter(check=>check.warnings.includes('LOCAL_SELECTED_MIX_RENDER_PENDING')||check.warnings.includes('LOCAL_SELECTED_AUDIO_POSTGAIN_BUS_QUALIFICATION_PENDING')).length,graphicPending:checks.filter(check=>check.warnings.includes('LOCAL_GRAPHIC_RENDER_PENDING')||check.warnings.includes('LOCAL_GRAPHIC_VISUAL_APPROVAL_PENDING')).length,...(receipt.result.graphics?{graphics:receipt.result.graphics,graphicRenderEvidenceApplied:true as const}:{}),...(receipt.result.audio?{audio:receipt.result.audio,audioEvidenceApplied:true as const}:{}),mediaEvidenceApplied:true as const,outputsApplied:false as const,nativePrepared:false as const,authorityTransferred:false as const,publicationAuthorized:false as const,vaultFingerprint:vault.fingerprint}
  }finally{target.close()}
}
