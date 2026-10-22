import assert from 'node:assert/strict'
import {spawn,type ChildProcess} from 'node:child_process'
import {mkdtemp,mkdir,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createServer} from 'node:net'
import {createHash} from 'node:crypto'
import {openDatabase} from '../apps/server/src/db/client.js'
import {validateBackupRestore} from '../apps/server/src/domain/backup.js'
import {getLiveSource} from '../apps/server/src/domain/srt.js'

// Two own compiled processes, one private SQLite fixture. This is NOT HA,
// replicated storage, a live decoder, browser playback or physical qualification.
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(tmpdir(),'RPlayout-live-source-reviews-'))
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json')
const file=join(directory,'qa.db'),media=join(directory,'media');await mkdir(media)
const database=openDatabase(file),now=new Date().toISOString()
for(const id of ['a','b'])database.sqlite.prepare('INSERT INTO channels(id,name,width,height,rate_num,rate_den,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,'Estúdio çãó '+id,320,180,25,1,-23,-1,5,now)
database.sqlite.prepare('INSERT INTO rundowns(id,channel_id,name,date,planned_start,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('rd-a','a','Fixture de transporte',now.slice(0,10),0,now,now)
database.sqlite.prepare('INSERT INTO rundown_items(id,rundown_id,sort_order,type,title,source_ref,duration_override,min_duration,anchor,on_overrun,locked,auto_next,loop) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run('live-a','rd-a',0,'LIVE','SIMULATED NOT PHYSICAL','ndi:SIMULATED_NOT_PHYSICAL',150000,0,'{"kind":"FLOW"}','PUSH',0,0,0)
interface Station {port:number;child:ChildProcess|null;pids:number[];logs:string}
const stations:Station[]=[],ports=new Set<number>()
async function freePort(){
  for(;;){const socket=createServer();await new Promise<void>(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=(socket.address() as {port:number}).port;await new Promise<void>((resolve,reject)=>socket.close(error=>error?reject(error):resolve()));if(!ports.has(port)){ports.add(port);return port}}
}
for(let index=0;index<2;index++)stations.push({port:await freePort(),child:null,pids:[],logs:''})
async function call(station:Station,path:string,body?:object,method=body?'POST':'GET',expected=200,etag?:string){
  const response=await fetch(`http://127.0.0.1:${station.port}${path}`,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(etag?{'If-Match':etag}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10_000)})
  const text=await response.text();assert.ok(!text.includes('PRIVATE_FIXTURE_SECRET'),'Private fixture marker leaked')
  if(expected!==0)assert.equal(response.status,expected,`${method} ${path}: unexpected HTTP ${response.status}`)
  return {status:response.status,value:JSON.parse(text),etag:response.headers.get('etag')!,cache:response.headers.get('cache-control')}
}
async function start(station:Station){
  station.logs=''
  const child=spawn(process.execPath,[join(root,'apps/server/dist/server.cjs')],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,
    RPLAYOUT_DB:file,RPLAYOUT_VAULT_FILE:join(directory,'vault.json'),RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_MEDIA:media,
    RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_CACHE:join(directory,'cache'),RPLAYOUT_BACKUPS:join(directory,'backups'),
    RPLAYOUT_ENGINE:'',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_DEVICES:'',RPLAYOUT_RELAY:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_N1_PEER:'',RPLAYOUT_BACKUP_HOURS:'0',
    RPLAYOUT_HA_ROLE:'',RPLAYOUT_HA_PEER:'',RPLAYOUT_ADMIN_USER:'',RPLAYOUT_ADMIN_PASSWORD:'',RPLAYOUT_ROLE:'ADMIN',RPLAYOUT_CONTROL_TOKEN:'',HOST:'127.0.0.1',PORT:String(station.port),LOG_LEVEL:'warn'}})
  station.child=child;if(child.pid)station.pids.push(child.pid)
  child.stdout?.on('data',chunk=>station.logs=(station.logs+String(chunk)).slice(-8000));child.stderr?.on('data',chunk=>station.logs=(station.logs+String(chunk)).slice(-8000));child.on('error',error=>station.logs+=error.message)
  const deadline=performance.now()+20_000
  while(performance.now()<deadline){assert.equal(child.exitCode,null,'Own compiled server exited');try{if((await call(station,'/api/health')).value.ok)return}catch{}await new Promise(resolve=>setTimeout(resolve,100))}
  throw new Error('Own compiled server did not become ready')
}
async function stop(station:Station){
  const child=station.child;station.child=null
  if(child&&child.exitCode===null&&child.signalCode===null){const closed=new Promise<void>(resolve=>child.once('exit',()=>resolve()));child.kill('SIGKILL');await closed}
}
function state(){
  return {
    rows:database.sqlite.prepare('SELECT * FROM live_sources ORDER BY id').all(),
    versions:database.sqlite.prepare('SELECT * FROM live_source_versions ORDER BY channel_id').all(),
    projectVersions:database.sqlite.prepare('SELECT * FROM channel_project_versions ORDER BY channel_id').all(),
    successAudit:database.sqlite.prepare("SELECT * FROM operator_decisions WHERE kind='LIVE_SOURCE_EDITED' ORDER BY rowid").all(),
  }
}
let evidence:Record<string,unknown>|null=null
let socket:WebSocket|null=null,latest:any=null,sequence=0
async function liveAfter(previous:number){
  const deadline=performance.now()+10_000
  while(performance.now()<deadline){if(sequence>previous&&latest)return latest.transport;await new Promise(resolve=>setTimeout(resolve,50))}
  throw new Error('No fresh simulated live telemetry')
}
try{
  const [a,b]=stations as [Station,Station]
  await start(a);await start(b)
  const path='/api/channels/a/live-source-review',first=await call(a,path),second=await call(b,path)
  assert.equal(first.cache,'private, no-store');assert.equal(second.etag,first.etag)
  const readBefore=state();assert.deepEqual((await call(a,path)).value,first.value);assert.deepEqual(state(),readBefore)
  const body={channelId:'a',kind:'SRT',name:'EXTERNA ÇÃO',targetUrl:'srt://127.0.0.1:9000?passphrase=PRIVATE_FIXTURE_SECRET'}
  await call(a,'/api/sources/live',body,'POST',428);assert.deepEqual(state(),readBefore)
  const results=await Promise.all([call(a,'/api/sources/live',body,'POST',0,first.etag),call(b,'/api/v1/sources/live',body,'POST',0,second.etag)])
  assert.deepEqual(results.map(result=>result.status).sort(),[201,409])
  const winner=results.find(result=>result.status===201)!.value,sourcePath=`/api/sources/live/${winner.id}`
  assert.equal(state().rows.length,1);assert.equal(state().successAudit.length,1);assert.equal(winner.automaticTake,false);assert.equal(winner.physicalSignalValidated,false)
  const old=await call(a,path)
  database.sqlite.prepare('UPDATE live_sources SET name=? WHERE id=?').run('Mudança externa',winner.id)
  database.sqlite.prepare('UPDATE live_sources SET name=? WHERE id=?').run(winner.name,winner.id)
  const afterAba=state();await call(b,sourcePath,{name:'Rascunho antigo'},'PUT',409,old.etag);assert.deepEqual(state(),afterAba)
  const fresh=await call(b,path),foreign=await call(a,'/api/channels/b/live-source-review')
  await call(a,sourcePath,{name:'Dono errado'},'PUT',400,foreign.etag)
  await call(a,sourcePath,{channelId:'b',name:'Mover indevidamente'},'PUT',400,fresh.etag)
  assert.deepEqual(state(),afterAba)
  database.sqlite.exec("CREATE TRIGGER fixture_live_source_audit_fail BEFORE INSERT ON operator_decisions WHEN NEW.kind='LIVE_SOURCE_EDITED' BEGIN SELECT RAISE(ABORT,'live-source-audit-fixture'); END")
  for(const [method,url,payload] of [['POST','/api/sources/live',body],['PUT',sourcePath,{name:'Falha de auditoria'}],['DELETE',sourcePath,undefined]] as const){
    const before=state(),review=await call(a,path)
    await call(a,url,payload,method,500,review.etag);assert.deepEqual(state(),before)
  }
  database.sqlite.exec('DROP TRIGGER fixture_live_source_audit_fail')
  socket=new WebSocket(`ws://127.0.0.1:${a.port}/ws`)
  socket.addEventListener('error',()=>{})
  socket.addEventListener('message',event=>{
    const text=String(event.data);assert.ok(!text.includes('PRIVATE_FIXTURE_SECRET'),'Private marker leaked in telemetry')
    const message=JSON.parse(text)
    if(message.type==='live'&&message.channelId==='a'){latest=message;sequence++}
  })
  await liveAfter(0)
  await call(a,'/api/channels/a/transport',{action:'cue',sourceRef:'ndi:SIMULATED_NOT_PHYSICAL'})
  await call(a,'/api/channels/a/transport',{action:'take'})
  const cue=await call(a,'/api/channels/a/transport',{action:'cue',sourceRef:'ndi:SIMULATED_OTHER_PREVIEW'})
  const transportBefore=cue.value.live.transport
  assert.equal(transportBefore.onAir.itemId,'live-a');assert.equal(transportBefore.preview.source,'ndi:SIMULATED_OTHER_PREVIEW')
  const previousSequence=sequence
  const rename=await call(b,sourcePath,{name:'APELIDO ÇÃO',targetUrl:winner.controlRef},'PUT',200,fresh.etag)
  assert.equal(rename.value.name,'APELIDO ÇÃO')
  assert.equal(rename.value.controlRef.split(':')[3].split('.')[0],winner.controlRef.split(':')[3].split('.')[0],'Stable source identity, not random ciphertext, must match across processes')
  assert.equal((await getLiveSource(database.db,winner.id,true))?.targetUrl,body.targetUrl)
  const transportAfter=await liveAfter(previousSequence)
  assert.deepEqual(transportAfter.preview,transportBefore.preview);assert.equal(transportAfter.onAir.itemId,transportBefore.onAir.itemId)
  assert.equal(transportAfter.playing,transportBefore.playing)
  const beforeRestart=(await call(a,path)).etag
  await stop(b);await start(b)
  assert.equal((await call(b,path)).etag,beforeRestart)
  const beforeDelete=await call(b,path)
  await call(b,sourcePath,undefined,'DELETE',200,beforeDelete.etag)
  assert.equal(state().rows.length,0)
  const backup=join(directory,'validated-backup.db');await database.sqlite.backup(backup)
  const restored=await validateBackupRestore(backup);assert.equal(restored.integrity,'ok');assert.equal(restored.foreignKeys,'ok')
  evidence={result:'PASS',evidence:'COMPILED_LIVE_SOURCE_ORIGINAL_REVISION',directory,ports:stations.map(station=>station.port),pids:stations.flatMap(station=>station.pids),serverSha256:createHash('sha256').update(await readFile(join(root,'apps/server/dist/server.cjs'))).digest('hex'),
    simultaneousSingleWinner:true,staleAbaRejected:true,blindEditRejected:true,foreignOwnerRejected:true,createUpdateDeleteAuditRollback:true,credentialPreserved:true,previewAndProgramPreserved:true,restartRevisionPreserved:true,backupValidated:true,
    transport:'SIMULATED',automaticTake:false,mediaDecoded:false,physicalSignalValidated:false,browserValidated:false,replicationValidated:false}
}finally{socket?.close();for(const station of stations)await stop(station);database.sqlite.close()}
if(evidence){for(const station of stations)await assert.rejects(()=>fetch(`http://127.0.0.1:${station.port}/api/health`,{signal:AbortSignal.timeout(2000)}));console.log(JSON.stringify({...evidence,ownChildrenAndListenersClosed:true}))}
