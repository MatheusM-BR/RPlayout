import Database from 'better-sqlite3'
import {it,expect} from 'vitest'
import {migrateScanRevisions} from './scan-revisions.js'
it('migração mantém lote legado, same-value/ABA e proteção obrigatória; idempotente',()=>{
  const db=new Database(':memory:')
  try{
    db.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT,applied_at TEXT);CREATE TABLE ingest_batches(id TEXT PRIMARY KEY,state TEXT);INSERT INTO ingest_batches VALUES('a','RUNNING')")
    migrateScanRevisions(db);const version=()=>Number((db.prepare('SELECT version FROM scan_revision').get() as {version:number}).version),first=version()
    migrateScanRevisions(db);expect(version()).toBe(first);db.exec('UPDATE ingest_batches SET state=state');expect(version()).toBe(first+1)
    db.exec("DELETE FROM ingest_batches;INSERT INTO ingest_batches VALUES('a','RUNNING')");expect(version()).toBe(first+3);expect(db.prepare('SELECT * FROM ingest_batches').get()).toEqual({id:'a',state:'RUNNING'})
    db.exec('DROP TRIGGER scan_revision_update');expect(()=>migrateScanRevisions(db)).toThrow('incompleta')
  }finally{db.close()}
})
