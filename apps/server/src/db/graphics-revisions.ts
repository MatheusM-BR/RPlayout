import type Database from 'better-sqlite3'
import {randomInt} from 'node:crypto'
import {eq} from 'drizzle-orm'
import {graphicsScope} from '@rplayout/protocol'
import type {Db} from './client.js'
import {graphicsVersions} from './schema.js'
const maximum=Number.MAX_SAFE_INTEGER
const table=`CREATE TABLE graphics_versions(scope TEXT PRIMARY KEY NOT NULL CHECK(scope='G' OR (scope LIKE 'C:%' AND length(scope)>2)),version INTEGER NOT NULL CHECK(typeof(version)='integer' AND version BETWEEN 1 AND ${maximum}))`
const owner=(row:string,key:string)=>`CASE WHEN ${row}.${key} IS NULL THEN 'G' ELSE 'C:'||${row}.${key} END`
const bump=(scope:string)=>`INSERT INTO graphics_versions VALUES(${scope},1) ON CONFLICT(scope) DO UPDATE SET version=version+1;`
const triggers:Record<string,string>={}
for(const [table,key]of [['channels','id'],['graphic_templates','channel_id']]as const)for(const action of ['INSERT','UPDATE','DELETE']as const){
  const row=action==='DELETE'?'OLD':'NEW'
  triggers[`graphics_revision_${table}_${action.toLowerCase()}`]=`${action==='INSERT'?'AFTER':'BEFORE'} ${action} ON ${table} BEGIN
    ${action==='UPDATE'?`INSERT INTO graphics_versions SELECT ${owner('OLD',key)},1 WHERE OLD.${key} IS NOT NEW.${key} ON CONFLICT(scope) DO UPDATE SET version=version+1;`:''}
    ${bump(owner(row,key))} END`
}
const normalize=(sql:string)=>sql.replace(/\s+/g,' ').trim()
export function validateGraphicsRevisions(sqlite:Database.Database){
  if(!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get()||!sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=28').get())return
  const saved=sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='graphics_versions'").get()as {sql:string}|undefined
  if(!saved||normalize(saved.sql)!==normalize(table))throw new Error('Revisões de artes ausentes ou adulteradas. Restaure backup validado.')
  for(const [name,body]of Object.entries(triggers)){
    const saved=sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(name)as {sql:string}|undefined
    if(!saved||normalize(saved.sql)!==normalize(`CREATE TRIGGER ${name} ${body}`))throw new Error(`Proteção de artes ${name} ausente ou adulterada.`)
  }
  if(sqlite.prepare("SELECT 1 FROM graphics_versions WHERE typeof(version)<>'integer' OR version<1 OR version>? OR NOT(scope='G' OR (scope LIKE 'C:%' AND length(scope)>2)) LIMIT 1").get(maximum))throw new Error('Revisão de artes inválida.')
  for(const {scope}of [{scope:'G'},...sqlite.prepare("SELECT 'C:'||id AS scope FROM channels UNION SELECT CASE WHEN channel_id IS NULL THEN 'G' ELSE 'C:'||channel_id END AS scope FROM graphic_templates").all()as {scope:string}[]]){
    if(!sqlite.prepare('SELECT 1 FROM graphics_versions WHERE scope=?').get(scope))throw new Error('Revisões de artes incompletas.')
  }
}
export function migrateGraphicsRevisions(sqlite:Database.Database){
  if(!sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=28').get())sqlite.transaction(()=>{
    const baseline=randomInt(2**40,2**48)
    sqlite.exec(`${table};`);sqlite.prepare('INSERT INTO graphics_versions VALUES(?,?)').run('G',baseline)
    sqlite.exec(`INSERT OR IGNORE INTO graphics_versions SELECT 'C:'||id,${baseline} FROM channels;
      INSERT OR IGNORE INTO graphics_versions SELECT CASE WHEN channel_id IS NULL THEN 'G' ELSE 'C:'||channel_id END,${baseline} FROM graphic_templates;`)
    for(const [name,body]of Object.entries(triggers))sqlite.exec(`CREATE TRIGGER ${name} ${body}`)
    sqlite.prepare('INSERT INTO schema_migrations VALUES(28,?,?)').run('durable-graphics-and-slate-review',new Date().toISOString())
  })()
  validateGraphicsRevisions(sqlite)
}
export function graphicsRevision(db:Pick<Db,'select'>,id:string|null){
  const row=db.select().from(graphicsVersions).where(eq(graphicsVersions.scope,graphicsScope(id))).get()
  if(!row||!Number.isSafeInteger(row.version)||row.version<1)throw new Error('Revisão de artes ausente/inválida; nenhuma versão presumida.')
  return row.version
}
