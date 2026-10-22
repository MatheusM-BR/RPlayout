import type Database from 'better-sqlite3'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { constants, setPriority } from 'node:os'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { mediaProcessEnvironment } from './media-process-environment.js'
import { FileVersionVerifier } from './file-version.js'
import {executionHostIdentity} from './execution-host.js'
import {cleanupMediaPartials,type PartialCleanup} from './media-partial-cleanup.js'
import {mediaJobDiagnostic,mediaJobNeedsOwnerConfirmation} from './media-job-diagnostic.js'
import {isRecoveryRehearsal} from './recovery-rehearsal.js'
import {PROXY_RECIPE} from '../db/proxy-recipe.js'

interface Job { id: string; version_id: string; kind: 'ARCHIVE' | 'PROXY'; metadata: string; content_hash: string; archive_path: string | null; attempts: number }
interface Version { id: string; revision: number; content_hash: string; metadata: string; archive_path: string | null; created_at: string }
interface VisibleJob {id:string;asset_id:string;revision:number;kind:string;state:string;attempts:number;error:string|null;created_at:string;updated_at:string}
const archiveUnavailable = 'Versão indisponível: corrija e reexecute a cópia antes do proxy.'

/** One worker per server. Master transmission never waits for this queue. */
export class MediaWorkflow {
  private readonly owner={host:executionHostIdentity(),pid:process.pid,boot:randomUUID()}
  private drain:Promise<void>|null=null
  lastError:string|null=null
  cleanup:PartialCleanup|null=null
  private nextCleanup=0
  private active:Promise<void>|null=null
  private copyAbort:AbortController|null=null
  private closed = false
  private child: ChildProcess | null = null
  get isDraining():boolean { return this.active!==null }
  private readonly fileVersions = new FileVersionVerifier()
  constructor(private readonly sqlite: Database.Database, readonly root: string, private readonly proxyBinary: string) {
    this.recover()
  }
  private recover():void {
    this.sqlite.transaction(()=>{
      if(isRecoveryRehearsal(this.sqlite))return
      const rows=this.sqlite.prepare("SELECT id,owner_host,owner_pid,owner_boot FROM media_jobs WHERE state='RUNNING'").all() as {id:string;owner_host:string|null;owner_pid:number|null;owner_boot:string|null}[]
      for(const row of rows){
        if(!row.owner_host||!Number.isSafeInteger(row.owner_pid)||row.owner_pid!<1||!row.owner_boot){
          this.sqlite.prepare("UPDATE media_jobs SET state='FAILED',error='Trabalho sem responsável identificável; confira o encerramento anterior antes de tentar novamente.',updated_at=? WHERE id=? AND state='RUNNING'").run(new Date().toISOString(),row.id);continue
        }
        if(row.owner_host!==this.owner.host)continue
        let dead=false
        try{process.kill(row.owner_pid!,0)}catch(error){dead=(error as NodeJS.ErrnoException).code==='ESRCH'}
        // A live/reused PID, permissions failure or remote host is not death.
        if(dead)this.sqlite.prepare("UPDATE media_jobs SET state='PENDING',owner_host=NULL,owner_pid=NULL,owner_boot=NULL,updated_at=? WHERE id=? AND state='RUNNING' AND owner_boot=?").run(new Date().toISOString(),row.id,row.owner_boot)
      }
      this.sqlite.prepare("UPDATE media_jobs SET state='FAILED',error='Trabalho interrompido no limite de tentativas. Confira a versão e solicite nova tentativa.',updated_at=? WHERE state='PENDING' AND attempts>=3").run(new Date().toISOString())
    }).immediate()
  }
  private owns(id:string):boolean {
    return Boolean(this.sqlite.prepare("SELECT 1 FROM media_jobs WHERE id=? AND state='RUNNING' AND owner_host=? AND owner_pid=? AND owner_boot=?").get(id,this.owner.host,this.owner.pid,this.owner.boot))
  }
  private release():void {
    this.sqlite.prepare("UPDATE media_jobs SET state=CASE WHEN attempts>=3 THEN 'FAILED' ELSE 'PENDING' END,error=CASE WHEN attempts>=3 THEN 'Trabalho interrompido no limite de tentativas. Confira a versão e solicite nova tentativa.' ELSE NULL END,owner_host=NULL,owner_pid=NULL,owner_boot=NULL,updated_at=? WHERE state='RUNNING' AND owner_host=? AND owner_pid=? AND owner_boot=?").run(new Date().toISOString(),this.owner.host,this.owner.pid,this.owner.boot)
  }

  record(assetId: string, metadata: Record<string, unknown>): string | null {
    if(this.closed||isRecoveryRehearsal(this.sqlite))return null
    const hash = String(metadata.contentHash ?? '').toLowerCase()
    if (!/^[a-f0-9]{64}$/.test(hash) || metadata.kind !== 'VIDEO' || metadata.probeError || typeof metadata.path !== 'string' || !metadata.path.trim()) return null
    const id = this.sqlite.transaction(() => {
      const old = this.sqlite.prepare('SELECT id FROM media_versions WHERE asset_id=? AND content_hash=?').get(assetId, hash) as { id: string } | undefined
      if (old) return old.id
      const previous = this.sqlite.prepare('SELECT MAX(revision) AS revision FROM media_versions WHERE asset_id=?').get(assetId) as { revision: number | null }
      const id = randomUUID(), now = new Date().toISOString()
      this.sqlite.prepare('INSERT INTO media_versions (id,asset_id,revision,content_hash,metadata,created_at) VALUES (?,?,?,?,?,?)')
        .run(id, assetId, (previous.revision ?? 0) + 1, hash, JSON.stringify({...metadata,contentHash:hash}), now)
      for (const kind of ['ARCHIVE', 'PROXY']) this.sqlite.prepare('INSERT INTO media_jobs (id,version_id,kind,state,created_at,updated_at) VALUES (?,?,?,?,?,?)')
        .run(randomUUID(), id, kind, 'PENDING', now, now)
      return id
    })()
    void this.tick().catch(()=>{})
    return id
  }

  versions(assetId: string) {
    return (this.sqlite.prepare('SELECT id,revision,content_hash,metadata,archive_path,created_at FROM media_versions WHERE asset_id=? ORDER BY revision DESC').all(assetId) as Version[])
      .map(({ metadata, ...version }) => ({ ...version, metadata: JSON.parse(metadata), jobs: this.jobRows('WHERE j.version_id=?',[version.id]) }))
  }

  private jobRows(where='',parameters:string[]=[]){
    const rows=this.sqlite.prepare(`SELECT j.id,v.asset_id,v.revision,j.kind,j.state,j.attempts,j.error,j.created_at,j.updated_at,j.owner_host,j.owner_pid,j.owner_boot FROM media_jobs j JOIN media_versions v ON v.id=j.version_id ${where} ORDER BY j.created_at DESC LIMIT 200`).all(...parameters) as Array<VisibleJob&{owner_host:string|null;owner_pid:number|null;owner_boot:string|null}>
    return rows.map(row=>{const {owner_host,owner_pid,owner_boot,...visible}=row;return {...visible,...mediaJobDiagnostic(row)}})
  }
  jobs() { return this.jobRows() }

  retry(id: string,confirmedPreviousStopped=false,audit?:(details:{jobId:string;versionId:string;kind:string;previousAttempts:number;ownerConfirmationRequired:boolean;confirmedPreviousStopped:boolean})=>void): boolean {
    if(this.closed||isRecoveryRehearsal(this.sqlite))return false
    const changed=this.sqlite.transaction(()=>{
      const row=this.sqlite.prepare("SELECT error,version_id,kind,attempts FROM media_jobs WHERE id=? AND state='FAILED'").get(id) as {error:string|null;version_id:string;kind:string;attempts:number}|undefined
      if(!row||mediaJobNeedsOwnerConfirmation(row.error)&&!confirmedPreviousStopped)return false
      const accepted=this.sqlite.prepare("UPDATE media_jobs SET state='PENDING', error=NULL, attempts=0, updated_at=? WHERE id=? AND state='FAILED'").run(new Date().toISOString(),id).changes>0
      if(accepted)audit?.({jobId:id,versionId:row.version_id,kind:row.kind,previousAttempts:row.attempts,ownerConfirmationRequired:mediaJobNeedsOwnerConfirmation(row.error),confirmedPreviousStopped})
      return accepted
    }).immediate()
    if (changed) void this.tick().catch(()=>{})
    return changed
  }

  async preview(assetId: string, hash: string): Promise<string | null> {
    const row = this.sqlite.prepare("SELECT j.id,j.output_path,j.output_hash,j.proxy_recipe FROM media_jobs j JOIN media_versions v ON v.id=j.version_id WHERE v.asset_id=? AND v.content_hash=? AND j.kind='PROXY' AND j.state='READY'").get(assetId, hash) as {id:string;output_path:string;output_hash:string|null;proxy_recipe:string|null} | undefined
    if (!row) return null
    if(row.proxy_recipe!==PROXY_RECIPE){
      if(!isRecoveryRehearsal(this.sqlite))this.sqlite.prepare("UPDATE media_jobs SET state='FAILED',error='Proxy de receita anterior. Reexecute para preservar a proporção da imagem; original e versão foram conservados.',updated_at=? WHERE id=? AND state='READY' AND proxy_recipe IS ? AND output_path IS ? AND output_hash IS ?").run(new Date().toISOString(),row.id,row.proxy_recipe,row.output_path,row.output_hash)
      return null
    }
    try {if(row.output_hash&&await this.fileVersions.matches(row.output_path,row.output_hash))return row.output_path}catch{}
    // Compare the observed identity so a concurrent regeneration is not failed
    // by a reader which checked the previous edition of this output.
    if(!isRecoveryRehearsal(this.sqlite))this.sqlite.prepare("UPDATE media_jobs SET state='FAILED',error='Proxy ausente, alterado ou sem identidade. Reexecute para regenerar o cache.',updated_at=? WHERE id=? AND state='READY' AND output_path IS ? AND output_hash IS ?")
      .run(new Date().toISOString(),row.id,row.output_path,row.output_hash)
    return null
  }

  async archived(assetId: string, hash: string): Promise<string | null> {
    const row = this.sqlite.prepare("SELECT v.archive_path FROM media_versions v JOIN media_jobs j ON j.version_id=v.id WHERE v.asset_id=? AND v.content_hash=? AND j.kind='ARCHIVE' AND j.state='READY'").get(assetId, hash) as { archive_path: string } | undefined
    if (!row?.archive_path) return null
    try {
      return await this.fileVersions.matches(row.archive_path, hash) ? row.archive_path : null
    } catch { return null }
  }

  /** Approval inspection prefers the immutable archived edition. Unversioned
   * legacy originals are usable only if their actual bytes still match the
   * selected SHA; a pathname and the last scan are not version evidence. */
  async inspectionOriginal(assetId:string,hash:string,path:string):Promise<string|null>{
    const archived=await this.archived(assetId,hash)
    if(archived)return archived
    try{
      return await this.fileVersions.matches(path,hash) ? path : null
    }catch{return null}
  }

  tick(): Promise<void> {
    if(this.active)return this.active
    if(this.closed||isRecoveryRehearsal(this.sqlite))return Promise.resolve()
    this.active=this.work().finally(()=>{this.active=null})
    return this.active
  }

  private async work():Promise<void>{
    try {
      if(isRecoveryRehearsal(this.sqlite))return
      await mkdir(this.root, { recursive: true })
      this.recover()
      if(Date.now()>=this.nextCleanup){
        this.nextCleanup=Date.now()+60*60_000
        try{this.cleanup=await cleanupMediaPartials(this.sqlite,this.root,Date.now(),this.cleanup?.cursor)}catch(error){this.lastError=error instanceof Error?error.message:String(error)}
      }
      while (!this.closed) {
        const job = this.sqlite.transaction(()=>{
          if(isRecoveryRehearsal(this.sqlite))return undefined
          const selected=this.sqlite.prepare(`SELECT j.id,j.version_id,j.kind,j.attempts,v.metadata,v.content_hash,v.archive_path
          FROM media_jobs j JOIN media_versions v ON v.id=j.version_id WHERE j.state='PENDING' AND j.attempts<3
          AND (j.kind='ARCHIVE' OR EXISTS(SELECT 1 FROM media_jobs a WHERE a.version_id=j.version_id AND a.kind='ARCHIVE' AND a.state='READY'))
          ORDER BY j.created_at,j.kind LIMIT 1`).get() as Job | undefined
          if(!selected)return undefined
          const claimed=this.sqlite.prepare("UPDATE media_jobs SET state='RUNNING',attempts=attempts+1,owner_host=?,owner_pid=?,owner_boot=?,updated_at=? WHERE id=? AND state='PENDING'").run(this.owner.host,this.owner.pid,this.owner.boot,new Date().toISOString(),selected.id).changes
          return claimed?selected:undefined
        }).immediate()
        if (!job) break
        let temporary:string|null=null
        try {
          const metadata = JSON.parse(job.metadata) as { path: string }
          if(typeof metadata?.path!=='string'||!metadata.path.trim())throw new Error('Metadados da versão sem caminho válido. Faça nova ingestão.')
          const extension = /^\.[a-z0-9]{1,10}$/i.test(extname(metadata.path)) ? extname(metadata.path) : '.media'
          const destination = join(this.root, `${job.content_hash}${job.kind === 'ARCHIVE' ? extension : '.proxy.mp4'}`)
          // A predecessor may still be unwinding after parent-pipe loss. Never
          // share its writable pathname with a resumed attempt of the same job.
          temporary = `${destination}.${job.id}.${randomUUID()}.part`
          if (job.kind === 'ARCHIVE') {
            const hash = createHash('sha256')
            this.copyAbort=new AbortController()
            await pipeline(createReadStream(metadata.path), new Transform({ transform(chunk, _encoding, done) { hash.update(chunk); done(null, chunk) } }), createWriteStream(temporary),{signal:this.copyAbort.signal})
            if (hash.digest('hex') !== job.content_hash.toLowerCase()) throw new Error('O arquivo mudou durante a ingestão. Faça nova varredura; esta versão não será substituída.')
          } else {
            if (!this.proxyBinary) throw new Error('Gerador de proxy não disponível no pacote. Use o pacote completo com rplayout-proxy.')
            if (!job.archive_path) throw new Error('Cópia da versão ainda não está disponível.')
            if(!await this.fileVersions.matches(job.archive_path,job.content_hash))throw new Error('Cópia da versão alterada; proxy bloqueado. Restaure a versão antes de tentar novamente.')
            await this.transcode(job.archive_path, temporary)
            if(!await this.fileVersions.matches(job.archive_path,job.content_hash))throw new Error('Cópia da versão mudou durante a geração; proxy descartado.')
            const output=await stat(temporary)
            if(!output.isFile()||output.size===0)throw new Error('Gerador de proxy não produziu arquivo válido.')
          }
          if (this.closed) throw new Error('Servidor encerrando; trabalho será retomado.')
          let outputHash:string|null=null
          if(job.kind==='PROXY'){
            const digest=createHash('sha256')
            for await(const chunk of createReadStream(temporary))digest.update(chunk)
            outputHash=digest.digest('hex')
            if(!await this.fileVersions.matches(temporary,outputHash))throw new Error('Proxy mudou durante a conferência; saída descartada.')
          }
          if(this.closed)throw new Error('Servidor encerrando; trabalho será retomado.')
          if(!this.owns(job.id))throw new Error('Responsável pelo trabalho mudou; saída não será disponibilizada.')
          await rename(temporary, destination)
          if(this.closed)throw new Error('Servidor encerrando; trabalho será retomado.')
          this.sqlite.transaction(() => {
            if(!this.owns(job.id))throw new Error('Responsável pelo trabalho mudou; resultado descartado.')
            if (job.kind === 'ARCHIVE') {
              this.sqlite.prepare('UPDATE media_versions SET archive_path=? WHERE id=?').run(destination, job.version_id)
              // Resume only dependents failed because this archive was missing;
              // preserve independent proxy errors and their manual retry policy.
              this.sqlite.prepare("UPDATE media_jobs SET state='PENDING',error=NULL,updated_at=? WHERE version_id=? AND kind='PROXY' AND state='FAILED' AND error=? AND attempts<3").run(new Date().toISOString(),job.version_id,archiveUnavailable)
            }
            this.sqlite.prepare("UPDATE media_jobs SET state='READY',output_path=?,output_hash=?,proxy_recipe=?,error=NULL,updated_at=? WHERE id=?").run(destination,outputHash,job.kind==='PROXY'?PROXY_RECIPE:null, new Date().toISOString(), job.id)
          }).immediate()
        } catch (error) {
          if (!this.closed) {
            const failed=this.sqlite.prepare("UPDATE media_jobs SET state='FAILED',error=?,updated_at=? WHERE id=? AND state='RUNNING' AND owner_host=? AND owner_pid=? AND owner_boot=?").run(error instanceof Error ? error.message : String(error), new Date().toISOString(), job.id,this.owner.host,this.owner.pid,this.owner.boot).changes
            if (failed&&job.kind === 'ARCHIVE') this.sqlite.prepare("UPDATE media_jobs SET state='FAILED',error=?,updated_at=? WHERE version_id=? AND kind='PROXY' AND state='PENDING'").run(archiveUnavailable,new Date().toISOString(), job.version_id)
          }
        } finally { this.copyAbort=null;if(temporary)await rm(temporary, { force: true }).catch(() => {}) }
      }
    } catch (error) {
      if (!this.closed)this.lastError=error instanceof Error?error.message:String(error)
    }
  }

  private transcode(source: string, target: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.proxyBinary, [source, target, '--parent-pipe'], { windowsHide: true, env: mediaProcessEnvironment(),stdio:['pipe','pipe','pipe'] })
      this.child = child
      try { if (child.pid) setPriority(child.pid, constants.priority.PRIORITY_LOW) } catch {}
      let output = '', error = ''
      const timeout = setTimeout(() => child.kill(), 16 * 60_000)
      child.stdout.on('data', chunk => { output = (output + chunk.toString()).slice(-4096) })
      child.stderr.on('data', chunk => { error = (error + chunk.toString()).slice(-4096) })
      child.once('error', reject)
      child.once('close', code => {
        clearTimeout(timeout); this.child = null
        if (code !== 0) reject(new Error(output || error || `Gerador de proxy encerrou com código ${code}.`))
        else {
          try{const receipt=JSON.parse(output.trim().split(/\r?\n/).at(-1)??'');if(receipt.ok!==true||receipt.recipe!==PROXY_RECIPE)throw new Error('receipt');resolve()}
          catch{reject(new Error('Gerador de proxy não confirmou a receita de imagem atual. Atualize o pacote completo; cache não foi aprovado.'))}
        }
      })
    })
  }

  close(): Promise<void> {
    if(this.drain)return this.drain
    this.closed=true
    this.copyAbort?.abort()
    this.child?.kill()
    if(!this.active){this.release();return this.drain=Promise.resolve()}
    return this.drain=this.active.finally(()=>this.release())
  }
}
