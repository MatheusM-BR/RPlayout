import {randomUUID} from 'node:crypto'
import {eq} from 'drizzle-orm'
import {z} from 'zod'
import type {Db} from '../db/client.js'
import {healthEvents,liveSources,operatorDecisions} from '../db/schema.js'
import {installationVault} from './secret-vault.js'
import {CollaborativeEditError} from './collaborative-edit.js'
import type {LiveProgramBinding} from './live-program-binding.js'
import {matchesNativeLiveReplacement,nativeLiveReplacementReceiptSchema,nativeReplacementTerminal,
 type NativeLiveReplacementRequest,type NativeLiveReplacementReceipt,type NativeLiveReplacementOperation} from './native-live-replacement.js'

const kind='NATIVE_LIVE_REPLACEMENT_V1'
const id=z.string().min(1).max(256)
const contextSchema=z.object({channelId:id,rundownId:id,revisionId:id,executionId:id,occurrenceId:id,
 ownerRunId:z.string().uuid(),engineGeneration:z.string().uuid(),itemId:id,
 decoderId:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),sourceId:id,
 sourceConnectionSignature:z.string().regex(/^[A-Za-z0-9_-]{43}$/),
 policySignature:z.string().regex(/^[a-f0-9]{64}$/),
}).strict()
export type NativeLiveReplacementContext=z.infer<typeof contextSchema>
interface Payload {
 version:1;digest:string;actorId:string|null;context:NativeLiveReplacementContext;
 targetSourceId:string;selectionRevision:string;transactionId:string;
 prepareSent:boolean;commitSent:boolean;cancelSent:boolean;closed:boolean;
 receipt:NativeLiveReplacementReceipt|null
 stopResolution?:{engineGeneration:string;nativeRequestId:number;previousOwnedGenerationExited:boolean;recordedAt:string}
 /** Closed before any byte reached the engine (prepareSent was durably false). */
 abandonedBeforeSend?:{reason:string;recordedAt:string}
}
const payloadSchema=z.object({version:z.literal(1),digest:z.string().regex(/^[A-Za-z0-9_-]{43}$/),actorId:id.nullable(),context:contextSchema,
 targetSourceId:id,selectionRevision:z.string().regex(/^[A-Za-z0-9_-]{43}$/),transactionId:z.string().regex(/^[A-Za-z0-9_-]{43}$/),
 prepareSent:z.boolean(),commitSent:z.boolean(),cancelSent:z.boolean(),closed:z.boolean(),receipt:nativeLiveReplacementReceiptSchema.nullable(),
 stopResolution:z.object({engineGeneration:z.string().uuid(),nativeRequestId:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),previousOwnedGenerationExited:z.boolean(),recordedAt:z.string().datetime()}).strict().optional(),
 abandonedBeforeSend:z.object({reason:z.string().min(1).max(500),recordedAt:z.string().datetime()}).strict().optional(),
}).strict().superRefine((value,ctx)=>{
 if(value.commitSent&&!value.prepareSent||value.receipt&&!value.prepareSent
  ||value.receipt?.phase==='COMMITTED'&&!value.commitSent||value.receipt?.phase==='CANCELLED'&&!value.cancelSent
  ||value.abandonedBeforeSend&&(value.prepareSent||value.receipt||value.stopResolution)
  ||value.closed!==Boolean(value.abandonedBeforeSend||value.stopResolution||value.receipt&&nativeReplacementTerminal(value.receipt.phase)&&value.receipt.phase!=='UNCERTAIN'))ctx.addIssue({code:'custom',message:'Journal nativo com transições inconsistentes.'})
})
interface Authority {
 authorize:(channelId:string)=>void
 /** Actual current published occurrence/decoder and still-owned lease. */
 current:()=>NativeLiveReplacementContext
 /** Used for recording engine facts, even if the initiating session expired. */
 assertOwner:(ownerRunId:string)=>void
}
const reject=(status:number,error:string):never=>{throw new CollaborativeEditError(status,{error})}
export function nativeSourceConnectionSignature(sourceId:string,kind:string,source:string):string{
 return installationVault().reviewIdentity(JSON.stringify({sourceId,kind,source}),'native-live-replacement-connection:v1')
}
/** Internal recovery evidence, not an actor's command authorization. */
export function assertPersistedLiveReplacementReceipt(db:Db,binding:LiveProgramBinding):void{
 const row=db.select().from(operatorDecisions).where(eq(operatorDecisions.id,'native-live-replacement:'+binding.receipt.transactionId)).get()
 const parsed=row?.kind===kind?payloadSchema.safeParse(row.payload):null
 const expected=parsed?.success?{transactionId:parsed.data.transactionId,engineGeneration:parsed.data.context.engineGeneration,
  selectionRevision:parsed.data.selectionRevision,itemId:parsed.data.context.itemId,expectedDecoderId:parsed.data.context.decoderId,
  expectedSourceId:parsed.data.context.sourceId,targetSourceId:parsed.data.targetSourceId}:null
 if(!parsed?.success||!parsed.data.closed||parsed.data.stopResolution||parsed.data.receipt?.phase!=='COMMITTED'
  ||row?.rundownId!=='@native-live-replacement:'+parsed.data.context.channelId||!expected||!matchesNativeLiveReplacement(binding.receipt,expected)
  ||JSON.stringify(parsed.data.receipt)!==JSON.stringify(nativeLiveReplacementReceiptSchema.parse(binding.receipt))
  ||(['channelId','rundownId','revisionId','executionId','occurrenceId','itemId'] as const).some(key=>parsed.data.context[key]!==binding.context[key]))throw new Error('Checkpoint da fonte alternativa sem recibo durável correspondente; não selecionar a fonte original por fallback.')
}

/** Journals of this channel without a terminal receipt or STOP resolution.
 * Identity only: never an authorization to send a command for them. */
export function unresolvedNativeReplacementJournals(db:Db,channelId:string):Array<{transactionId:string;ownerRunId:string;engineGeneration:string;prepareSent:boolean}>{
 return db.select().from(operatorDecisions).where(eq(operatorDecisions.rundownId,'@native-live-replacement:'+channelId)).all()
  .filter(row=>row.kind===kind).map(row=>payloadSchema.safeParse(row.payload))
  .map(parsed=>{if(!parsed.success)throw new Error('Journal de troca nativa ilegível; não resolver automaticamente.');return parsed.data})
  .filter(payload=>!payload.closed&&payload.context.channelId===channelId)
  .map(payload=>({transactionId:payload.transactionId,ownerRunId:payload.context.ownerRunId,engineGeneration:payload.context.engineGeneration,prepareSent:payload.prepareSent}))
}

/** All command intents are durable before stdin. Payload's existing encrypted
 * JSON codec protects metadata; private URIs are not stored even in that JSON.
 * No native command, manager toggle, or network IO is performed in a SQL tx. */
export class NativeLiveReplacementLedger {
 constructor(private readonly db:Db,private readonly actorId:string|null,private readonly actorName:string|null,private readonly authority:Authority){}
 assertConnection(db:Db):void{if(this.db.$client!==db.$client)throw new Error('Checkpoint e journal exigem a mesma conexão SQLite.')}
 private vault(){return installationVault()}
 private decisionId(key:string){return 'native-live-replacement:'+this.vault().reviewIdentity(key,'native-live-replacement-key:v1')}
 private scope(channelId:string){return '@native-live-replacement:'+channelId}
 private stored(tx:Db|Parameters<Parameters<Db['transaction']>[0]>[0],transactionId:string){
  const row=tx.select().from(operatorDecisions).where(eq(operatorDecisions.id,'native-live-replacement:'+transactionId)).get()
  if(!row||row.kind!==kind)reject(404,'Transação de troca nativa não encontrada.')
  const parsed=payloadSchema.safeParse(row!.payload)
  if(!parsed.success)reject(409,'Journal de troca nativa inválido; não enviar comando.')
  const payload=parsed.data!
  if(payload.transactionId!==transactionId||row!.rundownId!==this.scope(payload.context.channelId))reject(409,'Journal de troca nativa inválido; não enviar comando.')
  if(payload.receipt){const receipt=nativeLiveReplacementReceiptSchema.parse(payload.receipt);if(!matchesNativeLiveReplacement(receipt,this.binding(payload)))reject(409,'Recibo persistido pertence a outro contexto.')}
  return {row:row!,payload}
 }
 private binding(payload:Payload){return {transactionId:payload.transactionId,engineGeneration:payload.context.engineGeneration,
  selectionRevision:payload.selectionRevision,itemId:payload.context.itemId,expectedDecoderId:payload.context.decoderId,
  expectedSourceId:payload.context.sourceId,targetSourceId:payload.targetSourceId}}
 private pair(tx:Db|Parameters<Parameters<Db['transaction']>[0]>[0],context:NativeLiveReplacementContext,targetSourceId:string){
  const source=tx.select().from(liveSources).where(eq(liveSources.id,context.sourceId)).get()
  const target=tx.select().from(liveSources).where(eq(liveSources.id,targetSourceId)).get()
  if(!source||!target||source.id===target.id||!source.enabled||!target.enabled||source.channelId!==context.channelId||target.channelId!==context.channelId
   ||source.pairedSourceId!==target.id||target.pairedSourceId!==source.id||source.role===target.role
   ||!['PRIMARY','BACKUP'].includes(source.role)||!['PRIMARY','BACKUP'].includes(target.role))reject(409,'Troca exige par recíproco habilitado, papéis distintos e mesmo canal.')
  if(nativeSourceConnectionSignature(source!.id,source!.kind,source!.targetUrl)!==context.sourceConnectionSignature)reject(409,'Fonte cadastrada diverge da conexão realmente aberta no PGM.')
  const config=(value:NonNullable<typeof source>)=>({id:value.id,channelId:value.channelId,kind:value.kind,targetUrl:value.targetUrl,
   srtConfig:value.srtConfig,role:value.role,pairedSourceId:value.pairedSourceId,enabled:value.enabled})
  const selectionRevision=this.vault().reviewIdentity(JSON.stringify({source:config(source!),target:config(target!),policySignature:context.policySignature}),'native-live-replacement-selection:v1')
  return {target:target!,selectionRevision}
 }
 private sameContext(expected:NativeLiveReplacementContext){
  const actual=contextSchema.parse(this.authority.current())
  if(JSON.stringify(actual)!==JSON.stringify(expected))reject(409,'Ocorrência, revisão, fonte, política ou geração mudou; nenhum comando foi enviado.')
 }
 private audit(tx:Parameters<Parameters<Db['transaction']>[0]>[0],payload:Payload,state:string){
  tx.insert(healthEvents).values({id:randomUUID(),channelId:payload.context.channelId,component:'NATIVE_LIVE_REPLACEMENT',state,
   severity:state==='COMMITTED'?'INFO':'WARN',message:`Troca nativa ${payload.transactionId}: ${state}; confirmação não qualifica saída física.`,occurredAt:new Date().toISOString()}).run()
 }
 private update(tx:Parameters<Parameters<Db['transaction']>[0]>[0],rowId:string,payload:Payload){
  tx.update(operatorDecisions).set({payload:payload as unknown as Record<string,unknown>}).where(eq(operatorDecisions.id,rowId)).run()
 }

 begin(key:unknown,targetSourceId:string,expected:NativeLiveReplacementContext){
  if(key===undefined)reject(428,'Informe Idempotency-Key estável para a troca nativa.')
  if(typeof key!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(key))reject(400,'Idempotency-Key inválido.')
  const context=contextSchema.parse(expected),decisionId=this.decisionId(key as string),transactionId=decisionId.slice('native-live-replacement:'.length)
  const digest=this.vault().reviewIdentity(JSON.stringify({targetSourceId,context,actorId:this.actorId}),'native-live-replacement-request:v1')
  return this.db.transaction(tx=>{
   this.authority.authorize(context.channelId)
   const prior=tx.select().from(operatorDecisions).where(eq(operatorDecisions.id,decisionId)).get()
   if(prior){
    const saved=this.stored(tx,transactionId).payload
    if(saved.digest!==digest||saved.actorId!==this.actorId)reject(409,'Chave da troca pertence a outro pedido/operador.')
    // Historical replay does not authorize another PREPARE/COMMIT.
    return {transactionId,replayed:true,context:structuredClone(saved.context),receipt:saved.receipt,closed:saved.closed}
   }
   this.authority.assertOwner(context.ownerRunId);this.sameContext(context)
   const latest=this.db.$client.prepare('SELECT id FROM operator_decisions WHERE rundown_id=? AND kind=? ORDER BY rowid DESC LIMIT 1').get(this.scope(context.channelId),kind) as {id:string}|undefined
   if(latest){const previous=tx.select().from(operatorDecisions).where(eq(operatorDecisions.id,latest.id)).get();if(!previous||previous.payload.closed!==true)reject(409,'Existe troca nativa não reconciliada neste canal; consulte a mesma transação.')}
   const {selectionRevision}=this.pair(tx,context,targetSourceId)
   const payload:Payload={version:1,digest,actorId:this.actorId,context,targetSourceId,selectionRevision,transactionId,
    prepareSent:false,commitSent:false,cancelSent:false,closed:false,receipt:null}
   tx.insert(operatorDecisions).values({id:decisionId,rundownId:this.scope(context.channelId),kind,actorUsername:this.actorName,
    createdAt:new Date().toISOString(),payload:payload as unknown as Record<string,unknown>}).run()
   this.audit(tx,payload,'INTENT_RECORDED')
   return {transactionId,replayed:false,context:structuredClone(context),receipt:null,closed:false}
  },{behavior:'immediate'})
 }

 /** Executable source is resolved only after context/pair validation, returned
  * privately to the owning transport, never as the HTTP receipt. */
 request(transactionId:string):NativeLiveReplacementRequest{
  return this.db.transaction(tx=>{
   const {payload}=this.stored(tx,transactionId)
   this.authority.authorize(payload.context.channelId)
   if(payload.actorId!==this.actorId)reject(403,'Transação pertence a outro operador.')
   this.authority.assertOwner(payload.context.ownerRunId);this.sameContext(payload.context)
   const {target,selectionRevision}=this.pair(tx,payload.context,payload.targetSourceId)
   if(selectionRevision!==payload.selectionRevision)reject(409,'Configuração do par mudou após a decisão; não reutilizar preparação.')
   return {...this.binding(payload),targetSource:target.targetUrl,targetSourceType:target.kind}
  },{behavior:'immediate'})
 }

 beforeSend(operation:NativeLiveReplacementOperation,request:NativeLiveReplacementRequest):void{
  this.db.transaction(tx=>{
   const {row,payload}=this.stored(tx,request.transactionId)
   this.authority.authorize(payload.context.channelId)
   if(payload.actorId!==this.actorId||!matchesNativeLiveReplacement(request,this.binding(payload)))reject(409,'Pedido não corresponde à transação autorizada.')
   this.authority.assertOwner(payload.context.ownerRunId)
   if(operation==='STATUS')return // Lookup does not repeat or reauthorize an old cut.
   if(operation!=='CANCEL'){
    this.sameContext(payload.context)
    const {selectionRevision,target}=this.pair(tx,payload.context,payload.targetSourceId)
    if(selectionRevision!==payload.selectionRevision||target.targetUrl!==request.targetSource||target.kind!==request.targetSourceType)reject(409,'Par/credencial/configuração mudou antes do comando.')
   }
   if(payload.closed||payload.receipt?.phase==='UNCERTAIN')reject(409,'Transação encerrada ou inconclusiva; somente consultar, sem novo corte.')
   if(operation==='PREPARE'){
    if(payload.prepareSent)reject(409,'PREPARE já registrado; consulte a transação, não reabra.')
    payload.prepareSent=true
   }else if(operation==='COMMIT'){
    if(payload.commitSent||!payload.prepareSent||payload.receipt?.phase!=='READY'||!payload.receipt.preparedDecoderId)reject(409,'COMMIT exige preparo confirmado e não pode ser reenviado.')
    payload.commitSent=true
   }else payload.cancelSent=true
   this.update(tx,row.id,payload);this.audit(tx,payload,operation+'_SENT')
  },{behavior:'immediate'})
 }

 recordReceipt(value:NativeLiveReplacementReceipt):void{
  const receipt=nativeLiveReplacementReceiptSchema.parse(value)
  this.db.transaction(tx=>{
   const {row,payload}=this.stored(tx,receipt.transactionId)
   this.authority.assertOwner(payload.context.ownerRunId)
   if(!matchesNativeLiveReplacement(receipt,this.binding(payload))||!payload.prepareSent)reject(409,'Recibo nativo sem intenção preparada correspondente.')
   const previous=payload.receipt
   if(previous&&JSON.stringify(previous)===JSON.stringify(receipt))return
   if(previous?.preparedDecoderId&&receipt.preparedDecoderId!==previous.preparedDecoderId)reject(409,'Decoder mudou dentro da mesma transação.')
   if(previous&&nativeReplacementTerminal(previous.phase)){
    if(JSON.stringify(previous)!==JSON.stringify(receipt))reject(409,'Recibo terminal não pode ser reescrito.')
    return
   }
   if(receipt.phase==='COMMITTED'&&!payload.commitSent)reject(409,'Recibo de corte sem COMMIT durável anterior.')
   if(receipt.phase==='CANCELLED'&&!payload.cancelSent)reject(409,'Cancelamento sem comando durável anterior.')
   payload.receipt=structuredClone(receipt);payload.closed=Boolean(payload.stopResolution)||nativeReplacementTerminal(receipt.phase)&&receipt.phase!=='UNCERTAIN'
   this.update(tx,row.id,payload);this.audit(tx,payload,receipt.phase)
  },{behavior:'immediate'})
 }

 confirmStopped(transactionId:string,proof:{engineGeneration:string;nativeRequestId:number;previousOwnedGenerationExited:boolean},channelId:string):void{
  const valid=z.object({engineGeneration:z.string().uuid(),nativeRequestId:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),previousOwnedGenerationExited:z.boolean()}).strict().parse(proof)
  this.db.transaction(tx=>{
   const {row,payload}=this.stored(tx,transactionId);this.authority.assertOwner(payload.context.ownerRunId)
   if(payload.context.channelId!==channelId)reject(409,'STOP pertence a outro canal; cursor preservado.')
   if(valid.engineGeneration!==payload.context.engineGeneration&&!valid.previousOwnedGenerationExited)reject(409,'STOP não excluiu a geração anterior da troca.')
   if(payload.stopResolution)return
   payload.stopResolution={...valid,recordedAt:new Date().toISOString()};payload.closed=true
   this.update(tx,row.id,payload);this.audit(tx,payload,'STOP_CONFIRMED')
  },{behavior:'immediate'})
 }

 /** Durable close of an intent that never reached stdin. Refuses once PREPARE
  * was recorded: from then on only a native receipt or STOP may close it. */
 abandonUnsent(transactionId:string,reason:string):void{
  this.db.transaction(tx=>{
   const {row,payload}=this.stored(tx,transactionId);this.authority.assertOwner(payload.context.ownerRunId)
   if(payload.abandonedBeforeSend)return
   if(payload.prepareSent||payload.closed)reject(409,'PREPARE já registrado; consultar a transação, não abandonar.')
   payload.abandonedBeforeSend={reason:reason.slice(0,500)||'Recusada antes do envio.',recordedAt:new Date().toISOString()};payload.closed=true
   this.update(tx,row.id,payload);this.audit(tx,payload,'ABANDONED_BEFORE_SEND')
  },{behavior:'immediate'})
 }

 receipt(transactionId:string){
  return this.db.transaction(tx=>{
   const {payload}=this.stored(tx,transactionId);this.authority.authorize(payload.context.channelId)
   if(payload.actorId!==this.actorId)reject(403,'Transação pertence a outro operador.')
   return {transactionId,targetSourceId:payload.targetSourceId,selectionRevision:payload.selectionRevision,context:structuredClone(payload.context),receipt:payload.receipt?structuredClone(payload.receipt):null,
    prepareSent:payload.prepareSent,commitSent:payload.commitSent,cancelSent:payload.cancelSent,closed:payload.closed,stopResolution:payload.stopResolution??null,abandonedBeforeSend:payload.abandonedBeforeSend??null,
    nativeProgramConfirmed:payload.receipt?.phase==='COMMITTED',physicalOutputValidated:false as const,currentExecutionObserved:false as const}
  },{behavior:'immediate'})
 }
}
