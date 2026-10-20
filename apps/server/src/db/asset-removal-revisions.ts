import type Database from 'better-sqlite3'
import {randomInt} from 'node:crypto'
const maximum=Number.MAX_SAFE_INTEGER
const table=`CREATE TABLE asset_removal_versions(scope TEXT PRIMARY KEY NOT NULL CHECK(scope IN ('PRUNE','PUBLICATIONS','REFERENCES','PROTECTIONS') OR (scope LIKE 'A:%' AND length(scope)>2)),version INTEGER NOT NULL CHECK(typeof(version)='integer' AND version BETWEEN 1 AND ${maximum}))`
const bump=(scope:string)=>`INSERT INTO asset_removal_versions VALUES(${scope},1) ON CONFLICT(scope) DO UPDATE SET version=version+1;`
const triggers:Record<string,string>={}
for(const action of ['INSERT','UPDATE','DELETE'] as const){
  const rows=action==='UPDATE'?['OLD','NEW']:action==='DELETE'?['OLD']:['NEW']
  const assetIds=rows.map(row=>`SELECT ${row}.id AS id`).join(' UNION ')
  triggers[`asset_removal_assets_${action.toLowerCase()}`]=`${action==='INSERT'?'AFTER':'BEFORE'} ${action} ON media_assets BEGIN
    INSERT INTO asset_removal_versions SELECT 'A:'||id,1 FROM (${assetIds}) WHERE 1 ON CONFLICT(scope) DO UPDATE SET version=version+1;
    INSERT INTO asset_removal_versions SELECT 'PRUNE',1 WHERE ${rows.map(row=>`${row}.probe_error IS NOT NULL`).join(' OR ')} ON CONFLICT(scope) DO UPDATE SET version=version+1; END`
  const references=rows.flatMap(row=>[`SELECT ${row}.media_id AS id`,`SELECT ${row}.live_fallback_media_id AS id`]).join(' UNION ')
  triggers[`asset_removal_items_${action.toLowerCase()}`]=`${action==='INSERT'?'AFTER':'BEFORE'} ${action} ON rundown_items BEGIN
    INSERT INTO asset_removal_versions SELECT 'A:'||id,1 FROM (${references}) WHERE id IS NOT NULL ON CONFLICT(scope) DO UPDATE SET version=version+1; END`
  triggers[`asset_removal_publications_${action.toLowerCase()}`]=`${action==='INSERT'?'AFTER':'BEFORE'} ${action} ON operational_playlist_revisions BEGIN ${bump("'PUBLICATIONS'")} END`
}
for(const source of ['channel_project_snapshots','channel_cadence_conversions','channel_operational_policies'])for(const action of ['INSERT','UPDATE','DELETE']){
  triggers[`asset_removal_${source}_${action.toLowerCase()}`]=`${action==='INSERT'?'AFTER':'BEFORE'} ${action} ON ${source} BEGIN ${bump("'REFERENCES'")} END`
}
const normalized=(sql:string)=>sql.replace(/\s+/g,' ').trim()
for(const action of ['INSERT','UPDATE','DELETE']){
  const rows=action==='UPDATE'?['OLD','NEW']:action==='DELETE'?['OLD']:['NEW']
  const relevant=rows.map(row=>`${row}.kind IN ('PLAYLIST_BOUNDARY','CHANNEL_CONFIGURATION_SLOT','INTERRUPTION_COMMAND','OPERATIONAL_INSERT_COMMAND','PUBLISHED_CONTINUITY_POLICY')`).join(' OR ')
  triggers[`asset_removal_protections_${action.toLowerCase()}`]=`${action==='INSERT'?'AFTER':'BEFORE'} ${action} ON operator_decisions WHEN ${relevant} BEGIN ${bump("'PROTECTIONS'")} END`
}
export function validateAssetRemovalRevisions(sqlite:Database.Database){
  if(!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get()||!sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=31').get())return
  const saved=sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='asset_removal_versions'").get() as {sql:string}|undefined
  if(!saved||normalized(saved.sql)!==normalized(table))throw new Error('Revisões de remoção ausentes/adulteradas. Restaure backup validado.')
  for(const [name,body]of Object.entries(triggers)){
    const saved=sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(name) as {sql:string}|undefined
    if(!saved||normalized(saved.sql)!==normalized(`CREATE TRIGGER ${name} ${body}`))throw new Error('Proteção de remoção ausente/adulterada.')
  }
  if(sqlite.prepare("SELECT 1 FROM asset_removal_versions WHERE typeof(version)<>'integer' OR version<1 OR version>? LIMIT 1").get(maximum))throw new Error('Revisão de remoção inválida.')
  if(!sqlite.prepare("SELECT 1 FROM asset_removal_versions WHERE scope='REFERENCES'").get())throw new Error('Revisão de referências ausente.')
  if(!sqlite.prepare("SELECT 1 FROM asset_removal_versions WHERE scope='PROTECTIONS'").get())throw new Error('Revisão de proteção ausente.')
  for(const {scope}of [{scope:'PRUNE'},{scope:'PUBLICATIONS'},...sqlite.prepare("SELECT 'A:'||id AS scope FROM media_assets UNION SELECT 'A:'||media_id FROM rundown_items WHERE media_id IS NOT NULL UNION SELECT 'A:'||live_fallback_media_id FROM rundown_items WHERE live_fallback_media_id IS NOT NULL").all() as {scope:string}[]])if(!sqlite.prepare('SELECT 1 FROM asset_removal_versions WHERE scope=?').get(scope))throw new Error('Revisões de remoção incompletas.')
}
export function migrateAssetRemovalRevisions(sqlite:Database.Database){
  sqlite.transaction(()=>{
    if(sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=31').get())return
    const baseline=randomInt(2**40,2**48);sqlite.exec(`${table};`)
    for(const scope of ['PRUNE','PUBLICATIONS','REFERENCES','PROTECTIONS'])sqlite.prepare('INSERT INTO asset_removal_versions VALUES(?,?)').run(scope,baseline)
    sqlite.exec(`INSERT OR IGNORE INTO asset_removal_versions SELECT 'A:'||id,${baseline} FROM media_assets;
      INSERT OR IGNORE INTO asset_removal_versions SELECT 'A:'||media_id,${baseline} FROM rundown_items WHERE media_id IS NOT NULL;
      INSERT OR IGNORE INTO asset_removal_versions SELECT 'A:'||live_fallback_media_id,${baseline} FROM rundown_items WHERE live_fallback_media_id IS NOT NULL;`)
    for(const [name,body]of Object.entries(triggers))sqlite.exec(`CREATE TRIGGER ${name} ${body}`)
    sqlite.prepare('INSERT INTO schema_migrations VALUES(31,?,?)').run('durable-asset-removal-impact',new Date().toISOString())
  }).immediate()
  validateAssetRemovalRevisions(sqlite)
}
export function assetRemovalRevision(sqlite:Database.Database,scope:string){
  const row=sqlite.prepare('SELECT version FROM asset_removal_versions WHERE scope=?').get(scope) as {version:number}|undefined
  if(!row||!Number.isSafeInteger(row.version)||row.version<1)throw new Error('Revisão de remoção ausente/inválida; nenhuma versão presumida.')
  return row.version
}
