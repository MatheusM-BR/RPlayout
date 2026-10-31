import Database from 'better-sqlite3'
import {randomUUID,timingSafeEqual} from 'node:crypto'
import {existsSync,lstatSync,mkdirSync} from 'node:fs'
import {dirname,resolve} from 'node:path'
import {hostname} from 'node:os'
import {z} from 'zod'
import {SecretVault} from './secret-vault.js'
import {HaWitnessControl,WitnessControlError as WitnessError,witnessControlCanonical,witnessControlRequest,witnessControlResponse,witnessTransferCommand,type WitnessControlRequest} from './ha-witness-control.js'
export {WitnessControlError as WitnessError} from './ha-witness-control.js'

export const HA_LEASE_MS=5000
export const HA_FENCE_MARGIN_MS=1000
export const HA_OUTPUT_LEASE_MS=1500
const identifier=z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)
const requestSchema=z.object({version:z.literal(1),purpose:z.literal('LEASE'),clusterId:identifier,channelId:z.string().min(1).max(128),nodeId:identifier,ownerId:z.string().uuid(),nonce:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),requestTime:z.number().int().positive()}).strict()
export type LeaseRequest=z.infer<typeof requestSchema>
const wireSchema=z.object({request:requestSchema,signature:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).strict()
export interface LeaseGrant extends LeaseRequest {term:number;ttlMs:typeof HA_LEASE_MS;signature:string}
const canonical=(request:LeaseRequest)=>JSON.stringify([request.version,request.purpose,request.clusterId,request.channelId,request.nodeId,request.ownerId,request.nonce,request.requestTime])
const grantIdentity=(grant:Omit<LeaseGrant,'signature'>)=>canonical(grant)+'\0'+grant.term+'\0'+grant.ttlMs
const outputRequestSchema=requestSchema.extend({purpose:z.literal('OUTPUT'),consumerId:z.string().uuid()}).strict()
type OutputLeaseRequest=z.infer<typeof outputRequestSchema>
type OutputLeaseGrant=OutputLeaseRequest&{term:number;ttlMs:typeof HA_OUTPUT_LEASE_MS;signature:string}
const outputCanonical=(request:OutputLeaseRequest)=>JSON.stringify([request.version,request.purpose,request.clusterId,request.channelId,request.nodeId,request.ownerId,request.consumerId,request.nonce,request.requestTime])
const equal=(a:string,b:string)=>{const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&timingSafeEqual(aa,bb)}
export interface WitnessOptions {file:string;clusterId:string;nodes:readonly string[];key:string;controlKey?:string|null}
type Lease={until:number;grant:LeaseGrant}

/** Single independent arbiter. Monotonic deadlines, never wall-clock expiry.
 * Every restart quarantines longer than the maximum old grant. Losing the
 * witness trades availability for safety; it never authorizes two owners. */
export class HaWitness {
  private readonly db:Database.Database
  private readonly vault:SecretVault
  private readonly control:HaWitnessControl
  private readonly owner=JSON.stringify({host:hostname(),pid:process.pid,boot:randomUUID()})
  private readonly leases=new Map<string,Lease>()
  private readonly outputNonces=new Map<string,{nonce:number;requestTime:number;grant:OutputLeaseGrant;retainUntil:number}>()
  private nextOutputPrune=0
  private readonly quarantineUntil:number
  private closed=false
  constructor(readonly options:WitnessOptions,private readonly clock=()=>performance.now()){
    if(!identifier.safeParse(options.clusterId).success||options.nodes.length!==2||new Set(options.nodes).size!==2||options.nodes.some(node=>!identifier.safeParse(node).success)||!/^[a-f0-9]{64}$/i.test(options.key)||options.controlKey&&(!/^[a-f0-9]{64}$/i.test(options.controlKey)||options.controlKey.toLowerCase()===options.key.toLowerCase()))throw new WitnessError(400,'Testemunha exige cluster, dois nós distintos e chaves separadas de 32 bytes para engine/controle.')
    this.vault=new SecretVault(Buffer.from(options.key,'hex'))
    if(options.file!==':memory:'){const path=resolve(options.file);mkdirSync(dirname(path),{recursive:true,mode:0o700});if(existsSync(path)&&(!lstatSync(path).isFile()||lstatSync(path).isSymbolicLink()))throw new WitnessError(409,'Banco da testemunha inválido; não será substituído.')}
    this.db=new Database(options.file)
    // Opening a mistaken operational/HA DB must not add witness tables or
    // change its journal mode. Only a new file or this dedicated schema is
    // accepted. Terms must never be reset by repurposing another service DB.
    const allowed=new Set(['witness_identity','witness_owner','witness_channels','witness_assignments','witness_transfers','witness_control_identity','witness_transfers_no_update','witness_transfers_no_delete','witness_transfers_no_replace'])
    const objects=this.db.prepare("SELECT name FROM sqlite_master WHERE name NOT GLOB 'sqlite_*'").all() as {name:string}[]
    if(objects.some(object=>!allowed.has(object.name))){this.db.close();throw new WitnessError(409,'Banco pertence a outro serviço. Use um banco exclusivo da testemunha; ele não será modificado.')}
    this.db.pragma('journal_mode = WAL');this.db.pragma('synchronous = FULL');this.db.pragma('busy_timeout = 3000')
    this.db.exec(`CREATE TABLE IF NOT EXISTS witness_identity(id INTEGER PRIMARY KEY CHECK(id=1),identity TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS witness_owner(id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS witness_channels(channel_id TEXT PRIMARY KEY,term INTEGER NOT NULL,node_id TEXT NOT NULL,owner_id TEXT NOT NULL,nonce INTEGER NOT NULL);`)
    this.control=new HaWitnessControl(this.db,this.vault,options.controlKey?new SecretVault(Buffer.from(options.controlKey,'hex')):null,options.clusterId,options.nodes,()=>this.assertOwned(),channelId=>{
      const previous=this.db.prepare('SELECT term,owner_id,node_id FROM witness_channels WHERE channel_id=?').get(channelId) as {term:number;owner_id:string;node_id:string}|undefined
      if(previous&&(!Number.isSafeInteger(previous.term)||previous.term<=0))throw new WitnessError(409,'Termo da testemunha inválido.')
      const live=this.leases.get(channelId),now=this.clock()
      return {term:previous?.term??0,lastEngineOwnerId:previous?z.string().uuid().parse(previous.owner_id):null,lastEngineNodeId:previous?identifier.parse(previous.node_id):null,engineLeaseActive:Boolean(now>=this.quarantineUntil&&live&&now<live.until),transferBlocked:now<this.quarantineUntil||Boolean(live&&now<live.until+HA_FENCE_MARGIN_MS)}
    })
    try{this.db.transaction(()=>{
      const identity=JSON.stringify([options.clusterId,[...options.nodes].sort(),this.vault.fingerprint]),old=this.db.prepare('SELECT identity FROM witness_identity WHERE id=1').get() as {identity:string}|undefined
      if(old&&old.identity!==identity)throw new WitnessError(409,'Banco vinculado a outro cluster/nós/chave; não redefina termos para reutilizá-lo.')
      const occupied=this.db.prepare('SELECT owner FROM witness_owner WHERE id=1').get() as {owner:string}|undefined
      if(occupied){const old=JSON.parse(occupied.owner);let gone=false;if(old.host===hostname()&&Number.isSafeInteger(old.pid))try{process.kill(old.pid,0)}catch(error){gone=(error as NodeJS.ErrnoException).code==='ESRCH'}
        if(!gone)throw new WitnessError(409,'Outra testemunha está viva ou sua posse é desconhecida; autoridade não será roubada.')}
      if(!old)this.db.prepare('INSERT INTO witness_identity VALUES(1,?)').run(identity)
      this.control.initialize()
      this.db.prepare('INSERT INTO witness_owner VALUES(1,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner').run(this.owner)
    }).immediate()}catch(error){this.db.close();throw error}
    this.quarantineUntil=this.clock()+HA_LEASE_MS+HA_FENCE_MARGIN_MS
  }
  private assertOwned(){
    if(this.closed)throw new WitnessError(503,'Testemunha encerrando.')
    const owner=this.db.prepare('SELECT owner FROM witness_owner WHERE id=1').get() as {owner:string}|undefined
    if(owner?.owner!==this.owner)throw new WitnessError(409,'Posse da testemunha mudou.')
  }
  controlRequest(value:unknown){this.assertOwned();return this.control.handle(value)}
  request(value:unknown):LeaseGrant{
    if(this.closed)throw new WitnessError(503,'Testemunha encerrando.')
    const {request,signature}=wireSchema.parse(value)
    if(request.clusterId!==this.options.clusterId||!this.options.nodes.includes(request.nodeId)||Math.abs(Date.now()-request.requestTime)>60_000||!equal(signature,this.vault.reviewIdentity(canonical(request),'ha-witness-request:v1')))throw new WitnessError(403,'Pedido de posse não autenticado.')
    const now=this.clock();if(now<this.quarantineUntil)throw new WitnessError(503,'Testemunha em quarentena após início/reinício; nenhum novo dono autorizado.')
    return this.db.transaction(()=>{
      const owner=this.db.prepare('SELECT owner FROM witness_owner WHERE id=1').get() as {owner:string}|undefined
      if(owner?.owner!==this.owner)throw new WitnessError(409,'Posse da testemunha mudou.')
      this.control.admit(request.channelId,request.nodeId)
      const live=this.leases.get(request.channelId),same=live?.grant.nodeId===request.nodeId&&live.grant.ownerId===request.ownerId
      if(live&&now<live.until){
        if(!same)throw new WitnessError(409,'Canal ainda concedido a outro engine. Aguarde expiração; heartbeat não toma posse.')
        if(request.nonce===live.grant.nonce){if(request.requestTime!==live.grant.requestTime)throw new WitnessError(409,'Nonce repetido com outro pedido.');return live.grant}
        if(request.nonce<live.grant.nonce)throw new WitnessError(409,'Pedido de posse fora de ordem.')
      }
      const previous=this.db.prepare('SELECT term,node_id,owner_id,nonce FROM witness_channels WHERE channel_id=?').get(request.channelId) as {term:number;node_id:string;owner_id:string;nonce:number}|undefined
      if(previous?.node_id===request.nodeId&&previous.owner_id===request.ownerId&&request.nonce<=previous.nonce)throw new WitnessError(409,'Nonce antigo não renova nem recria concessão expirada.')
      const term=live&&now<live.until&&same?live.grant.term:(previous?.term??0)+1
      if(!Number.isSafeInteger(term)||term<=0)throw new WitnessError(409,'Termo da autoridade esgotado; nenhum novo dono autorizado.')
      const receipt:Omit<LeaseGrant,'signature'>={...request,term,ttlMs:HA_LEASE_MS},grant={...receipt,signature:this.vault.reviewIdentity(grantIdentity(receipt),'ha-witness-grant:v1')}
      this.db.prepare('INSERT INTO witness_channels VALUES(?,?,?,?,?) ON CONFLICT(channel_id) DO UPDATE SET term=excluded.term,node_id=excluded.node_id,owner_id=excluded.owner_id,nonce=excluded.nonce').run(request.channelId,term,request.nodeId,request.ownerId,request.nonce)
      // The deadline is based on receipt before disk commit, not delayed ACK.
      this.leases.set(request.channelId,{until:now+HA_LEASE_MS,grant});return grant
    }).immediate()
  }
  output(value:unknown):OutputLeaseGrant {
    if(this.closed)throw new WitnessError(503,'Testemunha encerrando.')
    const {request,signature}=z.object({request:outputRequestSchema,signature:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).strict().parse(value)
    if(request.clusterId!==this.options.clusterId||!this.options.nodes.includes(request.nodeId)||Math.abs(Date.now()-request.requestTime)>60_000||!equal(signature,this.vault.reviewIdentity(outputCanonical(request),'ha-output-request:v1')))throw new WitnessError(403,'Pedido de saída não autenticado.')
    const now=this.clock(),master=this.leases.get(request.channelId)
    const owner=this.db.prepare('SELECT owner FROM witness_owner WHERE id=1').get() as {owner:string}|undefined
    if(owner?.owner!==this.owner)throw new WitnessError(409,'Posse da testemunha mudou; saída não autorizada.')
    if(now<this.quarantineUntil||!master||master.until-now<=HA_OUTPUT_LEASE_MS||master.grant.nodeId!==request.nodeId||master.grant.ownerId!==request.ownerId)throw new WitnessError(409,'Engine sem concessão vigente suficiente; saída não autorizada.')
    this.control.assertAdmitted(request.channelId,request.nodeId)
    const key=JSON.stringify([request.channelId,request.ownerId,request.consumerId]),previous=this.outputNonces.get(key)
    if(previous&&request.nonce<=previous.nonce){
      if(request.nonce===previous.nonce&&request.requestTime===previous.requestTime)return previous.grant
      throw new WitnessError(409,'Nonce de saída antigo ou reutilizado; nenhuma concessão renovada.')
    }
    // Bounded per-process state; master lease remains the only channel owner.
    // No output grant can outlive it or promote a different engine.
    if(now>=this.nextOutputPrune){for(const [id,saved] of this.outputNonces)if(saved.retainUntil<now)this.outputNonces.delete(id);this.nextOutputPrune=now+5000}
    if(!previous&&this.outputNonces.size>=4096)throw new WitnessError(503,'Limite de consumidores atingido; saída não autorizada.')
    const receipt:Omit<OutputLeaseGrant,'signature'>={...request,term:master.grant.term,ttlMs:HA_OUTPUT_LEASE_MS},grant:OutputLeaseGrant={...receipt,signature:this.vault.reviewIdentity(outputCanonical(request)+'\0'+receipt.term+'\0'+receipt.ttlMs,'ha-output-grant:v1')}
    this.outputNonces.set(key,{nonce:request.nonce,requestTime:request.requestTime,grant,retainUntil:now+65_000})
    return grant
  }
  health(){return {ok:!this.closed,quarantined:this.clock()<this.quarantineUntil,nodeAdmissionRequired:true,explicitTransferConfigured:Boolean(this.options.controlKey),physicalOutputValidated:false}}
  close(){if(this.closed)return;this.closed=true;this.db.prepare('DELETE FROM witness_owner WHERE id=1 AND owner=?').run(this.owner);this.db.close()}
}

/** Each native engine issues a nonce before its request. The native deadline
 * starts at that nonce, not at delivery of this response or the Node timer. */
export class HaLeaseClient {
  private readonly vault:SecretVault
  private readonly controlVault:SecretVault|null
  private readonly abort=new AbortController()
  private readonly states=new Map<string,{term:number;confirmedAt:string|null;error:string|null}>()
  constructor(private readonly url:string,private readonly key:string,private readonly clusterId:string,private readonly nodeId:string,private readonly fetcher:typeof fetch=fetch,controlKey:string|null=null){
    this.vault=new SecretVault(Buffer.from(key,'hex'))
    if(controlKey&&(!/^[a-f0-9]{64}$/i.test(controlKey)||controlKey.toLowerCase()===key.toLowerCase()))throw new Error('Controle HA exige chave própria, diferente da chave do engine.')
    this.controlVault=controlKey?new SecretVault(Buffer.from(controlKey,'hex')):null
  }
  get transferControlConfigured(){return Boolean(this.controlVault)}
  private async controlExchange(request:WitnessControlRequest){
    try{return await this.uncheckedControlExchange(request)}catch{throw new Error('Controle HA sem confirmação válida. Consulte o mesmo UUID; não inicie PGM nem crie transferência substituta automaticamente.')}
  }
  private async uncheckedControlExchange(request:WitnessControlRequest){
    this.abort.signal.throwIfAborted()
    if(!this.controlVault)throw new Error('Chave de controle HA não configurada; engine não pode transferir autoridade.')
    const validated=witnessControlRequest.parse(request),endpoint=new URL(this.url)
    endpoint.pathname=endpoint.pathname.replace(/\/$/,'')+({'ASSIGNMENT':'/assignment','TRANSFER':'/transfer','TRANSFER_QUERY':'/transfer-query'} as const)[validated.purpose]
    // Deliberately no automatic retry. A lost answer is queried by the same UUID.
    const response=await this.fetcher(endpoint.toString(),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({request:validated,signature:this.controlVault.reviewIdentity(witnessControlCanonical(validated),'ha-witness-control-request:v1')}),redirect:'error',signal:AbortSignal.any([this.abort.signal,AbortSignal.timeout(1500)])})
    if(!response.ok)throw new Error('Controle da testemunha não confirmou o pedido. Consulte o UUID; não repita a transferência com outro pedido.')
    const reader=response.body?.getReader();if(!reader)throw new Error('Controle da testemunha respondeu sem recibo.')
    let bytes=0;const chunks:Uint8Array[]=[]
    try{for(;;){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.length;if(bytes>4096){await reader.cancel();throw new Error('Recibo de controle excede limite.')}chunks.push(chunk.value)}}finally{reader.releaseLock()}
    const receipt=witnessControlResponse.parse(JSON.parse(Buffer.concat(chunks).toString('utf8'))),{signature,...unsigned}=receipt
    if(witnessControlCanonical(receipt.responseTo)!==witnessControlCanonical(validated)||!equal(signature,this.controlVault.reviewIdentity(JSON.stringify(unsigned),'ha-witness-control-response:v1'))||receipt.result.clusterId!==this.clusterId||receipt.result.channelId!==validated.channelId)throw new Error('Recibo de controle adulterado ou de outro pedido/canal.')
    this.abort.signal.throwIfAborted()
    return receipt.result
  }
  async assignment(channelId:string){
    const result=await this.controlExchange({version:1,purpose:'ASSIGNMENT',clusterId:this.clusterId,channelId,nodeId:this.nodeId,requestTime:Date.now()})
    if(result.kind!=='ASSIGNMENT')throw new Error('Recibo não corresponde à consulta de admissão.')
    return result
  }
  async transfer(value:unknown){
    const command=witnessTransferCommand.parse(value)
    const result=await this.controlExchange({version:1,purpose:'TRANSFER',clusterId:this.clusterId,nodeId:this.nodeId,requestTime:Date.now(),...command})
    if(result.kind!=='TRANSFER'||result.requestId!==command.requestId||result.fromNodeId!==command.fromNodeId||result.targetNodeId!==command.targetNodeId||result.expectedTerm!==command.expectedTerm||result.expectedRevision!==command.expectedRevision)throw new Error('Recibo não corresponde à intenção de transferência.')
    return result
  }
  async transferStatus(channelId:string,requestId:string){
    const result=await this.controlExchange({version:1,purpose:'TRANSFER_QUERY',clusterId:this.clusterId,channelId,nodeId:this.nodeId,requestTime:Date.now(),requestId})
    if(result.kind==='ASSIGNMENT'||result.requestId!==requestId)throw new Error('Recibo não corresponde à consulta de transferência.')
    return result
  }
  async obtain(channelId:string,ownerId:string,nonce:number){
    if(this.abort.signal.aborted)throw new Error('Posse HA não confirmada; cliente encerrado.')
    const request:LeaseRequest=requestSchema.parse({version:1,purpose:'LEASE',clusterId:this.clusterId,channelId,nodeId:this.nodeId,ownerId,nonce,requestTime:Date.now()})
    const state=this.states.get(channelId)??{term:0,confirmedAt:null,error:null};this.states.set(channelId,state)
    try{
      const endpoint=new URL(this.url);endpoint.pathname=endpoint.pathname.replace(/\/$/,'')+'/lease'
      const response=await this.fetcher(endpoint.toString(),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({request,signature:this.vault.reviewIdentity(canonical(request),'ha-witness-request:v1')}),redirect:'error',signal:AbortSignal.any([this.abort.signal,AbortSignal.timeout(1500)])})
      if(!response.ok)throw new Error('Concessão não confirmada.')
      const reader=response.body?.getReader();if(!reader)throw new Error('Resposta vazia.')
      let bytes=0;const chunks:Uint8Array[]=[]
      try{for(;;){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.length;if(bytes>4096){await reader.cancel();throw new Error('Resposta excede limite.')}chunks.push(chunk.value)}}finally{reader.releaseLock()}
      const value=JSON.parse(Buffer.concat(chunks).toString('utf8')) as LeaseGrant,{signature,...receipt}=value
      if(JSON.stringify(receipt)!==JSON.stringify({...request,term:value.term,ttlMs:HA_LEASE_MS})||!Number.isSafeInteger(value.term)||value.term<state.term||value.term<=0||typeof signature!=='string'||!equal(signature,this.vault.reviewIdentity(grantIdentity(receipt),'ha-witness-grant:v1')))throw new Error('Concessão adulterada ou fora de ordem.')
      this.abort.signal.throwIfAborted();state.term=value.term;state.confirmedAt=new Date().toISOString();state.error=null
      return {term:value.term,ttlMs:HA_LEASE_MS}
    }catch{state.error='Posse HA não confirmada. O engine deve expirar a publicação; confirme a testemunha e a conectividade.';throw new Error(state.error)}
  }
  async obtainOutput(channelId:string,ownerId:string,consumerId:string,nonce:number){
    this.abort.signal.throwIfAborted()
    const request=outputRequestSchema.parse({version:1,purpose:'OUTPUT',clusterId:this.clusterId,channelId,nodeId:this.nodeId,ownerId,consumerId,nonce,requestTime:Date.now()})
    const endpoint=new URL(this.url);endpoint.pathname=endpoint.pathname.replace(/\/$/,'')+'/output-lease'
    const response=await this.fetcher(endpoint.toString(),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({request,signature:this.vault.reviewIdentity(outputCanonical(request),'ha-output-request:v1')}),redirect:'error',signal:AbortSignal.any([this.abort.signal,AbortSignal.timeout(900)])})
    if(!response.ok)throw new Error('Concessão de saída não confirmada.')
    const reader=response.body?.getReader();if(!reader)throw new Error('Concessão de saída vazia.')
    let bytes=0;const chunks:Uint8Array[]=[]
    try{for(;;){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.length;if(bytes>4096){await reader.cancel();throw new Error('Concessão de saída excede limite.')}chunks.push(chunk.value)}}finally{reader.releaseLock()}
    const value=JSON.parse(Buffer.concat(chunks).toString('utf8')) as OutputLeaseGrant,{signature,...receipt}=value
    if(JSON.stringify(receipt)!==JSON.stringify({...request,term:value.term,ttlMs:HA_OUTPUT_LEASE_MS})||!Number.isSafeInteger(value.term)||value.term<=0||typeof signature!=='string'||!equal(signature,this.vault.reviewIdentity(outputCanonical(request)+'\0'+value.term+'\0'+value.ttlMs,'ha-output-grant:v1')))throw new Error('Concessão de saída inválida ou de outro consumidor.')
    this.abort.signal.throwIfAborted()
    return {term:value.term,ttlMs:HA_OUTPUT_LEASE_MS}
  }
  status(){return {configured:true,leases:[...this.states].map(([channelId,state])=>({channelId,...state})),nativeFencingRequired:true,nodeAdmissionRequired:true,explicitTransferConfigured:this.transferControlConfigured,physicalOutputValidated:false}}
  close(){this.abort.abort()}
}
