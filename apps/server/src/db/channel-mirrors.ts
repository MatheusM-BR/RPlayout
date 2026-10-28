import type Database from 'better-sqlite3'
/** Programação multicanal: canal alvo roda o que o canal de origem publicar. */
const table='CREATE TABLE channel_mirrors(target_channel_id TEXT PRIMARY KEY REFERENCES channels(id),source_channel_id TEXT NOT NULL REFERENCES channels(id),created_by TEXT,created_at TEXT NOT NULL,last_sync_at TEXT,last_sync_error TEXT,CHECK(target_channel_id<>source_channel_id))'
const normalize=(text:string)=>text.replace(/\s+/g,' ').trim()
export function validateChannelMirrors(sqlite:Database.Database){
  const marked=sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='schema_migrations' AND type='table'").get()&&sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=51').get()
  const found=sqlite.prepare("SELECT sql FROM sqlite_master WHERE name='channel_mirrors' AND type='table'").get() as {sql:string}|undefined
  if(!marked){if(found)throw new Error('Espelhos de canal sem registro de migração; preserve o banco.');return}
  if(!found||normalize(found.sql)!==table)throw new Error('Schema dos espelhos de canal ausente/adulterado.')
}
export function migrateChannelMirrors(sqlite:Database.Database){
  sqlite.transaction(()=>{
    if(sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=51').get())return
    validateChannelMirrors(sqlite)
    sqlite.exec(table)
    sqlite.prepare('INSERT INTO schema_migrations VALUES(51,?,?)').run('multichannel-programming-mirrors',new Date().toISOString())
  }).immediate()
  validateChannelMirrors(sqlite)
}
