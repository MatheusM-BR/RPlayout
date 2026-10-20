import type Database from 'better-sqlite3'
import {z} from 'zod'
import {installationVault} from '../domain/secret-vault.js'
const definition='CREATE TABLE storage_admission(id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL,signature TEXT NOT NULL)'
const owner=z.object({id:z.string().uuid(),boot:z.string().uuid(),host:z.string().min(1),pid:z.number().int().positive().max(0xffffffff)}).strict()
export const storageAdmissionSchema=z.object({version:z.literal(1),revision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),phase:z.enum(['OPEN','MAINTENANCE']),owner:owner.nullable(),changedAt:z.string().datetime()}).strict().refine(row=>(row.phase==='OPEN')===(row.owner===null))
export type StorageAdmission=z.infer<typeof storageAdmissionSchema>
export const storageAdmissionSignature=(row:StorageAdmission)=>installationVault(false).reviewIdentity(JSON.stringify(storageAdmissionSchema.parse(row)),'storage-admission:v1')
export function readStorageAdmission(sqlite:Database.Database):StorageAdmission|null{
  const present=sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='storage_admission'").get() as {sql:string}|undefined
  const marked=sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get()&&sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=42').get()
  if(!marked){if(present)throw new Error('Admissão de armazenamento sem migração.');return null}
  if(!present||present.sql.replace(/\s+/g,' ').trim()!==definition)throw new Error('Tabela de admissão ausente ou adulterada.')
  const rows=sqlite.prepare('SELECT id,payload,signature FROM storage_admission').all() as {id:number;payload:string;signature:string}[]
  if(rows.length!==1||rows[0]!.id!==1)throw new Error('Admissão de armazenamento sem estado único.')
  const saved=rows[0]!,row=storageAdmissionSchema.parse(JSON.parse(saved.payload))
  if(saved.signature!==storageAdmissionSignature(row))throw new Error('Assinatura da admissão inválida.')
  return row
}
export function assertStorageAdmissionOpen(sqlite:Database.Database):void{
  if(readStorageAdmission(sqlite)?.phase==='MAINTENANCE')throw new Error('Banco reservado para manutenção; partida bloqueada. Não apague a reserva para liberar operação.')
}
export function migrateStorageAdmission(sqlite:Database.Database):void{
  sqlite.transaction(()=>{
    if(sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=42').get())return
    sqlite.exec(definition)
    const row:StorageAdmission={version:1,revision:0,phase:'OPEN',owner:null,changedAt:new Date().toISOString()}
    sqlite.prepare('INSERT INTO storage_admission VALUES(1,?,?)').run(JSON.stringify(row),storageAdmissionSignature(row))
    sqlite.prepare('INSERT INTO schema_migrations VALUES(42,?,?)').run('signed-storage-maintenance-admission',new Date().toISOString())
  }).immediate()
  readStorageAdmission(sqlite)
}
