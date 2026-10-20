import {z} from 'zod'

const token=z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/)
const identity=z.string().min(1).max(256).refine(value=>!/[\u0000-\u001f\u007f]/.test(value))
const decoder=z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const nativeLiveReplacementBindingSchema=z.object({
 transactionId:token,engineGeneration:z.string().uuid(),selectionRevision:token,itemId:identity,
 expectedDecoderId:decoder,expectedSourceId:identity,targetSourceId:identity,
})
export const nativeLiveReplacementReceiptSchema=nativeLiveReplacementBindingSchema.extend({
 preparedDecoderId:decoder.nullable(),
 phase:z.enum(['PREPARING','READY','COMMITTED','CANCELLED','EXPIRED','INVALIDATED','FAILED','UNCERTAIN']),
 programFrames:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
}).strict().superRefine((value,ctx)=>{
 if(value.expectedSourceId===value.targetSourceId)ctx.addIssue({code:'custom',message:'Troca exige fonte alternativa.'})
 if(value.phase==='COMMITTED'&&(value.preparedDecoderId===null||value.programFrames===null))ctx.addIssue({code:'custom',message:'Confirmação sem decoder/cursor.'})
 if(value.phase!=='COMMITTED'&&value.programFrames!==null)ctx.addIssue({code:'custom',message:'Cursor não pode confirmar troca sem COMMITTED.'})
 if(value.phase==='READY'&&value.preparedDecoderId===null)ctx.addIssue({code:'custom',message:'Prontidão sem decoder.'})
 if(value.preparedDecoderId===value.expectedDecoderId)ctx.addIssue({code:'custom',message:'Alternativa precisa de uma nova geração de decoder.'})
})
const nativeLiveReplacementRequestSchema=nativeLiveReplacementBindingSchema.extend({
 targetSource:z.string().min(1).max(8192).refine(value=>!/[\u0000-\u001f\u007f]/.test(value)),
 targetSourceType:z.enum(['SRT','RTMP','RTSP','NDI','OMT','SDI']),
}).strict().superRefine((value,ctx)=>{
 const protocols={SRT:['srt://'],RTMP:['rtmp://','rtmps://'],RTSP:['rtsp://','rtsps://'],NDI:['ndi:'],OMT:['omt:'],SDI:['sdi:','decklink:']}
 if(value.expectedSourceId===value.targetSourceId||!protocols[value.targetSourceType].some(prefix=>value.targetSource.startsWith(prefix)))ctx.addIssue({code:'custom',message:'Seleção alternativa inválida.'})
})
export const parseNativeLiveReplacementRequest=(value:unknown)=>nativeLiveReplacementRequestSchema.parse(value)
export type NativeLiveReplacementReceipt=z.infer<typeof nativeLiveReplacementReceiptSchema>
export interface NativeLiveReplacementBinding {
 transactionId:string;engineGeneration:string;selectionRevision:string;itemId:string;
 expectedDecoderId:number;expectedSourceId:string;targetSourceId:string
}
export interface NativeLiveReplacementRequest extends NativeLiveReplacementBinding {targetSource:string;targetSourceType:'SRT'|'RTMP'|'RTSP'|'NDI'|'OMT'|'SDI'}
export function matchesNativeLiveReplacement(receipt:NativeLiveReplacementBinding,binding:NativeLiveReplacementBinding):boolean{
 return (['transactionId','engineGeneration','selectionRevision','itemId','expectedDecoderId','expectedSourceId','targetSourceId'] as const)
  .every(key=>receipt[key]===binding[key])
}
export const nativeReplacementTerminal=(phase:NativeLiveReplacementReceipt['phase'])=>!['PREPARING','READY'].includes(phase)
export function readNativeLiveReplacementCapability(value:{engineGeneration?:unknown;liveReplacementProtocol?:unknown;decoderIdentity?:unknown}){
 const generation=z.string().uuid().safeParse(value.engineGeneration)
 return value.liveReplacementProtocol===1&&value.decoderIdentity===true&&generation.success
  ?{supported:true,engineGeneration:generation.data}:{supported:false,engineGeneration:null}
}

export class NativeLiveReplacementUnknown extends Error {
 readonly outcomeUnknown=true
 constructor(){super('Resultado da troca nativa inconclusivo; consulte a mesma transação, sem reenviar COMMIT.');this.name='NativeLiveReplacementUnknown'}
}

export type NativeLiveReplacementOperation='PREPARE'|'COMMIT'|'CANCEL'|'STATUS'
export interface NativeLiveReplacementWirePort {
 nextId:()=>number
 assertOwned:()=>void
 /** Rechecks published occurrence, pair/configuration and native decoder.
  * STATUS is a historical lookup and must not require that item still on air. */
 validate:(operation:NativeLiveReplacementOperation,request:NativeLiveReplacementRequest)=>void
 write:(message:Record<string,unknown>,failed:(error:Error)=>void)=>void
 fence:()=>{ownerId:string;term:number}|null
 /** True only under an HA lease (native fence installed). Without it the
  * private owning pipe is the authority, exactly as for TAKE. */
 fenceRequired:()=>boolean
 /** Must commit before bytes reach stdin; a throw means no command is sent. */
 beforeSend:(operation:NativeLiveReplacementOperation,request:NativeLiveReplacementRequest)=>void
 /** Must persist before the receipt is allowed to satisfy a caller. */
 recordReceipt:(receipt:NativeLiveReplacementReceipt)=>void
 selectionObserved:(receipt:NativeLiveReplacementReceipt)=>boolean
}
interface Pending {operation:NativeLiveReplacementOperation;request:NativeLiveReplacementRequest;receipt?:NativeLiveReplacementReceipt;timer:ReturnType<typeof setTimeout>;resolve:(receipt:NativeLiveReplacementReceipt)=>void;reject:(error:Error)=>void}

/** Native private-pipe transport only. No LOAD/TAKE fallback, metadata toggle,
 * automatic retry, process kill or durable-log replacement. Callers must supply
 * the journal/authorization port; the product must not enable this without it. */
export class NativeLiveReplacementWire {
 private generation:string|null=null
 private supported=false
 private readonly bindings=new Map<string,NativeLiveReplacementRequest>()
 private readonly receipts=new Map<string,NativeLiveReplacementReceipt>()
 private readonly pending=new Map<number,Pending>()
 private selectionUnknown=false
 private readonly unresolvedCommits=new Set<string>()
 private readonly stoppedTransactions=new Set<string>()
 constructor(private readonly port:NativeLiveReplacementWirePort){}

 ready(value:{engineGeneration?:unknown;liveReplacementProtocol?:unknown;decoderIdentity?:unknown}):void{
  const next=readNativeLiveReplacementCapability(value).engineGeneration
  if(this.generation!==null&&this.generation!==next)this.disconnected()
  this.generation=next;this.supported=next!==null
 }
 health(){return {supported:this.supported,engineGeneration:this.generation,pending:this.pending.size,selectionUncertain:this.selectionUnknown||this.unresolvedCommits.size>0}}
 selectionUncertain(){this.selectionUnknown=true}
 /** Only the owning parent calls this after STOP ACK plus empty native PGM
  * and its durable stop callback. No fabricated native receipt is created. */
 confirmStopped(){
  for(const [id,pending]of this.pending){clearTimeout(pending.timer);pending.reject(new NativeLiveReplacementUnknown());this.pending.delete(id)}
  for(const key of this.bindings.keys())this.stoppedTransactions.add(key)
  this.selectionUnknown=false;this.unresolvedCommits.clear()
 }
 /** Parent has confirmed a new decoder using an authenticated durable binding. */
 confirmRecovered(receipt:NativeLiveReplacementReceipt){
  const original=this.bindings.get(receipt.transactionId)
  if(original&&receipt.phase==='COMMITTED'&&matchesNativeLiveReplacement(receipt,original))this.unresolvedCommits.delete(receipt.transactionId)
 }
 canRecoverBinding(receipt:NativeLiveReplacementReceipt){
  return !this.selectionUnknown&&(this.unresolvedCommits.size===0||this.unresolvedCommits.size===1&&this.unresolvedCommits.has(receipt.transactionId)&&receipt.phase==='COMMITTED')
 }
 requiresStopResolution(transactionId:string){const receipt=this.receipts.get(transactionId);return this.unresolvedCommits.has(transactionId)||!receipt||!nativeReplacementTerminal(receipt.phase)||receipt.phase==='UNCERTAIN'}
 disconnected():void{
  for(const pending of this.pending.values()){
   if(pending.operation==='COMMIT')this.unresolvedCommits.add(pending.request.transactionId)
   clearTimeout(pending.timer);pending.reject(new NativeLiveReplacementUnknown())
  }
  this.pending.clear();this.generation=null;this.supported=false
  // Keep evidence/uncertainty across a process exit. A new UUID cannot answer
  // an old transaction; recovery needs the durable server reconciliation.
 }
 private requireGeneration(request:NativeLiveReplacementRequest){
  if(!this.supported||this.generation!==request.engineGeneration)throw new Error('Engine sem contrato de troca nativa desta geração; nenhum TAKE alternativo será enviado.')
 }
 async prepare(request:NativeLiveReplacementRequest):Promise<NativeLiveReplacementReceipt>{
  request=nativeLiveReplacementRequestSchema.parse(request)
  this.requireGeneration(request)
  const prior=this.bindings.get(request.transactionId)
  if(prior){
   if(!matchesNativeLiveReplacement(prior,request)||prior.targetSource!==request.targetSource||prior.targetSourceType!==request.targetSourceType)throw new Error('Transação nativa pertence a outra seleção.')
   // Never open again after a missing ACK. Ask the existing native journal.
   return this.status(request.transactionId)
  }
  if(this.selectionUnknown||this.unresolvedCommits.size)throw new NativeLiveReplacementUnknown()
  if([...this.bindings.values()].some(binding=>!this.stoppedTransactions.has(binding.transactionId)&&binding.engineGeneration===this.generation&&
   (!this.receipts.has(binding.transactionId)||!nativeReplacementTerminal(this.receipts.get(binding.transactionId)!.phase))))throw new Error('Já existe uma alternativa em preparação nesta geração; consulte ou cancele antes de abrir outra.')
  if(this.bindings.size>=256)throw new Error('Limite de transações desta sessão; não reinicie um engine no ar para limpar recibos.')
  const captured={...request}
  this.bindings.set(request.transactionId,captured)
  return this.command('PREPARE',captured)
 }
 async commit(transactionId:string):Promise<NativeLiveReplacementReceipt>{
  const request=this.binding(transactionId),receipt=this.receipts.get(transactionId)
  if(this.stoppedTransactions.has(transactionId)||this.unresolvedCommits.has(transactionId)||receipt&&nativeReplacementTerminal(receipt.phase))return this.status(transactionId)
  if(this.unresolvedCommits.size||this.selectionUnknown)return Promise.reject(new NativeLiveReplacementUnknown())
  if(receipt?.phase!=='READY'||!receipt.preparedDecoderId)return Promise.reject(new Error('Fonte alternativa ainda não confirmou prontidão nativa.'))
  return this.command('COMMIT',request)
 }
 async cancel(transactionId:string){const receipt=this.receipts.get(transactionId);return receipt&&nativeReplacementTerminal(receipt.phase)?this.status(transactionId):this.command('CANCEL',this.binding(transactionId))}
 async status(transactionId:string){return this.command('STATUS',this.binding(transactionId))}
 private binding(id:string){const request=this.bindings.get(id);if(!request)throw new Error('Transação não pertence a esta sessão; reconciliar com o journal durável.');return request}

 private command(operation:NativeLiveReplacementOperation,request:NativeLiveReplacementRequest):Promise<NativeLiveReplacementReceipt>{
  this.requireGeneration(request);this.port.assertOwned();this.port.validate(operation,request)
  if(this.selectionUnknown&&operation!=='STATUS')throw new NativeLiveReplacementUnknown()
  if([...this.pending.values()].some(pending=>pending.request.transactionId===request.transactionId))throw new Error('Já existe um comando dessa transação aguardando recibo.')
  const prior=this.receipts.get(request.transactionId)
  const fenced=operation==='COMMIT'&&this.port.fenceRequired()
  const fence=fenced?this.port.fence():null
  if(fenced&&(!fence||!Number.isSafeInteger(fence.term)||fence.term<=0))throw new Error('Troca exige concessão nativa atual.')
  this.port.beforeSend(operation,request)
  this.port.assertOwned();this.port.validate(operation,request)
  const id=this.port.nextId(),base={id,engineGeneration:request.engineGeneration,transactionId:request.transactionId}
  const command=operation==='PREPARE'?{id,cmd:'prepareLiveReplacement',request}:
   operation==='COMMIT'?{...base,cmd:'commitLiveReplacement',preparedDecoderId:prior!.preparedDecoderId,...(fence??{})}:
   {...base,cmd:operation==='CANCEL'?'cancelLiveReplacement':'liveReplacementStatus'}
  if(operation==='COMMIT')this.unresolvedCommits.add(request.transactionId)
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{
    this.pending.delete(id);reject(new NativeLiveReplacementUnknown())
   },operation==='PREPARE'?15_000:5_000)
   this.pending.set(id,{operation,request,timer,resolve,reject})
   try{this.port.write(command,error=>{if(error)this.reject(id)})}catch{this.reject(id)}
  })
 }
 private reject(id:number){const pending=this.pending.get(id);if(!pending)return;clearTimeout(pending.timer);this.pending.delete(id);pending.reject(new NativeLiveReplacementUnknown())}

 /** True only for a receipt/ACK owned by this transport. Malformed and stale
  * input cannot fabricate success or change source bindings. */
 absorb(value:unknown):boolean{
  if(!value||typeof value!=='object')return false
  const event=value as Record<string,unknown>
  if(event.event==='liveReplacement'){
   const parsed=nativeLiveReplacementReceiptSchema.safeParse(event.receipt)
   if(!parsed.success||parsed.data.engineGeneration!==this.generation)return true
   const receipt=parsed.data,binding=this.bindings.get(receipt.transactionId)
   if(!binding||!matchesNativeLiveReplacement(receipt,binding))return true
   const previous=this.receipts.get(receipt.transactionId)
   if(previous?.preparedDecoderId!==null&&previous?.preparedDecoderId!==undefined&&receipt.preparedDecoderId!==previous.preparedDecoderId)return true
   if(previous&&nativeReplacementTerminal(previous.phase)&&JSON.stringify(previous)!==JSON.stringify(receipt))return true
   try{this.port.assertOwned();this.port.recordReceipt(receipt)}catch{
    if(receipt.phase==='COMMITTED'||receipt.phase==='UNCERTAIN')this.unresolvedCommits.add(receipt.transactionId)
    if(typeof event.id==='number')this.reject(event.id)
    return true
   }
   this.receipts.set(receipt.transactionId,structuredClone(receipt))
   if(receipt.phase==='UNCERTAIN')this.selectionUnknown=true
   if(typeof event.id==='number'){
    const pending=this.pending.get(event.id)
    if(pending&&matchesNativeLiveReplacement(receipt,pending.request))pending.receipt=receipt
   }
   return true
  }
  if(event.event!=='ack'||typeof event.id!=='number'||!this.pending.has(event.id))return false
  const pending=this.pending.get(event.id)!
  clearTimeout(pending.timer);this.pending.delete(event.id)
  const receipt=pending.receipt
  if(event.ok!==true||!receipt){pending.reject(new NativeLiveReplacementUnknown());return true}
  if(pending.operation==='COMMIT'&&receipt.phase==='COMMITTED'&&!this.port.selectionObserved(receipt)){
   pending.reject(new NativeLiveReplacementUnknown());return true
  }
  if(receipt.phase==='COMMITTED'){
   // A historical lookup after a later TAKE is not proof of current PGM.
   if(this.port.selectionObserved(receipt))this.unresolvedCommits.delete(receipt.transactionId)
  }else if(nativeReplacementTerminal(receipt.phase)&&receipt.phase!=='UNCERTAIN')this.unresolvedCommits.delete(receipt.transactionId)
  pending.resolve(structuredClone(receipt));return true
 }
}
