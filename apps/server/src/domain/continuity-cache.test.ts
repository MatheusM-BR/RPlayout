import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ContinuityCache } from './continuity-cache.js'

describe('cache de continuidade', () => {
  it('aquece arquivo e resolve o caminho cacheado', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rplayout-cache-'))
    const source = join(dir, 'origem.mp4')
    await writeFile(source, 'dados')
    const asset = { id: 'a', contentHash: 'hash', path: source, kind: 'VIDEO' as const }
    const cache = new ContinuityCache(join(dir, 'cache'))
    expect((await cache.warm([asset])).cached).toBe(1)
    await rm(source)
    const cached = await cache.resolve(asset)
    expect(await readFile(cached, 'utf8')).toBe('dados')
  })
})
