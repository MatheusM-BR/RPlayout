import { copyFile, mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { MediaAsset } from '@rplayout/protocol'

/** Cache local dos arquivos necessários à próxima janela de continuidade. */
export class ContinuityCache {
  constructor(private readonly root: string) {}

  pathFor(asset: Pick<MediaAsset, 'id' | 'contentHash' | 'path'>): string {
    const safe = (asset.contentHash || asset.id).replace(/[^a-zA-Z0-9_-]/g, '_')
    const name = asset.path.split(/[\\/]/).pop() ?? `${asset.id}.media`
    return join(this.root, `${safe}-${name}`)
  }

  async warm(assets: readonly MediaAsset[]): Promise<{ cached: number; missing: number }> {
    await mkdir(this.root, { recursive: true })
    let cached = 0
    let missing = 0
    for (const asset of assets) {
      if (asset.kind === 'AUDIO' || asset.path.includes('://')) continue
      const target = this.pathFor(asset)
      try { await stat(target); cached++; continue } catch { /* precisa aquecer */ }
      try { await copyFile(asset.path, target); cached++ } catch { missing++ }
    }
    return { cached, missing }
  }

  async resolve(asset: MediaAsset): Promise<string> {
    try { await stat(asset.path); return asset.path } catch { return this.pathFor(asset) }
  }
}
