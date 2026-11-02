import assert from 'node:assert/strict'
import {spawn,execFile,type ChildProcess} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,mkdir,readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createServer} from 'node:net'

// Isolated compiled server/native engine, null output and generated local VT.
// Does not contact hardware, emit on a production output or alter operator DB.
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(tmpdir(),'RPlayout-cadence-native-'))
const media=join(directory,'media');await mkdir(media)
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json')
const gstRoot=process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64 ?? 'C:/Program Files/gstreamer/1.0/msvc_x86_64',gstBin=join(gstRoot,'bin')
const gstEnv={...process.env,GST_REGISTRY:join(directory,'gst-registry.bin'),GST_PLUGIN_SCANNER:join(gstRoot,'libexec/gstreamer-1.0/gst-plugin-scanner.exe'),GST_PLUGIN_PATH:join(gstRoot,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gstRoot,'lib/gstreamer-1.0'),PATH:gstBin+';'+process.env.PATH}
const file=join(media,'CADÊNCIA-ÇÃO.mp4')
await promisify(execFile)(join(gstBin,'gst-launch-1.0.exe'),['-q','videotestsrc','num-buffers=1500','!','video/x-raw,width=320,height=180,framerate=25/1','!','videoconvert','!','x264enc','speed-preset=ultrafast','!','h264parse','!','mp4mux','!','filesink',`location=${file.replaceAll('\\','/')}`],{timeout:60_000,windowsHide:true,env:gstEnv})
const {openDatabase}=await import('../apps/server/src/db/client.js'),{channels,rundowns,rundownItems,mediaAssets}=await import('../apps/server/src/db/schema.js')
const database=openDatabase(join(directory,'cadence.db')),now=new Date().toISOString()
database.db.insert(channels).values({id:'qa',name:'QA cadência',rateNum:25,rateDen:1,width:320,height:180,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:now}).run()
database.db.insert(rundowns).values({id:'rd',channelId:'qa',name:'Grade QA',date:now.slice(0,10),plannedStart:0,loop:false,createdAt:now,updatedAt:now}).run()
database.db.insert(mediaAssets).values({id:'asset',path:file,title:'VT QA',contentHash:createHash('sha256').update(await readFile(file)).digest('hex'),kind:'VIDEO',durationFrames:1500,rateNum:25,rateDen:1,width:320,height:180,defaultTrim:{in:50,out:500},defaultTrimRateNum:50,defaultTrimRateDen:1,createdAt:now}).run()
database.db.insert(rundownItems).values({id:'vt',rundownId:'rd',mediaId:'asset',title:'VT QA',type:'VT',sortOrder:0,minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',locked:false,autoNext:false,loop:false}).run()
const reservation=createServer();await new Promise<void>(resolve=>reservation.listen(0,'127.0.0.1',resolve))
const port=(reservation.address() as {port:number}).port;await new Promise<void>(resolve=>reservation.close(()=>resolve()))
const base=`http://127.0.0.1:${port}`,ownedEngines=new Set<number>()
let child:ChildProcess|null=null,diagnostics=''
const alive=(pid:number)=>{try{process.kill(pid,0);return true}catch{return false}}
async function api(path:string,body?:object,expected=200,headers:Record<string,string>={}){
  const response=await fetch(base+path,{...(body?{method:'POST',body:JSON.stringify(body)}:{}),headers:{'Content-Type':'application/json',...headers},signal:AbortSignal.timeout(10_000)})
  const result=await response.json() as any;assert.equal(response.status,expected,`${path}: ${JSON.stringify(result)}`);return result
}
async function wait(description:string,check:()=>boolean|Promise<boolean>,timeout=30_000){
  const deadline=performance.now()+timeout
  while(performance.now()<deadline){if(await check())return;await new Promise(resolve=>setTimeout(resolve,100))}
  throw new Error(description+'; '+diagnostics.slice(-3000))
}
async function engine(){const row=(await api('/api/processes')).processes.find((entry:any)=>entry.kind==='ENGINE'&&entry.channelId==='qa');assert.ok(row?.pid);ownedEngines.add(row.pid);return row.pid as number}
async function state(){return (await api('/api/n1/state')).channels.find((entry:any)=>entry.channelId==='qa')}
async function publishReviewed(){const {review}=await api('/api/rundowns/rd/operational-simulation');return api('/api/rundowns/rd/operational-publish',{reviewToken:review.token},201,{'if-match':`w/"${review.editorialRevision}"`})}
try{
  child=spawn(process.execPath,[join(root,'apps/server/dist/server.cjs')],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...gstEnv,
    RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_DB:join(directory,'cadence.db'),RPLAYOUT_MEDIA:media,RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_CACHE:join(directory,'cache'),RPLAYOUT_BACKUPS:join(directory,'backups'),
    RPLAYOUT_ENGINE:join(root,'apps/engine/target/release/rplayout-engine.exe'),RPLAYOUT_ENGINE_OUTPUT:'null',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_DEVICES:'',RPLAYOUT_RELAY:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_N1_PEER:'',RPLAYOUT_BACKUP_HOURS:'0',RPLAYOUT_ADMIN_USER:'',RPLAYOUT_ADMIN_PASSWORD:'',RPLAYOUT_ROLE:'ADMIN',RPLAYOUT_CONTROL_TOKEN:'',PORT:String(port),HOST:'127.0.0.1',LOG_LEVEL:'warn'}})
  for(const stream of [child.stdout,child.stderr])stream?.on('data',chunk=>{diagnostics=(diagnostics+String(chunk)).slice(-8000)})
  child.on('error',error=>{diagnostics+=error.message})
  await wait('Engine compilado não ficou pronto',async()=>{try{return (await state())?.health.ready===true}catch{return false}})
  const oldPid=await engine(),original=await publishReviewed()
  const initial=(await api('/api/rundowns/rd')).view.items.find((row:any)=>row.item.id==='vt')
  assert.deepEqual(initial.trim,{in:25,out:250})
  const oldRevision=database.sqlite.prepare("SELECT id,payload FROM operational_playlist_revisions WHERE active=1 AND rundown_id='rd'").get() as {id:string;payload:string}
  await api('/api/channels/qa/transport',{action:'take',itemId:'vt'})
  await wait('VT não confirmou PGM nativo',async()=> (await state())?.state.onAir?.itemId==='vt')
  await wait('Recuperação inicial não encerrou',async()=> (await state())?.reconfiguration.ready===true)
  const configuration=(await api('/api/channels/qa/configuration')).channel
  const configurationHeaders={'if-match':`"channel:qa:${configuration.configurationRevision}"`}
  const report=(await api('/api/channels/qa/cadence-preview',{rateNum:50,rateDen:1},200,configurationHeaders)).report
  const request={rateNum:50,rateDen:1,fingerprint:report.fingerprint,confirm:true}
  await api('/api/channels/qa/cadence-convert',request,409,configurationHeaders)
  assert.equal(await engine(),oldPid);assert.equal((await state()).state.onAir.itemId,'vt')
  await api('/api/channels/qa/transport',{action:'stop'})
  const converted=await api('/api/channels/qa/cadence-convert',request,200,configurationHeaders)
  assert.equal(converted.applied,true);assert.equal(converted.engineError,null);assert.equal(converted.automaticTake,false)
  await wait('Engine antigo não encerrou',()=>!alive(oldPid))
  await wait('Engine convertido não ficou pronto/parado',async()=>{const row=await state();return row?.health.ready && row.state.onAir===null})
  const newPid=await engine();assert.notEqual(newPid,oldPid)
  assert.equal((database.sqlite.prepare("SELECT payload FROM operational_playlist_revisions WHERE id=?").get(oldRevision.id) as any).payload,oldRevision.payload)
  assert.deepEqual(database.sqlite.prepare("SELECT trim FROM rundown_items WHERE id='vt'").get(),{trim:'{"in":50,"out":500}'})
  assert.deepEqual(database.sqlite.prepare("SELECT default_trim,default_trim_rate_num,default_trim_rate_den FROM media_assets WHERE id='asset'").get(),{default_trim:'{"in":50,"out":500}',default_trim_rate_num:50,default_trim_rate_den:1})
  const closed=database.sqlite.prepare("SELECT * FROM as_run WHERE ended_by='STOP' ORDER BY created_at DESC LIMIT 1").get() as any
  assert.equal(closed.rate_num,25);assert.equal(closed.execution_kind,'NATIVE');assert.equal(closed.duration_evidence,'ENGINE_POSITION')
  await api('/api/channels/qa/transport',{action:'take',itemId:'vt'},409)
  await api('/api/rundowns/rd/operational-rollback',{revisionId:oldRevision.id},409)
  await publishReviewed()
  await api('/api/channels/qa/transport',{action:'take',itemId:'vt'})
  await wait('Grade republicada a 50 FPS não entrou em PGM',async()=> (await state())?.state.onAir?.itemId==='vt')
  const checkpoint=JSON.parse((database.sqlite.prepare("SELECT payload FROM channel_checkpoints WHERE channel_id='qa'").get() as any).payload)
  assert.deepEqual(checkpoint.rate,{num:50,den:1})
  await api('/api/channels/qa/transport',{action:'stop'})
  const last=database.sqlite.prepare("SELECT * FROM as_run WHERE ended_by='STOP' ORDER BY created_at DESC LIMIT 1").get() as any
  assert.equal(last.rate_num,50);assert.equal(last.execution_kind,'NATIVE')
  console.log(JSON.stringify({result:'PASS',directory,port,oldPid,newPid,originalRevision:original.revision,blockedWhileOnPgm:true,oldRevisionBytePreserved:true,sharedDefaultRate:50,oldTrim:{in:25,out:250},newTrim:{in:50,out:500},sharedDefaultBytePreserved:true,oldAsRunRate:25,newAsRunRate:50,requiresNewPublication:true,noAutomaticTake:true,engineOutput:'null',previewPublisherEnabled:false,physicalOutputValidated:false}))
}finally{
  child?.kill('SIGKILL')
  for(const pid of ownedEngines)if(alive(pid)){try{process.kill(pid)}catch{}}
  database.sqlite.close()
}
