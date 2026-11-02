import assert from 'node:assert/strict'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { createServer } from 'node:net'

// Compiled server + release decoder. Own DB/files/null output; no on-air
// channel, physical output, network source or browser is involved.
const root=fileURLToPath(new URL('..',import.meta.url)), directory=await mkdtemp(join(tmpdir(),'RPlayout-file-version-'))
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json')
const gstRoot=process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64??'C:/Program Files/gstreamer/1.0/msvc_x86_64',gstBin=join(gstRoot,'bin')
const environment={...process.env,PATH:gstBin+';'+process.env.PATH,GST_PLUGIN_PATH:join(gstRoot,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gstRoot,'lib/gstreamer-1.0'),GST_PLUGIN_SCANNER:join(gstRoot,'libexec/gstreamer-1.0/gst-plugin-scanner.exe'),GST_REGISTRY:join(directory,'gst-registry.bin')}
const [{openDatabase},{channels,rundowns,rundownItems,mediaAssets},{localDate}]=await Promise.all([
  import('../apps/server/src/db/client.js'),import('../apps/server/src/db/schema.js'),import('../apps/server/src/domain/rundown-clock.js')])
const database=openDatabase(join(directory,'version.db'))
const reservation=createServer();await new Promise<void>(resolve=>reservation.listen(0,'127.0.0.1',resolve))
const port=(reservation.address() as {port:number}).port;await new Promise<void>(resolve=>reservation.close(()=>resolve()))
let server:ChildProcess|null=null,enginePid:number|undefined,logs=''
async function api(path:string,body?:object,expected=200,headers:Record<string,string>={}){
  const reply=await fetch(`http://127.0.0.1:${port}/api${path}`,{...(body?{method:'POST',body:JSON.stringify(body)}:{}),headers:{...(body?{'Content-Type':'application/json'}:{}),...headers},signal:AbortSignal.timeout(30_000)})
  const text=await reply.text();assert.equal(reply.status,expected,`${path}: ${text}`);return JSON.parse(text)
}
async function wait(description:string,predicate:()=>Promise<boolean>){
  const deadline=performance.now()+30_000
  while(performance.now()<deadline){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,100))}
  throw new Error(description+'; '+logs.slice(-4000))
}
const snapshot=()=>api('/rundowns/rd'),transport=(itemId:string)=>api('/channels/sha/transport',{action:'take',itemId})
try{
  const stamp=new Date().toISOString(),fixtures:Array<{id:string;path:string;hash:string}>=[]
  for(const [id,pattern,volume] of [['pgm','red',0.1],['selected','green',0.2],['changed','blue',0.8]] as const){
    const path=join(directory,`APROVAÇÃO-ÇÃÓ-${id}.mkv`)
    await promisify(execFile)(join(gstBin,'gst-launch-1.0.exe'),['-q','matroskamux','name=m','!','filesink',`location=${path.replaceAll('\\','/')}`,
      'videotestsrc','num-buffers=2500',`pattern=${pattern}`,'!','video/x-raw,width=160,height=90,framerate=25/1','!','videoconvert','!','vp8enc','deadline=1','!','queue','!','m.video_0',
      'audiotestsrc','num-buffers=5000','wave=sine','freq=300',`volume=${volume}`,'!','audio/x-raw,format=F32LE,rate=48000,channels=2','!','queue','!','m.audio_0'],{timeout:60_000,windowsHide:true,env:environment})
    fixtures.push({id,path,hash:createHash('sha256').update(await readFile(path)).digest('hex')})
  }
  database.db.insert(channels).values({id:'sha',name:'SHA isolado',rateNum:25,rateDen:1,width:320,height:180,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:stamp}).run()
  database.db.insert(rundowns).values({id:'rd',channelId:'sha',name:'Versão publicada',date:localDate(new Date()),plannedStart:0,publicationRequired:true,loop:false,createdAt:stamp,updatedAt:stamp}).run()
  for(const [sortOrder,fixture] of fixtures.slice(0,2).entries()){
    database.db.insert(mediaAssets).values({id:fixture.id,title:fixture.id,path:fixture.path,contentHash:fixture.hash,kind:'VIDEO',durationFrames:2500,durationNs:100_000_000_000,width:160,height:90,rateNum:25,rateDen:1,interlaceMode:'progressive',hasAudio:true,audioChannels:2,audioTracks:[{index:0,channels:2,rate:48000}],qcStatus:'APPROVED',createdAt:stamp}).run()
    database.db.insert(rundownItems).values({id:fixture.id,rundownId:'rd',sortOrder,title:fixture.id,type:'VT',mediaId:fixture.id,minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',autoNext:false,loop:false,locked:false}).run()
  }
  // A file, not a cache directory, deliberately represents unavailable cache.
  // Legacy originals must be protected even when no archived copy is present.
  const cache=join(directory,'unavailable-cache');await writeFile(cache,'isolated cache unavailable fixture')
  server=spawn(process.execPath,[join(root,'apps/server/dist/server.cjs')],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...environment,
    RPLAYOUT_DB:join(directory,'version.db'),RPLAYOUT_VAULT_FILE:join(directory,'vault.json'),RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_MEDIA:directory,RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_CACHE:cache,
    RPLAYOUT_ENGINE:join(root,'apps/engine/target/release/rplayout-engine.exe'),RPLAYOUT_AUDIO_ANALYSIS:join(root,'apps/engine/target/release/rplayout-audio-analysis.exe'),RPLAYOUT_ENGINE_OUTPUT:'null',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_DEVICES:'',RPLAYOUT_RELAY:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_N1_PEER:'',RPLAYOUT_BACKUP_HOURS:'0',RPLAYOUT_ADMIN_USER:'',RPLAYOUT_ADMIN_PASSWORD:'',RPLAYOUT_CONTROL_TOKEN:'',RPLAYOUT_ROLE:'ADMIN',HOST:'127.0.0.1',PORT:String(port),LOG_LEVEL:'warn'}})
  for(const stream of [server.stdout,server.stderr])stream?.on('data',chunk=>{logs=(logs+String(chunk)).slice(-10000)})
  await wait('Servidor não iniciou',async()=>{try{return (await api('/health')).engines===1}catch{return false}})
  enginePid=(await api('/processes')).processes.find((row:any)=>row.kind==='ENGINE'&&row.channelId==='sha')?.pid;assert.ok(enginePid)
  const selected=fixtures[1]!,originalBytes=await readFile(selected.path),initial=await snapshot()
  const queued=await api('/items/selected/audio-analysis',{contentHash:selected.hash,audioTrack:0,routing:{mode:'STEREO_1_2'}},202,{'if-match':`w/"${initial.view.editorialRevision}"`})
  let analysis:any
  await wait('Mix não foi medido',async()=>{analysis=(await api('/items/selected/audio-analysis/'+queued.analysis.id)).analysis;assert.notEqual(analysis.state,'FAILED',JSON.stringify(analysis));return analysis.state==='READY'})
  await api('/items/selected/audio',{scope:'ITEM',audioTrack:0,audio:{mode:'AUTO',gainDb:20,measured:null,routing:{mode:'STEREO_1_2'},analysisId:analysis.id}},200,{'if-match':`w/"${initial.view.editorialRevision}"`})
  const {review}=await api('/rundowns/rd/operational-simulation')
  const revision=(await api('/rundowns/rd/operational-publish',{reviewToken:review.token},201,{'if-match':`w/"${review.editorialRevision}"`})).id
  await api('/channels/sha/load-rundown',{rundownId:'rd'});await transport('pgm')
  await wait('PGM não avançou',async()=>((await snapshot()).live.transport.onAir?.elapsed??0)>25)
  const before=await snapshot()
  assert.equal(before.view.items.find((row:any)=>row.item.id==='selected').asset.path,selected.path)
  assert.equal((database.sqlite.prepare('SELECT count(*) n FROM media_versions').get() as {n:number}).n,0)
  await writeFile(selected.path,await readFile(fixtures[2]!.path))
  const response=await fetch(`http://127.0.0.1:${port}/api/channels/sha/transport`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'take',itemId:'selected'})})
  const refused=await response.text();assert.equal(response.status,409,refused);assert.match(refused,/versão publicada/);assert.equal(JSON.parse(refused).code,'MEDIA_VERSION_CHANGED')
  await wait('PGM anterior deixou de avançar',async()=>{const current=(await snapshot()).live.transport;assert.equal(current.onAir?.itemId,'pgm');return current.onAir.elapsed>before.live.transport.onAir.elapsed+25})
  assert.equal((database.sqlite.prepare("SELECT content_hash FROM media_assets WHERE id='selected'").get() as {content_hash:string}).content_hash,selected.hash)
  assert.equal((await api('/items/selected/audio-analysis/'+analysis.id)).analysis.state,'READY','Measurement remains historical; it cannot authorize changed bytes.')
  assert.equal((database.sqlite.prepare("SELECT count(*) n FROM as_run WHERE item_id='selected'").get() as {n:number}).n,0)
  await writeFile(selected.path,originalBytes);await transport('selected')
  let integratedLufs=0
  await wait('Versão restaurada não entrou com AUTO',async()=>{const current=await snapshot();integratedLufs=current.live.meters.program.integratedLufs;return current.live.transport.onAir?.itemId==='selected'&&Math.abs(integratedLufs+23)<0.3})
  assert.equal((database.sqlite.prepare("SELECT count(*) n FROM as_run WHERE item_id='selected'").get() as {n:number}).n,1)
  console.log(JSON.stringify({result:'PASS',evidence:'COMPILED_SERVER_RELEASE_ENGINE_SHA_GUARD_PRESERVES_ACTUAL_PGM',directory,port,serverPid:server.pid,enginePid,revision,analysisId:analysis.id,refusedStatus:response.status,originalHash:selected.hash,integratedLufs,originalPathUsed:true,noArchivedVersion:true,cacheUnavailable:true,staleAnalysisCannotAuthorizeChangedBytes:true,previousPgmKeptAdvancing:true,failedTakeAsRunRows:0,restoredTakeAsRunRows:1,physicalOutputValidated:false,liveSourceValidated:false,browserValidated:false,cueValidated:false}))
}finally{
  if(server && server.exitCode===null){const ended=new Promise<void>(resolve=>server!.once('exit',()=>resolve()));server.kill('SIGKILL');await ended}
  if(enginePid)await wait('Engine próprio não encerrou com EOF',async()=>{try{process.kill(enginePid!,0);return false}catch{return true}})
  database.sqlite.close()
}
