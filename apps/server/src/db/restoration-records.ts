import type Database from 'better-sqlite3'
import {installationVault} from '../domain/secret-vault.js'
import {restoreReportSchema} from '../domain/restore-report.js'
import type {z} from 'zod'
export type RestorationRecord=z.infer<typeof restoreReportSchema>
const definition='CREATE TABLE restoration_records(id TEXT PRIMARY KEY,payload TEXT NOT NULL,signature TEXT NOT NULL)'
const triggers={restoration_records_update:"BEFORE UPDATE ON restoration_records BEGIN SELECT RAISE(ABORT,'Restoration history is immutable'); END",restoration_records_delete:"BEFORE DELETE ON restoration_records BEGIN SELECT RAISE(ABORT,'Restoration history cannot be deleted'); END"}
const normalize=(sql:string)=>sql.replace(/\s+/g,' ').trim()
export const restorationRecordSignature=(row:RestorationRecord)=>installationVault(false).reviewIdentity(JSON.stringify(restoreReportSchema.parse(row)),'restoration-record:v1')
export function readRestorationRecords(sqlite:Database.Database):RestorationRecord[]{
  const present=sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='restoration_records'").get() as {sql:string}|undefined
  const marked=sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get()&&sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=43').get()
  if(!marked){if(present)throw new Error('Registro de restauração sem migração.');return []}
  if(!present||normalize(present.sql)!==definition)throw new Error('Tabela de restaurações ausente ou adulterada.')
  for(const [name,body] of Object.entries(triggers)){
    const saved=sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(name) as {sql:string}|undefined
    if(!saved||normalize(saved.sql)!==normalize(`CREATE TRIGGER ${name} ${body}`))throw new Error('Proteção do histórico de restaurações ausente ou adulterada.')
  }
  return (sqlite.prepare('SELECT id,payload,signature FROM restoration_records ORDER BY rowid').all() as {id:string;payload:string;signature:string}[]).map(saved=>{
    const report=restoreReportSchema.parse(JSON.parse(saved.payload))
    if(report.requestId!==saved.id||saved.signature!==restorationRecordSignature(report)||report.vaultFingerprint!==installationVault(false).fingerprint)throw new Error('Registro de restauração inválido; ativação recusada.')
    return report
  })
}
export function migrateRestorationRecords(sqlite:Database.Database):void{
  sqlite.transaction(()=>{
    if(sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=43').get())return
    sqlite.exec(definition)
    for(const [name,body] of Object.entries(triggers))sqlite.exec(`CREATE TRIGGER ${name} ${body}`)
    sqlite.prepare('INSERT INTO schema_migrations VALUES(43,?,?)').run('signed-immutable-restoration-receipts',new Date().toISOString())
  }).immediate()
  readRestorationRecords(sqlite)
}
export function appendRestorationRecord(sqlite:Database.Database,input:unknown):RestorationRecord{
  const report=restoreReportSchema.parse(input)
  sqlite.transaction(()=>{
    readRestorationRecords(sqlite)
    if(report.vaultFingerprint!==installationVault(false).fingerprint)throw new Error('Relatório não pertence ao cofre aberto.')
    sqlite.prepare('INSERT INTO restoration_records VALUES(?,?,?)').run(report.requestId,JSON.stringify(report),restorationRecordSignature(report))
  }).immediate()
  return report
}
/** A valid external manifest from a different/older restoration is insufficient.
 * Requires this database's newest immutable authenticated receipt. Still does
 * NOT attest process death, media/QC, host fencing or safe PGM recovery. */
export function assertCurrentRestorationReport(sqlite:Database.Database,input:unknown):RestorationRecord{
  const report=restoreReportSchema.parse(input),current=readRestorationRecords(sqlite).at(-1)
  if(!current||restorationRecordSignature(current)!==restorationRecordSignature(report))throw new Error('Relatório não corresponde à restauração atual deste banco; ativação recusada.')
  return current
}
