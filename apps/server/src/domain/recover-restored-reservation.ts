import {randomUUID} from 'node:crypto'
import type {Db} from '../db/client.js'
import {operatorDecisions} from '../db/schema.js'
import {readStorageAdmission,storageAdmissionSignature,type StorageAdmission} from '../db/storage-admission.js'
import {readRestoredActivations,restoredActivationSignature,type RestoredActivation} from '../db/restored-activations.js'
import {readServerInstances} from '../db/server-instances.js'
import {readRestorationRecords} from '../db/restoration-records.js'
import {serverInstanceStorageStatus} from './server-instances.js'
import {verifyRestorationManifest} from './restoration-manifest.js'
import {DistributionOwnership} from './distribution-ownership.js'
import {executionHostIdentity} from './execution-host.js'
import type {HostDistributionFence} from './host-distribution-fence.js'

/** Explicit offline repair, never timeout-based lease theft or activation.
 * Native host exclusion AND signed predecessor/storage absence are required.
 * Unknown spawns, remote owners and reused/permission-denied PIDs remain blocked. */
export async function recoverRestoredReservation(db:Db,manifest:string,fence:HostDistributionFence){
  const receipt=await verifyRestorationManifest(db.$client,manifest)
  await fence.freshProof()
  const distribution=new DistributionOwnership(db,undefined,undefined,fence)
  return db.$client.transaction(()=>{
    fence.assertOwned()
    const row=readStorageAdmission(db.$client)
    if(!row||row.phase!=='MAINTENANCE')throw new Error('Não há reserva de manutenção interrompida para recuperar.')
    if(row.owner!.host!==executionHostIdentity())throw new Error('Reserva remota não pode ser liberada por prova local.')
    let absent=false
    try{process.kill(row.owner!.pid,0)}catch(error){absent=(error as NodeJS.ErrnoException).code==='ESRCH'}
    if(!absent||serverInstanceStorageStatus(db.$client).storageReleaseBlocked)throw new Error('Detentor/instância vivo ou inconclusivo; reserva preservada.')
    distribution.assertPredecessorReleased()
    if(readRestorationRecords(db.$client).at(-1)?.requestId!==receipt.requestId)throw new Error('Procedência da restauração mudou durante a revisão.')
    const activation=readRestoredActivations(db.$client).at(-1)
    if(activation?.phase==='STARTING'){
      const instance=readServerInstances(db.$client).find(row=>row.id===activation.instanceId)
      if(activation.requestId!==receipt.requestId||!instance||instance.pid!==row.owner!.pid||instance.host!==row.owner!.host)throw new Error('Ativação inconclusiva não corresponde ao detentor interrompido.')
      const failed:RestoredActivation={...activation,phase:'FAILED',finishedAt:new Date().toISOString(),message:'Processo anterior ausente e exclusão nativa comprovada; ativação interrompida, nenhuma promoção confirmada.'}
      const changed=db.$client.prepare('UPDATE restored_activation_runs SET payload=?,signature=? WHERE id=? AND signature=?').run(JSON.stringify(failed),restoredActivationSignature(failed),activation.id,restoredActivationSignature(activation))
      if(changed.changes!==1)throw new Error('Ativação mudou durante a recuperação.')
    }
    const next:StorageAdmission={version:1,revision:row.revision+1,phase:'OPEN',owner:null,changedAt:new Date().toISOString()}
    const changed=db.$client.prepare('UPDATE storage_admission SET payload=?,signature=? WHERE id=1 AND signature=?').run(JSON.stringify(next),storageAdmissionSignature(next),storageAdmissionSignature(row))
    if(changed.changes!==1)throw new Error('Reserva mudou durante a recuperação.')
    db.insert(operatorDecisions).values({id:randomUUID(),rundownId:'@restore',kind:'RESTORED_RESERVATION_RECOVERED',actorUsername:'@offline-recovery',createdAt:next.changedAt,payload:{requestId:receipt.requestId,previousAdmission:row,previousSignature:storageAdmissionSignature(row),interruptedActivationId:activation?.phase==='STARTING'?activation.id:null,automaticPromotion:false,physicalOutputValidated:false,executionStarted:false}}).run()
    fence.assertOwned()
    return {stage:'RESERVATION_RELEASED_NOT_ACTIVATED' as const,requestId:receipt.requestId,revision:next.revision,interruptedActivationFailed:activation?.phase==='STARTING',activationPerformed:false as const,physicalOutputValidated:false as const}
  }).immediate()
}
