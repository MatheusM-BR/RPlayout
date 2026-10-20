import type Database from 'better-sqlite3'

/** Legacy items intentionally stay unbound; endpoint equality cannot identify
 * one of multiple configured sources. Publication freezes this value. */
export function migrateItemSourceBindings(sqlite: Database.Database): void {
  sqlite.transaction(() => {
    if (sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=45').get()) return
    sqlite.exec('ALTER TABLE rundown_items ADD COLUMN configured_source_id TEXT')
    sqlite.prepare('INSERT INTO schema_migrations VALUES(45,?,?)').run('explicit-item-source-binding', new Date().toISOString())
  }).immediate()
  const column=(sqlite.prepare('PRAGMA table_info(rundown_items)').all() as Array<{name:string;type:string;notnull:number}>).find(row=>row.name==='configured_source_id')
  if(!column || column.type.toUpperCase()!=='TEXT' || column.notnull!==0)throw new Error('Schema da identidade de entrada inválido. Nenhuma seleção deve ser inferida por endereço.')
}
