import type Database from 'better-sqlite3'
/** Migração 55: auditoria de segurança imutável.
 * Eventos de segurança ('@security': contas, sessões, login; '@mirror':
 * destrave/trava de espelho; '@qc': marcas de corte) não podem ser alterados,
 * apagados nem substituídos. Além do bloqueio por gatilho, uma cadeia de selos
 * (SHA-256 encadeado) permite detectar adulteração feita direto no arquivo
 * SQLite por quem removeu os gatilhos. Os selos guardam ids, nunca rowid:
 * VACUUM não os invalida. */
export const IMMUTABLE_SCOPES=['@security','@mirror','@qc'] as const
const scopeList=IMMUTABLE_SCOPES.map(scope=>`'${scope}'`).join(',')
const ddl:Record<string,string>={
  audit_seals:'CREATE TABLE audit_seals(seq INTEGER PRIMARY KEY AUTOINCREMENT,rows_count INTEGER NOT NULL CHECK(rows_count>0),prev_hash TEXT NOT NULL,hash TEXT NOT NULL,sealed_at TEXT NOT NULL)',
  audit_sealed_rows:'CREATE TABLE audit_sealed_rows(row_id TEXT PRIMARY KEY,seal_seq INTEGER NOT NULL REFERENCES audit_seals(seq))',
  audit_sealed_rows_seal:'CREATE INDEX audit_sealed_rows_seal ON audit_sealed_rows(seal_seq,row_id)',
  audit_immutable_update:`CREATE TRIGGER audit_immutable_update BEFORE UPDATE ON operator_decisions WHEN OLD.rundown_id IN (${scopeList}) OR NEW.rundown_id IN (${scopeList}) BEGIN SELECT RAISE(ABORT,'Auditoria de segurança é imutável'); END`,
  audit_immutable_delete:`CREATE TRIGGER audit_immutable_delete BEFORE DELETE ON operator_decisions WHEN OLD.rundown_id IN (${scopeList}) BEGIN SELECT RAISE(ABORT,'Auditoria de segurança é imutável'); END`,
  audit_immutable_replace:`CREATE TRIGGER audit_immutable_replace BEFORE INSERT ON operator_decisions WHEN EXISTS(SELECT 1 FROM operator_decisions WHERE id=NEW.id AND rundown_id IN (${scopeList})) BEGIN SELECT RAISE(ABORT,'Auditoria de segurança não pode ser substituída'); END`,
  audit_seals_no_update:"CREATE TRIGGER audit_seals_no_update BEFORE UPDATE ON audit_seals BEGIN SELECT RAISE(ABORT,'Selos de auditoria são imutáveis'); END",
  audit_seals_no_delete:"CREATE TRIGGER audit_seals_no_delete BEFORE DELETE ON audit_seals BEGIN SELECT RAISE(ABORT,'Selos de auditoria são imutáveis'); END",
  audit_sealed_rows_no_update:"CREATE TRIGGER audit_sealed_rows_no_update BEFORE UPDATE ON audit_sealed_rows BEGIN SELECT RAISE(ABORT,'Selos de auditoria são imutáveis'); END",
  audit_sealed_rows_no_delete:"CREATE TRIGGER audit_sealed_rows_no_delete BEFORE DELETE ON audit_sealed_rows BEGIN SELECT RAISE(ABORT,'Selos de auditoria são imutáveis'); END",
}
const normalize=(text:string)=>text.replace(/\s+/g,' ').trim().replace(/;$/,'')
export function validateAuditImmutable(sqlite:Database.Database){
  const marked=sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='schema_migrations' AND type='table'").get()&&sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=55').get()
  if(!marked){
    if(sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name IN ('audit_seals','audit_sealed_rows')").get())throw new Error('Selos de auditoria sem registro de migração; preserve o banco.')
    return
  }
  for(const [name,sql] of Object.entries(ddl)){
    const actual=sqlite.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(name) as {sql:string}|undefined
    if(!actual||normalize(actual.sql)!==normalize(sql))throw new Error('Proteção da auditoria ausente/adulterada: '+name)
  }
}
export function migrateAuditImmutable(sqlite:Database.Database){
  sqlite.transaction(()=>{
    if(sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=55').get())return
    validateAuditImmutable(sqlite)
    for(const sql of Object.values(ddl))sqlite.exec(sql)
    sqlite.prepare('INSERT INTO schema_migrations VALUES(55,?,?)').run('immutable-security-audit',new Date().toISOString())
  }).immediate()
  validateAuditImmutable(sqlite)
}
