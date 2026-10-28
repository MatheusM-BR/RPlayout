import type Database from 'better-sqlite3'
/** Programação multicanal: canal alvo roda o que o canal de origem publicar. */
const table='CREATE TABLE channel_mirrors(target_channel_id TEXT PRIMARY KEY REFERENCES channels(id),source_channel_id TEXT NOT NULL REFERENCES channels(id),created_by TEXT,created_at TEXT NOT NULL,last_sync_at TEXT,last_sync_error TEXT,CHECK(target_channel_id<>source_channel_id))'
const normalize=(text:string)=>text.replace(/\s+/g,' ').trim()
export function validateChannelMirrors(sqlite:Database.Database){
  const marked=sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='schema_migrations' AND type='table'").get()&&sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=51').get()
  const found=sqlite.prepare("SELECT sql FROM sqlite_master WHERE name='channel_mirrors' AND type='table'").get() as {sql:string}|undefined
  if(!marked){if(found)throw new Error('Espelhos de canal sem registro de migração; preserve o banco.');return}
  const altered=table.replace('last_sync_error TEXT,CHECK','last_sync_error TEXT, unlocked_by TEXT, unlocked_at TEXT, unlock_reason TEXT,CHECK')
  if(!found||(normalize(found.sql)!==table&&normalize(found.sql)!==normalize(altered)))throw new Error('Schema dos espelhos de canal ausente/adulterado.')
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

/** Migração 52: destrave operacional do canal espelhado. Enquanto travado, o
 * canal alvo só põe no ar a grade espelhada; o operador pode destravar com
 * motivo (fica na auditoria) e travar de novo. */
const unlockColumns=['unlocked_by','unlocked_at','unlock_reason']
export function validateMirrorUnlock(sqlite:Database.Database){
  const marked=sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='schema_migrations' AND type='table'").get()&&sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=52').get()
  const hasTable=sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='channel_mirrors' AND type='table'").get()
  const columns=hasTable?(sqlite.prepare('PRAGMA table_info(channel_mirrors)').all() as Array<{name:string;type:string;notnull:number}>):[]
  const present=unlockColumns.filter(name=>columns.some(column=>column.name===name))
  if(!marked){if(present.length)throw new Error('Destrave de espelho sem registro de migração; preserve o banco.');return}
  for(const name of unlockColumns){const column=columns.find(entry=>entry.name===name);if(!column||column.type!=='TEXT'||column.notnull)throw new Error('Schema do destrave de espelho ausente/adulterado.')}
}
export function migrateMirrorUnlock(sqlite:Database.Database){
  sqlite.transaction(()=>{
    if(sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=52').get())return
    validateMirrorUnlock(sqlite)
    for(const name of unlockColumns)sqlite.exec(`ALTER TABLE channel_mirrors ADD COLUMN ${name} TEXT`)
    sqlite.prepare('INSERT INTO schema_migrations VALUES(52,?,?)').run('mirror-operator-unlock',new Date().toISOString())
  }).immediate()
  validateMirrorUnlock(sqlite)
}
