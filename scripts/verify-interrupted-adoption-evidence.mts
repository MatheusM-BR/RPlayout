import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'

assert.equal(process.argv.length,3)
const directory=resolve(process.argv[2]!),report=JSON.parse(await readFile(join(directory,'result.json'),'utf8'))
assert.equal(report.result,'PASS');assert.equal(report.interruptAdoption,true);assert.equal(report.ownedFamilyStopped,true);assert.equal(report.qaProfileRestored,true)
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
assert.equal(hash(await readFile(report.sourceBackup.file)),report.sourceBackup.sha256)
const observed=await readFile(join(directory,'interrupted-profile.json'))
const published=report.interruptAfterPublication===true
assert.equal(hash(observed),published?report.interruptedIntent.candidateHash:report.interruptedIntent.previousHash)
if(published){
  assert.equal(report.candidateObservedBeforeStop.sha256,report.interruptedIntent.candidateHash)
  assert.equal(report.publicationFault.kind,'QA_SQLITE_WRITE_CONTENTION')
  assert.equal(report.publicationFault.businessWrites,0);assert.equal(report.publicationFault.journalWrites,0);assert.equal(report.publicationFault.ownJobStoppedBeforeUnlock,true)
}
assert.equal(hash(await readFile(join(report.install,'installation-profile.json'))),hash(await readFile(join(directory,'prior-profile.json'))))
process.env.RPLAYOUT_VAULT_FILE=join(report.prepared,'vault.json');delete process.env.RPLAYOUT_VAULT_KEY
const {verifyRestorationManifest}=await import('../apps/server/src/domain/restoration-manifest.js')
const {installationVault}=await import('../apps/server/src/domain/secret-vault.js')
const {pendingUpgradeProfiles,assertNoUncertainUpgradeProfile}=await import('../apps/server/src/domain/upgrade-profile-adoption.js')
const {readStorageAdmission}=await import('../apps/server/src/db/storage-admission.js')
const {readRestoredActivations}=await import('../apps/server/src/db/restored-activations.js')
const SQLite=createRequire(join(report.install,'apps/server/dist/server.cjs'))('better-sqlite3'),database=join(report.prepared,'service.db')
const db=new SQLite(database,{readonly:true,fileMustExist:true})
let requestId='',phase=''
try{
  const receipt=await verifyRestorationManifest(db,join(report.prepared,'restore-quarantine.json'));requestId=receipt.requestId
  assert.equal(db.pragma('integrity_check',{simple:true}),'ok');assert.equal(readStorageAdmission(db)!.phase,'OPEN')
  const activation=readRestoredActivations(db).at(-1)!
  assert.equal(activation.phase,'CONFIRMED');assert.equal(activation.id,report.interruptedIntent.activationId);assert.equal(activation.requestId,requestId)
  const journal=db.prepare("SELECT kind,payload FROM operator_decisions WHERE kind LIKE 'UPGRADE_PROFILE_%' ORDER BY rowid").all().map((row:any)=>({kind:row.kind,value:JSON.parse(installationVault(false).decrypt(row.payload,'operator_decisions.payload'))}))
  assert.deepEqual(journal.map((row:any)=>row.kind),['UPGRADE_PROFILE_STARTED',published?'UPGRADE_PROFILE_CONFIRMED':'UPGRADE_PROFILE_REFUSED'])
  assert.deepEqual(journal[0].value,report.interruptedIntent)
  const terminal=journal[1].value;phase=terminal.phase
  if(published){assert.equal(hash(await readFile(terminal.previousProfile)),terminal.previousHash);assert.notEqual(terminal.previousHash,terminal.candidateHash)}
  for(const key of ['id','activationId','requestId','previousHash','candidateHash','previousProfile'])assert.equal(terminal[key],report.interruptedIntent[key])
  assert.equal(terminal.reconciliation,'OBSERVED_FILE_ONLY');assert.equal(terminal.historicalPublicationAckKnown,false)
  assert.equal(pendingUpgradeProfiles(db).size,0);assert.doesNotThrow(()=>assertNoUncertainUpgradeProfile(db))
  const recovery=db.prepare("SELECT payload FROM operator_decisions WHERE kind='RESTORED_RESERVATION_RECOVERED' ORDER BY rowid DESC LIMIT 1").get()
  const recovered=JSON.parse(installationVault(false).decrypt(recovery.payload,'operator_decisions.payload'))
  assert.equal(recovered.requestId,requestId);assert.equal(recovered.previousAdmission.phase,'MAINTENANCE')
  assert.equal(recovered.executionStarted,false);assert.equal(recovered.automaticPromotion,false)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM restored_activation_runs').get().n,1)
}finally{db.close()}
// Reuse of a completed ID must be a refusal, never a second profile change.
const run=promisify(execFile),env={...process.env,RPLAYOUT_INSTALL_ROOT:report.install}
let repeatRefused=false
try{await run(join(report.install,'runtime/node/node.exe'),[join(report.install,'apps/server/dist/reconcile-upgrade-profile.cjs'),'--database',database,'--vault-file',join(report.prepared,'vault.json'),'--installation',report.install,'--adoption-id',report.interruptedIntent.id,'--confirm','RECONCILIAR'],{env,windowsHide:true,timeout:30000,maxBuffer:8192})}
catch(error){const e=error as any;assert.equal(e.code,1);assert.match(String(e.stderr),/não está pendente/);repeatRefused=true;await writeFile(join(directory,'completed-id-refused.log'),String(e.stderr))}
assert.equal(repeatRefused,true)
const final=new SQLite(database,{readonly:true,fileMustExist:true})
try{assert.equal(final.prepare("SELECT COUNT(*) AS n FROM operator_decisions WHERE kind LIKE 'UPGRADE_PROFILE_%'").get().n,2)}finally{final.close()}
const result={result:'PASS',requestId,phase,actualOwnProcessInterrupted:true,candidatePublishedBeforeInterruption:published,authenticatedIntentAndTerminal:true,maintenanceRecoveredExplicitly:true,ordinaryRecoveryRefused:report.reconciliation.withoutReleaseRefused,completedIdRefused:true,noDuplicateJournal:true,noProfileWriteByReconciliation:true,historicalPublicationAckKnown:false,scope:published?'Candidate-profile branch after actual owned-job interruption with QA SQLite writer contention; not physical power loss or operational rollback':'Previous-profile branch after real own-job interruption; not candidate-published branch, power loss or operational rollback'}
await writeFile(join(directory,'assertions-interrupted-adoption.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result))
