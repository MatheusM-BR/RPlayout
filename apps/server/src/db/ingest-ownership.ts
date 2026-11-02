import type Database from 'better-sqlite3'
export function migrateIngestOwnership(sqlite:Database.Database){
  sqlite.transaction(()=>{
    if(sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=39').get())return
    for(const column of ['owner_host TEXT','owner_pid INTEGER','owner_boot TEXT'])sqlite.exec('ALTER TABLE ingest_batches ADD COLUMN '+column)
    sqlite.prepare('INSERT INTO schema_migrations VALUES(39,?,?)').run('durable-ingest-worker-ownership',new Date().toISOString())
  }).immediate()
  const columns=new Set((sqlite.prepare('PRAGMA table_info(ingest_batches)').all() as {name:string}[]).map(row=>row.name))
  for(const column of ['owner_host','owner_pid','owner_boot'])if(!columns.has(column))throw new Error('Posse do scanner incompleta.')
}
