import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import {createHash} from 'node:crypto'
import {assertStorageQaProxyEvidence} from './lib/storage-qa-proxy.js'

// Existing fixture data and trace consistency only. No new race, disconnect,
// operational recovery or replay; QA marker is not a signed production diary.
assert.equal(process.argv.length,3)
const root=fileURLToPath(new URL('..',import.meta.url)),directory=resolve(process.argv[2]!)
assert.ok(directory.startsWith(join(root,'scratch','storage-race-fault-')))
const report=JSON.parse(await readFile(join(directory,'result.json'),'utf8'))
assert.equal(report.result,'PASS');assert.equal(report.directory,directory);assert.equal(report.ownActorHandlesExited,true);assert.equal(report.ownedServicesStopped,true);assert.deepEqual(report.cleanupErrors,[])
for(const key of ['httpValidated','installedBackendValidated','pgmAndAsRunValidated','productionLoadValidated'])assert.equal(report[key],false)
assert.ok(report.binaries.startsWith(join(root,'scratch','host-history-r88-')))
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex'),fault=join(directory,'fault-workers')
for(const name of ['storage-bridge.cjs','storage-service.cjs'])assert.equal(hash(await readFile(join(report.binaries,name))),report.hashes[name])
assert.equal(hash(await readFile(join(fault,'storage-bridge.cjs'))),report.hashes['storage-bridge.cjs'])
if(report.qaProxy){assert.equal(report.qaProxy.proxyName,'storage-commit-fault-proxy.cjs');assert.equal(report.qaProxy.proxySha256,report.faultProxySha256);await assertStorageQaProxyEvidence(fault,report.binaries,report.qaProxy)}
else assert.equal(hash(await readFile(join(fault,'storage-service.cjs'))),report.faultProxySha256)
assert.equal(hash(await readFile(join(root,'scripts/fixtures/storage-commit-fault-proxy.cjs'))),report.faultProxySha256)
assert.notEqual(report.faultProxySha256,report.hashes['storage-service.cjs'],'Fault proxy must not be presented as an installed production service')
const race=report.concurrent
assert.equal(race.ready.length,2);assert.equal(new Set(race.ready.map((row:any)=>row.pid)).size,2)
assert.equal(new Set(race.ready.map((row:any)=>row.storage.storagePid)).size,2)
assert.deepEqual(race.read.map((row:any)=>row.expected),[0,0]);assert.deepEqual(race.writes.map((row:any)=>row.changes).sort(),[0,1])
assert.equal(race.multiuserAuthorityValidated,false)
const winner=race.writes.find((row:any)=>row.changes===1).actor
const marker=JSON.parse(await readFile(join(fault,'fault-marker.json'),'utf8'))
assert.deepEqual(marker,report.postCommitDisconnect.marker)
assert.equal(marker.stage,'CHILD_EXIT_AFTER_WITHHELD_ACK');assert.equal(marker.replyForwarded,false);assert.equal(marker.targetRequests,1);assert.equal(marker.killRequested,true)
assert.equal(marker.actualAck.ok,true);assert.equal(marker.actualAck.inTransaction,false);assert.equal(marker.actualAck.value.changes,1)
assert.ok(marker.exit.signal||marker.exit.code!==0)
assert.equal(report.postCommitDisconnect.connection.connected,false);assert.equal(report.postCommitDisconnect.connection.storagePid,marker.actualServicePid)
assert.equal(report.postCommitDisconnect.connection.automaticReplay,false);assert.equal(report.postCommitDisconnect.connection.automaticReconnect,false)
assert.equal(report.postCommitDisconnect.repeatedWriteRefused,true);assert.equal(report.postCommitDisconnect.operationalExactlyOnceValidated,false)
assert.match(report.postCommitDisconnect.callerError,/StorageDisconnected/)
const pids=[...new Set<number>([...report.ownedServicePids,...race.ready.map((row:any)=>row.pid)])]
for(const pid of pids){
  assert.ok(Number.isSafeInteger(pid)&&pid>0&&pid<=0xffffffff);assert.notEqual(pid,process.pid)
  let absent=false;try{process.kill(pid,0)}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')absent=true;else throw error}
  assert.ok(absent,'Historical own PID exists/was reused; never terminate it')
}
const file=join(directory,'Concorrência-ação.db'),before=hash(await readFile(file)),SQLite=createRequire(new URL('../apps/server/package.json',import.meta.url))('better-sqlite3')
const db=new SQLite(file,{readonly:true,fileMustExist:true})
try{
  assert.equal(db.pragma('integrity_check',{simple:true}),'ok');assert.deepEqual(db.pragma('foreign_key_check'),[])
  assert.deepEqual(db.prepare('SELECT * FROM fixture_state').all(),[{id:'shared',revision:1,value:1}])
  assert.deepEqual(db.prepare('SELECT * FROM fixture_audit').all(),[{actor:winner,revision:1}])
  assert.deepEqual(db.prepare('SELECT * FROM fixture_effect').all(),[{id:'qa-once',value:1}])
}finally{db.close()}
assert.equal(hash(await readFile(file)),before)
const result={result:'PASS',directory,scope:'Independent readonly fixture persistence, hashes, trace consistency and absence observations; not independent reconstruction of IPC ordering or signed operational evidence',oneRevisionAndFixtureAudit:true,committedEffectSurvivedUnknownReply:true,noDuplicateEffectPersisted:true,ownActorsAndServicesStillAbsent:true,unmodifiedCompiledBridgeAndRealServiceBound:true,declaredFaultProxyBound:true,mainDatabaseBytesUnchanged:true,multiuserAuthorityValidated:false,httpValidated:false,installedBackendValidated:false,pgmAndAsRunValidated:false,productionExactlyOnceValidated:false}
await writeFile(join(directory,'assertions-storage-race-fault.json'),JSON.stringify(result,null,2))
console.log(JSON.stringify({result:'PASS',directory,committedEffectSurvivedUnknownReply:true,ownActorsAndServicesStillAbsent:true}))
