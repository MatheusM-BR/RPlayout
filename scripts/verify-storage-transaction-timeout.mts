import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {openProcessDatabase,databaseStorageStatus} from '../apps/server/src/db/process-database.js'
import {stageStorageQaProxy} from './lib/storage-qa-proxy.js'

assert.equal(process.argv.length,3)
const root=fileURLToPath(new URL('..',import.meta.url)),binaries=resolve(process.argv[2]!)
assert.ok(binaries.startsWith(join(root,'scratch','host-history-r88-')))
const directory=await mkdtemp(join(root,'scratch','storage-transaction-timeout-')),file=join(directory,'Transação-pendente-ção.db'),faultRoot=join(directory,'fault-workers')
await mkdir(faultRoot)
process.env.RPLAYOUT_STORAGE_BIN_DIR=binaries;process.env.NODE_PATH=join(root,'apps/server/node_modules')
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
const observer=openProcessDatabase(file),owned=new Set<number>([databaseStorageStatus(observer).storagePid])
let connection:ReturnType<typeof openProcessDatabase>|null=null,failure:unknown=null,result:Record<string,any>={result:'FAIL',directory,binaries,scope:'Real private IPC production 30-second deadline with declared uncommitted ACK-hold proxy; not HTTP, installed backend, PGM/as-run or power loss'}
const alive=(pid:number)=>{assert.ok(Number.isSafeInteger(pid)&&pid>0&&pid<=0xffffffff);try{process.kill(pid,0);return true}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return false;throw error}}
try{
  observer.pragma('journal_mode = WAL');observer.exec("CREATE TABLE fixture_pending(id TEXT PRIMARY KEY,value INTEGER NOT NULL); INSERT INTO fixture_pending VALUES('qa-pending',0)")
  result.qaProxy=await stageStorageQaProxy(faultRoot,binaries,'storage-transaction-timeout-proxy.cjs')
  process.env.RPLAYOUT_STORAGE_BIN_DIR=faultRoot
  connection=openProcessDatabase(file);owned.add(databaseStorageStatus(connection).storagePid)
  const active=connection
  active.exec('BEGIN IMMEDIATE');assert.equal(active.inTransaction,true)
  let callerError='';const started=performance.now()
  assert.throws(()=>active.prepare('UPDATE fixture_pending SET value=value+1 WHERE id=?').run('qa-pending'),error=>{callerError=String(error);return /não respondeu no prazo.*Resultado desconhecido/.test(callerError)})
  const elapsedMs=performance.now()-started
  assert.ok(elapsedMs>=29500&&elapsedMs<45000,'Real unchanged 30s deadline required, not a shortened fixture timeout')
  assert.equal(databaseStorageStatus(active).connected,false)
  assert.throws(()=>active.exec('COMMIT'),/indisponível/)
  assert.throws(()=>active.prepare('UPDATE fixture_pending SET value=value+1 WHERE id=?').run('qa-pending'),/indisponível/)
  assert.deepEqual(observer.prepare('SELECT * FROM fixture_pending').all(),[{id:'qa-pending',value:0}])
  result.timeout={elapsedMs,productionDeadlineMs:30000,callerError,connection:databaseStorageStatus(active),commitAfterTimeoutRefused:true,repeatedWriteRefused:true,uncommittedEffectVisibleToObserver:0,transactionOutcomeKnownToCaller:false}
  result.hashes=Object.fromEntries(await Promise.all(['storage-bridge.cjs','storage-service.cjs'].map(async name=>[name,hash(await readFile(join(binaries,name)))])))
  result.adapterSha256=hash(await readFile(join(root,'apps/server/src/db/process-database.ts')))
  result.faultProxySha256=result.qaProxy.proxySha256
  result.result='PASS'
}catch(error){failure=error;result.error=String(error);throw error}
finally{
  const cleanupErrors:string[]=[]
  try{connection?.close()}catch(error){cleanupErrors.push(String(error))}
  // Observe the declared proxy's final marker. No retries of any SQL command.
  let marker:any=null;const markerDeadline=performance.now()+15000
  while(performance.now()<markerDeadline){
    try{marker=JSON.parse(await readFile(join(faultRoot,'timeout-marker.json'),'utf8'));for(const pid of [marker.proxyPid,marker.actualServicePid])if(Number.isSafeInteger(pid)&&pid>0)owned.add(pid);if(marker.stage==='CHILD_EXIT_AFTER_PARENT_DISCONNECT')break}catch(error){if(!['ENOENT'].includes((error as NodeJS.ErrnoException).code??'')&&!(error instanceof SyntaxError)){cleanupErrors.push(String(error));break}}
    await new Promise(done=>setTimeout(done,50))
  }
  result.marker=marker
  try{
    if(result.result==='PASS'){
      assert.equal(marker.stage,'CHILD_EXIT_AFTER_PARENT_DISCONNECT');assert.equal(marker.parentDisconnected,true);assert.equal(marker.killRequested,true)
      assert.equal(marker.targetRequests,1);assert.equal(marker.replyForwarded,false);assert.equal(marker.commitRequests,0)
      assert.equal(marker.actualAck.ok,true);assert.equal(marker.actualAck.inTransaction,true);assert.equal(marker.actualAck.value.changes,1)
      assert.deepEqual(observer.prepare('SELECT * FROM fixture_pending').all(),[{id:'qa-pending',value:0}])
      result.uncommittedEffectAfterServiceExit=0
    }
  }catch(error){result.result='FAIL';result.markerError=String(error)}
  try{observer.close()}catch(error){cleanupErrors.push(String(error))}
  const deadline=performance.now()+15000;while([...owned].some(alive)&&performance.now()<deadline)await new Promise(done=>setTimeout(done,50))
  result.ownedServicePids=[...owned];result.ownedServicesStopped=[...owned].every(pid=>!alive(pid));result.cleanupErrors=cleanupErrors
  if(!result.ownedServicesStopped||cleanupErrors.length){result.result='FAIL';result.teardownError='Own service exit not confirmed; no historical PID will be stopped'}
  result.httpValidated=false;result.installedBackendValidated=false;result.pgmAndAsRunValidated=false;result.physicalPowerLossValidated=false;result.operationalExactlyOnceValidated=false
  await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result))
  if(result.result!=='PASS'&&!failure)throw new Error(String(result.teardownError??result.markerError))
}
