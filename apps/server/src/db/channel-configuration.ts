import type Database from 'better-sqlite3'
import {randomInt} from 'node:crypto'
import {eq} from 'drizzle-orm'
import type {Db} from './client.js'
import {channelConfigurationVersions} from './schema.js'

const maximum=Number.MAX_SAFE_INTEGER
const tableSql=`CREATE TABLE channel_configuration_versions(channel_id TEXT PRIMARY KEY NOT NULL,
  version INTEGER NOT NULL CHECK(typeof(version)='integer' AND version BETWEEN 1 AND ${maximum}))`
const bump=(id:string)=>`INSERT INTO channel_configuration_versions VALUES(${id},1)
  ON CONFLICT(channel_id) DO UPDATE SET version=version+1;`
const triggers:Record<string,string>={
  channel_configuration_insert:`AFTER INSERT ON channels BEGIN ${bump('NEW.id')} END`,
  channel_configuration_update:`AFTER UPDATE ON channels BEGIN
    INSERT INTO channel_configuration_versions SELECT OLD.id,1 WHERE OLD.id<>NEW.id ON CONFLICT(channel_id) DO UPDATE SET version=version+1;
    ${bump('NEW.id')} END`,
  channel_configuration_delete:`BEFORE DELETE ON channels BEGIN ${bump('OLD.id')} END`,
}
for(const action of ['INSERT','UPDATE','DELETE'] as const){
  const row=action==='DELETE'?'OLD':'NEW'
  triggers[`channel_configuration_output_${action.toLowerCase()}`]=`${action==='DELETE'?'BEFORE':'AFTER'} ${action} ON output_profiles BEGIN
    ${action==='UPDATE'?`INSERT INTO channel_configuration_versions SELECT OLD.channel_id,1 WHERE OLD.channel_id<>NEW.channel_id ON CONFLICT(channel_id) DO UPDATE SET version=version+1;`:''}
    ${bump(row+'.channel_id')} END`
}
const normalize=(sql:string)=>sql.replace(/\s+/g,' ').trim()
export function validateChannelConfiguration(sqlite:Database.Database):void {
  if(!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get() || !sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=21').get())return
  const stored=sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='channel_configuration_versions'").get() as {sql:string}|undefined
  if(!stored || normalize(stored.sql)!==normalize(tableSql))throw new Error('Contrato das revisões de configuração ausente ou alterado. Restaure um backup validado.')
  for(const [name,body] of Object.entries(triggers)){
    const stored=sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(name) as {sql:string}|undefined
    if(!stored || normalize(stored.sql)!==normalize(`CREATE TRIGGER ${name} ${body}`))throw new Error(`Proteção de configuração ${name} ausente ou alterada. Restaure um backup validado.`)
  }
  if(sqlite.prepare("SELECT 1 FROM channel_configuration_versions WHERE typeof(version)<>'integer' OR version<1 OR version>? LIMIT 1").get(maximum))throw new Error('Revisão de configuração inválida.')
  if(sqlite.prepare('SELECT 1 FROM channels c WHERE NOT EXISTS(SELECT 1 FROM channel_configuration_versions v WHERE v.channel_id=c.id) LIMIT 1').get())throw new Error('Revisões de configuração incompletas.')
}
export function migrateChannelConfiguration(sqlite:Database.Database):void {
  if(!sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=21').get())sqlite.transaction(()=>{
    const baseline=randomInt(2**40,2**48)
    sqlite.exec(`${tableSql}; INSERT INTO channel_configuration_versions SELECT id,${baseline} FROM channels;`)
    for(const [name,body] of Object.entries(triggers))sqlite.exec(`CREATE TRIGGER ${name} ${body}`)
    sqlite.prepare('INSERT INTO schema_migrations VALUES(21,?,?)').run('durable-channel-configuration-revisions',new Date().toISOString())
  })()
  validateChannelConfiguration(sqlite)
}
export function configurationRevision(db:Pick<Db,'select'>,channelId:string):number {
  const row=db.select().from(channelConfigurationVersions).where(eq(channelConfigurationVersions.channelId,channelId)).get()
  if(!row || !Number.isSafeInteger(row.version) || row.version<1)throw new Error('Revisão de configuração ausente/inválida; nenhuma versão será presumida.')
  return row.version
}
