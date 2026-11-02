import type Database from 'better-sqlite3'
import {z} from 'zod'
import {installationVault} from '../domain/secret-vault.js'
const definition='CREATE TABLE server_instances(id TEXT PRIMARY KEY,payload TEXT NOT NULL,signature TEXT NOT NULL)'
export const serverInstanceSchema=z.object({version:z.literal(1),id:z.string().uuid(),host:z.string().min(1),pid:z.number().int().positive().max(0xffffffff),boot:z.string().uuid(),phase:z.enum(['OPEN','STORAGE_CLOSED']),openedAt:z.string().datetime(),closedAt:z.string().datetime().nullable()}).strict().refine(row=>(row.phase==='OPEN')===(row.closedAt===null))
export type ServerInstance=z.infer<typeof serverInstanceSchema>
export const serverInstanceSignature=(row:ServerInstance)=>installationVault(false).reviewIdentity(JSON.stringify(serverInstanceSchema.parse(row)),'server-instance:v1')
export function readServerInstances(sqlite:Database.Database):ServerInstance[]{
  return (sqlite.prepare('SELECT id,payload,signature FROM server_instances ORDER BY rowid').all() as {id:string;payload:string;signature:string}[]).map(saved=>{
    const row=serverInstanceSchema.parse(JSON.parse(saved.payload))
    if(row.id!==saved.id||saved.signature!==serverInstanceSignature(row))throw new Error('Registro de instância inválido; abertura/fechamento não será presumido.')
    return row
  })
}
export function validateServerInstances(sqlite:Database.Database):void{
  const present=sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='server_instances'").get() as {sql:string}|undefined
  const marked=sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get()&&sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=41').get()
  if(!marked){if(present)throw new Error('Instâncias do servidor sem registro de migração.');return}
  if(!present||present.sql.replace(/\s+/g,' ').trim()!==definition)throw new Error('Tabela de instâncias ausente ou adulterada.')
  readServerInstances(sqlite)
}
export function migrateServerInstances(sqlite:Database.Database):void{
  sqlite.transaction(()=>{
    if(sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=41').get())return
    sqlite.exec(definition)
    sqlite.prepare('INSERT INTO schema_migrations VALUES(41,?,?)').run('signed-server-instance-lifecycle',new Date().toISOString())
  }).immediate()
  validateServerInstances(sqlite)
}
