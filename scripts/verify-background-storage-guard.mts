import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {openProcessDatabase,databaseStorageStatus} from '../apps/server/src/db/process-database.js'
import {BackgroundTaskGuard} from '../apps/server/src/domain/background-task-guard.js'

assert.equal(process.argv.length,3)
const root=fileURLToPath(new URL('..',import.meta.url)),binaries=resolve(process.argv[2]!)
assert.ok(binaries.startsWith(join(root,'scratch','host-history-r88-')))
const directory=await mkdtemp(join(root,'scratch','background-storage-guard-')),file=join(directory,'Banco-background-ação.db')
Object.assign(process.env,{RPLAYOUT_STORAGE_BIN_DIR:binaries,NODE_PATH:join(root,'apps/server/node_modules')})
const observer=openProcessDatabase(file),connection=openProcessDatabase(file),pids=[databaseStorageStatus(observer).storagePid,databaseStorageStatus(connection).storagePid]
let closeNotifications=0,afterErrorEffects=0,result:Record<string,any>={result:'FAIL',directory,binaries,scope:'Production task guard and PROCESS IPC over own database, with fixture notification/effect counters; not complete index timers, real sockets, engine/PGM or installed backend'},failure:unknown=null
const errors:Array<{task:string;name:string}>=[],unhandled:string[]=[]
const onUnhandled=(reason:unknown)=>{unhandled.push(String(reason))}
process.on('unhandledRejection',onUnhandled)
const guard=new BackgroundTaskGuard(()=>databaseStorageStatus(connection).connected,()=>{closeNotifications++},(task,error)=>{errors.push({task,name:error instanceof Error?error.name:'unknown'})})
const alive=(pid:number)=>{try{process.kill(pid,0);return true}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return false;throw error}}
try{
  observer.pragma('journal_mode = WAL');observer.exec("CREATE TABLE fixture_effect(id TEXT PRIMARY KEY,value INTEGER NOT NULL); INSERT INTO fixture_effect VALUES('qa-effect',0)")
  await guard.run('failing-storage-task',()=>{connection.prepare('SELECT zeroblob(18000000) AS oversized').get();afterErrorEffects++})
  assert.equal(databaseStorageStatus(connection).connected,false);assert.equal(guard.status().suspended,true)
  for(let index=0;index<5;index++)await guard.run('later-scheduled-task',()=>{afterErrorEffects++;connection.prepare('UPDATE fixture_effect SET value=value+1').run()})
  await new Promise(done=>setImmediate(done))
  assert.equal(afterErrorEffects,0);assert.equal(closeNotifications,1);assert.deepEqual(errors,[{task:'failing-storage-task',name:'StorageResultTooLarge'}]);assert.deepEqual(unhandled,[])
  assert.deepEqual(observer.prepare('SELECT * FROM fixture_effect').all(),[{id:'qa-effect',value:0}])
  result.result='PASS';result.guard=guard.status();result.afterErrorEffects=afterErrorEffects;result.closeNotifications=closeNotifications;result.errors=errors;result.unhandledRejections=unhandled.slice();result.connection=databaseStorageStatus(connection)
  result.hashes=Object.fromEntries(await Promise.all(['storage-bridge.cjs','storage-service.cjs'].map(async name=>[name,createHash('sha256').update(await readFile(join(binaries,name))).digest('hex')])))
  result.guardSourceSha256=createHash('sha256').update(await readFile(join(root,'apps/server/src/domain/background-task-guard.ts'))).digest('hex')
}catch(error){failure=error;result.error=String(error);throw error}
finally{
  guard.close();connection.close();observer.close()
  const deadline=performance.now()+15000;while(pids.some(alive)&&performance.now()<deadline)await new Promise(done=>setTimeout(done,50))
  result.ownServicePids=pids;result.ownServicesStopped=pids.every(pid=>!alive(pid))
  if(!result.ownServicesStopped){result.result='FAIL';result.teardownError='Own storage exit not confirmed; no historical PID will be killed'}
  process.removeListener('unhandledRejection',onUnhandled)
  result.controlNotificationIsFixture=true;result.httpAndWebSocketValidated=false;result.pgmAndEngineValidated=false;result.installedBackendValidated=false
  await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result))
  if(result.result!=='PASS'&&!failure)throw new Error(result.teardownError)
}
