import assert from 'node:assert/strict'
import {spawn,execFile,type ChildProcess} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises'
import {utimesSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createServer} from 'node:net'
import {fileURLToPath} from 'node:url'
import {randomUUID,createHash} from 'node:crypto'
import {openDatabase} from '../apps/server/src/db/client.js'
import {sessionDigest} from '../apps/server/src/domain/access.js'
import {scanETag} from '../packages/protocol/src/scan-review.js'
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(tmpdir(),'RPlayout-scan-command-'))
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json')
const file=join(directory,'qa.db'),db=openDatabase(file),media=join(directory,'media');await mkdir(media)
const original=join(media,'AÇÃO Çãó.mkv'),gstRoot=process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64??'C:/Program Files/gstreamer/1.0/msvc_x86_64'
const gstBin=join(gstRoot,'bin'),gstEnv={...process.env,PATH:gstBin+';'+process.env.PATH,GST_PLUGIN_PATH:join(gstRoot,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gstRoot,'lib/gstreamer-1.0'),GST_PLUGIN_SCANNER:join(gstRoot,'libexec/gstreamer-1.0/gst-plugin-scanner.exe'),GST_REGISTRY:join(directory,'registry.bin')}
await promisify(execFile)(join(gstBin,'gst-launch-1.0.exe'),['-q','matroskamux','name=m','!','filesink',`location=${original.replaceAll('\\','/')}`,'videotestsrc','num-buffers=50','pattern=ball','!','video/x-raw,width=320,height=180,framerate=25/1','!','videoconvert','!','vp8enc','deadline=1','threads=2','!','queue','!','m.','audiotestsrc','num-buffers=94','samplesperbuffer=1024','volume=0.05','!','audio/x-raw,rate=48000,channels=2','!','audioconvert','!','vorbisenc','!','queue','!','m.'],{env:gstEnv,windowsHide:true,timeout:30000})
const originalHash=createHash('sha256').update(await readFile(original)).digest('hex'),token=randomUUID()+randomUUID()
db.sqlite.exec("INSERT INTO users VALUES('u','Admin','NO_LOGIN','ADMIN',1,'now')")
db.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest(token),'u','2099-01-01','now')

const headers={cookie:'rplayout_session='+token},children:ChildProcess[]=[],logs=new Map<ChildProcess,string>()
async function port(){const socket=createServer();await new Promise<void>(resolve=>socket.listen(0,'127.0.0.1',resolve));const value=(socket.address() as {port:number}).port;await new Promise<void>(resolve=>socket.close(()=>resolve()));return value}
async function call(p:number,url:string,method='GET',body?:object,etag?:string,status=200){
  const response=await fetch(`http://127.0.0.1:${p}${url}`,{method,headers:{...headers,...(body?{'content-type':'application/json'}:{}),...(etag?{'if-match':etag}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)})
  const value=await response.json();if(status)assert.equal(response.status,status,JSON.stringify(value));return {status:response.status,value,etag:response.headers.get('etag'),cache:response.headers.get('cache-control')}
}
async function start(){
  const p=await port(),env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^RPLAYOUT_/i.test(key)))
  const child=spawn(process.execPath,[join(root,'apps/server/dist/server.cjs')],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...env,RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_DB:file,RPLAYOUT_VAULT_FILE:join(directory,'vault.json'),RPLAYOUT_MEDIA:media,RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_CACHE:join(directory,'cache'),RPLAYOUT_BACKUPS:join(directory,'backups'),RPLAYOUT_ENGINE:'',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_RELAY:'',RPLAYOUT_DEVICES:'',RPLAYOUT_PROBE:join(root,'apps/engine/target/release/rplayout-probe.exe'),RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_BACKUP_HOURS:'0',RPLAYOUT_ROLE:'ADMIN',HOST:'127.0.0.1',PORT:String(p),LOG_LEVEL:'warn'}})
  children.push(child);logs.set(child,'');child.on('error',error=>logs.set(child,(logs.get(child)??'')+String(error)))
  for(const stream of [child.stdout,child.stderr])stream?.on('data',data=>logs.set(child,((logs.get(child)??'')+String(data)).slice(-10000)))
  const deadline=performance.now()+25000
  while(performance.now()<deadline){if(child.exitCode!==null||child.signalCode!==null)throw new Error('Own server exited '+logs.get(child));try{if((await call(p,'/api/health')).value.ok)return {child,port:p}}catch{}await new Promise(resolve=>setTimeout(resolve,100))}
  throw new Error('Own server not ready '+logs.get(child))
}
async function stop(child:ChildProcess){
  if(child.exitCode!==null||child.signalCode!==null)return
  const ended=new Promise<void>(resolve=>child.once('exit',()=>resolve()));assert.equal(child.kill('SIGKILL'),true)
  let timer:ReturnType<typeof setTimeout>|undefined
  try{await Promise.race([ended,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Own server did not exit')),10000)})])}finally{if(timer)clearTimeout(timer)}
}


async function settled(){const deadline=performance.now()+30000;while(performance.now()<deadline){if(!(db.sqlite.prepare("SELECT 1 FROM ingest_batches WHERE state IN('RUNNING','PENDING') LIMIT 1").get()))return;await new Promise(resolve=>setTimeout(resolve,100))}throw new Error('Own scanner did not settle')}
const count=()=>Number((db.sqlite.prepare('SELECT COUNT(*) n FROM ingest_batches').get() as {n:number}).n)
let result:object|undefined
try{
  const a=await start(),b=await start();await settled()
  const before=count(),review=await call(a.port,'/api/library/scan/review')
  assert.equal(review.cache,'private, no-store');assert.equal(review.value.canStart,true);assert.equal(count(),before)
  const body={requestId:review.value.operationId,measure:false,root:media}
  await call(a.port,'/api/library/scan','POST',body,undefined,428)
  const replies=await Promise.all([a,b].map(server=>call(server.port,'/api/library/scan','POST',body,review.etag!)))
  assert.equal(replies[0].value.batchId,replies[1].value.batchId);assert.deepEqual(replies.map(row=>row.value.deduplicated).sort(),[false,true])
  assert.equal(count(),before+1)
  assert.equal((db.sqlite.prepare("SELECT COUNT(*) n FROM operator_decisions WHERE kind='MEDIA_SCAN_QUEUED'").get() as {n:number}).n,1)
  const id=replies[0].value.batchId
  await call(a.port,'/api/library/scan','POST',{...body,requestId:randomUUID()},review.etag!,409)
  await settled();const repeated=await call(b.port,'/api/library/scan','POST',body,review.etag!);assert.equal(repeated.value.batchId,id);assert.equal(repeated.value.state,'COMPLETED');assert.equal(count(),before+1)
  const fresh=await call(a.port,'/api/library/scan/review'),counter=fresh.value.batchRevision
  db.sqlite.exec("CREATE TRIGGER scan_audit_failure BEFORE INSERT ON operator_decisions WHEN NEW.kind='MEDIA_SCAN_QUEUED' BEGIN SELECT RAISE(ABORT,'AUDIT_FAILED');END")
  await call(a.port,'/api/library/scan','POST',{requestId:fresh.value.operationId,measure:false},fresh.etag!,409)
  assert.equal(count(),before+1);assert.equal((await call(b.port,'/api/library/scan/review')).value.batchRevision,counter)
  db.sqlite.exec('DROP TRIGGER scan_audit_failure')
  assert.equal(createHash('sha256').update(await readFile(original)).digest('hex'),originalHash)
  const asset=db.sqlite.prepare('SELECT content_hash,has_audio,probe_error FROM media_assets WHERE path=?').get(original) as {content_hash:string;has_audio:number;probe_error:string|null}
  assert.equal(asset.content_hash,originalHash);assert.equal(asset.has_audio,1);assert.equal(asset.probe_error,null)
  await stop(a.child);await stop(b.child);const restarted=await start();await settled()
  const replay=await call(restarted.port,'/api/library/scan','POST',body,review.etag!);assert.equal(replay.value.batchId,id);assert.equal(replay.value.deduplicated,true)
  db.sqlite.exec('DELETE FROM sessions');await call(restarted.port,'/api/library/scan','POST',body,review.etag!,401)
  result={result:'PASS',directory,compiledServerSha256:createHash('sha256').update(await readFile(join(root,'apps/server/dist/server.cjs'))).digest('hex'),probeSha256:createHash('sha256').update(await readFile(join(root,'apps/engine/target/release/rplayout-probe.exe'))).digest('hex'),readOnlyPrivateOriginalReview:true,twoCompiledServersSameCommandOneBatchOneAudit:true,staleProofRefused:true,auditFailureRollsBackBatchAndRevision:true,dedupReportsActualCompletedState:true,originalCommandSurvivesRestart:true,revokedSessionRefusesReplay:true,realScannerProbeVideoAudioCatalogAndOriginalHash:true,browserPgmHardwareValidated:false}
}catch(error){result={result:'FAIL',directory,error:String(error)};throw error}
finally{
  const cleanupErrors:string[]=[];for(const child of children)try{await stop(child)}catch(error){cleanupErrors.push(String(error))}
  db.sqlite.close();await writeFile(join(directory,'server-logs.json'),JSON.stringify([...logs].map(([child,text])=>({pid:child.pid,text})),null,2))
  await writeFile(join(directory,'result.json'),JSON.stringify({...result,cleanupErrors},null,2));console.log(JSON.stringify({...result,cleanupErrors}));assert.equal(cleanupErrors.length,0)
}
