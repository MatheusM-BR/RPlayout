import Database from 'better-sqlite3'
import {drizzle} from 'drizzle-orm/better-sqlite3'
import {createHash,randomUUID} from 'node:crypto'
import {readFileSync,lstatSync} from 'node:fs'
import {resolve,dirname,join,isAbsolute} from 'node:path'
import {z} from 'zod'
import * as schema from './db/schema.js'
import {assertSchemaCompatibility} from './db/schema-compatibility.js'
import {validateDatabaseSecrets} from './db/vault-migration.js'
import {readRestoredActivations} from './db/restored-activations.js'
import {pendingUpgradeProfiles} from './domain/upgrade-profile-adoption.js'
import {installationVault} from './domain/secret-vault.js'
import {HostDistributionFence} from './domain/host-distribution-fence.js'
import {StorageMaintenance} from './domain/storage-maintenance.js'
import {DistributionOwnership} from './domain/distribution-ownership.js'
import {sanitizeDiagnostic} from './domain/sanitize-diagnostic.js'
import {readStorageAdmission} from './db/storage-admission.js'
import {recoverRestoredReservation} from './domain/recover-restored-reservation.js'
import {verifyRestorationManifest} from './domain/restoration-manifest.js'
const norm=(value:string)=>process.platform==='win32'?resolve(value).toLowerCase():resolve(value)
const digest=(file:string)=>{const info=lstatSync(file);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>16384)throw new Error('Perfil irregular; não será reconciliado.');return createHash('sha256').update(readFileSync(file)).digest('hex')}
const intent=z.object({version:z.literal(1),id:z.string().uuid(),phase:z.literal('UPGRADE_PROFILE_STARTED'),activationId:z.string().uuid(),requestId:z.string().uuid(),previousHash:z.string().regex(/^[a-f0-9]{64}$/),candidateHash:z.string().regex(/^[a-f0-9]{64}$/),previousProfile:z.string().refine(isAbsolute),automaticTake:z.literal(false),physicalOutputValidated:z.literal(false)}).strict()
async function main(){
  const args=process.argv.slice(2),values=new Map<string,string>()
  for(let i=0;i<args.length;i+=2){const key=args[i]!,value=args[i+1];if(!['--database','--vault-file','--installation','--adoption-id','--confirm','--recover-maintenance'].includes(key)||values.has(key)||!value||value.startsWith('--'))throw new Error('Informe banco, cofre, instalação, ID da adoção e --confirm RECONCILIAR.');values.set(key,value)}
  const query=values.get('--adoption-id')==='LISTAR'&&values.get('--confirm')==='CONFERIR'
  const recover=values.get('--recover-maintenance')==='LIBERAR'
  if(values.size!==(recover?6:5)||values.has('--recover-maintenance')&&!recover||query&&recover||!query&&values.get('--confirm')!=='RECONCILIAR'||process.env.RPLAYOUT_VAULT_KEY)throw new Error('Reconciliação exige confirmação explícita e cofre original, sem chave externa. Recuperação de reserva não faz parte da consulta.')
  const database=resolve(values.get('--database')!),installation=resolve(values.get('--installation')!),id=query?null:z.string().uuid().parse(values.get('--adoption-id'))
  process.env.RPLAYOUT_VAULT_FILE=resolve(values.get('--vault-file')!);process.env.RPLAYOUT_INSTALL_ROOT=installation
  const info=lstatSync(database);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1)throw new Error('Banco da adoção deve ser arquivo regular sem links.')
  const {HOST_GUARD_BINARY}=await import('./config.js'),fence=new HostDistributionFence(HOST_GUARD_BINARY)
  let sql:Database.Database|null=null,lease:StorageMaintenance|null=null
  try{
    if(!await fence.acquire())throw new Error('Posse nativa indisponível; predecessor não será parado.')
    sql=new Database(database,{fileMustExist:true});assertSchemaCompatibility(sql,true);validateDatabaseSecrets(sql)
    const pending=pendingUpgradeProfiles(sql)
    if(query){process.stdout.write(JSON.stringify({pending:[...pending.values()].map(value=>({id:value.id,activationId:value.activationId,requestId:value.requestId})),profileChanged:false,automaticTake:false})+'\n');return}
    const value=pending.get(id!)
    if(!value)throw new Error('Adoção não está pendente; consulta/reconciliação não executa nova troca.')
    const initial=intent.parse(value),target=join(installation,'installation-profile.json')
    if(norm(dirname(initial.previousProfile))!==norm(installation)||norm(initial.previousProfile)!==norm(join(installation,'installation-profile.previous-'+id+'.json')))throw new Error('Diário não pertence a esta instalação.')
    const activation=readRestoredActivations(sql).find(row=>row.id===initial.activationId)
    if(!activation||activation.phase!=='CONFIRMED'||activation.requestId!==initial.requestId)throw new Error('Ativação autenticada correspondente não encontrada.')
    const db=drizzle(sql,{schema})
    let recoveredMaintenance=false
    if(readStorageAdmission(sql)?.phase==='MAINTENANCE'){
      if(!recover)throw new Error('Reserva interrompida preservada. Solicite sua recuperação explicitamente antes de reconciliar.')
      const restorationManifest=join(dirname(database),'restore-quarantine.json')
      if((await verifyRestorationManifest(sql,restorationManifest)).requestId!==initial.requestId)throw new Error('Reserva pertence a outra restauração; não será alterada.')
      const released=await recoverRestoredReservation(db,restorationManifest,fence)
      if(released.requestId!==initial.requestId)throw new Error('Reserva recuperada pertence a outra restauração; adoção não será liberada.')
      recoveredMaintenance=true
    }
    lease=new StorageMaintenance(sql);lease.acquire()
    const distribution=new DistributionOwnership(db,undefined,undefined,fence);distribution.assertPredecessorReleased()
    await fence.freshProof();lease.assertHeld()
    const actual=digest(target)
    const phase=actual===initial.candidateHash?'UPGRADE_PROFILE_CONFIRMED':actual===initial.previousHash?'UPGRADE_PROFILE_REFUSED':null
    if(!phase)throw new Error('Perfil não corresponde ao anterior nem ao candidato. Não será substituído ou liberado.')
    if(phase==='UPGRADE_PROFILE_CONFIRMED'){
      if(digest(initial.previousProfile)!==initial.previousHash)throw new Error('Perfil anterior preservado não confere.')
      const profile=z.object({version:z.literal(1),dataRoot:z.string().refine(isAbsolute),databaseFile:z.string().refine(isAbsolute).optional(),mediaRoot:z.string().refine(isAbsolute),vaultFile:z.string().refine(isAbsolute)}).strict().parse(JSON.parse(readFileSync(target,'utf8')))
      if(norm(profile.databaseFile??join(profile.dataRoot,'rplayout.db'))!==norm(database)||norm(profile.vaultFile)!==norm(process.env.RPLAYOUT_VAULT_FILE!))throw new Error('Perfil publicado aponta a outro banco/cofre.')
    }
    await fence.freshProof()
    sql.transaction(()=>{
      lease!.assertHeld();fence.assertOwned();distribution.assertPredecessorReleased()
      if(JSON.stringify(pendingUpgradeProfiles(sql!).get(id!))!==JSON.stringify(initial)||digest(target)!==actual)throw new Error('Diário/perfil mudou durante a reconciliação.')
      sql!.prepare('INSERT INTO operator_decisions(id,rundown_id,kind,payload,actor_username,created_at) VALUES(?,?,?,?,?,?)').run(randomUUID(),'@upgrade',phase,installationVault(false).encrypt(JSON.stringify({...initial,phase,reconciledAt:new Date().toISOString(),reconciliation:'OBSERVED_FILE_ONLY',historicalPublicationAckKnown:false}),'operator_decisions.payload'),'@upgrade',new Date().toISOString())
    }).immediate()
    process.stdout.write(JSON.stringify({adoptionId:id,phase,reconciled:true,recoveredMaintenance,profileChanged:false,automaticTake:false,physicalOutputValidated:false,historicalPublicationAckKnown:false})+'\n')
  }finally{
    try{if(lease?.heldHere){fence.assertOwned();lease.release()}}finally{sql?.close();fence.close()}
  }
}
void main().catch(error=>{process.stderr.write(sanitizeDiagnostic(error instanceof Error?error.message:'Reconciliação recusada; arquivos preservados.')+'\n');process.exitCode=1})
