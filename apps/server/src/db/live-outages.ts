import type Database from 'better-sqlite3'
/** Migração 57: paradas das entradas ao vivo, presas ao registro as-run do
 * item que estava no ar. Tabela nova, só aditiva. */
const table='CREATE TABLE live_outages(id TEXT PRIMARY KEY,channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,as_run_id TEXT,item_id TEXT,source_key TEXT NOT NULL,source_name TEXT NOT NULL,started_at TEXT NOT NULL,ended_at TEXT,reasons TEXT NOT NULL,action TEXT NOT NULL,closed_by TEXT,created_at TEXT NOT NULL)'
const index='CREATE INDEX live_outages_as_run ON live_outages(as_run_id,started_at)'
const normalize=(text:string)=>text.replace(/\s+/g,' ').trim()
export function validateLiveOutages(sqlite:Database.Database){
  const marked=sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='schema_migrations' AND type='table'").get()&&sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=57').get()
  const found=sqlite.prepare("SELECT sql FROM sqlite_master WHERE name='live_outages' AND type='table'").get() as {sql:string}|undefined
  if(!marked){if(found)throw new Error('Paradas do ao vivo sem registro de migração; preserve o banco.');return}
  const idx=sqlite.prepare("SELECT sql FROM sqlite_master WHERE name='live_outages_as_run' AND type='index'").get() as {sql:string}|undefined
  if(!found||normalize(found.sql)!==table||!idx||normalize(idx.sql)!==index)throw new Error('Schema das paradas do ao vivo ausente/adulterado.')
}
export function migrateLiveOutages(sqlite:Database.Database){
  sqlite.transaction(()=>{
    if(sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=57').get())return
    validateLiveOutages(sqlite)
    sqlite.exec(table);sqlite.exec(index)
    sqlite.prepare('INSERT INTO schema_migrations VALUES(57,?,?)').run('live-input-outages-in-asrun',new Date().toISOString())
  }).immediate()
  validateLiveOutages(sqlite)
}
