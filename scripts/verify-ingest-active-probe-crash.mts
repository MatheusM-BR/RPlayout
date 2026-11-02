import assert from 'node:assert/strict'
import {spawn,execFile,type ChildProcess} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,mkdir,readFile,writeFile,copyFile} from 'node:fs/promises'
import {utimesSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createServer} from 'node:net'
import {fileURLToPath} from 'node:url'
import {randomUUID,createHash} from 'node:crypto'
import {openDatabase} from '../apps/server/src/db/client.js'
import {sessionDigest} from '../apps/server/src/domain/access.js'
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(tmpdir(),'RPlayout-ingest-active-crash-'))
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json')
const file=join(directory,'qa.db'),db=openDatabase(file),media=join(directory,'media');await mkdir(media)
const original=join(media,'AÇÃO Çãó.mkv'),binary=join(root,'apps/engine/target/release/rplayout-probe.exe'),gstRoot=process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64??'C:/Program Files/gstreamer/1.0/msvc_x86_64',gstBin=join(gstRoot,'bin')
const gstEnv={...process.env,PATH:gstBin+';'+process.env.PATH,GST_PLUGIN_PATH:join(gstRoot,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gstRoot,'lib/gstreamer-1.0'),GST_PLUGIN_SCANNER:join(gstRoot,'libexec/gstreamer-1.0/gst-plugin-scanner.exe'),GST_REGISTRY:join(directory,'registry.bin')}
if(process.argv[2])await copyFile(process.argv[2],original)
else await promisify(execFile)(join(gstBin,'gst-launch-1.0.exe'),['-q','matroskamux','name=m','!','filesink',`location=${original.replaceAll('\\','/')}`,'videotestsrc','num-buffers=15000','pattern=black','!','video/x-raw,width=320,height=180,framerate=25/1','!','videoconvert','!','vp8enc','deadline=1','threads=2','!','queue','!','m.','audiotestsrc','num-buffers=28125','samplesperbuffer=1024','volume=0.05','!','audio/x-raw,rate=48000,channels=2','!','audioconvert','!','vorbisenc','!','queue','!','m.'],{env:gstEnv,windowsHide:true,timeout:120000})
utimesSync(original,new Date('2020-01-01'),new Date('2020-01-01'))
const originalHash=createHash('sha256').update(await readFile(original)).digest('hex'),token=randomUUID()+randomUUID(),children:ChildProcess[]=[],logs=new Map<ChildProcess,string>()
db.sqlite.exec("INSERT INTO users VALUES('u','Admin','NO_LOGIN','ADMIN',1,'now')");db.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest(token),'u','2099-01-01','now')
async function bounded<T>(promise:Promise<T>,ms:number){let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Own proof timed out')),ms)})])}finally{if(timer)clearTimeout(timer)}}
async function port(){const s=createServer();await new Promise<void>(r=>s.listen(0,'127.0.0.1',r));const p=(s.address() as {port:number}).port;await new Promise<void>(r=>s.close(()=>r()));return p}
async function start(){
 const p=await port(),env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^RPLAYOUT_/i.test(key)))
 const child=spawn(process.execPath,[join(root,'apps/server/dist/server.cjs')],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...env,RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_DB:file,RPLAYOUT_VAULT_FILE:join(directory,'vault.json'),RPLAYOUT_MEDIA:media,RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_CACHE:join(directory,'cache'),RPLAYOUT_BACKUPS:join(directory,'backups'),RPLAYOUT_ENGINE:'',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_RELAY:'',RPLAYOUT_DEVICES:'',RPLAYOUT_PROBE:binary,RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_BACKUP_HOURS:'0',RPLAYOUT_ROLE:'ADMIN',HOST:'127.0.0.1',PORT:String(p),LOG_LEVEL:'warn'}})
 children.push(child);logs.set(child,'');for(const stream of [child.stdout,child.stderr])stream?.on('data',data=>logs.set(child,((logs.get(child)??'')+String(data)).slice(-15000)))
 const deadline=performance.now()+25000
 while(performance.now()<deadline){if(child.exitCode!==null||child.signalCode!==null)throw new Error('Own server exited '+logs.get(child));try{const response=await fetch(`http://127.0.0.1:${p}/api/health`,{headers:{cookie:'rplayout_session='+token},signal:AbortSignal.timeout(2000)});if(response.ok)return {child,port:p}}catch{}await new Promise(r=>setTimeout(r,100))}throw new Error('Own server not ready')
}
async function stop(child:ChildProcess){if(child.exitCode!==null||child.signalCode!==null)return;const ended=new Promise<void>(r=>child.once('exit',()=>r()));assert.equal(child.kill('SIGKILL'),true);await bounded(ended,10000)}
let result:object|undefined
const observedEvents:any[]=[]
let crashStartedUtc:string|undefined
try{
 const a=await start()
 // Startup deliberately performs a quick scan. Wait for that actual pass,
 // then request a measured scan using its original private review.
 const settleDeadline=performance.now()+30000
 while(db.sqlite.prepare("SELECT 1 FROM ingest_batches WHERE state IN('RUNNING','PENDING')").get()){assert.ok(performance.now()<settleDeadline,'Initial quick scan did not settle');await new Promise(r=>setTimeout(r,100))}
 const baseline=Number((db.sqlite.prepare('SELECT COUNT(*) n FROM ingest_batches').get() as {n:number}).n)
 const originalCatalog=db.sqlite.prepare('SELECT * FROM media_assets WHERE path=?').get(original)
 assert.ok(originalCatalog)
 assert.equal((originalCatalog as {probe_error:string|null}).probe_error,null,'Initial actual probe must decode the fixture before crash proof')
 const reviewResponse=await fetch(`http://127.0.0.1:${a.port}/api/library/scan/review`,{headers:{cookie:'rplayout_session='+token}});assert.equal(reviewResponse.status,200);const review=await reviewResponse.json()
 const observer=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(root,'scripts/observe-own-probe.ps1'),'-ServerPid',String(a.child.pid),'-ProbePath',binary,'-MediaPath',original],{windowsHide:true,stdio:['ignore','pipe','pipe']});children.push(observer)
 const events=observedEvents;let buffer='',errors='';let ready!:()=>void,warmed!:()=>void;const active=new Promise<void>(r=>{ready=r}),warm=new Promise<void>(r=>{warmed=r});observer.stdout!.on('data',data=>{buffer+=String(data);let at:number;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at).trim();buffer=buffer.slice(at+1);if(line){const event=JSON.parse(line);events.push(event);if(event.event==='ACTIVE')ready();if(event.event==='READY')warmed()}}});observer.stderr!.on('data',data=>{errors+=String(data)})
 const done=new Promise<number|null>((resolve,reject)=>{observer.once('error',reject);observer.once('close',resolve)})
 await bounded(warm,10000)
 const queued=await fetch(`http://127.0.0.1:${a.port}/api/library/scan`,{method:'POST',headers:{cookie:'rplayout_session='+token,'content-type':'application/json','if-match':reviewResponse.headers.get('etag')!},body:JSON.stringify({requestId:review.operationId,measure:true})});assert.equal(queued.status,200);const command=await queued.json()
 const batch=db.sqlite.prepare('SELECT id,owner_pid,roots,measure FROM ingest_batches WHERE id=?').get(command.batchId) as {id:string;owner_pid:number;roots:string;measure:number};assert.ok(batch);assert.equal(batch.owner_pid,a.child.pid);assert.equal(batch.measure,1)
 await bounded(Promise.race([active,done.then(()=>{throw new Error('Observer exited before ACTIVE: '+errors)})]),25000)
 crashStartedUtc=new Date().toISOString();const crashAt=performance.now();await stop(a.child);assert.equal(await bounded(done,10000),0,errors)
 const nativeExit=events.find(e=>e.event==='EXIT');assert.ok(nativeExit)
 // An exit code is not a probe JSON result. On Windows an abrupt parent
 // termination may close the owned process tree with code0. Prove the
 // exact handle terminated AFTER the crash and the abandoned batch/catalog
 // were not committed; do not label code0 as successful analysis or EOF1.
 assert.ok(Number.isInteger(nativeExit.exitCode)&&nativeExit.exitCode!==259)
 assert.ok(Date.parse(nativeExit.observedUtc)>=Date.parse(crashStartedUtc!),'Native probe exited before own parent crash; scenario not proved')
 const observed=events.find(e=>e.event==='ACTIVE');assert.equal(observed.parentPid,a.child.pid)
 assert.deepEqual(db.sqlite.prepare('SELECT * FROM media_assets WHERE path=?').get(original),originalCatalog)
 const exitMs=Math.round(performance.now()-crashAt);assert.equal((db.sqlite.prepare('SELECT state FROM ingest_batches WHERE id=?').get(batch.id) as {state:string}).state,'RUNNING')
 const successor=await start(),deadline=performance.now()+180000
 while(performance.now()<deadline){const row=db.sqlite.prepare('SELECT state,error FROM ingest_batches WHERE id=?').get(batch.id) as {state:string;error:string|null};if(row.state==='COMPLETED')break;if(row.state==='FAILED')throw new Error(row.error??'Failed scan');await new Promise(r=>setTimeout(r,100))}
 assert.equal((db.sqlite.prepare('SELECT state,roots,measure FROM ingest_batches WHERE id=?').get(batch.id) as {state:string}).state,'COMPLETED')
 const asset=db.sqlite.prepare('SELECT content_hash,kind,has_audio,probe_error,width,loudness_file FROM media_assets WHERE path=?').get(original) as {content_hash:string;kind:string;has_audio:number;probe_error:string|null;width:number;loudness_file:string|null}
 assert.equal(asset.content_hash,originalHash);assert.equal(asset.kind,'VIDEO');assert.equal(asset.has_audio,1);assert.equal(asset.probe_error,null);assert.equal(asset.width,320);assert.ok(asset.loudness_file)
 assert.equal((db.sqlite.prepare('SELECT COUNT(*) n FROM ingest_batches').get() as {n:number}).n,baseline+1);assert.equal(createHash('sha256').update(await readFile(original)).digest('hex'),originalHash)
 result={result:'PASS',directory,compiledServerSha256:createHash('sha256').update(await readFile(join(root,'apps/server/dist/server.cjs'))).digest('hex'),probeSha256:createHash('sha256').update(await readFile(binary)).digest('hex'),actualScannerBatch:true,initialQuickScanPreserved:true,explicitMeasuredScan:true,exactNativeChildObservedAliveByOsHandle:observed,onlyOwnedServerKilled:true,nativeProbeExitedAfterServerCrash:nativeExit,probeExitAfterCrashMs:exitMs,sameBatchRecoveredBySuccessorActualScan:true,videoAudioLoudnessAndHashPreserved:true,noDuplicateRecoveryBatch:true,browserPgmHardwareValidated:false}
}catch(error){result={result:'FAIL',directory,error:String(error),observedEvents,crashStartedUtc};throw error}
finally{const cleanupErrors:string[]=[];for(const child of children)try{await stop(child)}catch(error){cleanupErrors.push(String(error))}db.sqlite.close();await writeFile(join(directory,'server-logs.json'),JSON.stringify([...logs].map(([child,text])=>({pid:child.pid,text})),null,2));await writeFile(join(directory,'result.json'),JSON.stringify({...result,cleanupErrors},null,2));console.log(JSON.stringify({...result,cleanupErrors}));assert.equal(cleanupErrors.length,0)}
