import type Database from 'better-sqlite3'
import {randomUUID} from 'node:crypto'
import {hostname} from 'node:os'
import {z} from 'zod'
import {haRecoveryRequest,type HaRecovery} from './ha-recovery.js'
import type {HaLeaseClient} from './ha-witness.js'
import {installationVault} from './secret-vault.js'
import {EngineTransport,EngineCommandRejected} from './engine.js'
import {stageHaExecutionCopy,verifyStagedHaExecutionCopy,type HaExecutionCopy} from './ha-execution-copy.js'
import {HaExecutionAdmission} from './ha-execution-admission.js'
import type {HostDistributionFence} from './host-distribution-fence.js'
import type {App} from '../app.js'
import type {HaHeldDecoder,HaFencedDecoder} from './ha-held-decoder.js'
import {haMonitorIntent,haMonitorLedgerReport,monitorUnresolved,resolvedMonitorRequests,monitorReviewAncestors} from './ha-monitor-review.js'
import {haControlRequest,haControlReport,haControlReviewRequest} from './ha-control.js'
import {haStopRequest,haStopReport} from './ha-stop.js'
import {planHaReturn} from './ha-return-plan.js'
import {haExportRequest,haExportSeal,sealHaExecution,type HaExportBridge} from './ha-execution-export.js'
import {join,resolve} from 'node:path'
import type {HaReturnSource} from './ha-return-send.js'

const integer=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
export const haPromotionRequest=z.object({requestId:z.string().uuid(),preparation:haRecoveryRequest,
  fromNodeId:z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),targetNodeId:z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),expectedTerm:integer,expectedRevision:integer.positive()}).strict()
type Request=z.infer<typeof haPromotionRequest>
export const haMonitorRequest=haMonitorIntent
const monitorReport=haMonitorLedgerReport
const controlReviewRecord=z.object({version:z.literal(1),review:haControlReviewRequest,baseDigest:z.string(),actor:z.string().min(1).max(256),reviewedAt:z.string().datetime(),originalPhase:z.enum(['ACCEPTED','SENDING','UNCERTAIN']),result:haControlReport,proofOrigin:z.literal('OWNED_TRANSPORT_RECEIPT'),replayed:z.literal(false)}).strict()
const exportRecord=z.object({version:z.literal(1),request:haExportRequest,phase:z.enum(['ACCEPTED','COPYING','SEALED','FAILED']),actor:z.string().min(1).max(256),updatedAt:z.string().datetime(),partialEvidenceRetained:z.literal(true),publicationAuthorized:z.literal(false),result:z.object({seal:haExportSeal,manifestHash:z.string().regex(/^[a-f0-9]{64}$/i),databaseFile:z.string(),manifestFile:z.string()}).strict().optional()}).strict().superRefine((report,ctx)=>{if(report.phase==='SEALED'&&!report.result)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Exportação sem selo.'})})
type Candidate=Awaited<ReturnType<HaRecovery['activationCandidate']>>
const nativeConfirmation=z.object({channelId:z.string(),ownerId:z.string().uuid(),term:integer.positive(),decoderId:integer.positive().nullable(),revisionId:z.string().nullable(),itemId:z.string().nullable(),elapsed:integer,
  firstVideoConfirmed:z.boolean(),programTrim:z.object({in:integer,out:integer.positive(),contentHash:z.string().regex(/^[a-f0-9]{64}$/i)}).strict().optional()}).strict()
export interface HaPreparedNative {
  /** Return the owned, admitted native execution with outputs STILL HELD.
   * The orchestrator itself requests output release and obtains wire proof.
   * A prepared workspace stays immutable; this is a distinct local execution.
   * No simulator/HTTP proof/cached historical confirmation is acceptable. */
  activate(context:{assertAdmission:()=>Promise<void>;signal:AbortSignal}):Promise<{transport:EngineTransport;revisionId:string|null}>
  /** Resolve true only after all native processes/outputs owned by this handle
   * are confirmed stopped. Timeout, absence of an ACK or Node exit is not proof. */
  stop():Promise<{ownedNativeProcessesStopped:boolean}>
  browserMonitor?():{preview:string|null;monitor:string|null;port:number}|null
  mediaState?():'RUNNING'|'NOT_READY'|'STOPPED'|'FAILED'|'NOT_CONFIGURED'
}
export interface HaPromotionAdapter {
  prepare(candidate:Candidate,context:{signal:AbortSignal;assertCurrent:()=>Promise<void>;programOutputsDisabled:true;executionCopy:HaExecutionCopy;admission:HaExecutionAdmission;executionApp:App;preparedDecoder:HaHeldDecoder;createFencedDecoder:()=>Promise<HaFencedDecoder>}):Promise<HaPreparedNative>
}
const reportSchema=z.object({version:z.literal(1),request:haPromotionRequest,phase:z.enum(['CHECKING','PREPARING','TRANSFERRING','ACTIVATING','CONFIRMED','REFUSED','UNCERTAIN']),
  actor:z.string().min(1).max(256),createdAt:z.string().datetime(),updatedAt:z.string().datetime(),authorityTransferred:z.boolean(),nativeConfirmed:z.boolean(),executionCopyId:z.string().uuid().optional(),
  // Preserve previously recorded historical proof without a decoder field.
  // New activations still pass through mandatory nativeConfirmation above.
  nativeProof:nativeConfirmation.extend({decoderId:integer.positive().nullable().optional()}).optional(),ownedNativeProcessesStopped:z.boolean(),reason:z.string().max(256),automaticPromotion:z.literal(false),physicalOutputValidated:z.literal(false)}).strict()
export type HaPromotionReport=z.infer<typeof reportSchema>
type Row={request_id:string;channel_id:string;report:string;owner:string}

/** Durable promotion orchestration. The production native adapter is mandatory:
 * no simulator, no endpoint accepting a caller's "native ACK", no execution
 * reconstructed from this journal after restart. Lost response only queries. */
export class HaPromotions {
  private readonly owner=JSON.stringify({host:hostname(),pid:process.pid,boot:randomUUID()})
  private readonly pending=new Set<Promise<unknown>>()
  private readonly abort=new AbortController()
  private readonly handles=new Map<string,HaPreparedNative>()
  private readonly admissions=new Map<string,HaExecutionAdmission>()
  private readonly executionApps=new Map<string,App>()
  private readonly heldDecoders=new Map<string,HaHeldDecoder>()
  private readonly fencedDecoders=new Map<string,HaFencedDecoder>()
  private readonly activeMonitors=new Set<string>()
  private readonly activeControls=new Set<string>()
  private readonly activePromotions=new Set<string>()
  private readonly stoppedCopies=new Map<string,HaExecutionCopy>()
  private readonly appStops=new Map<string,Promise<void>>()
  private readonly stops=new Map<string,Promise<{ownedNativeProcessesStopped:boolean}>>()
  private closed=false
  constructor(private readonly db:Database.Database,private readonly context:string,private readonly nodeId:string,private readonly peerNodeId:string,
    private readonly witness:HaLeaseClient,private readonly candidate:(request:Request,authorize:()=>void)=>Promise<Candidate>,private readonly adapter:HaPromotionAdapter|null,
    private readonly executionRoot:string|null=null,private readonly hostFence:HostDistributionFence|null=null,private readonly exportBridge:HaExportBridge|null=null){
    db.exec('CREATE TABLE IF NOT EXISTS ha_promotion_requests(request_id TEXT PRIMARY KEY,channel_id TEXT NOT NULL,report TEXT NOT NULL,owner TEXT NOT NULL)')
    db.exec('CREATE TABLE IF NOT EXISTS ha_monitor_commands(request_id TEXT PRIMARY KEY,channel_id TEXT NOT NULL,report TEXT NOT NULL)')
    db.exec('CREATE TABLE IF NOT EXISTS ha_control_commands(request_id TEXT PRIMARY KEY,channel_id TEXT NOT NULL,report TEXT NOT NULL)')
    db.exec('CREATE TABLE IF NOT EXISTS ha_control_reviews(review_id TEXT PRIMARY KEY,request_id TEXT NOT NULL UNIQUE,channel_id TEXT NOT NULL,report TEXT NOT NULL)')
    db.exec('CREATE TABLE IF NOT EXISTS ha_execution_stops(request_id TEXT PRIMARY KEY,promotion_id TEXT NOT NULL UNIQUE,channel_id TEXT NOT NULL,report TEXT NOT NULL)')
    db.exec('CREATE TABLE IF NOT EXISTS ha_execution_exports(request_id TEXT PRIMARY KEY,promotion_id TEXT NOT NULL UNIQUE,channel_id TEXT NOT NULL,report TEXT NOT NULL)')
  }
  private key(id:string){return 'ha-promotion:v1:'+this.context+':'+id}
  private row(id:string){return this.db.prepare('SELECT * FROM ha_promotion_requests WHERE request_id=?').get(id) as Row|undefined}
  private read(row:Row){
    const result=reportSchema.parse(JSON.parse(installationVault(false).decrypt(row.report,this.key(row.request_id))))
    if(result.request.requestId!==row.request_id||result.request.preparation.channelId!==row.channel_id)throw new Error('Diário de promoção de outro pedido/canal.')
    if(result.phase==='CONFIRMED'&&(!result.nativeConfirmed||!result.authorityTransferred||!result.nativeProof))throw new Error('Promoção confirmada sem prova nativa registrada.')
    return result
  }
  query(value:unknown){const request=haPromotionRequest.parse(value),row=this.row(request.requestId);if(!row)throw new Error('Pedido de promoção não encontrado.');const result=this.read(row);if(JSON.stringify(result.request)!==JSON.stringify(request))throw new Error('UUID pertence a outra intenção de promoção.');return {...result,backendState:row.owner===this.owner&&!this.closed?'CURRENT_BACKEND' as const:'NOT_OWNED_HERE' as const,confirmationIsHistorical:true as const,nativeDecoderProofAvailable:typeof result.nativeProof?.decoderId==='number'||result.nativeProof?.itemId===null&&result.nativeProof?.decoderId===null}}
  observations(channelId:string){
    if(!channelId||channelId.length>128)throw new Error('Canal de observação inválido.')
    const rows=this.db.prepare('SELECT * FROM ha_promotion_requests WHERE channel_id=? ORDER BY rowid DESC LIMIT 20').all(channelId) as Row[]
    return rows.map(row=>{
      const report=this.read(row),owned=row.owner===this.owner&&!this.closed
      const transport=owned?this.fencedDecoders.get(row.request_id)?.transport:null
      const binding=transport?.fenceBinding(),health=transport?.health(),decoder=transport?.programDecoderBinding(),position=transport?.programPositionEvidence()
      const matches=!!binding&&!!report.nativeProof&&binding.ownerId===report.nativeProof.ownerId&&binding.term===report.nativeProof.term
      const browserMonitor=owned&&report.phase==='CONFIRMED'&&matches&&health?.ready&&!health.programAdmission.held?this.handles.get(row.request_id)?.browserMonitor?.()??null:null
      return {requestId:row.request_id,channelId,phase:report.phase,updatedAt:report.updatedAt,confirmationIsHistorical:true as const,nativeConfirmedHistorically:report.nativeConfirmed,
        localObservation:!owned?'NOT_OWNED_HERE' as const:!transport?'NO_TRACKED_ENGINE' as const:health?.ready&&binding?'RUNNING_LOCAL' as const:'NOT_READY_LOCAL' as const,
        matchesHistoricalGeneration:matches,programOutputsHeld:transport?health?.programAdmission.held??null:null,
        currentItemId:decoder?.itemId??null,currentDecoderId:decoder?.decoderId??null,currentFrames:position?.frames??null,
        controls:owned&&report.phase==='CONFIRMED'&&matches?this.fencedDecoders.get(row.request_id)?.controlState()??null:null,
        browserMonitor,mediaState:owned?this.handles.get(row.request_id)?.mediaState?.()??'NOT_CONFIGURED' as const:'NOT_OWNED_HERE' as const,authorityCheckedNow:false as const,physicalOutputValidated:false as const,observedAt:new Date().toISOString()}
    })
  }
  private readExport(requestId:string,channelId:string){
    const row=this.db.prepare('SELECT * FROM ha_execution_exports WHERE request_id=? AND channel_id=?').get(z.string().uuid().parse(requestId),z.string().min(1).max(128).parse(channelId)) as {request_id:string;promotion_id:string;channel_id:string;report:string}|undefined
    if(!row)throw new Error('Exportação não registrada neste canal.')
    const report=exportRecord.parse(JSON.parse(installationVault(false).decrypt(row.report,'ha-export:v1:'+this.context+':'+requestId)))
    if(report.request.requestId!==row.request_id||report.request.promotionId!==row.promotion_id||report.request.channelId!==row.channel_id)throw new Error('Exportação de outro pedido/execução/canal.')
    if(report.result&&(report.result.seal.exportId!==requestId||report.result.seal.promotionId!==report.request.promotionId||report.result.seal.channelId!==channelId||report.result.seal.stopRequestId!==report.request.stopRequestId))throw new Error('Selo diverge da intenção de exportação.')
    return report
  }
  exportQuery(requestId:string,channelId:string){
    const report=this.readExport(requestId,channelId)
    return {version:1 as const,request:report.request,phase:report.phase,updatedAt:report.updatedAt,partialEvidenceRetained:true as const,databaseHash:report.result?.seal.databaseHash??null,databaseBytes:report.result?.seal.databaseBytes??null,manifestHash:report.result?.manifestHash??null,reverseSyncConfirmed:false as const,primaryApproved:false as const,publicationAuthorized:false as const}
  }
  async returnSource(request:{requestId:string;exportId:string;promotionId:string;channelId:string},authorize:()=>void):Promise<HaReturnSource>{
    const exported=this.readExport(request.exportId,request.channelId),copy=this.stoppedCopies.get(request.promotionId)
    if(!copy||!this.executionRoot||exported.phase!=='SEALED'||!exported.result||exported.request.promotionId!==request.promotionId||resolve(exported.result.databaseFile)!==join(resolve(this.executionRoot),'.ha-execution.private-'+request.exportId,'returned.db'))throw new Error('Envio exige exportação fechada própria deste backend; arquivo não será adotado.')
    const current=async()=>{
      authorize();this.assertOwned(request.promotionId);this.hostFence!.assertOwned()
      const latest=this.readExport(request.exportId,request.channelId),stop=this.stopQuery(exported.request.stopRequestId,request.channelId)
      if(JSON.stringify(latest)!==JSON.stringify(exported)||stop.phase!=='CONFIRMED'||!stop.storageReleased||!stop.ownedResourcesStopped||stop.request.promotionId!==request.promotionId||this.stoppedCopies.get(request.promotionId)!==copy||this.admissions.has(copy.id)||this.executionApps.has(copy.id)||this.handles.has(copy.id)||this.fencedDecoders.has(copy.id)||this.heldDecoders.has(copy.id))throw new Error('Exportação/encerramento perdeu confirmação própria.')
    }
    await current();await this.hostFence!.freshProof();await current()
    return {seal:exported.result.seal,manifestHash:exported.result.manifestHash,databaseFile:exported.result.databaseFile,current}
  }
  async exportExecution(value:unknown,authorize:()=>void,actor:string){
    const request=haExportRequest.parse(value);authorize()
    if(this.db.prepare('SELECT 1 FROM ha_execution_exports WHERE request_id=?').get(request.requestId)){
      const saved=this.readExport(request.requestId,request.channelId)
      if(JSON.stringify(saved.request)!==JSON.stringify(request))throw new Error('UUID de exportação pertence a outra intenção.')
      return this.exportQuery(request.requestId,request.channelId)
    }
    const copy=this.stoppedCopies.get(request.promotionId)
    if(!copy||!this.executionRoot)throw new Error('Exportação exige cópia cuja parada foi confirmada neste backend; nenhum arquivo será adotado.')
    const current=async()=>{
      authorize();this.assertOwned(request.promotionId);this.hostFence!.assertOwned();this.abort.signal.throwIfAborted()
      const stop=this.stopQuery(request.stopRequestId,request.channelId)
      if(stop.request.promotionId!==copy.id||stop.phase!=='CONFIRMED'||!stop.storageReleased||!stop.ownedResourcesStopped||this.stoppedCopies.get(request.promotionId)!==copy||this.admissions.has(copy.id)||this.executionApps.has(copy.id)||this.fencedDecoders.has(copy.id)||this.heldDecoders.has(copy.id)||this.handles.has(copy.id))throw new Error('Cópia ainda sem confirmação de encerramento/liberação.')
    }
    await current();await this.hostFence!.freshProof();await current()
    let report:z.infer<typeof exportRecord>={version:1,request,phase:'ACCEPTED',actor:z.string().min(1).max(256).parse(actor),updatedAt:new Date().toISOString(),partialEvidenceRetained:true,publicationAuthorized:false}
    this.db.transaction(()=>{authorize();this.assertOwned(copy.id);this.db.prepare('INSERT INTO ha_execution_exports VALUES(?,?,?,?)').run(request.requestId,request.promotionId,request.channelId,installationVault(false).encrypt(JSON.stringify(report),'ha-export:v1:'+this.context+':'+request.requestId))}).immediate()
    const store=(phase:z.infer<typeof exportRecord>['phase'],result?:z.infer<typeof exportRecord>['result'])=>{
      report=exportRecord.parse({...report,phase,updatedAt:new Date().toISOString(),...(result?{result}:{})})
      if(this.db.prepare('UPDATE ha_execution_exports SET report=? WHERE request_id=?').run(installationVault(false).encrypt(JSON.stringify(report),'ha-export:v1:'+this.context+':'+request.requestId),request.requestId).changes!==1)throw new Error('Diário da exportação perdeu pedido.')
    }
    const work=(async()=>{
      try{await current();store('COPYING');const result=await sealHaExecution(copy,this.executionRoot!,request,current,this.abort.signal,this.exportBridge);await current();store('SEALED',result)}
      catch{store('FAILED')}
      return this.exportQuery(request.requestId,request.channelId)
    })()
    this.pending.add(work);void work.finally(()=>this.pending.delete(work)).catch(()=>{});return work
  }
  async returnReview(promotionId:string,channelId:string,authorize:()=>void){
    z.string().uuid().parse(promotionId);z.string().min(1).max(128).parse(channelId);authorize()
    const row=this.row(promotionId),promotion=row?this.read(row):null
    if(!row||!promotion||promotion.request.preparation.channelId!==channelId)throw new Error('Execução de outro canal.')
    const stopRow=this.db.prepare('SELECT request_id FROM ha_execution_stops WHERE promotion_id=? AND channel_id=?').get(promotionId,channelId) as {request_id:string}|undefined
    const stop=stopRow?this.stopQuery(stopRow.request_id,channelId):null
    const assignment=await this.witness.assignment(channelId);authorize()
    if(this.closed)throw new Error('Reserva encerrando; retorno não autorizado.')
    let unresolvedControls=0
    for(const control of this.db.prepare('SELECT request_id FROM ha_control_commands WHERE channel_id=?').iterate(channelId) as Iterable<{request_id:string}>){const report=this.controlQuery(control.request_id,channelId);if(report.request.promotionId===promotionId&&['ACCEPTED','SENDING','UNCERTAIN'].includes(report.phase))unresolvedControls++}
    // Re-read mutable journals after network I/O; this is never a transfer.
    const current=this.row(promotionId),fresh=current?this.read(current):null
    if(!fresh||JSON.stringify(fresh)!==JSON.stringify(promotion))throw new Error('Execução mudou durante conferência de retorno.')
    const freshStopRow=this.db.prepare('SELECT request_id FROM ha_execution_stops WHERE promotion_id=? AND channel_id=?').get(promotionId,channelId) as {request_id:string}|undefined
    if(freshStopRow?.request_id!==stopRow?.request_id)throw new Error('Parada registrada durante conferência de retorno.')
    const latest=freshStopRow?this.stopQuery(freshStopRow.request_id,channelId):null
    if(JSON.stringify(latest)!==JSON.stringify(stop))throw new Error('Parada mudou durante conferência de retorno.')
    const exportRow=this.db.prepare('SELECT request_id FROM ha_execution_exports WHERE promotion_id=? AND channel_id=?').get(promotionId,channelId) as {request_id:string}|undefined
    const exported=exportRow?this.readExport(exportRow.request_id,channelId):null
    const exportSeal=exported?.phase==='SEALED'?exported.result!.seal:null
    const canExport=!exported&&latest?.phase==='CONFIRMED'&&current!.owner===this.owner&&this.stoppedCopies.has(promotionId)&&!this.admissions.has(promotionId)&&!this.executionApps.has(promotionId)&&!this.handles.has(promotionId)&&!this.fencedDecoders.has(promotionId)&&!this.heldDecoders.has(promotionId)
    return {...planHaReturn({promotion:fresh,stop:latest,assignment,currentNodeId:this.nodeId,primaryNodeId:this.peerNodeId,localOwnerUnchanged:current!.owner===this.owner,unresolvedControls,exportSeal}),exportRequestId:exported?.request.requestId??null,canExport}
  }
  stopQuery(requestId:string,channelId:string){
    z.string().uuid().parse(requestId);z.string().min(1).max(128).parse(channelId)
    const row=this.db.prepare('SELECT * FROM ha_execution_stops WHERE request_id=? AND channel_id=?').get(requestId,channelId) as {request_id:string;promotion_id:string;channel_id:string;report:string}|undefined
    if(!row)throw new Error('Encerramento não registrado neste canal.')
    const report=haStopReport.parse(JSON.parse(installationVault(false).decrypt(row.report,'ha-stop:v1:'+this.context+':'+requestId)))
    if(report.request.requestId!==row.request_id||report.request.promotionId!==row.promotion_id||report.request.channelId!==row.channel_id)throw new Error('Diário de encerramento de outro pedido/execução/canal.')
    return report
  }
  stopReview(promotionId:string,channelId:string){
    z.string().uuid().parse(promotionId);z.string().min(1).max(128).parse(channelId)
    const row=this.row(promotionId),report=row?this.read(row):null
    if(!row||report?.request.preparation.channelId!==channelId)throw new Error('Promoção não registrada neste canal.')
    const prior=this.db.prepare('SELECT request_id FROM ha_execution_stops WHERE promotion_id=?').get(promotionId) as {request_id:string}|undefined
    const busy=this.activePromotions.has(promotionId)||[...this.activeControls].some(id=>!!this.db.prepare('SELECT 1 FROM ha_control_commands WHERE request_id=? AND channel_id=?').get(id,channelId))||[...this.activeMonitors].some(id=>!!this.db.prepare('SELECT 1 FROM ha_monitor_commands WHERE request_id=? AND channel_id=?').get(id,channelId))
    const canStop=!prior&&!busy&&!this.closed&&row.owner===this.owner&&['CONFIRMED','UNCERTAIN'].includes(report.phase)&&this.handles.has(promotionId)&&this.admissions.has(promotionId)
    const facts={promotionId,channelId,phase:report.phase,owner:row.owner,binding:this.fencedDecoders.get(promotionId)?.transport.fenceBinding()??null,nativeTracked:this.fencedDecoders.has(promotionId),heldTracked:this.heldDecoders.has(promotionId),appTracked:this.executionApps.has(promotionId)}
    return {promotionId,channelId,canStop,reviewToken:canStop?installationVault(false).reviewIdentity(JSON.stringify([this.context,facts]),'ha-stop-review:v1'):null,prior:prior?this.stopQuery(prior.request_id,channelId):null,willInterruptProgram:true as const,authorityReturnedToPrimary:false as const}
  }
  async stopExecution(value:unknown,authorize:()=>void,actor:string){
    const request=haStopRequest.parse(value);authorize()
    const existing=this.db.prepare('SELECT 1 FROM ha_execution_stops WHERE request_id=?').get(request.requestId)
    if(existing){const report=this.stopQuery(request.requestId,request.channelId);if(JSON.stringify(report.request)!==JSON.stringify(request))throw new Error('UUID do encerramento pertence a outra intenção.');return report}
    const review=this.stopReview(request.promotionId,request.channelId)
    if(!review.canStop||review.reviewToken!==request.reviewToken)throw new Error('Encerramento exige conferência atual e handle próprio; não adotar processos perdidos.')
    const handle=this.handles.get(request.promotionId)!,admission=this.admissions.get(request.promotionId)!
    this.assertOwned(request.promotionId);admission.assertHeld();await this.hostFence!.freshProof()
    authorize();this.assertOwned(request.promotionId);admission.assertHeld()
    let report:z.infer<typeof haStopReport>={version:1,request,phase:'ACCEPTED',actor:z.string().min(1).max(256).parse(actor),updatedAt:new Date().toISOString(),ownedResourcesStopped:false,storageReleased:false,originalControlOutcomesUnchanged:true,authorityReturnedToPrimary:false,automaticRestart:false,physicalOutputValidated:false}
    this.db.transaction(()=>{
      authorize();this.assertOwned(request.promotionId);const fresh=this.stopReview(request.promotionId,request.channelId)
      if(!fresh.canStop||fresh.reviewToken!==request.reviewToken)throw new Error('Execução/conferência mudou antes do encerramento.')
      this.db.prepare('INSERT INTO ha_execution_stops VALUES(?,?,?,?)').run(request.requestId,request.promotionId,request.channelId,installationVault(false).encrypt(JSON.stringify(report),'ha-stop:v1:'+this.context+':'+request.requestId))
    }).immediate()
    const store=(phase:z.infer<typeof haStopReport>['phase'])=>{
      report=haStopReport.parse({...report,phase,updatedAt:new Date().toISOString()})
      if(this.db.prepare('UPDATE ha_execution_stops SET report=? WHERE request_id=?').run(installationVault(false).encrypt(JSON.stringify(report),'ha-stop:v1:'+this.context+':'+request.requestId),request.requestId).changes!==1)throw new Error('Diário do encerramento perdeu pedido.')
      return report
    }
    const work=(async()=>{
      store('STOPPING');let stopped=false
      try{
        try{stopped=(await this.stopHandle(request.promotionId,handle)).ownedNativeProcessesStopped===true}catch{stopped=false}
        try{stopped=(await this.stopFencedDecoder(request.promotionId))&&stopped}catch{stopped=false}
        try{stopped=(await this.stopHeldDecoder(request.promotionId))&&stopped}catch{stopped=false}
        report={...report,ownedResourcesStopped:stopped}
        if(!stopped)return store('UNCERTAIN')
        await this.stopExecutionApp(request.promotionId)
        authorize();this.assertOwned(request.promotionId)
        if(!admission.releaseAfterStop(true))return store('UNCERTAIN')
        this.admissions.delete(request.promotionId);this.handles.delete(request.promotionId)
        report={...report,storageReleased:true};const confirmed=store('CONFIRMED');this.stoppedCopies.set(request.promotionId,{...admission.copy});return confirmed
      }catch{return store('UNCERTAIN')}
    })()
    this.pending.add(work);void work.finally(()=>this.pending.delete(work)).catch(()=>{});return work
  }
  private readControl(requestId:string,channelId:string){
    z.string().uuid().parse(requestId);z.string().min(1).max(128).parse(channelId)
    const row=this.db.prepare('SELECT report FROM ha_control_commands WHERE request_id=? AND channel_id=?').get(requestId,channelId) as {report:string}|undefined
    if(!row)throw new Error('Controle não registrado neste canal.')
    const report=haControlReport.parse(JSON.parse(installationVault(false).decrypt(row.report,'ha-control:v1:'+this.context+':'+requestId)))
    if(report.request.requestId!==requestId||report.request.channelId!==channelId)throw new Error('Controle de outro pedido/canal.')
    return report
  }
  private controlDigest(report:z.infer<typeof haControlReport>){return installationVault(false).reviewIdentity(JSON.stringify(report),'ha-control-base:v1:'+this.context)}
  controlQuery(requestId:string,channelId:string){
    const report=this.readControl(requestId,channelId)
    const row=this.db.prepare('SELECT * FROM ha_control_reviews WHERE request_id=? AND channel_id=?').get(requestId,channelId) as {review_id:string;request_id:string;channel_id:string;report:string}|undefined
    if(row){
      const review=controlReviewRecord.parse(JSON.parse(installationVault(false).decrypt(row.report,'ha-control-review:v1:'+this.context+':'+row.review_id)))
      if(review.review.reviewId!==row.review_id||review.review.requestId!==requestId||review.review.channelId!==channelId||review.baseDigest!==this.controlDigest(report)||JSON.stringify(review.result.request)!==JSON.stringify(report.request)||review.result.phase!=='CONFIRMED')throw new Error('Revisão de controle não corresponde ao diário original.')
      return {...review.result,reconciledFrom:review.originalPhase,canReconcile:false,reviewToken:null}
    }
    const receipt=this.fencedDecoders.get(report.request.promotionId)?.transport.admittedControlReceipt(requestId)
    const promotion=this.row(report.request.promotionId)
    const canReconcile=!this.closed&&promotion?.owner===this.owner&&!this.activeControls.has(requestId)&&['ACCEPTED','SENDING','UNCERTAIN'].includes(report.phase)&&!!receipt&&receipt.action===report.request.action&&receipt.revisionId===report.request.revisionId&&receipt.proof.itemId===report.request.itemId
    const reviewToken=canReconcile?installationVault(false).reviewIdentity(JSON.stringify([this.context,report,receipt]),'ha-control-review-token:v1'):null
    return {...report,canReconcile,reviewToken}
  }
  async reconcileControl(value:unknown,authorize:()=>void,actor:string){
    const request=haControlReviewRequest.parse(value);authorize()
    const before=this.controlQuery(request.requestId,request.channelId)
    if(before.phase==='CONFIRMED')return before // historical read, never resends
    if(!before.canReconcile||request.reviewToken!==before.reviewToken)throw new Error('Sem recibo nativo correlacionado atual; nenhum comando repetido.')
    const original=this.readControl(request.requestId,request.channelId),decoder=this.fencedDecoders.get(original.request.promotionId),admission=this.admissions.get(original.request.promotionId)
    if(!decoder||!admission)throw new Error('Revisão exige handle próprio rastreado.')
    this.assertOwned(original.request.promotionId);admission.assertHeld()
    const promotionRow=this.row(original.request.promotionId),promotion=promotionRow?this.read(promotionRow):null,binding=decoder.transport.fenceBinding()
    if(promotion?.phase!=='CONFIRMED'||!binding||promotion.nativeProof?.ownerId!==binding.ownerId||promotion.nativeProof.term!==binding.term)throw new Error('Geração não corresponde à promoção atual.')
    await this.hostFence!.freshProof();const authority=await this.witness.assignment(request.channelId)
    authorize();this.assertOwned(original.request.promotionId);admission.assertHeld()
    if(!authority.engineLeaseActive||authority.selectedNodeId!==this.nodeId||authority.lastEngineNodeId!==this.nodeId||authority.lastEngineOwnerId!==binding.ownerId||authority.lastTerm!==binding.term||authority.lastTransferId!==original.request.promotionId||authority.revision!==promotion.request.expectedRevision+1)throw new Error('Sem concessão atual para revisar controle.')
    return this.db.transaction(()=>{
      authorize();this.assertOwned(original.request.promotionId);admission.assertHeld()
      const current=this.controlQuery(request.requestId,request.channelId),receipt=decoder.transport.admittedControlReceipt(request.requestId)
      if(!current.canReconcile||current.reviewToken!==request.reviewToken||!receipt||receipt.proof.ownerId!==binding.ownerId||receipt.proof.term!==binding.term)throw new Error('Conferência/recibo mudou durante a revisão.')
      const result=haControlReport.parse({...original,phase:'CONFIRMED',proof:receipt.proof})
      const record=controlReviewRecord.parse({version:1,review:request,baseDigest:this.controlDigest(original),actor,reviewedAt:new Date().toISOString(),originalPhase:original.phase,result,proofOrigin:'OWNED_TRANSPORT_RECEIPT',replayed:false})
      this.db.prepare('INSERT INTO ha_control_reviews VALUES(?,?,?,?)').run(request.reviewId,request.requestId,request.channelId,installationVault(false).encrypt(JSON.stringify(record),'ha-control-review:v1:'+this.context+':'+request.reviewId))
      return this.controlQuery(request.requestId,request.channelId)
    }).immediate()
  }
  async control(value:unknown,authorize:()=>void,actor:string){
    const request=haControlRequest.parse(value);authorize()
    if(this.db.prepare('SELECT 1 FROM ha_control_commands WHERE request_id=?').get(request.requestId)){
      const report=this.controlQuery(request.requestId,request.channelId)
      if(JSON.stringify(report.request)!==JSON.stringify(request))throw new Error('UUID de controle pertence a outra intenção.')
      return report
    }
    const decoder=this.fencedDecoders.get(request.promotionId),admission=this.admissions.get(request.promotionId)
    if(!decoder||!admission)throw new Error('Controle exige execução promovida rastreada.')
    const current=async()=>{
      authorize();this.assertOwned(request.promotionId);admission.assertHeld()
      if(this.db.prepare('SELECT 1 FROM ha_execution_stops WHERE promotion_id=?').get(request.promotionId))throw new EngineCommandRejected('Execução em encerramento; nenhum novo controle será enviado.')
      const row=this.row(request.promotionId),promotion=row?this.read(row):null,binding=decoder.transport.fenceBinding(),selection=decoder.controlState()
      if(promotion?.phase!=='CONFIRMED'||promotion.request.preparation.channelId!==request.channelId||selection.revisionId!==request.revisionId||!selection.items.some(item=>item.id===request.itemId)||!binding||!promotion.nativeProof||binding.ownerId!==promotion.nativeProof.ownerId||binding.term!==promotion.nativeProof.term)throw new Error('Controle não pertence à promoção/edição/geração confirmada.')
      await this.hostFence!.freshProof();const authority=await this.witness.assignment(request.channelId)
      authorize();this.assertOwned(request.promotionId);admission.assertHeld()
      const after=decoder.transport.fenceBinding()
      if(this.fencedDecoders.get(request.promotionId)!==decoder||!after||after.ownerId!==binding.ownerId||after.term!==binding.term||!decoder.transport.health().ready||decoder.transport.health().programAdmission.held||!authority.engineLeaseActive||authority.lastEngineOwnerId!==binding.ownerId||authority.lastTerm!==binding.term||authority.lastEngineNodeId!==this.nodeId||authority.selectedNodeId!==this.nodeId||authority.lastTransferId!==request.promotionId||authority.revision!==promotion.request.expectedRevision+1)throw new Error('Controle sem admissão/concessão atuais.')
    }
    await current()
    let report:z.infer<typeof haControlReport>={version:1,request,phase:'ACCEPTED',actor:z.string().min(1).max(256).parse(actor),updatedAt:new Date().toISOString(),confirmationIsHistorical:true,physicalOutputValidated:false}
    const encode=()=>installationVault(false).encrypt(JSON.stringify(haControlReport.parse(report)),'ha-control:v1:'+this.context+':'+request.requestId)
    const store=(phase:z.infer<typeof haControlReport>['phase'],proof?:z.infer<typeof haControlReport>['proof'])=>{
      report={...report,phase,updatedAt:new Date().toISOString(),...(proof?{proof}:{})}
      if(this.db.prepare('UPDATE ha_control_commands SET report=? WHERE request_id=?').run(encode(),request.requestId).changes!==1)throw new Error('Diário do controle perdeu pedido.')
      return report
    }
    this.db.transaction(()=>{
      authorize();this.assertOwned(request.promotionId)
      for(const row of this.db.prepare('SELECT request_id FROM ha_control_commands WHERE channel_id=?').iterate(request.channelId) as Iterable<{request_id:string}>){if(['ACCEPTED','SENDING','UNCERTAIN'].includes(this.controlQuery(row.request_id,request.channelId).phase))throw new Error('Controle anterior pendente/incerto; consulta não autoriza repetição.')}
      this.db.prepare('INSERT INTO ha_control_commands VALUES(?,?,?)').run(request.requestId,request.channelId,encode())
    }).immediate()
    this.activeControls.add(request.requestId)
    const work=(async()=>{
      let sending=false
      try{await current();store('SENDING');sending=true;const proof=request.action==='CUE'?await decoder.cue(request.itemId,current,request.requestId):await decoder.takeCued(request.itemId,current,request.requestId);await current();return store('CONFIRMED',proof)}
      catch(error){return store(sending&&!(error instanceof EngineCommandRejected)?'UNCERTAIN':'REFUSED')}
    })()
    this.pending.add(work);void work.finally(()=>{this.pending.delete(work);this.activeControls.delete(request.requestId)}).catch(()=>{});await work;return this.controlQuery(request.requestId,request.channelId)
  }
  private monitorReports(channelId:string){
    return (this.db.prepare('SELECT request_id FROM ha_monitor_commands WHERE channel_id=? ORDER BY rowid').all(channelId) as {request_id:string}[]).map(row=>this.readMonitor(row.request_id,channelId))
  }
  private monitorReviewToken(report:z.infer<typeof monitorReport>,reports:z.infer<typeof monitorReport>[]){
    return installationVault(false).reviewIdentity(JSON.stringify([this.context,report,reports.filter(row=>row.request.bus===report.request.bus)]),'ha-monitor-review:v1')
  }
  private readMonitor(requestId:string,channelId:string){
    z.string().uuid().parse(requestId);z.string().min(1).max(128).parse(channelId)
    const row=this.db.prepare('SELECT * FROM ha_monitor_commands WHERE request_id=? AND channel_id=?').get(requestId,channelId) as {request_id:string;channel_id:string;report:string}|undefined
    if(!row)throw new Error('Pedido de monitor não registrado neste canal.')
    const report=monitorReport.parse(JSON.parse(installationVault(false).decrypt(row.report,'ha-monitor:v1:'+this.context+':'+requestId)))
    if(report.request.requestId!==requestId||report.request.channelId!==channelId)throw new Error('Diário do monitor de outro pedido/canal.')
    return report
  }
  monitorQuery(requestId:string,channelId:string){
    const report=this.readMonitor(requestId,channelId),reports=this.monitorReports(channelId),resolvedBy=resolvedMonitorRequests(reports).get(requestId)??null
    const promotion=this.row(report.request.promotionId)
    const canReconcile=monitorUnresolved(report.phase)&&!resolvedBy&&!this.closed&&promotion?.owner===this.owner&&this.fencedDecoders.has(report.request.promotionId)&&!this.activeMonitors.has(requestId)
    return {...report,resolvedBy,canReconcile,reviewToken:canReconcile?this.monitorReviewToken(report,reports):null,oldDeliveryConfirmed:false as const}
  }
  async monitor(value:unknown,authorize:()=>void,actor:string){
    const request=haMonitorRequest.parse(value);authorize()
    const key=(id:string)=>'ha-monitor:v1:'+this.context+':'+id
    const read=(row:{request_id:string;channel_id:string;report:string})=>{
      const result=monitorReport.parse(JSON.parse(installationVault(false).decrypt(row.report,key(row.request_id))))
      if(result.request.requestId!==row.request_id||result.request.channelId!==row.channel_id)throw new Error('Diário do monitor de outro pedido/canal.')
      return result
    }
    const existing=this.db.prepare('SELECT * FROM ha_monitor_commands WHERE request_id=?').get(request.requestId) as {request_id:string;channel_id:string;report:string}|undefined
    if(existing){const report=read(existing);if(JSON.stringify(report.request)!==JSON.stringify(request))throw new Error('UUID de monitor já pertence a outra seleção.');return this.monitorQuery(request.requestId,request.channelId)}
    const decoder=this.fencedDecoders.get(request.promotionId),admission=this.admissions.get(request.promotionId)
    if(!decoder||!admission)throw new Error('Monitor exige execução promovida rastreada neste backend.')
    const current=async()=>{
      authorize();this.assertOwned(request.promotionId);admission.assertHeld()
      if(this.db.prepare('SELECT 1 FROM ha_execution_stops WHERE promotion_id=?').get(request.promotionId))throw new EngineCommandRejected('Execução em encerramento; nenhum novo monitor será enviado.')
      const row=this.row(request.promotionId),report=row?this.read(row):null,binding=decoder.transport.fenceBinding()
      if(report?.phase!=='CONFIRMED'||report.request.preparation.channelId!==request.channelId||!report.nativeProof||!binding||binding.ownerId!==report.nativeProof.ownerId||binding.term!==report.nativeProof.term||decoder.transport.health().programAdmission.held||this.fencedDecoders.get(request.promotionId)!==decoder)throw new Error('Monitor não pertence à promoção/geração atual confirmada.')
      await this.hostFence!.freshProof();const authority=await this.witness.assignment(request.channelId);authorize();this.assertOwned(request.promotionId);admission.assertHeld()
      const after=decoder.transport.fenceBinding()
      if(this.fencedDecoders.get(request.promotionId)!==decoder||!decoder.transport.health().ready||decoder.transport.health().programAdmission.held||!after||after.ownerId!==binding.ownerId||after.term!==binding.term)throw new Error('Geração do monitor mudou durante a autorização.')
      if(!authority.engineLeaseActive||authority.lastEngineOwnerId!==binding.ownerId||authority.lastTerm!==binding.term||authority.lastEngineNodeId!==this.nodeId||authority.selectedNodeId!==this.nodeId||authority.lastTransferId!==request.promotionId||authority.revision!==report.request.expectedRevision+1)throw new Error('Monitor sem concessão/admissão atuais.')
    }
    await current()
    let report:z.infer<typeof monitorReport>={version:1,request,actor:z.string().min(1).max(256).parse(actor),phase:'ACCEPTED',updatedAt:new Date().toISOString(),confirmationIsHistorical:true,physicalOutputValidated:false}
    const store=(phase:z.infer<typeof monitorReport>['phase'])=>{
      report={...report,phase,updatedAt:new Date().toISOString()}
      if(this.db.prepare('UPDATE ha_monitor_commands SET report=? WHERE request_id=?').run(installationVault(false).encrypt(JSON.stringify(report),key(request.requestId)),request.requestId).changes!==1)throw new Error('Diário do monitor perdeu pedido.')
      return report
    }
    this.db.transaction(()=>{
      authorize();this.assertOwned(request.promotionId)
      const reports=this.monitorReports(request.channelId),resolved=resolvedMonitorRequests(reports)
      let ancestors=new Set<string>()
      if(request.supersedesRequestId){
        const parent=reports.find(row=>row.request.requestId===request.supersedesRequestId)
        if(!parent||parent.request.promotionId!==request.promotionId||parent.request.bus!==request.bus||!monitorUnresolved(parent.phase)||resolved.has(parent.request.requestId)||request.reviewToken!==this.monitorReviewToken(parent,reports))throw new Error('Conferência do pedido incerto mudou; consulte novamente.')
        ancestors=monitorReviewAncestors(reports,parent.request.requestId)
        if([...ancestors].some(id=>this.activeMonitors.has(id)))throw new Error('Comando anterior ainda em execução; aguarde antes de revisar.')
      }
      for(const saved of reports){if(saved.request.bus===request.bus&&monitorUnresolved(saved.phase)&&!resolved.has(saved.request.requestId)&&!ancestors.has(saved.request.requestId))throw new Error('Monitor com comando pendente/incerto; consulte pedido anterior.')}
      this.db.prepare('INSERT INTO ha_monitor_commands VALUES(?,?,?)').run(request.requestId,request.channelId,installationVault(false).encrypt(JSON.stringify(report),key(request.requestId)))
    }).immediate()
    this.activeMonitors.add(request.requestId)
    const work=(async()=>{
      let sending=false
      try{await current();store('SENDING');sending=true;await decoder.transport.setMonitorConfirmed(request.bus,request.on,current);await current();return store('CONFIRMED')}
      catch(error){return store(sending&&!(error instanceof EngineCommandRejected)?'UNCERTAIN':'REFUSED')}
    })()
    this.pending.add(work);void work.finally(()=>{this.pending.delete(work);this.activeMonitors.delete(request.requestId)}).catch(()=>{});await work;return this.monitorQuery(request.requestId,request.channelId)
  }
  private stopHandle(id:string,handle:HaPreparedNative){
    let work=this.stops.get(id)
    if(!work){work=Promise.resolve().then(()=>handle.stop());this.stops.set(id,work)}
    return work
  }
  private stopExecutionApp(id:string):Promise<void>{
    let work=this.appStops.get(id)
    if(!work){work=Promise.resolve().then(async()=>{await this.executionApps.get(id)?.close();this.executionApps.delete(id)});this.appStops.set(id,work)}
    return work
  }
  private async stopHeldDecoder(id:string){
    const decoder=this.heldDecoders.get(id)
    if(!decoder)return true
    const result=await decoder.stop()
    if(result.ownedNativeProcessesStopped)this.heldDecoders.delete(id)
    return result.ownedNativeProcessesStopped
  }
  private async stopFencedDecoder(id:string){
    const decoder=this.fencedDecoders.get(id)
    if(!decoder)return true
    const result=await decoder.stop()
    if(result.ownedNativeProcessesStopped)this.fencedDecoders.delete(id)
    return result.ownedNativeProcessesStopped
  }
  private assertOwned(id:string){
    if(this.closed||this.abort.signal.aborted||this.row(id)?.owner!==this.owner)throw new Error('Promoção sem posse local atual.')
  }
  private store(report:HaPromotionReport){
    const value=reportSchema.parse({...report,updatedAt:new Date().toISOString()})
    const changed=this.db.prepare('UPDATE ha_promotion_requests SET report=? WHERE request_id=? AND owner=?').run(installationVault(false).encrypt(JSON.stringify(value),this.key(value.request.requestId)),value.request.requestId,this.owner)
    if(changed.changes!==1)throw new Error('Diário de promoção perdeu posse; resultado permanece incerto.')
    return value
  }
  async promote(value:unknown,authorize:()=>void,actor:string):Promise<HaPromotionReport>{
    const request=haPromotionRequest.parse(value);authorize()
    const existing=this.row(request.requestId)
    if(existing)return this.query(request)
    if(this.closed||!this.adapter||!this.executionRoot||!this.hostFence||!this.witness.transferControlConfigured)throw new Error('Promoção nativa ainda sem adaptador/pasta/posse local/controle admitidos; nenhuma transferência executada.')
    if(!request.preparation.bindingPlanId||request.targetNodeId!==this.nodeId||request.fromNodeId!==this.peerNodeId)throw new Error('Promoção exige preparação local e os dois nós exatos do pareamento.')
    const now=new Date().toISOString(),initial:HaPromotionReport={version:1,request,actor:z.string().min(1).max(256).parse(actor),phase:'CHECKING',createdAt:now,updatedAt:now,authorityTransferred:false,nativeConfirmed:false,ownedNativeProcessesStopped:true,reason:'Preparação de promoção registrada; não é confirmação de PGM.',automaticPromotion:false,physicalOutputValidated:false}
    this.db.transaction(()=>{
      authorize()
      if(this.row(request.requestId))throw new Error('Pedido registrado concorrentemente; consulte o mesmo UUID.')
      for(const row of this.db.prepare('SELECT * FROM ha_promotion_requests WHERE channel_id=?').iterate(request.preparation.channelId) as Iterable<Row>)if(this.read(row).phase!=='REFUSED')throw new Error('Canal tem promoção ativa/interrompida; reconciliação explícita obrigatória.')
      this.db.prepare('INSERT INTO ha_promotion_requests VALUES(?,?,?,?)').run(request.requestId,request.preparation.channelId,installationVault(false).encrypt(JSON.stringify(initial),this.key(request.requestId)),this.owner)
    }).immediate()
    this.activePromotions.add(request.requestId)
    const work=this.run(initial,authorize);this.pending.add(work);void work.finally(()=>{this.pending.delete(work);this.activePromotions.delete(request.requestId)}).catch(()=>{});return work
  }
  private async run(initial:HaPromotionReport,authorize:()=>void){
    let report=initial,handle:HaPreparedNative|null=null,admission:HaExecutionAdmission|null=null,nativePreparationStarted=false,transferSent=false
    const request=initial.request,id=request.requestId,channelId=request.preparation.channelId
    const current=()=>{authorize();this.assertOwned(id)}
    try{
      current();const candidate=await this.candidate(request,authorize);current();await candidate.verifyCurrent();current()
      const baseline=await this.witness.assignment(channelId);current()
      if(baseline.selectedNodeId!==request.fromNodeId||baseline.revision!==request.expectedRevision||baseline.lastTerm!==request.expectedTerm)throw new Error('Autoridade mudou antes da preparação.')
      report=this.store({...report,phase:'PREPARING',executionCopyId:id,reason:'Cópia local nova registrada antes da preparação nativa.'})
      const executionCopy=await stageHaExecutionCopy(candidate,this.executionRoot!,id,async()=>{current()},this.abort.signal)
      await verifyStagedHaExecutionCopy(executionCopy,candidate,this.executionRoot!,async()=>{current()},this.abort.signal)
      admission=await HaExecutionAdmission.acquire(executionCopy,candidate,this.executionRoot!,this.hostFence!,async()=>{current()},this.abort.signal)
      this.admissions.set(id,admission)
      current();report=this.store({...report,ownedNativeProcessesStopped:false,reason:'Preparação nativa em cópia local, sem saídas de programa.'})
      admission.markNativePreparation()
      nativePreparationStarted=true
      const {createStagedHaApp}=await import('./staged-ha-app.js')
      const executionApp=await createStagedHaApp(admission);this.executionApps.set(id,executionApp)
      current();admission.assertHeld()
      const {createHaHeldDecoder}=await import('./ha-held-decoder.js')
      const preparedDecoder=await createHaHeldDecoder(candidate,executionApp,admission,async()=>{current()},this.abort.signal)
      this.heldDecoders.set(id,preparedDecoder);await preparedDecoder.prepare()
      current();admission.assertHeld()
      let activationAdmission:(()=>Promise<void>)|null=null,leaseAdmission:(()=>Promise<void>)|null=null,fencedCreation:Promise<HaFencedDecoder>|null=null
      const createFencedDecoder=async()=>{
        if(!activationAdmission)throw new Error('Geração cercada só pode abrir após transferência e admissão atuais.')
        await activationAdmission()
        return fencedCreation??=(async()=>{
          if(!await this.stopHeldDecoder(id))throw new Error('Decoder de warmup não confirmou parada; não abrir segunda geração.')
          await activationAdmission!()
          const {createHaFencedDecoder}=await import('./ha-held-decoder.js')
          const decoder=await createHaFencedDecoder(candidate,executionApp,admission!,this.witness,async()=>{await activationAdmission!()},this.abort.signal,async()=>{if(!leaseAdmission)throw new Error('Renovação sem admissão após transferência.');await leaseAdmission()})
          this.fencedDecoders.set(id,decoder)
          return decoder
        })()
      }
      handle=await this.adapter!.prepare(candidate,{signal:this.abort.signal,programOutputsDisabled:true,executionCopy,admission,executionApp,preparedDecoder,createFencedDecoder,assertCurrent:async()=>{current();admission!.assertHeld();await candidate.verifyCurrent();current()}});this.handles.set(id,handle)
      current();await candidate.verifyCurrent();current()
      const fresh=await this.witness.assignment(channelId);current()
      if(fresh.selectedNodeId!==request.fromNodeId||fresh.revision!==request.expectedRevision||fresh.lastTerm!==request.expectedTerm)throw new Error('Autoridade mudou antes da transferência.')
      report=this.store({...report,phase:'TRANSFERRING',reason:'Transferência explícita enviada; resposta perdida deve ser consultada por este UUID.'});transferSent=true
      const receipt=await this.witness.transfer({requestId:id,channelId,fromNodeId:request.fromNodeId,targetNodeId:request.targetNodeId,expectedTerm:request.expectedTerm,expectedRevision:request.expectedRevision})
      if(receipt.phase==='REFUSED'){transferSent=false;throw new Error('Transferência recusada pela testemunha.')}
      current();report=this.store({...report,phase:'ACTIVATING',authorityTransferred:true,reason:'Autoridade transferida; PGM ainda não confirmado.'})
      const assertAdmission=async()=>{
        current();admission!.assertHeld();await this.hostFence!.freshProof();await candidate.verifyCurrent();current();admission!.assertHeld()
        const state=await this.witness.assignment(channelId);current()
        if(state.selectedNodeId!==this.nodeId||state.revision!==request.expectedRevision+1||state.lastTransferId!==id)throw new Error('Admissão atual não corresponde à promoção; recibo histórico não autoriza saída.')
      }
      activationAdmission=assertAdmission
      // Lease liveness must not depend on hashing every media asset/runtime
      // and prepared DB on every nonce. Full candidate proof remains required
      // before LOAD/TAKE/graphics/accounting/output admission. The signed fresh
      // assignment + own live host/storage/execution still gate every renewal.
      leaseAdmission=async()=>{
        current();admission!.assertHeld()
        const state=await this.witness.assignment(channelId);current();admission!.assertHeld()
        if(state.selectedNodeId!==this.nodeId||state.revision!==request.expectedRevision+1||state.lastTransferId!==id)throw new Error('Renovação não pertence à transferência/admissão atual.')
      }
      await assertAdmission()
      const saved=candidate.candidate.nativeCursor
      const activation=await handle.activate({assertAdmission,signal:this.abort.signal});await assertAdmission()
      const transport=activation.transport,revisionId=activation.revisionId
      const expectedRevision=saved?.revisionId??candidate.candidate.localExecutionRevisionId??null
      if(revisionId!==expectedRevision)throw new Error('Execução admitida pertence a outra edição, inclusive em cursor parado.')
      if(!(transport instanceof EngineTransport))throw new Error('Promoção exige transporte nativo próprio, não confirmação fornecida pelo adaptador.')
      const binding=transport.fenceBinding(),health=transport.health()
      if(!binding||binding.term<=request.expectedTerm||!health.ready||!health.programAdmission.supported||!health.programAdmission.held)throw new Error('Engine de promoção não confirmou preparo retido sob concessão atual.')
      const assertNativeAdmission=async()=>{
        await assertAdmission()
        const now=transport.fenceBinding(),state=transport.state()
        if(!now||now.ownerId!==binding.ownerId||now.term!==binding.term||state.mode!=='NATIVE'||state.channelId!==channelId)throw new Error('Transporte/dono/termo mudou antes da admissão.')
        if(saved?.playing){
          if(revisionId!==saved.revisionId||!state.playing||state.onAir?.itemId!==saved.itemId||state.onAir.elapsed<saved.elapsed||saved.programTrim&&JSON.stringify(state.programTrim)!==JSON.stringify(saved.programTrim))throw new Error('Execução admitida não preparou a edição/cursor/corte salvos.')
        }else if(state.playing||state.onAir)throw new Error('Execução admitida iniciou material não solicitado pelo cursor parado.')
        const authority=await this.witness.assignment(channelId);current()
        if(!authority.engineLeaseActive||authority.lastEngineOwnerId!==binding.ownerId||authority.lastEngineNodeId!==this.nodeId||authority.lastTerm!==binding.term||authority.lastTransferId!==id||authority.selectedNodeId!==this.nodeId||authority.revision!==request.expectedRevision+1)throw new Error('Engine ainda não tem concessão vigente sob esta transferência.')
      }
      await assertNativeAdmission()
      const native=nativeConfirmation.parse({...await transport.releaseProgramOutputs(assertNativeAdmission),revisionId});await assertNativeAdmission()
      if(native.channelId!==channelId||native.term<=request.expectedTerm)throw new Error('Confirmação nativa de outro canal/termo.')
      if(native.ownerId!==binding.ownerId||native.term!==binding.term||native.itemId!==null&&native.decoderId===null||native.itemId===null&&(native.decoderId!==null||native.firstVideoConfirmed||native.elapsed!==0||native.programTrim))throw new Error('Prova nativa não corresponde ao decoder/cursor admitido.')
      if(saved?.playing&&(native.revisionId!==saved.revisionId||native.itemId!==saved.itemId||native.elapsed<saved.elapsed||!native.firstVideoConfirmed||saved.programTrim&&JSON.stringify(native.programTrim)!==JSON.stringify(saved.programTrim)))throw new Error('PGM nativo não confirmou cursor/corte/primeiro quadro exatos.')
      if(saved?.programTrim&&native.elapsed>=saved.programTrim.out-saved.programTrim.in)throw new Error('Confirmação nativa já ultrapassou o corte salvo.')
      if(!saved?.playing&&native.itemId!==null)throw new Error('Engine iniciou item não solicitado por cursor parado.')
      const authority=await this.witness.assignment(channelId);current()
      if(!authority.engineLeaseActive||authority.lastEngineOwnerId!==native.ownerId||authority.lastEngineNodeId!==this.nodeId||authority.lastTerm!==native.term||authority.lastTransferId!==id||authority.selectedNodeId!==this.nodeId||authority.revision!==request.expectedRevision+1)throw new Error('Concessão/dono/termo/admissão mudaram durante a confirmação nativa.')
      const fencedDecoder=this.fencedDecoders.get(id)
      if(fencedDecoder){
        if(fencedDecoder.transport!==transport)throw new Error('Transporte ativado diverge da geração rastreada para manutenção gráfica.')
        await fencedDecoder.beginProgramAccounting(native);await assertNativeAdmission()
        await fencedDecoder.startGraphicMaintenance();await assertNativeAdmission()
        await fencedDecoder.releasePreview();await assertNativeAdmission()
      }
      report=this.store({...report,phase:'CONFIRMED',nativeConfirmed:true,nativeProof:native,reason:'Engine nativo confirmou retomada sob admissão atual; saída física não homologada.'})
      return report
    }catch{
      let stopped=!nativePreparationStarted
      if(handle)try{stopped=(await this.stopHandle(id,handle)).ownedNativeProcessesStopped===true}catch{stopped=false}
      try{stopped=(await this.stopFencedDecoder(id))&&stopped}catch{stopped=false}
      try{stopped=(await this.stopHeldDecoder(id))&&stopped}catch{stopped=false}
      try{await this.stopExecutionApp(id)}catch{stopped=false}
      if(admission)try{if(admission.releaseAfterStop(stopped))this.admissions.delete(id);else stopped=false}catch{stopped=false}
      if(stopped)this.handles.delete(id)
      // A prepare() rejection may have spawned a process before losing its
      // reply. Without its handle there is no invented cleanup confirmation.
      const uncertain=transferSent||report.authorityTransferred||!stopped
      return this.store({...report,phase:uncertain?'UNCERTAIN':'REFUSED',ownedNativeProcessesStopped:stopped,reason:uncertain?'Promoção incerta. Preserve UUID, diário, autoridade e processos; não repetir TAKE/transferência.':'Promoção recusada sem transferência/PGM; recursos próprios confirmados parados.'})
    }
  }
  close(){
    if(this.closed)return;this.closed=true;this.abort.abort()
    for(const [id,handle] of this.handles){
      const work=(async()=>{let stopped=false;try{stopped=(await this.stopHandle(id,handle)).ownedNativeProcessesStopped===true}catch{}
        try{stopped=(await this.stopFencedDecoder(id))&&stopped}catch{stopped=false}
        try{stopped=(await this.stopHeldDecoder(id))&&stopped}catch{stopped=false}
        try{await this.stopExecutionApp(id)}catch{stopped=false}
        const admission=this.admissions.get(id)
        if(admission)try{if(admission.releaseAfterStop(stopped))this.admissions.delete(id);else stopped=false}catch{stopped=false}
        const row=this.row(id);if(row?.owner===this.owner){const report=this.read(row);this.store({...report,phase:'UNCERTAIN',ownedNativeProcessesStopped:stopped,reason:'Backend encerrado após etapa nativa; autoridade e cursor exigem retomada/reconciliação explícitas.'})}
        if(stopped)this.handles.delete(id)
      })();this.pending.add(work);void work.finally(()=>this.pending.delete(work)).catch(()=>{})
    }
  }
  get running(){return this.pending.size>0}
  async settled(){await Promise.allSettled([...this.pending]);if(this.closed)this.hostFence?.close()}
}
