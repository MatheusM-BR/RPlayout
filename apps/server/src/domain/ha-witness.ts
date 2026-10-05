import Database from 'better-sqlite3'
import {randomUUID,timingSafeEqual} from 'node:crypto'
import {existsSync,lstatSync,mkdirSync} from 'node:fs'
import {dirname,resolve} from 'node:path'
import {hostname} from 'node:os'
import {z} from 'zod'
import {SecretVault} from './secret-vault.js'

export const HA_LEASE_MS=5000
export const HA_FENCE_MARGIN_MS=1000
const identifier=z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)
const requestSchema=z.object({version:z.literal(1),purpose:z.literal('LEASE'),clusterId:identifier,channelId:z.string().min(1).max(128),nodeId:identifier,ownerId:z.string().uuid(),nonce:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),requestTime:z.number().int().positive()}).strict()
export type LeaseRequest=z.infer<typeof requestSchema>
const wireSchema=z.object({request:requestSchema,signature:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).strict()
export interface LeaseGrant extends LeaseRequest {term:number;ttlMs:typeof HA_LEASE_MS;signature:string}
const canonical=(request:LeaseRequest)=>JSON.stringify([request.version,request.purpose,request.clusterId,request.channelId,request.nodeId,request.ownerId,request.nonce,request.requestTime])
const grantIdentity=(grant:Omit<LeaseGrant,'signature'>)=>canonical(grant)+'\0'+grant.term+'\0'+grant.ttlMs
const equal=(a:string,b:string)=>{const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&timingSafeEqual(aa,bb)}
export class WitnessError extends Error {constructor(readonly status:number,message:string){super(message)}}
export interface WitnessOptions {file:string;clusterId:string;nodes:readonly string[];key:string}
type Lease={until:number;grant:LeaseGrant}

/** Single independent arbiter. Monotonic deadlines, never wall-clock expiry.
 * Every restart quarantines longer than the maximum old grant. Losing the
 * witness trades availability for safety; it never authorizes two owners. */
export class HaWitness {
  private readonly db:Database.Database
  private readonly vault:SecretVault
  private readonly owner=JSON.stringify({host:hostname(),pid:process.pid,boot:randomUUID()})
  private readonly leases=new Map<string,Lease>()
  private readonly quarantineUntil:number
  private closed=false
  constructor(readonly options:WitnessOptions,private readonly clock=()=>performance.now()){
    if(!identifier.safeParse(options.clusterId).success||options.nodes.length!==2||new Set(options.nodes).size!==2||options.nodes.some(node=>!identifier.safeParse(node).success)||!/^[a-f0-9]{64}$/i.test(options.key))throw new WitnessError(400,'Testemunha exige cluster, dois nós distintos e chave de 32 bytes.')
    this.vault=new SecretVault(Buffer.from(options.key,'hex'))
    if(options.file!==':memory:'){const path=resolve(options.file);mkdirSync(dirname(path),{recursive:true,mode:0o700});if(existsSync(path)&&(!lstatSync(path).isFile()||lstatSync(path).isSymbolicLink()))throw new WitnessError(409,'Banco da testemunha inválido; não será substituído.')}
    this.db=new Database(options.file)
    // Opening a mistaken operational/HA DB must not add witness tables or
    // change its journal mode. Only a new file or this dedicated schema is
    // accepted. Terms must never be reset by repurposing another service DB.
    const allowed=new Set(['witness_identity','witness_owner','witness_channels'])
    const objects=this.db.prepare("SELECT name FROM sqlite_master WHERE name NOT GLOB 'sqlite_*'").all() as {name:string}[]
    if(objects.some(object=>!allowed.has(object.name))){this.db.close();throw new WitnessError(409,'Banco pertence a outro serviço. Use um banco exclusivo da testemunha; ele não será modificado.')}
    this.db.pragma('journal_mode = WAL');this.db.pragma('synchronous = FULL');this.db.pragma('busy_timeout = 3000')
    this.db.exec(`CREATE TABLE IF NOT EXISTS witness_identity(id INTEGER PRIMARY KEY CHECK(id=1),identity TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS witness_owner(id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS witness_channels(channel_id TEXT PRIMARY KEY,term INTEGER NOT NULL,node_id TEXT NOT NULL,owner_id TEXT NOT NULL,nonce INTEGER NOT NULL);`)
    try{this.db.transaction(()=>{
      const identity=JSON.stringify([options.clusterId,[...options.nodes].sort(),this.vault.fingerprint]),old=this.db.prepare('SELECT identity FROM witness_identity WHERE id=1').get() as {identity:string}|undefined
      if(old&&old.identity!==identity)throw new WitnessError(409,'Banco vinculado a outro cluster/nós/chave; não redefina termos para reutilizá-lo.')
      const occupied=this.db.prepare('SELECT owner FROM witness_owner WHERE id=1').get() as {owner:string}|undefined
      if(occupied){const old=JSON.parse(occupied.owner);let gone=false;if(old.host===hostname()&&Number.isSafeInteger(old.pid))try{process.kill(old.pid,0)}catch(error){gone=(error as NodeJS.ErrnoException).code==='ESRCH'}
        if(!gone)throw new WitnessError(409,'Outra testemunha está viva ou sua posse é desconhecida; autoridade não será roubada.')}
      if(!old)this.db.prepare('INSERT INTO witness_identity VALUES(1,?)').run(identity)
      this.db.prepare('INSERT INTO witness_owner VALUES(1,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner').run(this.owner)
    }).immediate()}catch(error){this.db.close();throw error}
    this.quarantineUntil=this.clock()+HA_LEASE_MS+HA_FENCE_MARGIN_MS
  }
  request(value:unknown):LeaseGrant{
    if(this.closed)throw new WitnessError(503,'Testemunha encerrando.')
    const {request,signature}=wireSchema.parse(value)
    if(request.clusterId!==this.options.clusterId||!this.options.nodes.includes(request.nodeId)||Math.abs(Date.now()-request.requestTime)>60_000||!equal(signature,this.vault.reviewIdentity(canonical(request),'ha-witness-request:v1')))throw new WitnessError(403,'Pedido de posse não autenticado.')
    const now=this.clock();if(now<this.quarantineUntil)throw new WitnessError(503,'Testemunha em quarentena após início/reinício; nenhum novo dono autorizado.')
    return this.db.transaction(()=>{
      const owner=this.db.prepare('SELECT owner FROM witness_owner WHERE id=1').get() as {owner:string}|undefined
      if(owner?.owner!==this.owner)throw new WitnessError(409,'Posse da testemunha mudou.')
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
  health(){return {ok:!this.closed,quarantined:this.clock()<this.quarantineUntil,physicalOutputValidated:false}}
  close(){if(this.closed)return;this.closed=true;this.db.prepare('DELETE FROM witness_owner WHERE id=1 AND owner=?').run(this.owner);this.db.close()}
}

/** Each native engine issues a nonce before its request. The native deadline
 * starts at that nonce, not at delivery of this response or the Node timer. */
export class HaLeaseClient {
  private readonly vault:SecretVault
  private readonly abort=new AbortController()
  private readonly states=new Map<string,{term:number;confirmedAt:string|null;error:string|null}>()
  constructor(private readonly url:string,private readonly key:string,private readonly clusterId:string,private readonly nodeId:string,private readonly fetcher:typeof fetch=fetch){this.vault=new SecretVault(Buffer.from(key,'hex'))}
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
  status(){return {configured:true,leases:[...this.states].map(([channelId,state])=>({channelId,...state})),nativeFencingRequired:true,physicalOutputValidated:false}}
  close(){this.abort.abort()}
}
