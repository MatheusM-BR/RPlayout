import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
