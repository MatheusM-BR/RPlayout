import assert from 'node:assert/strict'
import {spawn,execFile,type ChildProcess} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {createServer} from 'node:net'
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(tmpdir(),'RPlayout-schedule-publication-'))
const gstRoot=process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64??'C:/Program Files/gstreamer/1.0/msvc_x86_64',gstBin=join(gstRoot,'bin')
const environment={...process.env,PATH:gstBin+';'+process.env.PATH,GST_PLUGIN_PATH:join(gstRoot,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gstRoot,'lib/gstreamer-1.0'),GST_PLUGIN_SCANNER:join(gstRoot,'libexec/gstreamer-1.0/gst-plugin-scanner.exe'),GST_REGISTRY:join(directory,'gst-registry.bin')}
const file=process.env.RPLAYOUT_QA_SCHEDULE_FILE??join(directory,'Aprovação-1h-ação.mp4')
console.log(JSON.stringify({phase:process.env.RPLAYOUT_QA_SCHEDULE_FILE?'VERIFYING_EXISTING_ONE_HOUR_FILE':'GENERATING_REAL_ONE_HOUR_FILE',directory}))
if(!process.env.RPLAYOUT_QA_SCHEDULE_FILE)await promisify(execFile)(join(gstBin,'gst-launch-1.0.exe'),['-q','videotestsrc','pattern=black','num-buffers=90000','!','video/x-raw,width=160,height=90,framerate=25/1','!','videoconvert','!','x264enc','threads=2','speed-preset=ultrafast','!','h264parse','!','mp4mux','!','filesink',`location=${file.replaceAll('\\','/')}`],{timeout:120_000,windowsHide:true,env:environment})
// Verify actual indexed duration/decoded raster without decoding a full hour.
const probe=JSON.parse((await promisify(execFile)(join(root,'apps/engine/target/release/rplayout-probe.exe'),[file,'--no-loudness','--fita','1','--thumbnail',join(directory,'verified')],{timeout:45_000,windowsHide:true,env:environment})).stdout)
assert.equal(probe.ok,true);assert.equal(probe.video.rateNum,25);assert.equal(probe.video.rateDen,1)
assert.equal(probe.durationNs,3600_000_000_000,JSON.stringify(probe))
const hash=createHash('sha256').update(await readFile(file)).digest('hex'),stamp=new Date().toISOString()
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json')
const {openDatabase}=await import('../apps/server/src/db/client.js'),{channels,mediaAssets,rundowns,rundownItems,scheduleRules}=await import('../apps/server/src/db/schema.js')
const {db,sqlite}=openDatabase(join(directory,'schedule.db'))
db.insert(channels).values({id:'ch',name:'Autorização editorial',rateNum:25,rateDen:1,width:160,height:90,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:stamp}).run()
const today=new Date(),date=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`
db.insert(rundowns).values({id:'source',channelId:'ch',name:'Grade manual',date,plannedStart:0,loop:false,createdAt:stamp,updatedAt:stamp}).run()
db.insert(mediaAssets).values({id:'asset',title:'Arquivo real de uma hora',path:file,contentHash:hash,kind:'VIDEO',durationFrames:90000,durationNs:probe.durationNs,rateNum:25,rateDen:1,width:160,height:90,hasAudio:false,qcStatus:'APPROVED',createdAt:stamp}).run()
db.insert(rundownItems).values({id:'manual-item',rundownId:'source',sortOrder:10,type:'VT',mediaId:'asset',title:'Arquivo manual preservado',anchor:{kind:'FLOW'},onOverrun:'PUSH',locked:false,autoNext:true,loop:false,minDuration:0}).run()
db.insert(scheduleRules).values({id:'rule',channelId:'ch',name:'Dia completo autorizado',weekdays:'0123456',startMinute:0,endMinute:1440,categories:[],avoidHours:0,createdAt:stamp}).run()
const socket=createServer();await new Promise<void>(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=(socket.address() as {port:number}).port
await new Promise<void>(resolve=>socket.close(()=>resolve()))
let server:ChildProcess|null=null,logs='';const pids:number[]=[]
const pause=()=>new Promise(resolve=>setTimeout(resolve,200))
async function wait(check:()=>Promise<boolean>|boolean,timeout=45_000){const deadline=performance.now()+timeout
  while(!await check()){assert.equal(server?.exitCode??null,null,logs);assert.ok(performance.now()<deadline,logs||'Condição não atingida.');await pause()}}
const get=async(path:string,body?:unknown)=>{const response=await fetch(`http://127.0.0.1:${port}${path}`,{method:body===undefined?'GET':'POST',headers:body===undefined?undefined:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});return {status:response.status,body:await response.json() as any}}
async function start(){
  server=spawn(process.execPath,[join(root,'apps/server/dist/server.cjs')],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...environment,
    RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_DB:join(directory,'schedule.db'),RPLAYOUT_VAULT_FILE:join(directory,'vault.json'),RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_CACHE:join(directory,'cache'),RPLAYOUT_MEDIA:directory,
    RPLAYOUT_ENGINE:'',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_PROXY:'',RPLAYOUT_PROBE:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_DEVICES:'',RPLAYOUT_RELAY:'',RPLAYOUT_N1_PEER:'',RPLAYOUT_ADMIN_USER:'',RPLAYOUT_ADMIN_PASSWORD:'',RPLAYOUT_CONTROL_TOKEN:'',RPLAYOUT_ROLE:'ADMIN',RPLAYOUT_BACKUP_HOURS:'0',HOST:'127.0.0.1',PORT:String(port),LOG_LEVEL:'warn'}})
  pids.push(server.pid!);for(const stream of [server.stdout,server.stderr])stream?.on('data',chunk=>{logs=(logs+String(chunk)).slice(-4000)})
  await wait(async()=>{try{return (await get('/api/health')).status===200}catch{return false}},20000)
}
async function stop(){if(server&&server.exitCode===null&&server.signalCode===null){const ended=new Promise<void>(resolve=>server!.once('exit',()=>resolve()));server.kill('SIGKILL');await ended}server=null}
const publications=()=>sqlite.prepare('SELECT id,rundown_id,payload FROM operational_playlist_revisions ORDER BY published_at').all() as {id:string;rundown_id:string;payload:string}[]
try{
  const helper=spawn(process.execPath,[join(root,'apps/server/dist/schedule-planner.cjs')],{windowsHide:true,stdio:['pipe','pipe','pipe']})
  const helperExit=new Promise<number|null>((resolve,reject)=>{const timer=setTimeout(()=>{helper.kill();reject(new Error('Auxiliar não encerrou ao perder pipe do dono.'))},5000);helper.once('error',reject);helper.once('close',code=>{clearTimeout(timer);resolve(code)})})
  helper.stdout.resume();helper.stderr.resume();helper.stdin.end();assert.equal(await helperExit,2)
  await start();console.log(JSON.stringify({phase:'SERVER_READY',port,pid:server!.pid}))
  const path='/api/channels/ch/schedule-publication',before=sqlite.prepare('SELECT count(*) n FROM operator_decisions').get()
  const disabled=await get(path);assert.equal(disabled.status,200);assert.equal(disabled.body.state,'DISABLED');assert.equal(disabled.body.workerAvailable,true)
  const review=await get(path+'/review?daysAhead=2&maxItems=2000');assert.equal(review.status,200,JSON.stringify(review))
  assert.deepEqual(sqlite.prepare('SELECT count(*) n FROM operator_decisions').get(),before)
  const enable={action:'ENABLE',version:0,daysAhead:2,maxItems:2000}
  assert.equal((await get(path,enable)).status,428)
  assert.equal((await get(path,{...enable,reviewToken:review.body.review.token})).status,200)
  assert.equal(publications().length,0)
  await wait(()=>publications().length===1)
  const first=publications()[0]!.id;assert.equal((await get(path)).body.jobs[0].state,'READY')
  await stop();await start();console.log(JSON.stringify({phase:'RESTARTED_WITH_READY_DAY',pids,first}))
  await wait(()=>publications().length===2)
  const ready=(await get(path)).body;assert.equal(ready.state,'ENABLED');assert.equal(ready.jobs.filter((job:any)=>job.state==='READY').length,2)
  assert.equal(publications()[0]!.id,first)
  for(const publication of db.select().from((await import('../apps/server/src/db/schema.js')).operationalPlaylistRevisions).all()){
    const payload=publication.payload as any;assert.equal(payload.items.length,24);assert.equal(payload.schedule.endsAt,2160000);assert.equal(payload.schedule.conflicts.length,0);assert.equal(payload.assets[0].contentHash,hash)
  }
  assert.equal((sqlite.prepare("SELECT count(*) n FROM rundowns WHERE id='source'").get() as any).n,1)
  assert.equal((sqlite.prepare("SELECT count(*) n FROM rundown_items WHERE rundown_id='source'").get() as any).n,1)
  assert.equal((sqlite.prepare('SELECT count(*) n FROM as_run').get() as any).n,0)
  assert.equal((sqlite.prepare('SELECT count(*) n FROM qc_decisions').get() as any).n,0)
  const snapshot=await get('/api/rundowns/source');assert.equal(snapshot.body.live.transport.playing,false);assert.equal(snapshot.body.live.transport.onAir,null);assert.equal(snapshot.body.live.transport.preview,null)
  const stopped=await get('/api/channels/ch/transport',{action:'stop'});assert.equal(stopped.status,200)
  assert.equal((await get(path)).body.state,'SUSPENDED');assert.equal(publications().length,2)
  const again=await get(path+'/review?daysAhead=2&maxItems=2000');assert.equal(again.status,200)
  const reenabling=await get(path,{...enable,version:2,reviewToken:again.body.review.token});assert.equal(reenabling.status,200)
  const off=await get(path,{action:'DISABLE',version:3});assert.equal(off.status,200);assert.equal(off.body.state,'DISABLED');assert.equal(publications().length,2)
  console.log(JSON.stringify({result:'PASS',evidence:'COMPILED_SERVER_ISOLATED_PLANNER_EXACT_FUTURE_PUBLICATION_AND_RESTART',directory,port,pids,realFileDurationNs:probe.durationNs,revisionIds:publications().map(row=>row.id),exactDays:2,itemsPerDay:24,manualGradePreserved:true,noTake:true,noQcApproval:true,noDuplicateAfterRestart:true,stopSuspends:true,disablePreservesPublishedDays:true,plannerParentEofValidated:true,browserValidated:false,physicalOutputValidated:false,nativePlayoutValidated:false}))
}finally{await stop();sqlite.close()}
