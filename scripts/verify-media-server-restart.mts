import assert from 'node:assert/strict'
import {spawn,execFile,type ChildProcess} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,mkdir,readFile,writeFile,readdir,utimes} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createServer} from 'node:net'
import {fileURLToPath} from 'node:url'
import {createHash,randomUUID} from 'node:crypto'
import {openDatabase} from '../apps/server/src/db/client.js'
import {sessionDigest} from '../apps/server/src/domain/access.js'

// Real compiled servers and native media, only within this verifier's fixture.
// It seeds a catalog/version and PENDING jobs, not scanner/QC/PGM evidence.
const root=fileURLToPath(new URL('..',import.meta.url))
const directory=await mkdtemp(join(tmpdir(),'RPlayout-media-server-restart-'))
const media=join(directory,'media'),file=join(directory,'qa.db')
await mkdir(media)
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json')
const gst=process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64??'C:/Program Files/gstreamer/1.0/msvc_x86_64'
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^RPLAYOUT_|^GST_/i.test(key)))
Object.assign(env,{PATH:join(gst,'bin')+';'+process.env.PATH,GST_REGISTRY:join(directory,'registry.bin'),GST_PLUGIN_PATH:join(gst,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gst,'lib/gstreamer-1.0'),GST_PLUGIN_SCANNER:join(gst,'libexec/gstreamer-1.0/gst-plugin-scanner.exe')})
const source=join(media,'AÇÃO Çãó.mkv'),run=promisify(execFile)
const serverHash=createHash('sha256').update(await readFile(join(root,'apps/server/dist/server.cjs'))).digest('hex')
const observations:object[]=[],children:ChildProcess[]=[],logs=new Map<ChildProcess,string>()
const archiveId=randomUUID(),proxyId=randomUUID()
const mark=(event:string,details:object={})=>observations.push({event,at:new Date().toISOString(),...details})
let database:ReturnType<typeof openDatabase>|undefined
let monitor:ChildProcess|undefined,monitorOutput=''
let evidence:object|undefined
const delay=()=>new Promise(resolve=>setTimeout(resolve,50))
async function until<T>(check:()=>T|Promise<T>,description:string,ms=30000):Promise<NonNullable<T>>{
  const deadline=performance.now()+ms
  while(performance.now()<deadline){const value=await check();if(value)return value as NonNullable<T>;await delay()}
  throw new Error('Timeout: '+description)
}
async function port(){const socket=createServer();await new Promise<void>(resolve=>socket.listen(0,'127.0.0.1',resolve));const number=(socket.address() as {port:number}).port;await new Promise<void>(resolve=>socket.close(()=>resolve()));return number}
async function stop(child:ChildProcess){
  if(child.exitCode!==null||child.signalCode!==null)return
  const ended=new Promise<void>(resolve=>child.once('exit',()=>resolve()))
  assert.equal(child.kill('SIGKILL'),true)
  let timer:ReturnType<typeof setTimeout>|undefined
  try{await Promise.race([ended,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Owned child failed to exit')),10000)})])}finally{if(timer)clearTimeout(timer)}
}
try{
  await run(join(gst,'bin/gst-launch-1.0.exe'),['-q','videotestsrc','num-buffers=3000','!','video/x-raw,width=640,height=360,framerate=25/1','!','vp8enc','deadline=1','!','queue','!','m.video_0','audiotestsrc','num-buffers=5625','!','audio/x-raw,rate=48000,channels=2','!','audioconvert','!','vorbisenc','!','queue','!','m.audio_0','matroskamux','name=m','!','filesink',`location=${source.replaceAll('\\','/')}`],{env,windowsHide:true,timeout:60000})
  const hash=createHash('sha256').update(await readFile(source)).digest('hex'),now=new Date().toISOString(),token=randomUUID()+randomUUID(),headers={cookie:'rplayout_session='+token}
  database=openDatabase(file)
  database.sqlite.exec("INSERT INTO users VALUES('admin','Admin','NO_LOGIN','ADMIN',1,'now')")
  database.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest(token),'admin','2099-01-01',now)
  database.sqlite.prepare("INSERT INTO media_assets(id,content_hash,path,title,kind,duration_frames,created_at) VALUES('a',?,?,'AÇÃO Çãó','VIDEO',3000,?)").run(hash,source,now)
  database.sqlite.prepare("INSERT INTO media_versions(id,asset_id,revision,content_hash,metadata,created_at) VALUES('version','a',1,?,?,?)").run(hash,JSON.stringify({kind:'VIDEO',path:source,contentHash:hash}),now)
  for(const kind of ['ARCHIVE','PROXY'])database.sqlite.prepare("INSERT INTO media_jobs(id,version_id,kind,state,created_at,updated_at) VALUES(?,'version',?,'PENDING',?,?)").run(kind==='ARCHIVE'?archiveId:proxyId,kind,now,now)
  const row=()=>database!.sqlite.prepare('SELECT id,state,attempts,owner_host,owner_pid,owner_boot,output_path,output_hash FROM media_jobs WHERE id=?').get(proxyId) as any
  async function call(p:number,path:string){const response=await fetch(`http://127.0.0.1:${p}${path}`,{headers,signal:AbortSignal.timeout(5000)});assert.equal(response.status,200,await response.clone().text());return response}
  async function start(){
    const p=await port()
    const child=spawn(process.execPath,[join(root,'apps/server/dist/server.cjs')],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...env,RPLAYOUT_DB:file,RPLAYOUT_VAULT_FILE:join(directory,'vault.json'),RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_MEDIA:media,RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_CACHE:join(directory,'cache'),RPLAYOUT_BACKUPS:join(directory,'backups'),RPLAYOUT_ENGINE:'',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_RELAY:'',RPLAYOUT_DEVICES:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:join(root,'apps/engine/target/release/rplayout-proxy.exe'),RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_BACKUP_HOURS:'0',RPLAYOUT_ROLE:'ADMIN',HOST:'127.0.0.1',PORT:String(p),LOG_LEVEL:'warn'}})
    children.push(child);logs.set(child,'');mark('SERVER_STARTED',{pid:child.pid,port:p})
    child.on('error',error=>logs.set(child,(logs.get(child)??'')+String(error)))
    for(const stream of [child.stdout,child.stderr])stream?.on('data',data=>logs.set(child,((logs.get(child)??'')+String(data)).slice(-20000)))
    await until(async()=>{if(child.exitCode!==null||child.signalCode!==null)throw new Error('Server exited '+logs.get(child));try{return(await(await call(p,'/api/health')).json()).ok}catch{return false}},'compiled server health')
    return {child,port:p}
  }
  // Pin a live native child of this exact server, never kill a historical PID.
  const command=`Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class NativeExit { [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetExitCodeProcess(IntPtr handle,out uint code); }'; $null=Get-CimInstance Win32_Process -Filter 'ProcessId=0'; [Console]::WriteLine('MONITOR_READY'); [Console]::Out.Flush(); $taskOwner=[int][Console]::ReadLine(); $taskUntil=[DateTime]::UtcNow.AddSeconds(30); $taskNative=$null; while([DateTime]::UtcNow -lt $taskUntil){ $taskNative=Get-CimInstance Win32_Process -Filter ('ParentProcessId='+$taskOwner) | Where-Object {$_.Name -eq 'rplayout-proxy.exe'} | Select-Object -First 1; if($taskNative){break}; Start-Sleep -Milliseconds 50 }; if(!$taskNative){throw 'No proxy child'}; $taskProcess=Get-Process -Id $taskNative.ProcessId -ErrorAction Stop; $taskHandle=$taskProcess.Handle; [uint32]$taskCode=0; if(![NativeExit]::GetExitCodeProcess($taskHandle,[ref]$taskCode) -or $taskCode -ne 259){throw 'Native child was not live'}; [Console]::WriteLine('PINNED:'+ $taskNative.ProcessId); [Console]::Out.Flush(); $null=[Console]::ReadLine(); if(!$taskProcess.WaitForExit(15000)){throw 'Native child did not exit'}; if(![NativeExit]::GetExitCodeProcess($taskHandle,[ref]$taskCode) -or $taskCode -eq 259){throw 'No kernel exit proof'}; [Console]::WriteLine('EXIT_KERNEL:'+ $taskCode); [Console]::Out.Flush()`
  monitor=spawn('powershell.exe',['-NoProfile','-Command',command],{windowsHide:true,stdio:['pipe','pipe','pipe']});children.push(monitor)
  for(const stream of [monitor.stdout,monitor.stderr])stream?.on('data',data=>{monitorOutput+=String(data);mark('MONITOR_OUTPUT',{text:String(data)})})
  await until(()=>monitorOutput.includes('MONITOR_READY'),'monitor readiness')
  const first=await start();monitor.stdin!.write(first.child.pid+'\n')
  await until(()=>monitorOutput.includes('PINNED:'),'live pinned proxy')
  const before=row();assert.equal(before.state,'RUNNING');assert.equal(before.attempts,1);assert.equal(before.owner_pid,first.child.pid);assert.match(before.owner_host,/^[a-f0-9]{64}$/)
  const second=await start()
  assert.deepEqual(row(),before,'Second compiled server must not steal a live job')
  mark('LIVE_OWNER_PRESERVED',{before,secondPid:second.child.pid})
  await stop(first.child);mark('SERVER_CRASH',{pid:first.child.pid})
  monitor.stdin!.end('OBSERVE\n')
  await until(()=>monitorOutput.includes('EXIT_KERNEL:'),'native kernel exit',15000)
  const afterCrash=row();assert.equal(afterCrash.output_hash,null)
  // The surviving server's periodic tick, not a manual retry/startup, recovers.
  const ready=await until(()=>{const value=row();if(value.state==='FAILED')throw new Error('Proxy failed '+JSON.stringify(value));return value.state==='READY'?value:false},'surviving compiled server recovery',60000)
  assert.equal(ready.id,before.id);assert.equal(ready.attempts,2);assert.equal(ready.owner_pid,second.child.pid)
  const archive=database.sqlite.prepare("SELECT output_path FROM media_jobs WHERE id=? AND state='READY'").get(archiveId) as {output_path:string}
  assert.equal(createHash('sha256').update(await readFile(archive.output_path)).digest('hex'),hash)
  const workflow=await(await call(second.port,'/api/assets/a/workflow?hash='+hash)).json()
  assert.equal(workflow.previewReady,true);assert.ok(workflow.previewUrl)
  const bytes=Buffer.from(await(await call(second.port,workflow.previewUrl)).arrayBuffer())
  assert.equal(createHash('sha256').update(bytes).digest('hex'),ready.output_hash)
  const probe=JSON.parse((await run(join(root,'apps/engine/target/release/rplayout-probe.exe'),[ready.output_path,'--no-loudness'],{env,windowsHide:true,timeout:30000})).stdout.trim().split('\n').at(-1)!)
  assert.equal(probe.ok,true);assert.ok(probe.decodedVideoBuffers>0&&probe.decodedAudioBuffers>0)
  await stop(second.child)
  const versions=join(directory,'versions'),orphanNames=(await readdir(versions)).filter(name=>name.endsWith('.part')&&name.includes('.'+proxyId+'.'))
  assert.ok(orphanNames.length>0,'Crash fixture must leave a real predecessor temporary')
  const old=new Date(Date.now()-25*60*60_000)
  for(const name of orphanNames)await utimes(join(versions,name),old,old)
  const unknown=join(versions,'unknown.part');await writeFile(unknown,'preserve unknown');await utimes(unknown,old,old)
  const restarted=await start(),persisted=row()
  await until(async()=>{for(const name of orphanNames){try{await readFile(join(versions,name));return false}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}}return true},'compiled startup removes aged real orphan attempts')
  assert.equal(await readFile(unknown,'utf8'),'preserve unknown')
  assert.equal(createHash('sha256').update(await readFile(source)).digest('hex'),hash)
  assert.equal(createHash('sha256').update(await readFile(archive.output_path)).digest('hex'),hash)
  assert.equal(createHash('sha256').update(await readFile(ready.output_path)).digest('hex'),ready.output_hash)
  assert.equal(persisted.state,'READY');assert.equal(persisted.attempts,2);assert.equal(persisted.output_hash,ready.output_hash)
  assert.equal((await(await call(restarted.port,'/api/assets/a/workflow?hash='+hash)).json()).previewReady,true)
  const cleanup=(await(await call(restarted.port,'/api/media/jobs')).json()).worker.cleanup
  assert.ok(cleanup.removed>=orphanNames.length)
  evidence={result:'PASS',directory,serverHash,hash,before,afterCrash,ready,probe,monitorOutput,observations,cleanup,removedRealOrphans:orphanNames,unknownOriginalArchiveAndProxyPreserved:true,compiledServerCrashValidated:true,survivingServerPeriodicRecovery:true,apiPreviewBytesVerified:true,scannerQcPgmValidated:false,physicalInputsValidated:false}
}catch(error){evidence={result:'FAIL',directory,serverHash,error:String(error),monitorOutput,observations};throw error}
finally{
  const cleanupErrors:string[]=[]
  for(const child of children)try{await stop(child)}catch(error){cleanupErrors.push(String(error))}
  database?.sqlite.close()
  await writeFile(join(directory,'server-logs.json'),JSON.stringify([...logs].map(([child,text])=>({pid:child.pid,text})),null,2))
  await writeFile(join(directory,'result.json'),JSON.stringify({...evidence,cleanupErrors},null,2))
  console.log(JSON.stringify({...evidence,cleanupErrors}))
  assert.equal(cleanupErrors.length,0,'Owned child cleanup failed')
}
