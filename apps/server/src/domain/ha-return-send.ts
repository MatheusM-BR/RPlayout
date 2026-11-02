import type Database from 'better-sqlite3'
import {createHash} from 'node:crypto'
import {open,lstat} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {dirname,resolve} from 'node:path'
import {z} from 'zod'
import {installationVault} from './secret-vault.js'
import {haExportSeal} from './ha-execution-export.js'
import {haReturnOperation,haReturnProgress,HA_RETURN_CHUNK_BYTES} from './ha-return-store.js'
import {HaReturnPacer,returnWireCost} from './ha-return-pacer.js'

export const haReturnSendRequest=z.object({requestId:z.string().uuid(),channelId:z.string().min(1).max(128),promotionId:z.string().uuid(),exportId:z.string().uuid()}).strict()
export const haReturnResumeRequest=z.object({resumeId:z.string().uuid(),requestId:z.string().uuid(),channelId:z.string().min(1).max(128),reviewToken:z.string().min(1).max(256),expectedOffset:z.number().int().nonnegative().max(16*1024**3)}).strict()
const resumeLedger=z.object({version:z.literal(1),request:haReturnResumeRequest,actor:z.string().min(1).max(256),phase:z.enum(['ACCEPTED','SENDING','RECEIVED_QUARANTINE','UNCERTAIN']),updatedAt:z.string().datetime(),restartsFromZero:z.literal(false)}).strict()
export interface HaReturnSource {seal:z.infer<typeof haExportSeal>;manifestHash:string;databaseFile:string;current:()=>Promise<void>}
const ledger=z.object({version:z.literal(1),request:haReturnSendRequest,owner:z.string(),actor:z.string().min(1).max(256),phase:z.enum(['ACCEPTED','SENDING','RECEIVED_QUARANTINE','FAILED','UNCERTAIN']),counter:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),updatedAt:z.string().datetime(),receipt:haReturnProgress.nullable()}).strict().superRefine((v,ctx)=>{if(v.phase==='RECEIVED_QUARANTINE'&&v.receipt?.phase!=='RECEIVED_QUARANTINE')ctx.addIssue({code:z.ZodIssueCode.custom,message:'Recebimento sem recibo.'})})
type Ledger=z.infer<typeof ledger>
type Operation=z.infer<typeof haReturnOperation>
const same=(a:Awaited<ReturnType<typeof lstat>>,b:Awaited<ReturnType<typeof lstat>>)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs&&b.nlink===1
async function ancestry(path:string){let cursor=resolve(path);for(;;){const stat=await lstat(cursor);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Exportação não pode atravessar link/junção.');const parent=dirname(cursor);if(parent===cursor)return;cursor=parent}}

/** Explicit transfer of an owned closed export. No retry/resume from a lost
 * response or reconstructed execution. Inspection sends STATUS only. */
export class HaReturnSender{
  private closed=false
  private readonly pending=new Set<Promise<unknown>>()
  private readonly active=new Set<string>()
  private readonly pacer:HaReturnPacer
  constructor(private readonly db:Database.Database,private readonly context:string,private readonly owner:string,private readonly source:(request:z.infer<typeof haReturnSendRequest>,authorize:()=>void)=>Promise<HaReturnSource>,private readonly exchange:(operation:Operation,counter:number)=>Promise<unknown>,mbit=8){
    this.pacer=new HaReturnPacer(mbit)
    db.exec('CREATE TABLE IF NOT EXISTS ha_return_sent(request_id TEXT PRIMARY KEY,export_id TEXT NOT NULL UNIQUE,channel_id TEXT NOT NULL,report TEXT NOT NULL)')
    db.exec('CREATE TABLE IF NOT EXISTS ha_return_resumes(resume_id TEXT PRIMARY KEY,request_id TEXT NOT NULL,channel_id TEXT NOT NULL,report TEXT NOT NULL)')
  }
  private key(id:string){return 'ha-return-sent:v1:'+this.context+':'+id}
  private read(id:string,channelId:string){
    const row=this.db.prepare('SELECT * FROM ha_return_sent WHERE request_id=? AND channel_id=?').get(z.string().uuid().parse(id),z.string().min(1).max(128).parse(channelId)) as {request_id:string;export_id:string;channel_id:string;report:string}|undefined
    if(!row)throw new Error('Envio não registrado neste canal.')
    const value=ledger.parse(JSON.parse(installationVault(false).decrypt(row.report,this.key(id))))
    if(value.request.requestId!==row.request_id||value.request.exportId!==row.export_id||value.request.channelId!==row.channel_id||value.receipt&&(value.receipt.transferId!==id||value.receipt.exportId!==row.export_id||value.receipt.channelId!==channelId||value.receipt.promotionId!==value.request.promotionId))throw new Error('Diário/recibo diverge da intenção de envio.')
    return value
  }
  query(id:string,channelId:string){const value=this.read(id,channelId),canResume=!this.closed&&!this.active.has(id)&&value.owner===this.owner&&value.phase==='UNCERTAIN'&&value.receipt?.phase==='RECEIVING';return {version:1 as const,request:value.request,phase:value.phase,updatedAt:value.updatedAt,receipt:value.receipt,canResume,reviewToken:canResume?installationVault(false).reviewIdentity(JSON.stringify(value),'ha-return-resume-review:v1:'+this.context):null,primaryApproved:false as const,publicationAuthorized:false as const,authorityTransferred:false as const,automaticRestart:false as const}}
  private store(value:Ledger){value=ledger.parse({...value,updatedAt:new Date().toISOString()});if(this.db.prepare('UPDATE ha_return_sent SET report=? WHERE request_id=?').run(installationVault(false).encrypt(JSON.stringify(value),this.key(value.request.requestId)),value.request.requestId).changes!==1)throw new Error('Diário de envio perdeu pedido.');return value}
  private correlate(source:HaReturnSource,request:z.infer<typeof haReturnSendRequest>,raw:unknown){const value=haReturnProgress.parse(raw),seal=source.seal
    if(value.transferId!==request.requestId||value.exportId!==request.exportId||value.promotionId!==request.promotionId||value.channelId!==request.channelId||value.stopRequestId!==seal.stopRequestId||value.databaseHash!==seal.databaseHash||value.databaseBytes!==seal.databaseBytes||value.manifestHash!==source.manifestHash)throw new Error('Recibo pertence a outra execução/exportação/bytes.')
    return value
  }
  private async transmit(source:HaReturnSource,request:z.infer<typeof haReturnSendRequest>,current:()=>Promise<void>,exchange:(operation:Operation)=>Promise<z.infer<typeof haReturnProgress>>,expectedOffset:number|null){
    await current();await ancestry(dirname(source.databaseFile));const initial=await lstat(source.databaseFile)
    if(!initial.isFile()||initial.isSymbolicLink()||initial.nlink!==1||initial.size!==source.seal.databaseBytes||existsSync(source.databaseFile+'-wal')||existsSync(source.databaseFile+'-shm'))throw new Error('Exportação não está fechada/selada.')
    const file=await open(source.databaseFile,'r')
    try{
      const check=async()=>{await current();if(!same(initial,await file.stat())||!same(initial,await lstat(source.databaseFile)))throw new Error('Exportação mudou durante envio.')}
      await check();const buffer=Buffer.alloc(HA_RETURN_CHUNK_BYTES),digest=createHash('sha256');let offset=0
      while(offset<initial.size){await check();const read=await file.read(buffer,0,Math.min(buffer.length,initial.size-offset),offset);if(!read.bytesRead)throw new Error('Exportação truncada.');digest.update(buffer.subarray(0,read.bytesRead));offset+=read.bytesRead}
      if(digest.digest('hex')!==source.seal.databaseHash)throw new Error('SHA atual da exportação diverge do selo.')
      await check()
      const started=await exchange(expectedOffset===null?{version:1,transferId:request.requestId,operation:'BEGIN',seal:source.seal,manifestHash:source.manifestHash}:{version:1,transferId:request.requestId,operation:'STATUS'})
      if(started.phase!=='RECEIVING'||started.offset!==(expectedOffset??0))throw new Error('Offset/estado mudou; não reiniciar ou retomar implicitamente.')
      offset=started.offset
      while(offset<initial.size){await check();const read=await file.read(buffer,0,Math.min(buffer.length,initial.size-offset),offset);if(!read.bytesRead)throw new Error('Exportação truncada.');const receipt=await exchange({version:1,transferId:request.requestId,operation:'WRITE',offset,data:buffer.subarray(0,read.bytesRead).toString('base64')});if(receipt.phase!=='RECEIVING'||receipt.offset!==offset+read.bytesRead)throw new Error('Principal não confirmou exatamente o bloco enviado.');offset=receipt.offset}
      await check();const receipt=await exchange({version:1,transferId:request.requestId,operation:'VERIFY'})
      await check();await ancestry(dirname(source.databaseFile));if(receipt.phase!=='RECEIVED_QUARANTINE')throw new Error('Principal não confirmou SHA completo.')
      return receipt
    }finally{await file.close()}
  }
  async send(raw:unknown,authorize:()=>void,actor:string){
    const request=haReturnSendRequest.parse(raw);authorize();if(this.closed)throw new Error('Envio encerrando.')
    if(this.db.prepare('SELECT 1 FROM ha_return_sent WHERE request_id=?').get(request.requestId)){const saved=this.read(request.requestId,request.channelId);if(JSON.stringify(saved.request)!==JSON.stringify(request))throw new Error('UUID pertence a outra intenção.');return this.query(request.requestId,request.channelId)}
    const source=await this.source(request,authorize);await source.current();authorize();if(this.closed)throw new Error('Envio encerrando.')
    let value:Ledger={version:1,request,owner:this.owner,actor:z.string().min(1).max(256).parse(actor),phase:'ACCEPTED',counter:0,updatedAt:new Date().toISOString(),receipt:null}
    this.db.prepare('INSERT INTO ha_return_sent VALUES(?,?,?,?)').run(request.requestId,request.exportId,request.channelId,installationVault(false).encrypt(JSON.stringify(value),this.key(request.requestId)))
    this.active.add(request.requestId)
    const current=async()=>{authorize();if(this.closed||this.read(request.requestId,request.channelId).owner!==this.owner)throw new Error('Envio perdeu instância/posse.');await source.current();authorize();if(this.closed)throw new Error('Envio encerrando.')}
    let attempted=false
    const exchange=async(operation:Operation)=>{await this.pacer.reserve(returnWireCost(operation));await current();value=this.store({...value,phase:'SENDING',counter:value.counter+1});attempted=true;const receipt=this.correlate(source,request,await this.exchange(operation,value.counter));await current();value=this.store({...value,receipt});return receipt}
    const work=(async()=>{
      try{
        const receipt=await this.transmit(source,request,current,exchange,null)
        value=this.store({...value,phase:'RECEIVED_QUARANTINE',receipt})
      }catch{value=this.store({...value,phase:attempted?'UNCERTAIN':'FAILED'})}
      return this.query(request.requestId,request.channelId)
    })()
    this.pending.add(work);void work.finally(()=>{this.pending.delete(work);this.active.delete(request.requestId)}).catch(()=>{});return work
  }
  async inspect(id:string,channelId:string,authorize:()=>void){
    authorize();let value=this.read(id,channelId)
    if(this.closed||this.active.has(id)||value.owner!==this.owner)throw new Error('Envio ativo/de outra instância; consulta remota indisponível sem adoção.')
    if(value.phase==='RECEIVED_QUARANTINE')return this.query(id,channelId)
    const source=await this.source(value.request,authorize);await source.current();authorize()
    if(this.closed||this.active.has(id)||JSON.stringify(this.read(id,channelId))!==JSON.stringify(value))throw new Error('Envio mudou durante conferência.')
    this.active.add(id)
    const work=(async()=>{
      try{const operation:Operation={version:1,transferId:id,operation:'STATUS'};await this.pacer.reserve(returnWireCost(operation));await source.current();authorize();if(this.closed)throw new Error();value=this.store({...value,counter:value.counter+1});const receipt=this.correlate(source,value.request,await this.exchange(operation,value.counter));await source.current();authorize();if(this.closed)throw new Error();value=this.store({...value,receipt,phase:receipt.phase==='RECEIVED_QUARANTINE'?'RECEIVED_QUARANTINE':'UNCERTAIN'})}
      finally{this.active.delete(id)}
      return this.query(id,channelId)
    })()
    this.pending.add(work);void work.finally(()=>this.pending.delete(work)).catch(()=>{});return work
  }
  resumeQuery(resumeId:string,channelId:string){
    const row=this.db.prepare('SELECT * FROM ha_return_resumes WHERE resume_id=? AND channel_id=?').get(z.string().uuid().parse(resumeId),z.string().min(1).max(128).parse(channelId)) as {resume_id:string;request_id:string;channel_id:string;report:string}|undefined
    if(!row)throw new Error('Retomada não registrada neste canal.')
    const value=resumeLedger.parse(JSON.parse(installationVault(false).decrypt(row.report,'ha-return-resume:v1:'+this.context+':'+resumeId)))
    if(value.request.resumeId!==row.resume_id||value.request.requestId!==row.request_id||value.request.channelId!==row.channel_id)throw new Error('Diário de retomada diverge do pedido.')
    return {resume:value,transfer:this.query(row.request_id,channelId)}
  }
  async resume(raw:unknown,authorize:()=>void,actor:string){
    const request=haReturnResumeRequest.parse(raw);authorize();if(this.closed)throw new Error('Retomada encerrando.')
    if(this.db.prepare('SELECT 1 FROM ha_return_resumes WHERE resume_id=?').get(request.resumeId)){
      const result=this.resumeQuery(request.resumeId,request.channelId);if(JSON.stringify(result.resume.request)!==JSON.stringify(request))throw new Error('UUID de retomada pertence a outra intenção.');return result
    }
    let value=this.read(request.requestId,request.channelId)
    const review=this.query(request.requestId,request.channelId)
    if(!review.canResume||review.reviewToken!==request.reviewToken||value.receipt?.offset!==request.expectedOffset)throw new Error('Retomada exige conferência da cópia parcial própria.')
    const source=await this.source(value.request,authorize);await source.current();authorize()
    if(this.closed||this.active.has(request.requestId)||JSON.stringify(this.read(request.requestId,request.channelId))!==JSON.stringify(value))throw new Error('Envio mudou durante conferência de retomada.')
    let resumed:z.infer<typeof resumeLedger>={version:1,request,actor:z.string().min(1).max(256).parse(actor),phase:'ACCEPTED',updatedAt:new Date().toISOString(),restartsFromZero:false}
    this.db.prepare('INSERT INTO ha_return_resumes VALUES(?,?,?,?)').run(request.resumeId,request.requestId,request.channelId,installationVault(false).encrypt(JSON.stringify(resumed),'ha-return-resume:v1:'+this.context+':'+request.resumeId))
    const storeResume=(phase:z.infer<typeof resumeLedger>['phase'])=>{resumed=resumeLedger.parse({...resumed,phase,updatedAt:new Date().toISOString()});if(this.db.prepare('UPDATE ha_return_resumes SET report=? WHERE resume_id=?').run(installationVault(false).encrypt(JSON.stringify(resumed),'ha-return-resume:v1:'+this.context+':'+request.resumeId),request.resumeId).changes!==1)throw new Error('Diário de retomada perdeu pedido.')}
    this.active.add(request.requestId)
    const current=async()=>{authorize();if(this.closed||this.read(request.requestId,request.channelId).owner!==this.owner)throw new Error('Retomada perdeu instância/posse.');await source.current();authorize();if(this.closed)throw new Error('Retomada encerrando.')}
    const exchange=async(operation:Operation)=>{await this.pacer.reserve(returnWireCost(operation));await current();value=this.store({...value,phase:'SENDING',counter:value.counter+1});storeResume('SENDING');const receipt=this.correlate(source,value.request,await this.exchange(operation,value.counter));await current();value=this.store({...value,receipt});return receipt}
    const work=(async()=>{
      try{const receipt=await this.transmit(source,value.request,current,exchange,request.expectedOffset);value=this.store({...value,phase:'RECEIVED_QUARANTINE',receipt});storeResume('RECEIVED_QUARANTINE')}
      catch{value=this.store({...value,phase:'UNCERTAIN'});storeResume('UNCERTAIN')}
      finally{this.active.delete(request.requestId)}
      return this.resumeQuery(request.resumeId,request.channelId)
    })()
    this.pending.add(work);void work.finally(()=>this.pending.delete(work)).catch(()=>{});return work
  }
  close(){this.closed=true;this.pacer.close()}
  get running(){return this.pending.size>0}
  async settled(){await Promise.allSettled([...this.pending])}
}
