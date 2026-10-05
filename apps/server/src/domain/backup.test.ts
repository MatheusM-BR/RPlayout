import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backupDatabase, validateBackupRestore } from './backup.js'

const directories: string[] = []
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }) })
describe('backup restaurado em banco isolado', () => {
  it('restaura Unicode e dados, informa tamanho real e não altera o banco ativo', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rplayout-backup-test-')); directories.push(directory)
    const db = new Database(':memory:')
    try {
      db.exec('PRAGMA page_size=8192; CREATE TABLE programs (id INTEGER PRIMARY KEY, title TEXT)')
      db.prepare('INSERT INTO programs VALUES (?, ?)').run(1, 'AÇÃO • Estúdio São José')
      const result = await backupDatabase(db, directory)
      expect(result.validation).toMatchObject({ integrity: 'ok', foreignKeys: 'ok', tables: { programs: 1 } })
      expect(result.bytes).toBe((await readFile(result.file)).length)
      const restored = new Database(result.file, { readonly: true })
      try { expect(restored.prepare('SELECT title FROM programs').get()).toEqual({ title: 'AÇÃO • Estúdio São José' }) } finally { restored.close() }
      db.prepare('INSERT INTO programs VALUES (?, ?)').run(2, 'Ao vivo')
      expect((db.prepare('SELECT count(*) n FROM programs').get() as { n: number }).n).toBe(2)
      const second = await backupDatabase(db, directory)
      expect(second.file).not.toBe(result.file)
    } finally { db.close() }
  })
  it('recusa referência órfã e arquivo ausente sem criar um banco vazio', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rplayout-backup-test-')); directories.push(directory)
    const db = new Database(':memory:')
    try {
      db.exec('PRAGMA foreign_keys=OFF; CREATE TABLE parent(id INTEGER PRIMARY KEY); CREATE TABLE child(parent_id INTEGER REFERENCES parent(id)); INSERT INTO child VALUES (99)')
      await expect(backupDatabase(db, directory)).rejects.toThrow('referências inválidas')
      await expect(validateBackupRestore(join(directory, 'absent.db'))).rejects.toThrow()
    } finally { db.close() }
  })
})
