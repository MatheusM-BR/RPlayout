import assert from 'node:assert/strict'
import {execFile,type ChildProcess} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,mkdir,readFile,writeFile,copyFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
import {assertMovingPublishedGray} from './lib/held-picture-evidence.js'
import {stereoToneStatistics,syntheticToneSpectrum,syntheticToneWindows} from './lib/verify-published-audio.js'

// Normal source App + real PROCESS/native file publisher. Call ONLY close(),
// never flush(), and verify history before declaring the storage close.
assert.equal(process.argv.length,4)
const root=fileURLToPath(new URL('..',import.meta.url)),binaries=resolve(process.argv[2]!),mediaFixture=resolve(process.argv[3]!)
assert.ok(binaries.startsWith(join(root,'scratch','host-history-r88-')))
assert.ok(mediaFixture.startsWith(join(root,'scratch','normal-pgm-storage-timeout-')))
const previous=JSON.parse(await readFile(join(mediaFixture,'result.json'),'utf8'));assert.equal(previous.result,'PASS')
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
const original=join(mediaFixture,'media','VT-ação.mkv');assert.equal(hash(await readFile(original)),previous.beforeFault.state.programTrim.contentHash)
const directory=await mkdtemp(join(root,'scratch','normal-pgm-app-close-')),media=join(directory,'media'),file=join(directory,'Fechamento-ação.db'),output=join(directory,'direct-close.mkv'),source=join(media,'VT-ação.mkv')
await mkdir(media);await copyFile(original,source)
for(const key of Object.keys(process.env))if(/^(RPLAYOUT_|GST_|GSTREAMER_|MTX_|RTSP_|VITEST$)/i.test(key))delete process.env[key]
const binary=resolve('D:/RPlayout-builds/native-r83-20261016/release/rplayout-engine.exe'),gst='C:/Program Files/gstreamer/1.0/msvc_x86_64'
assert.equal(hash(await readFile(binary)),'0250cf3164ed72ea7ed2bd3c7e641d0e7ac79b225bdb6d4f7bab9478a8ec0c7e')
Object.assign(process.env,{NODE_PATH:join(root,'apps/server/node_modules'),RPLAYOUT_ENGINE:binary,RPLAYOUT_ENGINE_OUTPUT:'file:'+output,RPLAYOUT_ENCODER:'x264enc',RPLAYOUT_HOST_GUARD:join(root,'apps/engine/target/release/rplayout-host-guard.exe'),RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_VAULT_FILE:join(directory,'vault.json'),RPLAYOUT_STORAGE_MODE:'PROCESS',RPLAYOUT_STORAGE_BIN_DIR:binaries,RPLAYOUT_MEDIA:media,RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_CACHE:join(directory,'cache'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_BACKUPS:join(directory,'backups'),RPLAYOUT_BACKUP_HOURS:'0',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_RELAY:'',RPLAYOUT_DEVICES:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_AUDIO_BUS_PROBE:'',RPLAYOUT_GRAPHIC_PROBE:'',GSTREAMER_1_0_ROOT_MSVC_X86_64:gst,PATH:join(gst,'bin')+';'+process.env.PATH,GST_PLUGIN_PATH:join(gst,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gst,'lib/gstreamer-1.0'),GST_PLUGIN_SCANNER:join(gst,'libexec/gstreamer-1.0/gst-plugin-scanner.exe'),GST_REGISTRY:join(directory,'registry.bin'),TEMP:directory,TMP:directory})
await copyFile(join(root,'apps/server/src/app.ts'),join(directory,'control-app.source.ts'));await copyFile(join(root,'apps/server/src/domain/engine.ts'),join(directory,'control-engine.source.ts'))
const {createApp,runtimeFor}=await import('../apps/server/src/app.js'),{channels,rundowns,mediaAssets,rundownItems}=await import('../apps/server/src/db/schema.js')
const {getChannel}=await import('../apps/server/src/db/repo.js'),{publishOperationalPlaylist}=await import('../apps/server/src/domain/operational-playlist.js')
const {EngineTransport}=await import('../apps/server/src/domain/engine.js'),{readServerInstances}=await import('../apps/server/src/db/server-instances.js'),{readExecutionOwner}=await import('../apps/server/src/db/execution-ownership.js')
const {databaseStorageStatus}=await import('../apps/server/src/db/process-database.js')
const SQLite=createRequire(new URL('../apps/server/package.json',import.meta.url))('better-sqlite3') as typeof import('../apps/server/node_modules/@types/better-sqlite3/index.js')
let app:Awaited<ReturnType<typeof createApp>>|null=null,engine:InstanceType<typeof EngineTransport>|null=null,child:ChildProcess|null=null,failure:unknown=null
const result:Record<string,any>={result:'FAIL',directory,binaries,scope:'Source normal App.close without caller flush, healthy PROCESS and actual native encoded file. Not compiled main, installed/HTTP/physical/restored/HA, exact PTS/seek or per-publisher EOS/index qualification',controlSourceHashes:{app:hash(await readFile(join(directory,'control-app.source.ts'))),engine:hash(await readFile(join(directory,'control-engine.source.ts')))},engineSha256:hash(await readFile(binary)),sourceMediaSha256:hash(await readFile(source))}
async function wait(label:string,check:()=>boolean|Promise<boolean>,timeout=30000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await new Promise(done=>setTimeout(done,25))}throw new Error(label)}
console.log(JSON.stringify({directory,scenario:'normal-direct-app-close',networkOutput:false,httpClient:false}))
try{
 app=await createApp(file);assert.equal(app.ha,null);assert.equal(app.restoredAdmission,null);assert.equal(app.haExecutionAdmission,null);assert.equal(app.hostFence!.status().ownedHere,true)
 const stamp=new Date().toISOString()
 app.db.insert(channels).values({id:'qa-close',name:'QA direct close',width:320,height:180,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:stamp}).run()
 app.db.insert(rundowns).values({id:'rd',channelId:'qa-close',name:'Declared synthetic media, not ingest approval',date:stamp.slice(0,10),plannedStart:0,loop:false,createdAt:stamp,updatedAt:stamp}).run()
 app.db.insert(mediaAssets).values({id:'asset',title:'QA synthetic VT',path:source,contentHash:result.sourceMediaSha256,kind:'VIDEO',durationFrames:1500,durationNs:60_000_000_000,width:320,height:180,rateNum:25,rateDen:1,hasAudio:true,interlaceMode:'progressive',qcStatus:'APPROVED',createdAt:stamp}).run()
 app.db.insert(rundownItems).values({id:'vt',rundownId:'rd',sortOrder:0,title:'Direct-close VT',type:'VT',mediaId:'asset',trim:{in:0,out:1500},minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',autoNext:false,loop:false,locked:false}).run()
 await publishOperationalPlaylist(app.db,(await getChannel(app.db,'qa-close'))!,'rd','@qa-own-app-close')
 const runtime=await runtimeFor(app,'qa-close');assert.ok(runtime);assert.ok(runtime.transport instanceof EngineTransport)
 engine=runtime.transport;child=(engine as unknown as {child:ChildProcess}).child
 await runtime.load('rd');await engine.take('rd','vt');await wait('Real native cursor',()=>Boolean(engine!.state().onAir?.elapsed!>=125))
 assert.equal(engine.health().fencing.enabled,false);runtime.checkpoint(true)
 result.beforeClose={state:engine.state(),storage:databaseStorageStatus(app.sqlite),enginePid:child.pid,owner:readExecutionOwner(app.sqlite,'qa-close'),asrun:app.sqlite.prepare('SELECT id,ended_at FROM as_run').all()}
 assert.equal(result.beforeClose.asrun.length,1);assert.equal(result.beforeClose.asrun[0].ended_at,null)
 const start=performance.now();await app.close();result.elapsedCloseMs=performance.now()-start
 assert.equal(app.sqlite.open,false);assert.equal(child.exitCode,0);assert.equal(child.signalCode,null)
 result.nativeExit={code:child.exitCode,signal:child.signalCode};result.externalFlushCalled=false
 const db=new SQLite(file,{readonly:true,fileMustExist:true})
 try{assert.equal(db.pragma('integrity_check',{simple:true}),'ok');assert.deepEqual(db.pragma('foreign_key_check'),[]);result.afterClose={owner:readExecutionOwner(db,'qa-close'),instances:readServerInstances(db),asrun:db.prepare('SELECT id,ended_at,ended_by,duration_evidence FROM as_run').all()}}finally{db.close()}
 assert.equal(result.afterClose.owner.phase,'RELEASED');assert.equal(result.afterClose.owner.finalRelease,true);assert.equal(result.afterClose.owner.observationClosed,true);assert.deepEqual(result.afterClose.owner.enginePids,[])
 assert.equal(result.afterClose.instances.length,1);assert.equal(result.afterClose.instances[0].phase,'STORAGE_CLOSED')
 assert.equal(result.afterClose.asrun[0].id,result.beforeClose.asrun[0].id);assert.ok(result.afterClose.asrun[0].ended_at);assert.equal(result.afterClose.asrun[0].ended_by,'SHUTDOWN');assert.equal(result.afterClose.asrun[0].duration_evidence,'CLOCK_ESTIMATE')
 const gray=join(directory,'published.gray'),pcm=join(directory,'published.f32')
 for(const branch of[['videoconvert','video/x-raw,format=GRAY8,width=320,height=180',gray],['audioconvert','audio/x-raw,format=F32LE,rate=48000,channels=2,layout=interleaved',pcm]])await promisify(execFile)(join(gst,'bin/gst-launch-1.0.exe'),['-q','filesrc',`location=${output.replaceAll('\\','/')}`,'!','decodebin','name=d','d.','!','queue','!',branch[0]!,'!',branch[1]!,'!','filesink',`location=${branch[2]!.replaceAll('\\','/')}`],{env:process.env,windowsHide:true,timeout:30000})
 const pixels=await readFile(gray),audio=await readFile(pcm),size=320*180,frames=pixels.length/size,samples=audio.length/8
 assert.equal(pixels.length%size,0);assert.equal(audio.length%8,0);assert.ok(frames>=125&&samples>=240000)
 const windows=[]
 for(const fraction of[0.25,0.5,0.75]){
  const at=Math.floor(frames*fraction),audioAt=Math.floor(samples*fraction)
  const movement=assertMovingPublishedGray(pixels.subarray(at*size,(at+25)*size),320,180)
  const bytes=audio.subarray(audioAt*8,(audioAt+48000)*8),statistics=stereoToneStatistics(bytes),spectrum=syntheticToneSpectrum(bytes),toneWindows=syntheticToneWindows(bytes,spectrum.frequencyHz)
  for(let c=0;c<2;c++)assert.ok(statistics.rms[c]!>0.01&&Math.abs(spectrum.frequencyHz[c]!-997)<15&&toneWindows.concentratedWindows[c]!>=4)
  windows.push({fraction,movement,statistics,spectrum,toneWindows})
 }
 result.capture={videoFrames:frames,audioFrames:samples,windows,encodedSha256:hash(await readFile(output)),graySha256:hash(pixels),pcmSha256:hash(audio),exactPtsOrEndCursorQualified:false}
 result.result='PASS'
}catch(error){failure=error;result.error=String(error)}
finally{
 if(engine){try{result.ownNativeCleanup=await engine.closeConfirmed(5000)}catch(error){result.cleanupError=String(error);result.result='FAIL';failure??=error}}
 if(app&&app.sqlite.open){try{await app.close()}catch(error){result.appCleanupError=String(error);result.result='FAIL';failure??=error;if(result.ownNativeCleanup?.ownedNativeProcessesStopped){app.sqlite.close();app.hostFence?.close();result.fixtureOnlyUncertainHandleCleanup=true}}}
 result.hashes={bridge:hash(await readFile(join(binaries,'storage-bridge.cjs'))),service:hash(await readFile(join(binaries,'storage-service.cjs')))}
 await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify({result:result.result,directory,error:result.error,nativeExit:result.nativeExit,elapsedCloseMs:result.elapsedCloseMs,videoFrames:result.capture?.videoFrames,audioFrames:result.capture?.audioFrames}))
}
if(failure)throw failure
