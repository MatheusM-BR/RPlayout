import {spawn,type ChildProcess} from 'node:child_process'
import {createServer} from 'node:net'
import {mkdtemp,mkdir,readFile,realpath} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {randomUUID,createHash} from 'node:crypto'
import {createRequire} from 'node:module'
import assert from 'node:assert/strict'
import {openDatabase} from '../apps/server/src/db/client.js'
import {rundownItems} from '../apps/server/src/db/schema.js'
import {sessionDigest} from '../apps/server/src/domain/access.js'
import {validateBackupRestore} from '../apps/server/src/domain/backup.js'
import {qcAssetETag} from '../packages/protocol/src/qc.js'

// Own compiled processes and private fixtures. No decoder, browser, physical
// signals or independent-node replication/HA qualification is claimed.
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(tmpdir(),'RPlayout-asset-metadata-'))
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json')
const file=join(directory,'qa.db'),media=join(directory,'media');await mkdir(media)
const database=openDatabase(file),now=new Date().toISOString(),token=randomUUID()+randomUUID(),headers={cookie:'rplayout_session='+token},assetId='asset:ç',path='/api/assets/'+encodeURIComponent(assetId)
database.sqlite.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('admin','Admin','PRIVATE_HASH_NOT_LOGIN','ADMIN',1,now)
database.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest(token),'admin','2099-01-01',now)
database.sqlite.prepare('INSERT INTO media_assets(id,content_hash,path,title,kind,duration_frames,qc_status,qc_notes,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(assetId,'PRIVATE_HASH_NOT_DECODED',join(media,'Não decodificado.mp4'),'AÇÃO Çãó','VIDEO',250,'BLOCKED','PRIVATE_QC_NOTES',now)
for(const id of ['a','b'])database.sqlite.prepare('INSERT INTO channels(id,name,width,height,rate_num,rate_den,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,'Estúdio '+id,320,180,25,1,-23,-1,5,now)
database.sqlite.prepare('INSERT INTO rundowns(id,channel_id,name,date,planned_start,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('rd-a','a','SIMULATED NOT PHYSICAL',now.slice(0,10),0,now,now)
database.db.insert(rundownItems).values({id:'live-a',rundownId:'rd-a',sortOrder:0,type:'LIVE',title:'SIMULATED NOT PHYSICAL',sourceRef:'ndi:SIMULATED_NOT_PHYSICAL',durationOverride:150000,minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',locked:false,autoNext:false,loop:false}).run()
database.db.insert(rundownItems).values({id:'vt',rundownId:'rd-a',sortOrder:1,type:'VT',title:'Título editorial preservado',mediaId:assetId,minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',locked:false,autoNext:false,loop:false}).run()
interface Station{port:number;child:ChildProcess|null;logs:string;pids:number[]}
const stations:Station[]=[],ports=new Set<number>()
async function port(){for(;;){const socket=createServer();await new Promise<void>(resolve=>socket.listen(0,'127.0.0.1',resolve));const result=(socket.address()as{port:number}).port;await new Promise<void>(resolve=>socket.close(()=>resolve()));if(!ports.has(result)){ports.add(result);return result}}}
for(let n=0;n<2;n++)stations.push({port:await port(),child:null,logs:'',pids:[]})
async function call(station:Station,url:string,method='GET',body?:object,etag?:string,status=200){
  const response=await fetch(`http://127.0.0.1:${station.port}${url}`,{method,headers:{...headers,...(body?{'Content-Type':'application/json'}:{}),...(etag?{'If-Match':etag}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)})
  const text=await response.text();if(status)assert.equal(response.status,status,`${method} ${url}: ${response.status} ${text.slice(0,250)}`)
  return {status:response.status,value:JSON.parse(text),etag:response.headers.get('etag')!,cache:response.headers.get('cache-control')}
}
async function start(station:Station){
  station.logs='';const child=spawn(process.execPath,[join(root,'apps/server/dist/server.cjs')],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,
    RPLAYOUT_DB:file,RPLAYOUT_VAULT_FILE:join(directory,'vault.json'),RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_MEDIA:media,RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_CACHE:join(directory,'cache'),RPLAYOUT_BACKUPS:join(directory,'backups'),
    RPLAYOUT_ENGINE:'',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_DEVICES:'',RPLAYOUT_RELAY:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_N1_PEER:'',RPLAYOUT_BACKUP_HOURS:'0',RPLAYOUT_HA_ROLE:'',RPLAYOUT_HA_PEER:'',RPLAYOUT_ADMIN_USER:'',RPLAYOUT_ADMIN_PASSWORD:'',RPLAYOUT_ROLE:'ADMIN',RPLAYOUT_CONTROL_TOKEN:'',HOST:'127.0.0.1',PORT:String(station.port),LOG_LEVEL:'warn'}})
  station.child=child;if(child.pid)station.pids.push(child.pid)
  child.stdout?.on('data',data=>station.logs=(station.logs+String(data)).slice(-8000));child.stderr?.on('data',data=>station.logs=(station.logs+String(data)).slice(-8000));child.on('error',error=>station.logs+=error.message)
  const deadline=performance.now()+25000
  while(performance.now()<deadline){if(child.exitCode!==null)throw new Error('Own server exited: '+station.logs.slice(-2500));try{if((await call(station,'/api/health')).value.ok)return}catch{}await new Promise(resolve=>setTimeout(resolve,100))}
  throw new Error('Own server not ready: '+station.logs.slice(-2500))
}
async function stop(station:Station){const own=station.child;station.child=null;if(own&&own.exitCode===null&&own.signalCode===null){const ended=new Promise<void>(resolve=>own.once('exit',()=>resolve()));own.kill('SIGKILL');await ended}}
const state=()=>Object.fromEntries(['media_assets','qc_review_versions','qc_decisions','rundown_items','editorial_revision_counters','channel_project_versions'].map(table=>[table,database.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
const audits=()=>database.sqlite.prepare("SELECT * FROM operator_decisions WHERE kind='ASSET_METADATA_CHANGED' ORDER BY rowid").all()
let socket:{close():void}|null=null,sequence=0,latest:any=null,evidence:Record<string,unknown>|null=null
async function after(previous:number){const deadline=performance.now()+10000;while(performance.now()<deadline){if(sequence>previous&&latest)return latest.transport;await new Promise(resolve=>setTimeout(resolve,50))}throw new Error('Own authenticated WS has no fresh SIMULATED transport')}
try{
  const [a,b]=stations as[Station,Station];await Promise.all(stations.map(start))
  const original=await call(a,path+'/metadata-review'),beforeRead=state();assert.equal(original.cache,'private, no-store');assert.deepEqual((await call(b,path+'/metadata-review')).value,original.value);assert.deepEqual(state(),beforeRead)
  for(const secret of [token,'PRIVATE','path','contentHash','qcNotes'])assert.ok(!JSON.stringify(original.value).includes(secret))
  for(const suffix of ['/metadata','']){const before=state(),success=audits();await call(a,path+suffix,'PATCH',{title:'Blind'},undefined,428);assert.deepEqual(state(),before);assert.deepEqual(audits(),success)}
  const concurrent=await Promise.all(stations.map((station,index)=>call(station,path+'/metadata','PATCH',{title:'Título '+index,categoryId:'Notícias Çãó'},original.etag,0)))
  assert.deepEqual(concurrent.map(result=>result.status).sort(),[200,409]);assert.equal(audits().length,1)
  const stale=await call(a,path+'/metadata-review'),savedTitle=stale.value.title;for(const title of ['ABA',savedTitle])database.sqlite.prepare('UPDATE media_assets SET title=? WHERE id=?').run(title,assetId)
  const beforeAba=state(),auditAba=audits();await call(a,path+'/metadata','PATCH',{title:'Stale'},stale.etag,409);assert.deepEqual(state(),beforeAba);assert.deepEqual(audits(),auditAba)
  const fresh=await call(a,path+'/metadata-review');await call(a,path+'/metadata','PATCH',{title:'QC proof'},qcAssetETag(assetId,fresh.value.revision),400)
  for(const body of [{title:'X',ignored:false},{title:'X',qcStatus:'APPROVED'},{title:'X',path:'forged'}]){const before=state();await call(a,path,'PATCH',body,fresh.etag,400);assert.deepEqual(state(),before)}
  const beforeRollback=state(),auditRollback=audits();database.sqlite.exec("CREATE TRIGGER metadata_audit_failure BEFORE INSERT ON operator_decisions WHEN NEW.kind='ASSET_METADATA_CHANGED' BEGIN SELECT RAISE(ABORT,'METADATA_AUDIT_FIXTURE'); END")
  await call(a,path+'/metadata','PATCH',{title:'Rollback'},fresh.etag,500);assert.deepEqual(state(),beforeRollback);assert.deepEqual(audits(),auditRollback);database.sqlite.exec('DROP TRIGGER metadata_audit_failure')
  const stable=await call(a,path+'/metadata-review'),beforeRestart=state();await stop(b);await start(b);assert.equal((await call(b,path+'/metadata-review')).etag,stable.etag);assert.deepEqual(state(),beforeRestart)
  const Ws=createRequire(await realpath(join(root,'apps/server/node_modules/@fastify/websocket/package.json')))('ws'),ws=new Ws(`ws://127.0.0.1:${a.port}/ws`,{headers});socket=ws
  ws.on('error',()=>{});ws.on('message',(data:unknown)=>{const text=String(data);assert.ok(!text.includes(token));const message=JSON.parse(text);if(message.type==='live'&&message.channelId==='a'){latest=message;sequence++}})
  await after(0)
  await call(a,'/api/channels/a/transport','POST',{action:'cue',sourceRef:'ndi:SIMULATED_NOT_PHYSICAL'});await call(a,'/api/channels/a/transport','POST',{action:'take'})
  const pvw=(await call(a,'/api/channels/a/transport','POST',{action:'cue',sourceRef:'ndi:SIMULATED_OTHER_PREVIEW'})).value.live.transport;assert.equal(pvw.onAir.itemId,'live-a');assert.equal(pvw.playing,true)
  const reviewed=await call(a,path+'/metadata-review'),saved=await call(a,path+'/metadata','PATCH',{title:'AÇÃO editorial nova',categoryId:null},reviewed.etag);assert.equal(saved.value.applied,true);assert.equal(saved.value.automaticTake,false);assert.equal(saved.value.revision,reviewed.value.revision+1)
  const current=await after(sequence);assert.equal(current.onAir.itemId,pvw.onAir.itemId);assert.equal(current.onAir.startedAt,pvw.onAir.startedAt);assert.equal(current.playing,true);assert.ok(current.onAir.elapsed>=pvw.onAir.elapsed);assert.deepEqual(current.preview,pvw.preview)
  assert.deepEqual(database.sqlite.prepare("SELECT title FROM rundown_items WHERE id='vt'").get(),{title:'Título editorial preservado'});assert.deepEqual(database.sqlite.prepare('SELECT qc_status,ignored,path,content_hash FROM media_assets WHERE id=?').get(assetId),{qc_status:'BLOCKED',ignored:0,path:join(media,'Não decodificado.mp4'),content_hash:'PRIVATE_HASH_NOT_DECODED'});assert.deepEqual(database.sqlite.prepare('SELECT * FROM qc_decisions').all(),[])
  const backup=join(directory,'validated-backup.db');await database.sqlite.backup(backup);const validation=await validateBackupRestore(backup);assert.equal(validation.integrity,'ok');assert.equal(validation.foreignKeys,'ok')
  evidence={result:'PASS',evidence:'COMPILED_ASSET_METADATA_REVIEW',directory,ports:stations.map(station=>station.port),pids:stations.flatMap(station=>station.pids),serverSha256:createHash('sha256').update(await readFile(join(root,'apps/server/dist/server.cjs'))).digest('hex'),readOnlyStable:true,noPathsHashesOrQcNotesReturned:true,bothBlindEndpointsRejected:true,singleConcurrentWinner:true,staleAbaRejected:true,qcProofAndMixedBodiesRejected:true,auditRollback:true,restartRevisionPreserved:true,programPlayingAndStartPreserved:true,elapsedAdvances:true,previewPreserved:true,editorialTitleAndQcUnchanged:true,backupValidated:true,transport:'SIMULATED',physicalSignalValidated:false,mediaDecoded:false,browserValidated:false,replicationValidated:false}
}finally{socket?.close();for(const station of stations)await stop(station);database.sqlite.close()}
if(evidence){for(const station of stations)await assert.rejects(()=>fetch(`http://127.0.0.1:${station.port}/api/health`,{signal:AbortSignal.timeout(2000)}));console.log(JSON.stringify({...evidence,ownChildrenAndListenersClosed:true}))}
