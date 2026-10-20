import type Database from 'better-sqlite3'

/** Old READY records cannot certify the bytes currently at their pathname.
 * Keep files/editions, but require regeneration before serving legacy cache. */
export function migrateProxyIntegrity(sqlite:Database.Database):void{
  if(!sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=34').get())sqlite.transaction(()=>{
    sqlite.exec("ALTER TABLE media_jobs ADD COLUMN output_hash TEXT CHECK(output_hash IS NULL OR (length(output_hash)=64 AND output_hash NOT GLOB '*[^0-9a-f]*'))")
    sqlite.prepare("UPDATE media_jobs SET state='FAILED',error='Proxy legado sem identidade de conteúdo. Reexecute o trabalho para gerar cache verificado.',updated_at=? WHERE kind='PROXY' AND state='READY'").run(new Date().toISOString())
    sqlite.prepare('INSERT INTO schema_migrations VALUES(34,?,?)').run('verified-proxy-cache-content',new Date().toISOString())
  })()
  const columns=sqlite.prepare('PRAGMA table_info(media_jobs)').all() as Array<{name:string;type:string}>
  if(!columns.some(column=>column.name==='output_hash'&&column.type==='TEXT'))throw new Error('Identidade do cache de mídia ausente; restaure um banco validado.')
}
