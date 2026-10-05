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

interface Job { id: string; version_id: string; kind: 'ARCHIVE' | 'PROXY'; metadata: string; content_hash: string; archive_path: string | null; attempts: number }
interface Version { id: string; revision: number; content_hash: string; metadata: string; archive_path: string | null; created_at: string }

/** One worker per server. Master transmission never waits for this queue. */
export class MediaWorkflow {
  private running = false
  private closed = false
  private child: ChildProcess | null = null
  private readonly fileVersions = new FileVersionVerifier()
  constructor(private readonly sqlite: Database.Database, readonly root: string, private readonly proxyBinary: string) {
    sqlite.prepare("UPDATE media_jobs SET state='PENDING', updated_at=? WHERE state='RUNNING'").run(new Date().toISOString())
  }

  record(assetId: string, metadata: Record<string, unknown>): string | null {
    const hash = String(metadata.contentHash ?? '')
    if (!/^[a-f0-9]{64}$/i.test(hash) || metadata.kind !== 'VIDEO' || metadata.probeError) return null
    const id = this.sqlite.transaction(() => {
      const old = this.sqlite.prepare('SELECT id FROM media_versions WHERE asset_id=? AND content_hash=?').get(assetId, hash) as { id: string } | undefined
      if (old) return old.id
      const previous = this.sqlite.prepare('SELECT MAX(revision) AS revision FROM media_versions WHERE asset_id=?').get(assetId) as { revision: number | null }
      const id = randomUUID(), now = new Date().toISOString()
      this.sqlite.prepare('INSERT INTO media_versions (id,asset_id,revision,content_hash,metadata,created_at) VALUES (?,?,?,?,?,?)')
        .run(id, assetId, (previous.revision ?? 0) + 1, hash, JSON.stringify(metadata), now)
      for (const kind of ['ARCHIVE', 'PROXY']) this.sqlite.prepare('INSERT INTO media_jobs (id,version_id,kind,state,created_at,updated_at) VALUES (?,?,?,?,?,?)')
        .run(randomUUID(), id, kind, 'PENDING', now, now)
      return id
    })()
    void this.tick()
    return id
  }

  versions(assetId: string) {
    return (this.sqlite.prepare('SELECT id,revision,content_hash,metadata,archive_path,created_at FROM media_versions WHERE asset_id=? ORDER BY revision DESC').all(assetId) as Version[])
      .map(({ metadata, ...version }) => ({ ...version, metadata: JSON.parse(metadata), jobs: this.sqlite.prepare('SELECT id,kind,state,attempts,error,updated_at FROM media_jobs WHERE version_id=?').all(version.id) }))
  }

  jobs() { return this.sqlite.prepare('SELECT j.id,v.asset_id,v.revision,j.kind,j.state,j.attempts,j.error,j.created_at,j.updated_at FROM media_jobs j JOIN media_versions v ON v.id=j.version_id ORDER BY j.created_at DESC LIMIT 200').all() }

  retry(id: string): boolean {
    const changed = this.sqlite.prepare("UPDATE media_jobs SET state='PENDING', error=NULL, attempts=0, updated_at=? WHERE id=? AND state='FAILED'").run(new Date().toISOString(), id).changes > 0
    if (changed) void this.tick()
    return changed
  }

  async preview(assetId: string, hash: string): Promise<string | null> {
    const row = this.sqlite.prepare("SELECT j.output_path FROM media_jobs j JOIN media_versions v ON v.id=j.version_id WHERE v.asset_id=? AND v.content_hash=? AND j.kind='PROXY' AND j.state='READY'").get(assetId, hash) as { output_path: string } | undefined
    if (!row) return null
    try { return (await stat(row.output_path)).isFile() ? row.output_path : null } catch { return null }
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

  async tick(): Promise<void> {
    if (this.running || this.closed) return
    this.running = true
    try {
      await mkdir(this.root, { recursive: true })
      while (!this.closed) {
        const job = this.sqlite.prepare(`SELECT j.id,j.version_id,j.kind,j.attempts,v.metadata,v.content_hash,v.archive_path
          FROM media_jobs j JOIN media_versions v ON v.id=j.version_id WHERE j.state='PENDING' AND j.attempts<3
          AND (j.kind='ARCHIVE' OR EXISTS(SELECT 1 FROM media_jobs a WHERE a.version_id=j.version_id AND a.kind='ARCHIVE' AND a.state='READY'))
          ORDER BY j.created_at,j.kind LIMIT 1`).get() as Job | undefined
        if (!job) break
        const now = new Date().toISOString()
        this.sqlite.prepare("UPDATE media_jobs SET state='RUNNING',attempts=attempts+1,updated_at=? WHERE id=?").run(now, job.id)
        const metadata = JSON.parse(job.metadata) as { path: string }
        const extension = /^\.[a-z0-9]{1,10}$/i.test(extname(metadata.path)) ? extname(metadata.path) : '.media'
        const destination = join(this.root, `${job.content_hash}${job.kind === 'ARCHIVE' ? extension : '.proxy.mp4'}`)
        const temporary = `${destination}.${job.id}.part`
        try {
          if (job.kind === 'ARCHIVE') {
            const hash = createHash('sha256')
            await pipeline(createReadStream(metadata.path), new Transform({ transform(chunk, _encoding, done) { hash.update(chunk); done(null, chunk) } }), createWriteStream(temporary))
            if (hash.digest('hex') !== job.content_hash.toLowerCase()) throw new Error('O arquivo mudou durante a ingestão. Faça nova varredura; esta versão não será substituída.')
          } else {
            if (!this.proxyBinary) throw new Error('Gerador de proxy não disponível no pacote. Use o pacote completo com rplayout-proxy.')
            if (!job.archive_path) throw new Error('Cópia da versão ainda não está disponível.')
            await this.transcode(job.archive_path, temporary)
          }
          if (this.closed) throw new Error('Servidor encerrando; trabalho será retomado.')
          await rename(temporary, destination)
          this.sqlite.transaction(() => {
            if (job.kind === 'ARCHIVE') this.sqlite.prepare('UPDATE media_versions SET archive_path=? WHERE id=?').run(destination, job.version_id)
            this.sqlite.prepare("UPDATE media_jobs SET state='READY',output_path=?,error=NULL,updated_at=? WHERE id=?").run(destination, new Date().toISOString(), job.id)
          })()
        } catch (error) {
          if (!this.closed) {
            this.sqlite.prepare("UPDATE media_jobs SET state='FAILED',error=?,updated_at=? WHERE id=?").run(error instanceof Error ? error.message : String(error), new Date().toISOString(), job.id)
            if (job.kind === 'ARCHIVE') this.sqlite.prepare("UPDATE media_jobs SET state='FAILED',error='Versão indisponível: corrija e reexecute a cópia antes do proxy.',updated_at=? WHERE version_id=? AND kind='PROXY' AND state='PENDING'").run(new Date().toISOString(), job.version_id)
          }
        } finally { await rm(temporary, { force: true }).catch(() => {}) }
      }
    } catch (error) {
      if (!this.closed) this.sqlite.prepare("UPDATE media_jobs SET state='FAILED',error=?,updated_at=? WHERE state='PENDING'").run(error instanceof Error ? error.message : String(error), new Date().toISOString())
    } finally { this.running = false }
  }

  private transcode(source: string, target: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.proxyBinary, [source, target], { windowsHide: true, env: mediaProcessEnvironment() })
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
        else resolve()
      })
    })
  }

  close(): void { this.closed = true; this.child?.kill() }
}
