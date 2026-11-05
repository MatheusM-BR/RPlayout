import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { openDatabase, type Db } from '../db/client.js'
import { mediaAssets } from '../db/schema.js'
import { Ingest, VANISHED } from './ingest.js'
import { IngestOwnership } from './ingest-ownership.js'

let db: Db, sqlite: ReturnType<typeof openDatabase>['sqlite'], pasta: string, ingest: Ingest
beforeEach(() => {
  const opened = openDatabase(':memory:'); db = opened.db; sqlite = opened.sqlite
  pasta = mkdtempSync(join(tmpdir(), 'rplayout-moved-'))
  ingest = new Ingest(db, '/bin/false', join(pasta, '.thumbs'))
  ingest.measure = false
  vi.spyOn(ingest as unknown as { probe: () => Promise<unknown> }, 'probe')
    .mockResolvedValue({ ok: true, durationNs: 1e9, video: { width: 320, height: 180, rateNum: 25, rateDen: 1 } })
})
afterEach(() => { rmSync(pasta, { recursive: true, force: true }) })
async function fim() { const t = Date.now() + 30_000; while (Date.now() < t) { if (!ingest.status().running) return; await new Promise(r => setTimeout(r, 100)) } throw new Error('não terminou') }

it('pasta cadastrada ausente não derruba o lote: as outras são lidas e o lote termina COMPLETED', async () => {
  const boa = join(pasta, 'boa'); mkdirSync(boa); writeFileSync(join(boa, 'a.mp4'), 'a')
  const old = new Date('2020-01-01'); utimesSync(join(boa, 'a.mp4'), old, old)
  const ausente = join(pasta, 'D-Videos-que-nao-existe')
  ingest.start([ausente, boa]); await fim()
  expect(ingest.status()).toMatchObject({ error: null, unavailableRoots: [ausente] })
  expect((await db.select().from(mediaAssets)).map(r => r.path)).toEqual([join(boa, 'a.mp4')])
  const batch = sqlite.prepare('SELECT state,error FROM ingest_batches ORDER BY created_at DESC LIMIT 1').get() as { state: string; error: string | null }
  expect(batch).toEqual({ state: 'COMPLETED', error: null })
  void IngestOwnership
})

it('arquivo movido para outra pasta religa o mesmo cadastro (id, QC, título, loudness, grade)', async () => {
  const antiga = join(pasta, 'antiga'), nova = join(pasta, 'nova'); mkdirSync(antiga); mkdirSync(nova)
  const old = new Date('2020-01-01')
  writeFileSync(join(antiga, 'IVOMEC.mp4'), 'conteudo-ivomec'); utimesSync(join(antiga, 'IVOMEC.mp4'), old, old)
  ingest.start(antiga); await fim()
  const [antes] = await db.select().from(mediaAssets)
  const loud = { integratedLufs: -23, lra: 4, truePeakDbtp: -2, scope: 'FILE' as const, measuredAt: 't' }
  sqlite.prepare("UPDATE media_assets SET title='IVOMEC aprovado', qc_status='APPROVED', loudness_file=?, category_id='Comercial' WHERE id=?").run(JSON.stringify(loud), antes!.id)
  // A máquina foi reinstalada: a pasta antiga sumiu, o arquivo voltou noutra.
  rmSync(antiga, { recursive: true })
  expect(await ingest.reconcileAvailability()).toBe(true)
  writeFileSync(join(nova, 'IVOMEC.mp4'), 'conteudo-ivomec'); utimesSync(join(nova, 'IVOMEC.mp4'), old, old)
  ingest.start([antiga, nova]); await fim()
  const rows = await db.select().from(mediaAssets)
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ id: antes!.id, path: join(nova, 'IVOMEC.mp4'), title: 'IVOMEC aprovado', qcStatus: 'APPROVED', categoryId: 'Comercial', probeError: null })
  expect(rows[0]!.loudnessFile).toMatchObject({ integratedLufs: -23 })
})

it('conteúdo diferente com o mesmo nome não religa cadastro sumido', async () => {
  const antiga = join(pasta, 'antiga'), nova = join(pasta, 'nova'); mkdirSync(antiga); mkdirSync(nova)
  const old = new Date('2020-01-01')
  writeFileSync(join(antiga, 'X.mp4'), 'um'); utimesSync(join(antiga, 'X.mp4'), old, old); ingest.start(antiga); await fim()
  rmSync(antiga, { recursive: true }); await ingest.reconcileAvailability()
  writeFileSync(join(nova, 'X.mp4'), 'outro'); utimesSync(join(nova, 'X.mp4'), old, old)
  ingest.start(nova); await fim()
  const rows = await db.select().from(mediaAssets)
  expect(rows).toHaveLength(2)
  expect(rows.find(r => r.path.startsWith(antiga))?.probeError).toBe(VANISHED)
})
