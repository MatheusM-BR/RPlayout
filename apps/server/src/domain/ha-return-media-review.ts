import type Database from 'better-sqlite3'
import {z} from 'zod'
import {installationVault} from './secret-vault.js'
import type {inspectReturnLocalMedia} from './ha-return-local-media.js'
import {localProbeSchema} from './ha-local-probe.js'
import {returnAudioEvidenceSchema,returnAudioSummarySchema,summarizeReturnAudio} from './ha-return-audio-review.js'
import {returnGraphicEvidenceSchema,returnGraphicSummarySchema,summarizeReturnGraphics} from './ha-return-graphics-review.js'

export const HA_RETURN_MEDIA_REVIEW_RESERVE=64*1024*1024
export const haReturnMediaReviewRequest=z.object({mediaReviewId:z.string().uuid(),applicationId:z.string().uuid(),channelId:z.string().min(1).max(128),inventoryMac:z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),mediaChoices:z.array(z.object({contentHash:z.string().regex(/^[a-f0-9]{64}$/),localAssetId:z.string().min(1).max(128)}).strict()).max(1000).optional()}).strict().refine(v=>!(v.mediaChoices?.length)||!!v.inventoryMac).refine(v=>new Set(v.mediaChoices?.map(row=>row.contentHash)).size===(v.mediaChoices?.length??0))
const issue=z.object({revisionId:z.string(),itemId:z.string(),title:z.string().optional(),errors:z.array(z.string()),warnings:z.array(z.string()),livePending:z.boolean()}).strict()
const resultSchema=z.object({applicationDatabaseHash:z.string().regex(/^[a-f0-9]{64}$/),evidenceMac:z.string().regex(/^[A-Za-z0-9_-]{43}$/),runtimeHash:z.string().regex(/^[a-f0-9]{64}$/),checkedAt:z.string().datetime(),requiredHashes:z.number().int().nonnegative().max(100000),verifiedHashes:z.number().int().nonnegative().max(100000),bytesAndDecodeComplete:z.boolean(),checkedMounts:z.number().int().nonnegative().max(100000),blockedMounts:z.number().int().nonnegative().max(100000),livePending:z.number().int().nonnegative().max(100000),mixPending:z.number().int().nonnegative().max(100000),graphics:returnGraphicSummarySchema.optional(),audio:returnAudioSummarySchema.optional(),issues:z.array(issue).max(200),issuesTruncated:z.boolean(),publicationAuthorized:z.literal(false),operationalReady:z.literal(false)}).strict().refine(v=>v.verifiedHashes<=v.requiredHashes&&v.blockedMounts<=v.checkedMounts&&v.bytesAndDecodeComplete===(v.verifiedHashes===v.requiredHashes))
export const haReturnMediaReviewResult=resultSchema
const recordSchema=z.object({version:z.literal(1),request:haReturnMediaReviewRequest,owner:z.string(),phase:z.enum(['ACCEPTED','CHECKING','REVIEWED','FAILED']),quotaBytes:z.literal(HA_RETURN_MEDIA_REVIEW_RESERVE),updatedAt:z.string().datetime(),result:resultSchema.nullable(),privateEvidence:z.string().nullable()}).strict().refine(v=>v.phase!=='REVIEWED'||!!v.result&&!!v.privateEvidence)
const digest=z.string().regex(/^[a-f0-9]{64}$/),key=z.string().min(1).max(512)
const privateAsset=z.object({id:z.string().min(1).max(256),contentHash:digest,path:z.string().max(32768),kind:z.enum(['VIDEO','AUDIO','STILL'])}).passthrough()
const nativeEvidence=z.object({local:privateAsset,qcStatus:z.string().nullable(),stamp:z.string().min(1).max(2048),validation:z.object({decoded:z.boolean(),probe:localProbeSchema.nullable(),loudnessFile:z.unknown(),checks:z.object({playable:z.boolean(),errors:z.array(z.string()),warnings:z.array(z.string())}).strict()}).strict()}).strict()
export const haReturnPrivateMediaEvidence=z.object({version:z.literal(1),request:haReturnMediaReviewRequest,applicationHash:digest,checkedAt:z.string().datetime(),runtimeHash:digest,inventoryIdentity:z.string().max(16*1024*1024),required:z.array(z.tuple([key,privateAsset])).max(100000),evidence:z.array(z.tuple([digest,nativeEvidence.nullable()])).max(100000),localAssets:z.array(z.tuple([key,privateAsset])).max(100000),mounts:z.array(issue).max(100000),graphics:returnGraphicEvidenceSchema.optional(),audio:returnAudioEvidenceSchema.optional()}).strict()
/** Worker-safe verifier of exact encoded proof, not an ownership/admission grant. */
export function decodePrivateReturnMediaEvidence(requestRaw:unknown,resultRaw:unknown,encodedEvidence:string,applicationHash:string){
  const request=haReturnMediaReviewRequest.parse(requestRaw),result=resultSchema.parse(resultRaw)
  if(Buffer.byteLength(encodedEvidence)>16*1024*1024||result.applicationDatabaseHash!==applicationHash||installationVault(false).reviewIdentity(encodedEvidence,'ha-return-media-evidence:v1:'+request.mediaReviewId)!==result.evidenceMac)throw new Error('MAC/aplicação de mídia divergente.')
  const evidence=haReturnPrivateMediaEvidence.parse(JSON.parse(encodedEvidence))
  if(Boolean(evidence.audio)!==Boolean(result.audio)||evidence.audio&&JSON.stringify(summarizeReturnAudio(evidence.audio))!==JSON.stringify(result.audio))throw new Error('Evidência de áudio diverge do relatório.')
  if(evidence.audio){
    const mounts=new Map(evidence.mounts.map(mount=>[JSON.stringify([mount.revisionId,mount.itemId]),mount]))
    for(const entry of evidence.audio.entries){const mount=mounts.get(JSON.stringify([entry.mount.revisionId,entry.mount.itemId]));if(!mount||entry.status==='FAILED'&&!mount.errors.includes('LOCAL_SELECTED_AUDIO_RENDER_FAILED')||entry.status==='UNAVAILABLE'&&!mount.warnings.includes('LOCAL_SELECTED_AUDIO_RUNTIME_UNAVAILABLE')||entry.status==='MEASURED'&&!mount.warnings.includes('LOCAL_SELECTED_AUDIO_POSTGAIN_BUS_QUALIFICATION_PENDING'))throw new Error('Recibo de áudio diverge da montagem publicada.')}
  }
  if(Boolean(evidence.graphics)!==Boolean(result.graphics)||evidence.graphics&&JSON.stringify(summarizeReturnGraphics(evidence.graphics))!==JSON.stringify(result.graphics))throw new Error('Evidência gráfica diverge do relatório.')
  if(evidence.graphics){
    const mounts=new Map<string,typeof evidence.mounts>()
    for(const mount of evidence.mounts){const key=JSON.stringify([mount.revisionId,mount.itemId]),rows=mounts.get(key)??[];rows.push(mount);mounts.set(key,rows)}
    for(const entry of evidence.graphics.entries){
      const mount=mounts.get(JSON.stringify([entry.revisionId,entry.itemId]))?.shift()
      if(!mount||entry.status==='FAILED'&&!mount.errors.includes('LOCAL_GRAPHIC_RENDER_FAILED')||entry.status==='UNAVAILABLE'&&!mount.warnings.includes('LOCAL_GRAPHIC_RUNTIME_UNAVAILABLE')||entry.status==='RENDERED'&&(mount.errors.length||!mount.warnings.includes('LOCAL_GRAPHIC_VISUAL_APPROVAL_PENDING'))||entry.status==='BLOCKED'&&!mount.errors.length)throw new Error('Composição gráfica diverge da montagem publicada.')
    }
  }
  if(JSON.stringify(evidence.request)!==JSON.stringify(request)||evidence.applicationHash!==applicationHash||evidence.runtimeHash!==result.runtimeHash||evidence.checkedAt!==result.checkedAt||evidence.mounts.length!==result.checkedMounts||evidence.mounts.filter(mount=>mount.errors.length).length!==result.blockedMounts||evidence.mounts.filter(mount=>mount.livePending).length!==result.livePending||evidence.mounts.filter(mount=>mount.warnings.includes('LOCAL_SELECTED_MIX_RENDER_PENDING')).length!==result.mixPending||evidence.evidence.length!==result.requiredHashes||evidence.evidence.filter(([,proof])=>proof?.validation.decoded).length!==result.verifiedHashes||new Set(evidence.evidence.map(([hash])=>hash)).size!==evidence.evidence.length||new Set(evidence.required.map(([key])=>key)).size!==evidence.required.length||new Set(evidence.localAssets.map(([key])=>key)).size!==evidence.localAssets.length)throw new Error('Inventário privado diverge do relatório.')
  return {request,result,evidence,encodedEvidence,confirmationIsHistorical:true as const,operationalReady:false as const}
}

/** Private proof is encrypted in this journal, never included in query(). */
export class HaReturnMediaReviews{
  closeInterrupted(id:string,channelId:string,expectedPhase:string,expectedUpdatedAt:string,stopped:(owner:string)=>void){
    const value=this.read(id,channelId)
    if(!['ACCEPTED','CHECKING'].includes(value.phase)||value.phase!==expectedPhase||value.updatedAt!==expectedUpdatedAt||value.result||value.privateEvidence)throw new Error('Revisão mudou ou contém confirmação; não encerrar.')
    stopped(value.owner);this.write({...value,phase:'FAILED',updatedAt:new Date().toISOString()})
  }
  constructor(private readonly db:Database.Database,private readonly context:string,private readonly owner:string){db.exec('CREATE TABLE IF NOT EXISTS ha_return_media_reviews(media_review_id TEXT PRIMARY KEY,application_id TEXT NOT NULL,channel_id TEXT NOT NULL,payload TEXT NOT NULL)')}
  private key(id:string){return 'ha-return-media-review:v1:'+this.context+':'+id}
  private read(id:string,channelId:string){const row=this.db.prepare('SELECT * FROM ha_return_media_reviews WHERE media_review_id=?').get(z.string().uuid().parse(id)) as {media_review_id:string;application_id:string;channel_id:string;payload:string}|undefined;if(!row)throw new Error('Revisão de mídia não registrada.');const value=recordSchema.parse(JSON.parse(installationVault(false).decrypt(row.payload,this.key(id))));if(value.request.mediaReviewId!==row.media_review_id||value.request.applicationId!==row.application_id||value.request.channelId!==row.channel_id||row.channel_id!==channelId)throw new Error('Revisão diverge da intenção/canal.');return value}
  query(id:string,channelId:string){const {owner,privateEvidence,...record}=this.read(id,channelId);return {...record,ownedHere:owner===this.owner,confirmationIsHistorical:true as const,operationalReady:false as const}}
  /** Server-only. Never return paths/probes from this method in an API reply. */
  privateEvidence(id:string,channelId:string,applicationHash:string){
    const record=this.read(id,channelId),result=record.result,raw=record.privateEvidence
    if(record.owner!==this.owner||record.phase!=='REVIEWED'||!result||!raw)throw new Error('Evidência própria confirmada ausente.')
    return decodePrivateReturnMediaEvidence(record.request,result,raw,applicationHash)
  }
  existing(raw:unknown){const request=haReturnMediaReviewRequest.parse(raw);if(!this.db.prepare('SELECT 1 FROM ha_return_media_reviews WHERE media_review_id=?').get(request.mediaReviewId))return null;const value=this.query(request.mediaReviewId,request.channelId);if(JSON.stringify(value.request)!==JSON.stringify(request))throw new Error('UUID de mídia pertence a outra intenção.');return value}
  reservedBytes(){return (this.db.prepare('SELECT count(*) n FROM ha_return_media_reviews').get() as {n:number}).n*HA_RETURN_MEDIA_REVIEW_RESERVE}
  accept(raw:unknown){const request=haReturnMediaReviewRequest.parse(raw),prior=this.existing(request);if(prior)return prior
    if((this.db.prepare('SELECT count(*) n FROM ha_return_media_reviews').get() as {n:number}).n>=1024)throw new Error('Histórico excede limite; preservar e revisar retenção.')
    const rows=this.db.prepare('SELECT media_review_id,channel_id FROM ha_return_media_reviews').all() as Array<{media_review_id:string;channel_id:string}>
    if(rows.some(row=>['ACCEPTED','CHECKING'].includes(this.read(row.media_review_id,row.channel_id).phase)))throw new Error('Outra análise ativa/interrompida requer conferência; não iniciar em paralelo.')
    const value=recordSchema.parse({version:1,request,owner:this.owner,phase:'ACCEPTED',quotaBytes:HA_RETURN_MEDIA_REVIEW_RESERVE,updatedAt:new Date().toISOString(),result:null,privateEvidence:null});this.db.prepare('INSERT INTO ha_return_media_reviews VALUES(?,?,?,?)').run(request.mediaReviewId,request.applicationId,request.channelId,installationVault(false).encrypt(JSON.stringify(value),this.key(request.mediaReviewId)));return this.query(request.mediaReviewId,request.channelId)
  }
  private write(raw:unknown){const value=recordSchema.parse(raw);if(this.db.prepare('UPDATE ha_return_media_reviews SET payload=? WHERE media_review_id=?').run(installationVault(false).encrypt(JSON.stringify(value),this.key(value.request.mediaReviewId)),value.request.mediaReviewId).changes!==1)throw new Error('Revisão perdeu diário.')}
  fail(raw:unknown){const request=haReturnMediaReviewRequest.parse(raw),value=this.read(request.mediaReviewId,request.channelId);if(value.owner!==this.owner||value.phase==='REVIEWED')throw new Error('Não alterar revisão confirmada/estrangeira.');this.write({...value,phase:'FAILED',result:null,privateEvidence:null,updatedAt:new Date().toISOString()})}
  async run(raw:unknown,applicationHash:string,inspect:()=>ReturnType<typeof inspectReturnLocalMedia>,current:()=>Promise<void>){
    const request=haReturnMediaReviewRequest.parse(raw),initial=this.read(request.mediaReviewId,request.channelId)
    if(initial.owner!==this.owner||initial.phase!=='ACCEPTED')throw new Error('Revisão não pertence à instância atual.')
    try{
      await current();this.write({...initial,phase:'CHECKING',updatedAt:new Date().toISOString()})
      const proof=await inspect()
      const privateEvidence=JSON.stringify({version:1,request,applicationHash,checkedAt:proof.checkedAt,runtimeHash:proof.runtimeHash,inventoryIdentity:proof.inventoryIdentity,required:[...proof.required],evidence:[...proof.evidence],localAssets:[...proof.localAssets],mounts:proof.mounts,graphics:proof.graphics?.evidence,audio:proof.audio?.evidence})
      if(Buffer.byteLength(privateEvidence)>16*1024*1024)throw new Error('Evidência excede limite; não truncar como pronta.')
      const issues=proof.mounts.filter(mount=>mount.errors.length||mount.warnings.length||mount.livePending)
      const result=resultSchema.parse({applicationDatabaseHash:applicationHash,evidenceMac:installationVault(false).reviewIdentity(privateEvidence,'ha-return-media-evidence:v1:'+request.mediaReviewId),runtimeHash:proof.runtimeHash,checkedAt:proof.checkedAt,requiredHashes:proof.requiredHashes,verifiedHashes:proof.verifiedHashes,bytesAndDecodeComplete:proof.bytesAndDecodeComplete,checkedMounts:proof.mounts.length,blockedMounts:proof.mounts.filter(mount=>mount.errors.length).length,livePending:proof.mounts.filter(mount=>mount.livePending).length,mixPending:proof.mounts.filter(mount=>mount.warnings.includes('LOCAL_SELECTED_MIX_RENDER_PENDING')).length,graphics:proof.graphics?.summary,audio:proof.audio?.summary,issues:issues.slice(0,200),issuesTruncated:issues.length>200,publicationAuthorized:false,operationalReady:false})
      await current();this.write({...initial,phase:'REVIEWED',result,privateEvidence,updatedAt:new Date().toISOString()})
    }catch{this.write({...initial,phase:'FAILED',updatedAt:new Date().toISOString()})}
    return this.query(request.mediaReviewId,request.channelId)
  }
}
