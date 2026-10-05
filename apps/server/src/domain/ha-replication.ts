import Database from 'better-sqlite3'
import {randomUUID,timingSafeEqual} from 'node:crypto'
import {hostname} from 'node:os'
import {dirname,resolve} from 'node:path'
import {existsSync,lstatSync,mkdirSync} from 'node:fs'
import {z} from 'zod'
import {installationVault,SecretVault} from './secret-vault.js'
import {HaMediaStore,haRequiredMedia,haMediaOperation,openHaMediaSource,type HaMediaAsset,type HaMediaProgress} from './ha-media.js'
import {HaLeaseClient} from './ha-witness.js'
import {HaRecovery} from './ha-recovery.js'

const id=z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),digest=z.string().regex(/^[A-Za-z0-9_-]{43}$/)
const sequence=z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
export const HA_MAX_BYTES=32*1024*1024
const wireSchema=z.object({version:z.literal(1),clusterId:id,sourceId:id,targetId:id,sequence,digest,ciphertext:z.string().max(Math.ceil(HA_MAX_BYTES*4/3)+128)}).strict()
type Wire=z.infer<typeof wireSchema>
export interface HaOptions {role:'PRIMARY'|'STANDBY';clusterId:string;nodeId:string;peerNodeId:string;key:string;file:string;peerUrl:string|null;mediaRoot?:string|null;mediaQuotaBytes?:number;mediaMbit?:number;witnessUrl?:string|null;witnessKey?:string|null}
export class HaError extends Error {constructor(readonly status:number,message:string){super(message)}}
const fail=(message:string,status=409)=>new HaError(status,message)
const equal=(a:string,b:string)=>{const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&timingSafeEqual(aa,bb)}
const identity=(value:Pick<Wire,'clusterId'|'sourceId'|'targetId'|'sequence'|'digest'>)=>JSON.stringify([value.clusterId,value.sourceId,value.targetId,value.sequence,value.digest])

/** Separate pairing key, never the admin token or a copied installation vault.
 * Opt-in. Invalid/partial configuration fails before any channel starts. */
export function haOptions(databaseFile:string,env:NodeJS.ProcessEnv=process.env):HaOptions|null{
  const role=env.RPLAYOUT_HA_ROLE
  if(!role){if(Object.keys(env).some(key=>key.startsWith('RPLAYOUT_HA_')&&env[key]))throw fail('Configure o papel HA explicitamente; opções parciais não habilitam um nó.',400);return null}
  if(role!=='PRIMARY'&&role!=='STANDBY')throw fail('Papel HA inválido: PRIMARY ou STANDBY.',400)
  const clusterId=id.parse(env.RPLAYOUT_HA_CLUSTER),nodeId=id.parse(env.RPLAYOUT_HA_NODE),peerNodeId=id.parse(env.RPLAYOUT_HA_PEER_NODE),key=env.RPLAYOUT_HA_KEY??''
  if(nodeId===peerNodeId||!/^[a-f0-9]{64}$/i.test(key))throw fail('HA exige nós distintos e chave de pareamento de 32 bytes em hexadecimal.',400)
  const file=env.RPLAYOUT_HA_DB??resolve(dirname(databaseFile),'.ha',`${nodeId}.db`)
  if(file!==':memory:'&&resolve(file)===resolve(databaseFile))throw fail('O espelho HA deve usar um banco próprio, diferente do banco operacional.',400)
  const peerUrl=env.RPLAYOUT_HA_PEER??null
  if(role==='PRIMARY'&&!peerUrl)throw fail('O primário HA exige endereço do reserva.',400)
  if(peerUrl){let url:URL;try{url=new URL(peerUrl)}catch{throw fail('Endereço HA inválido. Use HTTP/HTTPS sem credenciais, query ou fragmento.',400)}
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw fail('Use endereço HA HTTP/HTTPS sem credenciais, query ou fragmento.',400)
  }
  const mediaRoot=env.RPLAYOUT_HA_MEDIA_ROOT??(file===':memory:'?null:resolve(dirname(file),'media'))
  const mediaQuotaBytes=Number(env.RPLAYOUT_HA_MEDIA_QUOTA_BYTES??200*1024**3),mediaMbit=Number(env.RPLAYOUT_HA_MEDIA_MBIT??8)
  if(!Number.isSafeInteger(mediaQuotaBytes)||mediaQuotaBytes<=0||!Number.isFinite(mediaMbit)||mediaMbit<1||mediaMbit>1000)throw fail('Quota ou limite de rede HA inválido.',400)
  const witnessUrl=env.RPLAYOUT_HA_WITNESS??null,witnessKey=env.RPLAYOUT_HA_WITNESS_KEY??null
  if(Boolean(witnessUrl)!==Boolean(witnessKey)||witnessKey&&(!/^[a-f0-9]{64}$/i.test(witnessKey)||witnessKey.toLowerCase()===key.toLowerCase()))throw fail('Testemunha HA exige URL e chave própria de 32 bytes, distinta do pareamento.',400)
  if(witnessUrl){let url:URL;try{url=new URL(witnessUrl)}catch{throw fail('URL da testemunha inválida.',400)}
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw fail('Use testemunha HTTP/HTTPS sem credenciais, query ou fragmento.',400)
  }
  return {role,clusterId,nodeId,peerNodeId,key,file,peerUrl,mediaRoot,mediaQuotaBytes,mediaMbit,witnessUrl,witnessKey}
}

/** A complete mirror, not an executable local playlist. Media bytes, distributed
 * authority/output fencing and promotion are deliberately separate gates. */
export interface HaSnapshot {
  version:1;capturedAt:string
  channels:Array<{channelId:string;configuration:Record<string,unknown>;revisions:Array<Record<string,unknown>>;checkpoint:unknown;transport:unknown;blockers:Record<string,unknown>}>
  asRun:Array<Record<string,unknown>>
  journals:Array<Record<string,unknown>>
}
const snapshotSchema=z.object({version:z.literal(1),capturedAt:z.string().datetime(),channels:z.array(z.object({channelId:z.string().min(1),configuration:z.record(z.unknown()),revisions:z.array(z.record(z.unknown())),checkpoint:z.record(z.unknown()).nullable(),transport:z.record(z.unknown()).nullable(),blockers:z.record(z.unknown())}).strict()),asRun:z.array(z.record(z.unknown())),journals:z.array(z.record(z.unknown()))}).strict()
type Ack={version:1;clusterId:string;sourceId:string;targetId:string;sequence:number;digest:string;stored:true;automaticTake:false;signature:string}

export class HaReplication {
  readonly witness:HaLeaseClient|null
  private readonly database:Database.Database
  private readonly pairing:SecretVault
  private readonly owner={host:hostname(),pid:process.pid,boot:randomUUID()}
  private readonly abort=new AbortController()
  private busy=false
  private closed=false
  private error:string|null=null
  private checkedAt:string|null=null
  private media:HaMediaStore|null=null
  private mediaBusy=false
  private mediaNextAt=0
  private mediaError:string|null=null
  private readonly sourceChecked=new Map<string,string>()
  private mediaClosing:Promise<void>|null=null
  private confirmedSnapshot:{sequence:number;value:HaSnapshot}|null=null
  private recovery:HaRecovery|null=null
  constructor(readonly options:HaOptions,private readonly capture:()=>HaSnapshot,private readonly fetcher:typeof fetch=fetch,private readonly recoveryProbeBinary:string|null=null){
    this.witness=options.witnessUrl&&options.witnessKey?new HaLeaseClient(options.witnessUrl,options.witnessKey,options.clusterId,options.nodeId,fetcher):null
    this.pairing=new SecretVault(Buffer.from(options.key,'hex'))
    if(options.file!==':memory:'){
      const absolute=resolve(options.file);mkdirSync(dirname(absolute),{recursive:true,mode:0o700})
      if(existsSync(absolute)&&(!lstatSync(absolute).isFile()||lstatSync(absolute).isSymbolicLink()))throw fail('Banco HA inválido; não será substituído.')
    }
    this.database=new Database(options.file)
    // Refuse a foreign DB before changing its journal or creating any tables.
    // Include the media tables owned by this same service on reserve restart.
    const allowed=new Set(['ha_identity','ha_state','ha_outbox','ha_sender_owner','ha_sender_snapshot','ha_media_progress','ha_media','ha_media_root','ha_media_owner','ha_recovery'])
    const objects=this.database.prepare("SELECT name FROM sqlite_master WHERE name NOT GLOB 'sqlite_*'").all() as {name:string}[]
    if(objects.some(object=>!allowed.has(object.name))){this.database.close();throw fail('Banco pertence a outro serviço. Use um banco HA exclusivo; ele não será modificado.')}
    this.database.pragma('journal_mode = WAL');this.database.pragma('synchronous = FULL');this.database.pragma('busy_timeout = 3000')
    this.database.exec(`CREATE TABLE IF NOT EXISTS ha_identity(id INTEGER PRIMARY KEY CHECK(id=1),identity TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ha_state(id INTEGER PRIMARY KEY CHECK(id=1),sequence INTEGER NOT NULL,digest TEXT,payload TEXT,received_at TEXT,channels_count INTEGER NOT NULL DEFAULT 0,as_run_count INTEGER NOT NULL DEFAULT 0,captured_at TEXT);
      CREATE TABLE IF NOT EXISTS ha_outbox(id INTEGER PRIMARY KEY CHECK(id=1),sequence INTEGER NOT NULL,digest TEXT NOT NULL,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ha_sender_owner(id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ha_sender_snapshot(id INTEGER PRIMARY KEY CHECK(id=1),sequence INTEGER NOT NULL,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ha_media_progress(hash TEXT PRIMARY KEY,size INTEGER NOT NULL,offset INTEGER NOT NULL,ready INTEGER NOT NULL,checked_at INTEGER NOT NULL);`)
    try{this.database.transaction(()=>{
      const identity=JSON.stringify([options.role,options.clusterId,options.nodeId,options.peerNodeId,this.pairing.fingerprint])
      const old=this.database.prepare('SELECT identity FROM ha_identity WHERE id=1').get() as {identity:string}|undefined
      if(old&&old.identity!==identity)throw fail('Este banco HA pertence a outro pareamento/papel/chave. Não redefina a sequência nem apague a cópia para reutilizá-lo.')
      if(!old)this.database.prepare('INSERT INTO ha_identity VALUES(1,?)').run(identity)
      this.database.prepare('INSERT OR IGNORE INTO ha_state(id,sequence) VALUES(1,0)').run()
      const pending=this.database.prepare('SELECT payload FROM ha_outbox WHERE id=1').get() as {payload:string}|undefined
      if(pending)wireSchema.parse(JSON.parse(installationVault(false).decrypt(pending.payload,this.context('outbox'))))
      if(options.role==='STANDBY')this.mirror()
      if(options.role==='PRIMARY'){
        const row=this.database.prepare('SELECT owner FROM ha_sender_owner WHERE id=1').get() as {owner:string}|undefined
        if(row){const old=JSON.parse(row.owner);let gone=false
          if(old.host===this.owner.host&&Number.isSafeInteger(old.pid))try{process.kill(old.pid,0)}catch(error){gone=(error as NodeJS.ErrnoException).code==='ESRCH'}
          if(!gone)throw fail('Outro remetente HA está vivo ou sua posse é desconhecida; não será roubado.')
        }
        this.database.prepare('INSERT INTO ha_sender_owner VALUES(1,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner').run(JSON.stringify(this.owner))
      }
    }).immediate()
      if(options.role==='STANDBY'&&options.mediaRoot){this.media=new HaMediaStore(this.database,options.mediaRoot,options.mediaQuotaBytes??200*1024**3);const mirror=this.mirror();if(mirror)this.media.manifest(mirror)}
      if(options.role==='STANDBY'&&options.file!==':memory:')this.recovery=new HaRecovery(this.database,resolve(dirname(options.file),'rehearsals'),()=>({sequence:this.state().sequence,snapshot:this.mirror()}),hash=>this.media?.recoveryPath(hash)??Promise.resolve(null),options.clusterId+':'+options.nodeId,recoveryProbeBinary?{binary:recoveryProbeBinary}:undefined)
    }catch(error){this.database.close();throw error}
  }
  private context(kind:string){return `ha-${kind}:v1:${this.options.clusterId}:${this.options.nodeId}`}
  private mac(value:string,context:string){return this.pairing.reviewIdentity(value,`ha-${context}:v1`)}
  private requestHeaders(wire:Wire,purpose:'STATE'|'MEDIA'='STATE'){const timestamp=String(Date.now());return {'content-type':'application/json','x-rplayout-ha-purpose':purpose,'x-rplayout-ha-time':timestamp,'x-rplayout-ha-sequence':String(wire.sequence),'x-rplayout-ha-digest':wire.digest,'x-rplayout-ha-proof':this.mac(purpose+'\0'+identity(wire)+'\0'+timestamp,'request')}}
  authenticate(headers:Record<string,string|string[]|undefined>,purpose:'STATE'|'MEDIA'='STATE'):boolean{
    if(this.closed||this.options.role!=='STANDBY')return false
    const timestamp=headers['x-rplayout-ha-time'],counter=headers['x-rplayout-ha-sequence'],hash=headers['x-rplayout-ha-digest'],proof=headers['x-rplayout-ha-proof']
    if(headers['x-rplayout-ha-purpose']!==purpose||typeof timestamp!=='string'||typeof counter!=='string'||typeof hash!=='string'||typeof proof!=='string'||!/^\d{1,16}$/.test(timestamp)||!/^\d{1,16}$/.test(counter)||!digest.safeParse(hash).success||!sequence.safeParse(Number(counter)).success||Math.abs(Date.now()-Number(timestamp))>60_000)return false
    const wire={clusterId:this.options.clusterId,sourceId:this.options.peerNodeId,targetId:this.options.nodeId,sequence:Number(counter),digest:hash}
    return equal(proof,this.mac(purpose+'\0'+identity(wire)+'\0'+timestamp,'request'))
  }
  private validateSnapshot(value:unknown){
    const snapshot=snapshotSchema.parse(value),ids=new Set(snapshot.channels.map(row=>row.channelId))
    const runs=new Set(snapshot.asRun.map(row=>row.id))
    if(ids.size!==snapshot.channels.length||runs.size!==snapshot.asRun.length||snapshot.asRun.some(row=>typeof row.id!=='string'||typeof row.channelId!=='string'))throw fail('Snapshot HA inconsistente: canal/histórico inválido.',400)
    return snapshot
  }
  receive(value:unknown,headers:Record<string,string|string[]|undefined>):Ack{
    if(!this.authenticate(headers))throw fail('Pareamento HA não autorizado.',403)
    const wire=wireSchema.parse(value)
    if(wire.clusterId!==this.options.clusterId||wire.sourceId!==this.options.peerNodeId||wire.targetId!==this.options.nodeId||String(wire.sequence)!==headers['x-rplayout-ha-sequence']||wire.digest!==headers['x-rplayout-ha-digest'])throw fail('Envelope HA não pertence ao par configurado.',403)
    let raw:string
    try{raw=this.pairing.decrypt(wire.ciphertext,'ha-transfer:v1:'+identity(wire))}catch{throw fail('Envelope HA alterado ou chave incompatível.',400)}
    if(Buffer.byteLength(raw)>HA_MAX_BYTES||!equal(wire.digest,this.mac(raw,'snapshot')))throw fail('Snapshot HA excede limite ou identidade não confere.',400)
    const snapshot=this.validateSnapshot(JSON.parse(raw))
    this.database.transaction(()=>{
      const state=this.state()
      if(wire.sequence===state.sequence){if(state.digest!==wire.digest)throw fail('Sequência HA repetida com outro conteúdo.');return}
      if(wire.sequence!==state.sequence+1)throw fail('Sequência HA fora de ordem; restaure a cópia correta, sem reiniciar contadores.')
      const payload=installationVault().encrypt(JSON.stringify(snapshot),this.context('mirror'))
      this.database.prepare('UPDATE ha_state SET sequence=?,digest=?,payload=?,received_at=?,channels_count=?,as_run_count=?,captured_at=? WHERE id=1').run(wire.sequence,wire.digest,payload,new Date().toISOString(),snapshot.channels.length,snapshot.asRun.length,snapshot.capturedAt)
    }).immediate()
    this.media?.manifest(snapshot)
    const receipt={version:1 as const,clusterId:wire.clusterId,sourceId:wire.sourceId,targetId:wire.targetId,sequence:wire.sequence,digest:wire.digest,stored:true as const,automaticTake:false as const}
    return {...receipt,signature:this.mac(JSON.stringify(receipt),'receipt')}
  }
  private state(){return this.database.prepare('SELECT * FROM ha_state WHERE id=1').get() as {sequence:number;digest:string|null;payload:string|null;received_at:string|null;channels_count:number;as_run_count:number;captured_at:string|null}}
  /** Domain-only read: never exposed as a raw HTTP response or decoder input. */
  mirror():HaSnapshot|null{const row=this.state();return row.payload?this.validateSnapshot(JSON.parse(installationVault(false).decrypt(row.payload,this.context('mirror')))):null}
  /** Isolated restore rehearsal, never a channel promotion. */
  rehearse(value:unknown){if(this.closed||!this.recovery)throw fail('Ensaio exige reserva com banco HA persistente e separado.');return this.recovery.rehearse(value)}
  reconcileRecovery(value:unknown,actor:string|null){if(this.closed||!this.recovery)throw fail('Reconciliação exige reserva com banco HA persistente e separado.');return this.recovery.reconcile(value,actor)}
  recoveryStatus(){return {enabled:Boolean(this.recovery),reports:this.recovery?.status()??[],promotionReady:false,automaticTake:false}}
  private senderSnapshot(){const counter=this.state().sequence
    if(this.confirmedSnapshot?.sequence===counter)return this.confirmedSnapshot.value
    const row=this.database.prepare('SELECT sequence,payload FROM ha_sender_snapshot WHERE id=1').get() as {sequence:number;payload:string}|undefined
    if(!row||row.sequence!==counter)return null
    const value=this.validateSnapshot(JSON.parse(installationVault(false).decrypt(row.payload,this.context('sender-snapshot'))))
    this.confirmedSnapshot={sequence:counter,value};return value
  }
  async receiveMedia(value:unknown,headers:Record<string,string|string[]|undefined>){
    if(!this.authenticate(headers,'MEDIA'))throw fail('Pareamento de mídia HA não autorizado.',403)
    if(!this.media)throw fail('Receptor de mídia HA não configurado.')
    const wire=wireSchema.extend({ciphertext:z.string().max(800_000)}).parse(value)
    if(wire.clusterId!==this.options.clusterId||wire.sourceId!==this.options.peerNodeId||wire.targetId!==this.options.nodeId||String(wire.sequence)!==headers['x-rplayout-ha-sequence']||wire.digest!==headers['x-rplayout-ha-digest'])throw fail('Envelope de mídia não pertence ao par configurado.',403)
    if(wire.sequence!==this.state().sequence)throw fail('Edição espelhada mudou; sincronize o estado antes da mídia.')
    let raw:string;try{raw=this.pairing.decrypt(wire.ciphertext,'ha-media:v1:'+identity(wire))}catch{throw fail('Envelope de mídia HA alterado.',400)}
    if(Buffer.byteLength(raw)>512*1024||!equal(wire.digest,this.mac(raw,'media')))throw fail('Bloco de mídia excede limite ou identidade não confere.',400)
    const progress=await this.media.receive(haMediaOperation.parse(JSON.parse(raw)))
    if(this.closed||wire.sequence!==this.state().sequence)throw fail('Estado espelhado mudou durante a cópia; consulte o offset confirmado.')
    const receipt={version:1 as const,purpose:'MEDIA' as const,clusterId:wire.clusterId,sourceId:wire.sourceId,targetId:wire.targetId,sequence:wire.sequence,digest:wire.digest,stored:true as const,automaticTake:false as const,progress}
    return {...receipt,signature:this.mac(JSON.stringify(receipt),'media-receipt')}
  }
  private async readReceipt(response:Response){
    if(!response.ok)throw fail('Reserva não confirmou o pedido HA.')
    const reader=response.body?.getReader();if(!reader)throw fail('Confirmação HA vazia.')
    const chunks:Uint8Array[]=[];let length=0
    try{for(;;){const chunk=await reader.read();if(chunk.done)break;length+=chunk.value.length;if(length>4096){await reader.cancel();throw fail('Confirmação HA excede limite.')}chunks.push(chunk.value)}}finally{reader.releaseLock()}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  }
  private assertSender(){const row=this.database.prepare('SELECT owner FROM ha_sender_owner WHERE id=1').get() as {owner:string}|undefined
    if(this.closed||row?.owner!==JSON.stringify(this.owner))throw fail('Posse do remetente HA mudou.')
  }
  private async exchangeMedia(operation:ReturnType<typeof haMediaOperation.parse>,counter:number):Promise<HaMediaProgress>{
    this.assertSender()
    const raw=JSON.stringify(operation),metadata={version:1 as const,clusterId:this.options.clusterId,sourceId:this.options.nodeId,targetId:this.options.peerNodeId,sequence:counter,digest:this.mac(raw,'media')}
    const wire={...metadata,ciphertext:this.pairing.encrypt(raw,'ha-media:v1:'+identity(metadata))},body=JSON.stringify(wire)
    const endpoint=new URL(this.options.peerUrl!);endpoint.pathname=endpoint.pathname.replace(/\/$/,'')+'/api/ha/media'
    // Throttle actual encrypted/base64 wire size, not just video payload bytes.
    this.mediaNextAt=performance.now()+Buffer.byteLength(body)*8/((this.options.mediaMbit??8)*1000)
    const response=await this.fetcher(endpoint.toString(),{method:'POST',body,headers:this.requestHeaders(wire,'MEDIA'),redirect:'error',signal:AbortSignal.any([this.abort.signal,AbortSignal.timeout(15000)])})
    const ack=await this.readReceipt(response),{signature,...receipt}=ack
    const progress=z.object({hash:z.literal(operation.hash),size:z.literal(operation.size),offset:z.number().int().min(0).max(operation.size),ready:z.boolean()}).strict().parse(receipt.progress)
    const expected={version:1,purpose:'MEDIA',clusterId:wire.clusterId,sourceId:wire.sourceId,targetId:wire.targetId,sequence:wire.sequence,digest:wire.digest,stored:true,automaticTake:false,progress}
    if(JSON.stringify(receipt)!==JSON.stringify(expected)||typeof signature!=='string'||!equal(signature,this.mac(JSON.stringify(receipt),'media-receipt'))||progress.ready&&progress.offset!==progress.size)throw fail('Confirmação de mídia não autenticada.')
    this.assertSender();return progress
  }
  /** Independent worker: copying never holds the state/checkpoint heartbeat. */
  async mediaTick(resolveSource:(asset:HaMediaAsset)=>Promise<string|null>):Promise<void>{
    if(this.closed||this.mediaBusy||this.options.role!=='PRIMARY'||!this.options.mediaRoot||performance.now()<this.mediaNextAt)return
    this.mediaBusy=true
    let source:Awaited<ReturnType<typeof openHaMediaSource>>|null=null,hash:string|null=null
    try{
      this.assertSender();if(this.database.prepare('SELECT 1 FROM ha_outbox').get())return
      const snapshot=this.senderSnapshot();if(!snapshot)return
      const required=haRequiredMedia(snapshot),progresses=new Map((this.database.prepare('SELECT * FROM ha_media_progress').all() as Array<HaMediaProgress&{checked_at:number}>).map(row=>[row.hash,row]))
      const asset=[...required.values()].filter(asset=>!progresses.get(asset.contentHash)?.ready||Date.now()-(progresses.get(asset.contentHash)?.checked_at??0)>=60_000).sort((a,b)=>(progresses.get(a.contentHash)?.checked_at??0)-(progresses.get(b.contentHash)?.checked_at??0))[0]
      if(!asset){this.mediaError=null;return}
      hash=asset.contentHash
      const path=await resolveSource(asset);if(!path)throw fail('Mídia publicada não está disponível para cópia HA.')
      source=await openHaMediaSource(path,hash,this.sourceChecked,this.abort.signal)
      this.assertSender();const counter=this.state().sequence,previous=progresses.get(hash)
      let operation:ReturnType<typeof haMediaOperation.parse>={version:1,operation:'STATUS',hash,size:source.size}
      if(previous&&previous.size===source.size&&!previous.ready&&previous.offset>=0){
        operation=previous.offset===source.size?{...operation,operation:'VERIFY'}:{...operation,operation:'WRITE',offset:previous.offset,data:(await source.read(previous.offset)).toString('base64')}
      }
      const progress=await this.exchangeMedia(operation,counter)
      this.database.prepare('INSERT INTO ha_media_progress VALUES(?,?,?,?,?) ON CONFLICT(hash) DO UPDATE SET size=excluded.size,offset=excluded.offset,ready=excluded.ready,checked_at=excluded.checked_at').run(hash,progress.size,progress.offset,progress.ready?1:0,Date.now())
      this.mediaError=null
    }catch{
      if(!this.closed){if(hash)this.database.prepare('INSERT INTO ha_media_progress VALUES(?,0,-1,0,?) ON CONFLICT(hash) DO UPDATE SET offset=-1,ready=0,checked_at=excluded.checked_at').run(hash,Date.now())
        this.mediaError='Mídia não confirmada. Confira origem SHA, quota, pasta, pareamento e edição. Cópia parcial não autoriza assumir PGM.'}
    }finally{await source?.close();this.mediaBusy=false}
  }
  private stage():Wire{
    return this.database.transaction(()=>{
      const owner=this.database.prepare('SELECT owner FROM ha_sender_owner WHERE id=1').get() as {owner:string}|undefined
      if(owner?.owner!==JSON.stringify(this.owner))throw fail('Posse do remetente HA mudou.')
      const pending=this.database.prepare('SELECT payload FROM ha_outbox WHERE id=1').get() as {payload:string}|undefined
      if(pending)return wireSchema.parse(JSON.parse(installationVault(false).decrypt(pending.payload,this.context('outbox'))))
      const raw=JSON.stringify(this.validateSnapshot(this.capture()))
      if(Buffer.byteLength(raw)>HA_MAX_BYTES)throw fail('Snapshot HA excede 32 MiB. A replicação foi recusada sem truncar o histórico.')
      const counter=this.state().sequence+1
      sequence.parse(counter)
      const metadata={version:1 as const,clusterId:this.options.clusterId,sourceId:this.options.nodeId,targetId:this.options.peerNodeId,sequence:counter,digest:this.mac(raw,'snapshot')}
      const wire={...metadata,ciphertext:this.pairing.encrypt(raw,'ha-transfer:v1:'+identity(metadata))}
      this.database.prepare('INSERT INTO ha_outbox VALUES(1,?,?,?)').run(counter,metadata.digest,installationVault().encrypt(JSON.stringify(wire),this.context('outbox')))
      return wire
    }).immediate()
  }
  async tick():Promise<void>{
    if(this.closed||this.busy||this.options.role!=='PRIMARY')return
    this.busy=true;this.checkedAt=new Date().toISOString()
    try{
      const wire=this.stage(),endpoint=new URL(this.options.peerUrl!);endpoint.pathname=endpoint.pathname.replace(/\/$/,'')+'/api/ha/replica'
      const response=await this.fetcher(endpoint.toString(),{method:'POST',body:JSON.stringify(wire),headers:this.requestHeaders(wire),redirect:'error',signal:AbortSignal.any([this.abort.signal,AbortSignal.timeout(5000)])})
      const ack=await this.readReceipt(response) as Ack,{signature,...receipt}=ack
      const expected={version:1,clusterId:wire.clusterId,sourceId:wire.sourceId,targetId:wire.targetId,sequence:wire.sequence,digest:wire.digest,stored:true,automaticTake:false}
      if(JSON.stringify(receipt)!==JSON.stringify(expected)||typeof signature!=='string'||!equal(signature,this.mac(JSON.stringify(receipt),'receipt')))throw fail('Reserva não autenticou a confirmação durável.')
      if(!this.closed)this.database.transaction(()=>{
        const pending=this.database.prepare('SELECT sequence,digest FROM ha_outbox WHERE id=1').get() as {sequence:number;digest:string}|undefined
        const owner=this.database.prepare('SELECT owner FROM ha_sender_owner WHERE id=1').get() as {owner:string}|undefined
        if(owner?.owner!==JSON.stringify(this.owner)||pending?.sequence!==wire.sequence||pending.digest!==wire.digest)throw fail('Posse/pedido HA mudou antes da confirmação.')
        this.database.prepare('UPDATE ha_state SET sequence=?,digest=?,received_at=? WHERE id=1').run(wire.sequence,wire.digest,new Date().toISOString())
        const raw=this.pairing.decrypt(wire.ciphertext,'ha-transfer:v1:'+identity(wire))
        this.database.prepare('INSERT INTO ha_sender_snapshot VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET sequence=excluded.sequence,payload=excluded.payload').run(wire.sequence,installationVault().encrypt(raw,this.context('sender-snapshot')))
        this.database.prepare('DELETE FROM ha_outbox WHERE id=1').run()
      }).immediate()
      this.error=null
    }catch{if(!this.closed)this.error='Replicação não confirmada. Confira pareamento, banco, sequência, limite de snapshot e conectividade. O pedido pendente será reenviado sem novo conteúdo.'}
    finally{this.busy=false}
  }
  status(){
    const state=this.state()
    const snapshot=this.options.role==='PRIMARY'?this.senderSnapshot():null,required=snapshot?haRequiredMedia(snapshot):new Map()
    const verified=(this.database.prepare('SELECT hash FROM ha_media_progress WHERE ready=1').all() as {hash:string}[]).filter(row=>required.has(row.hash)).length
    const media=this.media?.status()??{enabled:Boolean(this.options.mediaRoot),required:required.size,verified,ready:false,note:'Confirmações de cópia do reserva; promoção exige revalidar SHA/QC. Não autoriza PGM.'}
    return {configured:true,role:this.options.role,nodeId:this.options.nodeId,peerNodeId:this.options.peerNodeId,clusterId:this.options.clusterId,sequence:state.sequence,confirmedAt:state.received_at,checkedAt:this.checkedAt,pending:Boolean(this.database.prepare('SELECT 1 FROM ha_outbox').get()),error:this.error,mirroredChannels:state.channels_count,mirroredAsRun:state.as_run_count,capturedAt:state.captured_at,media:{...media,mbit:this.options.mediaMbit??8,error:this.mediaError},authority:this.witness?.status()??{configured:false,nativeFencingRequired:false,physicalOutputValidated:false},automaticTake:false,failoverReady:false,reason:'Espelho e mídia não autorizam promoção. Concessão nativa só é exigida com testemunha configurada; failover e fencing externo do destino continuam pendentes. Reserva não abre PGM.'}
  }
  close(){if(this.closed)return;this.closed=true;this.abort.abort();this.media?.close();this.witness?.close();this.recovery?.close()
    const finish=()=>{this.media?.release();if(this.options.role==='PRIMARY')this.database.prepare('DELETE FROM ha_sender_owner WHERE id=1 AND owner=?').run(JSON.stringify(this.owner));this.database.close()}
    if(this.media?.running||this.recovery?.running)this.mediaClosing=Promise.all([this.media?.settled(),this.recovery?.settled()]).then(finish);else{finish();this.mediaClosing=Promise.resolve()}
  }
  async settled(){await this.mediaClosing}
}
