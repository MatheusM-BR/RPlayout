import Database from 'better-sqlite3'
import {randomUUID} from 'node:crypto'
import {lstat} from 'node:fs/promises'
import {resolve} from 'node:path'
import {openDatabase} from '../db/client.js'
import {assertSchemaCompatibility} from '../db/schema-compatibility.js'
import {assertCurrentRestorationReport} from '../db/restoration-records.js'
import {installationVault} from './secret-vault.js'
import {verifyRestorationManifest} from './restoration-manifest.js'
import {isRecoveryRehearsal} from './recovery-rehearsal.js'
import {StorageMaintenance} from './storage-maintenance.js'
import type {HostDistributionFence} from './host-distribution-fence.js'

const kinds=['RESTORED_SCHEMA_MIGRATION_STARTED','RESTORED_SCHEMA_MIGRATION_CONFIRMED','RESTORED_SCHEMA_MIGRATION_REFUSED'] as const
export function assertNoInterruptedRestoredMigration(sqlite:Database.Database){
  const pending=new Map<string,string>()
  for(const row of sqlite.prepare("SELECT kind,payload FROM operator_decisions WHERE kind IN (?,?,?) ORDER BY rowid").iterate(...kinds) as Iterable<{kind:string;payload:string}>){
    const value=JSON.parse(installationVault(false).decrypt(row.payload,'operator_decisions.payload'))
    if(value.version!==1||typeof value.id!=='string'||typeof value.restorationId!=='string'||value.phase!==row.kind||value.automaticTake!==false)throw new Error('Diário de migração inválido; preserve a cópia.')
    if(row.kind===kinds[0]){if(pending.has(value.id))throw new Error('Migração duplicada; preserve o diário.');pending.set(value.id,value.restorationId)}
    else{if(pending.get(value.id)!==value.restorationId)throw new Error('Conclusão de migração sem intenção correspondente.');pending.delete(value.id)}
  }
  if(pending.size)throw new Error('Migração interrompida/incerta. Não repetir sobre esta cópia; preserve-a e prepare outra cópia do backup original.')
}
/** Only a cryptographically authenticated, quarantined copy under continuously
 * held host/storage exclusion. No engine, publishers or cursor edits. */
export async function migrateRestoredCopy(file:string,manifest:string,fence:HostDistributionFence){
  const path=resolve(file),info=await lstat(path)
  if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1)throw new Error('Cópia restaurada deve ser arquivo regular sem links.')
  fence.assertOwned()
  const source=new Database(path,{fileMustExist:true});let migrated:ReturnType<typeof openDatabase>|null=null,lease:StorageMaintenance|null=null
  let began=false,finished=false
  const id=randomUUID();let restorationId=''
  const audit=(phase:typeof kinds[number],facts:unknown)=>source.prepare('INSERT INTO operator_decisions(id,rundown_id,kind,payload,actor_username,created_at) VALUES(?,?,?,?,?,?)').run(randomUUID(),'@restore',phase,installationVault(false).encrypt(JSON.stringify({version:1,id,restorationId,phase,facts,automaticTake:false,promotionReady:false}),'operator_decisions.payload'),'@restore',new Date().toISOString())
  try{
    const before=assertSchemaCompatibility(source),origin=await verifyRestorationManifest(source,resolve(manifest));restorationId=origin.requestId
    if(!isRecoveryRehearsal(source))throw new Error('Migração exige cópia em quarentena, não banco operacional.')
    assertNoInterruptedRestoredMigration(source)
    if(before.current)return {stage:'CURRENT_NOT_ACTIVATED',requestId:restorationId,schema:before,automaticTake:false,promotionReady:false}
    lease=new StorageMaintenance(source);lease.acquire();fence.assertOwned()
    audit(kinds[0],{before});began=true
    migrated=openDatabase(path,{maintenance:lease,assertAdmission:sql=>{fence.assertOwned();assertCurrentRestorationReport(sql,origin);if(!isRecoveryRehearsal(sql))throw new Error('Origem da quarentena mudou.') }})
    lease.assertHeldOn(migrated.sqlite);fence.assertOwned()
    const after=assertSchemaCompatibility(migrated.sqlite,true)
    if(migrated.sqlite.pragma('integrity_check',{simple:true})!=='ok'||(migrated.sqlite.pragma('foreign_key_check') as unknown[]).length)throw new Error('Cópia migrada não passou na integridade.')
    assertCurrentRestorationReport(migrated.sqlite,origin)
    audit(kinds[1],{before,after});finished=true
    return {stage:'MIGRATED_NOT_ACTIVATED',requestId:restorationId,migrationId:id,schema:after,automaticTake:false,promotionReady:false}
  }catch(error){
    if(began&&!finished)try{fence.assertOwned();lease!.assertHeld();audit(kinds[2],{reason:'Migração recusada; cópia preservada, sem autorização de execução.'});finished=true}catch{}
    throw error
  }finally{
    try{migrated?.sqlite.close()}
    finally{try{if(lease?.heldHere){fence.assertOwned();lease.release()}}finally{source.close()}}
  }
}
