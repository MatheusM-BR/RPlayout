import type {Db} from '../db/client.js'
import type {Checkpoints,ChannelCheckpoint} from './checkpoints.js'
import {CollaborativeEditError} from './collaborative-edit.js'
import type {NativeReplacementAction,NativeReplacementPersistence,NativeReplacementStopProof} from './engine.js'
import {commitNativeReplacementReceipt,commitNativeReplacementStop} from './native-live-replacement-commit.js'
import {NativeLiveReplacementLedger,unresolvedNativeReplacementJournals,type NativeLiveReplacementContext} from './native-live-replacement-ledger.js'
import type {NativeLiveReplacementReceipt,NativeLiveReplacementRequest} from './native-live-replacement.js'

/** What the ChannelRuntime exposes to the factory. Every call reads CURRENT
 * state; nothing here is captured from the request that created a session. */
export interface NativeReplacementRuntimePort {
 readonly channelId:string
 readonly db:Db
 readonly checkpoints:Checkpoints
 readonly transport:{
  prepareNativeLiveReplacement:(request:NativeLiveReplacementRequest,persistence:NativeReplacementPersistence,action?:NativeReplacementAction)=>Promise<NativeLiveReplacementReceipt>
  nativeLiveReplacementCommand:(operation:'COMMIT'|'CANCEL'|'STATUS',transactionId:string,action?:NativeReplacementAction)=>Promise<NativeLiveReplacementReceipt>
 }
 /** Current published occurrence, PGM decoder and owned lease; throws otherwise. */
 context:()=>NativeLiveReplacementContext
 /** Current cursor for the atomic replacement checkpoint. */
 capture:()=>ChannelCheckpoint
 /** Current durable owner run id; throws when ownership changed. */
 ownerRunId:()=>string
 /** Proven-stopped local predecessor runs (process and engines gone). */
 stoppedPredecessorRunIds:()=>string[]
}
export interface NativeReplacementActor {id:string|null;name:string|null}
/** Re-evaluated at EVERY command: session, role, channel and actor identity. */
export type NativeReplacementAuthorization=(channelId:string)=>void

const refuse=(status:number,error:string):never=>{throw new CollaborativeEditError(status,{error})}

function ownerAuthority(port:NativeReplacementRuntimePort,authorize:NativeReplacementAuthorization){
 return {
  authorize:(channelId:string)=>{if(channelId!==port.channelId)refuse(403,'Troca pertence a outro canal.');authorize(channelId)},
  current:()=>port.context(),
  assertOwner:(ownerRunId:string)=>{if(port.ownerRunId()!==ownerRunId)refuse(409,'A posse do canal mudou; nenhum comando de troca será enviado.')},
 }
}

/** Durable, actor-independent persistence kept by the transport for receipts and
 * STOP facts. Its validate/beforeSend refuse: a command needs the current action. */
function durablePersistence(port:NativeReplacementRuntimePort,context:NativeLiveReplacementContext,request:NativeLiveReplacementRequest):NativeReplacementPersistence{
 // Engine facts must stay recordable after the initiating session expired:
 // only ownership is checked, never the HTTP session that started the cut.
 const ledger=new NativeLiveReplacementLedger(port.db,null,'@engine',{
  authorize:()=>refuse(403,'Fato nativo não autoriza comando.'),
  current:()=>port.context(),
  assertOwner:ownerRunId=>{if(port.ownerRunId()!==ownerRunId)refuse(409,'A posse do canal mudou; fato nativo não registrado.')},
 })
 const noCommand=()=>refuse(403,'Comando de troca sem autorização da ação atual; nada foi enviado.')
 return {
  validate:noCommand,beforeSend:noCommand,
  receipt:(receipt,currentProgramContext)=>commitNativeReplacementReceipt(port.db,port.checkpoints,ledger,context,request,receipt,currentProgramContext,port.capture),
  stopped:(proof:NativeReplacementStopProof)=>commitNativeReplacementStop(port.db,port.checkpoints,ledger,request.transactionId,port.channelId,proof),
 }
}

export interface NativeReplacementSession {
 prepare:(idempotencyKey:unknown,targetSourceId:string)=>Promise<ReturnType<NativeLiveReplacementLedger['receipt']>&{replayed:boolean}>
 commit:(transactionId:string)=>Promise<ReturnType<NativeLiveReplacementLedger['receipt']>>
 cancel:(transactionId:string)=>Promise<ReturnType<NativeLiveReplacementLedger['receipt']>>
 status:(transactionId:string)=>Promise<ReturnType<NativeLiveReplacementLedger['receipt']>>
 receipt:(transactionId:string)=>ReturnType<NativeLiveReplacementLedger['receipt']>
}

/** Authorized session factory: one per HTTP action. The per-command action
 * (fresh authorization + ledger intent) lives only inside that queue slot. */
export function createNativeReplacementSession(port:NativeReplacementRuntimePort,actor:NativeReplacementActor,authorize:NativeReplacementAuthorization):NativeReplacementSession{
 const authority=ownerAuthority(port,authorize)
 const ledger=new NativeLiveReplacementLedger(port.db,actor.id,actor.name,authority)
 const action:NativeReplacementAction={
  validate:()=>{authority.authorize(port.channelId);port.ownerRunId()},
  beforeSend:(operation,request)=>ledger.beforeSend(operation,request),
 }
 const view=(transactionId:string)=>ledger.receipt(transactionId)
 return {
  async prepare(idempotencyKey,targetSourceId){
   authority.authorize(port.channelId)
   const decision=ledger.begin(idempotencyKey,targetSourceId,port.context())
   // A replay answers from the journal; it never reopens or reprepares.
   if(decision.replayed)return {...view(decision.transactionId),replayed:true}
   try{
    const request=ledger.request(decision.transactionId)
    await port.transport.prepareNativeLiveReplacement(request,durablePersistence(port,decision.context,request),action)
   }catch(error){
    // Close only an intent whose PREPARE never became durable (no bytes sent).
    // After PREPARE the journal stays open for STATUS/CANCEL/STOP instead.
    try{ledger.abandonUnsent(decision.transactionId,error instanceof Error?error.message:String(error))}catch{/* journal keeps the block */}
    throw error
   }
   return {...view(decision.transactionId),replayed:false}
  },
  async commit(transactionId){authority.authorize(port.channelId);view(transactionId);await port.transport.nativeLiveReplacementCommand('COMMIT',transactionId,action);return view(transactionId)},
  async cancel(transactionId){authority.authorize(port.channelId);view(transactionId);await port.transport.nativeLiveReplacementCommand('CANCEL',transactionId,action);return view(transactionId)},
  async status(transactionId){authority.authorize(port.channelId);view(transactionId);await port.transport.nativeLiveReplacementCommand('STATUS',transactionId,action);return view(transactionId)},
  receipt:view,
 }
}

/** Inside the durable STOP section of THIS process, after the transport's own
 * sessions were resolved. Closes journals it can prove harmless and leaves every
 * other one blocking new cuts (never fails a confirmed STOP for a foreign row):
 * - current owner, no session here, PREPARE never durable -> abandoned unsent;
 * - previous run proven stopped (local host, server and engine PIDs gone) ->
 *   STOP resolution with previousOwnedGenerationExited.
 * Journal only: the cursor follows the normal STOP checkpoint path. */
export function resolveStoppedPredecessorJournals(port:NativeReplacementRuntimePort,proof:{engineGeneration:string|null;nativeRequestId:number},ownedSession:(transactionId:string)=>boolean):{resolved:string[];preserved:string[]}{
 const pending=unresolvedNativeReplacementJournals(port.db,port.channelId).filter(row=>!ownedSession(row.transactionId))
 if(!pending.length)return {resolved:[],preserved:[]}
 const current=port.ownerRunId(),stopped=new Set(port.stoppedPredecessorRunIds())
 const ledger=new NativeLiveReplacementLedger(port.db,null,'@runtime',{
  authorize:()=>refuse(403,'Resolução de STOP não autoriza comando.'),
  current:()=>port.context(),
  assertOwner:ownerRunId=>{if(port.ownerRunId()!==current||ownerRunId!==current&&!stopped.has(ownerRunId))refuse(409,'Dono do journal sem parada comprovada; journal preservado.')},
 })
 const resolved:string[]=[],preserved:string[]=[]
 port.db.transaction(()=>{
  for(const row of pending){
   if(row.ownerRunId===current&&!row.prepareSent){ledger.abandonUnsent(row.transactionId,'Intenção sem envio encerrada por STOP confirmado.');resolved.push(row.transactionId)}
   else if(row.ownerRunId!==current&&stopped.has(row.ownerRunId)&&proof.engineGeneration){
    ledger.confirmStopped(row.transactionId,{engineGeneration:proof.engineGeneration,nativeRequestId:proof.nativeRequestId,previousOwnedGenerationExited:true},port.channelId)
    resolved.push(row.transactionId)
   }else preserved.push(row.transactionId)
  }
 },{behavior:'immediate'})
 return {resolved,preserved}
}
