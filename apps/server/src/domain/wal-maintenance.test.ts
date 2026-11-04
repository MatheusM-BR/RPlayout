import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { createRequire } from 'node:module'
import Database from 'better-sqlite3'
import { openDatabase } from '../db/client.js'
import { walMaintenance } from './wal-maintenance.js'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
it('acima do teto, o checkpoint TRUNCATE devolve o -wal a zero; abaixo, PASSIVE', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rplayout-wal-')); dirs.push(dir)
  const file = join(dir, 'qa.db'), { sqlite } = openDatabase(file)
  try {
    expect(sqlite.pragma('journal_size_limit', { simple: true })).toBe(67108864)
    sqlite.pragma('wal_autocheckpoint = 0')
    const insert = sqlite.prepare('INSERT INTO host_metric_samples VALUES (?,?)'), payload = 'x'.repeat(3000)
    sqlite.transaction(() => { for (let i = 0; i < 2000; i++) insert.run(new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(), payload) })()
    const wal = `${file}-wal`, grown = statSync(wal).size
    expect(grown).toBeGreaterThan(4 * 1048576)
    const small = walMaintenance(sqlite, wal, 1024 * 1048576)
    expect(small.mode).toBe('PASSIVE')
    const big = walMaintenance(sqlite, wal, 1048576)
    expect(big).toMatchObject({ mode: 'TRUNCATE', busy: false })
    expect(big.walBytesBefore).toBeGreaterThan(1048576)
    expect(big.walBytesAfter).toBe(0)
  } finally { sqlite.close() }
})
it('sem teto (0) nunca trunca', () => {
  const calls: string[] = []
  const result = walMaintenance({ pragma: (sql: string) => { calls.push(sql); return [{ busy: 0 }] } }, '/nao/existe-wal', 0)
  expect(result.mode).toBe('PASSIVE'); expect(calls).toEqual(['wal_checkpoint(PASSIVE)'])
})

// Escritor em outra thread, com busy_timeout de 1 s, inserindo sem parar por 1,5 s.
const writerSource = `
const { parentPort, workerData } = require('node:worker_threads')
const Database = require(workerData.module)
const db = new Database(workerData.file, { timeout: 1000 })
const insert = db.prepare('INSERT INTO host_metric_samples VALUES (?,?)')
const errors = []; let writes = 0
parentPort.postMessage({ ready: true })
const until = Date.now() + 1500
while (Date.now() < until) {
  try { insert.run(new Date(Date.UTC(2027, 0, 1) + writes * 1000 + Math.floor(Math.random() * 999)).toISOString(), 'w'); writes++ }
  catch (error) { errors.push(String(error.message)) }
}
db.close(); parentPort.postMessage({ done: true, writes, errors })
`
it('com leitor aberto, o TRUNCATE não espera o busy_timeout nem trava quem escreve', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rplayout-wal-')); dirs.push(dir)
  const file = join(dir, 'qa.db'), { sqlite } = openDatabase(file)
  const reader = new Database(file, { readonly: true })
  try {
    expect(sqlite.pragma('busy_timeout', { simple: true })).toBe(5000)
    sqlite.pragma('wal_autocheckpoint = 0')
    const insert = sqlite.prepare('INSERT INTO host_metric_samples VALUES (?,?)'), payload = 'x'.repeat(3000)
    sqlite.transaction(() => { for (let i = 0; i < 1000; i++) insert.run(new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(), payload) })()
    // Leitor numa transação: o PASSIVE copia tudo, mas o TRUNCATE precisaria esperar ele sair.
    reader.prepare('BEGIN').run(); reader.prepare('SELECT count(*) n FROM host_metric_samples').get()
    const worker = new Worker(writerSource, { eval: true, workerData: { file, module: createRequire(import.meta.url).resolve('better-sqlite3') } })
    const done = new Promise<{ writes: number; errors: string[] }>((resolve, reject) => {
      worker.on('message', message => { if (message.done) resolve(message) })
      worker.on('error', reject)
    })
    await new Promise<void>(resolve => worker.once('message', () => resolve()))
    await new Promise(resolve => setTimeout(resolve, 50))
    const started = performance.now()
    const result = walMaintenance(sqlite, `${file}-wal`, 1048576)
    const elapsed = performance.now() - started
    expect(elapsed).toBeLessThan(100)
    expect(result.busy).toBe(true)
    // O valor anterior volta.
    expect(sqlite.pragma('busy_timeout', { simple: true })).toBe(5000)
    const writer = await done
    expect(writer.errors).toEqual([])
    expect(writer.writes).toBeGreaterThan(0)
    // Sem leitor, a passada seguinte trunca.
    reader.prepare('COMMIT').run()
    expect(walMaintenance(sqlite, `${file}-wal`, 1).walBytesAfter).toBe(0)
  } finally { reader.close(); sqlite.close() }
}, 30_000)
it('PASSIVE incompleto (leitor num instantâneo antigo) não tenta TRUNCATE', () => {
  const calls: string[] = []
  const result = walMaintenance({ pragma: (sql: string) => { calls.push(sql); return sql.startsWith('wal_checkpoint') ? [{ busy: 0, log: 10, checkpointed: 4 }] : 5000 } }, __filename, 1)
  expect(calls).toEqual(['wal_checkpoint(PASSIVE)'])
  expect(result).toMatchObject({ mode: 'PASSIVE', busy: true })
})
it('TRUNCATE roda com busy_timeout 0 e devolve o valor anterior mesmo se falhar', () => {
  const calls: string[] = []
  expect(() => walMaintenance({ pragma: (sql: string) => {
    calls.push(sql)
    if (sql === 'wal_checkpoint(PASSIVE)') return [{ busy: 0, log: 3, checkpointed: 3 }]
    if (sql === 'busy_timeout') return 2500
    if (sql === 'wal_checkpoint(TRUNCATE)') throw new Error('falhou')
    return undefined
  } }, __filename, 1)).toThrow('falhou')
  expect(calls).toEqual(['wal_checkpoint(PASSIVE)', 'busy_timeout', 'busy_timeout = 0', 'wal_checkpoint(TRUNCATE)', 'busy_timeout = 2500'])
})
