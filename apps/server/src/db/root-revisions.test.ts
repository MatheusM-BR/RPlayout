import Database from 'better-sqlite3'
import {it,expect} from 'vitest'
import {migrateRootRevisions} from './root-revisions.js'
it('migração idempotente preserva cadastro e invalida same-value e ABA; proteção incompleta recusa',()=>{
  const db=new Database(':memory:')
  try{
    db.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT,applied_at TEXT);CREATE TABLE media_roots(id TEXT PRIMARY KEY,path TEXT,label TEXT,created_at TEXT);INSERT INTO media_roots VALUES('a','C:/Programação Çãó','Ao vivo','old')")
    migrateRootRevisions(db);const read=()=>Number((db.prepare('SELECT version FROM root_revision').get() as {version:number}).version),first=read()
    migrateRootRevisions(db);expect(read()).toBe(first)
    db.exec('UPDATE media_roots SET label=label');expect(read()).toBe(first+1)
    db.exec("DELETE FROM media_roots;INSERT INTO media_roots VALUES('a','C:/Programação Çãó','Ao vivo','old')")
    expect(read()).toBe(first+3);expect(db.prepare('SELECT id,path,label FROM media_roots').get()).toEqual({id:'a',path:'C:/Programação Çãó',label:'Ao vivo'})
    db.exec('DROP TRIGGER root_revision_update');expect(()=>migrateRootRevisions(db)).toThrow('incompleta')
  }finally{db.close()}
})
