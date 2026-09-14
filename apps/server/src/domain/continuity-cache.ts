import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { MediaAsset } from '@rplayout/protocol'

/** Cache local dos arquivos necessários à próxima janela de continuidade. */
export class ContinuityCache {
  constructor(private readonly root: string, private readonly maxBytes = 100 * 1024 * 1024 * 1024) {}

  pathFor(asset: Pick<MediaAsset, 'id' | 'contentHash' | 'path'>): string {
    const safe = (asset.contentHash || asset.id).replace(/[^a-zA-Z0-9_-]/g, '_')
    const name = asset.path.split(/[\\/]/).pop() ?? `${asset.id}.media`
    return join(this.root, `${safe}-${name}`)
  }

  async warm(assets: readonly Pick<MediaAsset, 'id' | 'contentHash' | 'path' | 'kind'>[]): Promise<{ cached: number; missing: number }> {
    await mkdir(this.root, { recursive: true })
    let cached = 0
    let missing = 0
    for (const asset of assets) {
      if (asset.kind === 'AUDIO' || asset.path.includes('://')) continue
      const target = this.pathFor(asset)
      try { await stat(target); cached++; continue } catch { /* precisa aquecer */ }
      try { await copyFile(asset.path, target); cached++ } catch { missing++ }
    }
    await this.prune()
    return { cached, missing }
  }

  async resolve(asset: Pick<MediaAsset, 'id' | 'contentHash' | 'path'>): Promise<string> {
    try { await stat(asset.path); return asset.path } catch { return this.pathFor(asset) }
  }

  private async prune(): Promise<void> {
    if (!Number.isFinite(this.maxBytes) || this.maxBytes <= 0) return
    const entries = await readdir(this.root, { withFileTypes: true })
    const files = await Promise.all(entries.filter((entry) => entry.isFile()).map(async (entry) => {
      const path = join(this.root, entry.name)
      const info = await stat(path)
      return { path, size: info.size, mtime: info.mtimeMs }
    }))
    let total = files.reduce((sum, file) => sum + file.size, 0)
    for (const file of files.sort((a, b) => a.mtime - b.mtime)) {
      if (total <= this.maxBytes) break
      await rm(file.path, { force: true })
      total -= file.size
    }
  }
}
