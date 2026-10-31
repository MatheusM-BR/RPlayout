import type Database from 'better-sqlite3'

// Force bounded point lookups. Without this covering index SQLite can prefer
// the history-by-scope index and scan a whole channel for each phase probe.
const terminal=`SELECT 1 FROM operator_decisions t INDEXED BY graphic_command_phase_identity WHERE t.id IN (
  substr(a.id,1,length(a.id)-9)||':CONFIRMED',substr(a.id,1,length(a.id)-9)||':SIMULATED',
  substr(a.id,1,length(a.id)-9)||':REJECTED',substr(a.id,1,length(a.id)-9)||':REVIEWED')
  AND t.rundown_id=a.rundown_id AND t.kind='GRAPHIC_COMMAND_'||substr(t.id,length(a.id)-7)`
const unresolvedPredicate=`a.kind='GRAPHIC_COMMAND_ACCEPTED' AND NOT EXISTS(${terminal})`
const expected=`SELECT a.id,a.rundown_id AS scope FROM operator_decisions a WHERE ${unresolvedPredicate}`
const ddl:Record<string,string>={
  graphic_command_pending:"CREATE TABLE graphic_command_pending(id TEXT PRIMARY KEY,scope TEXT NOT NULL)",
  graphic_command_pending_scope:"CREATE INDEX graphic_command_pending_scope ON graphic_command_pending(scope,id)",
  graphic_command_history:"CREATE INDEX graphic_command_history ON operator_decisions(rundown_id,kind,created_at DESC)",
  graphic_command_composition_order:"CREATE INDEX graphic_command_composition_order ON operator_decisions(rundown_id,kind)",
  graphic_command_phase_identity:"CREATE INDEX graphic_command_phase_identity ON operator_decisions(id,rundown_id,kind)",
  graphic_command_pending_accept:`CREATE TRIGGER graphic_command_pending_accept AFTER INSERT ON operator_decisions WHEN NEW.kind='GRAPHIC_COMMAND_ACCEPTED' BEGIN INSERT INTO graphic_command_pending(id,scope) SELECT a.id,a.rundown_id FROM operator_decisions a WHERE a.id=NEW.id AND ${unresolvedPredicate}; END`,
  graphic_command_pending_finish:`CREATE TRIGGER graphic_command_pending_finish AFTER INSERT ON operator_decisions WHEN NEW.kind IN ('GRAPHIC_COMMAND_CONFIRMED','GRAPHIC_COMMAND_SIMULATED','GRAPHIC_COMMAND_REJECTED','GRAPHIC_COMMAND_REVIEWED') AND substr(NEW.id,-length(substr(NEW.kind,17))-1)=':'||substr(NEW.kind,17) BEGIN DELETE FROM graphic_command_pending WHERE scope=NEW.rundown_id AND id=substr(NEW.id,1,length(NEW.id)-length(substr(NEW.kind,17))-1)||':ACCEPTED'; END`,
  graphic_command_append_only_update:"CREATE TRIGGER graphic_command_append_only_update BEFORE UPDATE ON operator_decisions WHEN OLD.kind GLOB 'GRAPHIC_COMMAND_*' OR NEW.kind GLOB 'GRAPHIC_COMMAND_*' BEGIN SELECT RAISE(ABORT,'Graphic command history is append-only'); END",
  graphic_command_append_only_delete:"CREATE TRIGGER graphic_command_append_only_delete BEFORE DELETE ON operator_decisions WHEN OLD.kind GLOB 'GRAPHIC_COMMAND_*' BEGIN SELECT RAISE(ABORT,'Graphic command history is append-only'); END",
  graphic_command_append_only_replace:"CREATE TRIGGER graphic_command_append_only_replace BEFORE INSERT ON operator_decisions WHEN EXISTS(SELECT 1 FROM operator_decisions WHERE id=NEW.id AND kind GLOB 'GRAPHIC_COMMAND_*') BEGIN SELECT RAISE(ABORT,'Graphic command history cannot be replaced'); END",
  graphic_command_pending_guard_insert:`CREATE TRIGGER graphic_command_pending_guard_insert BEFORE INSERT ON graphic_command_pending WHEN NOT EXISTS(SELECT 1 FROM operator_decisions a WHERE a.id=NEW.id AND a.rundown_id=NEW.scope AND ${unresolvedPredicate}) BEGIN SELECT RAISE(ABORT,'Pending command requires unresolved acceptance'); END`,
  graphic_command_pending_guard_delete:`CREATE TRIGGER graphic_command_pending_guard_delete BEFORE DELETE ON graphic_command_pending WHEN EXISTS(SELECT 1 FROM operator_decisions a WHERE a.id=OLD.id AND a.rundown_id=OLD.scope AND ${unresolvedPredicate}) BEGIN SELECT RAISE(ABORT,'Unresolved command cannot be removed'); END`,
  graphic_command_pending_guard_update:"CREATE TRIGGER graphic_command_pending_guard_update BEFORE UPDATE ON graphic_command_pending BEGIN SELECT RAISE(ABORT,'Pending command cannot be changed'); END",
}
const normalize=(sql:string)=>sql.trim().replace(/;$/,'').replace(/\s+/g,' ')
/** Reconcile only at admission/backup validation, not on every control tick. */
export function validateGraphicCommandPending(sqlite:Database.Database){
  const applied=sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=49').get()
  if(!applied){
    if(sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='graphic_command_pending'").get())throw new Error('Migração de comandos gráficos incompleta.')
    return
  }
  for(const [name,sql] of Object.entries(ddl)){
    const actual=sqlite.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(name) as {sql:string}|undefined
    if(!actual||normalize(actual.sql)!==normalize(sql))throw new Error('Schema de comandos gráficos inválido: '+name)
  }
  const missing=sqlite.prepare(`SELECT * FROM (${expected} EXCEPT SELECT id,scope FROM graphic_command_pending) LIMIT 1`).get()
  const extra=sqlite.prepare(`SELECT * FROM (SELECT id,scope FROM graphic_command_pending EXCEPT ${expected}) LIMIT 1`).get()
  if(missing||extra)throw new Error('Índice de comandos pendentes diverge do histórico; controle recusado.')
}
export function migrateGraphicCommandPending(sqlite:Database.Database){
  sqlite.transaction(()=>{
    if(sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=49').get())return
    for(const sql of Object.values(ddl))sqlite.exec(sql)
    sqlite.exec(`INSERT INTO graphic_command_pending(id,scope) ${expected}`)
    sqlite.prepare('INSERT INTO schema_migrations VALUES(49,?,?)').run('indexed-durable-graphic-command-pending',new Date().toISOString())
  }).immediate()
  validateGraphicCommandPending(sqlite)
}
