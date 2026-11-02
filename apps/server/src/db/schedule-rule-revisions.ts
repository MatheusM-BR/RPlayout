import type Database from 'better-sqlite3'
import {randomInt} from 'node:crypto'
import {eq} from 'drizzle-orm'
import type {Db} from './client.js'
import {scheduleRuleVersions} from './schema.js'

const maximum=Number.MAX_SAFE_INTEGER
const table=`CREATE TABLE schedule_rule_versions(channel_id TEXT PRIMARY KEY NOT NULL,
  version INTEGER NOT NULL CHECK(typeof(version)='integer' AND version BETWEEN 1 AND ${maximum}))`
const bump=(id:string)=>`INSERT INTO schedule_rule_versions VALUES(${id},1) ON CONFLICT(channel_id) DO UPDATE SET version=version+1;`
const triggers:Record<string,string>={}
for(const [name,key]of [['channels','id'],['schedule_rules','channel_id']] as const)for(const action of ['INSERT','UPDATE','DELETE'] as const){
  const row=action==='DELETE'?'OLD':'NEW'
  triggers[`schedule_rule_revision_${name}_${action.toLowerCase()}`]=`${action==='INSERT'?'AFTER':'BEFORE'} ${action} ON ${name} BEGIN
    ${action==='UPDATE'?`INSERT INTO schedule_rule_versions SELECT OLD.${key},1 WHERE OLD.${key} IS NOT NEW.${key} ON CONFLICT(channel_id) DO UPDATE SET version=version+1;`:''}
    ${bump(`${row}.${key}`)} END`
}
const normalize=(sql:string)=>sql.replace(/\s+/g,' ').trim()
export function validateScheduleRuleRevisions(sqlite:Database.Database){
  if(!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get()||!sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=27').get())return
  const stored=sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='schedule_rule_versions'").get() as {sql:string}|undefined
  if(!stored||normalize(stored.sql)!==normalize(table))throw new Error('Contrato das revisões de faixas ausente ou adulterado. Restaure backup validado.')
  for(const [name,body]of Object.entries(triggers)){
    const stored=sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(name) as {sql:string}|undefined
    if(!stored||normalize(stored.sql)!==normalize(`CREATE TRIGGER ${name} ${body}`))throw new Error(`Proteção de faixas ${name} ausente ou adulterada.`)
  }
  if(sqlite.prepare("SELECT 1 FROM schedule_rule_versions WHERE typeof(version)<>'integer' OR version<1 OR version>? LIMIT 1").get(maximum))throw new Error('Revisão de faixas inválida.')
  if(sqlite.prepare('SELECT 1 FROM (SELECT id FROM channels UNION SELECT channel_id AS id FROM schedule_rules) c WHERE NOT EXISTS(SELECT 1 FROM schedule_rule_versions v WHERE v.channel_id=c.id) LIMIT 1').get())throw new Error('Revisões de faixas incompletas.')
}
export function migrateScheduleRuleRevisions(sqlite:Database.Database){
  if(!sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=27').get())sqlite.transaction(()=>{
    const baseline=randomInt(2**40,2**48)
    sqlite.exec(`${table}; INSERT INTO schedule_rule_versions SELECT id,${baseline} FROM (SELECT id FROM channels UNION SELECT channel_id AS id FROM schedule_rules);`)
    for(const [name,body]of Object.entries(triggers))sqlite.exec(`CREATE TRIGGER ${name} ${body}`)
    sqlite.prepare('INSERT INTO schema_migrations VALUES(27,?,?)').run('durable-schedule-rule-revisions',new Date().toISOString())
  })()
  validateScheduleRuleRevisions(sqlite)
}
export function scheduleRuleRevision(db:Pick<Db,'select'>,channelId:string){
  const row=db.select().from(scheduleRuleVersions).where(eq(scheduleRuleVersions.channelId,channelId)).get()
  if(!row||!Number.isSafeInteger(row.version)||row.version<1)throw new Error('Revisão de faixas ausente/inválida; nenhuma versão presumida.')
  return row.version
}
