import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {inspectWal} from './lib/wal-evidence.js'

assert.equal(process.argv.length,3)
const directory=resolve(process.argv[2]!),report=JSON.parse(await readFile(join(directory,'result.json'),'utf8'))
assert.equal(report.result,'PASS');assert.equal(report.ownedJobStopped,true)
const old=JSON.parse(await readFile(join(report.legacyEvidence,'result.json'),'utf8'))
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
assert.equal(hash(await readFile(join(report.legacyEvidence,'legacy-backup.db'))),old.backupHash)
assert.equal(hash(await readFile(report.backup)),report.backupHash)
const manifest=JSON.parse(await readFile(join(report.install,'package-manifest.json'),'utf8'))
assert.equal(hash(await readFile(join(report.install,'package-manifest.json'))),'9a248ffa3f8e4792d85c782aa590a6cff60fc2a6d51bd8d617dfef02e5f155de')
for(const name of ['runtime/node/node.exe','apps/server/dist/restore-backup.cjs','apps/server/dist/migrate-restored.cjs','apps/engine/target/release/rplayout-host-guard.exe'])assert.equal(hash(await readFile(join(report.install,name))),manifest.files.find((entry:any)=>entry.file===name).sha256.toLowerCase())
process.env.RPLAYOUT_VAULT_FILE=join(report.prepared,'vault.json');delete process.env.RPLAYOUT_VAULT_KEY
const {installationVault}=await import('../apps/server/src/domain/secret-vault.js')
const {verifyRestorationManifest}=await import('../apps/server/src/domain/restoration-manifest.js')
const {readStorageAdmission}=await import('../apps/server/src/db/storage-admission.js')
const {assertNoInterruptedRestoredMigration}=await import('../apps/server/src/domain/migrate-restored-copy.js')
const {assertSchemaCompatibility}=await import('../apps/server/src/db/schema-compatibility.js')
const {readRestoredActivations}=await import('../apps/server/src/db/restored-activations.js')
const vault=installationVault(false),SQLite=createRequire(join(report.install,'apps/server/dist/server.cjs'))('better-sqlite3')
const backup=new SQLite(report.backup,{readonly:true,fileMustExist:true}),interrupted=new SQLite(join(report.prepared,'service.db'),{readonly:true,fileMustExist:true}),fresh=new SQLite(join(report.fresh,'service.db'),{readonly:true,fileMustExist:true})
const decisions=(db:any)=>db.prepare("SELECT kind,payload FROM operator_decisions WHERE kind LIKE 'RESTORED_SCHEMA_MIGRATION_%' ORDER BY rowid").all().map((row:any)=>({kind:row.kind,value:JSON.parse(vault.decrypt(row.payload,'operator_decisions.payload'))}))
let interruptedRequest='',freshRequest='',wal:any=null
try{
  const interruptedReceipt=await verifyRestorationManifest(interrupted,join(report.prepared,'restore-quarantine.json')),freshReceipt=await verifyRestorationManifest(fresh,join(report.fresh,'restore-quarantine.json'))
  interruptedRequest=interruptedReceipt.requestId;freshRequest=freshReceipt.requestId
  assert.notEqual(interruptedRequest,freshRequest)
  for(const receipt of [interruptedReceipt,freshReceipt])assert.equal(receipt.backupSha256,report.backupHash)
  for(const db of [backup,interrupted,fresh]){assert.equal(db.pragma('integrity_check',{simple:true}),'ok');assert.deepEqual(db.pragma('foreign_key_check'),[]);assert.equal(readRestoredActivations(db).length,0)}
  const pending=decisions(interrupted),confirmed=decisions(fresh)
  assert.deepEqual(pending.map((row:any)=>row.kind),['RESTORED_SCHEMA_MIGRATION_STARTED'])
  assert.deepEqual(pending[0].value,report.interruptedIntent);assert.equal(pending[0].value.restorationId,interruptedRequest)
  assert.throws(()=>assertNoInterruptedRestoredMigration(interrupted),/interrompida/)
  assert.equal(report.retry.refused,true);assert.match(report.retry.message,/interrompida/)
  assert.equal(readStorageAdmission(interrupted)!.phase,'MAINTENANCE')
  assert.deepEqual(confirmed.map((row:any)=>row.kind),['RESTORED_SCHEMA_MIGRATION_STARTED','RESTORED_SCHEMA_MIGRATION_CONFIRMED'])
  assert.equal(confirmed[0].value.id,confirmed[1].value.id);assert.equal(confirmed[0].value.restorationId,freshRequest)
  assert.equal(readStorageAdmission(fresh)!.phase,'OPEN');assert.doesNotThrow(()=>assertNoInterruptedRestoredMigration(fresh))
  assert.equal(assertSchemaCompatibility(backup).applied,45);assert.equal(assertSchemaCompatibility(fresh,true).applied,50)
  assert.deepEqual(interrupted.prepare('SELECT * FROM schema_migrations ORDER BY version').all(),report.afterInterruption.migrations)
  for(const table of ['channels','rundowns']){
    const original=backup.prepare(`SELECT * FROM ${table} ORDER BY id`).all()
    assert.deepEqual(interrupted.prepare(`SELECT * FROM ${table} ORDER BY id`).all(),original)
    assert.deepEqual(fresh.prepare(`SELECT * FROM ${table} ORDER BY id`).all(),original)
  }
  const columns='id,channel_id,component,state,severity,message,occurred_at,acknowledged_at'
  const events=backup.prepare(`SELECT ${columns} FROM health_events ORDER BY id`).all()
  for(const db of [interrupted,fresh])assert.deepEqual(db.prepare(`SELECT ${columns} FROM health_events ORDER BY id`).all(),events)
  assert.equal(backup.prepare("SELECT COUNT(*) AS n FROM health_events WHERE component='QA_MIGRATION_FIXTURE' AND state='fixture' AND severity='INFO' AND message IS NULL AND channel_id IS NULL AND acknowledged_at IS NULL").get().n,report.syntheticInfoRows)
  assert.equal(fresh.prepare("SELECT COUNT(*) AS n FROM health_events WHERE component='QA_MIGRATION_FIXTURE' AND (resolved_at IS NOT NULL OR observation_ended_at IS NOT NULL OR context IS NOT NULL)").get().n,0)
  if(report.duringTransaction){
    const bytes=await readFile(join(directory,'pre-interruption.wal'))
    assert.equal(hash(bytes),report.walEvidence.sha256)
    wal=inspectWal(bytes);assert.ok(wal?.checksumValidated)
    const pages=[...new Set(wal!.frames.filter(frame=>frame.index>wal!.lastCommit&&frame.page>report.pagesAtIntent).map(frame=>frame.page))]
    assert.deepEqual(pages,report.walEvidence.newUncommittedPages);assert.ok(pages.length)
    assert.equal(assertSchemaCompatibility(interrupted).applied,45,'Interrupted atomic initialize did not publish partial migration markers')
  }
}finally{backup.close();interrupted.close();fresh.close()}
// Independent process inventory, not an old result/lockfile used as liveness.
const q=(value:string)=>"'"+value.replaceAll("'","''")+"'"
const code=`$ErrorActionPreference='Stop'; @((Get-CimInstance Win32_Process) | Where-Object {$_.ProcessId -ne ${process.pid} -and $_.ExecutablePath -and $_.ExecutablePath.StartsWith(${q(report.install+'\\')},[StringComparison]::OrdinalIgnoreCase)}).Count`
const processes=await promisify(execFile)(join(process.env.SystemRoot!,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-Command',code],{windowsHide:true,timeout:15000,maxBuffer:1024})
assert.equal(Number(processes.stdout.trim()),0,'QA installation must have no remaining processes')
const result={result:'PASS',interruptedRequest,freshRequest,pendingIntentRetained:true,retryRefusedWithoutReplay:true,originalBackupsUnchanged:true,editorialAndDiagnosticRowsPreserved:true,newCopyMigratedThrough:50,noActivationRecords:true,interruptedAdmissionRetained:true,freshAdmissionOpen:true,inTransactionWalObserved:report.duringTransaction===true,validatedUncommittedFrames:wal?wal.frames.length-wal.lastCommit:null,syntheticInfoRows:report.syntheticInfoRows,ownedProcessesStopped:true,scope:report.scope,powerLossValidated:false,legacyNativePgmValidated:false}
await writeFile(join(directory,'assertions-interrupted-migration.json'),JSON.stringify(result,null,2))
console.log(JSON.stringify(result))
