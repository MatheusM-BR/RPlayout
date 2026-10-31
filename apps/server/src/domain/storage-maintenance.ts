import type Database from 'better-sqlite3'
import {randomUUID} from 'node:crypto'
import {resolve} from 'node:path'
import {lstatSync} from 'node:fs'
import {executionHostIdentity} from './execution-host.js'
import {serverInstanceStorageStatus} from './server-instances.js'
import {readStorageAdmission,storageAdmissionSignature,type StorageAdmission} from '../db/storage-admission.js'
/** Storage-only exclusion. It does not fence native children or authorize
 * removal of recovery provenance, cursor changes, TAKE or promotion.
 * Crash leaves MAINTENANCE durable; another process never steals it on timeout. */
export class StorageMaintenance {
  private readonly owner={id:randomUUID(),boot:randomUUID(),host:executionHostIdentity(),pid:process.pid}
  private held:StorageAdmission|null=null
  private fileIdentity:string|null=null
  constructor(private sqlite:Database.Database){}
  acquire():void{
    if(this.held)throw new Error('Reserva já adquirida por esta operação.')
    this.fileIdentity=this.pathIdentity()
    this.sqlite.transaction(()=>{
      const row=readStorageAdmission(this.sqlite)
      if(!row||row.phase!=='OPEN')throw new Error('Admissão não está livre; reserva não será substituída.')
      if(serverInstanceStorageStatus(this.sqlite).storageReleaseBlocked)throw new Error('Há instância viva, remota ou incerta usando o banco.')
      const next:StorageAdmission={version:1,revision:row.revision+1,phase:'MAINTENANCE',owner:this.owner,changedAt:new Date().toISOString()}
      this.replace(row,next);this.held=next
    }).immediate()
  }
  assertHeld():void{
    this.assertHeldOn(this.sqlite)
  }
  get heldHere(){return this.held!==null}
  private pathIdentity():string|null{
    if(!this.sqlite.name||this.sqlite.name===':memory:')return null
    const stat=lstatSync(this.sqlite.name,{bigint:true})
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1n)throw new Error('Banco da reserva deve ser arquivo regular, sem links.')
    return `${stat.dev}:${stat.ino}`
  }
  assertHeldOn(sqlite:Database.Database):void{
    const path=(name:string)=>process.platform==='win32'?resolve(name).toLowerCase():resolve(name)
    if(sqlite!==this.sqlite&&path(sqlite.name)!==path(this.sqlite.name))throw new Error('Reserva não pertence a este banco.')
    if(this.fileIdentity!==this.pathIdentity())throw new Error('Arquivo do banco mudou durante a reserva.')
    const actual=readStorageAdmission(sqlite)
    if(!this.held||!actual||storageAdmissionSignature(actual)!==storageAdmissionSignature(this.held))throw new Error('Reserva de armazenamento perdida; operação recusada.')
  }
  transferConnection(sqlite:Database.Database):void{
    this.assertHeldOn(sqlite)
    this.sqlite=sqlite
  }
  release():void{
    this.sqlite.transaction(()=>this.releaseWithin(this.sqlite)).immediate()
    this.completeRelease()
  }
  /** Registration/audit/release must share caller's immediate transaction;
   * retain in-memory lease until commit so a rollback does not fake transfer. */
  releaseWithin(sqlite:Database.Database):void{
    if(!sqlite.inTransaction)throw new Error('Transferência exige transação de admissão.')
    this.assertHeldOn(sqlite)
    const row=this.held!,next:StorageAdmission={version:1,revision:row.revision+1,phase:'OPEN',owner:null,changedAt:new Date().toISOString()}
    const changed=sqlite.prepare('UPDATE storage_admission SET payload=?,signature=? WHERE id=1 AND signature=?').run(JSON.stringify(next),storageAdmissionSignature(next),storageAdmissionSignature(row))
    if(changed.changes!==1)throw new Error('Admissão mudou durante a transferência.')
  }
  completeRelease():void{
    const current=readStorageAdmission(this.sqlite)
    if(!this.held||current?.phase!=='OPEN'||current.revision!==this.held.revision+1)throw new Error('Commit da transferência não confirmado.')
    this.held=null
  }
  private replace(before:StorageAdmission,after:StorageAdmission){
    const changed=this.sqlite.prepare('UPDATE storage_admission SET payload=?,signature=? WHERE id=1 AND signature=?').run(JSON.stringify(after),storageAdmissionSignature(after),storageAdmissionSignature(before))
    if(changed.changes!==1)throw new Error('Admissão mudou durante a reserva.')
  }
}
