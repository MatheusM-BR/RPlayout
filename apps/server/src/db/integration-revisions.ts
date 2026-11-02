import type Database from 'better-sqlite3'
import {randomInt} from 'node:crypto'
import {hasRevisionMigration,validateSingletonRevision} from './revision-validation.js'
export function migrateIntegrationRevisions(sqlite:Database.Database){
  sqlite.transaction(()=>{
    if(sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=37').get())return
    const baseline=randomInt(2**40,2**48)
    sqlite.exec(`CREATE TABLE integration_revision(singleton INTEGER PRIMARY KEY CHECK(singleton=1),version INTEGER NOT NULL CHECK(version>0));
      CREATE TABLE integration_delivery_versions(id TEXT PRIMARY KEY,version INTEGER NOT NULL CHECK(version>0));
      ALTER TABLE integration_deliveries ADD COLUMN owner_host TEXT;
      ALTER TABLE integration_deliveries ADD COLUMN owner_pid INTEGER;
      ALTER TABLE integration_deliveries ADD COLUMN owner_boot TEXT;
      ALTER TABLE integration_deliveries ADD COLUMN manual_test INTEGER NOT NULL DEFAULT 0 CHECK(manual_test IN(0,1));`)
    sqlite.prepare('INSERT INTO integration_revision VALUES(1,?)').run(baseline)
    sqlite.prepare('INSERT INTO integration_delivery_versions SELECT id,? FROM integration_deliveries').run(baseline)
    for(const op of ['INSERT','UPDATE','DELETE'])sqlite.exec(`CREATE TRIGGER integration_revision_${op.toLowerCase()} AFTER ${op} ON integrations BEGIN UPDATE integration_revision SET version=version+1 WHERE singleton=1; END`)
    for(const op of ['INSERT','UPDATE','DELETE'])sqlite.exec(`CREATE TRIGGER integration_delivery_revision_${op.toLowerCase()} AFTER ${op} ON integration_deliveries BEGIN INSERT INTO integration_delivery_versions(id,version) VALUES(${op==='DELETE'?'OLD':'NEW'}.id,${baseline}) ON CONFLICT(id) DO UPDATE SET version=version+1; END`)
    sqlite.prepare("UPDATE integration_deliveries SET state='FAILED',last_error='Envio legado sem responsável identificável. Confirme o encerramento anterior antes de solicitar reenvio.' WHERE state='SENDING'").run()
    sqlite.prepare('INSERT INTO schema_migrations VALUES(37,?,?)').run('integration-original-review-and-delivery-ownership',new Date().toISOString())
  }).immediate()
  validateIntegrationRevisions(sqlite)
}
export function validateIntegrationRevisions(sqlite:Database.Database):void {
  if(!hasRevisionMigration(sqlite,37,['integration_revision','integration_delivery_versions']))return
  validateSingletonRevision(sqlite,'integration_revision','Revisão de integrações ausente/inválida.')
  for(const prefix of ['integration_revision','integration_delivery_revision'])for(const op of ['insert','update','delete'])if(!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?").get(`${prefix}_${op}`))throw new Error('Proteção de revisão de integrações incompleta.')
  for(const name of ['owner_host','owner_pid','owner_boot','manual_test'])if(!(sqlite.prepare('PRAGMA table_info(integration_deliveries)').all() as {name:string}[]).some(row=>row.name===name))throw new Error('Identidade da fila de integrações ausente.')
  if(sqlite.prepare("SELECT 1 FROM integration_delivery_versions WHERE typeof(version)<>'integer' OR version<1 OR version>? LIMIT 1").get(Number.MAX_SAFE_INTEGER))throw new Error('Revisão de entrega inválida.')
  if(sqlite.prepare('SELECT 1 FROM integration_deliveries d LEFT JOIN integration_delivery_versions v ON v.id=d.id WHERE v.id IS NULL LIMIT 1').get())throw new Error('Revisões de entregas incompletas.')
}
