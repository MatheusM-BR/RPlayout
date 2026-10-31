import type Database from 'better-sqlite3'
import { LiveWatchdogPolicySchema, normalizeLiveWatchdogPolicy, type LiveWatchdogPolicy } from '@rplayout/protocol'
/** Migração 56: política do watchdog das entradas ao vivo, por canal.
 * Tabela nova e só aditiva: nenhuma coluna ou linha existente é alterada.
 * Sem linha, vale o padrão (só alerta). */
const table='CREATE TABLE live_watchdog_policies(channel_id TEXT PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,payload TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>=1),updated_at TEXT NOT NULL,updated_by TEXT)'
const normalize=(text:string)=>text.replace(/\s+/g,' ').trim()
export function validateLiveWatchdogPolicies(sqlite:Database.Database){
  const marked=sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='schema_migrations' AND type='table'").get()&&sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=56').get()
  const found=sqlite.prepare("SELECT sql FROM sqlite_master WHERE name='live_watchdog_policies' AND type='table'").get() as {sql:string}|undefined
  if(!marked){if(found)throw new Error('Política do watchdog sem registro de migração; preserve o banco.');return}
  if(!found||normalize(found.sql)!==table)throw new Error('Schema da política do watchdog ausente/adulterado.')
}
export function migrateLiveWatchdogPolicies(sqlite:Database.Database){
  sqlite.transaction(()=>{
    if(sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=56').get())return
    validateLiveWatchdogPolicies(sqlite)
    sqlite.exec(table)
    sqlite.prepare('INSERT INTO schema_migrations VALUES(56,?,?)').run('live-input-watchdog-policies',new Date().toISOString())
  }).immediate()
  validateLiveWatchdogPolicies(sqlite)
}
export interface StoredLiveWatchdogPolicy {policy:LiveWatchdogPolicy;revision:number;updatedAt:string|null;updatedBy:string|null}
export function readLiveWatchdogPolicy(sqlite:Database.Database,channelId:string):StoredLiveWatchdogPolicy{
  const row=sqlite.prepare('SELECT payload,revision,updated_at AS updatedAt,updated_by AS updatedBy FROM live_watchdog_policies WHERE channel_id=?').get(channelId) as {payload:string;revision:number;updatedAt:string;updatedBy:string|null}|undefined
  if(!row)return {policy:normalizeLiveWatchdogPolicy(null),revision:0,updatedAt:null,updatedBy:null}
  let payload:unknown=null
  try{payload=JSON.parse(row.payload)}catch{/* corrompido: padrão seguro (só alerta) */}
  return {policy:normalizeLiveWatchdogPolicy(payload),revision:row.revision,updatedAt:row.updatedAt,updatedBy:row.updatedBy}
}
/** Grava com controle de revisão: quem salvou por cima de outra edição recebe conflito. */
export function writeLiveWatchdogPolicy(sqlite:Database.Database,channelId:string,policy:LiveWatchdogPolicy,expectedRevision:number,actor:string|null):StoredLiveWatchdogPolicy{
  const checked=LiveWatchdogPolicySchema.parse(policy)
  return sqlite.transaction(()=>{
    const current=sqlite.prepare('SELECT revision FROM live_watchdog_policies WHERE channel_id=?').get(channelId) as {revision:number}|undefined
    if((current?.revision??0)!==expectedRevision)throw Object.assign(new Error('A configuração do watchdog mudou desde que foi aberta. Recarregue antes de salvar.'),{status:409})
    const revision=(current?.revision??0)+1,updatedAt=new Date().toISOString()
    sqlite.prepare(`INSERT INTO live_watchdog_policies(channel_id,payload,revision,updated_at,updated_by) VALUES(?,?,?,?,?)
      ON CONFLICT(channel_id) DO UPDATE SET payload=excluded.payload,revision=excluded.revision,updated_at=excluded.updated_at,updated_by=excluded.updated_by`).run(channelId,JSON.stringify(checked),revision,updatedAt,actor)
    return {policy:checked,revision,updatedAt,updatedBy:actor}
  }).immediate()
}
