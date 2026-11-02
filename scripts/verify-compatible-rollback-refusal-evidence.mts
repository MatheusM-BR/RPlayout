import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createRequire} from 'node:module'
import {createHash} from 'node:crypto'

assert.equal(process.argv.length,3)
const directory=resolve(process.argv[2]!),report=JSON.parse(await readFile(join(directory,'result.json'),'utf8'))
assert.equal(report.result,'FAIL');assert.match(report.error,/Checkpoint não pertence/)
assert.equal(report.preparedLatestHistoryPreserved,true);assert.equal(report.ownedFamilyStopped,true);assert.equal(report.targetQaProfileRestored,true)
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
assert.equal(hash(await readFile(report.latest)),report.latestHash)
assert.equal(hash(await readFile(report.originalBaseline)),report.originalBaselineHash)
assert.equal(hash(await readFile(join(report.target,'installation-profile.json'))),hash(await readFile(join(directory,'prior-target-profile.json'))))
process.env.RPLAYOUT_VAULT_FILE=join(report.prepared,'vault.json');delete process.env.RPLAYOUT_VAULT_KEY
const {installationVault}=await import('../apps/server/src/domain/secret-vault.js')
const {verifyRestorationManifest}=await import('../apps/server/src/domain/restoration-manifest.js')
const {readRestoredActivations}=await import('../apps/server/src/db/restored-activations.js')
const {readExecutionOwner}=await import('../apps/server/src/db/execution-ownership.js')
const vault=installationVault(false),envelope=JSON.parse(await readFile(join(report.prepared,'rollback-preparation.json'),'utf8'))
const preparation=JSON.parse(vault.decrypt(envelope.protectedReport,'compatible-rollback:v1:report'))
const SQLite=createRequire(join(report.current,'apps/server/dist/server.cjs'))('better-sqlite3')
const source=new SQLite(preparation.current.file,{readonly:true,fileMustExist:true}),candidate=new SQLite(join(report.prepared,'service.db'),{readonly:true,fileMustExist:true})
let activation:any
try{
  assert.equal(candidate.pragma('integrity_check',{simple:true}),'ok')
  assert.deepEqual(candidate.prepare('SELECT * FROM as_run ORDER BY rowid').all(),source.prepare('SELECT * FROM as_run ORDER BY rowid').all())
  assert.deepEqual(candidate.prepare('SELECT * FROM channel_checkpoints ORDER BY channel_id').all(),source.prepare('SELECT * FROM channel_checkpoints ORDER BY channel_id').all())
  const receipt=await verifyRestorationManifest(candidate,join(report.prepared,'restore-quarantine.json'))
  activation=readRestoredActivations(candidate).at(-1)
  assert.equal(activation.phase,'FAILED');assert.equal(activation.requestId,receipt.requestId)
  assert.equal(receipt.requestId,preparation.requestId);assert.deepEqual(activation.nativeReadyChannels,[]);assert.deepEqual(activation.resumedChannels,[])
  assert.match(activation.message,/Checkpoint não pertence/)
  const releases=candidate.prepare("SELECT payload FROM operator_decisions WHERE kind LIKE 'RESTORED_OUTPUT_RELEASE_%'").all().map((row:any)=>JSON.parse(vault.decrypt(row.payload,'operator_decisions.payload')))
  assert.equal(releases.filter((row:any)=>row.activationId===activation.id).length,0,'No program/preview release attempted by failed activation')
  assert.ok(candidate.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ha_recovery_origin'").get())
  const owner=readExecutionOwner(candidate,'qa')!
  assert.equal(owner.phase,'RELEASED');assert.equal(owner.spawning,false);assert.deepEqual(owner.enginePids,[])
}finally{source.close();candidate.close()}
const result={result:'PASS',sourceRunResult:'FAIL',scope:'Independent readonly verification of safe checkpoint refusal, NOT a successful rollback',activation:{id:activation.id,phase:activation.phase},latestAsRunAndCheckpointPreserved:true,noOutputReleaseAttempted:true,originRetained:true,sourceBackupsPreserved:true,targetQaProfileRestored:true,ownedFamilyStopped:true,successfulRollbackValidated:false,transientPidReuseObserved:false}
await writeFile(join(directory,'assertions-compatible-rollback-refusal.json'),JSON.stringify(result,null,2))
console.log(JSON.stringify(result))
