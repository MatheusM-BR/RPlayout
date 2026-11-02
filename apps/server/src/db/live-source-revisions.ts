import type Database from 'better-sqlite3'
import {randomInt} from 'node:crypto'
import {eq} from 'drizzle-orm'
import type {Db} from './client.js'
import {liveSourceVersions} from './schema.js'

const maximum=Number.MAX_SAFE_INTEGER
const tableSql=`CREATE TABLE live_source_versions(channel_id TEXT PRIMARY KEY NOT NULL,
  version INTEGER NOT NULL CHECK(typeof(version)='integer' AND version BETWEEN 1 AND ${maximum}))`
const bump=(id:string)=>`INSERT INTO live_source_versions VALUES(${id},1)
  ON CONFLICT(channel_id) DO UPDATE SET version=version+1;`
const triggers:Record<string,string>={}
for(const [table,key]of [['channels','id'],['live_sources','channel_id']] as const){
  for(const action of ['INSERT','UPDATE','DELETE'] as const){
    const row=action==='DELETE'?'OLD':'NEW'
    triggers[`live_source_revision_${table}_${action.toLowerCase()}`]=`${action==='INSERT'?'AFTER':'BEFORE'} ${action} ON ${table} BEGIN
      ${action==='UPDATE'?`INSERT INTO live_source_versions SELECT OLD.${key},1 WHERE OLD.${key}<>NEW.${key} ON CONFLICT(channel_id) DO UPDATE SET version=version+1;`:''}
      ${bump(`${row}.${key}`)} END`
  }
}
const normalize=(sql:string)=>sql.replace(/\s+/g,' ').trim()
export function validateLiveSourceRevisions(sqlite:Database.Database):void {
  if(!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get()||!sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=25').get())return
  const stored=sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='live_source_versions'").get() as {sql:string}|undefined
  if(!stored||normalize(stored.sql)!==normalize(tableSql))throw new Error('Contrato das revisões de entradas ausente ou alterado. Restaure um backup validado.')
  for(const [name,body]of Object.entries(triggers)){
    const stored=sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(name) as {sql:string}|undefined
    if(!stored||normalize(stored.sql)!==normalize(`CREATE TRIGGER ${name} ${body}`))throw new Error(`Proteção de entradas ${name} ausente ou alterada. Restaure um backup validado.`)
  }
  if(sqlite.prepare("SELECT 1 FROM live_source_versions WHERE typeof(version)<>'integer' OR version<1 OR version>? LIMIT 1").get(maximum))throw new Error('Revisão de entradas inválida.')
  if(sqlite.prepare('SELECT 1 FROM channels c WHERE NOT EXISTS(SELECT 1 FROM live_source_versions v WHERE v.channel_id=c.id) LIMIT 1').get())throw new Error('Revisões de entradas incompletas.')
}
export function migrateLiveSourceRevisions(sqlite:Database.Database):void {
  if(!sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=25').get())sqlite.transaction(()=>{
    const baseline=randomInt(2**40,2**48)
    sqlite.exec(`${tableSql}; INSERT INTO live_source_versions SELECT id,${baseline} FROM channels;`)
    for(const [name,body]of Object.entries(triggers))sqlite.exec(`CREATE TRIGGER ${name} ${body}`)
    sqlite.prepare('INSERT INTO schema_migrations VALUES(25,?,?)').run('durable-live-source-revisions',new Date().toISOString())
  })()
  validateLiveSourceRevisions(sqlite)
}
export function liveSourceRevision(db:Pick<Db,'select'>,channelId:string):number {
  const row=db.select().from(liveSourceVersions).where(eq(liveSourceVersions.channelId,channelId)).get()
  if(!row||!Number.isSafeInteger(row.version)||row.version<1)throw new Error('Revisão de entradas ausente/inválida; nenhuma versão será presumida.')
  return row.version
}
