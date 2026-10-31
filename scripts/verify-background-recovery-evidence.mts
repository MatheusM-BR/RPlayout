import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import {createHash} from 'node:crypto'
import {assertStorageQaProxyEvidence} from './lib/storage-qa-proxy.js'

// Existing trace + data only. Never rerun the compiled backend, scheduler,
// trigger, requests, normal shutdown or any native command.
assert.equal(process.argv.length,4)
const root=fileURLToPath(new URL('..',import.meta.url)),guardDirectory=resolve(process.argv[2]!),compiledDirectory=resolve(process.argv[3]!)
assert.ok(guardDirectory.startsWith(join(root,'scratch','background-storage-guard-')))
assert.ok(compiledDirectory.startsWith(join(root,'scratch','compiled-background-recovery-')))
const guard=JSON.parse(await readFile(join(guardDirectory,'result.json'),'utf8')),report=JSON.parse(await readFile(join(compiledDirectory,'result.json'),'utf8'))
assert.equal(guard.result,'PASS');assert.equal(guard.ownServicesStopped,true);assert.equal(guard.afterErrorEffects,0);assert.equal(guard.closeNotifications,1);assert.deepEqual(guard.unhandledRejections,[]);assert.equal(guard.guard.suspended,true)
assert.equal(guard.httpAndWebSocketValidated,false);assert.equal(guard.pgmAndEngineValidated,false)
const markerOnlyHarnessFailure=report.result==='FAIL'&&report.teardownError==='Own process closure not confirmed; no historical PID will be stopped'&&report.ownBackendExited&&report.ownStorageServicesStopped&&report.storageObserver?.stage==='STARTED'&&Boolean(report.signedStorageClosure)&&Boolean(report.compiledServerSha256)
assert.ok(report.result==='PASS'||markerOnlyHarnessFailure,'No other failure may be reinterpreted as approved')
assert.equal(report.ownBackendExited,true);assert.equal(report.ownStorageServicesStopped,true);assert.ok(report.rejectedCycles>=3)
assert.deepEqual(report.healthTransitionAfterFault,{engineEvents:1,videoEvents:1,notPrematurelyMarkedRecorded:true,stableObservedForMs:300})
for(const key of ['httpClientValidated','webSocketValidated','nativeEngineAndPgmValidated','installedPackageValidated','osHelperFamilyInventoryValidated'])assert.equal(report[key],false)
assert.ok(report.binaries.startsWith(join(root,'scratch','host-history-r88-background-')))
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
assert.equal(hash(await readFile(join(report.binaries,'server.cjs'))),report.compiledServerSha256)
assert.equal(hash(await readFile(join(root,'apps/server/src/domain/background-task-guard.ts'))),guard.guardSourceSha256)
for(const name of ['storage-bridge.cjs','storage-service.cjs'])assert.equal(hash(await readFile(join(report.binaries,name))),guard.hashes[name])
assert.equal(hash(await readFile(join(compiledDirectory,'observed-storage/storage-bridge.cjs'))),guard.hashes['storage-bridge.cjs'])
if(report.qaProxy){assert.equal(report.qaProxy.proxyName,'storage-observer-proxy.cjs');await assertStorageQaProxyEvidence(join(compiledDirectory,'observed-storage'),report.binaries,report.qaProxy)}
else assert.equal(hash(await readFile(join(compiledDirectory,'observed-storage/storage-service.cjs'))),hash(await readFile(join(root,'scripts/fixtures/storage-observer-proxy.cjs'))))
const logs=await readFile(join(compiledDirectory,'server.log'),'utf8')
assert.ok(logs.includes('[rplayout startup] HTTP listening'))
assert.ok(logs.split(/\r?\n/).filter(line=>line.includes('"task":"live-cycle"')&&line.includes('SQLITE_CONSTRAINT_TRIGGER')).length>=3)
const SQLite=createRequire(new URL('../apps/server/package.json',import.meta.url))('better-sqlite3')
const guardedFile=join(guardDirectory,'Banco-background-ação.db'),guardBefore=hash(await readFile(guardedFile)),guarded=new SQLite(guardedFile,{readonly:true,fileMustExist:true})
try{assert.equal(guarded.pragma('integrity_check',{simple:true}),'ok');assert.deepEqual(guarded.prepare('SELECT * FROM fixture_effect').all(),[{id:'qa-effect',value:0}])}finally{guarded.close()}
assert.equal(hash(await readFile(guardedFile)),guardBefore)
process.env.RPLAYOUT_VAULT_FILE=join(compiledDirectory,'vault.json');delete process.env.RPLAYOUT_VAULT_KEY;delete process.env.VITEST
const {readServerInstances}=await import('../apps/server/src/db/server-instances.js')
const file=join(compiledDirectory,'Ciclo-background-ação.db'),before=hash(await readFile(file)),db=new SQLite(file,{readonly:true,fileMustExist:true})
try{
  assert.equal(db.pragma('integrity_check',{simple:true}),'ok');assert.deepEqual(db.pragma('foreign_key_check'),[])
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM health_events WHERE channel_id='qa-loop' AND component='ENGINE' AND state IN ('running','error')").get().n,1)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM health_events WHERE channel_id='qa-loop' AND component='VIDEO'").get().n,1)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' AND name='qa_health_persist_failure'").get().n,0)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM as_run').get().n,0)
  const saved=JSON.parse(db.prepare("SELECT payload FROM channel_checkpoints WHERE channel_id='qa-loop'").get().payload)
  assert.equal(saved.realEngine,false);assert.equal(saved.playing,false)
  const instances=readServerInstances(db);assert.equal(instances.length,1);assert.equal(instances[0]!.id,report.signedStorageClosure.id);assert.equal(instances[0]!.pid,report.signedStorageClosure.backendPid);assert.equal(instances[0]!.phase,'STORAGE_CLOSED')
}finally{db.close()}
assert.equal(hash(await readFile(file)),before)
for(const pid of [...new Set<number>([...guard.ownServicePids,...report.ownStoragePids,report.signedStorageClosure.backendPid])]){
  assert.ok(Number.isSafeInteger(pid)&&pid>0&&pid<=0xffffffff);assert.notEqual(pid,process.pid)
  let absent=false;try{process.kill(pid,0)}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')absent=true;else throw error}
  assert.ok(absent,'Historical own PID exists/was reused; never terminate it')
}
const result={result:'PASS',sourceRunResult:report.result,correctedHarnessExpectation:markerOnlyHarnessFailure?'Passive observer final write was not persisted; signed storage close + actual process absence prove the declared closure, not an EXITED trace':null,scope:'Independent readonly existing guard evidence, compiled main logs, persisted health/idle-sim checkpoint and signed storage close; not HTTP/native PGM or in-flight shutdown qualification',compiledServerSha256:report.compiledServerSha256,guardSuspendedLostStorage:true,compiledMainContainedRepeatedHealthyStorageErrors:true,healthTransitionsPersistedAfterFaultRemoved:true,signedStorageClosed:true,ownBackendAndStorageStillAbsent:true,mainDatabaseBytesUnchanged:true,observerFinalMarkerObserved:report.storageObserver?.stage==='EXITED',httpClientValidated:false,webSocketValidated:false,nativeEngineAndPgmValidated:false,installedPackageValidated:false,inFlightDrainValidated:false,osHelperFamilyInventoryValidated:false}
await writeFile(join(compiledDirectory,'assertions-background-recovery.json'),JSON.stringify(result,null,2))
console.log(JSON.stringify({result:'PASS',sourceRunResult:report.result,compiledDirectory,observerFinalMarkerObserved:result.observerFinalMarkerObserved,signedStorageClosed:true}))
