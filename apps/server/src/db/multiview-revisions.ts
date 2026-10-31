import type Database from 'better-sqlite3'
import {randomInt} from 'node:crypto'
import {eq} from 'drizzle-orm'
import {multiviewScope} from '@rplayout/protocol'
import type {Db} from './client.js'
import {multiviewVersions} from './schema.js'
const max=Number.MAX_SAFE_INTEGER
const table=`CREATE TABLE multiview_versions(scope TEXT PRIMARY KEY NOT NULL CHECK(scope='G' OR (scope LIKE 'C:%' AND length(scope)>2)),version INTEGER NOT NULL CHECK(typeof(version)='integer' AND version BETWEEN 1 AND ${max}))`
const owner=(row:string,key:string)=>`CASE WHEN ${row}.${key} IS NULL THEN 'G' ELSE 'C:'||${row}.${key} END`
const bump=(scope:string)=>`INSERT INTO multiview_versions VALUES(${scope},1) ON CONFLICT(scope) DO UPDATE SET version=version+1;`
const triggers:Record<string,string>={}
for(const [table,key] of [['channels','id'],['live_sources','channel_id'],['multiview_configs','channel_id']] as const){
  for(const action of ['INSERT','UPDATE','DELETE'] as const){
    const row=action==='DELETE'?'OLD':'NEW',scope=owner(row,key)
    triggers[`multiview_revision_${table}_${action.toLowerCase()}`]=`${action==='INSERT'?'AFTER':'BEFORE'} ${action} ON ${table} BEGIN
      ${action==='UPDATE'?`INSERT INTO multiview_versions SELECT ${owner('OLD',key)},1 WHERE OLD.${key} IS NOT NEW.${key} ON CONFLICT(scope) DO UPDATE SET version=version+1;`:''}
      ${bump(scope)}
      ${table!=='multiview_configs'?bump("'G'"):''} END`
  }
}
const norm=(sql:string)=>sql.replace(/\s+/g,' ').trim()
export function validateMultiviewRevisions(sqlite:Database.Database){
  if(!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get()||!sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=26').get())return
  const saved=sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='multiview_versions'").get() as {sql:string}|undefined
  if(!saved||norm(saved.sql)!==norm(table))throw new Error('Revisões multiview ausentes ou adulteradas. Restaure backup validado.')
  for(const [name,body] of Object.entries(triggers)){
    const saved=sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(name) as {sql:string}|undefined
    if(!saved||norm(saved.sql)!==norm(`CREATE TRIGGER ${name} ${body}`))throw new Error(`Proteção multiview ${name} ausente ou adulterada.`)
  }
  if(sqlite.prepare("SELECT 1 FROM multiview_versions WHERE typeof(version)<>'integer' OR version<1 OR version>? OR NOT(scope='G' OR (scope LIKE 'C:%' AND length(scope)>2)) LIMIT 1").get(max))throw new Error('Revisão multiview inválida.')
  const scopes=[{scope:'G'},...sqlite.prepare("SELECT 'C:'||id AS scope FROM channels UNION SELECT CASE WHEN channel_id IS NULL THEN 'G' ELSE 'C:'||channel_id END AS scope FROM multiview_configs").all() as {scope:string}[]]
  for(const {scope} of scopes)if(!sqlite.prepare('SELECT 1 FROM multiview_versions WHERE scope=?').get(scope))throw new Error('Revisão multiview incompleta.')
}
export function migrateMultiviewRevisions(sqlite:Database.Database){
  if(!sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=26').get())sqlite.transaction(()=>{
    const baseline=randomInt(2**40,2**48)
    sqlite.exec(`${table};`)
    sqlite.prepare('INSERT INTO multiview_versions VALUES(?,?)').run('G',baseline)
    sqlite.exec(`INSERT OR IGNORE INTO multiview_versions SELECT 'C:'||id,${baseline} FROM channels;
      INSERT OR IGNORE INTO multiview_versions SELECT CASE WHEN channel_id IS NULL THEN 'G' ELSE 'C:'||channel_id END,${baseline} FROM multiview_configs;`)
    for(const [name,body] of Object.entries(triggers))sqlite.exec(`CREATE TRIGGER ${name} ${body}`)
    sqlite.prepare('INSERT INTO schema_migrations VALUES(26,?,?)').run('durable-owner-scoped-multiview-revisions',new Date().toISOString())
  })()
  validateMultiviewRevisions(sqlite)
}
export function multiviewRevision(db:Pick<Db,'select'>,id:string|null){
  const row=db.select().from(multiviewVersions).where(eq(multiviewVersions.scope,multiviewScope(id))).get()
  if(!row||!Number.isSafeInteger(row.version)||row.version<1)throw new Error('Revisão multiview ausente/inválida; nenhuma versão presumida.')
  return row.version
}
