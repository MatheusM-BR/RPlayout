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

  it('protege mídias de 48h contra exclusão na poda mesmo quando excede a quota', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rplayout-cache-protected-'))
    const critical48h = join(dir, 'critical48h.mp4')
    const dispensable = join(dir, 'dispensable.mp4')
    await writeFile(critical48h, '12345')
    await writeFile(dispensable, '67890')

    // Quota para caber apenas 1 arquivo (5 bytes)
    const cache = new ContinuityCache(join(dir, 'cache'), 5)

    const assetCritical = { id: 'crit', contentHash: 'hash-crit', path: critical48h, kind: 'VIDEO' }
    const assetDispensable = { id: 'disp', contentHash: 'hash-disp', path: dispensable, kind: 'VIDEO' }

    // Aquece o crítico primeiro e protege
    await cache.warm([assetCritical], { protect: true })
    // Agora tenta aquecer o dispensável
    await cache.warm([assetDispensable], { protect: false })

    // O arquivo crítico deve permanecer obrigatoriamente preservado
    const targetCritical = cache.pathFor(assetCritical)
    await expect(stat(targetCritical)).resolves.toBeDefined()
  })

  it('calcula métricas de cobertura 48h, 7d e autonomia offline (AIR_GAP_READY)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rplayout-cache-telemetry-'))
    const f1 = join(dir, 'f1.mp4')
    const f2 = join(dir, 'f2.mp4')
    await writeFile(f1, 'video1')
    await writeFile(f2, 'video2')

    const cache = new ContinuityCache(join(dir, 'cache'), 1024 * 1024)
    const asset1 = { id: '1', contentHash: 'h1', path: f1, kind: 'VIDEO' }
    const asset2 = { id: '2', contentHash: 'h2', path: f2, kind: 'VIDEO' }

    // Antes de aquecer: cobertura 0%
    const statusBefore = await cache.getStatus([asset1, asset2])
    expect(statusBefore.coverage48hPercent).toBe(0)
    expect(statusBefore.status).toBe('DEGRADED')

    // Aquece todos os arquivos da grade 48h
    await cache.warmSchedule([asset1, asset2])

    // Após aquecer: 100% de cobertura, AIR_GAP_READY e autonomia >= 48h
    const statusAfter = await cache.getStatus([asset1, asset2])
    expect(statusAfter.coverage48hPercent).toBe(100)
    expect(statusAfter.offlineAutonomyHours).toBeGreaterThanOrEqual(48)
    expect(statusAfter.status).toBe('AIR_GAP_READY')
    expect(await cache.isAirGapReady([asset1, asset2])).toBe(true)
  })
})
