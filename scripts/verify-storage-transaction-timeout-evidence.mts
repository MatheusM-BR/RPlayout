import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import {createHash} from 'node:crypto'
import {assertStorageQaProxyEvidence} from './lib/storage-qa-proxy.js'

// Read existing data and declared QA trace only; no second 30s wait, new SQL
// mutation, service restart, timeout shortening or operational rollback claim.
assert.equal(process.argv.length,3)
const root=fileURLToPath(new URL('..',import.meta.url)),directory=resolve(process.argv[2]!)
assert.ok(directory.startsWith(join(root,'scratch','storage-transaction-timeout-')))
const report=JSON.parse(await readFile(join(directory,'result.json'),'utf8')),fault=join(directory,'fault-workers')
assert.equal(report.result,'PASS');assert.equal(report.directory,directory);assert.equal(report.ownedServicesStopped,true);assert.deepEqual(report.cleanupErrors,[])
assert.ok(report.binaries.startsWith(join(root,'scratch','host-history-r88-')))
for(const key of ['httpValidated','installedBackendValidated','pgmAndAsRunValidated','physicalPowerLossValidated','operationalExactlyOnceValidated'])assert.equal(report[key],false)
assert.equal(report.timeout.productionDeadlineMs,30000);assert.ok(report.timeout.elapsedMs>=29500&&report.timeout.elapsedMs<45000)
assert.equal(report.timeout.connection.connected,false);assert.equal(report.timeout.connection.automaticReplay,false);assert.equal(report.timeout.connection.automaticReconnect,false)
assert.equal(report.timeout.commitAfterTimeoutRefused,true);assert.equal(report.timeout.repeatedWriteRefused,true);assert.equal(report.timeout.transactionOutcomeKnownToCaller,false)
assert.match(report.timeout.callerError,/não respondeu no prazo.*Resultado desconhecido/)
const marker=JSON.parse(await readFile(join(fault,'timeout-marker.json'),'utf8'))
assert.deepEqual(marker,report.marker);assert.equal(marker.stage,'CHILD_EXIT_AFTER_PARENT_DISCONNECT');assert.equal(marker.parentDisconnected,true);assert.equal(marker.killRequested,true)
assert.equal(marker.replyForwarded,false);assert.equal(marker.targetRequests,1);assert.equal(marker.commitRequests,0)
assert.equal(marker.actualAck.ok,true);assert.equal(marker.actualAck.inTransaction,true);assert.equal(marker.actualAck.value.changes,1)
assert.ok(marker.exit.signal||marker.exit.code!==0)
assert.equal(report.timeout.connection.storagePid,marker.actualServicePid)
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
for(const name of ['storage-bridge.cjs','storage-service.cjs'])assert.equal(hash(await readFile(join(report.binaries,name))),report.hashes[name])
assert.equal(hash(await readFile(join(fault,'storage-bridge.cjs'))),report.hashes['storage-bridge.cjs'])
if(report.qaProxy){assert.equal(report.qaProxy.proxyName,'storage-transaction-timeout-proxy.cjs');assert.equal(report.qaProxy.proxySha256,report.faultProxySha256);await assertStorageQaProxyEvidence(fault,report.binaries,report.qaProxy)}
else assert.equal(hash(await readFile(join(fault,'storage-service.cjs'))),report.faultProxySha256)
assert.equal(hash(await readFile(join(root,'scripts/fixtures/storage-transaction-timeout-proxy.cjs'))),report.faultProxySha256)
assert.equal(hash(await readFile(join(root,'apps/server/src/db/process-database.ts'))),report.adapterSha256)
assert.equal(report.ownedServicePids.length,3);assert.equal(new Set(report.ownedServicePids).size,3)
for(const pid of report.ownedServicePids){
  assert.ok(Number.isSafeInteger(pid)&&pid>0&&pid<=0xffffffff);assert.notEqual(pid,process.pid)
  let absent=false;try{process.kill(pid,0)}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')absent=true;else throw error}
  assert.ok(absent,'Historical own PID exists/was reused; never terminate it')
}
const file=join(directory,'Transação-pendente-ção.db'),before=hash(await readFile(file)),SQLite=createRequire(new URL('../apps/server/package.json',import.meta.url))('better-sqlite3')
const db=new SQLite(file,{readonly:true,fileMustExist:true})
try{assert.equal(db.pragma('integrity_check',{simple:true}),'ok');assert.deepEqual(db.pragma('foreign_key_check'),[]);assert.deepEqual(db.prepare('SELECT * FROM fixture_pending').all(),[{id:'qa-pending',value:0}])}finally{db.close()}
assert.equal(hash(await readFile(file)),before)
const result={result:'PASS',directory,scope:'Independent readonly persisted data/hash/QA trace consistency and current exit observations; not independent reconstruction of elapsed RPC time or signed operational evidence',sourceObservedTimeoutMs:report.timeout.elapsedMs,productionDeadlineMs:30000,uncommittedEffectNotPersisted:true,commitAndReplayAfterTimeoutRefused:true,callerStillReportedUnknown:true,ownServicesStillAbsent:true,mainDatabaseBytesUnchanged:true,pgmAndAsRunValidated:false,httpValidated:false,installedBackendValidated:false,physicalPowerLossValidated:false,operationalExactlyOnceValidated:false}
await writeFile(join(directory,'assertions-storage-transaction-timeout.json'),JSON.stringify(result,null,2))
console.log(JSON.stringify({result:'PASS',directory,uncommittedEffectNotPersisted:true,ownServicesStillAbsent:true}))
