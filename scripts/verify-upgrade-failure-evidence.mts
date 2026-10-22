import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'

assert.equal(process.argv.length,3)
const directory=resolve(process.argv[2]!),report=JSON.parse(await readFile(join(directory,'result.json'),'utf8'))
assert.equal(report.result,'FAIL');assert.ok(report.prepared)
const hash=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex')
assert.equal(hash(await readFile(report.sourceBackup.file)),report.sourceBackup.sha256)
assert.equal(report.ownedFamilyStopped,true);assert.equal(report.qaProfileRestored,true)
assert.equal(hash(await readFile(join(report.install,'installation-profile.json'))),hash(await readFile(join(directory,'prior-profile.json'))))
process.env.RPLAYOUT_VAULT_FILE=join(report.prepared,'vault.json');delete process.env.RPLAYOUT_VAULT_KEY
const {verifyRestorationManifest}=await import('../apps/server/src/domain/restoration-manifest.js')
const {readRestoredActivations}=await import('../apps/server/src/db/restored-activations.js')
const SQLite=createRequire(join(report.install,'apps/server/dist/server.cjs'))('better-sqlite3')
const db=new SQLite(join(report.prepared,'service.db'),{readonly:true,fileMustExist:true}),backup=new SQLite(report.sourceBackup.file,{readonly:true,fileMustExist:true})
let activation:any
try{
  assert.equal(db.pragma('integrity_check',{simple:true}),'ok')
  await verifyRestorationManifest(db,join(report.prepared,'restore-quarantine.json'))
  activation=readRestoredActivations(db).at(-1);assert.equal(activation.phase,'FAILED')
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ha_recovery_origin'").get())
  assert.deepEqual(db.prepare('SELECT * FROM channel_checkpoints ORDER BY channel_id').all(),backup.prepare('SELECT * FROM channel_checkpoints ORDER BY channel_id').all())
  assert.deepEqual(db.prepare('SELECT * FROM as_run ORDER BY rowid').all(),backup.prepare('SELECT * FROM as_run ORDER BY rowid').all())
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM operator_decisions WHERE kind LIKE 'UPGRADE_PROFILE_%'").get().n,0)
}finally{db.close();backup.close()}
const result={result:'PASS',scope:'Readonly evidence of refused activation; this does NOT approve the failed upgrade attempt',failedActivationAuthenticated:true,phase:activation.phase,requestId:activation.requestId,originPreserved:true,checkpointPreserved:true,asRunPreserved:true,profileUnchanged:true,noAdoptionJournal:true,sourceBackupHashPreserved:true}
await writeFile(join(directory,'assertions-failure-preservation.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result))
