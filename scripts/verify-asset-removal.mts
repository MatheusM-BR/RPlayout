import {spawn,execFile,type ChildProcess} from 'node:child_process'
import {promisify} from 'node:util'
import {createServer} from 'node:net'
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {randomUUID,createHash} from 'node:crypto'
import assert from 'node:assert/strict'
import {openDatabase} from '../apps/server/src/db/client.js'
import {rundownItems,operatorDecisions} from '../apps/server/src/db/schema.js'
import {sessionDigest} from '../apps/server/src/domain/access.js'
import {validateBackupRestore} from '../apps/server/src/domain/backup.js'
import {isIgnoredVideo} from '../packages/protocol/src/index.js'

// Only own temporary fixtures and compiled local children. This does not
// qualify hardware, browser interaction or concurrent native engine ownership.
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(tmpdir(),'RPlayout-asset-removal-'))
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json')
const file=join(directory,'qa.db'),media=join(directory,'media');await mkdir(media)
const realMedia=process.argv.includes('--real-media'),extension=realMedia?'.mkv':'.mp4'
const physical=join(media,'AÇÃO Çãó'+extension),secondFile=join(media,'second'+extension),imageFile=join(media,'image.png')
let content=Buffer.from('PRIVATE_PLACEHOLDER_NOT_VIDEO'),decoded:Record<string,unknown>|null=null
if(realMedia){
  const gstRoot=process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64??'C:/Program Files/gstreamer/1.0/msvc_x86_64',gstBin=join(gstRoot,'bin')
  const env={...process.env,GST_REGISTRY:join(directory,'registry.bin'),GST_PLUGIN_SCANNER:join(gstRoot,'libexec/gstreamer-1.0/gst-plugin-scanner.exe'),GST_PLUGIN_PATH:join(gstRoot,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gstRoot,'lib/gstreamer-1.0'),PATH:gstBin+';'+process.env.PATH}
  const run=promisify(execFile)
  await run(join(gstBin,'gst-launch-1.0.exe'),['-q','matroskamux','name=m','!','filesink',`location=${physical.replaceAll('\\','/')}`,'videotestsrc','num-buffers=75','pattern=smpte','!','video/x-raw,width=160,height=90,framerate=25/1','!','videoconvert','!','vp8enc','deadline=1','!','queue','!','m.video_0','audiotestsrc','num-buffers=150','!','audio/x-raw,rate=48000,channels=2','!','audioconvert','!','vorbisenc','!','queue','!','m.audio_0'],{env,windowsHide:true,timeout:30000})
  content=await readFile(physical);await writeFile(secondFile,content)
  await run(join(gstBin,'gst-launch-1.0.exe'),['-q','videotestsrc','num-buffers=1','!','video/x-raw,width=160,height=90','!','videoconvert','!','pngenc','!','filesink',`location=${imageFile.replaceAll('\\','/')}`],{env,windowsHide:true,timeout:10000})
  const output=await run(join(root,'apps/engine/target/release/rplayout-probe.exe'),[physical],{env,windowsHide:true,timeout:30000})
  decoded=JSON.parse(output.stdout);assert.equal(decoded!.ok,true)
  assert.ok(Number(decoded!.decodedVideoBuffers)>0&&Number(decoded!.decodedAudioBuffers)>0,'Real media must decode video and audio buffers')
}else{await writeFile(physical,content);for(const target of [secondFile,imageFile])await writeFile(target,content)}
const originalHashes=await Promise.all([physical,secondFile,imageFile].map(async target=>createHash('sha256').update(await readFile(target)).digest('hex')))
const db=openDatabase(file),token=randomUUID()+randomUUID(),headers={cookie:'rplayout_session='+token},id='asset:ç',path='/api/assets/'+encodeURIComponent(id),body={assetIds:[id],removeEditorialUses:true},now=new Date().toISOString()
db.sqlite.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('admin','Admin','PRIVATE_HASH','ADMIN',1,now)
db.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest(token),'admin','2099-01-01',now)
for(const [index,assetId] of [id,'second','image'].entries())db.sqlite.prepare('INSERT INTO media_assets(id,content_hash,path,title,kind,duration_frames,probe_error,created_at) VALUES(?,?,?,?,?,?,?,?)').run(assetId,realMedia?originalHashes[index]:'PRIVATE_HASH',[physical,secondFile,imageFile][index],assetId,assetId==='image'?'STILL':'VIDEO',realMedia?75:250,realMedia?null:'PRIVATE_PROBE_ERROR',now)
if(realMedia)db.sqlite.exec("UPDATE media_assets SET ignored=1 WHERE id='image'")
db.sqlite.prepare('INSERT INTO channels(id,name,width,height,rate_num,rate_den,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run('a','SIMULATED NOT PHYSICAL',320,180,25,1,-23,-1,5,now)
db.sqlite.prepare('INSERT INTO rundowns(id,channel_id,name,date,planned_start,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('rd','a','Grade',now.slice(0,10),0,now,now)
function editorial(){
  for(const [itemId,sortOrder,fallback]of [['vt',4,false],['fallback',3,true]]as const)db.db.insert(rundownItems).values({id:itemId,rundownId:'rd',sortOrder,type:fallback?'LIVE':'VT',title:itemId,mediaId:fallback?null:id,liveFallbackMediaId:fallback?id:null,minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',locked:false,autoNext:false,loop:false}).run()
}
editorial()
for(const [itemId,sortOrder]of [['live',0],['next',1]]as const)db.db.insert(rundownItems).values({id:itemId,rundownId:'rd',sortOrder,type:'LIVE',title:'SIMULATED NOT PHYSICAL',sourceRef:'ndi:'+itemId,durationOverride:150000,minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',locked:false,autoNext:false,loop:false}).run()
interface Station {port:number;child:ChildProcess|null;logs:string;pids:number[]}
const stations:Station[]=[]
for(let index=0;index<2;index++){const socket=createServer();await new Promise<void>(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=(socket.address()as{port:number}).port;await new Promise<void>(resolve=>socket.close(()=>resolve()));assert.ok(!stations.some(row=>row.port===port));stations.push({port,child:null,logs:'',pids:[]})}
async function call(station:Station,url:string,method='GET',body?:object,etag?:string,status=200){
  const response=await fetch(`http://127.0.0.1:${station.port}${url}`,{method,headers:{...headers,...(body?{'Content-Type':'application/json'}:{}),...(etag?{'If-Match':etag}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)})
  const text=await response.text();if(status)assert.equal(response.status,status,`${method} ${url}: ${response.status} ${text.slice(0,200)}`)
  return {status:response.status,value:JSON.parse(text),etag:response.headers.get('etag')!,cache:response.headers.get('cache-control')}
}
async function start(station:Station){
  const child=spawn(process.execPath,[join(root,'apps/server/dist/server.cjs')],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,RPLAYOUT_DB:file,RPLAYOUT_VAULT_FILE:join(directory,'vault.json'),RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_MEDIA:media,RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_CACHE:join(directory,'cache'),RPLAYOUT_BACKUPS:join(directory,'backups'),RPLAYOUT_ENGINE:'',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_DEVICES:'',RPLAYOUT_RELAY:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_N1_PEER:'',RPLAYOUT_BACKUP_HOURS:'0',RPLAYOUT_HA_ROLE:'',RPLAYOUT_HA_PEER:'',RPLAYOUT_ADMIN_USER:'',RPLAYOUT_ADMIN_PASSWORD:'',RPLAYOUT_ROLE:'ADMIN',RPLAYOUT_CONTROL_TOKEN:'',HOST:'127.0.0.1',PORT:String(station.port),LOG_LEVEL:'warn'}})
  station.child=child;if(child.pid)station.pids.push(child.pid)
  for(const stream of [child.stdout,child.stderr])stream?.on('data',data=>station.logs=(station.logs+String(data)).slice(-8000));child.on('error',error=>station.logs+=error.message)
  const deadline=performance.now()+25000
  while(performance.now()<deadline){if(child.exitCode!==null)throw new Error('Own child exited: '+station.logs.slice(-2000));try{if((await call(station,'/api/health')).value.ok)return}catch{}await new Promise(resolve=>setTimeout(resolve,100))}
  throw new Error('Own child not ready: '+station.logs.slice(-2000))
}
async function stop(station:Station){const child=station.child;if(child&&child.exitCode===null&&child.signalCode===null){const ended=new Promise<void>(resolve=>child.once('exit',()=>resolve()));child.kill('SIGKILL');let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([ended,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Owned child did not exit')),10000)})])}finally{if(timer)clearTimeout(timer)}}station.child=null}
const state=()=>Object.fromEntries(['media_assets','rundown_items','asset_removal_versions','editorial_revision_counters'].map(table=>[table,db.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
const audits=()=>db.sqlite.prepare("SELECT * FROM operator_decisions WHERE kind='ASSET_REMOVAL_APPLIED' ORDER BY rowid").all()
let evidence:Record<string,unknown>|null=null,failure:unknown=null
try{
  const [a,b]=stations as[Station,Station];await Promise.all(stations.map(start))
  const beforeRead=state(),original=await call(a,path+'/removal-review');assert.equal(original.cache,'private, no-store');assert.deepEqual((await call(b,path+'/removal-review')).value,original.value);assert.deepEqual(state(),beforeRead);assert.ok(!JSON.stringify(original.value).includes('PRIVATE'))
  assert.deepEqual(original.value.assets[0].uses.map((row:any)=>row.action).sort(),['CLEAR_FALLBACK','REMOVE_ITEM'])
  await call(a,path,'DELETE',body,undefined,428);await call(a,path+'?force=1','DELETE',body,original.etag,400);assert.deepEqual(state(),beforeRead)
  db.sqlite.exec("CREATE TRIGGER removal_audit_failure BEFORE INSERT ON operator_decisions WHEN NEW.kind='ASSET_REMOVAL_APPLIED' BEGIN SELECT RAISE(ABORT,'COMPILED_REMOVAL_FIXTURE'); END")
  await call(a,path,'DELETE',body,original.etag,500);assert.deepEqual(state(),beforeRead);assert.equal(audits().length,0);db.sqlite.exec('DROP TRIGGER removal_audit_failure')
  const results=await Promise.all(stations.map(station=>call(station,path,'DELETE',body,original.etag,0)));assert.deepEqual(results.map(row=>row.status).sort(),[200,409]);assert.equal(audits().length,1)
  assert.deepEqual(db.sqlite.prepare("SELECT id,live_fallback_media_id FROM rundown_items WHERE id='fallback'").all(),[{id:'fallback',live_fallback_media_id:null}]);assert.ok(!db.sqlite.prepare("SELECT id FROM rundown_items WHERE id='vt'").get());assert.deepEqual(await readFile(physical),content)
  // Channel QC changes its durable counter without changing media_assets.
  // Exercise the compiled route, including same-value and ABA writes.
  for(const change of ['insert','same-value','ABA','delete']){
    const qcProof=await call(a,path+'/removal-review'),assetBefore=db.sqlite.prepare('SELECT * FROM media_assets WHERE id=?').get(id)
    if(change==='insert')db.sqlite.prepare("INSERT INTO qc_decisions(id,asset_id,content_hash,channel_id,status,checks,created_at) VALUES('removal-qc',?,'PRIVATE_HASH','a','BLOCKED','{}',?)").run(id,now)
    if(change==='same-value')db.sqlite.exec("UPDATE qc_decisions SET status=status WHERE id='removal-qc'")
    if(change==='ABA')db.sqlite.exec("UPDATE qc_decisions SET status='REJECTED' WHERE id='removal-qc'; UPDATE qc_decisions SET status='BLOCKED' WHERE id='removal-qc'")
    if(change==='delete')db.sqlite.exec("DELETE FROM qc_decisions WHERE id='removal-qc'")
    assert.deepEqual(db.sqlite.prepare('SELECT * FROM media_assets WHERE id=?').get(id),assetBefore)
    const afterQc=state(),auditCount=audits().length;await call(b,path,'DELETE',body,qcProof.etag,409);assert.deepEqual(state(),afterQc);assert.equal(audits().length,auditCount)
  }
  for(const kind of ['PLAYLIST_BOUNDARY','CHANNEL_CONFIGURATION_SLOT','INTERRUPTION_COMMAND','OPERATIONAL_INSERT_COMMAND']){
    db.db.insert(operatorDecisions).values({id:'invalid-phase',rundownId:'rd',kind,payload:{channelId:'a',plan:{channelId:'a'},state:'UNKNOWN_PHASE',phase:'UNKNOWN_PHASE'},createdAt:now}).run()
    const protectedState=state();await call(a,path+'/removal-review','GET',undefined,undefined,409);assert.deepEqual(state(),protectedState)
    db.sqlite.exec("DELETE FROM operator_decisions WHERE id='invalid-phase'")
  }
  const stable=await call(a,path+'/removal-review');await stop(b);await start(b);assert.equal((await call(b,path+'/removal-review')).etag,stable.etag)
  if(realMedia){
    // Prune is specifically failed-probe cleanup, not "delete every ignored".
    const healthy=await call(a,'/api/assets/prune-review');assert.deepEqual(healthy.value.assets,[])
    db.sqlite.exec("UPDATE media_assets SET probe_error='EMULATED_PROBE_FAILURE_FOR_CATALOG_CLEANUP' WHERE id='second'")
  }
  const prune=await call(a,'/api/assets/prune-review');assert.deepEqual(prune.value.assets.map((row:any)=>row.assetId),realMedia?['second']:[id,'second']);await call(a,'/api/assets/prune','POST',{assetIds:['second'],removeEditorialUses:false},prune.etag);assert.ok(db.sqlite.prepare('SELECT id FROM media_assets WHERE id=?').get(id));assert.ok(db.sqlite.prepare("SELECT id FROM media_assets WHERE id='image'").get())
  await call(a,'/api/assets/prune','POST',{assetIds:[id],removeEditorialUses:false},prune.etag,409)
  db.sqlite.exec("DELETE FROM rundown_items WHERE id='fallback'");db.sqlite.prepare('UPDATE media_assets SET ignored=0 WHERE id=?').run(id);editorial()
  await call(a,'/api/channels/a/transport','POST',{action:'cue',sourceRef:'ndi:live'});await call(a,'/api/channels/a/transport','POST',{action:'take'})
  const transport=(await call(a,'/api/channels/a/transport','POST',{action:'cue',sourceRef:'ndi:OTHER_PVW'})).value.live.transport;assert.equal(transport.playing,true);assert.equal(transport.onAir.itemId,'live')
  const review=await call(a,path+'/removal-review'),result=await call(a,path,'DELETE',body,review.etag);assert.equal(result.value.applied,true);assert.equal(result.value.removedItems,1);assert.equal(result.value.clearedFallbacks,1)
  // Read-only channel snapshot, not another transport command or TAKE.
  const after=(await call(a,'/api/rundowns/rd')).value.live.transport;assert.equal(after.playing,true);assert.equal(after.onAir.itemId,transport.onAir.itemId);assert.equal(after.onAir.startedAt,transport.onAir.startedAt);assert.ok(after.onAir.elapsed>=transport.onAir.elapsed);assert.deepEqual(after.preview,transport.preview);assert.deepEqual(await readFile(physical),content)
  const backup=join(directory,'validated-backup.db');await db.sqlite.backup(backup);assert.equal((await validateBackupRestore(backup)).integrity,'ok')
  evidence={result:'PASS',evidence:'COMPILED_ASSET_REMOVAL_REVIEW',directory,ports:stations.map(row=>row.port),pids:stations.flatMap(row=>row.pids),serverSha256:createHash('sha256').update(await readFile(join(root,'apps/server/dist/server.cjs'))).digest('hex'),originalReviewStable:true,blindAndForceRejected:true,singleConcurrentWinner:true,auditRollback:true,fallbackLivePreserved:true,channelQcInsertSameValueAbaDeleteInvalidatesProof:true,unknownDurablePhasesRejected:true,subsetPruneAndImagePreserved:true,restartProofPreserved:true,programPlayingAndStartPreserved:true,previewPreserved:true,physicalFixtureBytesPreserved:true,backupValidated:true,transport:'SIMULATED',physicalSignalValidated:false,mediaDecoded:false,browserValidated:false,concurrentNativeOwnershipValidated:false}
  if(realMedia){
    const rows=db.sqlite.prepare('SELECT kind,path,ignored FROM media_assets').all() as {kind:'VIDEO'|'STILL';path:string;ignored:number}[]
    assert.deepEqual(rows.filter(row=>isIgnoredVideo({...row,ignored:Boolean(row.ignored)})).map(row=>row.path),[physical])
    assert.deepEqual(await Promise.all([physical,secondFile,imageFile].map(async target=>createHash('sha256').update(await readFile(target)).digest('hex'))),originalHashes)
    Object.assign(evidence!,{mediaDecoded:true,decoded,realVideoAndImageHashesPreserved:true,ignoredVideoFilter:true,healthyIgnoredExcludedFromFailedProbeCleanup:true,cleanupFailureMetadataEmulated:true,scannerValidated:false})
  }
}catch(error){failure=error
}finally{
  for(const station of stations)try{await stop(station)}catch(error){failure??=error}
  db.sqlite.close()
  for(const station of stations)try{await assert.rejects(()=>fetch(`http://127.0.0.1:${station.port}/api/health`,{signal:AbortSignal.timeout(2000)}))}catch(error){failure??=error}
  await writeFile(join(directory,'server.log'),stations.map(row=>`port=${row.port}\n${row.logs}`).join('\n'))
  console.log(JSON.stringify({cleanup:failure?'OWN_CHILDREN_CLEANUP_ATTEMPTED_SEE_FAILURE':'OWN_CHILDREN_AND_LISTENERS_CLOSED',directory,ports:stations.map(row=>row.port),pids:stations.flatMap(row=>row.pids)}))
}
const result=failure?{result:'FAIL',directory,error:String(failure),stack:failure instanceof Error?failure.stack:null}:{...evidence,ownChildrenAndListenersClosed:true}
await writeFile(join(directory,failure?'failure.json':'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(failure)process.exitCode=1
