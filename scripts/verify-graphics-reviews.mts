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
// Isolated compiled processes, not browser/rendering/signal or HA qualification.
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(tmpdir(),'RPlayout-graphics-reviews-'))
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json')
const file=join(directory,'qa.db'),media=join(directory,'media');await mkdir(media)
const database=openDatabase(file),now=new Date().toISOString()
for(const id of ['a','b','ch:ç'])database.sqlite.prepare('INSERT INTO channels(id,name,width,height,rate_num,rate_den,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,'Estúdio '+id,320,180,25,1,-23,-1,5,now)
database.sqlite.prepare('INSERT INTO rundowns(id,channel_id,name,date,planned_start,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('rd-a','a','SIMULATED NOT PHYSICAL',now.slice(0,10),0,now,now)
database.sqlite.prepare('INSERT INTO rundown_items(id,rundown_id,sort_order,type,title,source_ref,duration_override,min_duration,anchor,on_overrun,locked,auto_next,loop) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run('live-a','rd-a',0,'LIVE','SIMULATED NOT PHYSICAL','ndi:SIMULATED_NOT_PHYSICAL',150000,0,'{"kind":"FLOW"}','PUSH',0,0,0)
interface Station {port:number;child:ChildProcess|null;pids:number[];logs:string}
const stations:Station[]=[],ports=new Set<number>()
async function port(){for(;;){const socket=createServer();await new Promise<void>(resolve=>socket.listen(0,'127.0.0.1',resolve));const id=(socket.address()as {port:number}).port;await new Promise<void>(resolve=>socket.close(()=>resolve()));if(!ports.has(id)){ports.add(id);return id}}}
for(let n=0;n<2;n++)stations.push({port:await port(),child:null,pids:[],logs:''})
async function call(station:Station,path:string,method='GET',body?:object,etag?:string,expected=200){
  const response=await fetch(`http://127.0.0.1:${station.port}${path}`,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(etag?{'If-Match':etag}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10_000)})
  const text=await response.text();if(expected!==0)assert.equal(response.status,expected,`${method} ${path}: ${response.status} ${text.slice(0,400)}`)
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
  while(performance.now()<deadline){if(child.exitCode!==null)throw new Error(`Own compiled child exited: ${station.logs.slice(-4000)}`);try{if((await call(station,'/api/health')).value.ok)return}catch{}await new Promise(resolve=>setTimeout(resolve,100))}
  throw new Error(`Own compiled server not ready: ${station.logs.slice(-4000)}`)
}
async function stop(station:Station){const child=station.child;station.child=null;if(child&&child.exitCode===null&&child.signalCode===null){const ended=new Promise<void>(resolve=>child.once('exit',()=>resolve()));child.kill('SIGKILL');await ended}}
const state=()=>Object.fromEntries(['channels','graphic_templates','graphics_versions','graphics_initialization','channel_project_versions','channel_configuration_versions','editorial_revision_counters'].map(table=>[table,database.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
const audits=()=>database.sqlite.prepare("SELECT * FROM operator_decisions WHERE kind IN ('GRAPHIC_TEMPLATE_EDITED','SLATE_CONFIGURATION_CHANGED') ORDER BY rowid").all()
let evidence:Record<string,unknown>|null=null,socket:WebSocket|null=null,sequence=0,latest:any=null
async function after(previous:number){const deadline=performance.now()+10_000;while(performance.now()<deadline){if(sequence>previous&&latest)return latest.transport;await new Promise(resolve=>setTimeout(resolve,50))}throw new Error('No fresh SIMULATED telemetry')}
const path=(id:string|null='a')=>`/api/graphics/review${id===null?'':`?channelId=${encodeURIComponent(id)}`}`
const draft={channelId:'a',name:'Arte Çãó',svg:'<g><text>{{nome}}</text></g>'}
try{
  const [a,b]=stations as [Station,Station];await Promise.all(stations.map(start))
  assert.equal((database.sqlite.prepare('SELECT state FROM graphics_initialization').get()as {state:string}).state,'INITIALIZED')
  const factory=database.sqlite.prepare('SELECT * FROM graphic_templates WHERE channel_id IS NULL ORDER BY name').all()as {id:string;name:string}[]
  assert.deepEqual(factory.map(row=>row.name),['Crédito','Selo do canal','Tarja urgente'])
  // These explicit fixture edits must survive restart; the service must not
  // interpret absence or a renamed model as a request to restore defaults.
  database.sqlite.prepare('UPDATE graphic_templates SET name=? WHERE id=?').run('Arte editada pelo operador Çãó',factory[0]!.id)
  for(const row of factory.slice(1))database.sqlite.prepare('DELETE FROM graphic_templates WHERE id=?').run(row.id)
  // Prove the entire catalog/counter snapshot before creating an as-run. A
  // restart reconciles as-run rows, which legitimately invalidates project
  // reviews; that must not be mistaken for reseeding factory templates.
  const factoryAfterEdits=state();await stop(b);await start(b);assert.deepEqual(state(),factoryAfterEdits)
  const original=await call(a,path()),beforeRead=state();assert.equal(original.cache,'private, no-store');assert.deepEqual((await call(b,path())).value,original.value);assert.deepEqual(state(),beforeRead)
  await call(a,'/api/graphics','POST',draft,undefined,428)
  const results=await Promise.all([a,b].map(station=>call(station,'/api/graphics','POST',draft,original.etag,0)));assert.deepEqual(results.map(row=>row.status).sort(),[200,409]);assert.equal(audits().length,1)
  const saved=results.find(row=>row.status===200)!.value,id=saved.template.id
  for(const method of ['PATCH','DELETE'])await call(a,`/api/graphics/${id}`,method,method==='PATCH'?{name:'Blind'}:undefined,undefined,428)
  await call(a,'/api/channels/a/slate','PATCH',{templateId:id},undefined,428)
  await call(a,`/api/graphics/${id}`,'PATCH',{channelId:'b'},saved.eTag,400)
  const foreignReview=await call(a,path('b'));await call(a,`/api/graphics/${id}`,'PATCH',{name:'Wrong proof'},foreignReview.etag,400)
  const unicode=await call(a,path('ch:ç'));await call(a,'/api/graphics','POST',{...draft,channelId:'ch:ç'},unicode.etag)
  const old=await call(a,path());database.sqlite.exec("UPDATE graphic_templates SET name='Changed' WHERE channel_id='a'; UPDATE graphic_templates SET name='Arte Çãó' WHERE channel_id='a'")
  const beforeAba=state();await call(a,`/api/graphics/${id}`,'PATCH',{name:'Stale'},old.etag,409);assert.deepEqual(state(),beforeAba)
  const sharedReview=await call(a,path(null)),shared=(await call(a,'/api/graphics','POST',{...draft,channelId:null},sharedReview.etag)).value
  const slateOld=await call(a,path());database.sqlite.prepare('UPDATE graphic_templates SET name=name WHERE id=?').run(shared.template.id)
  const beforeSlate=state();await call(a,'/api/channels/a/slate','PATCH',{templateId:shared.template.id},slateOld.etag,409);assert.deepEqual(state(),beforeSlate)
  for(const operation of ['CREATE','UPDATE','DELETE','SLATE']){
    const review=await call(a,path()),before=state(),success=audits()
    database.sqlite.exec("CREATE TRIGGER graphics_audit_failure BEFORE INSERT ON operator_decisions WHEN NEW.kind IN ('GRAPHIC_TEMPLATE_EDITED','SLATE_CONFIGURATION_CHANGED') BEGIN SELECT RAISE(ABORT,'GRAPHICS_AUDIT_FIXTURE'); END")
    await call(a,operation==='CREATE'?'/api/graphics':operation==='SLATE'?'/api/channels/a/slate':`/api/graphics/${id}`,operation==='CREATE'?'POST':operation==='DELETE'?'DELETE':'PATCH',operation==='CREATE'?draft:operation==='SLATE'?{templateId:id}:operation==='DELETE'?undefined:{name:'Rollback'},review.etag,500)
    assert.deepEqual(state(),before);assert.deepEqual(audits(),success);database.sqlite.exec('DROP TRIGGER graphics_audit_failure')
  }
  // Load/cue/take below are explicit SIMULATED fixture operations, never from
  // template/slate CRUD. They don't prove buffers, decode or physical output.
  socket=new WebSocket(`ws://127.0.0.1:${a.port}/ws`)
  socket.addEventListener('message',event=>{const message=JSON.parse(String(event.data));if(message.type==='live'&&message.channelId==='a'){latest=message;sequence++}})
  await new Promise<void>((resolve,reject)=>{socket!.addEventListener('open',()=>resolve(),{once:true});socket!.addEventListener('error',()=>reject(new Error('Own fixture socket failed')),{once:true})})
  await after(0)
  await call(a,'/api/channels/a/transport','POST',{action:'cue',sourceRef:'ndi:SIMULATED_NOT_PHYSICAL'});await call(a,'/api/channels/a/transport','POST',{action:'take'})
  const cued=await call(a,'/api/channels/a/transport','POST',{action:'cue',sourceRef:'ndi:SIMULATED_OTHER_PREVIEW'}),transport=cued.value.live.transport;assert.equal(transport.onAir.itemId,'live-a');assert.equal(transport.preview.source,'ndi:SIMULATED_OTHER_PREVIEW')
  const current=await call(a,path()),changed=(await call(a,'/api/channels/a/slate','PATCH',{templateId:id},current.etag)).value;assert.equal(changed.applied,true);assert.equal(changed.runtimeConfigurationApplied,true);assert.equal(changed.physicalOutputValidated,false)
  const actual=await after(sequence);assert.equal(transport.playing,true);assert.equal(actual.onAir.itemId,transport.onAir.itemId);assert.equal(actual.playing,transport.playing);assert.equal(actual.onAir.startedAt,transport.onAir.startedAt);assert.deepEqual(actual.preview,transport.preview)
  const linkedBefore=state(),linkedAudits=audits();await call(a,`/api/graphics/${id}`,'DELETE',undefined,changed.eTag,409);assert.deepEqual(state(),linkedBefore);assert.deepEqual(audits(),linkedAudits)
  const clearing=await call(a,path());await call(a,'/api/channels/a/slate','PATCH',{templateId:null},clearing.etag)
  const editReview=await call(a,path());await call(a,`/api/graphics/${id}`,'PATCH',{name:'New name'},editReview.etag)
  const afterEdit=await after(sequence);assert.equal(afterEdit.onAir.itemId,transport.onAir.itemId);assert.deepEqual(afterEdit.preview,transport.preview)
  const stable=await call(a,path());await stop(b);await start(b);assert.equal((await call(b,path())).etag,stable.etag)
  const backup=join(directory,'validated-backup.db');await database.sqlite.backup(backup);const validation=await validateBackupRestore(backup);assert.equal(validation.integrity,'ok');assert.equal(validation.foreignKeys,'ok')
  evidence={result:'PASS',evidence:'COMPILED_GRAPHICS_AND_SLATE_REVIEW',directory,ports:stations.map(station=>station.port),pids:stations.flatMap(station=>station.pids),serverSha256:createHash('sha256').update(await readFile(join(root,'apps/server/dist/server.cjs'))).digest('hex'),
    factoryInitializedOnce:true,restartDoesNotRecreateDefaults:true,readOnlyStable:true,singleConcurrentWinner:true,blindCrudAndSlateRejected:true,ownerTransferAndForeignProofRejected:true,unicodeChannelAccepted:true,staleAbaRejected:true,globalAbaSlateRejected:true,createUpdateDeleteSlateAuditRollback:true,linkedDeletionRejected:true,previewAndProgramPreserved:true,restartRevisionPreserved:true,backupValidated:true,
    transport:'SIMULATED',automaticTake:false,svgRenderingValidated:false,mediaDecoded:false,physicalSignalValidated:false,browserValidated:false,replicationValidated:false}
}finally{
  if(socket){const own=socket;socket=null;own.close()}
  for(const station of stations)await stop(station)
  database.sqlite.close()
}
if(evidence){for(const station of stations)await assert.rejects(()=>fetch(`http://127.0.0.1:${station.port}/api/health`,{signal:AbortSignal.timeout(2000)}));console.log(JSON.stringify({...evidence,ownChildrenAndListenersClosed:true}))}
