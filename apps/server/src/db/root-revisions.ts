import type Database from 'better-sqlite3'
import {randomInt} from 'node:crypto'
import {hasRevisionMigration,validateSingletonRevision} from './revision-validation.js'
export function migrateRootRevisions(sqlite:Database.Database){
  sqlite.transaction(()=>{
    if(sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=38').get())return
    sqlite.exec('CREATE TABLE root_revision(singleton INTEGER PRIMARY KEY CHECK(singleton=1),version INTEGER NOT NULL CHECK(version>0))')
    sqlite.prepare('INSERT INTO root_revision VALUES(1,?)').run(randomInt(2**40,2**48))
    for(const operation of ['INSERT','UPDATE','DELETE'])sqlite.exec(`CREATE TRIGGER root_revision_${operation.toLowerCase()} AFTER ${operation} ON media_roots BEGIN UPDATE root_revision SET version=version+1 WHERE singleton=1; END`)
    sqlite.prepare('INSERT INTO schema_migrations VALUES(38,?,?)').run('durable-root-original-review',new Date().toISOString())
  }).immediate()
  validateRootRevisions(sqlite)
}
export function validateRootRevisions(sqlite:Database.Database):void {
  if(!hasRevisionMigration(sqlite,38,['root_revision']))return
  validateSingletonRevision(sqlite,'root_revision','Revisão das pastas ausente ou inválida.')
  for(const operation of ['insert','update','delete'])if(!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?").get('root_revision_'+operation))throw new Error('Proteção de revisões de pastas incompleta.')
}
