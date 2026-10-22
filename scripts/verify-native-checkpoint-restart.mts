import assert from 'node:assert/strict'
import {spawn,execFile,type ChildProcess} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises'
import {createServer} from 'node:net'
import {join,resolve} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
import {assertMovingPublishedGray} from './lib/held-picture-evidence.js'
import {stereoToneStatistics,syntheticToneSpectrum,syntheticToneWindows} from './lib/verify-published-audio.js'

// New, owned QA database throughout both phases. Phase one is the existing
// real timeout scenario; phase two starts the compiled NORMAL main against
// that SAME database, not a restored copy and not a mocked recovery call.
// No HTTP client, hardware/network signal, promoted lease or policy override.
assert.equal(process.argv.length,3)
const root=fileURLToPath(new URL('..',import.meta.url)),binaries=resolve(process.argv[2]!)
assert.ok(binaries.startsWith(join(root,'scratch','host-history-r88-')))
const directory=await mkdtemp(join(root,'scratch','native-checkpoint-restart-'))
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex'),run=promisify(execFile)
const result:Record<string,any>={result:'FAIL',directory,binaries,scope:'Fresh source normal PGM/real PROCESS timeout followed by compiled normal main on the same QA database. Not installed, HTTP, restored/HA, physical, exact image seeking/PTS or complete outage-duration accounting qualification'}
let child:ChildProcess|null=null,logs='',failure:unknown=null
const alive=(pid:number)=>{try{process.kill(pid,0);return true}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return false;throw error}}
async function wait(label:string,check:()=>boolean|Promise<boolean>,timeout=30000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;if(child)assert.equal(child.exitCode,null,logs);await new Promise(done=>setTimeout(done,50))}throw new Error(label)}
console.log(JSON.stringify({directory,scenario:'native-last-checkpoint-normal-restart',networkOutput:false,httpClient:false}))
try{
 const phase=await run(process.execPath,['--import',pathToFileURL(join(root,'apps/server/node_modules/tsx/dist/loader.mjs')).href,join(root,'scripts/verify-normal-pgm-storage-timeout.mts'),binaries],{cwd:root,env:process.env,windowsHide:true,timeout:150000,maxBuffer:2*1024*1024})
 await writeFile(join(directory,'phase-one.stdout.txt'),phase.stdout,{flag:'wx'});await writeFile(join(directory,'phase-one.stderr.txt'),phase.stderr,{flag:'wx'})
 const announcement=phase.stdout.split(/\r?\n/).flatMap(line=>{try{return[JSON.parse(line)]}catch{return[]}}).find(value=>value.scenario==='normal-local-file-pgm-during-real-storage-timeout')
 assert.ok(announcement);const firstDirectory=resolve(announcement.directory)
 assert.ok(firstDirectory.startsWith(join(root,'scratch','normal-pgm-storage-timeout-')))
 const firstBytes=await readFile(join(firstDirectory,'result.json')),first=JSON.parse(firstBytes.toString())
 assert.equal(first.result,'PASS');assert.equal(first.directory,firstDirectory)
 assert.deepEqual(first.normalCloseProof,{ownedNativeProcessesStopped:true,graceful:true,forceRequested:false})
 assert.deepEqual(first.nativeExit,{code:0,signal:null});assert.equal(first.appCloseResolved,false)
 for(const pid of[first.beforeFault.storage.backendPid,first.enginePid,first.marker.proxyPid,first.marker.actualServicePid])assert.equal(alive(pid),false,'Original processes must actually be gone before restart')
 result.phaseOne={directory:firstDirectory,reportSha256:hash(firstBytes),observedLaterFrames:first.afterFault.state.onAir.elapsed,blockedMs:first.timeout.blockedMs}
 for(const key of Object.keys(process.env))if(/^(RPLAYOUT_|GST_|GSTREAMER_|MTX_|RTSP_|VITEST$)/i.test(key))delete process.env[key]
 const file=join(firstDirectory,'Banco-PGM-ação.db'),gst='C:/Program Files/gstreamer/1.0/msvc_x86_64',output=join(directory,'recovered-native.mkv')
 const engine=resolve('D:/RPlayout-builds/native-r83-20261016/release/rplayout-engine.exe')
 assert.equal(hash(await readFile(engine)),first.engineSha256)
 assert.equal(hash(await readFile(join(root,'apps/server/src/app.ts'))),first.controlSourceHashes.app)
 assert.equal(hash(await readFile(join(root,'apps/server/src/domain/engine.ts'))),first.controlSourceHashes.engine)
 Object.assign(process.env,{NODE_PATH:join(root,'apps/server/node_modules'),RPLAYOUT_STORAGE_MODE:'PROCESS',RPLAYOUT_STORAGE_BIN_DIR:binaries,RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_VAULT_FILE:join(firstDirectory,'vault.json'),RPLAYOUT_MEDIA:join(firstDirectory,'media'),RPLAYOUT_THUMBS:join(firstDirectory,'thumbs'),RPLAYOUT_CACHE:join(firstDirectory,'cache'),RPLAYOUT_MEDIA_VERSIONS:join(firstDirectory,'versions'),RPLAYOUT_BACKUPS:join(firstDirectory,'backups'),RPLAYOUT_ENGINE:engine,RPLAYOUT_ENGINE_OUTPUT:'file:'+output,RPLAYOUT_ENCODER:'x264enc',RPLAYOUT_HOST_GUARD:join(root,'apps/engine/target/release/rplayout-host-guard.exe'),RPLAYOUT_MEDIAMTX:'',RPLAYOUT_RELAY:'',RPLAYOUT_DEVICES:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_AUDIO_BUS_PROBE:'',RPLAYOUT_GRAPHIC_PROBE:'',RPLAYOUT_BACKUP_HOURS:'0',RPLAYOUT_LAUNCHER_DISCOVERY:'0',RPLAYOUT_DEFAULT_ROLE:'VIEWER',GSTREAMER_1_0_ROOT_MSVC_X86_64:gst,PATH:join(gst,'bin')+';'+process.env.PATH,GST_REGISTRY:join(directory,'registry.bin'),GST_PLUGIN_PATH:join(gst,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gst,'lib/gstreamer-1.0'),GST_PLUGIN_SCANNER:join(gst,'libexec/gstreamer-1.0/gst-plugin-scanner.exe'),TEMP:directory,TMP:directory})
 const SQLite=createRequire(new URL('../apps/server/package.json',import.meta.url))('better-sqlite3') as typeof import('../apps/server/node_modules/@types/better-sqlite3/index.js')
 const {readServerInstances}=await import('../apps/server/src/db/server-instances.js'),{readExecutionOwner}=await import('../apps/server/src/db/execution-ownership.js')
 const {installationVault}=await import('../apps/server/src/domain/secret-vault.js')
 const read=<T,>(work:(db:InstanceType<typeof SQLite>)=>T)=>{const db=new SQLite(file,{readonly:true,fileMustExist:true});try{return work(db)}finally{db.close()}}
 const decodeDecision=(row:{payload:string;[key:string]:unknown})=>({...row,payload:JSON.parse(installationVault(false).decrypt(row.payload,'operator_decisions.payload'))})
 const before=read(db=>{assert.equal(db.pragma('integrity_check',{simple:true}),'ok');assert.deepEqual(db.pragma('foreign_key_check'),[]);return{checkpoint:JSON.parse((db.prepare('SELECT payload FROM channel_checkpoints WHERE channel_id=?').get('qa-normal') as {payload:string}).payload),owner:readExecutionOwner(db,'qa-normal'),instances:readServerInstances(db),asrun:db.prepare('SELECT id,ended_at FROM as_run').all()}})
 assert.equal(before.checkpoint.elapsed,first.beforeFault.state.onAir.elapsed);assert.ok(before.checkpoint.elapsed<first.afterFault.state.onAir.elapsed)
 assert.equal(before.owner!.phase,'ACTIVE');assert.equal(before.instances.length,1);assert.equal(before.instances[0]!.phase,'OPEN')
 // Freeze SQL evidence via the SQLite backup API before the deliberate restart
 // mutates this test's live database. Never copy only a WAL-backed main file.
 const snapshot=join(directory,'phase-one-evidence.db'),db=new SQLite(file,{readonly:true,fileMustExist:true})
 try{await db.backup(snapshot)}finally{db.close()}
 result.phaseOneSnapshot={file:snapshot,sha256:hash(await readFile(snapshot)),before}
 const allocator=createServer();await new Promise<void>(done=>allocator.listen(0,'127.0.0.1',done));const port=(allocator.address() as {port:number}).port;await new Promise<void>(done=>allocator.close(()=>done()))
 result.serverSha256=hash(await readFile(join(binaries,'server.cjs')))
 await mkdir(join(directory,'backend'))
 child=spawn(process.execPath,['-e',"process.on('message',m=>{if(m==='qa-own-shutdown')process.emit('SIGTERM')});require(process.argv[1])",join(binaries,'server.cjs')],{windowsHide:true,cwd:join(directory,'backend'),stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,RPLAYOUT_DB:file,RPLAYOUT_STARTUP_TRACE:'1',HOST:'127.0.0.1',PORT:String(port),LOG_LEVEL:'warn'}})
 for(const stream of[child.stdout,child.stderr])stream?.on('data',chunk=>{logs=(logs+String(chunk)).slice(-128000)})
 await wait('Compiled normal startup listener',()=>logs.includes('[rplayout startup] HTTP listening'))
 let after:any
 await wait('Automatic recovery committed on actual native callback',()=>{
  after=read(db=>({checkpoint:JSON.parse((db.prepare('SELECT payload FROM channel_checkpoints WHERE channel_id=?').get('qa-normal') as {payload:string}).payload),owner:readExecutionOwner(db,'qa-normal'),asrun:db.prepare('SELECT id,ended_at,ended_by,start_position_frames FROM as_run ORDER BY rowid').all(),decisions:(db.prepare("SELECT * FROM operator_decisions WHERE kind='CHECKPOINT_AUTO_RECOVERY_REQUESTED'").all() as {payload:string}[]).map(decodeDecision)}))
  return after.owner?.id!==before.owner!.id&&after.owner?.enginePids.length===1&&after.asrun.length===2&&after.asrun[1].ended_at===null&&after.checkpoint.ownerRunId===after.owner.id&&after.checkpoint.elapsed>=before.checkpoint.elapsed+100
 },30000)
 assert.equal(after.decisions.length,1);const decision=after.decisions[0].payload
 assert.equal(decision.policy,'LAST_SAVED_CHECKPOINT');assert.equal(decision.positionFrames,before.checkpoint.elapsed)
 assert.equal(decision.operatorConfirmationRequired,false);assert.equal(decision.nativeRecoveryConfirmed,false);assert.equal(decision.possibleReplay,true)
 assert.equal(decision.sourceOwnerRunId,before.owner!.id);assert.equal(decision.ownerRunId,after.owner.id)
 assert.equal(after.asrun[0].ended_by,'RESTART');assert.ok(after.asrun[0].ended_at)
 assert.equal(after.asrun[1].start_position_frames,before.checkpoint.elapsed)
 assert.ok(after.checkpoint.elapsed<first.afterFault.state.onAir.elapsed,'Must not invent a cursor from elapsed wall time')
 result.afterAutomaticRecovery=after;result.restartedBackendPid=child.pid
 child.send('qa-own-shutdown');await wait('Compiled recovered backend normal exit',()=>child!.exitCode!==null||child!.signalCode!==null,25000)
 assert.equal(child.exitCode,0,logs);assert.equal(child.signalCode,null)
 result.afterClose=read(db=>{assert.equal(db.pragma('integrity_check',{simple:true}),'ok');assert.deepEqual(db.pragma('foreign_key_check'),[]);return{instances:readServerInstances(db),owner:readExecutionOwner(db,'qa-normal')}})
 assert.equal(result.afterClose.instances.length,2);assert.equal(result.afterClose.instances[0].phase,'OPEN');assert.equal(result.afterClose.instances[1].phase,'STORAGE_CLOSED')
 assert.equal(result.afterClose.owner.finalRelease,true);assert.deepEqual(result.afterClose.owner.enginePids,[])
 for(const pid of after.owner.enginePids)assert.equal(alive(pid),false)
 const gray=join(directory,'recovered.gray'),pcm=join(directory,'recovered.f32')
 for(const branch of[['videoconvert','video/x-raw,format=GRAY8,width=320,height=180',gray],['audioconvert','audio/x-raw,format=F32LE,rate=48000,channels=2,layout=interleaved',pcm]])await run(join(gst,'bin/gst-launch-1.0.exe'),['-q','filesrc',`location=${output.replaceAll('\\','/')}`,'!','decodebin','name=d','d.','!','queue','!',branch[0]!,'!',branch[1]!,'!','filesink',`location=${branch[2]!.replaceAll('\\','/')}`],{env:process.env,windowsHide:true,timeout:30000})
 const pixels=await readFile(gray),audio=await readFile(pcm),size=320*180,frames=pixels.length/size,samples=audio.length/8
 assert.equal(pixels.length%size,0);assert.equal(audio.length%8,0);assert.ok(frames>=100&&samples>=48000*4)
 const windows=[]
 for(const fraction of[0.25,0.5,0.75]){
  const at=Math.floor(frames*fraction),audioAt=Math.floor(samples*fraction)
  const movement=assertMovingPublishedGray(pixels.subarray(at*size,(at+25)*size),320,180)
  const bytes=audio.subarray(audioAt*8,(audioAt+48000)*8),statistics=stereoToneStatistics(bytes),spectrum=syntheticToneSpectrum(bytes),toneWindows=syntheticToneWindows(bytes,spectrum.frequencyHz)
  for(let c=0;c<2;c++)assert.ok(statistics.rms[c]!>0.01&&Math.abs(spectrum.frequencyHz[c]!-997)<15&&toneWindows.concentratedWindows[c]!>=4)
  windows.push({fraction,movement,statistics,spectrum,toneWindows})
 }
 result.capture={videoFrames:frames,audioFrames:samples,windows,encodedSha256:hash(await readFile(output)),graySha256:hash(pixels),pcmSha256:hash(audio),exactFrameSeekOrPtsQualified:false}
 assert.equal(hash(await readFile(snapshot)),result.phaseOneSnapshot.sha256)
 assert.equal(hash(await readFile(join(firstDirectory,'normal-pgm.mkv'))),first.capture.encodedSha256)
 result.result='PASS'
}catch(error){failure=error;result.error=String(error)}
finally{
 if(child&&child.exitCode===null&&child.signalCode===null){
  child.send('qa-own-shutdown');const end=Date.now()+25000;while(Date.now()<end&&child.exitCode===null&&child.signalCode===null)await new Promise(done=>setTimeout(done,50))
  if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');result.fixtureForceRequested=true}
  result.result='FAIL'
 }
 result.backendExit={code:child?.exitCode??null,signal:child?.signalCode??null};result.logs=logs
 await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify({result:result.result,directory,error:result.error,backendExit:result.backendExit,capture:result.capture}))
}
if(failure)throw failure
