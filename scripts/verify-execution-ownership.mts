import assert from 'node:assert/strict'
import {spawn,execFile,type ChildProcess} from 'node:child_process'
import {promisify} from 'node:util'
import {createServer} from 'node:net'
import {mkdtemp,mkdir,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'

// Real compiled backends and native decoder, only own fixtures/loopback/null.
// No physical device, network publisher, second host, release or HA promotion.
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(tmpdir(),'RPlayout-execution-ownership-')),file=join(directory,'fixture.db'),media=join(directory,'media'),physical=join(media,'EXIBIÇÃO-ÇÃO.mp4'),vault=join(directory,'vault.json')
await mkdir(media)
process.env.RPLAYOUT_VAULT_FILE=vault
const [{openDatabase},{readExecutionOwner},{validateBackupRestore}]=await Promise.all([import('../apps/server/src/db/client.js'),import('../apps/server/src/db/execution-ownership.js'),import('../apps/server/src/domain/backup.js')])
const gstRoot=process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64??'C:/Program Files/gstreamer/1.0/msvc_x86_64',gstBin=join(gstRoot,'bin'),engine=join(root,'apps/engine/target/release/rplayout-engine.exe')
const env={...process.env,PATH:gstBin+';'+process.env.PATH,GST_PLUGIN_PATH:join(gstRoot,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gstRoot,'lib/gstreamer-1.0'),GST_PLUGIN_SCANNER:join(gstRoot,'libexec/gstreamer-1.0/gst-plugin-scanner.exe'),GST_REGISTRY:join(directory,'registry.bin')}
await promisify(execFile)(join(gstBin,'gst-launch-1.0.exe'),['-q','videotestsrc','num-buffers=3000','!','video/x-raw,width=320,height=180,framerate=25/1','!','videoconvert','!','x264enc','speed-preset=ultrafast','!','h264parse','!','mp4mux','!','filesink',`location=${physical.replaceAll('\\','/')}`],{windowsHide:true,timeout:45_000,env})
const db=openDatabase(file),now=new Date().toISOString(),bytes=await readFile(physical),hash=createHash('sha256').update(bytes).digest('hex')
db.sqlite.prepare('INSERT INTO channels(id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES(?,?,25,1,320,180,-23,-1,5,?)').run('ch','Fixture native null',now)
db.sqlite.prepare('INSERT INTO rundowns(id,channel_id,name,date,planned_start,loop,created_at,updated_at) VALUES(?,?,?,?,0,1,?,?)').run('rd','ch','Fixture','2026-10-06',now,now)
db.sqlite.prepare('INSERT INTO media_assets(id,content_hash,path,title,kind,duration_frames,duration_ns,width,height,rate_num,rate_den,interlace_mode,has_audio,qc_status,created_at) VALUES(?,?,?,?,?,3000,120000000000,320,180,25,1,?,0,?,?)').run('asset',hash,physical,'EXIBIÇÃO','VIDEO','progressive','APPROVED',now)
db.sqlite.prepare('INSERT INTO rundown_items(id,rundown_id,sort_order,title,type,media_id,anchor,on_overrun,min_duration,auto_next,loop,locked) VALUES(?,?,0,?,?,?,?,?,0,0,0,0)').run('vt','rd','Fixture native VT','VT','asset',JSON.stringify({kind:'FLOW'}),'PUSH')
interface Station {port:number;child:ChildProcess|null;pids:number[];logs:string}
const stations:Station[]=[],ownedEnginePids=new Set<number>()
const alive=(pid:number)=>{try{process.kill(pid,0);return true}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return false;throw error}}
async function wait(message:string,predicate:()=>boolean|Promise<boolean>,timeout=25000){const end=performance.now()+timeout;while(performance.now()<end){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,100))}throw new Error(message+'; '+stations.map(station=>station.logs.slice(-1200)).join('\n'))}
for(let index=0;index<2;index++){const listener=createServer();await new Promise<void>(resolve=>listener.listen(0,'127.0.0.1',resolve));const port=(listener.address() as {port:number}).port;await new Promise<void>(resolve=>listener.close(()=>resolve()));stations.push({port,child:null,pids:[],logs:''})}
async function call(station:Station,url:string,method='GET',body?:object,status=200){
  const response=await fetch(`http://127.0.0.1:${station.port}${url}`,{method,headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)}),text=await response.text()
  assert.equal(response.status,status,`${method} ${url}: ${response.status} ${text.slice(0,200)}`);return {value:JSON.parse(text),cache:response.headers.get('cache-control')}
}
async function start(station:Station){
  const child=spawn(process.execPath,[join(root,'apps/server/dist/server.cjs')],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...env,RPLAYOUT_DB:file,RPLAYOUT_VAULT_FILE:vault,RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_MEDIA:media,RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_CACHE:join(directory,'cache'),RPLAYOUT_BACKUPS:join(directory,'backups'),RPLAYOUT_ENGINE:engine,RPLAYOUT_ENGINE_OUTPUT:'null',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_DEVICES:'',RPLAYOUT_RELAY:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_N1_PEER:'',RPLAYOUT_BACKUP_HOURS:'0',RPLAYOUT_HA_ROLE:'',RPLAYOUT_HA_PEER:'',RPLAYOUT_ADMIN_USER:'',RPLAYOUT_ADMIN_PASSWORD:'',RPLAYOUT_ROLE:'ADMIN',RPLAYOUT_CONTROL_TOKEN:'',HOST:'127.0.0.1',PORT:String(station.port),LOG_LEVEL:'warn'}})
  station.child=child;if(child.pid)station.pids.push(child.pid);for(const stream of[child.stdout,child.stderr])stream?.on('data',data=>station.logs=(station.logs+String(data)).slice(-8000));child.on('error',error=>station.logs+=error.message)
  await wait('Own compiled backend did not start',async()=>{if(child.exitCode!==null)throw new Error(station.logs.slice(-2000));try{return(await call(station,'/api/health')).value.ok}catch{return false}})
}
async function stop(station:Station){const child=station.child;station.child=null;if(child&&child.exitCode===null&&child.signalCode===null){const ended=new Promise<void>(resolve=>child.once('exit',()=>resolve()));child.kill('SIGKILL');await ended}}
function rememberOwnEngine(station:Station){const owner=readExecutionOwner(db.sqlite,'ch')!;assert.equal(owner.pid,station.child!.pid);assert.equal(owner.enginePids.length,1);for(const pid of owner.enginePids){assert.notEqual(pid,process.pid);assert.ok(!stations.flatMap(row=>row.pids).includes(pid));ownedEnginePids.add(pid)}return owner}
const checkpoint=()=>{const row=db.sqlite.prepare("SELECT payload FROM channel_checkpoints WHERE channel_id='ch'").get() as {payload:string}|undefined;return row?JSON.parse(row.payload):null}
let evidence:Record<string,unknown>|null=null
try{
  const [a,b]=stations as[Station,Station];await start(a);const first=rememberOwnEngine(a)
  await call(a,'/api/channels/ch/transport','POST',{action:'take',itemId:'vt'})
  await wait('Native decoded PGM did not advance',()=>checkpoint()?.playing&&checkpoint()?.elapsed>=25)
  const sourceCursor=checkpoint();assert.equal(sourceCursor.ownerRunId,first.id)
  await start(b);const before=readExecutionOwner(db.sqlite,'ch')!,response=await call(b,'/api/channels/ch/execution-ownership');assert.equal(response.cache,'private, no-store');assert.equal(response.value.blocked,true);assert.equal(response.value.ownedHere,false)
  for(const secret of[first.id,first.boot,'signature','enginePids','engineTokens'])assert.ok(!JSON.stringify(response.value).includes(secret))
  for(const action of['cue','take','stop'])assert.equal((await call(b,'/api/channels/ch/transport','POST',{action,itemId:'vt'},409)).value.executionOwnershipBlocked,true)
  assert.equal(readExecutionOwner(db.sqlite,'ch')!.id,before.id);assert.deepEqual(readExecutionOwner(db.sqlite,'ch')!.enginePids,before.enginePids)
  assert.equal(checkpoint().ownerRunId,first.id);assert.equal(checkpoint().playing,true)
  const backup=join(directory,'validated.db');await db.sqlite.backup(backup);assert.equal((await validateBackupRestore(backup)).integrity,'ok')
  // Only terminate processes from this verifier's own signed DB/parent chain.
  await stop(a);const cursorAfterCrash=checkpoint();assert.equal(cursorAfterCrash.ownerRunId,first.id)
  const engineSurvivedParent=first.enginePids.some(alive)
  if(engineSurvivedParent){assert.equal((await call(b,'/api/channels/ch/execution-ownership')).value.blocked,true);await call(b,'/api/channels/ch/transport','POST',{action:'take',itemId:'vt'},409)}
  for(const pid of first.enginePids)if(alive(pid))process.kill(pid,'SIGKILL')
  await wait('Own predecessor engine did not exit',()=>first.enginePids.every(pid=>!alive(pid)),10000)
  await stop(b);await start(b);const second=rememberOwnEngine(b);assert.notEqual(second.id,first.id);assert.equal(second.sequence,2);assert.equal(second.recoveredRunId,first.id)
  await wait('Native cursor was not recovered by verified successor',()=>{const cursor=checkpoint();return cursor?.ownerRunId===second.id&&cursor?.playing&&cursor?.itemId==='vt'&&cursor?.elapsed>=cursorAfterCrash.elapsed})
  const log=db.sqlite.prepare('SELECT execution_kind,ended_by FROM as_run ORDER BY rowid').all() as {execution_kind:string;ended_by:string|null}[]
  assert.equal(log.length,2);assert.equal(log[0]!.ended_by,'RESTART');assert.equal(log[1]!.ended_by,null);assert.ok(log.every(row=>row.execution_kind==='NATIVE'))
  assert.deepEqual(await readFile(physical),bytes)
  evidence={result:'PASS',evidence:'COMPILED_NATIVE_LOCAL_EXECUTION_OWNERSHIP',directory,ports:stations.map(row=>row.port),serverPids:stations.flatMap(row=>row.pids),enginePids:[...ownedEnginePids],serverSha256:createHash('sha256').update(await readFile(join(root,'apps/server/dist/server.cjs'))).digest('hex'),engineSha256:createHash('sha256').update(await readFile(engine)).digest('hex'),blockedConcurrentNativeEngine:true,foreignCueTakeStopRejected:true,privateReadOnlyStatus:true,engineSurvivedParent,verifiedPredecessorDeath:true,cursorOwnerAndPositionPreserved:true,asRunExactPredecessorOnly:true,backupValidated:true,physicalFixtureBytesPreserved:true,nativeMediaDecoded:true,outputs:'NULL_FAKESINK',physicalOutputValidated:false,otherHostValidated:false,mediaMtxRelaysFenced:false,promotionReady:false,browserValidated:false}
}finally{
  for(const station of stations)await stop(station)
  for(const pid of ownedEnginePids)if(alive(pid))process.kill(pid,'SIGKILL')
  await wait('Own native children not closed',()=>[...ownedEnginePids].every(pid=>!alive(pid)),10000);db.sqlite.close()
  for(const station of stations)await assert.rejects(()=>fetch(`http://127.0.0.1:${station.port}/api/health`,{signal:AbortSignal.timeout(1000)}))
  console.log(JSON.stringify({cleanup:'OWN_CHILDREN_AND_LISTENERS_CLOSED',directory,serverPids:stations.flatMap(row=>row.pids),enginePids:[...ownedEnginePids]}))
}
if(evidence)console.log(JSON.stringify({...evidence,ownChildrenAndListenersClosed:true}))
