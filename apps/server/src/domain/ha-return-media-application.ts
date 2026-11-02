import type Database from 'better-sqlite3'
import {z} from 'zod'
import {createHash} from 'node:crypto'
import {mkdir,lstat,open,statfs} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {dirname,join,resolve} from 'node:path'
import {installationVault} from './secret-vault.js'
import {protectGeneratedHaDirectory,writePrivateConfig} from './private-config-file.js'
import {runReturnMediaCandidate} from './ha-return-review-runner.js'
import type {HaReturnApplications} from './ha-return-application.js'
import type {HaReturnMediaReviews} from './ha-return-media-review.js'
import type {HaBindings} from './ha-bindings.js'
import {returnGraphicSummarySchema} from './ha-return-graphics-review.js'
import {returnAudioSummarySchema} from './ha-return-audio-review.js'
import {haReturnAutoDecisionRequest} from './ha-return-auto-decision.js'
import {verifyReturnLocalMediaBytes} from './ha-return-local-media.js'

export const HA_RETURN_MEDIA_APPLICATION_RESERVE=512*1024*1024
export const haReturnMediaApplicationRequest=z.object({mediaApplicationId:z.string().uuid(),mediaReviewId:z.string().uuid(),channelId:z.string().min(1).max(128),autoDecisionId:z.string().uuid().optional()}).strict()
const hash=z.string().regex(/^[a-f0-9]{64}$/),count=z.number().int().nonnegative().max(100000)
const resultSchema=z.object({applicationId:z.string().uuid(),sourceDatabaseHash:hash,databaseHash:hash,databaseBytes:z.number().int().positive().max(256*1024*1024),vaultFingerprint:hash,bindingPlanId:z.string().uuid(),bindingDigest:hash,evidenceMac:z.string().regex(/^[A-Za-z0-9_-]{43}$/),selectedRevisions:z.number().int().positive().max(128),checkedMounts:count,blockedMounts:count,livePending:count,mixPending:count,graphicPending:count,graphics:returnGraphicSummarySchema.optional(),graphicRenderEvidenceApplied:z.literal(true).optional(),audio:returnAudioSummarySchema.optional(),audioEvidenceApplied:z.literal(true).optional(),mediaEvidenceApplied:z.literal(true),outputsApplied:z.literal(false),nativePrepared:z.literal(false),authorityTransferred:z.literal(false),publicationAuthorized:z.literal(false)}).strict().refine(v=>v.blockedMounts<=v.checkedMounts&&Boolean(v.graphics)===(v.graphicRenderEvidenceApplied===true)&&Boolean(v.audio)===(v.audioEvidenceApplied===true))
const recordSchema=z.object({version:z.literal(1),request:haReturnMediaApplicationRequest,owner:z.string(),phase:z.enum(['ACCEPTED','APPLYING','STAGED','FAILED']),quotaBytes:z.literal(HA_RETURN_MEDIA_APPLICATION_RESERVE),updatedAt:z.string().datetime(),result:resultSchema.nullable()}).strict().refine(v=>v.phase!=='STAGED'||!!v.result)
type Prepared={receipt:ReturnType<HaReturnMediaReviews['privateEvidence']>;plan:ReturnType<HaBindings['executionBindings']>;rate:{num:number;den:number};audioChannels:number;autoDecisionRequest?:z.infer<typeof haReturnAutoDecisionRequest>;verifyCurrent:()=>Promise<void>;assertCurrent:()=>void}
const same=(a:Awaited<ReturnType<typeof lstat>>,b:Awaited<ReturnType<typeof lstat>>)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs&&b.nlink===1
async function ancestry(path:string){let cursor=resolve(path);for(;;){const info=await lstat(cursor);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Link/junção não permitido.');const parent=dirname(cursor);if(parent===cursor)return;cursor=parent}}
export class HaReturnMediaApplications{
  closeInterrupted(id:string,channelId:string,expectedPhase:string,expectedUpdatedAt:string,stopped:(owner:string)=>void){
    const value=this.read(id,channelId)
    if(!['ACCEPTED','APPLYING'].includes(value.phase)||value.phase!==expectedPhase||value.updatedAt!==expectedUpdatedAt||value.result)throw new Error('Cópia mudou ou contém confirmação; não encerrar.')
    stopped(value.owner);this.write({...value,phase:'FAILED',updatedAt:new Date().toISOString()})
  }
  constructor(private readonly db:Database.Database,private readonly context:string,private readonly owner:string){db.exec('CREATE TABLE IF NOT EXISTS ha_return_media_applications(media_application_id TEXT PRIMARY KEY,media_review_id TEXT NOT NULL UNIQUE,channel_id TEXT NOT NULL,payload TEXT NOT NULL)')}
  private key(id:string){return 'ha-return-media-application:v1:'+this.context+':'+id}
  private read(id:string,channelId:string){const row=this.db.prepare('SELECT * FROM ha_return_media_applications WHERE media_application_id=?').get(z.string().uuid().parse(id)) as {media_application_id:string;media_review_id:string;channel_id:string;payload:string}|undefined;if(!row)throw new Error('Cópia de mídia não registrada.');const value=recordSchema.parse(JSON.parse(installationVault(false).decrypt(row.payload,this.key(id))));if(value.request.mediaApplicationId!==row.media_application_id||value.request.mediaReviewId!==row.media_review_id||value.request.channelId!==row.channel_id||row.channel_id!==channelId)throw new Error('Diário da cópia diverge da intenção/canal.');return value}
  query(id:string,channelId:string){const {owner,...record}=this.read(id,channelId);return {...record,ownedHere:owner===this.owner,confirmationIsHistorical:true as const,operationalReady:false as const}}
  /** Recheck sealed local media.db without opening/migrating or admitting it. */
  async verify(root:string,id:string,channelId:string,current:()=>void,signal:AbortSignal){
    const record=this.read(id,channelId),proof=record.result
    current();signal.throwIfAborted()
    if(record.owner!==this.owner||record.phase!=='STAGED'||!proof||resolve(root).startsWith('\\\\')||installationVault(false).fingerprint!==proof.vaultFingerprint)throw new Error('Conferência exige cópia de mídia própria e cofre correspondente.')
    const file=join(resolve(root),'.ha-execution.private-'+record.request.mediaApplicationId,'media.db'),info=await lstat(file)
    if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size!==proof.databaseBytes||info.size>256*1024*1024||['-wal','-shm','-journal'].some(suffix=>existsSync(file+suffix)))throw new Error('Cópia de mídia não permaneceu consolidada.')
    const stamp=await verifyReturnLocalMediaBytes(file,proof.databaseHash,signal,current)
    if(['-wal','-shm','-journal'].some(suffix=>existsSync(file+suffix))||JSON.stringify(this.read(id,channelId))!==JSON.stringify(record)||installationVault(false).fingerprint!==proof.vaultFingerprint)throw new Error('Cópia/cofre mudou durante conferência.')
    current();signal.throwIfAborted();return stamp
  }
  existing(raw:unknown){const request=haReturnMediaApplicationRequest.parse(raw);if(!this.db.prepare('SELECT 1 FROM ha_return_media_applications WHERE media_application_id=?').get(request.mediaApplicationId))return null;const value=this.query(request.mediaApplicationId,request.channelId);if(JSON.stringify(value.request)!==JSON.stringify(request))throw new Error('UUID pertence a outra intenção.');return value}
  reservedBytes(){return (this.db.prepare('SELECT count(*) n FROM ha_return_media_applications').get() as {n:number}).n*HA_RETURN_MEDIA_APPLICATION_RESERVE}
  accept(raw:unknown){const request=haReturnMediaApplicationRequest.parse(raw),prior=this.existing(request);if(prior)return prior;const value=recordSchema.parse({version:1,request,owner:this.owner,phase:'ACCEPTED',quotaBytes:HA_RETURN_MEDIA_APPLICATION_RESERVE,updatedAt:new Date().toISOString(),result:null});this.db.prepare('INSERT INTO ha_return_media_applications VALUES(?,?,?,?)').run(request.mediaApplicationId,request.mediaReviewId,request.channelId,installationVault(false).encrypt(JSON.stringify(value),this.key(request.mediaApplicationId)));return this.query(request.mediaApplicationId,request.channelId)}
  private write(raw:unknown){const value=recordSchema.parse(raw);if(this.db.prepare('UPDATE ha_return_media_applications SET payload=? WHERE media_application_id=?').run(installationVault(false).encrypt(JSON.stringify(value),this.key(value.request.mediaApplicationId)),value.request.mediaApplicationId).changes!==1)throw new Error('Cópia perdeu diário.')}
  fail(raw:unknown){const request=haReturnMediaApplicationRequest.parse(raw),value=this.read(request.mediaApplicationId,request.channelId);if(value.owner!==this.owner||value.phase==='STAGED')throw new Error('Não alterar cópia confirmada/estrangeira.');this.write({...value,phase:'FAILED',result:null,updatedAt:new Date().toISOString()})}
  async create(raw:unknown,root:string,application:ReturnType<HaReturnApplications['query']>,prepared:Prepared,signal:AbortSignal,alive:()=>void){
    const request=haReturnMediaApplicationRequest.parse(raw),initial=this.read(request.mediaApplicationId,request.channelId),proof=application.result,receipt=prepared.receipt
    if(request.autoDecisionId!==prepared.autoDecisionRequest?.decisionId||prepared.autoDecisionRequest&&(prepared.autoDecisionRequest.mediaReviewId!==request.mediaReviewId||prepared.autoDecisionRequest.channelId!==request.channelId||prepared.autoDecisionRequest.evidenceMac!==receipt.result.evidenceMac))throw new Error('Decisão AUTO não corresponde ao pedido de cópia.')
    if(initial.owner!==this.owner||initial.phase!=='ACCEPTED'||!application.ownedHere||application.phase!=='STAGED'||!proof||receipt.request.mediaReviewId!==request.mediaReviewId||receipt.request.applicationId!==application.request.applicationId||receipt.request.channelId!==request.channelId||receipt.result.applicationDatabaseHash!==proof.databaseHash||prepared.plan.bindingDigest!==proof.bindingDigest||prepared.plan.planId!==application.request.bindingPlanId)throw new Error('Cópia exige revisão/aplicação/plano próprios correspondentes.')
    const check=()=>{signal.throwIfAborted();alive()},confirm=()=>{check();prepared.assertCurrent()}
    const hashFile=async(file:string,expected?:Awaited<ReturnType<typeof lstat>>)=>{
      check();await ancestry(dirname(file));const info=await lstat(file)
      if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size<=0||info.size>256*1024*1024||expected&&!same(expected,info)||['-wal','-shm','-journal'].some(suffix=>existsSync(file+suffix)))throw new Error('DB não consolidada ou alterada.')
      const handle=await open(file,'r')
      try{if(!same(info,await handle.stat()))throw new Error('Identidade mudou antes de SHA.');const digest=createHash('sha256'),buffer=Buffer.alloc(256*1024);let offset=0;while(offset<info.size){check();const read=await handle.read(buffer,0,Math.min(buffer.length,info.size-offset),offset);if(!read.bytesRead)throw new Error('DB truncada.');digest.update(buffer.subarray(0,read.bytesRead));offset+=read.bytesRead}if(!same(info,await handle.stat())||!same(info,await lstat(file))||['-wal','-shm','-journal'].some(suffix=>existsSync(file+suffix)))throw new Error('DB mudou durante SHA.');return {info,hash:digest.digest('hex')}}finally{await handle.close()}
    }
    try{
      confirm();if(resolve(root).startsWith('\\\\'))throw new Error('Raiz exige disco local.')
      const source=join(resolve(root),'.ha-execution.private-'+application.request.applicationId,'bound.db'),before=await hashFile(source)
      if(before.hash!==proof.databaseHash||before.info.size!==proof.databaseBytes||installationVault(false).fingerprint!==proof.vaultFingerprint)throw new Error('Fonte/cofre divergem do recibo.')
      const free=await statfs(root,{bigint:true});if(free.bavail*free.bsize<BigInt(HA_RETURN_MEDIA_APPLICATION_RESERVE))throw new Error('Espaço insuficiente para DB/journal.')
      const directory=join(resolve(root),'.ha-execution.private-'+request.mediaApplicationId),file=join(directory,'media.db')
      await ancestry(root);await mkdir(directory,{mode:0o700});await protectGeneratedHaDirectory(directory);check();await writePrivateConfig(file,'',check)
      const empty=await lstat(file);if(!empty.isFile()||empty.isSymbolicLink()||empty.nlink!==1||empty.size)throw new Error('Destino não permaneceu novo/vazio.')
      this.write({...initial,phase:'APPLYING',updatedAt:new Date().toISOString()});confirm()
      const converted=await runReturnMediaCandidate(source,file,{mediaApplicationId:request.mediaApplicationId,applicationId:application.request.applicationId,candidate:application.request.candidate,sourceDatabaseHash:proof.databaseHash,sourceDatabaseBytes:proof.databaseBytes,vaultFingerprint:proof.vaultFingerprint,recordedAt:initial.updatedAt,rate:prepared.rate,audioChannels:prepared.audioChannels as 2|8|16,mediaReview:receipt.request,reviewResult:receipt.result,encodedEvidence:receipt.encodedEvidence,...(prepared.autoDecisionRequest?{autoDecision:prepared.autoDecisionRequest}:{})},signal)
      confirm();await prepared.verifyCurrent();confirm()
      const final=await hashFile(file),after=await hashFile(source,before.info)
      if(after.hash!==proof.databaseHash||final.info.dev!==empty.dev||final.info.ino!==empty.ino||converted.version!==1||converted.mediaApplicationId!==request.mediaApplicationId||converted.applicationId!==application.request.applicationId||converted.mediaReviewId!==request.mediaReviewId||JSON.stringify(converted.candidate)!==JSON.stringify(application.request.candidate)||converted.bindingPlanId!==prepared.plan.planId||converted.bindingDigest!==prepared.plan.bindingDigest||converted.evidenceMac!==receipt.result.evidenceMac||converted.vaultFingerprint!==proof.vaultFingerprint||installationVault(false).fingerprint!==proof.vaultFingerprint||converted.selectedRevisions!==proof.selectedRevisions)throw new Error('Cópia não confirmou identidade/origem/evidência/plano.')
      if(converted.autoDecisionId!==request.autoDecisionId||converted.autoAppliedMounts!==(prepared.autoDecisionRequest?.mountKeys.length??0))throw new Error('Derivada não confirmou adoção AUTO selecionada.')
      const {version,mediaApplicationId,mediaReviewId,candidate,autoDecisionId,autoAppliedMounts,...details}=converted
      if(JSON.stringify(converted.audio)!==JSON.stringify(receipt.result.audio)||Boolean(converted.audio)!==(converted.audioEvidenceApplied===true))throw new Error('Derivada não confirmou aplicação dos recibos de áudio.')
      if(JSON.stringify(converted.graphics)!==JSON.stringify(receipt.result.graphics)||Boolean(converted.graphics)!==(converted.graphicRenderEvidenceApplied===true))throw new Error('Derivada não confirmou aplicação dos recibos gráficos.')
      const result=resultSchema.parse({...details,sourceDatabaseHash:proof.databaseHash,databaseHash:final.hash,databaseBytes:final.info.size})
      confirm();this.write({...initial,phase:'STAGED',result,updatedAt:new Date().toISOString()})
    }catch{this.fail(request)}
    return this.query(request.mediaApplicationId,request.channelId)
  }
}
