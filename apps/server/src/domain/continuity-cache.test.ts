import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
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

  it('remove o arquivo mais antigo quando excede a quota', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rplayout-cache-quota-'))
    const first = join(dir, 'first.mp4')
    const second = join(dir, 'second.mp4')
    await writeFile(first, '12345')
    await writeFile(second, '67890')
    const cache = new ContinuityCache(join(dir, 'cache'), 5)
    await cache.warm([
      { id: '1', contentHash: 'one', path: first, kind: 'VIDEO' },
      { id: '2', contentHash: 'two', path: second, kind: 'VIDEO' },
    ])
    const files = await (await import('node:fs/promises')).readdir(join(dir, 'cache'))
    expect(files).toHaveLength(1)
    await expect(stat(join(dir, 'cache', files[0]!))).resolves.toBeDefined()
  })
})
