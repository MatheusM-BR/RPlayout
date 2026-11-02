import assert from 'node:assert/strict'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { createServer } from 'node:net'

// Abruptly terminate only a server and its engines created by this test.
// No live board, network publisher, operational database or operator port.
const workspace=fileURLToPath(new URL('..',import.meta.url))
const packageArgument=process.argv.indexOf('--package')
const verifyContingency=process.argv.includes('--contingency')
const installRoot=packageArgument>=0 ? resolve(process.argv[packageArgument+1]!) : workspace
const directory=await mkdtemp(join(tmpdir(),'RPlayout-server-recovery-'))
const media=join(directory,'media');await mkdir(media)
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json')
const gstRoot=packageArgument>=0 ? join(installRoot,'runtime/gstreamer') : process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64 ?? 'C:/Program Files/gstreamer/1.0/msvc_x86_64'
const gstBin=join(gstRoot,'bin'),mediaPath=join(media,'QUEDA-SERVIDOR-ÇÃO.mp4')
const run=promisify(execFile)
await run(join(gstBin,'gst-launch-1.0.exe'),['-q','videotestsrc','num-buffers=1500','!','video/x-raw,width=320,height=180,framerate=25/1','!','videoconvert','!','x264enc','speed-preset=ultrafast','!','h264parse','!','mp4mux','!','filesink',`location=${mediaPath.replaceAll('\\','/')}`],{timeout:30_000,windowsHide:true})
const {openDatabase}=await import('../apps/server/src/db/client.js')
const {getChannel}=await import('../apps/server/src/db/repo.js')
const {publishOperationalPlaylist}=await import('../apps/server/src/domain/operational-playlist.js')
const {secondaryEvents}=await import('../apps/server/src/db/schema.js')
const database=openDatabase(join(directory,'recovery.db'))
let child:ChildProcess|null=null, socket:WebSocket|null=null
const ownedEngines=new Set<number>()
let output=''
const listener=createServer();await new Promise<void>(resolve=>listener.listen(0,'127.0.0.1',resolve))
const port=(listener.address() as {port:number}).port;await new Promise<void>(resolve=>listener.close(()=>resolve()))
const base=`http://127.0.0.1:${port}`
function alive(pid:number):boolean {try {process.kill(pid,0);return true}catch{return false}}
async function wait(description:string,check:()=>boolean|Promise<boolean>,timeout=20_000) {
  const end=performance.now()+timeout
  while(performance.now()<end) {if(await check())return;await new Promise(resolve=>setTimeout(resolve,100))}
  throw new Error(description+'; últimos diagnósticos: '+output.slice(-3000))
}
async function api(path:string,body?:object) {
  let response:Response
  try {response=await fetch(base+path,{...(body ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {}),signal:AbortSignal.timeout(5000)})}
  catch(error) {throw new Error(`Falha HTTP em ${path}; evidência ${directory}: ${error instanceof Error ? error.message : String(error)}; diagnósticos: ${output.slice(-3000)}`)}
  const value=await response.json()
  assert.ok(response.ok,`${path}: ${response.status} ${JSON.stringify(value)}`)
  return value as any
}
function start() {
  output=''
  const node=packageArgument>=0 ? join(installRoot,'runtime/node/node.exe') : process.execPath
  child=spawn(node,[join(installRoot,'apps/server/dist/server.cjs')],{cwd:installRoot,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,
    RPLAYOUT_DB:join(directory,'recovery.db'),RPLAYOUT_INSTALL_ROOT:installRoot,RPLAYOUT_MEDIA:media,RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_CACHE:join(directory,'cache'),RPLAYOUT_BACKUPS:join(directory,'backups'),
    RPLAYOUT_ENGINE:join(installRoot,'apps/engine/target/release/rplayout-engine.exe'),RPLAYOUT_ENGINE_OUTPUT:'null',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_DEVICES:'',RPLAYOUT_RELAY:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_N1_PEER:'',RPLAYOUT_BACKUP_HOURS:'0',
    RPLAYOUT_ADMIN_USER:'',RPLAYOUT_ADMIN_PASSWORD:'',RPLAYOUT_ROLE:'ADMIN',RPLAYOUT_CONTROL_TOKEN:'',GSTREAMER_1_0_ROOT_MSVC_X86_64:gstRoot,GST_PLUGIN_PATH:join(gstRoot,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gstRoot,'lib/gstreamer-1.0'),GST_PLUGIN_SCANNER:join(gstRoot,'libexec/gstreamer-1.0/gst-plugin-scanner.exe'),GST_REGISTRY:join(directory,'gst-registry.bin'),PATH:packageArgument>=0 ? [gstBin,join(process.env.SystemRoot!,'System32'),process.env.SystemRoot!,join(process.env.SystemRoot!,'System32/WindowsPowerShell/v1.0')].join(';') : gstBin+';'+process.env.PATH,PORT:String(port),HOST:'127.0.0.1',LOG_LEVEL:'warn'}})
  for(const stream of [child.stdout,child.stderr]) stream?.on('data',chunk=>{output=(output+chunk.toString()).slice(-16_000)})
  child.on('error',error=>{output+='\n'+error.message})
}
async function enginePid() {
  const result=await api('/api/processes'), row=result.processes.find((row:any)=>row.kind==='ENGINE' && row.channelId==='recovery')
  assert.equal(row?.details?.transport,'NATIVE');assert.ok(Number.isInteger(row.pid))
  ownedEngines.add(row.pid);return row.pid as number
}
function checkpoint() {const row=database.sqlite.prepare('SELECT payload FROM channel_checkpoints WHERE channel_id=?').get('recovery') as {payload:string}|undefined;return row ? JSON.parse(row.payload) : null}
try {
  const now=new Date().toISOString(),hash=createHash('sha256').update(await readFile(mediaPath)).digest('hex')
  database.sqlite.prepare('INSERT INTO channels (id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run('recovery','Queda isolada',25,1,320,180,-23,-1,5,now)
  database.sqlite.prepare('INSERT INTO rundowns (id,channel_id,name,planned_start,date,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run('rd','recovery','Teste',0,now.slice(0,10),now,now)
  database.sqlite.prepare('INSERT INTO media_assets (id,content_hash,path,title,kind,duration_frames,duration_ns,width,height,rate_num,rate_den,interlace_mode,has_audio,qc_status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('asset',hash,mediaPath,'QUEDA','VIDEO',1500,60_000_000_000,320,180,25,1,'progressive',0,'APPROVED',now)
  database.sqlite.prepare('INSERT INTO rundown_items (id,rundown_id,sort_order,title,type,media_id,anchor,on_overrun,min_duration,auto_next,loop,locked) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run('vt','rd',0,'VT teste','VT','asset',JSON.stringify({kind:'FLOW'}),'PUSH',0,0,0,0)
  await database.db.insert(secondaryEvents).values({id:'secondary',channelId:'recovery',itemId:'vt',definition:{id:'secondary',rundownItemId:'vt',name:'Logo publicado',targetLayer:'STATION_LOGO',type:'GRAPHICS_OVERLAY',triggerMode:'OFFSET_FROM_START',offsetFrames:0,templateId:'',payload:{title:'RECUPERAÇÃO'},enabled:true},createdAt:now,updatedAt:now})
  const revision=await publishOperationalPlaylist(database.db,(await getChannel(database.db,'recovery'))!,'rd','@server-crash-test')
  const coldStarted=performance.now();start()
  // Fresh package registry discovery precedes native Ready. Prove first boot
  // with the actual cold registry, not by warming global plugins in advance.
  await wait('Servidor nativo não inicializou',async()=>{try{return (await api('/api/health')).engines===1}catch{return false}},90_000)
  const coldStartMs=Math.round(performance.now()-coldStarted),bootHealth=(await api('/api/n1/state')).channels.find((row:any)=>row.channelId==='recovery')?.health
  assert.equal(bootHealth?.stalls,0,'A primeira partida não pode depender de watchdog matar um engine saudável.')
  assert.equal(bootHealth?.restarts,0,'A primeira partida não pode exigir reinício implícito.')
  const oldEngine=await enginePid()
  // A headless fakesink has no PVW network bus. This test exercises explicit
  // item TAKE/recovery, not the separately tested CUE or physical preview.
  await api('/api/channels/recovery/transport',{action:'take',itemId:'vt'})
  await wait('PGM não persistiu posição/identidade',()=>Boolean(checkpoint()?.playing && checkpoint().elapsed>=50 && checkpoint().executionId))
  await wait('Evento não foi registrado',()=>Boolean(database.sqlite.prepare("SELECT 1 FROM secondary_event_runs WHERE state='EXECUTED'").get()))
  const saved=checkpoint(),oldServer=child!.pid!
  child!.kill('SIGKILL')
  await wait('Servidor de teste não encerrou',()=>!alive(oldServer))
  await wait('Engine ficou órfão após queda do servidor',()=>!alive(oldEngine),10_000)
  start()
  let recovered:any
  await wait('Novo servidor não restaurou PGM',async()=>{try {const state=await api('/api/n1/state');recovered=state.channels.find((row:any)=>row.channelId==='recovery');return recovered?.health.ready && recovered?.state.onAir?.itemId==='vt' && recovered.state.onAir.elapsed>=saved.elapsed}catch{return false}})
  const newEngine=await enginePid();assert.notEqual(newEngine,oldEngine)
  await wait('Checkpoint de execução não foi conservado',()=>checkpoint()?.executionId===saved.executionId && checkpoint()?.elapsed>=saved.elapsed)
  assert.equal(checkpoint().revisionId,revision.id)
  let snapshotSeen=false
  socket=new WebSocket(base.replace('http:','ws:')+'/ws')
  socket.addEventListener('error',()=>{})
  socket.addEventListener('message',event=>{const value=JSON.parse(String(event.data));if(value.type==='live' && value.channelId==='recovery' && value.transport?.onAir?.itemId==='vt') snapshotSeen=true})
  await wait('Snapshot WebSocket não mostrou o PGM recuperado',()=>snapshotSeen)
  assert.equal((database.sqlite.prepare('SELECT count(*) n FROM secondary_event_runs').get() as {n:number}).n,1)
  await api('/api/channels/recovery/transport',{action:'stop'})
  await wait('STOP não foi persistido',()=>checkpoint()?.playing===false && checkpoint()?.itemId===null)
  const asRun=database.sqlite.prepare('SELECT revision_id,start_position_frames,ended_by FROM as_run ORDER BY rowid').all() as Array<{revision_id:string;start_position_frames:number;ended_by:string}>
  assert.equal(asRun.length,2);assert.equal(asRun[0]!.ended_by,'RESTART');assert.equal(asRun[1]!.start_position_frames,saved.elapsed)
  assert.ok(asRun.every(row=>row.revision_id===revision.id))
  let contingencyEvidence: Record<string, unknown>|null=null
  if(verifyContingency) {
    // Own isolated channel only: published local file reserve, no real outputs.
    const {ContinuityCache}=await import('../apps/server/src/domain/continuity-cache.js')
    const cache=new ContinuityCache(join(directory,'cache'))
    assert.equal((await cache.warm([{id:'asset',contentHash:hash,path:mediaPath,kind:'VIDEO'}],{protect:true})).cached,1)
    database.sqlite.prepare('INSERT INTO rundowns (id,channel_id,name,planned_start,loop,date,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run('reserve','recovery','Reserva verificada',0,1,now.slice(0,10),now,now)
    for(const [index,id] of ['backup-1','backup-2'].entries()) database.sqlite.prepare('INSERT INTO rundown_items (id,rundown_id,sort_order,title,type,media_id,trim,anchor,on_overrun,min_duration,auto_next,loop,locked) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id,'reserve',index,id,'VT','asset',JSON.stringify({in:index*75,out:(index+1)*75}),JSON.stringify({kind:'FLOW'}),'PUSH',0,1,0,0)
    const reserve=await publishOperationalPlaylist(database.db,(await getChannel(database.db,'recovery'))!,'reserve','@contingency-test')
    await api('/api/channels/recovery/transport',{action:'take',itemId:'vt'})
    await wait('VT inicial não confirmou cursor',()=>checkpoint()?.itemId==='vt' && checkpoint()?.elapsed>=25)
    const beforeConfiguration=checkpoint()
    await api('/api/v1/engineering/pgm-probe/contingency-loop',{channelId:'recovery',action:'CONFIGURE',revisionId:reserve.id})
    assert.equal(checkpoint().revisionId,revision.id);assert.equal(checkpoint().itemId,'vt');assert.equal(checkpoint().executionId,beforeConfiguration.executionId)
    await api('/api/v1/engineering/pgm-probe/contingency-loop',{channelId:'recovery',action:'ENTER'})
    await wait('Loop não confirmou origem durável',()=>checkpoint()?.revisionId===reserve.id && checkpoint()?.contingency?.itemId==='vt')
    const origin=checkpoint().contingency
    assert.ok(origin.elapsed>=beforeConfiguration.elapsed);assert.equal(origin.revisionId,revision.id)
    await wait('Playlist de dois arquivos não fez um ciclo completo',()=>Number((database.sqlite.prepare('SELECT count(*) n FROM as_run WHERE revision_id=?').get(reserve.id) as {n:number}).n)>=3,15_000)
    const loopSaved=checkpoint(),loopServer=child!.pid!,loopEngine=await enginePid()
    child!.kill('SIGKILL');await wait('Servidor do loop não encerrou',()=>!alive(loopServer));await wait('Engine de loop ficou órfão',()=>!alive(loopEngine),10_000)
    start()
    await wait('Loop não foi recuperado após crash',()=>Boolean(checkpoint()?.playing && checkpoint()?.revisionId===reserve.id && checkpoint()?.executionId===loopSaved.executionId && checkpoint()?.elapsed>=loopSaved.elapsed))
    await wait('Novo engine do loop não ficou pronto',async()=>{try{return (await api('/api/health')).engines===1 && (await api('/api/n1/state')).channels.find((row:any)=>row.channelId==='recovery')?.health.ready}catch{return false}})
    const recoveredLoopEngine=await enginePid();assert.notEqual(recoveredLoopEngine,loopEngine)
    const loopStatus=await api('/api/v1/engineering/pgm-probe/contingency-loop?channelId=recovery')
    assert.ok(loopStatus.origin?.active);assert.deepEqual(checkpoint().contingency,origin)
    await api('/api/v1/engineering/pgm-probe/contingency-loop',{channelId:'recovery',action:'RETURN'})
    await wait('Retorno não confirmou o VT original',()=>checkpoint()?.itemId==='vt' && checkpoint()?.revisionId===revision.id && !checkpoint()?.contingency)
    const returned=checkpoint();assert.ok(returned.elapsed>=origin.elapsed)
    await wait('As-run não registrou retorno de contingência',()=>Boolean(database.sqlite.prepare("SELECT 1 FROM as_run WHERE ended_by='CONTINGENCY_RETURN'").get()))
    const resumed=database.sqlite.prepare('SELECT revision_id,start_position_frames FROM as_run ORDER BY rowid DESC LIMIT 1').get() as {revision_id:string;start_position_frames:number}
    assert.equal(resumed.revision_id,revision.id);assert.equal(resumed.start_position_frames,origin.elapsed)
    await api('/api/channels/recovery/transport',{action:'stop'})
    await wait('STOP final não confirmou',()=>checkpoint()?.playing===false && !checkpoint()?.contingency)
    contingencyEvidence={publishedReserve:reserve.id,configurationPreservedPgm:true,completeTwoFileCycle:true,origin,crashedServer:loopServer,crashedEngine:loopEngine,recoveredEngine:recoveredLoopEngine,originSurvivedCrash:true,returnedFrames:returned.elapsed,resumed,physicalOutputValidated:false}
  }
  console.log(JSON.stringify({result:'PASS',evidence:'COMPILED_SERVER_CRASH_AND_NATIVE_ENGINE_RECOVERY',installRoot,directory,port,coldStart:{milliseconds:coldStartMs,stalls:bootHealth.stalls,restarts:bootHealth.restarts},oldServer,oldEngine,newServer:child!.pid,newEngine,savedFrames:saved.elapsed,recoveredFrames:recovered.state.onAir.elapsed,executionId:saved.executionId,revisionId:revision.id,secondaryDispatchesBeforeContingency:1,webSocketSnapshot:true,stopCheckpoint:true,asRun,contingency:contingencyEvidence,physicalOutputValidated:false}))
} finally {
  socket?.close();child?.kill('SIGKILL')
  for(const pid of ownedEngines) if(alive(pid)) {try {process.kill(pid)}catch{}}
  database.sqlite.close()
}
