import type Database from 'better-sqlite3'
export const PROXY_RECIPE='picture-raster-v2'
/** Preserve legacy output/history. Serving a stale recipe requires regeneration. */
export function migrateProxyRecipe(sqlite:Database.Database):void{
  sqlite.transaction(()=>{
    if(sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=46').get())return
    sqlite.exec('ALTER TABLE media_jobs ADD COLUMN proxy_recipe TEXT')
    sqlite.prepare('INSERT INTO schema_migrations VALUES(46,?,?)').run('proxy-picture-raster-recipe',new Date().toISOString())
  }).immediate()
  const column=(sqlite.prepare('PRAGMA table_info(media_jobs)').all() as Array<{name:string;type:string;notnull:number}>).find(row=>row.name==='proxy_recipe')
  if(!column||column.type.toUpperCase()!=='TEXT'||column.notnull!==0)throw new Error('Schema da receita de proxy inválido.')
}
