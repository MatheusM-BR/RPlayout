import type Database from 'better-sqlite3'
import {z} from 'zod'
import {installationVault} from '../domain/secret-vault.js'

const maximum=Number.MAX_SAFE_INTEGER
export const executionOwnerSchema=z.object({id:z.string().uuid(),channelId:z.string().min(1),sequence:z.number().int().positive().max(maximum),host:z.string().min(1),pid:z.number().int().positive(),boot:z.string().uuid(),phase:z.enum(['ACTIVE','RELEASED','UNCERTAIN']),enginePids:z.array(z.number().int().positive()),engineTokens:z.record(z.string().uuid(),z.number().int().positive()),spawning:z.boolean(),spawnToken:z.string().uuid().nullable(),createdAt:z.string().min(1),recoveredRunId:z.string().uuid().nullable(),predecessorResolved:z.boolean(),finalRelease:z.boolean(),observationClosed:z.boolean().optional()}).strict()
export type ExecutionOwner=z.infer<typeof executionOwnerSchema>
const definitions:Record<string,string>={
  execution_owner_runs:'CREATE TABLE execution_owner_runs(id TEXT PRIMARY KEY NOT NULL,channel_id TEXT NOT NULL REFERENCES channels(id),payload TEXT NOT NULL,signature TEXT NOT NULL)',
  execution_owner_slots:`CREATE TABLE execution_owner_slots(channel_id TEXT PRIMARY KEY NOT NULL REFERENCES channels(id),run_id TEXT NOT NULL REFERENCES execution_owner_runs(id),version INTEGER NOT NULL CHECK(typeof(version)='integer' AND version BETWEEN 1 AND ${maximum}))`,
  execution_owner_asrun:'CREATE TABLE execution_owner_asrun(asrun_id TEXT PRIMARY KEY NOT NULL REFERENCES as_run(id) ON DELETE CASCADE,run_id TEXT NOT NULL REFERENCES execution_owner_runs(id),signature TEXT NOT NULL)',
}
const triggers:Record<string,string>={
  execution_owner_runs_delete:"BEFORE DELETE ON execution_owner_runs BEGIN SELECT RAISE(ABORT,'Execution ownership history cannot be deleted'); END",
  execution_owner_runs_identity:"BEFORE UPDATE OF id,channel_id ON execution_owner_runs BEGIN SELECT RAISE(ABORT,'Execution owner identity is immutable'); END",
  execution_owner_slots_delete:"BEFORE DELETE ON execution_owner_slots BEGIN SELECT RAISE(ABORT,'Execution ownership tombstone cannot be deleted'); END",
  execution_owner_slots_identity:"BEFORE UPDATE OF channel_id ON execution_owner_slots BEGIN SELECT RAISE(ABORT,'Execution slot identity is immutable'); END",
  execution_owner_slots_revision:'AFTER UPDATE OF run_id ON execution_owner_slots BEGIN UPDATE execution_owner_slots SET version=OLD.version+1 WHERE channel_id=NEW.channel_id; END',
}
const normalized=(sql:string)=>sql.replace(/\s+/g,' ').trim()
export const executionOwnerSignature=(owner:ExecutionOwner)=>installationVault().reviewIdentity(JSON.stringify(executionOwnerSchema.parse(owner)),'execution-owner:v1')
export function readExecutionRun(sqlite:Database.Database,id:string):ExecutionOwner{
  const row=sqlite.prepare('SELECT id,channel_id,payload,signature FROM execution_owner_runs WHERE id=?').get(id) as {id:string;channel_id:string;payload:string;signature:string}|undefined
  if(!row)throw new Error('Registro de posse da execução ausente; nenhum engine será aberto.')
  const owner=executionOwnerSchema.parse(JSON.parse(row.payload))
  if(owner.id!==row.id||owner.channelId!==row.channel_id||row.signature!==executionOwnerSignature(owner)||new Set(owner.enginePids).size!==owner.enginePids.length||JSON.stringify([...owner.enginePids].sort())!==JSON.stringify(Object.values(owner.engineTokens).sort())||owner.spawning!==(owner.spawnToken!==null))throw new Error('Registro de posse da execução inválido/adulterado; nenhum processo será presumido parado.')
  return owner
}
export function readExecutionOwner(sqlite:Database.Database,channelId:string):ExecutionOwner|null{
  const slot=sqlite.prepare('SELECT run_id,version FROM execution_owner_slots WHERE channel_id=?').get(channelId) as {run_id:string;version:number}|undefined
  if(!slot){if(sqlite.prepare('SELECT 1 FROM execution_owner_runs WHERE channel_id=?').get(channelId))throw new Error('Posse da execução sem slot durável.');return null}
  const owner=readExecutionRun(sqlite,slot.run_id)
  if(owner.channelId!==channelId||owner.sequence!==slot.version||!Number.isSafeInteger(slot.version)||slot.version<1)throw new Error('Posse da execução e revisão incompatíveis; abertura/recuperação recusadas.')
  return owner
}
export function validateExecutionOwnership(sqlite:Database.Database){
  const marked=sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get()&&sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=32').get()
  if(!marked){
    if(sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name IN ('execution_owner_runs','execution_owner_slots','execution_owner_asrun')").get())throw new Error('Posse da execução sem marca de migração; restauração recusada.')
    return
  }
  for(const [name,sql]of Object.entries(definitions)){
    const saved=sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(name) as {sql:string}|undefined
    if(!saved||normalized(saved.sql)!==normalized(sql))throw new Error('Proteção de posse da execução ausente/adulterada. Restaure backup validado.')
  }
  for(const [name,body]of Object.entries(triggers)){
    const saved=sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(name) as {sql:string}|undefined
    if(!saved||normalized(saved.sql)!==normalized(`CREATE TRIGGER ${name} ${body}`))throw new Error('Cerca durável de execução ausente/adulterada.')
  }
  for(const row of sqlite.prepare('SELECT id FROM execution_owner_runs').all() as {id:string}[])readExecutionRun(sqlite,row.id)
  for(const row of sqlite.prepare('SELECT channel_id FROM execution_owner_runs UNION SELECT channel_id FROM execution_owner_slots').all() as {channel_id:string}[])readExecutionOwner(sqlite,row.channel_id)
  for(const name of Object.keys(definitions))if(sqlite.prepare(`PRAGMA foreign_key_check(${name})`).all().length)throw new Error('Referência de posse da execução inválida.')
  if(sqlite.prepare('SELECT 1 FROM execution_owner_asrun w JOIN as_run a ON a.id=w.asrun_id JOIN execution_owner_runs r ON r.id=w.run_id WHERE a.channel_id<>r.channel_id LIMIT 1').get())throw new Error('As-run vinculado ao dono de outro canal.')
  for(const row of sqlite.prepare('SELECT * FROM execution_owner_asrun').all() as {asrun_id:string;run_id:string;signature:string}[])if(row.signature!==executionAsRunSignature(row.asrun_id,row.run_id))throw new Error('Vínculo de dono do as-run adulterado.')
}
export const executionAsRunSignature=(asrunId:string,runId:string)=>installationVault().reviewIdentity(JSON.stringify([asrunId,runId]),'execution-asrun-owner:v1')
export function migrateExecutionOwnership(sqlite:Database.Database){
  sqlite.transaction(()=>{
    if(sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=32').get())return
    for(const sql of Object.values(definitions))sqlite.exec(sql)
    for(const [name,body]of Object.entries(triggers))sqlite.exec(`CREATE TRIGGER ${name} ${body}`)
    sqlite.prepare('INSERT INTO schema_migrations VALUES(32,?,?)').run('durable-native-execution-ownership',new Date().toISOString())
  }).immediate()
  validateExecutionOwnership(sqlite)
}
