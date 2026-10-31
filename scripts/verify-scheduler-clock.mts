import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'
import { createHash } from 'node:crypto'
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(tmpdir(),'RPlayout-scheduler-clock-'))
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json')
const {openDatabase}=await import('../apps/server/src/db/client.js')
const {channels,rundowns,rundownItems,mediaAssets}=await import('../apps/server/src/db/schema.js')
const {localDate,rundownFrames}=await import('../apps/server/src/domain/rundown-clock.js')
const db=openDatabase(join(directory,'scheduler.db')),media=join(directory,'media')
await mkdir(media);const file=join(media,'fixture.mp4'),bytes=Buffer.from('SIMULATED_MEDIA_FIXTURE_NOT_NATIVE_VIDEO');await writeFile(file,bytes)
const now=new Date(),previous=new Date(now);previous.setDate(previous.getDate()-1)
const date=localDate(previous),rate={num:25,den:1},frames=rundownFrames(date,rate,now)!,stamp=now.toISOString()
db.db.insert(channels).values({id:'clock',name:'Relógio QA',rateNum:25,rateDen:1,width:320,height:180,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:stamp}).run()
db.db.insert(rundowns).values({id:'rd',channelId:'clock',name:'Execução de ontem',date,plannedStart:frames-125,loop:false,publicationRequired:true,createdAt:stamp,updatedAt:stamp}).run()
db.db.insert(mediaAssets).values({id:'asset',path:file,title:'Fixture simulada',kind:'VIDEO',contentHash:createHash('sha256').update(bytes).digest('hex'),durationFrames:3000,durationNs:120_000_000_000,rateNum:25,rateDen:1,qcStatus:'APPROVED',createdAt:stamp}).run()
for(const [order,id] of ['pgm','next'].entries())db.db.insert(rundownItems).values({id,rundownId:'rd',sortOrder:order,title:id,type:'VT',mediaId:'asset',durationOverride:order?250:3000,minDuration:0,
  anchor:order?{kind:'FIXED',at:frames+135*25}:{kind:'FLOW'},onOverrun:'PUSH',autoNext:true,loop:false,locked:false}).run()
const socket=createServer();await new Promise<void>(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=(socket.address() as {port:number}).port
await new Promise<void>(resolve=>socket.close(()=>resolve()))
let child:ChildProcess|null=null,logs='';const pids:number[]=[]
async function api(path:string,body?:object,method=body?'POST':'GET',expected=200,revision?:number){
  const reply=await fetch(`http://127.0.0.1:${port}/api${path}`,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(revision!==undefined?{'If-Match':`w/"${revision}"`}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10_000)})
  const text=await reply.text();assert.equal(reply.status,expected,`${path}: ${reply.status} ${text}`);return JSON.parse(text)
}
async function start(){
  logs='';child=spawn(process.execPath,[join(root,'apps/server/dist/server.cjs')],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,
    RPLAYOUT_DB:join(directory,'scheduler.db'),RPLAYOUT_VAULT_FILE:join(directory,'vault.json'),RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_MEDIA:media,
    RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_CACHE:join(directory,'cache'),RPLAYOUT_BACKUPS:join(directory,'backups'),
    RPLAYOUT_ENGINE:'',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_DEVICES:'',RPLAYOUT_RELAY:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_N1_PEER:'',RPLAYOUT_BACKUP_HOURS:'0',
    RPLAYOUT_ADMIN_USER:'',RPLAYOUT_ADMIN_PASSWORD:'',RPLAYOUT_ROLE:'ADMIN',RPLAYOUT_CONTROL_TOKEN:'',HOST:'127.0.0.1',PORT:String(port),LOG_LEVEL:'warn'}})
  pids.push(child.pid!);for(const stream of [child.stdout,child.stderr])stream?.on('data',chunk=>{logs=(logs+String(chunk)).slice(-4000)})
  const deadline=performance.now()+20_000
  while(true){assert.equal(child.exitCode,null,logs);try{if((await api('/health')).ok)return}catch{}
    assert.ok(performance.now()<deadline,logs);await new Promise(resolve=>setTimeout(resolve,100))}
}
async function stop(){const own=child;child=null;if(!own||own.exitCode!==null||own.signalCode!==null)return;const end=new Promise<void>(resolve=>own.once('exit',()=>resolve()));own.kill('SIGKILL');await end}
const transport=(body:object)=>api('/channels/clock/transport',body)
const horizon=async()=>(await api('/scheduler/status')).channels.find((row:any)=>row.channelId==='clock')
const warningCount=()=> (db.sqlite.prepare("SELECT count(*) n FROM operator_decisions WHERE kind='SCHEDULER_HORIZON_WARNING' AND rundown_id='rd'").get() as {n:number}).n
try{
  await start();assert.equal((await horizon()).mode,'NO_EXECUTION')
  const {review}=await api('/rundowns/rd/operational-simulation')
  const published=await api('/rundowns/rd/operational-publish',{reviewToken:review.token},'POST',201,review.editorialRevision)
  await transport({action:'take',itemId:'pgm'});await transport({action:'cue',itemId:'next'})
  const before=await api('/rundowns/rd'),coverage=await horizon()
  assert.equal(before.live.transport.mode,'SIMULATED');assert.ok(coverage.nowFrames>24*3600*25)
  assert.equal(coverage.rundownDate,date);assert.equal(coverage.revisionId,published.id);assert.equal(coverage.mode,'FINITE');assert.ok(coverage.minutesRemaining<5)
  assert.equal(coverage.automaticHandover,false);assert.equal(coverage.coverageReady,false)
  const deadline=performance.now()+5000
  while(warningCount()===0){assert.ok(performance.now()<deadline,logs);await new Promise(resolve=>setTimeout(resolve,100))}
  assert.equal(warningCount(),1)
  const future=new Date(now);future.setDate(future.getDate()+1)
  db.sqlite.prepare('UPDATE rundowns SET date=? WHERE id=?').run(localDate(future),'rd')
  db.sqlite.prepare('UPDATE rundown_items SET duration_override=? WHERE id=?').run(49*3600*25,'next')
  const after=await api('/rundowns/rd'),afterHorizon=await horizon()
  assert.equal(after.view.rundown.date,localDate(future));assert.equal(after.executionView.rundown.date,date)
  assert.equal(afterHorizon.rundownDate,date);assert.ok(afterHorizon.minutesRemaining<5)
  assert.equal(after.live.transport.onAir.itemId,before.live.transport.onAir.itemId);assert.deepEqual(after.live.transport.preview,before.live.transport.preview)
  await transport({action:'stop'});await transport({action:'cue',itemId:null});await stop();await start()
  await transport({action:'take',itemId:'pgm'});await transport({action:'cue',itemId:'next'})
  await new Promise(resolve=>setTimeout(resolve,750));assert.equal(warningCount(),1)
  assert.equal((await horizon()).rundownDate,date)
  assert.equal((db.sqlite.prepare("SELECT count(*) n FROM operational_playlist_revisions WHERE rundown_id='rd'").get() as {n:number}).n,1)
  assert.equal((db.sqlite.prepare("SELECT count(*) n FROM operator_decisions WHERE kind='AUTOFILL_APPLIED'").get() as {n:number}).n,0)
  console.log(JSON.stringify({result:'PASS',evidence:'COMPILED_SERVER_DATED_EXECUTION_HORIZON_AND_RESTART_DEDUP',directory,port,pids,gradeDate:date,revisionId:published.id,oneDurableWarning:true,editorialDoesNotExtendExecution:true,noImplicitAutofillOrPublication:true,automaticDayHandoverImplemented:false,midnightClockSimulatedInUnitTestsOnly:true,physicalOutputValidated:false}))
}finally{await stop();db.sqlite.close()}
