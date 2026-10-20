import type Database from 'better-sqlite3'
import {createHash} from 'node:crypto'
import {z} from 'zod'
import {validateExecutionOwnership} from '../db/execution-ownership.js'
import {validateDistributionOwnership} from '../db/distribution-ownership.js'
import {validateServerInstances} from '../db/server-instances.js'
import {readStorageAdmission} from '../db/storage-admission.js'
import {readRestorationRecords} from '../db/restoration-records.js'
import {readRestoredActivations} from '../db/restored-activations.js'
import {installationVault,type SecretVault} from './secret-vault.js'

const lifecycleEvidence=z.object({rows:z.number().int().nonnegative().max(400002),inventoryHash:z.string().regex(/^[a-f0-9]{64}$/),coverage:z.literal('DISTRIBUTION_SERVER_STORAGE_RESTORE_ACTIVATION')}).strict()
export const haOwnershipEvidence=z.object({version:z.literal(1),runs:z.number().int().nonnegative().max(100000),slots:z.number().int().nonnegative().max(100000),asRunLinks:z.number().int().nonnegative().max(500000),inventoryHash:z.string().regex(/^[a-f0-9]{64}$/),lifecycleEvidence:lifecycleEvidence.optional(),sourceVaultFingerprint:z.string().regex(/^[a-f0-9]{64}$/),validation:z.literal('SOURCE_SIGNATURES_CHECKED'),authorityTransferred:z.literal(false)}).strict()
const table='ha_foreign_execution_evidence'
const context=(exportId:string)=>'ha-foreign-execution-evidence:v1:'+z.string().uuid().parse(exportId)
const specs=[['execution_owner_runs','id,channel_id,payload,signature','id','runs',100000],['execution_owner_slots','channel_id,run_id,version','channel_id','slots',100000],['execution_owner_asrun','asrun_id,run_id,signature','asrun_id','asRunLinks',500000]] as const
const lifecycleSpecs=[['distribution_owner_runs','id,payload,signature',100000],['distribution_owner_slot','id,run_id,version',1],['server_instances','id,payload,signature',100000],['storage_admission','id,payload,signature',1],['restoration_records','id,payload,signature',100000],['restored_activation_runs','id,payload,signature',100000]] as const

function lifecycleInventory(db:Database.Database){
  const digest=createHash('sha256');let rows=0,bytes=0
  for(const [name,columns,maximum] of lifecycleSpecs){
    const present=Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name))
    if(!present){digest.update(JSON.stringify([name,null])+'\n');continue}
    const count=(db.prepare('SELECT count(*) AS n FROM '+name).get() as {n:number}).n
    if(!Number.isSafeInteger(count)||count>maximum)throw new Error('Histórico assinado excede limite.')
    digest.update(JSON.stringify([name,count])+'\n')
    for(const row of db.prepare('SELECT '+columns+' FROM '+name+' ORDER BY id').iterate()){
      const encoded=JSON.stringify(row),length=Buffer.byteLength(encoded)
      if(length>2*1024*1024||(bytes+=length)>64*1024*1024)throw new Error('Histórico assinado excede orçamento.')
      digest.update(encoded+'\n');rows++
    }
  }
  return lifecycleEvidence.parse({rows,inventoryHash:digest.digest('hex'),coverage:'DISTRIBUTION_SERVER_STORAGE_RESTORE_ACTIVATION'})
}

/** Digest the ORIGINAL signed rows. Never replace foreign signatures with local
 * signatures: doing so would convert historical evidence into engine authority. */
function inventory(db:Database.Database){
  const digest=createHash('sha256'),counts={runs:0,slots:0,asRunLinks:0};let bytes=0
  for(const [name,columns,order,key,maximum] of specs){
    const size=(db.prepare('SELECT count(*) AS n FROM '+name).get() as {n:number}).n
    if(!Number.isSafeInteger(size)||size>maximum)throw new Error('Inventário de posse excede limite; não truncar.')
    digest.update(JSON.stringify([name,size])+'\n')
    for(const row of db.prepare('SELECT '+columns+' FROM '+name+' ORDER BY '+order).iterate()){
      const encoded=JSON.stringify(row),length=Buffer.byteLength(encoded)
      if(length>2*1024*1024||(bytes+=length)>64*1024*1024)throw new Error('Evidência de posse excede limite.')
      digest.update(encoded+'\n');counts[key]++
    }
    if(counts[key]!==size)throw new Error('Inventário de posse mudou.')
  }
  return {...counts,inventoryHash:digest.digest('hex')}
}

/** Called inside the export transaction, after schema compatibility checks. */
export function exportOwnershipEvidence(db:Database.Database,exportId:string,pairing:SecretVault,source:SecretVault){
  if(source.fingerprint!==installationVault(false).fingerprint)throw new Error('Cofre informado não corresponde ao verificador da origem.')
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(table))throw new Error('Evidência estrangeira já presente; derivada não pode ser exportada como execução local.')
  const facts=inventory(db),lifecycle=lifecycleInventory(db)
  validateExecutionOwnership(db)
  validateDistributionOwnership(db);validateServerInstances(db);readStorageAdmission(db);readRestorationRecords(db);readRestoredActivations(db)
  const proof=haOwnershipEvidence.parse({version:1,...facts,lifecycleEvidence:lifecycle,sourceVaultFingerprint:source.fingerprint,validation:'SOURCE_SIGNATURES_CHECKED',authorityTransferred:false})
  db.exec('CREATE TABLE ha_foreign_execution_evidence(id INTEGER PRIMARY KEY CHECK(id=1),export_id TEXT NOT NULL,payload TEXT NOT NULL)')
  db.prepare('INSERT INTO ha_foreign_execution_evidence VALUES(1,?,?)').run(exportId,pairing.encrypt(JSON.stringify(proof),context(exportId)))
  return proof
}

/** Transport attestation only. The active execution-ownership validator remains
 * unchanged and still rejects signatures belonging to another installation. */
export function importOwnershipEvidence(db:Database.Database,exportId:string,pairing:SecretVault,target:SecretVault,expected?:z.infer<typeof haOwnershipEvidence>){
  const present=Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))
  if(!expected){if(present)throw new Error('Evidência de posse sem prova no selo.');return undefined}
  const proof=haOwnershipEvidence.parse(expected)
  if(!present)throw new Error('Evidência de posse ausente.')
  const rows=db.prepare('SELECT id,export_id,payload FROM ha_foreign_execution_evidence').all() as Array<{id:number;export_id:string;payload:string}>
  const row=rows[0]
  if(rows.length!==1||!row||row.id!==1||row.export_id!==exportId||typeof row.payload!=='string'||row.payload.length>16384)throw new Error('Evidência de posse incompatível.')
  const transported=haOwnershipEvidence.parse(JSON.parse(pairing.decrypt(row.payload,context(exportId))))
  if(JSON.stringify(transported)!==JSON.stringify(proof))throw new Error('Evidência diverge do selo.')
  const current=inventory(db)
  if(current.inventoryHash!==proof.inventoryHash||current.runs!==proof.runs||current.slots!==proof.slots||current.asRunLinks!==proof.asRunLinks)throw new Error('Assinaturas/posse recebidas divergem da evidência.')
  if(proof.lifecycleEvidence&&JSON.stringify(lifecycleInventory(db))!==JSON.stringify(proof.lifecycleEvidence))throw new Error('Histórico de distribuição/servidor/manutenção/restauração diverge da evidência.')
  const stored={...proof,exportId,retainedAs:'FOREIGN_HISTORICAL_EVIDENCE' as const,localExecutionAuthorized:false as const}
  if(db.prepare('UPDATE ha_foreign_execution_evidence SET payload=? WHERE id=1 AND export_id=?').run(target.encrypt(JSON.stringify(stored),context(exportId)),exportId).changes!==1)throw new Error('Evidência não foi preservada.')
  return proof
}

export function inspectStoredOwnershipEvidence(db:Database.Database,exportId:string,target:SecretVault,expected?:z.infer<typeof haOwnershipEvidence>){
  const present=Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))
  if(!expected){if(present)throw new Error('Histórico estrangeiro sem prova correspondente.');return null}
  if(!present)throw new Error('Evidência reprotegida ausente.')
  const proof=haOwnershipEvidence.parse(expected),rows=db.prepare('SELECT id,export_id,payload FROM ha_foreign_execution_evidence').all() as Array<{id:number;export_id:string;payload:string}>
  const row=rows[0]
  if(rows.length!==1||!row||row.id!==1||row.export_id!==exportId||typeof row.payload!=='string'||row.payload.length>16384)throw new Error('Evidência reprotegida inválida.')
  const stored=haOwnershipEvidence.extend({exportId:z.string().uuid(),retainedAs:z.literal('FOREIGN_HISTORICAL_EVIDENCE'),localExecutionAuthorized:z.literal(false)}).strict().parse(JSON.parse(target.decrypt(row.payload,context(exportId))))
  const {exportId:storedId,retainedAs:_,localExecutionAuthorized:__,...actual}=stored
  if(storedId!==exportId||JSON.stringify(actual)!==JSON.stringify(proof))throw new Error('Evidência reprotegida diverge do recibo.')
  const current=inventory(db)
  if(current.inventoryHash!==proof.inventoryHash||current.runs!==proof.runs||current.slots!==proof.slots||current.asRunLinks!==proof.asRunLinks||proof.lifecycleEvidence&&JSON.stringify(lifecycleInventory(db))!==JSON.stringify(proof.lifecycleEvidence))throw new Error('Histórico estrangeiro mudou após reproteção.')
  return {inventoryMatched:true as const,sourceSignaturesAttested:true as const,localExecutionAuthorized:false as const,authorityTransferred:false as const}
}
