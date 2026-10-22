import type Database from 'better-sqlite3'
const table='CREATE TABLE backup_upgrade_requests(request_id TEXT PRIMARY KEY,phase TEXT NOT NULL,report TEXT NOT NULL,creator TEXT)'
const normalize=(text:string)=>text.replace(/\s+/g,' ').trim()
export function validateUpgradeBackupRequests(sqlite:Database.Database){
  const marked=sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='schema_migrations' AND type='table'").get()&&sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=50').get()
  const found=sqlite.prepare("SELECT sql FROM sqlite_master WHERE name='backup_upgrade_requests' AND type='table'").get() as {sql:string}|undefined
  if(!marked){if(found)throw new Error('Pedidos de backup sem registro de migração; preserve o banco.');return}
  if(!found||normalize(found.sql)!==table)throw new Error('Schema dos pedidos de backup ausente/adulterado.')
}
export function migrateUpgradeBackupRequests(sqlite:Database.Database){
  sqlite.transaction(()=>{
    if(sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=50').get())return
    validateUpgradeBackupRequests(sqlite)
    sqlite.exec(table)
    sqlite.prepare('INSERT INTO schema_migrations VALUES(50,?,?)').run('durable-upgrade-backup-requests',new Date().toISOString())
  }).immediate()
  validateUpgradeBackupRequests(sqlite)
}
