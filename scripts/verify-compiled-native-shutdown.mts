import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises'
import {createServer} from 'node:net'
import {spawn,execFile,type ChildProcess} from 'node:child_process'
import {promisify} from 'node:util'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'

// Actual compiled index SIGTERM handler, triggered by own private test IPC.
// Idle black/silence only. No HTTP client, TAKE, device/network source or
// qualification of OS console/service-stop/power-loss behavior.
assert.equal(process.argv.length,3)
const root=fileURLToPath(new URL('..',import.meta.url)),binaries=resolve(process.argv[2]!)
assert.ok(binaries.startsWith(join(root,'scratch','host-history-r88-')))
const directory=await mkdtemp(join(root,'scratch','compiled-native-shutdown-')),media=join(directory,'media'),file=join(directory,'Encerramento-ação.db'),output=join(directory,'idle-native.mkv')
await mkdir(media)
for(const key of Object.keys(process.env))if(/^(RPLAYOUT_|GST_|GSTREAMER_|MTX_|RTSP_|VITEST$)/i.test(key))delete process.env[key]
const gst='C:/Program Files/gstreamer/1.0/msvc_x86_64',engine=resolve('D:/RPlayout-builds/native-r83-20261016/release/rplayout-engine.exe')
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
assert.equal(hash(await readFile(engine)),'0250cf3164ed72ea7ed2bd3c7e641d0e7ac79b225bdb6d4f7bab9478a8ec0c7e')
Object.assign(process.env,{NODE_PATH:join(root,'apps/server/node_modules'),RPLAYOUT_STORAGE_MODE:'INLINE',RPLAYOUT_STORAGE_BIN_DIR:binaries,RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_VAULT_FILE:join(directory,'vault.json'),RPLAYOUT_MEDIA:media,RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_CACHE:join(directory,'cache'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_BACKUPS:join(directory,'backups'),RPLAYOUT_ENGINE:engine,RPLAYOUT_ENGINE_OUTPUT:'file:'+output,RPLAYOUT_ENCODER:'x264enc',RPLAYOUT_HOST_GUARD:join(root,'apps/engine/target/release/rplayout-host-guard.exe'),RPLAYOUT_MEDIAMTX:'',RPLAYOUT_RELAY:'',RPLAYOUT_DEVICES:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_AUDIO_BUS_PROBE:'',RPLAYOUT_GRAPHIC_PROBE:'',RPLAYOUT_BACKUP_HOURS:'0',RPLAYOUT_LAUNCHER_DISCOVERY:'0',RPLAYOUT_DEFAULT_ROLE:'VIEWER',GSTREAMER_1_0_ROOT_MSVC_X86_64:gst,PATH:join(gst,'bin')+';'+process.env.PATH,GST_REGISTRY:join(directory,'registry.bin'),GST_PLUGIN_PATH:join(gst,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gst,'lib/gstreamer-1.0'),GST_PLUGIN_SCANNER:join(gst,'libexec/gstreamer-1.0/gst-plugin-scanner.exe'),TEMP:directory,TMP:directory})
const {openDatabase}=await import('../apps/server/src/db/client.js'),{readServerInstances}=await import('../apps/server/src/db/server-instances.js'),{readExecutionOwner}=await import('../apps/server/src/db/execution-ownership.js')
const seed=openDatabase(file)
seed.sqlite.prepare("INSERT INTO channels(id,name,width,height,rate_num,rate_den,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES('qa-idle','QA idle mux only',320,180,25,1,-23,-1,5,?)").run(new Date().toISOString());seed.sqlite.close()
const SQLite=createRequire(new URL('../apps/server/package.json',import.meta.url))('better-sqlite3') as typeof import('../apps/server/node_modules/@types/better-sqlite3/index.js')
const read=<T,>(work:(db:InstanceType<typeof SQLite>)=>T)=>{const db=new SQLite(file,{readonly:true,fileMustExist:true});try{return work(db)}finally{db.close()}}
const allocator=createServer();await new Promise<void>(done=>allocator.listen(0,'127.0.0.1',done));const port=(allocator.address() as {port:number}).port;await new Promise<void>(done=>allocator.close(()=>done()))
let child:ChildProcess|null=null,logs='',failure:unknown=null
const result:Record<string,any>={result:'FAIL',directory,binaries,scope:'Compiled main normal shutdown, healthy PROCESS storage, actual native encoded idle black/silence; no on-air content, HTTP client, installed/physical/HA/restored/OS-service shutdown qualification',serverSha256:hash(await readFile(join(binaries,'server.cjs'))),engineSha256:hash(await readFile(engine))}
const present=(pid:number)=>{try{process.kill(pid,0);return true}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return false;throw error}}
async function wait(label:string,check:()=>boolean|Promise<boolean>,timeout=30000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;assert.equal(child?.exitCode,null,logs);await new Promise(done=>setTimeout(done,50))}throw new Error(label)}
console.log(JSON.stringify({directory,scenario:'compiled-native-idle-shutdown',port,httpClient:false}))
try{
 child=spawn(process.execPath,['-e',"process.on('message',m=>{if(m==='qa-own-shutdown')process.emit('SIGTERM')});require(process.argv[1])",join(binaries,'server.cjs')],{windowsHide:true,cwd:directory,stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,RPLAYOUT_STORAGE_MODE:'PROCESS',RPLAYOUT_DB:file,RPLAYOUT_STARTUP_TRACE:'1',HOST:'127.0.0.1',PORT:String(port),LOG_LEVEL:'warn'}})
 for(const stream of[child.stdout,child.stderr])stream?.on('data',chunk=>{logs=(logs+String(chunk)).slice(-128000)})
 await wait('Compiled server listener',()=>logs.includes('[rplayout startup] HTTP listening'))
 let owner:ReturnType<typeof readExecutionOwner>=null
 await wait('Actual own native generation registered',()=>{owner=read(db=>readExecutionOwner(db,'qa-idle'));return owner?.enginePids.length===1&&logs.includes('codificando com x264enc')})
 result.beforeShutdown={backendPid:child.pid,enginePids:owner!.enginePids,ownerRunId:owner!.id}
 await new Promise(done=>setTimeout(done,2000))
 const started=performance.now();child.send('qa-own-shutdown')
 await wait('Compiled graceful normal exit',()=>child!.exitCode!==null||child!.signalCode!==null,25000)
 result.elapsedCloseMs=performance.now()-started;assert.equal(child.exitCode,0,logs);assert.equal(child.signalCode,null)
 result.afterShutdown=read(db=>{assert.equal(db.pragma('integrity_check',{simple:true}),'ok');assert.deepEqual(db.pragma('foreign_key_check'),[]);return{instances:readServerInstances(db),owner:readExecutionOwner(db,'qa-idle'),asrun:db.prepare('SELECT COUNT(*) n FROM as_run').get()}})
 assert.equal(result.afterShutdown.instances.length,1);assert.equal(result.afterShutdown.instances[0].pid,child.pid);assert.equal(result.afterShutdown.instances[0].phase,'STORAGE_CLOSED')
 assert.equal(result.afterShutdown.owner.phase,'RELEASED');assert.deepEqual(result.afterShutdown.owner.enginePids,[]);assert.equal(result.afterShutdown.owner.finalRelease,true);assert.equal(result.afterShutdown.asrun.n,0)
 for(const pid of result.beforeShutdown.enginePids)assert.equal(present(pid),false)
 const gray=join(directory,'idle.gray'),pcm=join(directory,'idle.f32')
 for(const branch of[['videoconvert','video/x-raw,format=GRAY8,width=320,height=180',gray],['audioconvert','audio/x-raw,format=F32LE,rate=48000,channels=2,layout=interleaved',pcm]])await promisify(execFile)(join(gst,'bin/gst-launch-1.0.exe'),['-q','filesrc',`location=${output.replaceAll('\\','/')}`,'!','decodebin','name=d','d.','!','queue','!',branch[0]!,'!',branch[1]!,'!','filesink',`location=${branch[2]!.replaceAll('\\','/')}`],{env:process.env,windowsHide:true,timeout:30000})
 const pixels=await readFile(gray),audio=await readFile(pcm);assert.equal(pixels.length%(320*180),0);assert.equal(audio.length%8,0);assert.ok(pixels.length>=320*180*25&&audio.length>=48000*8)
 result.capture={videoFrames:pixels.length/(320*180),audioFrames:audio.length/8,encodedSha256:hash(await readFile(output)),idlePlaceholderOnly:true,onAirContentQualified:false}
 result.result='PASS'
}catch(error){failure=error;result.error=String(error)}
finally{
 if(child&&child.exitCode===null&&child.signalCode===null){const ended=new Promise(done=>child!.once('exit',done));child.kill('SIGKILL');await Promise.race([ended,new Promise(done=>setTimeout(done,10000))]);result.fixtureForceRequested=true;result.result='FAIL'}
 result.backendExit={code:child?.exitCode??null,signal:child?.signalCode??null};result.logs=logs
 await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({result:result.result,directory,error:result.error,elapsedCloseMs:result.elapsedCloseMs,capture:result.capture,backendExit:result.backendExit}))
}
if(failure)throw failure
