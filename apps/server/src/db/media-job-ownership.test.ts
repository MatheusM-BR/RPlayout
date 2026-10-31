import Database from 'better-sqlite3'
import {describe,it,expect} from 'vitest'
import {migrateMediaJobOwnership} from './media-job-ownership.js'
describe('migração durável de dono de job',()=>{
  it('preserva catálogo/job e diagnostica somente RUNNING legado sem presumir encerramento',()=>{
    const sqlite=new Database(':memory:')
    try{
      sqlite.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT,applied_at TEXT);CREATE TABLE media_jobs(id TEXT PRIMARY KEY,state TEXT,error TEXT,updated_at TEXT);INSERT INTO media_jobs VALUES('a','RUNNING',NULL,'old'),('b','READY',NULL,'old'),('c','PENDING',NULL,'old')")
      migrateMediaJobOwnership(sqlite);migrateMediaJobOwnership(sqlite)
      expect(sqlite.prepare('SELECT id,state FROM media_jobs ORDER BY id').all()).toEqual([{id:'a',state:'FAILED'},{id:'b',state:'READY'},{id:'c',state:'PENDING'}])
      expect(sqlite.prepare('SELECT COUNT(*) AS n FROM schema_migrations WHERE version=35').get()).toEqual({n:1})
    }finally{sqlite.close()}
  })
})
