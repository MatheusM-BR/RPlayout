import type Database from 'better-sqlite3'
import {createHash,randomUUID} from 'node:crypto'
import {mkdir,lstat,open,link,unlink} from 'node:fs/promises'
import {hostname} from 'node:os'
import {join,resolve} from 'node:path'
import {z} from 'zod'
import type {HaSnapshot} from './ha-replication.js'

export const HA_CHUNK_BYTES=256*1024
export const haMediaOperation=z.object({version:z.literal(1),operation:z.enum(['STATUS','WRITE','VERIFY']),hash:z.string().regex(/^[a-f0-9]{64}$/),size:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),offset:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),data:z.string().max(Math.ceil(HA_CHUNK_BYTES*4/3)+4).optional()}).strict()
export type HaMediaOperation=z.infer<typeof haMediaOperation>
export interface HaMediaProgress {hash:string;size:number;offset:number;ready:boolean}
type Row={hash:string;size:number;offset:number;state:'PARTIAL'|'READY'|'FAILED';temporary:string;device:string;inode:string}
export type HaMediaAsset={id:string;contentHash:string;path:string}

/** Only assets required by current/future published execution are copied.
 * Historical as-run media and editorial/library drafts are not implicitly
 * transferred. Paths on the other machine are never used by the receiver. */
export function haRequiredMedia(snapshot:HaSnapshot){
  const assets=new Map<string,HaMediaAsset>()
  for(const channel of snapshot.channels){
    const saved=(channel.checkpoint as any)?.value,ids=new Set([saved?.revisionId,saved?.contingency?.revisionId,saved?.contingency?.loopRevisionId,channel.configuration.executionRevisionId].filter(value=>typeof value==='string'))
    for(const revision of channel.revisions)if(revision.active===true||typeof revision.id==='string'&&ids.has(revision.id)){
      for(const asset of (revision.payload as any)?.assets??[])if(['VIDEO','AUDIO','STILL'].includes(asset.kind)&&typeof asset.id==='string'&&typeof asset.path==='string'&&/^[a-f0-9]{64}$/i.test(asset.contentHash))assets.set(asset.contentHash.toLowerCase(),{id:asset.id,contentHash:asset.contentHash.toLowerCase(),path:asset.path})
    }
  }
  return assets
}

/** Durable offsets refer only to files created in this private media root.
 * No arbitrary remote path, overwrite of a user file or unverified READY. */
export class HaMediaStore {
  private readonly root:string
  private required=new Map<string,HaMediaAsset>()
  private serial:Promise<unknown>=Promise.resolve()
  private checked=new Map<string,string>()
  private closed=false
  private pending=0
  private readonly owner=JSON.stringify({host:hostname(),pid:process.pid,boot:randomUUID()})
  constructor(private readonly db:Database.Database,root:string,private readonly quota:number){
    if(!Number.isSafeInteger(quota)||quota<=0)throw new Error('Quota HA inválida.')
    this.root=resolve(root)
    db.exec(`CREATE TABLE IF NOT EXISTS ha_media(hash TEXT PRIMARY KEY,size INTEGER NOT NULL,offset INTEGER NOT NULL,state TEXT NOT NULL,temporary TEXT NOT NULL,device TEXT NOT NULL,inode TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ha_media_root(id INTEGER PRIMARY KEY CHECK(id=1),root TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ha_media_owner(id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT NOT NULL);`)
    db.transaction(()=>{
      const previous=db.prepare('SELECT root FROM ha_media_root WHERE id=1').get() as {root:string}|undefined
      if(previous&&previous.root!==this.root)throw new Error('Este banco HA está vinculado a outra pasta de mídia; cópias preservadas.')
      const occupied=db.prepare('SELECT owner FROM ha_media_owner WHERE id=1').get() as {owner:string}|undefined
      if(occupied){const old=JSON.parse(occupied.owner);let gone=false
        if(old.host===hostname()&&Number.isSafeInteger(old.pid))try{process.kill(old.pid,0)}catch(error){gone=(error as NodeJS.ErrnoException).code==='ESRCH'}
        if(!gone)throw new Error('Outro receptor de mídia HA está vivo ou sua posse é desconhecida.')
      }
      if(!previous)db.prepare('INSERT INTO ha_media_root VALUES(1,?)').run(this.root)
      db.prepare('INSERT INTO ha_media_owner VALUES(1,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner').run(this.owner)
    }).immediate()
  }
  manifest(snapshot:HaSnapshot){this.required=haRequiredMedia(snapshot)}
  status(){
    const ready=(this.db.prepare("SELECT hash FROM ha_media WHERE state='READY'").all() as {hash:string}[]).filter(row=>this.required.has(row.hash)).length
    const bytes=(this.db.prepare('SELECT coalesce(sum(size),0) bytes FROM ha_media').get() as {bytes:number}).bytes
    return {enabled:true,required:this.required.size,verified:ready,bytesReserved:bytes,quotaBytes:this.quota,ready:false,note:'Contagem de cópias verificadas no recebimento; promoção deve revalidar SHA/QC. Não autoriza PGM.'}
  }
  close(){this.closed=true}
  get running(){return this.pending>0}
  release(){this.db.prepare('DELETE FROM ha_media_owner WHERE id=1 AND owner=?').run(this.owner)}
  private assertCurrent(hash:string){
    const owner=this.db.prepare('SELECT owner FROM ha_media_owner WHERE id=1').get() as {owner:string}|undefined
    if(this.closed||!this.required.has(hash)||owner?.owner!==this.owner)throw new Error('Reserva encerrando, mídia removida da edição ou posse do receptor mudou.')
  }
  private quotaFor(size:number){const used=(this.db.prepare('SELECT coalesce(sum(size),0) bytes FROM ha_media').get() as {bytes:number}).bytes
    if(size>this.quota-used)throw new Error('Quota de mídia HA insuficiente. A cópia foi recusada; originais preservados.')
  }
  private row(hash:string){return this.db.prepare('SELECT * FROM ha_media WHERE hash=?').get(hash) as Row|undefined}
  private async ensureRoot(){await mkdir(this.root,{recursive:true,mode:0o700});const root=await lstat(this.root);if(!root.isDirectory()||root.isSymbolicLink())throw new Error('Pasta de mídia HA inválida; não será usada.')}
  private final(hash:string){return join(this.root,`${hash}.media`)}
  private partial(row:Row){if(!/^[a-f0-9]{64}\.[a-f0-9-]{36}\.part$/.test(row.temporary)||!row.temporary.startsWith(row.hash+'.'))throw new Error('Registro de cópia HA inválido.');return join(this.root,row.temporary)}
  private async matches(path:string,hash:string,size:number){
    let handle
    try{
      const entry=await lstat(path);if(!entry.isFile()||entry.isSymbolicLink()||entry.size!==size)return false
      handle=await open(path,'r');const before=await handle.stat({bigint:true}),signature=[before.dev,before.ino,before.size,before.mtimeNs,before.ctimeNs].join(':')
      if(this.checked.get(hash)===signature)return true
      const digest=createHash('sha256');for await(const chunk of handle.createReadStream({autoClose:false}))digest.update(chunk)
      const after=await handle.stat({bigint:true})
      if([after.dev,after.ino,after.size,after.mtimeNs,after.ctimeNs].join(':')!==signature||digest.digest('hex')!==hash)return false
      this.checked.set(hash,signature);return true
    }catch{return false}finally{await handle?.close()}
  }
  /** Caller must await settlement before closing the SQLite mirror. */
  receive(value:unknown):Promise<HaMediaProgress>{
    this.pending++
    const result=this.serial.then(()=>this.receiveNow(haMediaOperation.parse(value)))
    this.serial=result.catch(()=>{}).finally(()=>{this.pending--});return result
  }
  async settled(){await this.serial}
  /** Read-only recovery check, not a STATUS receive: never creates a partial,
   * promotes an unregistered file or rewrites an offset. Returns only our
   * managed pathname after checking the current manifest and content again. */
  async recoveryPath(hash:string):Promise<string|null>{
    if(!/^[a-f0-9]{64}$/.test(hash))return null
    this.assertCurrent(hash)
    const row=this.row(hash)
    if(!row||row.state!=='READY'||row.offset!==row.size)return null
    this.checked.delete(hash)
    if(!await this.matches(this.final(hash),hash,row.size))return null
    this.assertCurrent(hash)
    return this.final(hash)
  }
  private async receiveNow(operation:HaMediaOperation):Promise<HaMediaProgress>{
    if(this.closed||!this.required.has(operation.hash))throw new Error('Mídia não pertence à edição espelhada atual.')
    await this.ensureRoot()
    let row=this.row(operation.hash)
    if(row&&row.size!==operation.size)throw new Error('Tamanho de mídia HA mudou; a cópia anterior foi preservada.')
    if(await this.matches(this.final(operation.hash),operation.hash,operation.size)){
      this.assertCurrent(operation.hash);if(!row)this.quotaFor(operation.size)
      this.db.prepare("INSERT INTO ha_media VALUES(?,?,?,'READY','','','') ON CONFLICT(hash) DO UPDATE SET offset=excluded.offset,state='READY'").run(operation.hash,operation.size,operation.size)
      if(row?.temporary)await this.removeOwnedPartial(row)
      return {hash:operation.hash,size:operation.size,offset:operation.size,ready:true}
    }
    if(row?.state==='READY')throw new Error('Cópia HA foi alterada/removida. Nenhum arquivo existente será sobrescrito.')
    if(!row){
      this.assertCurrent(operation.hash);this.quotaFor(operation.size)
      const temporary=`${operation.hash}.${randomUUID()}.part`,handle=await open(join(this.root,temporary),'wx',0o600)
      try{const info=await handle.stat({bigint:true});await handle.sync();this.assertCurrent(operation.hash)
        this.db.prepare("INSERT INTO ha_media VALUES(?,?,0,'PARTIAL',?,?,?)").run(operation.hash,operation.size,temporary,String(info.dev),String(info.ino))
      }finally{await handle.close()}
      row=this.row(operation.hash)!
    }
    if(row.state==='FAILED')throw new Error('Cópia HA reprovada por SHA. O parcial foi preservado para diagnóstico; não está pronto.')
    const path=this.partial(row),entry=await lstat(path)
    if(!entry.isFile()||entry.isSymbolicLink())throw new Error('Parcial HA inválido; não será modificado.')
    const handle=await open(path,'r+')
    try{
      const info=await handle.stat({bigint:true})
      if(String(info.dev)!==row.device||String(info.ino)!==row.inode||info.nlink!==1n||info.size<BigInt(row.offset))throw new Error('Parcial HA foi substituído ou ligado a outro arquivo; escrita recusada.')
      // Crash between fsync and offset commit: discard only the uncommitted
      // tail of our inode, not a remote/user pathname or committed bytes.
      this.assertCurrent(operation.hash)
      if(info.size>BigInt(row.offset)){await handle.truncate(row.offset);await handle.sync()}
      if(operation.operation==='WRITE'){
        if(operation.offset===undefined||!operation.data||!(/^[A-Za-z0-9+/]*={0,2}$/.test(operation.data))||operation.data.length%4!==0)throw new Error('Bloco HA inválido.')
        const bytes=Buffer.from(operation.data,'base64')
        if(bytes.length===0||bytes.length>HA_CHUNK_BYTES||operation.offset+bytes.length>row.size)throw new Error('Bloco HA fora do tamanho permitido.')
        if(operation.offset<row.offset){
          if(operation.offset+bytes.length>row.offset)throw new Error('Bloco HA sobrepõe offset confirmado.')
          const previous=Buffer.alloc(bytes.length);const read=await handle.read(previous,0,previous.length,operation.offset)
          if(read.bytesRead!==bytes.length||!bytes.equals(previous))throw new Error('Bloco HA repetido com outro conteúdo.')
        }else{
          if(operation.offset!==row.offset)throw new Error('Bloco HA fora de ordem.')
          let written=0;while(written<bytes.length){const result=await handle.write(bytes,written,bytes.length-written,row.offset+written);if(!result.bytesWritten)throw new Error('Disco HA não confirmou escrita.');written+=result.bytesWritten}
          await handle.sync();this.assertCurrent(operation.hash)
          row.offset+=bytes.length;this.db.prepare('UPDATE ha_media SET offset=? WHERE hash=?').run(row.offset,row.hash)
        }
      }
    }finally{await handle.close()}
    if(operation.operation==='VERIFY'){
      if(row.offset!==row.size)throw new Error('Cópia HA ainda incompleta.')
      if(!await this.matches(path,row.hash,row.size)){this.assertCurrent(row.hash);this.db.prepare("UPDATE ha_media SET state='FAILED' WHERE hash=?").run(row.hash);throw new Error('SHA da cópia HA não confere; arquivo parcial não será publicado.')}
      this.assertCurrent(row.hash)
      // Exclusive link publishes our already fsynced inode, without overwriting
      // another file or needing a second full-size copy beyond the quota.
      try{await link(path,this.final(row.hash))}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error}
      if(!await this.matches(this.final(row.hash),row.hash,row.size))throw new Error('Destino HA existente não confere. Ele foi preservado, sem sobrescrita.')
      this.assertCurrent(row.hash)
      this.db.prepare("UPDATE ha_media SET state='READY' WHERE hash=?").run(row.hash)
      await this.removeOwnedPartial(row)
      return {hash:row.hash,size:row.size,offset:row.size,ready:true}
    }
    return {hash:row.hash,size:row.size,offset:row.offset,ready:false}
  }
  private async removeOwnedPartial(row:Row){
    const path=this.partial(row)
    try{const current=await lstat(path,{bigint:true}),final=await lstat(this.final(row.hash),{bigint:true})
      if(current.isFile()&&!current.isSymbolicLink()&&String(current.dev)===row.device&&String(current.ino)===row.inode&&current.dev===final.dev&&current.ino===final.ino)await unlink(path)
    }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
  }
}

/** A verified open handle prevents path replacement between hashing and read.
 * Source originals are read-only; every chunk rechecks the actual inode. */
export async function openHaMediaSource(path:string,hash:string,cache:Map<string,string>,signal:AbortSignal){
  const handle=await open(path,'r')
  try{
    const before=await handle.stat({bigint:true}),signature=[before.dev,before.ino,before.size,before.mtimeNs,before.ctimeNs].join(':')
    if(!before.isFile()||before.size<=0n||before.size>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Origem HA inválida.')
    if(cache.get(hash)!==signature){
      const digest=createHash('sha256')
      for await(const chunk of handle.createReadStream({autoClose:false})){signal.throwIfAborted();digest.update(chunk)}
      if(digest.digest('hex')!==hash)throw new Error('Origem HA mudou de conteúdo; edição congelada não será substituída.')
      cache.set(hash,signature)
    }
    const unchanged=async()=>{signal.throwIfAborted();const now=await handle.stat({bigint:true});if([now.dev,now.ino,now.size,now.mtimeNs,now.ctimeNs].join(':')!==signature)throw new Error('Origem HA mudou durante a cópia.')}
    await unchanged()
    return {size:Number(before.size),close:()=>handle.close(),read:async(offset:number)=>{
      await unchanged();if(!Number.isSafeInteger(offset)||offset<0||offset>=Number(before.size))throw new Error('Offset de origem HA inválido.')
      const bytes=Buffer.alloc(Math.min(HA_CHUNK_BYTES,Number(before.size)-offset));let read=0
      while(read<bytes.length){const result=await handle.read(bytes,read,bytes.length-read,offset+read);if(!result.bytesRead)throw new Error('Origem HA terminou antes do tamanho confirmado.');read+=result.bytesRead}
      await unchanged();return bytes
    }}
  }catch(error){await handle.close();throw error}
}
