import type Database from 'better-sqlite3'
import {randomInt} from 'node:crypto'
import {hasRevisionMigration,validateSingletonRevision} from './revision-validation.js'
export function migrateScanRevisions(sqlite:Database.Database){
  sqlite.transaction(()=>{
    if(sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=40').get())return
    sqlite.exec('CREATE TABLE scan_revision(singleton INTEGER PRIMARY KEY CHECK(singleton=1),version INTEGER NOT NULL CHECK(version>0))')
    sqlite.prepare('INSERT INTO scan_revision VALUES(1,?)').run(randomInt(2**40,2**48))
    for(const operation of ['INSERT','UPDATE','DELETE'])sqlite.exec(`CREATE TRIGGER scan_revision_${operation.toLowerCase()} AFTER ${operation} ON ingest_batches BEGIN UPDATE scan_revision SET version=version+1 WHERE singleton=1; END`)
    sqlite.prepare('INSERT INTO schema_migrations VALUES(40,?,?)').run('durable-scan-original-review',new Date().toISOString())
  }).immediate()
  validateScanRevisions(sqlite)
}
export function validateScanRevisions(sqlite:Database.Database):void {
  if(!hasRevisionMigration(sqlite,40,['scan_revision']))return
  validateSingletonRevision(sqlite,'scan_revision','Revisão do scanner indisponível.')
  for(const operation of ['insert','update','delete'])if(!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?").get('scan_revision_'+operation))throw new Error('Proteção de revisões do scanner incompleta.')
}
