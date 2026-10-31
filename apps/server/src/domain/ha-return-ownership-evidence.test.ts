// NOT_RUN: source fixtures only; no worker/native/network qualification.
import Database from 'better-sqlite3'
import {it,expect} from 'vitest'
import {randomUUID} from 'node:crypto'
import {SecretVault,installationVault} from './secret-vault.js'
import {migrateExecutionOwnership,executionOwnerSignature,executionAsRunSignature,type ExecutionOwner} from '../db/execution-ownership.js'
import {exportOwnershipEvidence,importOwnershipEvidence,inspectStoredOwnershipEvidence,haOwnershipEvidence} from './ha-return-ownership-evidence.js'
import {migrateDistributionOwnership} from '../db/distribution-ownership.js'
import {migrateServerInstances} from '../db/server-instances.js'
import {migrateStorageAdmission} from '../db/storage-admission.js'
import {migrateRestorationRecords} from '../db/restoration-records.js'
import {migrateRestoredActivations} from '../db/restored-activations.js'

function fixture(){
  const db=new Database(':memory:')
  db.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT,applied_at TEXT); CREATE TABLE channels(id TEXT PRIMARY KEY); CREATE TABLE as_run(id TEXT PRIMARY KEY,channel_id TEXT); INSERT INTO channels VALUES(\'ch\'); INSERT INTO as_run VALUES(\'a\',\'ch\')')
  migrateExecutionOwnership(db)
  migrateDistributionOwnership(db);migrateServerInstances(db);migrateStorageAdmission(db);migrateRestorationRecords(db);migrateRestoredActivations(db)
  const owner:ExecutionOwner={id:randomUUID(),channelId:'ch',sequence:1,host:'reserve',pid:123,boot:randomUUID(),phase:'RELEASED',enginePids:[],engineTokens:{},spawning:false,spawnToken:null,createdAt:'2026-10-11T00:00:00.000Z',recoveredRunId:null,predecessorResolved:true,finalRelease:true}
  db.prepare('INSERT INTO execution_owner_runs VALUES(?,?,?,?)').run(owner.id,'ch',JSON.stringify(owner),executionOwnerSignature(owner))
  db.prepare('INSERT INTO execution_owner_slots VALUES(?,?,?)').run('ch',owner.id,1)
  db.prepare('INSERT INTO execution_owner_asrun VALUES(?,?,?)').run('a',owner.id,executionAsRunSignature('a',owner.id))
  return {db,owner}
}
it('atestado de transporte não pode conceder autoridade — NOT_RUN',()=>{
  const proof={version:1,runs:0,slots:0,asRunLinks:0,inventoryHash:'a'.repeat(64),sourceVaultFingerprint:'b'.repeat(64),validation:'SOURCE_SIGNATURES_CHECKED',authorityTransferred:false}
  expect(haOwnershipEvidence.safeParse(proof).success).toBe(true)
  expect(haOwnershipEvidence.safeParse({...proof,authorityTransferred:true}).success).toBe(false)
  expect(haOwnershipEvidence.safeParse({...proof,installationKey:'secret'}).success).toBe(false)
})
it('preserva assinaturas originais e recifra apenas evidência — NOT_RUN',()=>{
  const {db,owner}=fixture(),exportId=randomUUID(),pairing=new SecretVault(Buffer.alloc(32,3)),target=new SecretVault(Buffer.alloc(32,4))
  try{
    const original=db.prepare('SELECT * FROM execution_owner_runs').all()
    const proof=db.transaction(()=>exportOwnershipEvidence(db,exportId,pairing,installationVault(false))).immediate()
    expect(proof.runs).toBe(1);expect(proof.asRunLinks).toBe(1)
    expect(proof.lifecycleEvidence?.rows).toBe(1)
    expect(db.transaction(()=>importOwnershipEvidence(db,exportId,pairing,target,proof)).immediate()).toEqual(proof)
    expect(inspectStoredOwnershipEvidence(db,exportId,target,proof)).toEqual({inventoryMatched:true,sourceSignaturesAttested:true,localExecutionAuthorized:false,authorityTransferred:false})
    expect(db.prepare('SELECT * FROM execution_owner_runs').all()).toEqual(original)
    expect(target.reviewIdentity(JSON.stringify(owner),'execution-owner:v1')).not.toBe(executionOwnerSignature(owner))
    const row=db.prepare('SELECT payload FROM ha_foreign_execution_evidence').get() as {payload:string}
    expect(JSON.parse(target.decrypt(row.payload,'ha-foreign-execution-evidence:v1:'+exportId)).localExecutionAuthorized).toBe(false)
    expect(()=>exportOwnershipEvidence(db,randomUUID(),pairing,installationVault(false))).toThrow()
  }finally{db.close()}
})
it('assinatura inválida na origem impede atestado — NOT_RUN',()=>{
  const {db}=fixture(),pairing=new SecretVault(Buffer.alloc(32,3))
  try{
    db.prepare('UPDATE execution_owner_runs SET signature=?').run('invalid')
    expect(()=>db.transaction(()=>exportOwnershipEvidence(db,randomUUID(),pairing,installationVault(false))).immediate()).toThrow()
    expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name='ha_foreign_execution_evidence'").get()).toBeUndefined()
  }finally{db.close()}
})
it('admissão de armazenamento alterada não é liberada por transporte — NOT_RUN',()=>{
  const {db}=fixture(),exportId=randomUUID(),pairing=new SecretVault(Buffer.alloc(32,3)),target=new SecretVault(Buffer.alloc(32,4))
  try{
    const proof=db.transaction(()=>exportOwnershipEvidence(db,exportId,pairing,installationVault(false))).immediate()
    db.prepare('UPDATE storage_admission SET signature=?').run('tampered')
    expect(()=>db.transaction(()=>importOwnershipEvidence(db,exportId,pairing,target,proof)).immediate()).toThrow()
    expect((db.prepare('SELECT signature FROM storage_admission').get() as {signature:string}).signature).toBe('tampered')
  }finally{db.close()}
})
it('alteração após atestado recusa importação sem reescrever provas — NOT_RUN',()=>{
  const {db}=fixture(),exportId=randomUUID(),pairing=new SecretVault(Buffer.alloc(32,3)),target=new SecretVault(Buffer.alloc(32,4))
  try{
    const proof=db.transaction(()=>exportOwnershipEvidence(db,exportId,pairing,installationVault(false))).immediate()
    const original=db.prepare('SELECT payload FROM ha_foreign_execution_evidence').get()
    db.prepare('UPDATE execution_owner_runs SET signature=?').run('tampered')
    expect(()=>db.transaction(()=>importOwnershipEvidence(db,exportId,pairing,target,proof)).immediate()).toThrow()
    expect(db.prepare('SELECT payload FROM ha_foreign_execution_evidence').get()).toEqual(original)
  }finally{db.close()}
})
