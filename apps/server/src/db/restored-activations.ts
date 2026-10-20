import type Database from 'better-sqlite3'
import {z} from 'zod'
import {installationVault} from '../domain/secret-vault.js'
const table='CREATE TABLE restored_activation_runs(id TEXT PRIMARY KEY,payload TEXT NOT NULL,signature TEXT NOT NULL)'
const triggers={restored_activation_delete:"BEFORE DELETE ON restored_activation_runs BEGIN SELECT RAISE(ABORT,'Activation history cannot be deleted'); END",restored_activation_identity:"BEFORE UPDATE OF id ON restored_activation_runs BEGIN SELECT RAISE(ABORT,'Activation identity is immutable'); END"}
const normalize=(sql:string)=>sql.replace(/\s+/g,' ').trim()
export const restoredActivationSchema=z.object({version:z.literal(1),id:z.string().uuid(),requestId:z.string().uuid(),instanceId:z.string().uuid(),phase:z.enum(['STARTING','CONFIRMED','FAILED']),startedAt:z.string().datetime(),finishedAt:z.string().datetime().nullable(),nativeReadyChannels:z.array(z.string()),resumedChannels:z.array(z.string()),message:z.string().nullable(),originTable:z.string().regex(/^restored_origin_[a-f0-9]{32}$/).nullable(),automaticPromotion:z.literal(false),physicalOutputValidated:z.literal(false)}).strict().refine(row=>(row.phase==='STARTING')===(row.finishedAt===null)).refine(row=>(row.phase==='CONFIRMED')===(row.originTable!==null)).refine(row=>new Set(row.nativeReadyChannels).size===row.nativeReadyChannels.length&&new Set(row.resumedChannels).size===row.resumedChannels.length&&row.resumedChannels.every(id=>row.nativeReadyChannels.includes(id)))
export type RestoredActivation=z.infer<typeof restoredActivationSchema>
export const restoredActivationSignature=(row:RestoredActivation)=>installationVault(false).reviewIdentity(JSON.stringify(restoredActivationSchema.parse(row)),'restored-activation:v1')
export function readRestoredActivations(sqlite:Database.Database):RestoredActivation[]{
  const present=sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='restored_activation_runs'").get() as {sql:string}|undefined
  const marked=sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get()&&sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=44').get()
  if(!marked){if(present)throw new Error('Ativação sem registro de migração.');return []}
  if(!present||normalize(present.sql)!==table)throw new Error('Tabela de ativações ausente ou adulterada.')
  for(const [name,body]of Object.entries(triggers)){
    const saved=sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(name) as {sql:string}|undefined
    if(!saved||normalize(saved.sql)!==normalize(`CREATE TRIGGER ${name} ${body}`))throw new Error('Proteção de ativação ausente ou adulterada.')
  }
  return (sqlite.prepare('SELECT id,payload,signature FROM restored_activation_runs ORDER BY rowid').all() as {id:string;payload:string;signature:string}[]).map(saved=>{
    const row=restoredActivationSchema.parse(JSON.parse(saved.payload))
    if(row.id!==saved.id||saved.signature!==restoredActivationSignature(row))throw new Error('Registro de ativação inválido; execução bloqueada.')
    if(row.originTable!==null&&row.originTable!==`restored_origin_${row.id.replaceAll('-','')}`)throw new Error('Origem da ativação não corresponde ao registro.')
    if(row.originTable&&!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(row.originTable))throw new Error('Histórico da origem restaurada ausente.')
    return row
  })
}
export function migrateRestoredActivations(sqlite:Database.Database):void{
  sqlite.transaction(()=>{
    if(sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=44').get())return
    sqlite.exec(table)
    for(const [name,body]of Object.entries(triggers))sqlite.exec(`CREATE TRIGGER ${name} ${body}`)
    sqlite.prepare('INSERT INTO schema_migrations VALUES(44,?,?)').run('signed-restored-activation-journal',new Date().toISOString())
  }).immediate()
  readRestoredActivations(sqlite)
}
