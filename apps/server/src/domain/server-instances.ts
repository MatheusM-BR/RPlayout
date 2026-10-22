import type Database from 'better-sqlite3'
import {randomUUID} from 'node:crypto'
import {executionHostIdentity} from './execution-host.js'
import {readServerInstances,serverInstanceSignature,type ServerInstance} from '../db/server-instances.js'
import {assertStorageAdmissionOpen} from '../db/storage-admission.js'
import type {StorageMaintenance} from './storage-maintenance.js'
/** Distinguishes database storage lifetime from native child lifetime. CLOSED
 * is never proof of a stopped engine, host fence or channel promotion. */
export class ServerInstanceRegistration {
  private closed=false
  readonly id:string
  private readonly boot:string
  constructor(private readonly sqlite:Database.Database,maintenance?:StorageMaintenance){
    const row:ServerInstance={version:1,id:randomUUID(),host:executionHostIdentity(),pid:process.pid,boot:randomUUID(),phase:'OPEN',openedAt:new Date().toISOString(),closedAt:null}
    this.id=row.id
    this.boot=row.boot
    sqlite.transaction(()=>{if(maintenance)maintenance.assertHeldOn(sqlite);else assertStorageAdmissionOpen(sqlite);readServerInstances(sqlite);sqlite.prepare('INSERT INTO server_instances VALUES(?,?,?)').run(row.id,JSON.stringify(row),serverInstanceSignature(row))}).immediate()
  }
  storageClosed(){
    if(this.closed)return
    this.sqlite.transaction(()=>{
      const row=readServerInstances(this.sqlite).find(row=>row.id===this.id)
      if(!row||row.phase!=='OPEN'||row.boot!==this.boot||row.pid!==process.pid||row.host!==executionHostIdentity())throw new Error('Instância mudou; encerramento não confirmado.')
      const next:ServerInstance={...row,phase:'STORAGE_CLOSED',closedAt:new Date().toISOString()}
      const changed=this.sqlite.prepare('UPDATE server_instances SET payload=?,signature=? WHERE id=? AND signature=?').run(JSON.stringify(next),serverInstanceSignature(next),row.id,serverInstanceSignature(row))
      if(changed.changes!==1)throw new Error('Encerramento concorrente da instância não confirmado.')
    }).immediate()
    this.closed=true
  }
}
export function serverInstanceStorageStatus(sqlite:Database.Database):{open:number;storageClosed:number;localAbsent:number;protected:number;storageReleaseBlocked:boolean;nativeResourcesStopped:false}{
  const result={open:0,storageClosed:0,localAbsent:0,protected:0,storageReleaseBlocked:false,nativeResourcesStopped:false as const},host=executionHostIdentity()
  for(const row of readServerInstances(sqlite)){
    if(row.phase==='STORAGE_CLOSED')result.storageClosed++;else result.open++
    // A declared storage close is not process death. Even closed/living or
    // reused PIDs stay protected until an authoritative local absence check.
    let absent=false
    if(row.host===host)try{process.kill(row.pid,0)}catch(error){absent=(error as NodeJS.ErrnoException).code==='ESRCH'}
    if(absent)result.localAbsent++;else result.protected++
  }
  result.storageReleaseBlocked=result.protected>0
  return result
}
