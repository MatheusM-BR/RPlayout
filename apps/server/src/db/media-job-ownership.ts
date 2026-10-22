import type Database from 'better-sqlite3'
/** Ownership is durable, not an in-memory busy flag shared only by one app. */
export function migrateMediaJobOwnership(sqlite:Database.Database):void {
  sqlite.transaction(()=>{
    if(sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=35').get())return
    sqlite.exec('ALTER TABLE media_jobs ADD COLUMN owner_host TEXT; ALTER TABLE media_jobs ADD COLUMN owner_pid INTEGER; ALTER TABLE media_jobs ADD COLUMN owner_boot TEXT;')
    sqlite.prepare("UPDATE media_jobs SET state='FAILED',error='Trabalho legado sem responsável identificável. Confira se o servidor anterior encerrou antes de solicitar nova tentativa.',updated_at=? WHERE state='RUNNING'").run(new Date().toISOString())
    sqlite.prepare('INSERT INTO schema_migrations VALUES(35,?,?)').run('durable-media-job-ownership',new Date().toISOString())
  }).immediate()
  const columns=sqlite.prepare('PRAGMA table_info(media_jobs)').all() as {name:string}[]
  if(!['owner_host','owner_pid','owner_boot'].every(name=>columns.some(column=>column.name===name)))throw new Error('Identidade dos trabalhos de mídia ausente; restaure um banco validado.')
}
