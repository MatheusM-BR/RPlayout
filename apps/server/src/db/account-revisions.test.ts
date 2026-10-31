import {afterEach,beforeEach,describe,expect,it} from 'vitest'
import Database from 'better-sqlite3'
import {mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {openDatabase} from './client.js'
import {accountRevision,migrateAccountRevisions,validateAccountRevisions} from './account-revisions.js'
import {validateBackupRestore} from '../domain/backup.js'
let value:ReturnType<typeof openDatabase>,file:string
const connections:Database.Database[]=[]
beforeEach(()=>{file=join(mkdtempSync(join(tmpdir(),'RPlayout-account-revisions-')),'qa.db');value=openDatabase(file);connections.push(value.sqlite);for(const id of ['G','ç:1'])value.sqlite.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id,id,'private-hash','OPERATOR',1,'original')})
afterEach(()=>{for(const db of connections.splice(0))if(db.open)db.close()})
const revision=(scope:string)=>accountRevision(value.sqlite,scope)
describe('migração 30: catálogo/contas/sessões são provas duráveis',()=>{
  it('namespace separa global, usuário G e sessões; login não invalida catálogo',()=>{
    const global=revision('G'),user=revision('U:G'),session=revision('S:G')
    value.sqlite.exec("INSERT INTO sessions VALUES('private-token','G','2099-01-01','original')")
    expect(revision('G')).toBe(global);expect(revision('U:G')).toBe(user);expect(revision('S:G')).toBeGreaterThan(session)
    value.sqlite.exec("UPDATE userS SET role=role WHERE id='G'");expect(revision('G')).toBeGreaterThan(global);expect(revision('U:G')).toBeGreaterThan(user)
  })
  it('owner antigo/novo de política e sessão invalidam ambos os alvos',()=>{
    value.sqlite.exec("INSERT INTO user_access VALUES('G',NULL,NULL,'now'); INSERT INTO sessions VALUES('token','G','2099-01-01','now')")
    const u=revision('U:G'),v=revision('U:ç:1'),s=revision('S:G'),t=revision('S:ç:1')
    value.sqlite.exec("UPDATE user_access SET user_id='ç:1'; UPDATE sessions SET user_id='ç:1'")
    expect(revision('U:G')).toBeGreaterThan(u);expect(revision('U:ç:1')).toBeGreaterThan(v);expect(revision('S:G')).toBeGreaterThan(s);expect(revision('S:ç:1')).toBeGreaterThan(t)
  })
  it('tombstone impede reutilizar prova após remover/recriar mesmo ID',()=>{
    const original=revision('U:G');value.sqlite.exec("DELETE FROM users WHERE id='G'");const tombstone=revision('U:G');expect(tombstone).toBeGreaterThan(original)
    value.sqlite.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('G','G','hash','ADMIN',1,'now');expect(revision('U:G')).toBeGreaterThan(tombstone)
  })
  it('upgrade 29 preserva IDs/conteúdo/sessões sem repetir baseline',()=>{
    value.sqlite.exec("INSERT INTO sessions VALUES('token','G','2099-01-01','original')")
    const users=value.sqlite.prepare('SELECT * FROM users').all(),sessions=value.sqlite.prepare('SELECT * FROM sessions').all()
    for(const row of value.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'account_revision_%'").all()as {name:string}[])value.sqlite.exec(`DROP TRIGGER ${row.name}`)
    value.sqlite.exec('DROP TABLE account_versions;DELETE FROM schema_migrations WHERE version=30');migrateAccountRevisions(value.sqlite)
    expect(value.sqlite.prepare('SELECT * FROM users').all()).toEqual(users);expect(value.sqlite.prepare('SELECT * FROM sessions').all()).toEqual(sessions)
    const initial=revision('G');expect(initial).toBeGreaterThanOrEqual(2**40);migrateAccountRevisions(value.sqlite);expect(revision('G')).toBe(initial)
  })
  it('segundo escritor/restart/backup conservam provas sem cache',async()=>{
    const second=new Database(file);connections.push(second);const previous=revision('U:G');second.exec("UPDATE users SET username=username WHERE id='G'");expect(revision('U:G')).toBeGreaterThan(previous)
    const current=revision('U:G');value.sqlite.close();value=openDatabase(file);connections.push(value.sqlite);expect(revision('U:G')).toBe(current)
    const backup=join(mkdtempSync(join(tmpdir(),'RPlayout-account-backup-')),'backup.db');await value.sqlite.backup(backup);expect(await validateBackupRestore(backup)).toMatchObject({integrity:'ok',foreignKeys:'ok'})
  })
  it.each(['table','trigger','counter'])('startup/backup recusam proteção marcada adulterada: %s',async damage=>{
    value.sqlite.exec(damage==='table'?'DROP TABLE account_versions':damage==='trigger'?'DROP TRIGGER account_revision_sessions_update':"DELETE FROM account_versions WHERE scope='U:G'")
    expect(()=>validateAccountRevisions(value.sqlite)).toThrow();const backup=join(mkdtempSync(join(tmpdir(),'RPlayout-account-damaged-')),'backup.db');await value.sqlite.backup(backup);await expect(validateBackupRestore(backup)).rejects.toThrow();value.sqlite.close();expect(()=>openDatabase(file)).toThrow()
  })
})
