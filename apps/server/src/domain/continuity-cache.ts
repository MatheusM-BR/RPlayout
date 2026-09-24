import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { ContinuityCacheStatus, MediaAsset } from '@rplayout/protocol'

export type CacheAssetInput = Pick<MediaAsset, 'id' | 'contentHash' | 'path'> & { kind?: string }

/** Cache local dos arquivos necessários à próxima janela de continuidade (estilo XMirror). */
export class ContinuityCache {
  /** Conjunto de caminhos de arquivos protegidos contra remoção na poda (ex: grade das próximas 48h). */
  private readonly protectedPaths = new Set<string>()

  constructor(
    public readonly root: string,
    public readonly maxBytes = 100 * 1024 * 1024 * 1024,
  ) {}

  pathFor(asset: Pick<MediaAsset, 'id' | 'contentHash' | 'path'>): string {
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
    return this.protectedPaths.has(path)
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
      try {
        await stat(target)
        cached++
        continue
      } catch {
        /* precisa aquecer */
      }
      try {
        await copyFile(asset.path, target)
        cached++
      } catch {
        missing++
      }
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
  ): Promise<{
    cached48h: number
    missing48h: number
    cached7d: number
    missing7d: number
  }> {
    const res48h = await this.warm(assets48h, { protect: true })
    const res7d = await this.warm(assets7d, { protect: false })
    return {
      cached48h: res48h.cached,
      missing48h: res48h.missing,
      cached7d: res7d.cached,
      missing7d: res7d.missing,
    }
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
  ): Promise<ContinuityCacheStatus> {
    let totalCachedFiles = 0
    let totalCachedBytes = 0

    try {
      const entries = await readdir(this.root, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isFile()) {
          totalCachedFiles++
          const info = await stat(join(this.root, entry.name))
          totalCachedBytes += info.size
        }
      }
    } catch {
      // Diretório ainda não existe
    }

    // Cálculo da cobertura de 48h
    let coverage48hPercent = 100.0
    if (assets48h && assets48h.length > 0) {
      const validAssets48h = assets48h.filter((a) => a.kind !== 'AUDIO' && !a.path.includes('://'))
      if (validAssets48h.length > 0) {
        let cached48hCount = 0
        for (const asset of validAssets48h) {
          try {
            await stat(this.pathFor(asset))
            cached48hCount++
          } catch {
            // Não cacheado
          }
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
          try {
            await stat(this.pathFor(asset))
            cached7dCount++
          } catch {
            // Não cacheado
          }
        }
        coverage7dPercent = Math.round((cached7dCount / validAssets7d.length) * 1000) / 10
      }
    }

    // Cálculo de autonomia offline (horas)
    let offlineAutonomyHours = 48
    if (coverage48hPercent === 100.0) {
      offlineAutonomyHours = coverage7dPercent === 100.0 ? 168 : 48
    } else {
      offlineAutonomyHours = Math.max(0, Math.floor((coverage48hPercent / 100) * 48))
    }

    // Determinação do status operacional
    let status: ContinuityCacheStatus['status'] = 'AIR_GAP_READY'
    if (Number.isFinite(this.maxBytes) && this.maxBytes > 0 && totalCachedBytes >= this.maxBytes * 0.85) {
      status = 'QUOTA_WARNING'
    } else if (coverage48hPercent === 100.0) {
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
        .filter((entry) => entry.isFile())
        .map(async (entry) => {
          const path = join(this.root, entry.name)
          const info = await stat(path)
          return {
            path,
            size: info.size,
            mtime: info.mtimeMs,
            isProtected: this.protectedPaths.has(path),
          }
        }),
    )

    let total = files.reduce((sum, file) => sum + file.size, 0)
    if (total <= this.maxBytes) return

    // Poda apenas arquivos que NÃO estão protegidos
    const candidates = files
      .filter((file) => !file.isProtected)
      .sort((a, b) => a.mtime - b.mtime)

    for (const file of candidates) {
      if (total <= this.maxBytes) break
      await rm(file.path, { force: true })
      total -= file.size
    }
  }
}
