import assert from 'node:assert/strict'
import {spawn,type ChildProcess} from 'node:child_process'
import {mkdtemp,mkdir,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createServer} from 'node:net'
import {createHash} from 'node:crypto'
import {openDatabase} from '../apps/server/src/db/client.js'
import {multiviewConfigs} from '../apps/server/src/db/schema.js'
import {validateBackupRestore} from '../apps/server/src/domain/backup.js'

// Two own compiled processes, one private fixture. Not HA/replication,
// decoded media, browser playback or hardware qualification.
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(tmpdir(),'RPlayout-multiview-reviews-'))
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json')
const file=join(directory,'qa.db'),media=join(directory,'media');await mkdir(media)
const database=openDatabase(file),now=new Date().toISOString()
for(const id of ['a','b','default'])database.sqlite.prepare('INSERT INTO channels(id,name,width,height,rate_num,rate_den,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,'Estúdio çãó '+id,320,180,25,1,-23,-1,5,now)
database.sqlite.prepare('INSERT INTO rundowns(id,channel_id,name,date,planned_start,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('rd-a','a','Simulated transport fixture',now.slice(0,10),0,now,now)
database.sqlite.prepare('INSERT INTO rundown_items(id,rundown_id,sort_order,type,title,source_ref,duration_override,min_duration,anchor,on_overrun,locked,auto_next,loop) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run('live-a','rd-a',0,'LIVE','SIMULATED NOT PHYSICAL','ndi:SIMULATED_NOT_PHYSICAL',150000,0,'{"kind":"FLOW"}','PUSH',0,0,0)
const privateUrl='srt://127.0.0.1:9000?passphrase=PRIVATE_MV_FIXTURE'
database.db.insert(multiviewConfigs).values({id:'mv-default',channelId:'default',layout:'GRID_1_PLUS_3',cells:[{id:'legacy',name:'Metadata only',sourceUrl:privateUrl,tally:'ON_AIR',audioPeakDb:[-12,-12],syncState:'LOCKED'}],updatedAt:'original'}).run()
interface Station {port:number;child:ChildProcess|null;pids:number[];logs:string}
const stations:Station[]=[],ports=new Set<number>()
async function freePort(){for(;;){const socket=createServer();await new Promise<void>(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=(socket.address() as {port:number}).port;await new Promise<void>(resolve=>socket.close(()=>resolve()));if(!ports.has(port)){ports.add(port);return port}}}
for(let i=0;i<2;i++)stations.push({port:await freePort(),child:null,pids:[],logs:''})
async function call(station:Station,path:string,body?:object,method=body?'PUT':'GET',expected=200,etag?:string){
  const response=await fetch(`http://127.0.0.1:${station.port}${path}`,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(etag?{'If-Match':etag}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10_000)})
  const text=await response.text();assert.ok(!text.includes('PRIVATE_MV_FIXTURE'),'Private fixture URL leaked')
  if(expected!==0)assert.equal(response.status,expected,`${method} ${path}: HTTP ${response.status}`)
  return {status:response.status,value:JSON.parse(text),etag:response.headers.get('etag')!,cache:response.headers.get('cache-control')}
}
async function start(station:Station){
  station.logs='';const child=spawn(process.execPath,[join(root,'apps/server/dist/server.cjs')],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,
    RPLAYOUT_DB:file,RPLAYOUT_VAULT_FILE:join(directory,'vault.json'),RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_MEDIA:media,
    RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_CACHE:join(directory,'cache'),RPLAYOUT_BACKUPS:join(directory,'backups'),
    RPLAYOUT_ENGINE:'',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_DEVICES:'',RPLAYOUT_RELAY:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_N1_PEER:'',RPLAYOUT_BACKUP_HOURS:'0',
    RPLAYOUT_HA_ROLE:'',RPLAYOUT_HA_PEER:'',RPLAYOUT_ADMIN_USER:'',RPLAYOUT_ADMIN_PASSWORD:'',RPLAYOUT_ROLE:'ADMIN',RPLAYOUT_CONTROL_TOKEN:'',HOST:'127.0.0.1',PORT:String(station.port),LOG_LEVEL:'warn'}})
  station.child=child;if(child.pid)station.pids.push(child.pid)
  child.stdout?.on('data',chunk=>station.logs=(station.logs+String(chunk)).slice(-8000));child.stderr?.on('data',chunk=>station.logs=(station.logs+String(chunk)).slice(-8000));child.on('error',error=>station.logs+=error.message)
  const deadline=performance.now()+20_000
  while(performance.now()<deadline){
    if(child.exitCode!==null)throw new Error(`Own compiled child exited: ${station.logs.replaceAll(privateUrl,'[private fixture]').replaceAll('PRIVATE_MV_FIXTURE','[redacted]').slice(-4000)}`)
    try{if((await call(station,'/api/health')).value.ok)return}catch{}
    await new Promise(resolve=>setTimeout(resolve,100))
  }
  throw new Error('Own compiled server not ready')
}
async function stop(station:Station){const child=station.child;station.child=null;if(child&&child.exitCode===null&&child.signalCode===null){const exited=new Promise<void>(resolve=>child.once('exit',()=>resolve()));child.kill('SIGKILL');await exited}}
const state=()=>({rows:database.sqlite.prepare('SELECT * FROM multiview_configs ORDER BY id').all(),versions:database.sqlite.prepare('SELECT * FROM multiview_versions ORDER BY scope').all(),projects:database.sqlite.prepare('SELECT * FROM channel_project_versions ORDER BY channel_id').all(),success:database.sqlite.prepare("SELECT * FROM operator_decisions WHERE kind='MULTIVIEW_EDITED' ORDER BY rowid").all()})
let evidence:Record<string,unknown>|null=null,socket:WebSocket|null=null,sequence=0,latest:any=null
async function after(previous:number){const end=performance.now()+10_000;while(performance.now()<end){if(sequence>previous&&latest)return latest.transport;await new Promise(resolve=>setTimeout(resolve,50))}throw new Error('No fresh simulated transport telemetry')}
try{
  const [a,b]=stations as [Station,Station];await start(a);await start(b)
  const path='/api/multiview/config?channelId=a',global='/api/multiview/config',first=await call(a,path),second=await call(b,path)
  assert.equal(first.cache,'private, no-store');assert.equal(first.etag,second.etag)
  const before=state();assert.deepEqual((await call(a,path)).value,first.value);assert.deepEqual(state(),before)
  assert.equal(first.value.updatedAt,null);assert.equal(first.value.id,null)
  await call(a,global,{channelId:'a',layout:'COMPACT_LIST'},'PUT',428);assert.deepEqual(state(),before)
  const results=await Promise.all([call(a,global,{channelId:'a',layout:'COMPACT_LIST'},'PUT',0,first.etag),call(b,'/api/v1/multiview/config',{channelId:'a',layout:'GRID_1_PLUS_3'},'PUT',0,second.etag)])
  assert.deepEqual(results.map(result=>result.status).sort(),[200,409]);assert.equal(state().success.length,1)
  const original=await call(a,path),row=database.sqlite.prepare('SELECT id,layout FROM multiview_configs WHERE channel_id=?').get('a') as {id:string;layout:string}
  database.sqlite.prepare('UPDATE multiview_configs SET layout=? WHERE id=?').run('GRID_2X2',row.id)
  database.sqlite.prepare('UPDATE multiview_configs SET layout=? WHERE id=?').run(row.layout,row.id)
  const afterAba=state();await call(b,global,{channelId:'a',layout:'COMPACT_LIST'},'PUT',409,original.etag);assert.deepEqual(state(),afterAba)
  const defaultPath='/api/multiview/config?channelId=default',owned=await call(a,defaultPath),globalReview=await call(a,global)
  assert.equal(globalReview.value.id,null);assert.equal(owned.value.id,'mv-default');assert.equal(owned.value.storedTelemetryIsHistorical,true);assert.equal(owned.value.physicalSignalValidated,false)
  await call(a,global,{layout:'COMPACT_LIST'},'PUT',200,globalReview.etag)
  assert.deepEqual((await call(a,defaultPath)).value,owned.value)
  const crossBefore=state();await call(a,global,{channelId:'default',layout:'GRID_2X2'},'PUT',400,(await call(a,global)).etag);assert.deepEqual(state(),crossBefore)
  database.sqlite.exec("CREATE TRIGGER fixture_mv_audit_fail BEFORE INSERT ON operator_decisions WHEN NEW.kind='MULTIVIEW_EDITED' BEGIN SELECT RAISE(ABORT,'MV_AUDIT_FIXTURE'); END")
  for(const id of ['b','a']){const previous=state(),review=await call(a,`/api/multiview/config?channelId=${id}`);await call(a,global,{channelId:id,layout:'GRID_2X2'},'PUT',500,review.etag);assert.deepEqual(state(),previous)}
  database.sqlite.exec('DROP TRIGGER fixture_mv_audit_fail')
  socket=new WebSocket(`ws://127.0.0.1:${a.port}/ws`);socket.addEventListener('error',()=>{});socket.addEventListener('message',event=>{const text=String(event.data);assert.ok(!text.includes('PRIVATE_MV_FIXTURE'));const message=JSON.parse(text);if(message.type==='live'&&message.channelId==='a'){latest=message;sequence++}})
  await after(0)
  await call(a,'/api/channels/a/transport',{action:'cue',sourceRef:'ndi:SIMULATED_NOT_PHYSICAL'},'POST')
  await call(a,'/api/channels/a/transport',{action:'take'},'POST')
  const cued=await call(a,'/api/channels/a/transport',{action:'cue',sourceRef:'ndi:SIMULATED_OTHER_PREVIEW'},'POST'),transport=cued.value.live.transport,previous=sequence
  assert.equal(transport.onAir.itemId,'live-a');assert.equal(transport.preview.source,'ndi:SIMULATED_OTHER_PREVIEW')
  await call(b,global,{channelId:'a',layout:'COMPACT_LIST'},'PUT',200,(await call(b,path)).etag)
  const next=await after(previous);assert.deepEqual(next.preview,transport.preview);assert.equal(next.onAir.itemId,transport.onAir.itemId);assert.equal(next.playing,transport.playing)
  await call(b,global,{channelId:'default',layout:'COMPACT_LIST'},'PUT',200,(await call(b,defaultPath)).etag)
  assert.equal(database.db.select().from(multiviewConfigs).all().find(row=>row.id==='mv-default')?.cells?.[0]?.sourceUrl,privateUrl)
  const restartReview=await call(a,path);await stop(b);await start(b);assert.equal((await call(b,path)).etag,restartReview.etag)
  const backup=join(directory,'backup.db');await database.sqlite.backup(backup);const valid=await validateBackupRestore(backup);assert.equal(valid.integrity,'ok');assert.equal(valid.foreignKeys,'ok')
  evidence={result:'PASS',evidence:'COMPILED_MULTIVIEW_ORIGINAL_REVIEW',directory,ports:stations.map(row=>row.port),pids:stations.flatMap(row=>row.pids),serverSha256:createHash('sha256').update(await readFile(join(root,'apps/server/dist/server.cjs'))).digest('hex'),readOnlyStable:true,singleConcurrentWinner:true,blindEditRejected:true,staleAbaRejected:true,globalDefaultOwnerIsolated:true,foreignProofRejected:true,createUpdateAuditRollback:true,historicalTelemetryNotSignal:true,privateCellsPreserved:true,previewAndProgramPreserved:true,restartRevisionPreserved:true,backupValidated:true,transport:'SIMULATED',automaticTake:false,mediaDecoded:false,physicalSignalValidated:false,browserValidated:false,replicationValidated:false}
}finally{socket?.close();for(const station of stations)await stop(station);database.sqlite.close()}
for(const station of stations)await assert.rejects(()=>fetch(`http://127.0.0.1:${station.port}/api/health`,{signal:AbortSignal.timeout(2000)}))
console.log(JSON.stringify({...evidence,ownChildrenAndListenersClosed:true}))
