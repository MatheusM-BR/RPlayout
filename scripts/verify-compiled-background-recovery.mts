import assert from 'node:assert/strict'
import {spawn,type ChildProcess} from 'node:child_process'
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises'
import {createServer} from 'node:net'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {stageStorageQaProxy} from './lib/storage-qa-proxy.js'

// Actual compiled main/timers + PROCESS. Only diagnostic SIMULATED transport;
// no client connection, native signal, hardware, browser or PGM qualification.
assert.equal(process.argv.length,3)
const root=fileURLToPath(new URL('..',import.meta.url)),binaries=resolve(process.argv[2]!)
assert.ok(binaries.startsWith(join(root,'scratch','host-history-r88-background-')))
const directory=await mkdtemp(join(root,'scratch','compiled-background-recovery-')),media=join(directory,'media'),file=join(directory,'Ciclo-background-ação.db'),observed=join(directory,'observed-storage')
await mkdir(media);await mkdir(observed)
for(const key of Object.keys(process.env))if(/^RPLAYOUT_|^VITEST$/i.test(key))delete process.env[key]
Object.assign(process.env,{NODE_PATH:join(root,'apps/server/node_modules'),RPLAYOUT_STORAGE_MODE:'PROCESS',RPLAYOUT_STORAGE_BIN_DIR:binaries,RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_VAULT_FILE:join(directory,'vault.json'),RPLAYOUT_MEDIA:media,RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_CACHE:join(directory,'cache'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_BACKUPS:join(directory,'backups'),RPLAYOUT_ENGINE:'',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_RELAY:'',RPLAYOUT_DEVICES:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_GRAPHIC_PROBE:'',RPLAYOUT_BACKUP_HOURS:'0'})
const {openDatabase}=await import('../apps/server/src/db/client.js'),{databaseStorageStatus}=await import('../apps/server/src/db/process-database.js'),{readServerInstances}=await import('../apps/server/src/db/server-instances.js')
const database=openDatabase(file),owned=new Set<number>([databaseStorageStatus(database.sqlite).storagePid]),stamp=new Date().toISOString()
database.sqlite.prepare("INSERT INTO channels(id,name,width,height,rate_num,rate_den,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES('qa-loop','QA SIM only',320,180,25,1,-23,-1,5,?)").run(stamp)
database.sqlite.prepare("INSERT INTO rundowns(id,channel_id,name,date,planned_start,created_at,updated_at) VALUES('qa-empty','qa-loop','QA empty diagnostic grade',?,0,?,?)").run(stamp.slice(0,10),stamp,stamp)
database.sqlite.exec("CREATE TRIGGER qa_health_persist_failure BEFORE INSERT ON health_events WHEN NEW.component='ENGINE' BEGIN SELECT RAISE(ABORT,'QA_HEALTH_PERSIST_FAULT'); END")
const qaProxy=await stageStorageQaProxy(observed,binaries,'storage-observer-proxy.cjs')
const allocator=createServer();await new Promise<void>(done=>allocator.listen(0,'127.0.0.1',done));const port=(allocator.address() as {port:number}).port;await new Promise<void>(done=>allocator.close(()=>done()))
let child:ChildProcess|null=null,logs='',failure:unknown=null,result:Record<string,any>={result:'FAIL',directory,binaries,qaProxy,scope:'Actual compiled main periodic cycle and graceful storage closure with declared healthy IPC observer proxy and SIMULATED idle transport; no client connection/native engine/PGM'}
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
async function wait(label:string,check:()=>boolean|Promise<boolean>,timeout=30000){const deadline=performance.now()+timeout;while(performance.now()<deadline){if(await check())return;assert.equal(child?.exitCode,null,logs);await new Promise(done=>setTimeout(done,50))}throw new Error(label+' '+logs)}
const engineEvents=()=>database.sqlite.prepare("SELECT COUNT(*) AS n FROM health_events WHERE channel_id='qa-loop' AND component='ENGINE' AND state IN ('running','error')").get() as {n:number}
const videoEvents=()=>database.sqlite.prepare("SELECT COUNT(*) AS n FROM health_events WHERE channel_id='qa-loop' AND component='VIDEO'").get() as {n:number}
const alive=(pid:number)=>{assert.ok(Number.isSafeInteger(pid)&&pid>0&&pid<=0xffffffff);try{process.kill(pid,0);return true}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return false;throw error}}
try{
  child=spawn(process.execPath,['-e',"process.on('message',m=>{if(m==='own-shutdown')process.emit('SIGTERM')});require(process.argv[1])",join(binaries,'server.cjs')],{windowsHide:true,cwd:directory,stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,RPLAYOUT_STORAGE_BIN_DIR:observed,RPLAYOUT_DB:file,RPLAYOUT_STARTUP_TRACE:'1',HOST:'127.0.0.1',PORT:String(port),LOG_LEVEL:'warn'}})
  for(const stream of [child.stdout,child.stderr])stream?.on('data',bytes=>logs=(logs+String(bytes)).slice(-128000))
  await wait('Compiled main readiness marker',()=>logs.includes('[rplayout startup] HTTP listening'))
  await wait('Repeated real live-cycle persistence refusal contained',()=>logs.split(/\r?\n/).filter(line=>line.includes('"task":"live-cycle"')&&line.includes('Falha em tarefa de segundo plano')).length>=3)
  assert.equal(engineEvents().n,0);assert.equal(child.exitCode,null)
  result.rejectedCycles=logs.split(/\r?\n/).filter(line=>line.includes('"task":"live-cycle"')&&line.includes('Falha em tarefa de segundo plano')).length
  database.sqlite.exec('DROP TRIGGER qa_health_persist_failure')
  await wait('Health transition persists after dropping ONLY own QA fault',()=>engineEvents().n===1&&videoEvents().n===1)
  const beforeRows=database.sqlite.prepare("SELECT id FROM health_events WHERE channel_id='qa-loop' AND component IN ('ENGINE','VIDEO') ORDER BY id").all()
  const errorsBefore=logs.split(/\r?\n/).filter(line=>line.includes('"task":"live-cycle"')).length
  await new Promise(done=>setTimeout(done,300))
  assert.equal(child.exitCode,null);assert.equal(engineEvents().n,1);assert.equal(videoEvents().n,1)
  assert.deepEqual(database.sqlite.prepare("SELECT id FROM health_events WHERE channel_id='qa-loop' AND component IN ('ENGINE','VIDEO') ORDER BY id").all(),beforeRows)
  assert.equal(logs.split(/\r?\n/).filter(line=>line.includes('"task":"live-cycle"')).length,errorsBefore)
  result.healthTransitionAfterFault={engineEvents:engineEvents().n,videoEvents:videoEvents().n,notPrematurelyMarkedRecorded:true,stableObservedForMs:300}
  child.send('own-shutdown')
  await wait('Own compiled normal shutdown',()=>child!.exitCode!==null||child!.signalCode!==null)
  assert.equal(child.exitCode,0,logs)
  const instances=readServerInstances(database.sqlite);assert.equal(instances.length,1);assert.equal(instances[0]!.pid,child.pid);assert.equal(instances[0]!.phase,'STORAGE_CLOSED')
  assert.equal((database.sqlite.prepare('SELECT COUNT(*) AS n FROM as_run').get() as {n:number}).n,0)
  result.signedStorageClosure={id:instances[0]!.id,phase:instances[0]!.phase,backendPid:child.pid}
  result.compiledServerSha256=hash(await readFile(join(binaries,'server.cjs')))
  result.result='PASS'
}catch(error){failure=error;result.error=String(error);throw error}
finally{
  if(child&&child.exitCode===null&&child.signalCode===null){const stopped=new Promise<void>(done=>child!.once('exit',()=>done()));child.kill('SIGKILL');await Promise.race([stopped,new Promise(done=>setTimeout(done,15000))])}
  let marker:any=null;const markerDeadline=performance.now()+15000
  while(performance.now()<markerDeadline){try{marker=JSON.parse(await readFile(join(observed,'observer-marker.json'),'utf8'));const known=[marker.proxyPid,marker.actualServicePid].filter(pid=>Number.isSafeInteger(pid)&&pid>0);for(const pid of known)owned.add(pid);if(marker.stage==='EXITED'||known.length===2&&known.every(pid=>!alive(pid)))break}catch{}await new Promise(done=>setTimeout(done,50))}
  result.storageObserver=marker
  result.storageObserverFinalMarkerObserved=marker?.stage==='EXITED'
  database.sqlite.close()
  const deadline=performance.now()+15000;while([...owned].some(alive)&&performance.now()<deadline)await new Promise(done=>setTimeout(done,50))
  result.ownBackendExited=Boolean(child&&(child.exitCode!==null||child.signalCode!==null));result.ownStoragePids=[...owned];result.ownStorageServicesStopped=[...owned].every(pid=>!alive(pid))
  if(!result.ownBackendExited||!result.ownStorageServicesStopped||!marker||!owned.has(marker.proxyPid)||!owned.has(marker.actualServicePid)){result.result='FAIL';result.teardownError='Own process closure not confirmed; no historical PID will be stopped'}
  result.httpClientValidated=false;result.webSocketValidated=false;result.nativeEngineAndPgmValidated=false;result.installedPackageValidated=false;result.osHelperFamilyInventoryValidated=false
  await writeFile(join(directory,'server.log'),logs);await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result))
  if(result.result!=='PASS'&&!failure)throw new Error(result.teardownError)
}
