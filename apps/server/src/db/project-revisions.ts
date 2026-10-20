import type Database from 'better-sqlite3'
import {randomInt} from 'node:crypto'
import {eq} from 'drizzle-orm'
import type {Db} from './client.js'
import {channelProjectVersions} from './schema.js'

const maximum=Number.MAX_SAFE_INTEGER
const tableSql=`CREATE TABLE channel_project_versions(channel_id TEXT PRIMARY KEY NOT NULL,
  version INTEGER NOT NULL CHECK(typeof(version)='integer' AND version BETWEEN 1 AND ${maximum}))`
const triggers:Record<string,string>={}
const bump=(ids:string)=>`INSERT INTO channel_project_versions SELECT id,1 FROM (${ids}) WHERE id IS NOT NULL
  ON CONFLICT(channel_id) DO UPDATE SET version=version+1;`
const owners:Record<string,(row:string)=>string>={
  channels:row=>`SELECT ${row}.id AS id`,
  ...Object.fromEntries(['output_profiles','transmission_presets','live_sources','schedule_rules','destinations','guest_keys','rundowns','secondary_events','channel_project_snapshots','as_run'].map(table=>[table,(row:string)=>`SELECT ${row}.channel_id AS id`])),
  ...Object.fromEntries(['graphic_templates','multiview_configs'].map(table=>[table,(row:string)=>`SELECT ${row}.channel_id AS id WHERE ${row}.channel_id IS NOT NULL UNION SELECT id FROM channels WHERE ${row}.channel_id IS NULL`])),
  rundown_items:row=>`SELECT channel_id AS id FROM rundowns WHERE id=${row}.rundown_id`,
  item_graphics:row=>`SELECT r.channel_id AS id FROM rundown_items i JOIN rundowns r ON r.id=i.rundown_id WHERE i.id=${row}.item_id`,
  ...Object.fromEntries(['operational_playlist_revisions','playlist_versions'].map(table=>[table,(row:string)=>`SELECT channel_id AS id FROM rundowns WHERE id=${row}.rundown_id`])),
  // Media/QC/equipment shared dependencies cannot safely be recovered from an
  // encrypted snapshot in SQL. Conservatively invalidate all channel reviews.
  ...Object.fromEntries(['media_assets','qc_decisions','external_devices'].map(table=>[table,()=>`SELECT id FROM channels`])),
}
for(const [table,owner] of Object.entries(owners))for(const action of ['INSERT','UPDATE','DELETE']){
  const ids=action==='INSERT'?owner('NEW'):action==='DELETE'?owner('OLD'):`${owner('OLD')} UNION ${owner('NEW')}`
  // BEFORE removal/update preserves old parents while they still exist.
  triggers[`project_revision_${table}_${action.toLowerCase()}`]=`${action==='INSERT'?'AFTER':'BEFORE'} ${action} ON ${table} BEGIN ${bump(ids)} END`
}
const normalize=(sql:string)=>sql.replace(/\s+/g,' ').trim()
export function validateProjectRevisions(sqlite:Database.Database):void{
  if(!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get()||!sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=24').get())return
  const table=sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='channel_project_versions'").get() as {sql:string}|undefined
  if(!table||normalize(table.sql)!==normalize(tableSql))throw new Error('Contrato das revisões de projeto ausente ou alterado. Restaure um backup validado.')
  for(const [name,body] of Object.entries(triggers)){
    const stored=sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(name) as {sql:string}|undefined
    if(!stored||normalize(stored.sql)!==normalize(`CREATE TRIGGER ${name} ${body}`))throw new Error(`Proteção de projeto ${name} ausente ou alterada. Restaure um backup validado.`)
  }
  if(sqlite.prepare("SELECT 1 FROM channel_project_versions WHERE typeof(version)<>'integer' OR version<1 OR version>? LIMIT 1").get(maximum))throw new Error('Revisão de projeto inválida.')
  if(sqlite.prepare('SELECT 1 FROM channels c WHERE NOT EXISTS(SELECT 1 FROM channel_project_versions v WHERE v.channel_id=c.id) LIMIT 1').get())throw new Error('Revisões de projeto incompletas.')
}
export function migrateProjectRevisions(sqlite:Database.Database):void{
  if(!sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=24').get())sqlite.transaction(()=>{
    const baseline=randomInt(2**40,2**48)
    sqlite.exec(`${tableSql}; INSERT INTO channel_project_versions SELECT id,${baseline} FROM channels;`)
    for(const [name,body] of Object.entries(triggers))sqlite.exec(`CREATE TRIGGER ${name} ${body}`)
    sqlite.prepare('INSERT INTO schema_migrations VALUES(24,?,?)').run('durable-project-restore-revisions',new Date().toISOString())
  })()
  validateProjectRevisions(sqlite)
}
export function projectRevision(db:Pick<Db,'select'>,channelId:string):number{
  const row=db.select().from(channelProjectVersions).where(eq(channelProjectVersions.channelId,channelId)).get()
  if(!row||!Number.isSafeInteger(row.version)||row.version<1)throw new Error('Revisão de projeto ausente/inválida; nenhuma versão será presumida.')
  return row.version
}
