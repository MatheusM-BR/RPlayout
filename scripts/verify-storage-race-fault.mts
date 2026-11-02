import assert from 'node:assert/strict'
import {spawn,type ChildProcess} from 'node:child_process'
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {createHash} from 'node:crypto'
import {openProcessDatabase,databaseStorageStatus} from '../apps/server/src/db/process-database.js'
import {stageStorageQaProxy} from './lib/storage-qa-proxy.js'

assert.equal(process.argv.length,3)
const root=fileURLToPath(new URL('..',import.meta.url)),binaries=resolve(process.argv[2]!)
assert.ok(binaries.startsWith(join(root,'scratch','host-history-r88-')))
const directory=await mkdtemp(join(root,'scratch','storage-race-fault-')),file=join(directory,'Concorrência-ação.db'),faultRoot=join(directory,'fault-workers')
await mkdir(faultRoot)
process.env.RPLAYOUT_STORAGE_BIN_DIR=binaries;process.env.NODE_PATH=join(root,'apps/server/node_modules')
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
const observer=openProcessDatabase(file),ownedPids=new Set<number>([databaseStorageStatus(observer).storagePid])
let uncertain:ReturnType<typeof openProcessDatabase>|null=null,result:Record<string,any>={result:'FAIL',directory,binaries,scope:'Real private SQLite IPC with independent fixture actors and explicit post-commit ACK fault proxy; not HTTP, installed backend, operational authorization, PGM or as-run'},failure:unknown=null
const actors:Array<{child:ChildProcess;ready:Promise<any>;call:(op:string)=>Promise<any>}> =[]
const alive=(pid:number)=>{assert.ok(Number.isSafeInteger(pid)&&pid>0);try{process.kill(pid,0);return true}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return false;throw error}}
async function waitExit(child:ChildProcess){if(child.exitCode!==null||child.signalCode!==null)return;await new Promise<void>((done,fail)=>{const timer=setTimeout(()=>fail(new Error('Own actor exit not confirmed')),15000);child.once('exit',()=>{clearTimeout(timer);done()})})}
function start(actor:string){
  const child=spawn(process.execPath,['--import',pathToFileURL(join(root,'apps/server/node_modules/tsx/dist/loader.mjs')).href,join(root,'scripts/fixtures/storage-race-actor.mts'),file,actor],{serialization:'advanced',windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:process.env})
  let logs='',sequence=0,resolveReady:(value:any)=>void,rejectReady:(error:unknown)=>void
  const pending=new Map<number,{done:(value:any)=>void;fail:(error:unknown)=>void;timer:ReturnType<typeof setTimeout>}>()
  const timer=setTimeout(()=>rejectReady(new Error('Own actor not ready '+logs)),45000)
  const ready=new Promise<any>((done,fail)=>{resolveReady=done;rejectReady=fail})
  for(const stream of [child.stdout,child.stderr])stream?.on('data',bytes=>logs=(logs+String(bytes)).slice(-12000))
  const failed=(error:unknown)=>{clearTimeout(timer);rejectReady(error);for(const item of pending.values()){clearTimeout(item.timer);item.fail(error)}pending.clear()}
  child.on('error',failed);child.on('exit',code=>failed(new Error('Own actor exit '+code+' '+logs)))
  child.on('message',(value:any)=>{
    if(value.ready){clearTimeout(timer);assert.equal(value.pid,child.pid);ownedPids.add(value.storage.storagePid);resolveReady(value);return}
    const item=pending.get(value.id);if(!item)return;clearTimeout(item.timer);pending.delete(value.id);value.ok?item.done(value.value):item.fail(new Error(value.error))
  })
  const call=(op:string)=>new Promise<any>((done,fail)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);fail(new Error('Own actor request deadline '+op+' '+logs))},45000);pending.set(id,{done,fail,timer});child.send({id,op},error=>{if(error)failed(error)})})
  const value={child,ready,call};actors.push(value);return value
}
try{
  observer.pragma('journal_mode = WAL')
  observer.exec("CREATE TABLE fixture_state(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,value INTEGER NOT NULL); INSERT INTO fixture_state VALUES('shared',0,0); CREATE TABLE fixture_audit(actor TEXT PRIMARY KEY,revision INTEGER NOT NULL); CREATE TABLE fixture_effect(id TEXT PRIMARY KEY,value INTEGER NOT NULL); INSERT INTO fixture_effect VALUES('qa-once',0)")
  const left=start('left'),right=start('right'),ready=await Promise.all([left.ready,right.ready])
  assert.notEqual(ready[0].pid,ready[1].pid);assert.notEqual(ready[0].storage.storagePid,ready[1].storage.storagePid)
  const read=await Promise.all([left.call('read'),right.call('read')]);assert.deepEqual(read.map(row=>row.expected),[0,0])
  const writes=await Promise.all([left.call('commit'),right.call('commit')])
  assert.deepEqual(writes.map(row=>row.changes).sort(),[0,1])
  assert.deepEqual(observer.prepare('SELECT * FROM fixture_state').all(),[{id:'shared',revision:1,value:1}])
  const audit=observer.prepare('SELECT * FROM fixture_audit').all() as {actor:string;revision:number}[]
  assert.deepEqual(audit,[{actor:writes.find(row=>row.changes===1).actor,revision:1}])
  result.concurrent={ready,read,writes,audit,exactlyOneRevisionCommit:true,atomicFixtureAudit:true,multiuserAuthorityValidated:false}
  for(const actor of actors){assert.equal((await actor.call('stop')).storageStopped,true);await waitExit(actor.child);assert.equal(actor.child.exitCode,0)}
  result.qaProxy=await stageStorageQaProxy(faultRoot,binaries,'storage-commit-fault-proxy.cjs')
  process.env.RPLAYOUT_STORAGE_BIN_DIR=faultRoot
  uncertain=openProcessDatabase(file);ownedPids.add(databaseStorageStatus(uncertain).storagePid)
  const connection=uncertain
  let callerError='';assert.throws(()=>connection.prepare('UPDATE fixture_effect SET value=value+1 WHERE id=?').run('qa-once'),error=>{callerError=String(error);return /desconectado|desconectada|Resultado.*desconhecido/.test(callerError)})
  assert.equal(databaseStorageStatus(connection).connected,false)
  assert.throws(()=>connection.prepare('UPDATE fixture_effect SET value=value+1 WHERE id=?').run('qa-once'),/indisponível/)
  assert.deepEqual(observer.prepare('SELECT * FROM fixture_effect').all(),[{id:'qa-once',value:1}])
  const marker=JSON.parse(await readFile(join(faultRoot,'fault-marker.json'),'utf8'))
  ownedPids.add(marker.proxyPid);ownedPids.add(marker.actualServicePid)
  assert.equal(marker.stage,'CHILD_EXIT_AFTER_WITHHELD_ACK');assert.equal(marker.targetRequests,1);assert.equal(marker.replyForwarded,false);assert.equal(marker.killRequested,true)
  assert.equal(marker.actualAck.ok,true);assert.equal(marker.actualAck.inTransaction,false);assert.equal(marker.actualAck.value.changes,1)
  result.postCommitDisconnect={marker,callerError,connection:databaseStorageStatus(connection),persistedEffect:1,repeatedWriteRefused:true,unknownResultNotReportedAsRollback:true,operationalExactlyOnceValidated:false}
  result.hashes=Object.fromEntries(await Promise.all(['storage-bridge.cjs','storage-service.cjs'].map(async name=>[name,hash(await readFile(join(binaries,name)))])))
  result.faultProxySha256=result.qaProxy.proxySha256
  result.result='PASS'
}catch(error){failure=error;result.error=String(error);throw error}
finally{
  const cleanupErrors:string[]=[]
  for(const actor of actors)if(actor.child.exitCode===null&&actor.child.signalCode===null){try{actor.child.kill('SIGKILL');await waitExit(actor.child)}catch(error){cleanupErrors.push(String(error))}}
  try{uncertain?.close()}catch(error){cleanupErrors.push(String(error))}
  try{observer.close()}catch(error){cleanupErrors.push(String(error))}
  try{const marker=JSON.parse(await readFile(join(faultRoot,'fault-marker.json'),'utf8'));for(const pid of [marker.proxyPid,marker.actualServicePid])if(Number.isSafeInteger(pid)&&pid>0)ownedPids.add(pid)}catch{}
  const deadline=performance.now()+15000;while([...ownedPids].some(alive)&&performance.now()<deadline)await new Promise(done=>setTimeout(done,50))
  result.ownActorHandlesExited=actors.every(actor=>actor.child.exitCode!==null||actor.child.signalCode!==null)
  result.ownedServicePids=[...ownedPids];result.ownedServicesStopped=[...ownedPids].every(pid=>!alive(pid));result.cleanupErrors=cleanupErrors
  if(!result.ownedServicesStopped||!result.ownActorHandlesExited||cleanupErrors.length){result.result='FAIL';result.teardownError='Own fixture exit not confirmed; never terminate a historical PID'}
  result.httpValidated=false;result.installedBackendValidated=false;result.pgmAndAsRunValidated=false;result.productionLoadValidated=false
  await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result))
  if(result.result!=='PASS'&&!failure)throw new Error(result.teardownError)
}
