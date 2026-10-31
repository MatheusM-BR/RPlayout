import assert from 'node:assert/strict'
import { spawn,execFile,type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp,mkdir,readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { createServer } from 'node:net'
import { framesSinceMidnight } from '../packages/protocol/src/index.js'

// Own compiled server/native null-output engine + frozen files. No operational
// DB, physical output, network input or browser. Never enables a real channel.
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(tmpdir(),'RPlayout-published-continuity-'))
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json')
const gstRoot=process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64??'C:/Program Files/gstreamer/1.0/msvc_x86_64',gstBin=join(gstRoot,'bin')
const environment={...process.env,PATH:gstBin+';'+process.env.PATH,GST_PLUGIN_PATH:join(gstRoot,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gstRoot,'lib/gstreamer-1.0'),GST_PLUGIN_SCANNER:join(gstRoot,'libexec/gstreamer-1.0/gst-plugin-scanner.exe'),GST_REGISTRY:join(directory,'gst-registry.bin')}
const [{openDatabase},{channels,rundowns,rundownItems,mediaAssets},{localDate},{PlaylistBoundaryLedger},{readContinuityPolicy}]=await Promise.all([
  import('../apps/server/src/db/client.js'),import('../apps/server/src/db/schema.js'),import('../apps/server/src/domain/rundown-clock.js'),import('../apps/server/src/domain/playlist-boundary.js'),import('../apps/server/src/domain/published-continuity.js')])
const database=openDatabase(join(directory,'continuity.db')),ledger=new PlaylistBoundaryLedger(database.db,'continuity')
const reservation=createServer();await new Promise<void>(resolve=>reservation.listen(0,'127.0.0.1',resolve))
const port=(reservation.address() as {port:number}).port;await new Promise<void>(resolve=>reservation.close(()=>resolve()))
const engines=new Set<number>(),servers:number[]=[],revisions:string[]=[],media=join(directory,'media');await mkdir(media)
let child:ChildProcess|null=null,logs=''
async function api(path:string,body?:object,expected=200,headers:Record<string,string>={}){
  const reply=await fetch(`http://127.0.0.1:${port}/api${path}`,{...(body?{method:'POST',body:JSON.stringify(body)}:{}),headers:{...(body?{'Content-Type':'application/json'}:{}),...headers},signal:AbortSignal.timeout(20_000)})
  const text=await reply.text();assert.equal(reply.status,expected,`${path}: ${text}`);return JSON.parse(text)
}
async function wait(description:string,predicate:()=>Promise<boolean>,timeout=25_000){const deadline=performance.now()+timeout;while(performance.now()<deadline){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,100))}throw new Error(description+'; '+logs.slice(-5000))}
const state=async()=>(await api('/n1/state')).channels.find((row:any)=>row.channelId==='continuity')
const policy=()=>api('/channels/continuity/published-continuity')
async function start(){
  child=spawn(process.execPath,[join(root,'apps/server/dist/server.cjs')],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...environment,
    RPLAYOUT_DB:join(directory,'continuity.db'),RPLAYOUT_VAULT_FILE:join(directory,'vault.json'),RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_MEDIA:media,RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_CACHE:join(directory,'cache'),RPLAYOUT_BACKUPS:join(directory,'backups'),
    RPLAYOUT_ENGINE:join(root,'apps/engine/target/release/rplayout-engine.exe'),RPLAYOUT_ENGINE_OUTPUT:'null',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_DEVICES:'',RPLAYOUT_RELAY:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_N1_PEER:'',RPLAYOUT_BACKUP_HOURS:'0',RPLAYOUT_ADMIN_USER:'',RPLAYOUT_ADMIN_PASSWORD:'',RPLAYOUT_CONTROL_TOKEN:'',RPLAYOUT_ROLE:'ADMIN',HOST:'127.0.0.1',PORT:String(port),LOG_LEVEL:'warn'}})
  servers.push(child.pid!);for(const stream of [child.stdout,child.stderr])stream?.on('data',chunk=>{logs=(logs+String(chunk)).slice(-10000)})
  await wait('Servidor/engine não iniciou',async()=>{try{return(await api('/health')).engines===1}catch{return false}})
  engines.add((await api('/processes')).processes.find((row:any)=>row.kind==='ENGINE'&&row.channelId==='continuity').pid)
  await wait('Engine não liberou configuração',async()=>(await state()).reconfiguration?.ready===true)
}
async function stop(){const own=child;if(!own)return;const ended=new Promise<void>(resolve=>own.once('exit',()=>resolve()));own.kill('SIGKILL');await ended;child=null
  await wait('Engine próprio não encerrou com EOF',async()=>[...engines].every(pid=>{try{process.kill(pid,0);return false}catch{return true}}))}
try{
  const fixtures=[] as {path:string;hash:string}[]
  for(let index=0;index<3;index++){
    const path=join(media,`GRADE-${index}-AÇÃO.mp4`)
    await promisify(execFile)(join(gstBin,'gst-launch-1.0.exe'),['-q','videotestsrc',`pattern=${['smpte','ball','snow'][index]}`,'num-buffers=750','!','video/x-raw,width=320,height=180,framerate=25/1','!','videoconvert','!','x264enc','speed-preset=ultrafast','!','h264parse','!','mp4mux','!','filesink',`location=${path.replaceAll('\\','/')}`],{timeout:60_000,windowsHide:true,env:environment})
    fixtures.push({path,hash:createHash('sha256').update(await readFile(path)).digest('hex')})
  }
  const stamp=new Date().toISOString(),date=localDate(new Date()),startFrame=framesSinceMidnight(new Date(),{num:25,den:1})-125
  database.db.insert(channels).values({id:'continuity',name:'Continuidade isolada',rateNum:25,rateDen:1,width:320,height:180,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:stamp}).run()
  for(const [index,fixture] of fixtures.entries()){
    database.db.insert(mediaAssets).values({id:'asset'+index,title:'Publicado '+index,path:fixture.path,contentHash:fixture.hash,kind:'VIDEO',durationFrames:750,durationNs:30_000_000_000,width:320,height:180,rateNum:25,rateDen:1,interlaceMode:'progressive',hasAudio:false,qcStatus:'APPROVED',createdAt:stamp}).run()
    database.db.insert(rundowns).values({id:'rd'+index,channelId:'continuity',name:'Grade '+index,date,plannedStart:startFrame+index*250,loop:false,publicationRequired:true,createdAt:stamp,updatedAt:stamp}).run()
    database.db.insert(rundownItems).values({id:'vt'+index,rundownId:'rd'+index,sortOrder:0,title:'Publicado '+index,type:'VT',mediaId:'asset'+index,trim:{in:0,out:250},minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',autoNext:index<2,loop:false,locked:false}).run()
  }
  await start()
  for(let index=0;index<3;index++){const {review}=await api(`/rundowns/rd${index}/operational-simulation`);revisions.push((await api(`/rundowns/rd${index}/operational-publish`,{reviewToken:review.token},201,{'if-match':`w/"${review.editorialRevision}"`})).id)}
  await api('/channels/continuity/load-rundown',{rundownId:'rd0'});assert.equal((await policy()).state,'DISABLED')
  const {review}=await api('/channels/continuity/published-continuity/review?maxLateMinutes=5')
  await api('/channels/continuity/published-continuity',{action:'ENABLE',version:0,maxLateMinutes:5},428)
  await api('/channels/continuity/published-continuity',{action:'ENABLE',version:0,maxLateMinutes:5,reviewToken:review.token})
  assert.equal((await state()).state.playing,false,'Habilitar não é TAKE')
  await api('/channels/continuity/transport',{action:'take',itemId:'vt0'})
  await wait('Primeira intenção não enfileirada',async()=>ledger.list().some(run=>run.plan.sourceRevisionId===revisions[0]&&run.state==='QUEUED'))
  const firstRun=ledger.list()[0]!,before=await state();assert.equal(firstRun.plan.targetRevisionId,revisions[1])
  assert.equal(readContinuityPolicy(database.db,'continuity')!.worker.pid,child!.pid)
  await stop();await start()
  await wait('PGM/owner não retomados',async()=>{const row=await state();return row.state.onAir?.itemId==='vt0'&&readContinuityPolicy(database.db,'continuity')!.worker.pid===child!.pid})
  assert.equal(ledger.list().length,1,'Reinício não duplica fila')
  assert.ok((await state()).state.onAir.elapsed>=before.state.onAir.elapsed)
  await wait('Primeira passagem não confirmou',async()=>ledger.read(firstRun.id)?.state==='CONFIRMED'&&(await state()).state.onAir?.itemId==='vt1')
  await wait('Segunda passagem recorrente não enfileirada',async()=>ledger.list().some(run=>run.plan.sourceRevisionId===revisions[1]&&run.state==='QUEUED'))
  const secondRun=ledger.list()[0]!;assert.equal(secondRun.plan.targetRevisionId,revisions[2])
  await wait('Segunda passagem não confirmou',async()=>ledger.read(secondRun.id)?.state==='CONFIRMED'&&(await state()).state.onAir?.itemId==='vt2')
  const asRun=database.sqlite.prepare("SELECT item_id,revision_id,ended_by FROM as_run WHERE execution_kind='NATIVE' ORDER BY rowid").all() as any[]
  assert.equal(asRun.filter(row=>row.item_id==='vt1').length,1);assert.equal(asRun.filter(row=>row.item_id==='vt2').length,1)
  assert.equal(asRun.find(row=>row.item_id==='vt1').ended_by,'PLAYLIST_BOUNDARY')
  await api('/channels/continuity/transport',{action:'stop'});assert.equal((await policy()).state,'SUSPENDED')
  assert.equal((await state()).state.playing,false);assert.equal(ledger.list().length,2)
  console.log(JSON.stringify({result:'PASS',evidence:'COMPILED_SERVER_RELEASE_ENGINE_RECURRING_PUBLISHED_EOS_AND_RESTART',directory,port,servers,engines:[...engines],revisions,transitionIds:[firstRun.id,secondRun.id],asRun,ownerRecoveredAfterBothProcessesEnded:true,queueNotDuplicated:true,enableDoesNotTake:true,stopSuspends:true,physicalOutputValidated:false,liveSourceValidated:false,browserValidated:false,cueValidated:false,automaticEditorialPublication:false}))
}finally{await stop();database.sqlite.close()}
