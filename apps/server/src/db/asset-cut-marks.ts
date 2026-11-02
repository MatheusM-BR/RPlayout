import type Database from 'better-sqlite3'
/** Migração 54: trechos de um VT que podem ser cortados para alinhar horário
 * (marcados no QC). Presos à versão do arquivo (content_hash): arquivo trocado,
 * marcação antiga não vale. Tempo em milissegundos de mídia: independe da
 * cadência do canal; vira quadros só na hora de aplicar. */
const table='CREATE TABLE asset_cut_marks(id TEXT PRIMARY KEY,asset_id TEXT NOT NULL REFERENCES media_assets(id),content_hash TEXT NOT NULL,from_ms INTEGER NOT NULL CHECK(from_ms>=0),to_ms INTEGER NOT NULL,label TEXT,created_by TEXT,created_at TEXT NOT NULL,CHECK(to_ms>from_ms))'
const index='CREATE INDEX asset_cut_marks_asset ON asset_cut_marks(asset_id,content_hash)'
const normalize=(text:string)=>text.replace(/\s+/g,' ').trim()
export function validateAssetCutMarks(sqlite:Database.Database){
  const marked=sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='schema_migrations' AND type='table'").get()&&sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=54').get()
  const found=sqlite.prepare("SELECT sql FROM sqlite_master WHERE name='asset_cut_marks' AND type='table'").get() as {sql:string}|undefined
  if(!marked){if(found)throw new Error('Marcações de corte sem registro de migração; preserve o banco.');return}
  const idx=sqlite.prepare("SELECT sql FROM sqlite_master WHERE name='asset_cut_marks_asset' AND type='index'").get() as {sql:string}|undefined
  if(!found||normalize(found.sql)!==table||!idx||normalize(idx.sql)!==index)throw new Error('Schema das marcações de corte ausente/adulterado.')
}
export function migrateAssetCutMarks(sqlite:Database.Database){
  sqlite.transaction(()=>{
    if(sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=54').get())return
    validateAssetCutMarks(sqlite)
    sqlite.exec(table);sqlite.exec(index)
    sqlite.prepare('INSERT INTO schema_migrations VALUES(54,?,?)').run('qc-asset-cut-marks',new Date().toISOString())
  }).immediate()
  validateAssetCutMarks(sqlite)
}
