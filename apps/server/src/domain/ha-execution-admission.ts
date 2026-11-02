import Database from 'better-sqlite3'
import type {HaRecovery} from './ha-recovery.js'
import {verifyStagedHaExecutionCopy,type HaExecutionCopy} from './ha-execution-copy.js'
import {StorageMaintenance} from './storage-maintenance.js'
import {assertSchemaCompatibility} from '../db/schema-compatibility.js'
import {HostDistributionFence} from './host-distribution-fence.js'
import {stateFingerprint} from './restored-execution-review.js'
import {ServerInstanceRegistration} from './server-instances.js'
import {installationVault} from './secret-vault.js'
import {randomUUID} from 'node:crypto'

type Candidate=Awaited<ReturnType<HaRecovery['activationCandidate']>>
const admissions=new WeakSet<HaExecutionAdmission>()
/** Process-local capability, never a JSON admission token. This reservation
 * covers the distinct copy only, not the standby's own service database. */
export class HaExecutionAdmission {
  private nativePreparation=false
  private released=false
  private registered:ServerInstanceRegistration|null=null
  private transferred=false
  private constructor(readonly copy:HaExecutionCopy,private connection:Database.Database,
    readonly maintenance:StorageMaintenance,readonly hostFence:HostDistributionFence,private readonly fingerprint:string){admissions.add(this)}
  get sqlite(){this.assertHeld();return this.connection}
  /** Transfer to the admitted backend/storage worker without releasing the
   * signed maintenance reservation. No second arbitrary path is accepted. */
  transferConnection(connection:Database.Database){
    this.assertHeld();this.maintenance.transferConnection(connection)
    const previous=this.connection;this.connection=connection
    if(previous!==connection)previous.close()
    this.assertHeld()
  }
  assertBeforeOpen(connection:Database.Database){
    this.assertHeld()
    if(this.registered||this.transferred)throw new Error('Admissão HA já registrada; não repetir abertura do backend.')
    this.maintenance.assertHeldOn(connection);assertSchemaCompatibility(connection,true)
    if(stateFingerprint(connection)!==this.fingerprint)throw new Error('Cópia mudou antes da abertura do backend HA.')
  }
  register(connection:Database.Database){
    if(!connection.inTransaction)throw new Error('Registro HA exige transação da abertura.')
    this.assertBeforeOpen(connection)
    const instance=new ServerInstanceRegistration(connection,this.maintenance)
    const facts={version:1,promotionId:this.copy.id,preparationId:this.copy.preparationId,instanceId:instance.id,phase:'BACKEND_ADMITTED_QUARANTINED',automaticTake:false,physicalOutputValidated:false}
    connection.prepare('INSERT INTO operator_decisions(id,rundown_id,kind,payload,actor_username,created_at) VALUES(?,?,?,?,?,?)').run(randomUUID(),'@ha','HA_BACKEND_ADMITTED',installationVault(false).encrypt(JSON.stringify(facts),'operator_decisions.payload'),'@ha',new Date().toISOString())
    this.registered=instance;return instance
  }
  completeTransfer(connection:Database.Database){
    this.assertHeld()
    if(!this.registered||this.transferred)throw new Error('Backend HA não registrado ou admissão já transferida.')
    this.transferConnection(connection);this.transferred=true
  }
  /** Backend staging is not a native activation grant. This remains closed
   * until the distinct execution/cursor/graphics/output stage is implemented. */
  assertNativeActivation():never{this.assertHeld();throw new Error('Backend HA em quarentena; execução nativa ainda não admitida.')}
  static async acquire(copy:HaExecutionCopy,candidate:Candidate,root:string,hostFence:HostDistributionFence,authorize:()=>Promise<void>,signal:AbortSignal){
    if(!(hostFence instanceof HostDistributionFence))throw new Error('Admissão HA exige cerca nativa local, não recibo serializado.')
    if(!await hostFence.acquire())throw new Error('Computador ocupado ou posse nativa não confirmada; cópia permanece isolada.')
    await hostFence.freshProof()
    await verifyStagedHaExecutionCopy(copy,candidate,root,authorize,signal)
    await hostFence.freshProof();await authorize()
    if(signal.aborted)throw new Error('Reserva da execução HA cancelada.')
    let sqlite:Database.Database|null=null,maintenance:StorageMaintenance|null=null
    try{
      sqlite=new Database(copy.file,{fileMustExist:true})
      assertSchemaCompatibility(sqlite,true)
      const channels=sqlite.prepare('SELECT id,archived_at FROM channels').all() as {id:string;archived_at:string|null}[]
      if(channels.length!==1||channels[0]!.id!==candidate.candidate.channel.id||!channels[0]!.archived_at||(sqlite.prepare('SELECT count(*) n FROM output_profiles').get() as {n:number}).n!==0)throw new Error('Cópia HA perdeu quarentena antes de reservar storage.')
      hostFence.assertOwned();maintenance=new StorageMaintenance(sqlite);maintenance.acquire()
      await hostFence.freshProof();await authorize();await candidate.verifyCurrent()
      if(signal.aborted)throw new Error('Reserva da execução HA cancelada.')
      maintenance.assertHeld();hostFence.assertOwned()
      return new HaExecutionAdmission({...copy},sqlite,maintenance,hostFence,stateFingerprint(sqlite))
    }catch(error){
      // No program processes have been authorized by this acquisition. If
      // release cannot be confirmed, leave the durable MAINTENANCE record.
      try{if(maintenance?.heldHere){hostFence.assertOwned();maintenance.release()}}finally{sqlite?.close()}
      throw error
    }
  }
  assertHeld(){
    assertHaExecutionAdmission(this)
    if(this.released)throw new Error('Reserva HA encerrada; não abrir execução.')
    this.hostFence.assertOwned();this.maintenance.assertHeld()
  }
  /** Called BEFORE the adapter may open any native resource. A lost handle
   * cannot release storage merely because the adapter threw an exception. */
  markNativePreparation(){this.assertHeld();this.nativePreparation=true}
  /** Internal orchestrator only. True must come from the owned handle's stop
   * confirmation, not a browser flag. Unknown resources retain the reservation. */
  releaseAfterStop(ownedResourcesStopped:boolean){
    if(this.released)return true
    this.assertHeld()
    if(this.nativePreparation&&!ownedResourcesStopped)return false
    this.maintenance.release();this.released=true;this.connection.close();return true
  }
}
export function assertHaExecutionAdmission(value:unknown):asserts value is HaExecutionAdmission{
  if(!value||!admissions.has(value as HaExecutionAdmission))throw new Error('Admissão HA não é capacidade local verificada.')
}
