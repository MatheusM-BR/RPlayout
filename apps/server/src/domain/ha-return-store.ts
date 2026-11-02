import type Database from 'better-sqlite3'
import {createHash} from 'node:crypto'
import {mkdir,lstat,open,statfs} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {dirname,join,resolve} from 'node:path'
import {z} from 'zod'
import {haExportSeal} from './ha-execution-export.js'
import {installationVault} from './secret-vault.js'
import {protectGeneratedHaDirectory,writePrivateConfig} from './private-config-file.js'
import {runReturnReview,runReturnHistoryExtraction,runReturnVariantExtraction} from './ha-return-review-runner.js'
import {haHistoryImportRequest,type HaHistoryAdapter,type HaHistoryImportRequest} from './ha-history-import.js'
import {haHistoryVariantRequest,type HaHistoryVariantRequest,type HaHistoryVariantAdapter} from './ha-history-variant.js'
import type {HaSnapshot} from './ha-replication.js'
import {haReturnRekeyRequest,haRekeyResult,prepareRekeyedCopy} from './ha-return-rekey.js'
import {HaReturnSelections,haReturnSelectionRequest} from './ha-return-selection.js'
import {HaReturnCandidateStages,haReturnCandidateRequest,HA_RETURN_CANDIDATE_RESERVE} from './ha-return-candidate-staging.js'
import {returnCandidateBindings,haReturnBindingRequest,haReturnBindingReviewRequest} from './ha-return-bindings.js'
import type {HaBindingInventory} from './ha-bindings.js'
import {HaReturnApplications,haReturnApplicationRequest,HA_RETURN_APPLICATION_RESERVE} from './ha-return-application.js'
import {HaReturnMediaReviews,haReturnMediaReviewRequest,HA_RETURN_MEDIA_REVIEW_RESERVE} from './ha-return-media-review.js'
import {inspectReturnLocalMedia,returnRequiredMedia,returnLocalMediaOptions,returnMediaInventoryMac,type HaReturnMediaAdapter} from './ha-return-local-media.js'
import {verifyReviewedReturnMedia,prepareReturnMediaVariants} from './ha-return-media-variants.js'
import {probeRuntimeHash} from './ha-local-probe.js'
import {GRAPHIC_PROBE_BINARY,AUDIO_ANALYSIS_BINARY} from '../config.js'
import {HaReturnAutoDecisions,haReturnAutoDecisionRequest,prepareReturnAutoDecision,returnAutoDecisionOptions,HA_RETURN_AUTO_DECISION_RESERVE} from './ha-return-auto-decision.js'
import {HaReturnMediaApplications,haReturnMediaApplicationRequest,HA_RETURN_MEDIA_APPLICATION_RESERVE} from './ha-return-media-application.js'
import {HaReturnJobRecoveries,haReturnJobRecoveryRequest,assertReturnJobStopped,HA_RETURN_JOB_RECOVERY_RESERVE} from './ha-return-job-recovery.js'
import {listReturnPendingJobs} from './ha-return-job-list.js'
import {HaReturnHistoryJobs,HA_RETURN_HISTORY_JOB_RESERVE} from './ha-return-history-jobs.js'
import {HaReturnPostGainReviews,haReturnPostGainReviewRequest,HA_RETURN_POSTGAIN_REVIEW_RESERVE} from './ha-return-postgain-review.js'
import {HaReturnBusReviews,haReturnBusReviewRequest,HA_RETURN_BUS_REVIEW_RESERVE} from './ha-return-bus-review.js'
import {planReturnBusAudio,measureReturnBusPlan} from './ha-return-bus-plan.js'
import {captureReturnBusPolicyOrPending} from './ha-return-bus-policy.js'
import {captureReturnPostGainProfile,planReturnPostGainAudio,measureReturnPostGainPlan} from './ha-return-postgain-plan.js'
const rekeyRecord=z.object({version:z.literal(1),request:haReturnRekeyRequest,owner:z.string(),phase:z.enum(['ACCEPTED','REKEYING','REKEYED_STAGED','FAILED']),quotaBytes:z.number().int().positive(),updatedAt:z.string().datetime(),result:haRekeyResult.nullable(),operationalApproved:z.literal(false),publicationAuthorized:z.literal(false)}).strict().superRefine((v,ctx)=>{if(v.phase==='REKEYED_STAGED'&&!v.result)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Reproteção sem resultado.'})})
export const haReturnReviewRequest=z.object({reviewId:z.string().uuid(),transferId:z.string().uuid(),channelId:z.string().min(1).max(128),rekeyId:z.string().uuid().optional()}).strict()
const reviewRecord=z.object({version:z.literal(1),request:haReturnReviewRequest,owner:z.string().optional(),phase:z.enum(['ACCEPTED','REVIEWING','REVIEWED','FAILED']),quotaBytes:z.number().int().positive().optional(),updatedAt:z.string().datetime(),baselineHash:z.string().regex(/^[a-f0-9]{64}$/).nullable(),report:z.record(z.unknown()).nullable(),primaryApproved:z.literal(false),publicationAuthorized:z.literal(false)}).strict()

export const HA_RETURN_CHUNK_BYTES=256*1024
const base={version:z.literal(1),transferId:z.string().uuid()}
export const haReturnProgress=z.object({version:z.literal(1),transferId:z.string().uuid(),exportId:z.string().uuid(),promotionId:z.string().uuid(),channelId:z.string().min(1).max(128),stopRequestId:z.string().uuid(),manifestHash:z.string().regex(/^[a-f0-9]{64}$/),databaseHash:z.string().regex(/^[a-f0-9]{64}$/),databaseBytes:z.number().int().positive().max(16*1024**3),offset:z.number().int().nonnegative().max(16*1024**3),phase:z.enum(['ALLOCATING','RECEIVING','RECEIVED_QUARANTINE']),checkedAt:z.string().datetime(),primaryApproved:z.literal(false),publicationAuthorized:z.literal(false),authorityTransferred:z.literal(false),physicalOutputValidated:z.literal(false)}).strict().superRefine((v,ctx)=>{if(v.offset>v.databaseBytes||v.phase==='RECEIVED_QUARANTINE'&&v.offset!==v.databaseBytes)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Recibo de retorno incompleto.'})})
export const haReturnOperation=z.discriminatedUnion('operation',[
  z.object({...base,operation:z.literal('BEGIN'),seal:haExportSeal,manifestHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
  z.object({...base,operation:z.literal('WRITE'),offset:z.number().int().nonnegative().max(16*1024**3),data:z.string().min(4).max(4*Math.ceil(HA_RETURN_CHUNK_BYTES/3))}).strict(),
  z.object({...base,operation:z.literal('VERIFY')}).strict(),
  z.object({...base,operation:z.literal('STATUS')}).strict(),
])
const recordSchema=z.object({version:z.literal(1),transferId:z.string().uuid(),seal:haExportSeal,manifestHash:z.string().regex(/^[a-f0-9]{64}$/),root:z.string(),owner:z.string(),device:z.string().nullable(),inode:z.string().nullable(),phase:z.enum(['ALLOCATING','RECEIVING','RECEIVED_QUARANTINE']),offset:z.number().int().nonnegative(),checkedAt:z.string().datetime()}).strict()
type Record=z.infer<typeof recordSchema>
async function ancestry(path:string){let cursor=resolve(path);for(;;){const info=await lstat(cursor);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Retorno não pode atravessar link/junção.');const parent=dirname(cursor);if(parent===cursor)return;cursor=parent}}
const same=(a:Awaited<ReturnType<typeof lstat>>,b:Awaited<ReturnType<typeof lstat>>)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs&&b.nlink===1

/** Peer-authenticated bytes only. This never opens/migrates the received DB,
 * changes active state, resolves unknown commands or transfers authority. */
export class HaReturnStore{
  private serial:Promise<unknown>=Promise.resolve()
  private pending=0
  private closed=false
  private readonly abort=new AbortController()
  private readonly historyJobs=new Map<string,HaHistoryImportRequest>()
  private readonly variantJobs=new Map<string,HaHistoryVariantRequest>()
  private readonly selections:HaReturnSelections
  private readonly candidates:HaReturnCandidateStages
  private readonly applications:HaReturnApplications
  private readonly mediaReviews:HaReturnMediaReviews
  private readonly autoDecisions:HaReturnAutoDecisions
  private readonly mediaApplications:HaReturnMediaApplications
  private readonly jobRecoveries:HaReturnJobRecoveries
  private readonly durableHistoryJobs:HaReturnHistoryJobs
  private readonly postGainReviews:HaReturnPostGainReviews
  private readonly busReviews:HaReturnBusReviews
  constructor(private readonly db:Database.Database,private readonly root:string,private readonly context:string,private readonly owner:string,private readonly assertOwner:()=>void,private readonly quota:number){
    if(!Number.isSafeInteger(quota)||quota<=0||resolve(root).startsWith('\\\\'))throw new Error('Quarentena exige raiz local e quota explícita.')
    db.exec('CREATE TABLE IF NOT EXISTS ha_return_received(transfer_id TEXT PRIMARY KEY,export_id TEXT NOT NULL UNIQUE,promotion_id TEXT NOT NULL UNIQUE,report TEXT NOT NULL)')
    db.exec('CREATE TABLE IF NOT EXISTS ha_return_reviews(review_id TEXT PRIMARY KEY,transfer_id TEXT NOT NULL,channel_id TEXT NOT NULL,report TEXT NOT NULL)')
    db.exec('CREATE TABLE IF NOT EXISTS ha_return_rekeys(rekey_id TEXT PRIMARY KEY,transfer_id TEXT NOT NULL UNIQUE,channel_id TEXT NOT NULL,report TEXT NOT NULL)')
    this.selections=new HaReturnSelections(db,context,owner)
    this.candidates=new HaReturnCandidateStages(db,context,owner)
    this.applications=new HaReturnApplications(db,context,owner)
    this.mediaReviews=new HaReturnMediaReviews(db,context,owner)
    this.autoDecisions=new HaReturnAutoDecisions(db,context,owner)
    this.mediaApplications=new HaReturnMediaApplications(db,context,owner)
    this.jobRecoveries=new HaReturnJobRecoveries(db,context,owner)
    this.durableHistoryJobs=new HaReturnHistoryJobs(db,context,owner)
    this.postGainReviews=new HaReturnPostGainReviews(db,context,owner)
    this.busReviews=new HaReturnBusReviews(db,context,owner)
  }
  private current(){if(this.closed)throw new Error('Recepção encerrando.');this.assertOwner()}
  private key(id:string){return 'ha-return-received:v1:'+this.context+':'+id}
  private row(id:string){
    const row=this.db.prepare('SELECT * FROM ha_return_received WHERE transfer_id=?').get(id) as {transfer_id:string;export_id:string;promotion_id:string;report:string}|undefined
    if(!row)return null
    const value=recordSchema.parse(JSON.parse(installationVault(false).decrypt(row.report,this.key(id))))
    if(value.transferId!==id||value.seal.exportId!==row.export_id||value.seal.promotionId!==row.promotion_id||value.root!==resolve(this.root)||value.offset>value.seal.databaseBytes||value.phase==='RECEIVED_QUARANTINE'&&value.offset!==value.seal.databaseBytes)throw new Error('Diário de retorno diverge da cópia.')
    return value
  }
  private store(value:Record){this.current();value=recordSchema.parse({...value,checkedAt:new Date().toISOString()});if(this.db.prepare('UPDATE ha_return_received SET report=? WHERE transfer_id=?').run(installationVault(false).encrypt(JSON.stringify(value),this.key(value.transferId)),value.transferId).changes!==1)throw new Error('Diário de retorno perdeu pedido.');return value}
  private progress(value:Record){return {version:1 as const,transferId:value.transferId,exportId:value.seal.exportId,promotionId:value.seal.promotionId,channelId:value.seal.channelId,stopRequestId:value.seal.stopRequestId,manifestHash:value.manifestHash,databaseHash:value.seal.databaseHash,databaseBytes:value.seal.databaseBytes,offset:value.offset,phase:value.phase,checkedAt:value.checkedAt,primaryApproved:false as const,publicationAuthorized:false as const,authorityTransferred:false as const,physicalOutputValidated:false as const}}
  private reservedBytes(){
    const received=this.db.prepare('SELECT transfer_id FROM ha_return_received').all() as {transfer_id:string}[],reviews=this.db.prepare('SELECT review_id,channel_id FROM ha_return_reviews').all() as {review_id:string;channel_id:string}[]
    const rekeys=this.db.prepare('SELECT rekey_id,channel_id FROM ha_return_rekeys').all() as {rekey_id:string;channel_id:string}[]
    return this.busReviews.reservedBytes()+this.postGainReviews.reservedBytes()+this.durableHistoryJobs.reservedBytes()+this.jobRecoveries.reservedBytes()+this.autoDecisions.reservedBytes()+this.mediaApplications.reservedBytes()+this.mediaReviews.reservedBytes()+this.applications.reservedBytes()+this.candidates.reservedBytes()+received.reduce((sum,row)=>sum+this.row(row.transfer_id)!.seal.databaseBytes,0)+reviews.reduce((sum,row)=>{const prior=this.reviewQuery(row.review_id,row.channel_id),source=this.row(prior.request.transferId);if(!source)throw new Error('Reserva de revisão perdeu origem; não liberar quota por suposição.');return sum+(prior.quotaBytes??source.seal.databaseBytes)},0)+rekeys.reduce((sum,row)=>sum+this.rekeyQuery(row.rekey_id,row.channel_id).quotaBytes,0)
  }
  list(channelId:string){
    z.string().min(1).max(128).parse(channelId);this.current()
    const rows=this.db.prepare('SELECT transfer_id FROM ha_return_received ORDER BY rowid DESC LIMIT 128').all() as {transfer_id:string}[]
    return rows.map(row=>this.row(row.transfer_id)!).filter(value=>value.seal.channelId===channelId).map(value=>{const rekey=this.db.prepare('SELECT rekey_id FROM ha_return_rekeys WHERE transfer_id=? AND channel_id=?').get(value.transferId,channelId) as {rekey_id:string}|undefined;return {...this.progress(value),hasProtectedBridge:!!value.seal.protectedBridge,rekeyRequestId:rekey?.rekey_id??null,confirmationIsHistorical:true as const,ownedHere:value.owner===this.owner}})
  }
  receive(value:unknown){
    const operation=haReturnOperation.parse(value);this.current();this.pending++
    const work=this.serial.then(()=>this.apply(operation));this.serial=work.catch(()=>{})
    return work.finally(()=>{this.pending--})
  }
  rekeyQuery(rekeyId:string,channelId:string){
    this.current();const row=this.db.prepare('SELECT * FROM ha_return_rekeys WHERE rekey_id=? AND channel_id=?').get(z.string().uuid().parse(rekeyId),z.string().min(1).max(128).parse(channelId)) as {rekey_id:string;transfer_id:string;channel_id:string;report:string}|undefined
    if(!row)throw new Error('Reproteção não registrada neste canal.')
    const value=rekeyRecord.parse(JSON.parse(installationVault(false).decrypt(row.report,'ha-return-rekey:v1:'+this.context+':'+rekeyId)))
    if(value.request.rekeyId!==row.rekey_id||value.request.transferId!==row.transfer_id||value.request.channelId!==row.channel_id)throw new Error('Diário diverge da reproteção/canal.')
    return {version:1 as const,request:value.request,phase:value.phase,quotaBytes:value.quotaBytes,updatedAt:value.updatedAt,result:value.result,ownedHere:value.owner===this.owner,confirmationIsHistorical:true as const,operationalReady:false as const,operationalApproved:false as const,publicationAuthorized:false as const}
  }
  rekey(raw:unknown,pairingKey:string,authorize:()=>void){
    const request=haReturnRekeyRequest.parse(raw);authorize();this.current()
    if(this.db.prepare('SELECT 1 FROM ha_return_rekeys WHERE rekey_id=?').get(request.rekeyId)){const prior=this.rekeyQuery(request.rekeyId,request.channelId);if(JSON.stringify(prior.request)!==JSON.stringify(request))throw new Error('UUID pertence a outra intenção.');return Promise.resolve(prior)}
    const received=this.row(request.transferId)
    if(!received||received.owner!==this.owner||received.phase!=='RECEIVED_QUARANTINE'||received.seal.channelId!==request.channelId||!received.seal.protectedBridge)throw new Error('Reproteção exige recebimento completo próprio com ponte autenticada.')
    const quotaBytes=received.seal.databaseBytes+256*1024*1024
    if(quotaBytes>this.quota-this.reservedBytes())throw new Error('Quota insuficiente para derivada e journal; originais preservados.')
    let record:z.infer<typeof rekeyRecord>={version:1,request,owner:this.owner,phase:'ACCEPTED',quotaBytes,updatedAt:new Date().toISOString(),result:null,operationalApproved:false,publicationAuthorized:false}
    this.db.prepare('INSERT INTO ha_return_rekeys VALUES(?,?,?,?)').run(request.rekeyId,request.transferId,request.channelId,installationVault(false).encrypt(JSON.stringify(record),'ha-return-rekey:v1:'+this.context+':'+request.rekeyId))
    const store=(phase:z.infer<typeof rekeyRecord>['phase'],result:z.infer<typeof haRekeyResult>|null=null)=>{record=rekeyRecord.parse({...record,phase,result,updatedAt:new Date().toISOString()});if(this.db.prepare('UPDATE ha_return_rekeys SET report=? WHERE rekey_id=?').run(installationVault(false).encrypt(JSON.stringify(record),'ha-return-rekey:v1:'+this.context+':'+request.rekeyId),request.rekeyId).changes!==1)throw new Error('Diário de reproteção perdeu pedido.')}
    const current=()=>{authorize();this.current();this.abort.signal.throwIfAborted();if(JSON.stringify(this.row(request.transferId))!==JSON.stringify(received))throw new Error('Recebimento mudou durante reproteção.')}
    this.pending++
    const work=this.serial.then(async()=>{
      try{current();await this.checkedFile(received);store('REKEYING');const result=await prepareRekeyedCopy({file:this.path(received),root:received.root,seal:received.seal},request,pairingKey,current,this.abort.signal);await this.checkedFile(received);current();store('REKEYED_STAGED',result.result)}catch{store('FAILED')}
      return this.rekeyQuery(request.rekeyId,request.channelId)
    })
    this.serial=work.catch(()=>{});return work.finally(()=>{this.pending--})
  }
  private readReview(reviewId:string,channelId:string){
    this.current();const row=this.db.prepare('SELECT * FROM ha_return_reviews WHERE review_id=? AND channel_id=?').get(z.string().uuid().parse(reviewId),z.string().min(1).max(128).parse(channelId)) as {review_id:string;transfer_id:string;channel_id:string;report:string}|undefined
    if(!row)throw new Error('Revisão não registrada neste canal.')
    const value=reviewRecord.parse(JSON.parse(installationVault(false).decrypt(row.report,'ha-return-review:v1:'+this.context+':'+reviewId)))
    if(value.request.reviewId!==row.review_id||value.request.transferId!==row.transfer_id||value.request.channelId!==row.channel_id||value.phase==='REVIEWED'&&!value.report)throw new Error('Revisão diverge do pedido.')
    return value
  }
  reviewQuery(reviewId:string,channelId:string){const {owner,...value}=this.readReview(reviewId,channelId);return {...value,ownerRecorded:typeof owner==='string'&&owner.length>0,ownedHere:owner===this.owner,confirmationIsHistorical:true as const,operationalReady:false as const}}
  private closeEarlyReturnJob(request:z.infer<typeof haReturnJobRecoveryRequest>,stopped:(owner:string)=>void){
    if(request.kind==='DATABASE_REVIEW'){
      const value=this.readReview(request.targetId,request.channelId)
      if(!['ACCEPTED','REVIEWING'].includes(value.phase)||value.phase!==request.expectedPhase||value.updatedAt!==request.expectedUpdatedAt||value.report||!value.owner)throw new Error('Revisão mudou, confirmou ou não possui owner comprovado.')
      stopped(value.owner)
      const failed=reviewRecord.parse({...value,phase:'FAILED',updatedAt:new Date().toISOString()})
      if(this.db.prepare('UPDATE ha_return_reviews SET report=? WHERE review_id=? AND channel_id=?').run(installationVault(false).encrypt(JSON.stringify(failed),'ha-return-review:v1:'+this.context+':'+request.targetId),request.targetId,request.channelId).changes!==1)throw new Error('Revisão perdeu diário.')
    }else if(request.kind==='REKEY'){
      this.rekeyQuery(request.targetId,request.channelId)
      const row=this.db.prepare('SELECT report FROM ha_return_rekeys WHERE rekey_id=? AND channel_id=?').get(request.targetId,request.channelId) as {report:string}
      const value=rekeyRecord.parse(JSON.parse(installationVault(false).decrypt(row.report,'ha-return-rekey:v1:'+this.context+':'+request.targetId)))
      if(!['ACCEPTED','REKEYING'].includes(value.phase)||value.phase!==request.expectedPhase||value.updatedAt!==request.expectedUpdatedAt||value.result)throw new Error('Reproteção mudou ou contém confirmação.')
      stopped(value.owner)
      const failed=rekeyRecord.parse({...value,phase:'FAILED',updatedAt:new Date().toISOString()})
      if(this.db.prepare('UPDATE ha_return_rekeys SET report=? WHERE rekey_id=? AND channel_id=?').run(installationVault(false).encrypt(JSON.stringify(failed),'ha-return-rekey:v1:'+this.context+':'+request.targetId),request.targetId,request.channelId).changes!==1)throw new Error('Reproteção perdeu diário.')
    }else throw new Error('Tipo não pertence à recuperação inicial.')
  }
  selectionQuery(planId:string,channelId:string){this.current();return this.selections.query(planId,channelId)}
  candidateQuery(candidateId:string,channelId:string){this.current();return this.candidates.query(candidateId,channelId)}
  applicationQuery(applicationId:string,channelId:string){this.current();return this.applications.query(applicationId,channelId)}
  mediaReviewQuery(mediaReviewId:string,channelId:string){this.current();return this.mediaReviews.query(mediaReviewId,channelId)}
  autoDecisionQuery(id:string,channelId:string){this.current();return this.autoDecisions.query(id,channelId)}
  postGainReviewQuery(id:string,channelId:string){this.current();return this.postGainReviews.query(id,channelId)}
  busReviewQuery(id:string,channelId:string){this.current();return this.busReviews.query(id,channelId)}
  async reviewPostGain(raw:unknown,capture:()=>HaSnapshot,inventory:HaBindingInventory,adapter:HaReturnMediaAdapter,probeBinary:string,audioBinary:string,actor:string,authorize:()=>void){
    const request=haReturnPostGainReviewRequest.parse(raw);z.string().min(1).max(256).parse(actor)
    const alive=()=>{authorize();this.current();this.abort.signal.throwIfAborted()}
    alive();const prior=this.postGainReviews.existing(request);if(prior)return prior
    const media=this.mediaApplicationQuery(request.mediaApplicationId,request.channelId)
    if(!media.ownedHere||media.phase!=='STAGED'||!media.result)throw new Error('Pós-ganho exige cópia de mídia própria confirmada.')
    const decision=media.request.autoDecisionId?this.autoDecisionQuery(media.request.autoDecisionId,request.channelId):null
    if(decision&&(!decision.ownedHere||decision.request.mediaReviewId!==media.request.mediaReviewId||decision.request.evidenceMac!==media.result.evidenceMac||decision.reviewDatabaseHash!==media.result.sourceDatabaseHash))throw new Error('Decisão AUTO não corresponde à cópia de mídia.')
    if(!audioBinary||HA_RETURN_POSTGAIN_REVIEW_RESERVE>this.quota-this.reservedBytes())throw new Error('Runtime ou quota indisponível para revisão pós-ganho.')
    const profile=captureReturnPostGainProfile(capture(),request.channelId)
    this.pending++
    try{
      // Preparation owns its serial work. Do not nest it inside this queue.
      const base=await this.prepareReviewedMedia(media.request.mediaReviewId,request.channelId,capture,inventory,adapter,probeBinary,authorize,!!decision)
      if(base.receipt.result.evidenceMac!==media.result.evidenceMac||base.receipt.result.applicationDatabaseHash!==media.result.sourceDatabaseHash)throw new Error('Cópia diverge da revisão pre-gain selecionada.')
      const plan=planReturnPostGainAudio(base.origin,base.receipt,profile,decision?.request)
      const current=()=>{
        alive();base.assertCurrent()
        if(JSON.stringify(this.mediaApplicationQuery(request.mediaApplicationId,request.channelId))!==JSON.stringify(media)||JSON.stringify(captureReturnPostGainProfile(capture(),request.channelId))!==JSON.stringify(profile)||decision&&JSON.stringify(this.autoDecisionQuery(decision.request.decisionId,request.channelId))!==JSON.stringify(decision))throw new Error('Cópia/perfil/decisão mudou durante pós-ganho.')
      }
      let mediaStamp:string|null=null
      const verifyCurrent=async()=>{
        current();await base.verifyCurrent();current()
        const stamp=await this.mediaApplications.verify(this.root,request.mediaApplicationId,request.channelId,current,this.abort.signal)
        if(mediaStamp!==null&&mediaStamp!==stamp)throw new Error('Identidade da cópia mudou durante pós-ganho.')
        mediaStamp=stamp;current()
      }
      const work=this.serial.then(async()=>{
        current();const existing=this.postGainReviews.existing(request);if(existing)return existing
        if(HA_RETURN_POSTGAIN_REVIEW_RESERVE>this.quota-this.reservedBytes())throw new Error('Quota pós-ganho indisponível na fila.')
        this.postGainReviews.accept(request,{mediaReviewId:media.request.mediaReviewId,mediaDatabaseHash:media.result!.databaseHash,evidenceMac:base.receipt.result.evidenceMac,profile,profileFingerprint:plan.profileFingerprint,autoDecisionId:decision?.request.decisionId??null},actor,current)
        return this.postGainReviews.run(request,plan,()=>measureReturnPostGainPlan(plan,audioBinary,this.abort.signal,current),verifyCurrent,current)
      })
      this.serial=work.catch(()=>{});return await work
    }finally{this.pending--}
  }
  jobRecoveryQuery(id:string,channelId:string){this.current();return this.jobRecoveries.query(id,channelId)}
  async reviewBus(raw:unknown,capture:()=>HaSnapshot,inventory:HaBindingInventory,adapter:HaReturnMediaAdapter,probeBinary:string,audioBinary:string,actor:string,authorize:()=>void){
    const request=haReturnBusReviewRequest.parse(raw);z.string().min(1).max(256).parse(actor)
    const alive=()=>{authorize();this.current();this.abort.signal.throwIfAborted()}
    alive();const prior=this.busReviews.existing(request);if(prior)return prior
    const media=this.mediaApplicationQuery(request.mediaApplicationId,request.channelId)
    if(!media.ownedHere||media.phase!=='STAGED'||!media.result)throw new Error('Bus completo exige cópia de mídia própria confirmada.')
    const decision=media.request.autoDecisionId?this.autoDecisionQuery(media.request.autoDecisionId,request.channelId):null
    if(decision&&(!decision.ownedHere||decision.request.mediaReviewId!==media.request.mediaReviewId||decision.request.evidenceMac!==media.result.evidenceMac||decision.reviewDatabaseHash!==media.result.sourceDatabaseHash))throw new Error('Decisão AUTO não corresponde à cópia de mídia.')
    if(!audioBinary||HA_RETURN_BUS_REVIEW_RESERVE>this.quota-this.reservedBytes())throw new Error('Runtime ou quota indisponível para revisão bus completo.')
    const profile=captureReturnPostGainProfile(capture(),request.channelId)
    const policyNow=()=>{
      alive();const revision=this.db.prepare('SELECT version FROM channel_configuration_versions WHERE channel_id=?').get(request.channelId) as {version:number}|undefined
      if(!revision)throw new Error('Revisão local da política indisponível.')
      return {revision:revision.version,policy:captureReturnBusPolicyOrPending(capture(),request.channelId,revision.version)}
    }
    const policyCapture=policyNow()
    this.pending++
    try{
      // Preparation owns its serial work. Do not nest it inside this queue.
      const base=await this.prepareReviewedMedia(media.request.mediaReviewId,request.channelId,capture,inventory,adapter,probeBinary,authorize,!!decision)
      if(base.receipt.result.evidenceMac!==media.result.evidenceMac||base.receipt.result.applicationDatabaseHash!==media.result.sourceDatabaseHash)throw new Error('Cópia diverge da revisão pre-gain selecionada.')
      const plan=planReturnBusAudio(base.origin,base.receipt,profile,decision?.request)
      const current=()=>{
        alive();base.assertCurrent()
        if(JSON.stringify(policyNow())!==JSON.stringify(policyCapture)||JSON.stringify(this.mediaApplicationQuery(request.mediaApplicationId,request.channelId))!==JSON.stringify(media)||JSON.stringify(captureReturnPostGainProfile(capture(),request.channelId))!==JSON.stringify(profile)||decision&&JSON.stringify(this.autoDecisionQuery(decision.request.decisionId,request.channelId))!==JSON.stringify(decision))throw new Error('Cópia/perfil/decisão/política mudou durante bus completo.')
      }
      let mediaStamp:string|null=null
      const verifyCurrent=async()=>{
        current();await base.verifyCurrent();current()
        const stamp=await this.mediaApplications.verify(this.root,request.mediaApplicationId,request.channelId,current,this.abort.signal)
        if(mediaStamp!==null&&mediaStamp!==stamp)throw new Error('Identidade da cópia mudou durante bus completo.')
        mediaStamp=stamp;current()
      }
      const work=this.serial.then(async()=>{
        current();const existing=this.busReviews.existing(request);if(existing)return existing
        if(HA_RETURN_BUS_REVIEW_RESERVE>this.quota-this.reservedBytes())throw new Error('Quota bus completo indisponível na fila.')
        this.busReviews.accept(request,{mediaReviewId:media.request.mediaReviewId,mediaDatabaseHash:media.result!.databaseHash,evidenceMac:base.receipt.result.evidenceMac,profile,profileFingerprint:plan.profileFingerprint,autoDecisionId:decision?.request.decisionId??null,policy:policyCapture.policy},actor,current)
        return this.busReviews.run(request,plan,()=>measureReturnBusPlan(plan,audioBinary,this.abort.signal,current),verifyCurrent,current)
      })
      this.serial=work.catch(()=>{});return await work
    }finally{this.pending--}
  }
  historyJobObservation(id:string,channelId:string,kind:'HISTORY_IMPORT'|'HISTORY_VARIANT',historyAdapter:HaHistoryAdapter|null,variantAdapter:HaHistoryVariantAdapter|null){
    this.current();const job=this.durableHistoryJobs.query(id,channelId)
    if(!job||job.intent.kind!==(kind==='HISTORY_IMPORT'?'IMPORT':'VARIANT'))throw new Error('Intenção de histórico ausente ou de outro tipo.')
    const receipt=job.intent.kind==='IMPORT'?historyAdapter?.query(id,channelId):variantAdapter?.query(id,channelId)
    if(receipt===undefined||receipt&&JSON.stringify(receipt.request)!==JSON.stringify(job.intent.request))throw new Error('Banco operacional indisponível ou recibo divergente.')
    this.current()
    return {version:1 as const,kind,request:{channelId,...(kind==='HISTORY_IMPORT'?{importId:id}:{decisionId:id})},phase:receipt?'CONFIRMED' as const:job.phase==='CONFIRMED'?'COMMITTING' as const:job.phase,updatedAt:job.updatedAt,ownedHere:job.ownedHere,ownerRecorded:true,confirmationIsHistorical:true as const,operationalReady:false as const,publicationAuthorized:false as const,result:receipt?{commitConfirmed:true as const}:null}
  }
  pendingJobList(raw:unknown,authorize:()=>void,historyAdapter:HaHistoryAdapter|null=null,variantAdapter:HaHistoryVariantAdapter|null=null){authorize();this.current();const value=listReturnPendingJobs(this.db,raw,(kind,id,channelId)=>kind==='HISTORY_IMPORT'||kind==='HISTORY_VARIANT'?this.historyJobObservation(id,channelId,kind,historyAdapter,variantAdapter):kind==='DATABASE_REVIEW'?(()=>{const value=this.reviewQuery(id,channelId);return {...value,result:value.report}})():kind==='REKEY'?this.rekeyQuery(id,channelId):kind==='CANDIDATE'?this.candidateQuery(id,channelId):kind==='BINDING_APPLICATION'?this.applicationQuery(id,channelId):kind==='MEDIA_REVIEW'?this.mediaReviewQuery(id,channelId):kind==='POSTGAIN_REVIEW'?this.postGainReviewQuery(id,channelId):kind==='BUS_REVIEW'?this.busReviewQuery(id,channelId):this.mediaApplicationQuery(id,channelId));authorize();this.current();return value}
  closeInterruptedJob(raw:unknown,actor:string,authorize:()=>void,historyAdapter:HaHistoryAdapter|null=null,variantAdapter:HaHistoryVariantAdapter|null=null){
    const request=haReturnJobRecoveryRequest.parse(raw)
    const current=()=>{authorize();this.current();if(this.pending!==0)throw new Error('Há trabalhos em andamento; encerramento recusado.')}
    authorize();this.current();const prior=this.jobRecoveries.existing(request);if(prior)return prior
    current();if(HA_RETURN_JOB_RECOVERY_RESERVE>this.quota-this.reservedBytes())throw new Error('Quota insuficiente para preservar recuperação.')
    return this.jobRecoveries.close(request,actor,()=>{
      const stopped=(owner:string)=>{current();assertReturnJobStopped(owner,this.owner,this.pending===0)}
      if(request.kind==='HISTORY_IMPORT'||request.kind==='HISTORY_VARIANT')this.durableHistoryJobs.closeInterrupted(request.targetId,request.channelId,request.kind==='HISTORY_IMPORT'?'IMPORT':'VARIANT',request.expectedPhase,request.expectedUpdatedAt,stopped,intent=>{
        current();const receipt=intent.kind==='IMPORT'?historyAdapter?.query(intent.request.importId,request.channelId):variantAdapter?.query(intent.request.decisionId,request.channelId)
        if(receipt!==null)throw new Error('Recibo confirmado ou banco operacional indisponível; não encerrar.')
        current()
      })
      else if(request.kind==='DATABASE_REVIEW'||request.kind==='REKEY')this.closeEarlyReturnJob(request,stopped)
      else if(request.kind==='CANDIDATE')this.candidates.closeInterrupted(request.targetId,request.channelId,request.expectedPhase,request.expectedUpdatedAt,stopped)
      else if(request.kind==='BINDING_APPLICATION')this.applications.closeInterrupted(request.targetId,request.channelId,request.expectedPhase,request.expectedUpdatedAt,stopped)
      else if(request.kind==='MEDIA_REVIEW')this.mediaReviews.closeInterrupted(request.targetId,request.channelId,request.expectedPhase,request.expectedUpdatedAt,stopped)
      else if(request.kind==='POSTGAIN_REVIEW')this.postGainReviews.closeInterrupted(request.targetId,request.channelId,request.expectedPhase,request.expectedUpdatedAt,stopped,current)
      else if(request.kind==='BUS_REVIEW')this.busReviews.closeInterrupted(request.targetId,request.channelId,request.expectedPhase,request.expectedUpdatedAt,stopped,current)
      else this.mediaApplications.closeInterrupted(request.targetId,request.channelId,request.expectedPhase,request.expectedUpdatedAt,stopped)
    },current)
  }
  async autoDecisionOptions(mediaReviewId:string,channelId:string,authorize:()=>void){
    authorize();this.current();const review=this.mediaReviewQuery(mediaReviewId,channelId),application=this.applicationQuery(review.request.applicationId,channelId)
    if(!review.ownedHere||review.phase!=='REVIEWED'||!application.ownedHere||application.phase!=='STAGED'||!application.result)throw new Error('Opções AUTO exigem revisão/aplicação próprias confirmadas.')
    const receipt=this.mediaReviews.privateEvidence(mediaReviewId,channelId,application.result.databaseHash),origin=await this.candidateOrigin(application.request.candidate,authorize)
    authorize();this.current();if(JSON.stringify(this.mediaReviewQuery(mediaReviewId,channelId))!==JSON.stringify(review)||JSON.stringify(this.applicationQuery(application.request.applicationId,channelId))!==JSON.stringify(application))throw new Error('Revisão/aplicação mudou durante opções AUTO.')
    return returnAutoDecisionOptions(origin,receipt)
  }
  async saveAutoDecision(raw:unknown,capture:()=>HaSnapshot,inventory:HaBindingInventory,adapter:HaReturnMediaAdapter,binary:string,actor:string,authorize:()=>void){
    const request=haReturnAutoDecisionRequest.parse(raw);authorize();this.current();const prior=this.autoDecisions.existing(request);if(prior)return prior
    if(HA_RETURN_AUTO_DECISION_RESERVE>this.quota-this.reservedBytes())throw new Error('Quota insuficiente para decisão AUTO.')
    const prepared=await this.prepareReviewedMedia(request.mediaReviewId,request.channelId,capture,inventory,adapter,binary,authorize,true)
    this.pending++
    const work=this.serial.then(async()=>{await prepared.verifyCurrent();authorize();this.current();const proposal=prepareReturnAutoDecision(prepared.origin,prepared.receipt,request);if(HA_RETURN_AUTO_DECISION_RESERVE>this.quota-this.reservedBytes())throw new Error('Quota de decisão AUTO indisponível.');return this.autoDecisions.save(proposal,actor,()=>{authorize();prepared.assertCurrent()})})
    this.serial=work.catch(()=>{});return work.finally(()=>{this.pending--})
  }
  mediaApplicationQuery(mediaApplicationId:string,channelId:string){this.current();return this.mediaApplications.query(mediaApplicationId,channelId)}
  async stageMediaApplication(raw:unknown,capture:()=>HaSnapshot,inventory:HaBindingInventory,adapter:HaReturnMediaAdapter,binary:string,authorize:()=>void){
    const request=haReturnMediaApplicationRequest.parse(raw);authorize();this.current()
    const prior=this.mediaApplications.existing(request);if(prior)return prior
    const review=this.mediaReviewQuery(request.mediaReviewId,request.channelId)
    const decision=request.autoDecisionId?this.autoDecisionQuery(request.autoDecisionId,request.channelId):null
    if(decision&&(!decision.ownedHere||decision.request.mediaReviewId!==request.mediaReviewId||decision.request.evidenceMac!==review.result?.evidenceMac||decision.reviewDatabaseHash!==review.result?.applicationDatabaseHash))throw new Error('Decisão AUTO local não corresponde à revisão.')
    if(!review.ownedHere||review.phase!=='REVIEWED'||!review.result?.bytesAndDecodeComplete||!decision&&review.result.blockedMounts)throw new Error('Mídia/QC da revisão ainda bloqueados.')
    if(HA_RETURN_MEDIA_APPLICATION_RESERVE>this.quota-this.reservedBytes())throw new Error('Quota insuficiente para cópia/journal.')
    this.mediaApplications.accept(request);this.pending++
    try{
      // Prepare outside the following queued builder to avoid nesting the same
      // serial queue. Its own work is already queued and cancellable.
      const base=await this.prepareReviewedMedia(request.mediaReviewId,request.channelId,capture,inventory,adapter,binary,authorize,!!decision)
      const assertDecision=()=>{base.assertCurrent();if(decision&&JSON.stringify(this.autoDecisionQuery(decision.request.decisionId,request.channelId))!==JSON.stringify(decision))throw new Error('Decisão AUTO mudou durante construção.')}
      const prepared={...base,...(decision?{autoDecisionRequest:decision.request}:{}),assertCurrent:assertDecision,verifyCurrent:async()=>{assertDecision();await base.verifyCurrent();assertDecision()}}
      assertDecision();prepareReturnMediaVariants(base.origin,base.receipt,base.plan,base.rate,base.audioChannels,decision?.request)
      const application=this.applicationQuery(prepared.application.applicationId,request.channelId),selection=this.selectionQuery(application.request.candidate.planId,request.channelId),received=this.row(selection.request.transferId)
      if(!received||received.owner!==this.owner)throw new Error('Origem própria ausente.')
      const alive=()=>{authorize();this.current();this.abort.signal.throwIfAborted()}
      const work=this.serial.then(()=>this.mediaApplications.create(request,received.root,application,prepared,this.abort.signal,alive))
      this.serial=work.catch(()=>{});return await work
    }catch{this.mediaApplications.fail(request);return this.mediaApplicationQuery(request.mediaApplicationId,request.channelId)}
    finally{this.pending--}
  }
  /** Internal preparation only: paths/evidence/variants MUST NOT be an HTTP
   * response. A separate durable builder still has to create the new DB. */
  async prepareReviewedMedia(mediaReviewId:string,channelId:string,capture:()=>HaSnapshot,inventory:HaBindingInventory,adapter:HaReturnMediaAdapter,binary:string,authorize:()=>void,allowPendingAutoDecision=false){
    authorize();this.current();const review=this.mediaReviewQuery(mediaReviewId,channelId),application=this.applicationQuery(review.request.applicationId,channelId)
    if(!review.ownedHere||review.phase!=='REVIEWED'||!application.ownedHere||application.phase!=='STAGED'||!application.result)throw new Error('Preparação exige revisão/aplicação próprias confirmadas.')
    const receipt=this.mediaReviews.privateEvidence(mediaReviewId,channelId,application.result.databaseHash),origin=await this.candidateOrigin(application.request.candidate,authorize),selection=this.selectionQuery(application.request.candidate.planId,channelId),received=this.row(selection.request.transferId)
    if(!received||received.owner!==this.owner||received.phase!=='RECEIVED_QUARANTINE')throw new Error('Recebimento próprio ausente/incompleto.')
    const alive=()=>{authorize();this.current();this.abort.signal.throwIfAborted()}
    const current=()=>{alive();if(JSON.stringify(this.mediaReviewQuery(mediaReviewId,channelId))!==JSON.stringify(review)||JSON.stringify(this.applicationQuery(application.request.applicationId,channelId))!==JSON.stringify(application)||JSON.stringify(this.selectionQuery(selection.request.planId,channelId))!==JSON.stringify(selection)||JSON.stringify(this.row(received.transferId))!==JSON.stringify(received))throw new Error('Evidência/aplicação/seleção mudou durante preparação.')}
    const bindings=returnCandidateBindings(this.db,this.context,origin,capture,current),plan=bindings.executionBindings(channelId,application.request.bindingPlanId,inventory)
    if(plan.bindingDigest!==application.result.bindingDigest)throw new Error('Plano da aplicação mudou.')
    const local=capture().channels.find(row=>row.channelId===channelId)?.configuration.channel as {rateNum?:unknown;rateDen?:unknown;audioChannels?:unknown}|undefined
    if(!local||typeof local.rateNum!=='number'||typeof local.rateDen!=='number'||typeof local.audioChannels!=='number')throw new Error('Cadência/barramento local ausentes.')
    const rate={num:local.rateNum,den:local.rateDen},audioChannels=local.audioChannels
    if(!Number.isSafeInteger(rate.num)||!Number.isSafeInteger(rate.den)||rate.num<=0||rate.den<=0||![2,8,16].includes(audioChannels)||origin.entries.some(entry=>entry.payload.rate?.num!==rate.num||entry.payload.rate?.den!==rate.den||entry.payload.audioChannels!==audioChannels))throw new Error('Cadência/barramento diferem; exigem decisão explícita.')
    const unchanged=()=>{current();if(JSON.stringify(bindings.executionBindings(channelId,plan.planId,inventory))!==JSON.stringify(plan))throw new Error('Plano/configuração mudou durante preparação.')}
    const verifyCurrent=async()=>{unchanged();await this.applications.verify(received.root,application.request.applicationId,channelId,alive,this.abort.signal);await verifyReviewedReturnMedia(origin,receipt,adapter,binary,this.abort.signal,unchanged,alive,GRAPHIC_PROBE_BINARY||null,AUDIO_ANALYSIS_BINARY||null,allowPendingAutoDecision);unchanged()}
    this.pending++
    const work=this.serial.then(async()=>{await verifyCurrent();unchanged();return {application:application.request,origin,receipt,plan,rate,audioChannels,verifyCurrent,assertCurrent:unchanged,publicationAuthorized:false as const,operationalReady:false as const}})
    this.serial=work.catch(()=>{});return work.finally(()=>{this.pending--})
  }
  async mediaOptions(applicationId:string,channelId:string,adapter:HaReturnMediaAdapter,authorize:()=>void){
    z.string().uuid().parse(applicationId);z.string().min(1).max(128).parse(channelId);authorize();this.current()
    const application=this.applicationQuery(applicationId,channelId)
    if(!application.ownedHere||application.phase!=='STAGED'||!application.result)throw new Error('Escolha exige aplicação própria confirmada.')
    const origin=await this.candidateOrigin(application.request.candidate,authorize),hashes=[...new Set([...returnRequiredMedia(origin).values()].map(asset=>asset.contentHash))],inventory=adapter.lookup(channelId,hashes),view=returnLocalMediaOptions(origin,inventory,applicationId,application.result.databaseHash)
    authorize();this.current();if(JSON.stringify(this.applicationQuery(applicationId,channelId))!==JSON.stringify(application))throw new Error('Aplicação mudou durante escolha.')
    return view
  }
  async reviewApplicationMedia(raw:unknown,capture:()=>HaSnapshot,inventory:HaBindingInventory,adapter:HaReturnMediaAdapter,binary:string,authorize:()=>void,graphicBinary:string|null=null,audioBinary:string|null=null){
    const request=haReturnMediaReviewRequest.parse(raw);authorize();this.current()
    const prior=this.mediaReviews.existing(request);if(prior)return prior
    const application=this.applicationQuery(request.applicationId,request.channelId)
    if(!application.ownedHere||application.phase!=='STAGED'||!application.result)throw new Error('Revisão exige aplicação própria confirmada.')
    const proof=application.result,origin=await this.candidateOrigin(application.request.candidate,authorize),selection=this.selectionQuery(application.request.candidate.planId,request.channelId),received=this.row(selection.request.transferId)
    if(!received||received.owner!==this.owner||received.phase!=='RECEIVED_QUARANTINE')throw new Error('Recebimento próprio ausente/incompleto.')
    const alive=()=>{authorize();this.current();this.abort.signal.throwIfAborted()}
    const current=()=>{alive();if(JSON.stringify(this.applicationQuery(request.applicationId,request.channelId))!==JSON.stringify(application)||JSON.stringify(this.selectionQuery(selection.request.planId,request.channelId))!==JSON.stringify(selection)||JSON.stringify(this.row(received.transferId))!==JSON.stringify(received))throw new Error('Aplicação/seleção/recebimento mudou durante análise.')}
    const bindings=returnCandidateBindings(this.db,this.context,origin,capture,current),plan=bindings.executionBindings(request.channelId,application.request.bindingPlanId,inventory)
    if(plan.bindingDigest!==proof.bindingDigest)throw new Error('Aplicação não corresponde ao plano atual.')
    if(request.inventoryMac){const hashes=[...new Set([...returnRequiredMedia(origin).values()].map(asset=>asset.contentHash))];if(returnMediaInventoryMac(request.applicationId,proof.databaseHash,adapter.lookup(request.channelId,hashes))!==request.inventoryMac)throw new Error('Inventário de mídia/QC mudou após conferência.')}
    const unchanged=()=>{current();if(JSON.stringify(bindings.executionBindings(request.channelId,application.request.bindingPlanId,inventory))!==JSON.stringify(plan))throw new Error('Plano/configuração mudou durante análise.')}
    let metadata:{hashes:string[];identity:string;graphicRuntimeHash:string|null;audioRuntimeHash:string|null}|null=null
    const sealed=async()=>{unchanged();await this.applications.verify(received.root,request.applicationId,request.channelId,alive,this.abort.signal);unchanged();if(metadata&&JSON.stringify(adapter.lookup(request.channelId,metadata.hashes))!==metadata.identity)throw new Error('Acervo/QC mudou antes de confirmar revisão.');if(metadata?.graphicRuntimeHash&&(!graphicBinary||await probeRuntimeHash(graphicBinary)!==metadata.graphicRuntimeHash))throw new Error('Runtime gráfico mudou antes de confirmar revisão.');if(metadata?.audioRuntimeHash&&(!audioBinary||await probeRuntimeHash(audioBinary)!==metadata.audioRuntimeHash))throw new Error('Runtime de áudio mudou antes de confirmar revisão.');unchanged()}
    unchanged();const repeated=this.mediaReviews.existing(request);if(repeated)return repeated
    if(HA_RETURN_MEDIA_REVIEW_RESERVE>this.quota-this.reservedBytes())throw new Error('Quota insuficiente para evidência de mídia.')
    this.mediaReviews.accept(request);this.pending++
    const inspect=async()=>{const result=await inspectReturnLocalMedia(origin,adapter,binary,this.abort.signal,unchanged,alive,undefined,new Map((request.mediaChoices??[]).map(row=>[row.contentHash,row.localAssetId])),request.inventoryMac?{applicationId:request.applicationId,applicationHash:proof.databaseHash,mac:request.inventoryMac}:undefined,graphicBinary,audioBinary);metadata={hashes:[...new Set([...result.required.values()].map(asset=>asset.contentHash))],identity:result.inventoryIdentity,graphicRuntimeHash:result.graphics.evidence.runtimeHash,audioRuntimeHash:result.audio.evidence.runtimeHash};return result}
    const work=this.serial.then(async()=>{try{return await this.mediaReviews.run(request,proof.databaseHash,inspect,sealed)}catch{this.mediaReviews.fail(request);return this.mediaReviewQuery(request.mediaReviewId,request.channelId)}})
    this.serial=work.catch(()=>{});return work.finally(()=>{this.pending--})
  }
  async applyCandidateBindings(raw:unknown,capture:()=>HaSnapshot,inventory:HaBindingInventory,authorize:()=>void){
    const request=haReturnApplicationRequest.parse(raw);authorize();this.current()
    const prior=this.applications.existing(request);if(prior)return prior
    const origin=await this.candidateOrigin(request.candidate,authorize),candidate=this.candidateQuery(request.candidate.candidateId,request.channelId),selection=this.selectionQuery(request.candidate.planId,request.channelId),received=this.row(selection.request.transferId)
    if(!received||received.owner!==this.owner||received.phase!=='RECEIVED_QUARANTINE')throw new Error('Recebimento próprio incompleto.')
    const current=()=>{authorize();this.current();this.abort.signal.throwIfAborted();if(JSON.stringify(this.candidateQuery(request.candidate.candidateId,request.channelId))!==JSON.stringify(candidate)||JSON.stringify(this.selectionQuery(request.candidate.planId,request.channelId))!==JSON.stringify(selection)||JSON.stringify(this.row(received.transferId))!==JSON.stringify(received))throw new Error('Candidato/seleção/recebimento mudou durante aplicação.')}
    const bindings=returnCandidateBindings(this.db,this.context,origin,capture,current),plan=bindings.executionBindings(request.channelId,request.bindingPlanId,inventory)
    const unchanged=()=>{current();if(JSON.stringify(bindings.executionBindings(request.channelId,request.bindingPlanId,inventory))!==JSON.stringify(plan))throw new Error('Plano/configuração mudou durante aplicação.')}
    unchanged();const repeated=this.applications.existing(request);if(repeated)return repeated
    if(HA_RETURN_APPLICATION_RESERVE>this.quota-this.reservedBytes())throw new Error('Quota insuficiente para aplicação; originais preservados.')
    this.applications.accept(request);this.pending++
    const alive=()=>{authorize();this.current();this.abort.signal.throwIfAborted()}
    const work=this.serial.then(async()=>{try{unchanged();return await this.applications.create(request,received.root,candidate,plan,unchanged,this.abort.signal,alive)}catch{this.applications.fail(request);return this.applicationQuery(request.applicationId,request.channelId)}})
    this.serial=work.catch(()=>{});return work.finally(()=>{this.pending--})
  }
  async candidateBindingReview(raw:unknown,capture:()=>HaSnapshot,inventory:HaBindingInventory,authorize:()=>void){
    const {requestId,...request}=haReturnBindingReviewRequest.parse(raw),origin=await this.candidateOrigin(request,authorize),candidate=this.candidateQuery(request.candidateId,request.channelId)
    const current=()=>{authorize();this.current();if(JSON.stringify(this.candidateQuery(request.candidateId,request.channelId))!==JSON.stringify(candidate))throw new Error('Candidato mudou durante conferência de vínculos.')}
    const bindings=returnCandidateBindings(this.db,this.context,origin,capture,current),review=bindings.review(request.channelId,inventory),requestPlan=requestId?bindings.queryPlan(requestId,request.channelId,inventory):null
    current();return {candidate:request,review,requestPlan,bindingsResolved:false as const,publicationAuthorized:false as const,operationalReady:false as const}
  }
  async candidateBindingSave(raw:unknown,capture:()=>HaSnapshot,inventory:HaBindingInventory,authorize:()=>void,actor:string|null){
    const request=haReturnBindingRequest.parse(raw),origin=await this.candidateOrigin(request.candidate,authorize),candidate=this.candidateQuery(request.candidate.candidateId,request.candidate.channelId)
    const current=()=>{authorize();this.current();if(JSON.stringify(this.candidateQuery(request.candidate.candidateId,request.candidate.channelId))!==JSON.stringify(candidate))throw new Error('Candidato mudou durante decisão de vínculos.')}
    const bindings=returnCandidateBindings(this.db,this.context,origin,capture,current),review=bindings.save(request.binding,inventory,actor,current),requestPlan=bindings.queryPlan(request.binding.requestId,request.candidate.channelId,inventory)
    current();return {candidate:request.candidate,review,requestPlan,bindingsResolved:false as const,publicationAuthorized:false as const,operationalReady:false as const}
  }
  /** Internal source for local-binding planning. Never expose this private
   * provenance in API responses; build a sanitized requirements view instead. */
  candidateOrigin(raw:unknown,authorize:()=>void){
    const request=haReturnCandidateRequest.parse(raw);authorize();this.current()
    const candidate=this.candidateQuery(request.candidateId,request.channelId),selection=this.selectionQuery(request.planId,request.channelId),received=this.row(selection.request.transferId)
    if(!candidate.ownedHere||candidate.phase!=='STAGED'||candidate.request.planId!==request.planId||!selection.ownedHere||!received||received.owner!==this.owner||received.phase!=='RECEIVED_QUARANTINE')throw new Error('Origem exige candidato/seleção/recebimento próprios confirmados.')
    const current=()=>{authorize();this.current();this.abort.signal.throwIfAborted();if(JSON.stringify(this.selectionQuery(request.planId,request.channelId))!==JSON.stringify(selection)||JSON.stringify(this.row(received.transferId))!==JSON.stringify(received))throw new Error('Seleção/recebimento mudou durante leitura privada.')}
    this.pending++
    const work=this.serial.then(async()=>{
      current();const origin=await this.candidates.privateOrigin(received.root,request,current,this.abort.signal);current()
      if(JSON.stringify(origin.job.request)!==JSON.stringify(selection.request)||origin.job.sourceDatabaseHash!==selection.reviewDatabaseHash||origin.job.recordedAt!==selection.recordedAt)throw new Error('Proveniência diverge da seleção registrada.')
      return origin
    })
    this.serial=work.catch(()=>{});return work.finally(()=>{this.pending--})
  }
  stageCandidate(raw:unknown,authorize:()=>void){
    const request=haReturnCandidateRequest.parse(raw);authorize();this.current()
    const prior=this.candidates.existing(request);if(prior)return Promise.resolve(prior)
    const selection=this.selections.query(request.planId,request.channelId),review=this.reviewQuery(selection.request.reviewId,request.channelId),rekey=this.rekeyQuery(selection.request.rekeyId,request.channelId),received=this.row(selection.request.transferId)
    if(!selection.ownedHere||review.phase!=='REVIEWED'||review.request.rekeyId!==rekey.request.rekeyId||!rekey.ownedHere||rekey.phase!=='REKEYED_STAGED'||!rekey.result||!received||received.owner!==this.owner||received.phase!=='RECEIVED_QUARANTINE'||rekey.request.transferId!==received.transferId||review.request.transferId!==received.transferId||selection.reviewDatabaseHash!==rekey.result.databaseHash)throw new Error('Materialização exige seleção/revisão/derivada próprias correspondentes.')
    if(HA_RETURN_CANDIDATE_RESERVE>this.quota-this.reservedBytes())throw new Error('Quota insuficiente para candidato; originais preservados.')
    const current=()=>{authorize();this.current();this.abort.signal.throwIfAborted();if(JSON.stringify(this.selections.query(request.planId,request.channelId))!==JSON.stringify(selection)||JSON.stringify(this.reviewQuery(selection.request.reviewId,request.channelId))!==JSON.stringify(review)||JSON.stringify(this.rekeyQuery(selection.request.rekeyId,request.channelId))!==JSON.stringify(rekey)||JSON.stringify(this.row(received.transferId))!==JSON.stringify(received))throw new Error('Origem/seleção mudou durante criação do candidato.')}
    this.candidates.accept(request);this.pending++
    const work=this.serial.then(async()=>{try{current();await this.checkedFile(received);return await this.candidates.create(request,selection,{root:received.root,inspection:join(received.root,'.ha-execution.private-'+selection.request.reviewId,'inspection.db'),hash:rekey.result!.databaseHash,bytes:rekey.result!.databaseBytes,vaultFingerprint:rekey.result!.vaultFingerprint},current,this.abort.signal)}catch{this.candidates.fail(request);return this.candidateQuery(request.candidateId,request.channelId)}})
    this.serial=work.catch(()=>{});return work.finally(()=>{this.pending--})
  }
  selectReturn(raw:unknown,authorize:()=>void,actor:string){
    const request=haReturnSelectionRequest.parse(raw);authorize();this.current()
    const prior=this.selections.existing(request);if(prior)return prior
    const review=this.reviewQuery(request.reviewId,request.channelId),rekey=this.rekeyQuery(request.rekeyId,request.channelId),received=this.row(request.transferId)
    if(review.phase!=='REVIEWED'||review.request.rekeyId!==request.rekeyId||review.request.transferId!==request.transferId||!rekey.ownedHere||rekey.phase!=='REKEYED_STAGED'||rekey.request.transferId!==request.transferId||!rekey.result||!received||received.owner!==this.owner||received.phase!=='RECEIVED_QUARANTINE')throw new Error('Seleção exige revisão reprotegida e recebimento completos próprios.')
    const report=review.report as {baselineChanged?:boolean;databaseHash?:string;protectedFields?:{contentComparison?:{editions:{inventoryMac:string};checkpoint:{receivedMac:string|null;receivedPresent:boolean;referencedEditionPresent:boolean;referencedItemPresent:boolean};selectionBasis:{candidates:Array<{id:string;rundownId:string;active:boolean}>;candidatesTruncated:boolean;checkpoint:{revisionId:string|null;contingencyRevisionIds:string[]}}}}}|null
    const comparison=report?.protectedFields?.contentComparison,basis=comparison?.selectionBasis
    if(!comparison||!basis||basis.candidatesTruncated||report?.baselineChanged!==false||report.databaseHash!==rekey.result.databaseHash||request.editionInventoryMac!==comparison.editions.inventoryMac||request.checkpointMac!==comparison.checkpoint.receivedMac)throw new Error('Seleção não corresponde à revisão completa; atualizar análise sem sobrescrever.')
    if(!Array.isArray(basis.candidates)||new Set(basis.candidates.map(row=>row.id)).size!==basis.candidates.length||request.revisionIds.some(id=>!basis.candidates.some(row=>row.id===id))||basis.candidates.some(row=>row.active&&!request.revisionIds.includes(row.id)))throw new Error('Selecionar edições existentes e preservar todas as edições futuras ativas.')
    if(request.cursorPolicy==='RECEIVED_LAST_CONFIRMED'&&(!comparison.checkpoint.receivedPresent||!comparison.checkpoint.referencedEditionPresent||!comparison.checkpoint.referencedItemPresent||basis.checkpoint.revisionId!==request.executionRevisionId||basis.checkpoint.contingencyRevisionIds.some(id=>!request.revisionIds.includes(id))))throw new Error('Cursor/contingência não pertencem ao conjunto escolhido.')
    const current=()=>{authorize();this.current();if(JSON.stringify(this.reviewQuery(request.reviewId,request.channelId))!==JSON.stringify(review)||JSON.stringify(this.rekeyQuery(request.rekeyId,request.channelId))!==JSON.stringify(rekey)||JSON.stringify(this.row(request.transferId))!==JSON.stringify(received))throw new Error('Base da seleção mudou.')}
    return this.selections.save(request,rekey.result.databaseHash,actor,current)
  }
  historyQuery(importId:string,channelId:string,adapter:HaHistoryAdapter){
    this.current();z.string().uuid().parse(importId);z.string().min(1).max(128).parse(channelId)
    const receipt=adapter.query(importId,channelId),active=this.historyJobs.get(importId),durable=this.durableHistoryJobs.query(importId,channelId)
    if(durable&&(durable.intent.kind!=='IMPORT'||receipt&&JSON.stringify(receipt.request)!==JSON.stringify(durable.intent.request)))throw new Error('Recibo de histórico diverge da intenção durável.')
    if(active&&active.channelId!==channelId)throw new Error('Pedido ativo pertence a outro canal.')
    return {importId,channelId,phase:receipt?'CONFIRMED' as const:active?'PROCESSING' as const:durable?.phase==='COMMITTING'||durable?.phase==='CONFIRMED'?'COMMIT_UNCERTAIN' as const:durable?.phase==='FAILED'?'FAILED' as const:durable?'INTERRUPTED' as const:'NOT_REGISTERED' as const,receipt,publicationAuthorized:false as const}
  }
  variantQuery(decisionId:string,channelId:string,adapter:HaHistoryVariantAdapter){
    this.current();z.string().uuid().parse(decisionId);z.string().min(1).max(128).parse(channelId)
    const receipt=adapter.query(decisionId,channelId),active=this.variantJobs.get(decisionId),durable=this.durableHistoryJobs.query(decisionId,channelId)
    if(durable&&(durable.intent.kind!=='VARIANT'||receipt&&JSON.stringify(receipt.request)!==JSON.stringify(durable.intent.request)))throw new Error('Recibo de variantes diverge da intenção durável.')
    if(active&&active.channelId!==channelId)throw new Error('Decisão ativa pertence a outro canal.')
    return {decisionId,channelId,phase:receipt?'CONFIRMED' as const:active?'PROCESSING' as const:durable?.phase==='COMMITTING'||durable?.phase==='CONFIRMED'?'COMMIT_UNCERTAIN' as const:durable?.phase==='FAILED'?'FAILED' as const:durable?'INTERRUPTED' as const:'NOT_REGISTERED' as const,receipt,publicationAuthorized:false as const}
  }
  preserveVariants(raw:unknown,adapter:HaHistoryVariantAdapter,authorize:()=>void,actor:string){
    const request=haHistoryVariantRequest.parse(raw);authorize();this.current()
    if(this.durableHistoryJobs.existing({kind:'VARIANT',request}))return Promise.resolve(this.variantQuery(request.decisionId,request.channelId,adapter))
    const prior=adapter.query(request.decisionId,request.channelId),active=this.variantJobs.get(request.decisionId)
    if(prior||active){if(JSON.stringify(prior?.request??active)!==JSON.stringify(request))throw new Error('UUID pertence a outra decisão.');return Promise.resolve(this.variantQuery(request.decisionId,request.channelId,adapter))}
    const review=this.reviewQuery(request.reviewId,request.channelId),received=this.row(request.transferId)
    if(review.request.rekeyId)throw new Error('Decisão de histórico exige revisão original; revisão reprotegida não autoriza importação.')
    if(review.phase!=='REVIEWED'||review.request.transferId!==request.transferId||!received||received.owner!==this.owner||received.phase!=='RECEIVED_QUARANTINE'||received.seal.channelId!==request.channelId)throw new Error('Decisão exige revisão e recebimento completos próprios.')
    const report=review.report as {schema?:{current?:boolean};history?:{details?:Array<{id:string;kind:string;primaryHash:string|null;receivedHash:string|null}>}}|null
    if(!report?.schema?.current||!Array.isArray(report.history?.details)||request.records.some(row=>!report.history!.details!.some(detail=>detail.id===row.id&&['CHANGED','PRIMARY_ONLY'].includes(detail.kind)&&detail.primaryHash===row.primaryHash&&detail.receivedHash===row.receivedHash)))throw new Error('Selecionar somente conflitos explicitamente identificados por ambos os hashes.')
    if(HA_RETURN_HISTORY_JOB_RESERVE>this.quota-this.reservedBytes())throw new Error('Quota insuficiente para diário de variantes.')
    this.durableHistoryJobs.accept({kind:'VARIANT',request},actor)
    this.variantJobs.set(request.decisionId,request);this.pending++
    const work=this.serial.then(async()=>{
      this.current();this.durableHistoryJobs.transition({kind:'VARIANT',request},'EXTRACTING')
      const current=()=>{authorize();this.current();this.abort.signal.throwIfAborted();if(JSON.stringify(this.row(request.transferId))!==JSON.stringify(received)||JSON.stringify(this.reviewQuery(request.reviewId,request.channelId))!==JSON.stringify(review))throw new Error('Recebimento/revisão mudou durante decisão.')}
      current();const {path}=await this.checkedFile(received),inspection=join(received.root,'.ha-execution.private-'+request.reviewId,'inspection.db')
      const verify=async(file:string)=>{current();await ancestry(dirname(file));const initial=await lstat(file);if(!initial.isFile()||initial.isSymbolicLink()||initial.nlink!==1||initial.size!==received.seal.databaseBytes)throw new Error('Arquivo revisado mudou.');const input=await open(file,'r');try{const digest=createHash('sha256'),buffer=Buffer.alloc(HA_RETURN_CHUNK_BYTES);let offset=0;while(offset<initial.size){current();const read=await input.read(buffer,0,Math.min(buffer.length,initial.size-offset),offset);if(!read.bytesRead)throw new Error('Arquivo truncado.');digest.update(buffer.subarray(0,read.bytesRead));offset+=read.bytesRead}if(!same(initial,await input.stat())||!same(initial,await lstat(file))||digest.digest('hex')!==received.seal.databaseHash)throw new Error('SHA/identidade divergentes.')}finally{await input.close()}}
      await verify(path);await verify(inspection);current()
      const variants=await runReturnVariantExtraction(inspection,request.channelId,request.records,this.abort.signal)
      await verify(inspection);await verify(path);await this.checkedFile(received);current()
      this.durableHistoryJobs.transition({kind:'VARIANT',request},'COMMITTING')
      adapter.commit(request,variants,authorize,actor)
      const committed=adapter.query(request.decisionId,request.channelId)
      if(!committed||JSON.stringify(committed.request)!==JSON.stringify(request))throw new Error('Recibo operacional de variantes não confirmou a intenção.')
      current();this.durableHistoryJobs.transition({kind:'VARIANT',request},'CONFIRMED')
      return this.variantQuery(request.decisionId,request.channelId,adapter)
    })
    const guarded=work.catch(error=>{try{this.current();this.durableHistoryJobs.failBeforeCommit({kind:'VARIANT',request})}catch{}throw error})
    this.serial=guarded.catch(()=>{});return guarded.finally(()=>{this.variantJobs.delete(request.decisionId);this.pending--})
  }
  importHistory(raw:unknown,adapter:HaHistoryAdapter,authorize:()=>void,actor:string){
    const request=haHistoryImportRequest.parse(raw);authorize();this.current()
    if(this.durableHistoryJobs.existing({kind:'IMPORT',request}))return Promise.resolve(this.historyQuery(request.importId,request.channelId,adapter))
    const prior=adapter.query(request.importId,request.channelId),active=this.historyJobs.get(request.importId)
    if(prior||active){if(JSON.stringify(prior?.request??active)!==JSON.stringify(request))throw new Error('UUID pertence a outra importação.');return Promise.resolve(this.historyQuery(request.importId,request.channelId,adapter))}
    const review=this.reviewQuery(request.reviewId,request.channelId),received=this.row(request.transferId)
    if(review.request.rekeyId)throw new Error('Importação exige revisão original; revisão reprotegida não autoriza importação.')
    if(review.phase!=='REVIEWED'||review.request.transferId!==request.transferId||!received||received.owner!==this.owner||received.phase!=='RECEIVED_QUARANTINE'||received.seal.channelId!==request.channelId)throw new Error('Importação exige revisão completa e recebimento próprio.')
    const report=review.report as {schema?:{current?:boolean};history?:{details?:Array<{id:string;kind:string;receivedHash:string|null}>}}|null
    if(!report?.schema?.current||!Array.isArray(report.history?.details)||request.records.some(row=>!report.history!.details!.some(detail=>detail.id===row.id&&detail.kind==='RECEIVED_ONLY'&&detail.receivedHash===row.receivedHash)))throw new Error('Selecionar somente registros novos explicitamente identificados na revisão.')
    if(HA_RETURN_HISTORY_JOB_RESERVE>this.quota-this.reservedBytes())throw new Error('Quota insuficiente para diário de importação.')
    this.durableHistoryJobs.accept({kind:'IMPORT',request},actor)
    this.historyJobs.set(request.importId,request);this.pending++
    const work=this.serial.then(async()=>{
      this.current();this.durableHistoryJobs.transition({kind:'IMPORT',request},'EXTRACTING')
      const current=()=>{authorize();this.current();this.abort.signal.throwIfAborted();if(JSON.stringify(this.row(request.transferId))!==JSON.stringify(received)||JSON.stringify(this.reviewQuery(request.reviewId,request.channelId))!==JSON.stringify(review))throw new Error('Recebimento/revisão mudou durante importação.')}
      current();const {path}=await this.checkedFile(received),inspection=join(received.root,'.ha-execution.private-'+request.reviewId,'inspection.db')
      const verify=async(file:string)=>{current();await ancestry(dirname(file));const initial=await lstat(file);if(!initial.isFile()||initial.isSymbolicLink()||initial.nlink!==1||initial.size!==received.seal.databaseBytes)throw new Error('Arquivo revisado mudou.');const input=await open(file,'r');try{const digest=createHash('sha256'),buffer=Buffer.alloc(HA_RETURN_CHUNK_BYTES);let offset=0;while(offset<initial.size){current();const read=await input.read(buffer,0,Math.min(buffer.length,initial.size-offset),offset);if(!read.bytesRead)throw new Error('Arquivo truncado.');digest.update(buffer.subarray(0,read.bytesRead));offset+=read.bytesRead}if(!same(initial,await input.stat())||!same(initial,await lstat(file))||digest.digest('hex')!==received.seal.databaseHash)throw new Error('SHA/identidade divergentes.')}finally{await input.close()}}
      await verify(path);await verify(inspection);current()
      const rows=await runReturnHistoryExtraction(inspection,request.channelId,request.records,this.abort.signal)
      await verify(inspection);await verify(path);await this.checkedFile(received);current()
      this.durableHistoryJobs.transition({kind:'IMPORT',request},'COMMITTING')
      adapter.commit(request,rows,authorize,actor)
      const committed=adapter.query(request.importId,request.channelId)
      if(!committed||JSON.stringify(committed.request)!==JSON.stringify(request))throw new Error('Recibo operacional de importação não confirmou a intenção.')
      current();this.durableHistoryJobs.transition({kind:'IMPORT',request},'CONFIRMED')
      return this.historyQuery(request.importId,request.channelId,adapter)
    })
    const guarded=work.catch(error=>{try{this.current();this.durableHistoryJobs.failBeforeCommit({kind:'IMPORT',request})}catch{}throw error})
    this.serial=guarded.catch(()=>{});return guarded.finally(()=>{this.historyJobs.delete(request.importId);this.pending--})
  }
  review(raw:unknown,capture:()=>HaSnapshot,authorize:()=>void){
    const request=haReturnReviewRequest.parse(raw);authorize();this.current()
    if(this.db.prepare('SELECT 1 FROM ha_return_reviews WHERE review_id=?').get(request.reviewId)){const saved=this.reviewQuery(request.reviewId,request.channelId);if(JSON.stringify(saved.request)!==JSON.stringify(request))throw new Error('UUID pertence a outra revisão.');return Promise.resolve(saved)}
    const received=this.row(request.transferId)
    if(!received||received.seal.channelId!==request.channelId||received.phase!=='RECEIVED_QUARANTINE'||received.owner!==this.owner)throw new Error('Revisão exige recebimento completo próprio; não adotar arquivo de outra instância.')
    const rekey=request.rekeyId?this.rekeyQuery(request.rekeyId,request.channelId):null
    if(rekey&&(!rekey.ownedHere||rekey.phase!=='REKEYED_STAGED'||!rekey.result||rekey.request.transferId!==request.transferId))throw new Error('Revisão reprotegida exige derivada confirmada própria do mesmo recebimento.')
    const sourceHash=rekey?.result?.databaseHash??received.seal.databaseHash,sourceBytes=rekey?.result?.databaseBytes??received.seal.databaseBytes
    const sourcePath=rekey?join(received.root,'.ha-execution.private-'+request.rekeyId,'rekeyed.db'):this.path(received)
    const reviewRows=this.db.prepare('SELECT review_id,channel_id FROM ha_return_reviews').all() as {review_id:string;channel_id:string}[]
    const reserved=this.reservedBytes()
    const quotaBytes=sourceBytes+64*1024*1024
    if(reviewRows.length>=128||quotaBytes>this.quota-reserved)throw new Error('Quota/limite de revisões atingido; cópias anteriores preservadas.')
    let review:z.infer<typeof reviewRecord>={version:1,request,owner:this.owner,phase:'ACCEPTED',quotaBytes,updatedAt:new Date().toISOString(),baselineHash:null,report:null,primaryApproved:false,publicationAuthorized:false}
    this.db.prepare('INSERT INTO ha_return_reviews VALUES(?,?,?,?)').run(request.reviewId,request.transferId,request.channelId,installationVault(false).encrypt(JSON.stringify(review),'ha-return-review:v1:'+this.context+':'+request.reviewId))
    const store=()=>{review=reviewRecord.parse({...review,updatedAt:new Date().toISOString()});if(this.db.prepare('UPDATE ha_return_reviews SET report=? WHERE review_id=?').run(installationVault(false).encrypt(JSON.stringify(review),'ha-return-review:v1:'+this.context+':'+request.reviewId),request.reviewId).changes!==1)throw new Error('Diário de revisão perdeu pedido.')}
    const current=()=>{authorize();this.current();this.abort.signal.throwIfAborted();if(JSON.stringify(this.row(request.transferId))!==JSON.stringify(received)||rekey&&JSON.stringify(this.rekeyQuery(request.rekeyId!,request.channelId))!==JSON.stringify(rekey))throw new Error('Recebimento/reproteção mudou durante revisão.')}
    this.pending++
    const work=this.serial.then(async()=>{
      let file:Awaited<ReturnType<typeof open>>|null=null
      try{
        current();await this.checkedFile(received);const path=sourcePath;await ancestry(dirname(path));const info=await lstat(path)
        if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size!==sourceBytes||existsSync(path+'-wal')||existsSync(path+'-shm')||existsSync(path+'-journal'))throw new Error('Fonte da revisão mudou/não está consolidada.')
        file=await open(path,'r');if(!same(info,await file.stat()))throw new Error('Cópia mudou durante abertura.')
        const hash=async()=>{const digest=createHash('sha256'),buffer=Buffer.alloc(HA_RETURN_CHUNK_BYTES);let offset=0;while(offset<info.size){current();const read=await file!.read(buffer,0,Math.min(buffer.length,info.size-offset),offset);if(!read.bytesRead)throw new Error('Cópia truncada.');digest.update(buffer.subarray(0,read.bytesRead));offset+=read.bytesRead}await ancestry(dirname(path));if(!same(info,await file!.stat())||!same(info,await lstat(path))||digest.digest('hex')!==sourceHash||existsSync(path+'-wal')||existsSync(path+'-shm')||existsSync(path+'-journal'))throw new Error('Cópia mudou após recebimento/reproteção.')}
        await hash();current()
        // SQLite readonly can still create WAL/SHM sidecars. Inspect a NEW private
        // derivative, never let that connection touch the received evidence path.
        const free=await statfs(received.root,{bigint:true});if(free.bavail*free.bsize<BigInt(info.size)+64n*1024n*1024n)throw new Error('Sem espaço para cópia isolada de revisão; evidência original preservada.')
        const directory=join(received.root,'.ha-execution.private-'+request.reviewId),inspection=join(directory,'inspection.db')
        await ancestry(received.root);await mkdir(directory,{mode:0o700});await protectGeneratedHaDirectory(directory);current();await writePrivateConfig(inspection,'',current)
        const empty=await lstat(inspection);if(!empty.isFile()||empty.isSymbolicLink()||empty.nlink!==1||empty.size!==0)throw new Error('Derivada deixou de estar vazia.')
        const output=await open(inspection,'r+'),buffer=Buffer.alloc(HA_RETURN_CHUNK_BYTES)
        try{if(!same(empty,await output.stat()))throw new Error('Derivada mudou durante abertura.');let offset=0;while(offset<info.size){current();const read=await file.read(buffer,0,Math.min(buffer.length,info.size-offset),offset);if(!read.bytesRead)throw new Error('Cópia de revisão truncada.');let written=0;while(written<read.bytesRead){current();const part=await output.write(buffer,written,read.bytesRead-written,offset+written);if(!part.bytesWritten)throw new Error('Cópia de revisão incompleta.');written+=part.bytesWritten}offset+=read.bytesRead}await output.sync();const final=await output.stat();if(final.dev!==empty.dev||final.ino!==empty.ino||final.size!==info.size||!same(final,await lstat(inspection)))throw new Error('Derivada mudou durante gravação.')}finally{await output.close()}
        await hash();current();const derivative=await lstat(inspection)
        if(!derivative.isFile()||derivative.isSymbolicLink()||derivative.nlink!==1||derivative.size!==info.size)throw new Error('Derivada de revisão inválida.')
        const verifyDerivative=async()=>{const input=await open(inspection,'r');try{const digest=createHash('sha256');let offset=0;while(offset<derivative.size){current();const read=await input.read(buffer,0,Math.min(buffer.length,derivative.size-offset),offset);if(!read.bytesRead)throw new Error('Derivada truncada.');digest.update(buffer.subarray(0,read.bytesRead));offset+=read.bytesRead}await ancestry(directory);if(digest.digest('hex')!==sourceHash||!same(derivative,await input.stat())||!same(derivative,await lstat(inspection)))throw new Error('Derivada mudou durante revisão.')}finally{await input.close()}}
        await verifyDerivative();const baseline=capture();review={...review,phase:'REVIEWING',baselineHash:createHash('sha256').update(JSON.stringify(baseline)).digest('hex')};store()
        const report=await runReturnReview(inspection,request.channelId,baseline,this.abort.signal,rekey?.result?{exportId:received.seal.exportId,vaultFingerprint:rekey.result.vaultFingerprint,ownershipEvidence:rekey.result.ownershipEvidence}:undefined)
        if(rekey?.result){const fields=report.protectedFields,ownership=fields?.foreignOwnership;if(!fields||fields.fields!==rekey.result.entries||fields.vaultFingerprint!==rekey.result.vaultFingerprint||fields.encodingValidated!==true||fields.contentApproved!==false||fields.localExecutionAuthorized!==false||!!ownership!==!!rekey.result.ownershipEvidence||ownership&&(ownership.inventoryMatched!==true||ownership.sourceSignaturesAttested!==true||ownership.localExecutionAuthorized!==false||ownership.authorityTransferred!==false))throw new Error('Worker não confirmou revisão reprotegida correspondente.')}
        await verifyDerivative()
        await hash();current()
        // capture timestamps/transport continuously move; compare editorial/history
        // rather than rejecting every otherwise useful point-in-time review.
        const facts=(view:HaSnapshot)=>JSON.stringify({channels:view.channels.filter(row=>row.channelId===request.channelId).map(row=>({channelId:row.channelId,configuration:row.configuration,revisions:row.revisions,checkpoint:row.checkpoint,blockers:row.blockers})),asRun:view.asRun.filter(row=>(row.channelId??row.channel_id)===request.channelId),journals:view.journals})
        const baselineChanged=facts(baseline)!==facts(capture())
        await this.checkedFile(received);current()
        review={...review,phase:'REVIEWED',report:{...report,baselineChanged,...(baselineChanged?{blockers:[...report.blockers,'PRIMARY_CHANGED_DURING_REVIEW']}:{}),databaseHash:sourceHash,sourceKind:rekey?'REKEYED_DERIVATIVE':'RECEIVED_EVIDENCE',rekeyId:request.rekeyId??null,receivedDatabaseHash:received.seal.databaseHash,transferId:received.transferId,exportId:received.seal.exportId,confirmationIsHistorical:true}};store()
      }catch{review={...review,phase:'FAILED'};store()}
      finally{await file?.close()}
      return this.reviewQuery(request.reviewId,request.channelId)
    })
    this.serial=work.catch(()=>{});return work.finally(()=>{this.pending--})
  }
  private path(value:Record){return join(value.root,'.ha-execution.private-'+value.transferId,'returned.db')}
  private async checkedFile(value:Record){
    this.current();if(value.owner!==this.owner||value.phase==='ALLOCATING'||value.device===null||value.inode===null)throw new Error('Cópia parcial de outra instância ou sem alocação confirmada; não será adotada.')
    const path=this.path(value);await ancestry(dirname(path));const info=await lstat(path)
    if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||String(info.dev)!==value.device||String(info.ino)!==value.inode||info.size!==value.offset||existsSync(path+'-wal')||existsSync(path+'-shm'))throw new Error('Arquivo de retorno diverge do diário; evidência preservada sem truncar.')
    this.current();return {path,info}
  }
  private async apply(operation:z.infer<typeof haReturnOperation>){
    this.current();let value=this.row(operation.transferId)
    if(operation.operation==='BEGIN'){
      const canonical=JSON.stringify(operation.seal)
      if(createHash('sha256').update(canonical).digest('hex')!==operation.manifestHash)throw new Error('Manifesto de retorno diverge do selo autenticado.')
      if(value){if(JSON.stringify(value.seal)!==canonical||value.manifestHash!==operation.manifestHash)throw new Error('UUID pertence a outra exportação.');return this.progress(value)}
      const used=this.db.prepare('SELECT report,transfer_id FROM ha_return_received').all() as {report:string;transfer_id:string}[]
      const reserved=this.reservedBytes()
      if(used.length>=128||operation.seal.databaseBytes>this.quota-reserved)throw new Error('Quota/limite de quarentenas atingido; originais preservados.')
      await ancestry(dirname(resolve(this.root)))
      try{await mkdir(resolve(this.root),{mode:0o700})}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error}
      await ancestry(this.root)
      const free=await statfs(this.root,{bigint:true});if(free.bavail*free.bsize<BigInt(operation.seal.databaseBytes)+64n*1024n*1024n)throw new Error('Sem espaço para quarentena de retorno.')
      this.current()
      value={version:1,transferId:operation.transferId,seal:operation.seal,manifestHash:operation.manifestHash,root:resolve(this.root),owner:this.owner,device:null,inode:null,phase:'ALLOCATING',offset:0,checkedAt:new Date().toISOString()}
      this.db.prepare('INSERT INTO ha_return_received VALUES(?,?,?,?)').run(value.transferId,value.seal.exportId,value.seal.promotionId,installationVault(false).encrypt(JSON.stringify(value),this.key(value.transferId)))
      const directory=dirname(this.path(value));await mkdir(directory,{mode:0o700});await protectGeneratedHaDirectory(directory);this.current()
      await writePrivateConfig(this.path(value),'',()=>this.current())
      const info=await lstat(this.path(value));if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size!==0)throw new Error('Destino de retorno deixou de estar vazio.')
      value=this.store({...value,device:String(info.dev),inode:String(info.ino),phase:'RECEIVING'})
      return this.progress(value)
    }
    if(!value)throw new Error('Transferência de retorno ainda não registrada.')
    if(operation.operation==='STATUS')return this.progress(value) // historical, no file adoption
    if(value.phase==='RECEIVED_QUARANTINE'&&operation.operation==='VERIFY')return this.progress(value) // historical receipt, not current DB approval
    const {path,info}=await this.checkedFile(value),file=await open(path,operation.operation==='WRITE'?'r+':'r')
    try{
      if(!same(info,await file.stat()))throw new Error('Destino mudou durante abertura.')
      if(operation.operation==='WRITE'){
        if(value.phase!=='RECEIVING'||!/^[A-Za-z0-9+/]+={0,2}$/.test(operation.data)||operation.data.length%4)throw new Error('Bloco de retorno inválido.')
        const bytes=Buffer.from(operation.data,'base64');if(!bytes.length||bytes.length>HA_RETURN_CHUNK_BYTES||bytes.toString('base64')!==operation.data||operation.offset+bytes.length>value.seal.databaseBytes)throw new Error('Bloco fora do tamanho selado.')
        if(operation.offset<value.offset){
          if(operation.offset+bytes.length>value.offset)throw new Error('Repetição parcial não corresponde a bloco confirmado.')
          const previous=Buffer.alloc(bytes.length);const read=await file.read(previous,0,previous.length,operation.offset)
          if(read.bytesRead!==bytes.length||!previous.equals(bytes)||!same(info,await file.stat())||!same(info,await lstat(path)))throw new Error('Bloco repetido diverge; nenhum byte sobrescrito.')
          this.current();return this.progress(value)
        }
        if(operation.offset!==value.offset)throw new Error('Blocos devem seguir offset confirmado; nenhum salto/truncamento.')
        let written=0;while(written<bytes.length){this.current();const part=await file.write(bytes,written,bytes.length-written,value.offset+written);if(!part.bytesWritten)throw new Error('Gravação de retorno incompleta.');written+=part.bytesWritten}
        await file.sync();this.current();await ancestry(dirname(path));const after=await file.stat(),named=await lstat(path)
        if(after.size!==value.offset+bytes.length||after.dev!==info.dev||after.ino!==info.ino||!same(after,named))throw new Error('Destino mudou durante gravação; parcial não confirmado.')
        value=this.store({...value,offset:after.size});return this.progress(value)
      }
      if(value.offset!==value.seal.databaseBytes)throw new Error('Retorno incompleto; não emitir recibo de recebimento.')
      const digest=createHash('sha256'),buffer=Buffer.alloc(HA_RETURN_CHUNK_BYTES);let offset=0
      while(offset<info.size){this.current();const read=await file.read(buffer,0,Math.min(buffer.length,info.size-offset),offset);if(!read.bytesRead)throw new Error('Retorno truncado.');digest.update(buffer.subarray(0,read.bytesRead));offset+=read.bytesRead}
      this.current();await ancestry(dirname(path))
      if(digest.digest('hex')!==value.seal.databaseHash||!same(info,await file.stat())||!same(info,await lstat(path))||existsSync(path+'-wal')||existsSync(path+'-shm'))throw new Error('Retorno alterado ou SHA divergente; não aprovar.')
      value=this.store({...value,phase:'RECEIVED_QUARANTINE'});return this.progress(value)
    }finally{await file.close()}
  }
  close(){this.closed=true;this.abort.abort()}
  get running(){return this.pending>0}
  async settled(){await this.serial}
}
