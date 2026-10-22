import { copyFile, mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { ContinuityCacheStatus, MediaAsset } from '@rplayout/protocol'

export type CacheAssetInput = Pick<MediaAsset, 'id' | 'contentHash' | 'path'> & { kind?: string }

export interface CacheSequenceEntry { asset: CacheAssetInput | null; durationSeconds: number }

async function matchesHash(path: string, hash: string): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/i.test(hash)) return true // legacy assets: presence only, never proof of a media version
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(path)) digest.update(chunk)
  return digest.digest('hex') === hash.toLowerCase()
}

/** Cache local dos arquivos necessários à próxima janela de continuidade (estilo XMirror). */
export class ContinuityCache {
  /** Conjunto de caminhos de arquivos protegidos contra remoção na poda (ex: grade das próximas 48h). */
  private readonly protectedPaths = new Set<string>()
  private readonly protectedOwners = new Map<string, Set<string>>()
  private readonly createdCopies = new Set<string>()
  private scheduleWarm: Promise<unknown> = Promise.resolve()
  private readonly copying = new Map<string, Promise<boolean>>()
  private readonly checked = new Map<string, { signature: string; valid: boolean }>()
  private owns(path:string): boolean {
    return this.createdCopies.has(path) || /^[a-f0-9]{64}\.media$/i.test(path.split(/[\\/]/).pop() ?? '')
  }

  async verified(asset: CacheAssetInput): Promise<boolean> {
    try {
      const path = this.pathFor(asset)
      if (/^[a-f0-9]{64}$/i.test(asset.contentHash)) {
        // Old releases included the original basename. Published editions may
        // use an archive basename: address the content, not its former name.
        // Promote only a digest-verified old copy; never discard user cache.
        const present = await stat(path).catch(() => null)
        if (!present) {
          const entries = await readdir(this.root).catch(() => [])
          for (const entry of entries.filter(name => name.toLowerCase().startsWith(asset.contentHash.toLowerCase() + '-') && !name.endsWith('.part'))) {
            const old = join(this.root, entry)
            if (await matchesHash(old, asset.contentHash).catch(() => false)) {
              await rename(old, path).catch(() => {})
              break
            }
          }
        }
      }
      const info = await stat(path)
      if (!info.isFile()) return false
      const signature = `${asset.contentHash}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`
      const old = this.checked.get(path)
      if (old?.signature === signature) return old.valid
      const valid = await matchesHash(path, asset.contentHash)
      this.checked.set(path, { signature, valid })
      return valid
    }
    catch { return false }
  }

  private copy(asset: CacheAssetInput): Promise<boolean> {
    const target = this.pathFor(asset)
    const active = this.copying.get(target)
    if (active) return active
    const work = (async () => {
      if (await this.verified(asset)) return true
      const temporary = `${target}.${randomUUID()}.part`
      try {
        await copyFile(asset.path, temporary)
        if (!(await matchesHash(temporary, asset.contentHash))) return false
        await rename(temporary, target)
        this.createdCopies.add(target)
        return true
      } catch { return false }
      finally { await rm(temporary, { force: true }).catch(() => {}) }
    })().finally(() => this.copying.delete(target))
    this.copying.set(target, work)
    return work
  }

  constructor(
    public readonly root: string,
    public readonly maxBytes = 100 * 1024 * 1024 * 1024,
  ) {}

  pathFor(asset: Pick<MediaAsset, 'id' | 'contentHash' | 'path'>): string {
    if (/^[a-f0-9]{64}$/i.test(asset.contentHash)) return join(this.root, `${asset.contentHash.toLowerCase()}.media`)
    const safe = (asset.contentHash || asset.id).replace(/[^a-zA-Z0-9_-]/g, '_')
    const name = asset.path.split(/[\\/]/).pop() ?? `${asset.id}.media`
    return join(this.root, `${safe}-${name}`)
  }

  /** Marca caminhos ou assets como imunes à poda por quota. */
  protect(assetOrPath: CacheAssetInput | string): void {
    if (typeof assetOrPath === 'string') {
      this.protectedPaths.add(assetOrPath)
    } else {
      this.protectedPaths.add(this.pathFor(assetOrPath))
    }
  }

  protectMany(assetsOrPaths: Iterable<CacheAssetInput | string>): void {
    for (const item of assetsOrPaths) {
      this.protect(item)
    }
  }

  unprotect(assetOrPath: CacheAssetInput | string): void {
    const p = typeof assetOrPath === 'string' ? assetOrPath : this.pathFor(assetOrPath)
    this.protectedPaths.delete(p)
  }

  clearProtected(): void {
    this.protectedPaths.clear()
  }

  isProtected(path: string): boolean {
    return this.protectedPaths.has(path) || [...this.protectedOwners.values()].some(paths => paths.has(path))
  }

  /** Replace one channel's rolling window without releasing another channel,
   * the current PGM/CUE, or explicitly protected legacy copies. */
  replaceProtection(owner: string, assets: readonly CacheAssetInput[]): void {
    this.protectedOwners.set(owner, new Set(assets.map(asset => this.pathFor(asset))))
  }

  /**
   * Aquece os arquivos da lista transferindo para a unidade local.
   * Se autoProtect = true, protege automaticamente contra poda.
   */
  async warm(
    assets: readonly CacheAssetInput[],
    options: { protect?: boolean } = {},
  ): Promise<{ cached: number; missing: number }> {
    await mkdir(this.root, { recursive: true })
    let cached = 0
    let missing = 0

    for (const asset of assets) {
      if (asset.kind === 'AUDIO' || asset.path.includes('://')) continue
      const target = this.pathFor(asset)
      if (options.protect) {
        this.protectedPaths.add(target)
      }
      if (await this.copy(asset)) cached++
      else missing++
    }

    await this.prune()
    return { cached, missing }
  }

  /**
   * Pré-aquecimento da grade em duas camadas:
   * 1) Buffer Crítico 48h: Protegido obrigatoriamente contra poda.
   * 2) Grade Estendida 7d: Pré-aquecimento em segundo plano.
   */
  async warmSchedule(
    assets48h: readonly CacheAssetInput[],
    assets7d: readonly CacheAssetInput[] = [],
    options: { owner?: string } = {},
  ): Promise<{
    cached48h: number
    missing48h: number
    cached7d: number
    missing7d: number
  }> {
    const work = this.scheduleWarm.catch(() => {}).then(async () => {
      if (options.owner) this.replaceProtection(options.owner, assets48h)
      const res48h = await this.warm(assets48h, { protect: !options.owner })
      const res7d = await this.warm(assets7d, { protect: false })
      return { cached48h: res48h.cached, missing48h: res48h.missing,
        cached7d: res7d.cached, missing7d: res7d.missing }
    })
    this.scheduleWarm = work
    return work
  }

  async resolve(asset: Pick<MediaAsset, 'id' | 'contentHash' | 'path'>): Promise<string> {
    try {
      await stat(asset.path)
      return asset.path
    } catch {
      return this.pathFor(asset)
    }
  }

  /**
   * Retorna telemetria e status do cache conforme especificação de continuidade.
   */
  async getStatus(
    assets48h?: readonly CacheAssetInput[],
    assets7d?: readonly CacheAssetInput[],
    sequence?: readonly CacheSequenceEntry[],
  ): Promise<ContinuityCacheStatus> {
    let totalCachedFiles = 0
    let totalCachedBytes = 0

    try {
      const entries = await readdir(this.root, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isFile() && !entry.name.endsWith('.part') && this.owns(join(this.root,entry.name))) {
          totalCachedFiles++
          const info = await stat(join(this.root, entry.name))
          totalCachedBytes += info.size
        }
      }
    } catch {
      // Diretório ainda não existe
    }

    // Cálculo da cobertura de 48h
    let coverage48hPercent = 0
    if (assets48h && assets48h.length > 0) {
      const validAssets48h = assets48h.filter((a) => a.kind !== 'AUDIO' && !a.path.includes('://'))
      if (validAssets48h.length > 0) {
        let cached48hCount = 0
        for (const asset of validAssets48h) {
          if (await this.verified(asset)) cached48hCount++
        }
        coverage48hPercent = Math.round((cached48hCount / validAssets48h.length) * 1000) / 10
      }
    }

    // Cálculo da cobertura de 7 dias
    let coverage7dPercent = coverage48hPercent
    if (assets7d && assets7d.length > 0) {
      const validAssets7d = assets7d.filter((a) => a.kind !== 'AUDIO' && !a.path.includes('://'))
      if (validAssets7d.length > 0) {
        let cached7dCount = 0
        for (const asset of validAssets7d) {
          if (await this.verified(asset)) cached7dCount++
        }
        coverage7dPercent = Math.round((cached7dCount / validAssets7d.length) * 1000) / 10
      }
    }

    // Cálculo de autonomia offline (horas)
    let offlineSeconds = 0
    if (sequence) {
      for (const entry of sequence) {
        if (!entry.asset || !/^[a-f0-9]{64}$/i.test(entry.asset.contentHash)
          || !Number.isFinite(entry.durationSeconds) || entry.durationSeconds <= 0
          || !(await this.verified(entry.asset))) break
        offlineSeconds += entry.durationSeconds
      }
    }
    const offlineAutonomyHours = Math.floor(offlineSeconds / 36) / 100
    if (sequence) {
      // These are temporal windows, not the fraction of a small collection.
      // A cached 2-minute playlist must not advertise 100% of the next 48h.
      const coverage = async (windowSeconds: number) => {
        let cursor = 0, covered = 0
        for (const entry of sequence) {
          if (!Number.isFinite(entry.durationSeconds) || entry.durationSeconds <= 0) break
          const seconds = Math.min(entry.durationSeconds, Math.max(0, windowSeconds - cursor))
          if (entry.asset && /^[a-f0-9]{64}$/i.test(entry.asset.contentHash) && await this.verified(entry.asset)) covered += seconds
          cursor += seconds
          if (cursor >= windowSeconds) break
        }
        return Math.floor(covered / windowSeconds * 1000) / 10
      }
      coverage48hPercent = await coverage(48 * 3600)
      coverage7dPercent = await coverage(7 * 24 * 3600)
    }

    // Determinação do status operacional
    let status: ContinuityCacheStatus['status'] = 'DEGRADED'
    if (Number.isFinite(this.maxBytes) && this.maxBytes > 0 && totalCachedBytes >= this.maxBytes * 0.85) {
      status = 'QUOTA_WARNING'
    } else if (offlineAutonomyHours >= 48) {
      status = 'AIR_GAP_READY'
    } else if (coverage48hPercent >= 80.0) {
      status = 'SYNCHRONIZING'
    } else {
      status = 'DEGRADED'
    }

    return {
      coverage48hPercent,
      coverage7dPercent,
      totalCachedFiles,
      totalCachedBytes,
      maxQuotaBytes: this.maxBytes,
      offlineAutonomyHours,
      coverageBasis: sequence ? 'ORDERED_PLAYLIST' : 'LIBRARY',
      status,
    }
  }

  async isAirGapReady(assets48h?: readonly CacheAssetInput[]): Promise<boolean> {
    const status = await this.getStatus(assets48h)
    return status.status === 'AIR_GAP_READY'
  }

  /**
   * Poda por antiguidade (FIFO), respeitando rigidamente as mídias protegidas
   * das próximas 48 horas, que NUNCA são excluídas.
   */
  async prune(): Promise<void> {
    if (!Number.isFinite(this.maxBytes) || this.maxBytes <= 0) return
    const entries = await readdir(this.root, { withFileTypes: true }).catch(() => null)
    if (!entries) return

    const files = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && !entry.name.endsWith('.part') && this.owns(join(this.root,entry.name)))
        .map(async (entry) => {
          const path = join(this.root, entry.name)
          const info = await stat(path)
          return {
            path,
            size: info.size,
            mtime: info.mtimeMs,
            isProtected: this.isProtected(path),
          }
        }),
    )

    let total = files.reduce((sum, file) => sum + file.size, 0)
    if (total <= this.maxBytes) return

    // Poda apenas arquivos que NÃO estão protegidos
    const candidates = files
      // A misconfigured/shared cache directory must never authorize removal
      // of arbitrary originals, sidecars or operator documents. Older copies
      // with no SHA name are removable only if created by this instance.
      .filter((file) => !file.isProtected)
      .sort((a, b) => a.mtime - b.mtime)

    for (const file of candidates) {
      if (total <= this.maxBytes) break
      await rm(file.path, { force: true })
      this.createdCopies.delete(file.path)
      total -= file.size
    }
  }
}
