import type Database from 'better-sqlite3'
import {z} from 'zod'
import {installationVault} from '../domain/secret-vault.js'
const maximum=Number.MAX_SAFE_INTEGER
export const distributionOwnerSchema=z.object({id:z.string().uuid(),sequence:z.number().int().positive().max(maximum),host:z.string().min(1),pid:z.number().int().positive(),boot:z.string().uuid(),phase:z.enum(['ACTIVE','RELEASED']),createdAt:z.string().min(1),children:z.record(z.string().uuid(),z.object({resource:z.string().min(1),pid:z.number().int().positive().nullable()}).strict())}).strict()
export type DistributionOwner=z.infer<typeof distributionOwnerSchema>
const tables:Record<string,string>={
  distribution_owner_runs:'CREATE TABLE distribution_owner_runs(id TEXT PRIMARY KEY NOT NULL,payload TEXT NOT NULL,signature TEXT NOT NULL)',
  distribution_owner_slot:`CREATE TABLE distribution_owner_slot(id INTEGER PRIMARY KEY CHECK(id=1),run_id TEXT NOT NULL REFERENCES distribution_owner_runs(id),version INTEGER NOT NULL CHECK(typeof(version)='integer' AND version BETWEEN 1 AND ${maximum}))`,
}
const triggers:Record<string,string>={
  distribution_owner_runs_delete:"BEFORE DELETE ON distribution_owner_runs BEGIN SELECT RAISE(ABORT,'Distribution ownership history cannot be deleted'); END",
  distribution_owner_runs_identity:"BEFORE UPDATE OF id ON distribution_owner_runs BEGIN SELECT RAISE(ABORT,'Distribution owner identity is immutable'); END",
  distribution_owner_slot_delete:"BEFORE DELETE ON distribution_owner_slot BEGIN SELECT RAISE(ABORT,'Distribution ownership tombstone cannot be deleted'); END",
  distribution_owner_slot_identity:"BEFORE UPDATE OF id ON distribution_owner_slot BEGIN SELECT RAISE(ABORT,'Distribution slot identity is immutable'); END",
  distribution_owner_slot_revision:'AFTER UPDATE OF run_id ON distribution_owner_slot BEGIN UPDATE distribution_owner_slot SET version=OLD.version+1 WHERE id=NEW.id; END',
}
const normalized=(sql:string)=>sql.replace(/\s+/g,' ').trim()
export const distributionOwnerSignature=(owner:DistributionOwner)=>installationVault().reviewIdentity(JSON.stringify(distributionOwnerSchema.parse(owner)),'distribution-owner:v1')
export function readDistributionRun(sqlite:Database.Database,id:string):DistributionOwner{
  const row=sqlite.prepare('SELECT * FROM distribution_owner_runs WHERE id=?').get(id) as {id:string;payload:string;signature:string}|undefined
  if(!row)throw new Error('Registro de distribuição ausente; nenhum recurso será aberto.')
  const owner=distributionOwnerSchema.parse(JSON.parse(row.payload)),children=Object.values(owner.children)
  if(owner.id!==row.id||row.signature!==distributionOwnerSignature(owner)||new Set(children.map(child=>child.resource)).size!==children.length||new Set(children.flatMap(child=>child.pid===null?[]:[child.pid])).size!==children.filter(child=>child.pid!==null).length)throw new Error('Registro de distribuição inválido/adulterado; nenhuma parada será presumida.')
  return owner
}
export function readDistributionOwner(sqlite:Database.Database):DistributionOwner|null{
  const slot=sqlite.prepare('SELECT run_id,version FROM distribution_owner_slot WHERE id=1').get() as {run_id:string;version:number}|undefined
  if(!slot){if(sqlite.prepare('SELECT 1 FROM distribution_owner_runs LIMIT 1').get())throw new Error('Distribuição sem slot durável.');return null}
  const owner=readDistributionRun(sqlite,slot.run_id)
  if(!Number.isSafeInteger(slot.version)||slot.version!==owner.sequence)throw new Error('Revisão da posse de distribuição incompatível.')
  return owner
}
export function validateDistributionOwnership(sqlite:Database.Database){
  const marked=sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get()&&sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=33').get()
  if(!marked){if(sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name IN ('distribution_owner_runs','distribution_owner_slot')").get())throw new Error('Distribuição sem marca de migração.');return}
  for(const [name,sql]of Object.entries(tables)){const saved=sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(name) as {sql:string}|undefined;if(!saved||normalized(saved.sql)!==normalized(sql))throw new Error('Schema de posse da distribuição ausente/adulterado.')}
  for(const [name,body]of Object.entries(triggers)){const saved=sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(name) as {sql:string}|undefined;if(!saved||normalized(saved.sql)!==normalized(`CREATE TRIGGER ${name} ${body}`))throw new Error('Cerca da distribuição ausente/adulterada.')}
  for(const row of sqlite.prepare('SELECT id FROM distribution_owner_runs').all() as {id:string}[])readDistributionRun(sqlite,row.id)
  readDistributionOwner(sqlite)
  for(const name of Object.keys(tables))if(sqlite.prepare(`PRAGMA foreign_key_check(${name})`).all().length)throw new Error('Referência inválida de distribuição.')
}
export function migrateDistributionOwnership(sqlite:Database.Database){
  sqlite.transaction(()=>{if(sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=33').get())return;for(const sql of Object.values(tables))sqlite.exec(sql);for(const [name,body]of Object.entries(triggers))sqlite.exec(`CREATE TRIGGER ${name} ${body}`);sqlite.prepare('INSERT INTO schema_migrations VALUES(33,?,?)').run('durable-distribution-process-ownership',new Date().toISOString())}).immediate()
  validateDistributionOwnership(sqlite)
}
