import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backupDatabase, validateBackupRestore } from './backup.js'
import {openDatabase} from '../db/client.js'
import {GraphicCommandLedger} from './graphic-command-ledger.js'

const directories: string[] = []
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }) })
describe('backup restaurado em banco isolado', () => {
  it('backup com pendência gráfica perdida é recusado sem liberar o comando no banco ativo',async()=>{
    const directory=await mkdtemp(join(tmpdir(),'rplayout-backup-test-'));directories.push(directory)
    const value=openDatabase(':memory:')
    try{
      value.sqlite.exec("INSERT INTO channels(id,name,width,height,rate_num,rate_den,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES('a','A',320,180,25,1,-23,-1,5,'now')")
      const ledger=new GraphicCommandLedger(value.db,'a')
      await expect(ledger.execute({key:'uncertain-backup-key',actorId:null,actorName:'TEST',native:true,selection:{action:'SHOW'}},()=>{},async send=>{send();throw new Error('ACK_TIMEOUT')})).rejects.toThrow()
      const result=await backupDatabase(value.sqlite,directory)
      const damaged=new Database(result.file)
      try{
        const guard=damaged.prepare("SELECT sql FROM sqlite_master WHERE name='graphic_command_pending_guard_delete'").get() as {sql:string}
        damaged.exec('DROP TRIGGER graphic_command_pending_guard_delete; DELETE FROM graphic_command_pending')
        damaged.exec(guard.sql)
      }finally{damaged.close()}
      await expect(validateBackupRestore(result.file)).rejects.toThrow('diverge')
      expect(ledger.hasUnresolved()).toBe(true);expect(ledger.list()[0]!.state).toBe('UNCERTAIN')
    }finally{value.sqlite.close()}
  })
  it('restaura Unicode e dados, informa tamanho real e não altera o banco ativo', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rplayout-backup-test-')); directories.push(directory)
    const {sqlite:db}=openDatabase(':memory:')
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
