import assert from 'node:assert/strict'
import {execFile,type ChildProcess} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,mkdir,readFile,writeFile,copyFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
import {stageStorageQaProxy} from './lib/storage-qa-proxy.js'
import {assertMovingPublishedGray} from './lib/held-picture-evidence.js'
import {stereoToneStatistics,syntheticToneSpectrum,syntheticToneWindows} from './lib/verify-published-audio.js'

// Actual NORMAL createApp/runtimeFor, not HA/restoration admission. Never
// disable a configured gate or qualify the previously refused restored path.
assert.equal(process.argv.length,3)
const root=fileURLToPath(new URL('..',import.meta.url)),binaries=resolve(process.argv[2]!)
assert.ok(binaries.startsWith(join(root,'scratch','host-history-r88-')))
const directory=await mkdtemp(join(root,'scratch','normal-pgm-storage-timeout-'))
const faultRoot=join(directory,'fault-workers'),media=join(directory,'media'),file=join(directory,'Banco-PGM-ação.db')
await mkdir(faultRoot);await mkdir(media)
const qaProxy=await stageStorageQaProxy(faultRoot,binaries,'storage-transaction-timeout-proxy.cjs')
for(const key of Object.keys(process.env))if(/^(RPLAYOUT_|GST_|GSTREAMER_|MTX_|RTSP_|VITEST$)/i.test(key))delete process.env[key]
const binary=resolve('D:/RPlayout-builds/native-r83-20261016/release/rplayout-engine.exe'),gstRoot='C:/Program Files/gstreamer/1.0/msvc_x86_64',gstBin=join(gstRoot,'bin')
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
await copyFile(join(root,'apps/server/src/app.ts'),join(directory,'control-app.source.ts'))
await copyFile(join(root,'apps/server/src/domain/engine.ts'),join(directory,'control-engine.source.ts'))
assert.equal(hash(await readFile(binary)),'0250cf3164ed72ea7ed2bd3c7e641d0e7ac79b225bdb6d4f7bab9478a8ec0c7e')
const output=join(directory,'normal-pgm.mkv'),source=join(media,'VT-ação.mkv')
Object.assign(process.env,{NODE_PATH:join(root,'apps/server/node_modules'),RPLAYOUT_ENGINE:binary,RPLAYOUT_ENGINE_OUTPUT:'file:'+output,RPLAYOUT_ENCODER:'x264enc',RPLAYOUT_HOST_GUARD:join(root,'apps/engine/target/release/rplayout-host-guard.exe'),RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_VAULT_FILE:join(directory,'vault.json'),RPLAYOUT_STORAGE_MODE:'PROCESS',RPLAYOUT_STORAGE_BIN_DIR:faultRoot,RPLAYOUT_MEDIA:media,RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_CACHE:join(directory,'cache'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_BACKUPS:join(directory,'backups'),RPLAYOUT_BACKUP_HOURS:'0',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_RELAY:'',RPLAYOUT_DEVICES:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_AUDIO_BUS_PROBE:'',RPLAYOUT_GRAPHIC_PROBE:'',GSTREAMER_1_0_ROOT_MSVC_X86_64:gstRoot,PATH:gstBin+';'+process.env.PATH,GST_PLUGIN_PATH:join(gstRoot,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gstRoot,'lib/gstreamer-1.0'),GST_PLUGIN_SCANNER:join(gstRoot,'libexec/gstreamer-1.0/gst-plugin-scanner.exe'),GST_REGISTRY:join(directory,'registry.bin'),TEMP:directory,TMP:directory})
console.log(JSON.stringify({directory,scenario:'normal-local-file-pgm-during-real-storage-timeout',networkOutput:false,restoredMode:false}))
const nativePath=(path:string)=>path.replaceAll('\\','/'),run=promisify(execFile)
await run(join(gstBin,'gst-launch-1.0.exe'),['-q','matroskamux','name=m','!','filesink',`location=${nativePath(source)}`,'videotestsrc','num-buffers=1500','pattern=ball','!','video/x-raw,width=320,height=180,framerate=25/1','!','videoconvert','!','vp8enc','deadline=1','!','queue','!','m.','audiotestsrc','num-buffers=2813','volume=0.05','freq=997','!','audio/x-raw,channels=2,rate=48000','!','audioconvert','!','vorbisenc','!','queue','!','m.'],{env:process.env,windowsHide:true,timeout:60000})
const {createApp,runtimeFor}=await import('../apps/server/src/app.js')
const {channels,rundowns,mediaAssets,rundownItems}=await import('../apps/server/src/db/schema.js')
const {getChannel}=await import('../apps/server/src/db/repo.js')
const {publishOperationalPlaylist}=await import('../apps/server/src/domain/operational-playlist.js')
const {EngineTransport}=await import('../apps/server/src/domain/engine.js')
const {databaseStorageStatus}=await import('../apps/server/src/db/process-database.js')
const SQLite=createRequire(new URL('../apps/server/package.json',import.meta.url))('better-sqlite3') as typeof import('../apps/server/node_modules/@types/better-sqlite3/index.js')
let app:Awaited<ReturnType<typeof createApp>>|null=null,runtime:Awaited<ReturnType<typeof runtimeFor>>=null,engine:InstanceType<typeof EngineTransport>|null=null,child:ChildProcess|null=null,failure:unknown=null
const result:Record<string,any>={result:'FAIL',directory,binaries,qaProxy,engineSha256:hash(await readFile(binary)),controlSourceHashes:{app:hash(await readFile(join(directory,'control-app.source.ts'))),engine:hash(await readFile(join(directory,'control-engine.source.ts')))},scope:'Source NORMAL createApp/runtimeFor + real PROCESS/native local file output; declared ACK hold and 30s production timeout. Not restored/HA, installed backend, HTTP, physical signals, uninterrupted frame/PTS/SLA or complete recovery qualification'}
async function wait(label:string,check:()=>boolean|Promise<boolean>,timeout=30000){const deadline=Date.now()+timeout;while(Date.now()<deadline){if(await check())return;await new Promise(done=>setTimeout(done,25))}throw new Error(label)}
try{
 app=await createApp(file)
 assert.equal(app.ha,null);assert.equal(app.restoredAdmission,null);assert.equal(app.haExecutionAdmission,null)
 assert.equal(app.hostFence?.status().ownedHere,true,'Normal actual host admission required; do not steal or replace it')
 const stamp=new Date().toISOString()
 app.db.insert(channels).values({id:'qa-normal',name:'QA normal file only',width:320,height:180,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:stamp}).run()
 app.db.insert(rundowns).values({id:'rd',channelId:'qa-normal',name:'QA declared media, not ingest/QC certification',date:stamp.slice(0,10),plannedStart:0,loop:false,createdAt:stamp,updatedAt:stamp}).run()
 app.db.insert(mediaAssets).values({id:'asset',title:'QA real synthetic file',path:source,contentHash:hash(await readFile(source)),kind:'VIDEO',durationFrames:1500,durationNs:60_000_000_000,width:320,height:180,rateNum:25,rateDen:1,hasAudio:true,interlaceMode:'progressive',qcStatus:'APPROVED',createdAt:stamp}).run()
 app.db.insert(rundownItems).values({id:'vt',rundownId:'rd',sortOrder:0,title:'QA single normal VT',type:'VT',mediaId:'asset',trim:{in:0,out:1500},minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',autoNext:false,loop:false,locked:false}).run()
 await publishOperationalPlaylist(app.db,(await getChannel(app.db,'qa-normal'))!,'rd','@own-normal-file-qa')
 app.sqlite.exec("CREATE TABLE fixture_pending(id TEXT PRIMARY KEY,value INTEGER NOT NULL); INSERT INTO fixture_pending VALUES('qa-pending',0)")
 runtime=await runtimeFor(app,'qa-normal');assert.ok(runtime);assert.ok(runtime.transport instanceof EngineTransport)
 engine=runtime.transport;child=(engine as unknown as {child:ChildProcess}).child;result.enginePid=child.pid
 await runtime.load('rd');await engine.take('rd','vt')
 await wait('Native normal PGM cursor',()=>Boolean(engine!.state().onAir?.elapsed!>=50))
 assert.equal(engine.health().fencing.enabled,false,'Expected ordinary local mode; a fenced/restored mode cannot be substituted')
 result.beforeFault={state:engine.state(),health:engine.health(),storage:databaseStorageStatus(app.sqlite),host:app.hostFence!.status(),asrun:app.sqlite.prepare('SELECT id,ended_at FROM as_run').all()}
 runtime.checkpoint(true)
 app.sqlite.exec('BEGIN IMMEDIATE')
 const active=app.sqlite,start=performance.now();let callerError=''
 assert.throws(()=>active.prepare('UPDATE fixture_pending SET value=value+1 WHERE id=?').run('qa-pending'),error=>{callerError=String(error);return /não respondeu no prazo.*Resultado desconhecido/.test(callerError)})
 const blockedMs=performance.now()-start
 assert.ok(blockedMs>=29500&&blockedMs<45000,'Unchanged real 30s deadline required')
 assert.equal(databaseStorageStatus(active).connected,false)
 assert.throws(()=>active.exec('COMMIT'),/indisponível/)
 result.timeout={blockedMs,productionDeadlineMs:30000,callerError,storage:databaseStorageStatus(active),transactionOutcomeKnownToCaller:false}
 await new Promise(done=>setTimeout(done,2000))
 assert.equal(child.exitCode,null);assert.equal(child.signalCode,null)
 result.afterFault={state:engine.state(),health:engine.health(),sameOwnChildAlive:true}
 assert.equal(engine.state().onAir?.itemId,'vt');assert.ok(engine.state().onAir!.elapsed>=result.beforeFault.state.onAir.elapsed+650)
 const ended=new Promise<{code:number|null;signal:NodeJS.Signals|null}>(done=>child!.once('exit',(code,signal)=>done({code,signal})))
 result.normalCloseProof=await runtime.closeGracefully()
 assert.deepEqual(result.normalCloseProof,{ownedNativeProcessesStopped:true,graceful:true,forceRequested:false})
 result.nativeExit=await Promise.race([ended,new Promise<null>(done=>setTimeout(()=>done(null),1000))])
 assert.deepEqual(result.nativeExit,{code:0,signal:null},'Observe native graceful mux shutdown, not a forced-kill file')
 const gray=join(directory,'published.gray'),pcm=join(directory,'published.f32')
 for(const branch of[['videoconvert','video/x-raw,format=GRAY8,width=320,height=180',gray],['audioconvert','audio/x-raw,format=F32LE,rate=48000,channels=2,layout=interleaved',pcm]])await run(join(gstBin,'gst-launch-1.0.exe'),['-q','filesrc',`location=${nativePath(output)}`,'!','decodebin','name=d','d.','!','queue','!',branch[0]!,'!',branch[1]!,'!','filesink',`location=${nativePath(branch[2]!)}`],{env:process.env,windowsHide:true,timeout:30000})
 const pixels=await readFile(gray),audio=await readFile(pcm),size=320*180,frames=pixels.length/size,samples=audio.length/8
 assert.equal(pixels.length%size,0);assert.equal(audio.length%8,0)
 assert.ok(frames/25>=blockedMs/1000&&samples/48000>=blockedMs/1000,'Decoded publisher output must cover at least the blocked wall-clock duration')
 const windows=[]
 for(const fraction of[0.25,0.5,0.75]){
   const at=Math.floor(frames*fraction),audioAt=Math.floor(samples*fraction)
   const movement=assertMovingPublishedGray(pixels.subarray(at*size,(at+25)*size),320,180)
   const bytes=audio.subarray(audioAt*8,(audioAt+48000)*8),statistics=stereoToneStatistics(bytes),spectrum=syntheticToneSpectrum(bytes),toneWindows=syntheticToneWindows(bytes,spectrum.frequencyHz)
   for(let c=0;c<2;c++){assert.ok(statistics.rms[c]!>0.01);assert.ok(Math.abs(spectrum.frequencyHz[c]!-997)<15&&toneWindows.concentratedWindows[c]!>=4)}
   windows.push({fraction,movement,statistics,spectrum,toneWindows})
 }
 result.capture={videoFrames:frames,audioFrames:samples,windows,encodedSha256:hash(await readFile(output)),graySha256:hash(pixels),pcmSha256:hash(audio),exactPtsAlignmentValidated:false,continuousFrameDeliveryValidated:false}
 const copy=new SQLite(file,{readonly:true,fileMustExist:true})
 try{assert.equal(copy.pragma('integrity_check',{simple:true}),'ok');assert.deepEqual(copy.pragma('foreign_key_check'),[]);assert.deepEqual(copy.prepare('SELECT * FROM fixture_pending').all(),[{id:'qa-pending',value:0}]);result.persistedAfterFault={pendingValue:0,asrun:copy.prepare('SELECT id,ended_at FROM as_run').all(),checkpoints:copy.prepare('SELECT payload FROM channel_checkpoints').all()}}finally{copy.close()}
 result.result='PASS'
}catch(error){failure=error;result.error=error instanceof Error?{name:error.name,message:error.message}:String(error);await writeFile(join(directory,'failure-before-cleanup.json'),JSON.stringify(result,null,2))}
finally{
 if(engine)try{result.nativeCleanup=await engine.closeConfirmed(5000);if(!result.nativeCleanup.ownedNativeProcessesStopped)throw new Error('Own engine exit inconclusive')}catch(error){failure??=error;result.nativeCleanupError=String(error);result.result='FAIL'}
 try{await app?.close();result.appCloseResolved=true}catch(error){
  result.appCloseResolved=false;result.appCloseError=String(error);result.signedStorageCloseQualified=false
  // Own QA fixture only: no SQL repair/lease release. Once our engine exit is
  // observed and storage poisoned, close the dead adapter/private broker pipe
  // so a rejected product shutdown cannot keep this verifier alive forever.
  if(app&&result.nativeCleanup?.ownedNativeProcessesStopped&&!databaseStorageStatus(app.sqlite).connected){app.sqlite.close();app.hostFence?.close();result.fixtureOnlyPoisonedHandleCleanup=true}
 }
 let marker:any=null
 try{await wait('Own fault child final marker',async()=>{marker=JSON.parse(await readFile(join(faultRoot,'timeout-marker.json'),'utf8'));return marker.stage==='CHILD_EXIT_AFTER_PARENT_DISCONNECT'},10000);result.marker=marker;assert.equal(marker.actualAck.inTransaction,true);assert.equal(marker.targetRequests,1);assert.equal(marker.replyForwarded,false)}catch(error){failure??=error;result.markerError=String(error);result.result='FAIL'}
 result.hashes={bridge:hash(await readFile(join(binaries,'storage-bridge.cjs'))),service:hash(await readFile(join(binaries,'storage-service.cjs')))}
 await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}
if(failure)throw failure
