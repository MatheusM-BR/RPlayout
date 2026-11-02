import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ContinuityCache } from './continuity-cache.js'

describe('cache de continuidade', () => {
  it('quota não remove original ou documento desconhecido numa pasta compartilhada',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'rplayout-cache-foreign-'))
    try {
      await writeFile(join(dir,'ORIGINAL-ÇÃO.mp4'),'original')
      await writeFile(join(dir,'Operação.txt'),'orientações')
      const cache=new ContinuityCache(dir,1)
      await cache.prune()
      expect(await readFile(join(dir,'ORIGINAL-ÇÃO.mp4'),'utf8')).toBe('original')
      expect(await readFile(join(dir,'Operação.txt'),'utf8')).toBe('orientações')
      const status=await cache.getStatus()
      expect(status.status).toBe('DEGRADED')
      expect(status.totalCachedFiles).toBe(0)
      expect(status.totalCachedBytes).toBe(0)
    } finally {await rm(dir,{recursive:true,force:true})}
  })
  it('substitui proteção por canal, libera janela antiga e conserva outro canal/PGM', async()=>{
    const dir=await mkdtemp(join(tmpdir(),'rplayout-cache-owners-'))
    try {
      const cache=new ContinuityCache(join(dir,'cache'),1)
      const a={id:'a',contentHash:'old',path:join(dir,'old.mp4')},b={id:'b',contentHash:'current',path:join(dir,'current.mp4')},c={id:'c',contentHash:'other',path:join(dir,'other.mp4')}
      for(const asset of [a,b,c]) await writeFile(asset.path,'12345')
      cache.protect(c)
      await cache.warmSchedule([a],[],{owner:'ch:a'})
      await cache.warmSchedule([b],[],{owner:'ch:b'})
      cache.replaceProtection('ch:a',[])
      await cache.prune()
      expect(cache.isProtected(cache.pathFor(a))).toBe(false)
      expect(cache.isProtected(cache.pathFor(b))).toBe(true)
      expect(cache.isProtected(cache.pathFor(c))).toBe(true)
      await expect(stat(cache.pathFor(a))).rejects.toThrow()
      await expect(stat(cache.pathFor(b))).resolves.toBeDefined()
    } finally { await rm(dir,{recursive:true,force:true}) }
  })
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

  it('não converte quantidade de arquivos em horas de autonomia', async () => {
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

    // Cobertura da coleção não prova 48h de execução ordenada.
    const statusAfter = await cache.getStatus([asset1, asset2])
    expect(statusAfter.coverage48hPercent).toBe(100)
    expect(statusAfter.offlineAutonomyHours).toBe(0)
    expect(statusAfter.coverageBasis).toBe('LIBRARY')
    expect(statusAfter.status).toBe('SYNCHRONIZING')
    expect(await cache.isAirGapReady([asset1, asset2])).toBe(false)
  })

  it('verifica hash, recusa arquivo alterado e soma apenas o prefixo reproduzível', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rplayout-cache-hash-'))
    try {
      const { createHash } = await import('node:crypto')
      const source = join(dir, 'ÇÃO.mp4')
      await writeFile(source, 'video')
      const asset = { id: 'sha', path: source, kind: 'VIDEO', contentHash: createHash('sha256').update('video').digest('hex') }
      const cache = new ContinuityCache(join(dir, 'cache'))
      expect((await cache.warm([asset])).cached).toBe(1)
      const sequence = [{ asset, durationSeconds: 1800 }, { asset: null, durationSeconds: 3600 }, { asset, durationSeconds: 1800 }]
      expect((await cache.getStatus([asset], [], sequence)).offlineAutonomyHours).toBe(0.5)
      await writeFile(cache.pathFor(asset), 'corrupt')
      expect(await cache.verified(asset)).toBe(false)
      await writeFile(source, 'changed')
      expect((await cache.warm([asset])).missing).toBe(1)
      expect((await cache.getStatus([asset], [], sequence)).offlineAutonomyHours).toBe(0)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
  it('reutiliza versão por SHA mesmo renomeada e migra cópia antiga verificada', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rplayout-cache-name-'))
    try {
      const { createHash } = await import('node:crypto')
      const { mkdir, readdir } = await import('node:fs/promises')
      const cache = new ContinuityCache(join(dir, 'cache'))
      const hash = createHash('sha256').update('video').digest('hex')
      const asset = { id: 'a', contentHash: hash, path: join(dir,'AÇÃO.mp4'), kind: 'VIDEO' }
      await mkdir(cache.root)
      await writeFile(join(cache.root, `${hash}-AÇÃO.mp4`), 'video')
      const archived = { ...asset, path: join(dir, `${hash}.mp4`) }
      expect(cache.pathFor(asset)).toBe(cache.pathFor(archived))
      expect(await cache.verified(archived)).toBe(true)
      expect(await readFile(cache.pathFor(asset),'utf8')).toBe('video')
      expect(await readdir(cache.root)).toEqual([`${hash}.media`])
      const sequence = [{ asset: archived, durationSeconds: 3600 }, { asset: null, durationSeconds: 3600 }, { asset: archived, durationSeconds: 3600 }]
      const status = await cache.getStatus([asset], [asset], sequence)
      expect(status.offlineAutonomyHours).toBe(1)
      expect(status.coverage48hPercent).toBe(4.1)
      expect(status.coverage7dPercent).toBe(1.1)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
})
