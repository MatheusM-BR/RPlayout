import Database from 'better-sqlite3'
import {it,expect} from 'vitest'
import {migrateIngestOwnership} from './ingest-ownership.js'
it('migração preserva RUNNING legado sem inventar dono ou presumir morte; idempotente',()=>{
  const db=new Database(':memory:')
  try{
    db.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT,applied_at TEXT);CREATE TABLE ingest_batches(id TEXT PRIMARY KEY,roots TEXT,measure INTEGER,state TEXT,error TEXT,created_at TEXT,updated_at TEXT);INSERT INTO ingest_batches VALUES('old','[]',0,'RUNNING',NULL,'old','old')")
    migrateIngestOwnership(db);migrateIngestOwnership(db)
    expect(db.prepare('SELECT id,state,owner_host,owner_pid,owner_boot FROM ingest_batches').get()).toEqual({id:'old',state:'RUNNING',owner_host:null,owner_pid:null,owner_boot:null})
    expect(db.prepare('SELECT COUNT(*) n FROM schema_migrations WHERE version=39').get()).toEqual({n:1})
  }finally{db.close()}
})
