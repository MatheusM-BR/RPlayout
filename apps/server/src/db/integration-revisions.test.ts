import Database from 'better-sqlite3'
import {it,expect} from 'vitest'
import {migrateIntegrationRevisions} from './integration-revisions.js'
it('migração preserva destinos/IDs, diagnostica SENDING legado e conserva tombstones de revisão',()=>{
  const db=new Database(':memory:')
  try{
    db.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT,applied_at TEXT);CREATE TABLE integrations(id TEXT PRIMARY KEY,url TEXT,enabled INTEGER);CREATE TABLE integration_deliveries(id TEXT PRIMARY KEY,state TEXT,last_error TEXT,target TEXT);INSERT INTO integrations VALUES('gw','PRIVATE',1);INSERT INTO integration_deliveries VALUES('d','SENDING',NULL,'PRIVATE'),('q','QUEUED',NULL,'PRIVATE')")
    migrateIntegrationRevisions(db);const rev=()=>Number((db.prepare('SELECT version FROM integration_revision').get() as {version:number}).version),before=rev()
    migrateIntegrationRevisions(db);expect(rev()).toBe(before)
    expect(db.prepare('SELECT id,state,target FROM integration_deliveries ORDER BY id').all()).toEqual([{id:'d',state:'FAILED',target:'PRIVATE'},{id:'q',state:'QUEUED',target:'PRIVATE'}])
    db.exec('UPDATE integrations SET enabled=enabled');expect(rev()).toBe(before+1)
    const version=Number((db.prepare("SELECT version FROM integration_delivery_versions WHERE id='q'").get() as {version:number}).version)
    db.exec("DELETE FROM integration_deliveries WHERE id='q';INSERT INTO integration_deliveries(id,state,target) VALUES('q','QUEUED','PRIVATE')")
    expect((db.prepare("SELECT version FROM integration_delivery_versions WHERE id='q'").get() as {version:number}).version).toBe(version+2)
    db.exec('DROP TRIGGER integration_delivery_revision_update');expect(()=>migrateIntegrationRevisions(db)).toThrow('incompleta')
  }finally{db.close()}
})
