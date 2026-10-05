import assert from 'node:assert/strict'
import {spawn,execFile,type ChildProcess} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,mkdir,readFile} from 'node:fs/promises'
import {tmpdir,hostname} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash,randomUUID} from 'node:crypto'
import {createServer} from 'node:net'

// Compiled server + real file decoding in an isolated native null-output engine.
// No board, physical output, sender, operational DB or browser is involved.
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(tmpdir(),'RPlayout-playlist-boundary-'))
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json')
const gstRoot=process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64 ?? 'C:/Program Files/gstreamer/1.0/msvc_x86_64',gstBin=join(gstRoot,'bin')
const gstEnv={...process.env,GST_REGISTRY:join(directory,'gst-registry.bin'),GST_PLUGIN_SCANNER:join(gstRoot,'libexec/gstreamer-1.0/gst-plugin-scanner.exe'),GST_PLUGIN_PATH:join(gstRoot,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gstRoot,'lib/gstreamer-1.0'),PATH:gstBin+';'+process.env.PATH}
const media=join(directory,'media');await mkdir(media)
const {openDatabase}=await import('../apps/server/src/db/client.js')
const {channels,rundowns,rundownItems,mediaAssets,qcDecisions}=await import('../apps/server/src/db/schema.js')
const {PlaylistBoundaryLedger}=await import('../apps/server/src/domain/playlist-boundary.js')
const {localDate}=await import('../apps/server/src/domain/rundown-clock.js')
const database=openDatabase(join(directory,'boundary.db')),ledger=new PlaylistBoundaryLedger(database.db,'boundary')
const reservation=createServer();await new Promise<void>(resolve=>reservation.listen(0,'127.0.0.1',resolve))
const port=(reservation.address() as {port:number}).port;await new Promise<void>(resolve=>reservation.close(()=>resolve()))
const base=`http://127.0.0.1:${port}`,engines=new Set<number>(),servers:number[]=[]
let child:ChildProcess|null=null,diagnostics=''
const alive=(pid:number)=>{try{process.kill(pid,0);return true}catch{return false}}
async function wait(message:string,check:()=>boolean|Promise<boolean>,timeout=20_000){
  const end=performance.now()+timeout
  while(performance.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,100))}
  throw new Error(message+'; '+diagnostics.slice(-3000))
}
async function api(path:string,body?:object,expected=200,headers:Record<string,string>={}){
  const reply=await fetch(base+'/api'+path,{...(body?{method:'POST',body:JSON.stringify(body)}:{}),headers:{...(body?{'Content-Type':'application/json'}:{}),...headers},signal:AbortSignal.timeout(10_000)})
  const text=await reply.text();assert.equal(reply.status,expected,`${path}: ${text}`);return JSON.parse(text)
}
const state=async()=>(await api('/n1/state')).channels.find((row:any)=>row.channelId==='boundary')
const snapshot=()=>api('/rundowns/source')
async function start(){
  diagnostics='';child=spawn(process.execPath,[join(root,'apps/server/dist/server.cjs')],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...gstEnv,
    RPLAYOUT_DB:join(directory,'boundary.db'),RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_MEDIA:media,RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_CACHE:join(directory,'cache'),RPLAYOUT_BACKUPS:join(directory,'backups'),
    RPLAYOUT_ENGINE:join(root,'apps/engine/target/release/rplayout-engine.exe'),RPLAYOUT_ENGINE_OUTPUT:'null',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_DEVICES:'',RPLAYOUT_RELAY:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_N1_PEER:'',RPLAYOUT_BACKUP_HOURS:'0',RPLAYOUT_ADMIN_USER:'',RPLAYOUT_ADMIN_PASSWORD:'',RPLAYOUT_ROLE:'ADMIN',RPLAYOUT_CONTROL_TOKEN:'',HOST:'127.0.0.1',PORT:String(port),LOG_LEVEL:'warn'}})
  servers.push(child.pid!);for(const stream of [child.stdout,child.stderr])stream?.on('data',chunk=>{diagnostics=(diagnostics+String(chunk)).slice(-8000)})
  child.on('error',error=>{diagnostics+=String(error)})
  await wait('Engine/servidor próprio não iniciou',async()=>{try{return (await api('/health')).engines===1}catch{return false}})
  const engineRow=(await api('/processes')).processes.find((row:any)=>row.kind==='ENGINE'&&row.channelId==='boundary');assert.ok(engineRow?.pid);engines.add(engineRow.pid)
  await wait('Canal não liberou a configuração',async()=>(await state()).reconfiguration?.ready===true)
}
async function stopServer(){
  const own=child;if(!own)return
  const ended=new Promise<void>(resolve=>own.once('exit',()=>resolve()));own.kill('SIGKILL');await ended;child=null
  await wait('Engine próprio não encerrou com EOF do servidor',()=>[...engines].every(pid=>!alive(pid)))
}
async function publish(id:string){const {review}=await api(`/rundowns/${id}/operational-simulation`);return api(`/rundowns/${id}/operational-publish`,{reviewToken:review.token},201,{'if-match':`w/"${review.editorialRevision}"`})}
const transport=(body:object)=>api('/channels/boundary/transport',body)
const planReview=()=>api(`/channels/boundary/next-playlist/review?revisionId=${targetRevision}`)
let targetRevision='',sourceRevision='',firstRequest=''
try{
  const stamp=new Date().toISOString(),date=localDate(new Date())
  database.db.insert(channels).values({id:'boundary',name:'Passagem isolada',rateNum:25,rateDen:1,width:320,height:180,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:stamp}).run()
  for(const [id,pattern] of [['source','smpte'],['target','ball']] as const){
    const file=join(media,`PASSAGEM-${id}-ÇÃO.mp4`)
    await promisify(execFile)(join(gstBin,'gst-launch-1.0.exe'),['-q','videotestsrc',`pattern=${pattern}`,'num-buffers=750','!','video/x-raw,width=320,height=180,framerate=25/1','!','videoconvert','!','x264enc','speed-preset=ultrafast','!','h264parse','!','mp4mux','!','filesink',`location=${file.replaceAll('\\','/')}`],{timeout:60_000,windowsHide:true,env:gstEnv})
    database.db.insert(mediaAssets).values({id:'asset-'+id,title:id,path:file,contentHash:createHash('sha256').update(await readFile(file)).digest('hex'),kind:'VIDEO',durationFrames:750,durationNs:30_000_000_000,width:320,height:180,rateNum:25,rateDen:1,interlaceMode:'progressive',hasAudio:false,qcStatus:'APPROVED',createdAt:stamp}).run()
    database.db.insert(rundowns).values({id,channelId:'boundary',name:id,date,plannedStart:0,loop:false,publicationRequired:true,createdAt:stamp,updatedAt:stamp}).run()
    database.db.insert(rundownItems).values({id:'vt-'+id,rundownId:id,sortOrder:0,title:id,type:'VT',mediaId:'asset-'+id,trim:{in:0,out:500},minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',autoNext:id==='source',loop:false,locked:false}).run()
  }
  await start();sourceRevision=(await publish('source')).id;targetRevision=(await publish('target')).id
  await api('/channels/boundary/load-rundown',{rundownId:'source'})
  const {review}=await planReview();firstRequest=randomUUID()
  const command={action:'QUEUE',requestId:firstRequest,sourceRevisionId:sourceRevision,targetRevisionId:targetRevision}
  await api('/channels/boundary/next-playlist',command,428)
  await api('/channels/boundary/next-playlist',{...command,reviewToken:review.token})
  await api('/channels/boundary/next-playlist',{...command,reviewToken:review.token})
  assert.equal(ledger.list().length,1);assert.equal((await state()).state.playing,false)
  assert.equal((await api('/scheduler/status')).channels[0].automaticHandover,true)
  const oldServer=child!.pid!;await stopServer();await start()
  assert.notEqual(child!.pid,oldServer);assert.equal(ledger.read(firstRequest)?.state,'QUEUED')
  assert.equal((await state()).state.playing,false,'Reinício da fila não autorizou TAKE')
  await api('/channels/boundary/load-rundown',{rundownId:'source'})
  await transport({action:'take',itemId:'vt-source'})
  assert.equal((await state()).state.onAir.itemId,'vt-source')
  // Editorial changes do not replace the reviewed frozen first file.
  database.sqlite.prepare('UPDATE rundown_items SET title=? WHERE id=?').run('RASCUNHO QUE NÃO DEVE IR AO AR','vt-target')
  await wait('Destino não entrou em preroll antes do EOS',async()=>(await state()).state.preparedItemId==='vt-target',25_000)
  assert.equal((await state()).state.onAir.itemId,'vt-source')
  await wait('Passagem não confirmou PGM nativo',async()=>(await state()).state.onAir?.itemId==='vt-target'&&ledger.read(firstRequest)?.state==='CONFIRMED',15_000)
  const after=await state();assert.equal(after.state.rundownId,'target')
  const checkpoint=JSON.parse((database.sqlite.prepare('SELECT payload FROM channel_checkpoints WHERE channel_id=?').get('boundary') as any).payload)
  assert.equal(checkpoint.itemId,'vt-target');assert.equal(checkpoint.revisionId,targetRevision)
  await wait('As-run não registrou saída da origem',()=>Boolean(database.sqlite.prepare("SELECT 1 FROM as_run WHERE item_id='vt-source' AND ended_by='PLAYLIST_BOUNDARY' AND execution_kind='NATIVE'").get()))
  const phaseCount=(database.sqlite.prepare("SELECT count(*) n FROM operator_decisions WHERE kind='PLAYLIST_BOUNDARY_PHASE'").get() as any).n
  assert.equal(phaseCount,3,'Claim/SWITCH/CONFIRMED devem ocorrer uma única vez')
  await transport({action:'stop'});await api('/channels/boundary/load-rundown',{rundownId:'source'})
  const secondRequest=randomUUID(),secondReview=(await planReview()).review
  await api('/channels/boundary/next-playlist',{...command,requestId:secondRequest,reviewToken:secondReview.token})
  await transport({action:'take',itemId:'vt-source'})
  const targetAsset=database.sqlite.prepare('SELECT content_hash hash FROM media_assets WHERE id=?').get('asset-target') as {hash:string}
  database.db.insert(qcDecisions).values({id:randomUUID(),assetId:'asset-target',contentHash:targetAsset.hash,channelId:'boundary',status:'BLOCKED',notes:'QA: impedir entrada após autorização',checks:{playable:false,errors:['Bloqueio QA'],warnings:[]},actor:'qa',createdAt:new Date().toISOString()}).run()
  await wait('QC alterado não impediu a passagem',()=>ledger.read(secondRequest)?.state==='FAILED',30_000)
  assert.equal((await state()).state.onAir.itemId,'vt-source','Falha trocou ou limpou PGM')
  assert.equal((await api('/channels/boundary/next-playlist')).current.state,'FAILED')
  await transport({action:'stop'})
  await api('/channels/boundary/next-playlist',{action:'CANCEL',requestId:secondRequest})
  database.db.insert(qcDecisions).values({id:randomUUID(),assetId:'asset-target',contentHash:targetAsset.hash,channelId:'boundary',status:'APPROVED',notes:'QA: liberar para ensaio de recuperação',checks:{playable:true,errors:[],warnings:[]},actor:'qa',createdAt:new Date().toISOString()}).run()
  const thirdRequest=randomUUID(),thirdReview=(await planReview()).review
  await api('/channels/boundary/next-playlist',{...command,requestId:thirdRequest,reviewToken:thirdReview.token})
  await transport({action:'take',itemId:'vt-source'})
  await wait('Cursor nativo não persistiu',()=>{
    const saved=database.sqlite.prepare('SELECT payload FROM channel_checkpoints WHERE channel_id=?').get('boundary') as any
    return saved && JSON.parse(saved.payload).elapsed>=25
  })
  const oldEngine=(await api('/processes')).processes.find((row:any)=>row.kind==='ENGINE'&&row.channelId==='boundary').pid
  // Inject a durable interrupted claim without sending a TAKE. This models the
  // crash window and proves restart does not blindly replay the old checkpoint;
  // it is not evidence of a real physical cut or remote-host fencing.
  ledger.phase(thirdRequest,['QUEUED'],'PREPARING',()=>true,{processOwner:JSON.stringify({host:hostname(),pid:child!.pid,enginePid:oldEngine,boot:randomUUID()})})
  ledger.phase(thirdRequest,['PREPARING'],'SWITCHING',()=>true)
  await stopServer();await start()
  assert.equal((await state()).state.playing,false,'Checkpoint antigo voltou ao ar sobre passagem incerta')
  assert.equal(ledger.read(thirdRequest)?.state,'SWITCHING')
  assert.ok((await snapshot()).live.alerts.some((entry:any)=>String(entry.message).includes('sem conclusão durável')))
  await api('/channels/boundary/next-playlist',{action:'CANCEL',requestId:thirdRequest},409)
  await api('/channels/boundary/next-playlist',{action:'RECONCILE',requestId:thirdRequest})
  assert.equal(ledger.read(thirdRequest)?.state,'CANCELLED');assert.equal((await state()).state.playing,false)
  console.log(JSON.stringify({result:'PASS',evidence:'COMPILED_SERVER_REAL_NATIVE_FILES_NULL_OUTPUT',directory,port,servers,engines:[...engines],sourceRevision,targetRevision,queuedIntentSurvivesRestartWithoutTake:true,duplicateDoesNotReplay:true,targetPrerollBeforeEos:true,nativeProgramAndCheckpointConfirmed:true,asRunBoundaryReason:true,frozenTargetSurvivesEditorialChanges:true,qcChangePreservesOldProgram:true,injectedUncertainClaimBlocksCheckpointReplay:true,reconciliationRequiresStoppedChannelAndDeadLocalOwners:true,physicalOutputValidated:false,previewPublisherEnabled:false,coldStartMeasured:false}))
}finally{
  child?.kill('SIGKILL')
  for(const pid of engines)if(alive(pid)){try{process.kill(pid)}catch{}}
  database.sqlite.close()
}
