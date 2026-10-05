import assert from 'node:assert/strict'
import {spawn,type ChildProcess} from 'node:child_process'
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createServer} from 'node:net'
import {createHash} from 'node:crypto'
import {openDatabase} from '../apps/server/src/db/client.js'
import {validateBackupRestore} from '../apps/server/src/domain/backup.js'
import {DEFAULT_QC_PROFILE,qcAssetETag} from '../packages/protocol/src/qc.js'

// Two compiled processes sharing only a private fixture DB. QC technical
// metadata is seeded, not physical media qualification or engine playback.
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(tmpdir(),'RPlayout-qc-reviews-'))
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json')
const media=join(directory,'media');await mkdir(media)
// Presence placeholder avoids availability reconciliation mutating the fixture.
// No decoder/probe is enabled, and this is explicitly not media qualification.
const placeholder=join(media,'metadata-only.mkv');await writeFile(placeholder,'QC_METADATA_FIXTURE_NOT_VIDEO')
const file=join(directory,'qa.db'),database=openDatabase(file)
interface Station {port:number;child:ChildProcess|null;pids:number[];logs:string}
const stations:Station[]=[]
const ports=new Set<number>()
async function freePort(){
  for(;;){const socket=createServer();await new Promise<void>(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=(socket.address() as {port:number}).port;await new Promise<void>((resolve,reject)=>socket.close(error=>error?reject(error):resolve()));if(!ports.has(port)){ports.add(port);return port}}
}
for(let index=0;index<2;index++)stations.push({port:await freePort(),child:null,pids:[],logs:''})
async function call(station:Station,path:string,body?:object,method=body?'POST':'GET',expected=200,etag?:string){
  const response=await fetch(`http://127.0.0.1:${station.port}${path}`,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(etag?{'If-Match':etag}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10_000)})
  const text=await response.text();assert.equal(response.status,expected,`${method} ${path}: ${response.status} ${text.slice(0,500)}`)
  return {value:JSON.parse(text),etag:response.headers.get('etag')!,cache:response.headers.get('cache-control')}
}
async function start(station:Station){
  station.logs=''
  const child=spawn(process.execPath,[join(root,'apps/server/dist/server.cjs')],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,
    RPLAYOUT_DB:file,RPLAYOUT_VAULT_FILE:join(directory,'vault.json'),RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_MEDIA:media,
    RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_CACHE:join(directory,'cache'),RPLAYOUT_BACKUPS:join(directory,'backups'),
    RPLAYOUT_ENGINE:'',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_DEVICES:'',RPLAYOUT_RELAY:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_N1_PEER:'',RPLAYOUT_BACKUP_HOURS:'0',
    RPLAYOUT_HA_ROLE:'',RPLAYOUT_HA_PEER:'',RPLAYOUT_ADMIN_USER:'',RPLAYOUT_ADMIN_PASSWORD:'',RPLAYOUT_ROLE:'ADMIN',RPLAYOUT_CONTROL_TOKEN:'',HOST:'127.0.0.1',PORT:String(station.port),LOG_LEVEL:'warn'}})
  station.child=child;if(child.pid)station.pids.push(child.pid)
  child.stdout?.on('data',chunk=>station.logs=(station.logs+String(chunk)).slice(-8000));child.stderr?.on('data',chunk=>station.logs=(station.logs+String(chunk)).slice(-8000))
  child.on('error',error=>station.logs+=error.message)
  const end=performance.now()+20_000
  while(performance.now()<end){
    assert.equal(child.exitCode,null,station.logs)
    try{if((await call(station,'/api/health')).value.ok)return}catch{}
    await new Promise(resolve=>setTimeout(resolve,100))
  }
  throw new Error(`Fixture não iniciou: ${station.logs}`)
}
async function stop(station:Station){
  const child=station.child;station.child=null
  if(!child||child.exitCode!==null||child.signalCode!==null)return
  const exited=new Promise<void>(resolve=>child.once('exit',()=>resolve()));child.kill('SIGKILL');await exited
}
const read='/api/assets/a/qc?channelId=ch',write='/api/assets/a/qc',profile='/api/channels/ch/qc-profile'
const body=(status:string)=>({channelId:'ch',contentHash:'original',status,notes:'Operador conferiu esta edição'})
function rows(){return {
  assets:database.sqlite.prepare('SELECT * FROM media_assets ORDER BY id').all(),channels:database.sqlite.prepare('SELECT * FROM channels ORDER BY id').all(),
  qc:database.sqlite.prepare('SELECT * FROM qc_decisions ORDER BY rowid').all(),qcVersions:database.sqlite.prepare('SELECT * FROM qc_review_versions ORDER BY asset_id').all(),
  configuration:database.sqlite.prepare('SELECT * FROM channel_configuration_versions ORDER BY channel_id').all(),editorial:database.sqlite.prepare('SELECT * FROM editorial_revision_counters ORDER BY scope,rundown_id,item_id').all(),
  audit:database.sqlite.prepare("SELECT * FROM operator_decisions WHERE kind IN ('QC_DECISION','QC_GLOBAL_DECISION','QC_PROFILE_CHANGED') ORDER BY rowid").all(),
}}
let evidence:Record<string,unknown>|null=null
try{
  database.sqlite.exec("INSERT INTO channels(id,name,width,height,rate_num,rate_den,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES('ch','QC çãó',320,180,25,1,-23,-1,5,'now')")
  database.sqlite.prepare("INSERT INTO media_assets(id,content_hash,path,title,kind,duration_frames,duration_ns,width,height,rate_num,rate_den,has_audio,interlace_mode,qc_status,created_at) VALUES('a','original',?,'AÇÃO','VIDEO',250,10000000000,320,180,25,1,1,'progressive','PENDING','now')").run(placeholder)
  database.sqlite.exec(`INSERT INTO rundowns(id,channel_id,name,planned_start,date,created_at,updated_at) VALUES('rd','ch','QC',0,'2026-10-04','now','now');
    INSERT INTO rundown_items(id,rundown_id,sort_order,type,title,media_id,min_duration,anchor,on_overrun) VALUES('item','rd',0,'VT','VT','a',0,'{"kind":"FLOW"}','PUSH');`)
  const a=stations[0]!,b=stations[1]!
  await start(a);await start(b)
  const initial=await call(a,read);assert.equal(initial.etag,(await call(b,read)).etag);assert.equal(initial.cache,'private, no-store')
  await call(a,write,body('APPROVED'),'POST',428)
  const attempts=await Promise.all(stations.map((station,index)=>fetch(`http://127.0.0.1:${station.port}${write}`,{method:'POST',headers:{'Content-Type':'application/json','If-Match':initial.etag},body:JSON.stringify(body(index?'BLOCKED':'APPROVED')),signal:AbortSignal.timeout(10_000)})))
  assert.deepEqual(attempts.map(r=>r.status).sort(),[200,409])
  assert.equal(rows().qc.length,1);assert.equal(rows().audit.length,1)
  const current=await call(b,read);assert.equal(current.value.review.assetRevision,initial.value.review.assetRevision+1)
  assert.deepEqual((await call(a,read)).value,current.value)
  await stop(b);await start(b);assert.deepEqual((await call(b,read)).value,current.value)
  await call(b,write,body('APPROVED'),'POST',409,initial.etag)
  database.sqlite.exec("UPDATE media_assets SET content_hash='new' WHERE id='a';UPDATE media_assets SET content_hash='original' WHERE id='a'")
  await call(a,write,body('APPROVED'),'POST',409,current.etag)
  const beforeProfile=await call(a,read),profileOpened=await call(a,profile)
  await call(b,profile,{...DEFAULT_QC_PROFILE,requireAudio:true},'PUT',428)
  await call(a,profile,{...DEFAULT_QC_PROFILE,requireAudio:true},'PUT',200,profileOpened.etag)
  await call(b,profile,{...DEFAULT_QC_PROFILE,requireLoudness:true},'PUT',409,profileOpened.etag)
  await call(b,write,body('APPROVED'),'POST',409,beforeProfile.etag)
  const channelOpened=await call(a,read),globalETag=qcAssetETag('a',channelOpened.value.review.assetRevision)
  await call(b,'/api/assets/a',{ignored:true},'PATCH',200,globalETag)
  await call(a,write,body('APPROVED'),'POST',409,channelOpened.etag)
  const globalDecision=(await call(a,read)).value.decisions[0];assert.equal(globalDecision.channelId,'@all');assert.equal(globalDecision.status,'REJECTED')
  for(const kind of ['QC_DECISION','QC_GLOBAL_DECISION','QC_PROFILE_CHANGED']){
    const review=await call(a,read),config=await call(a,profile),all=qcAssetETag('a',review.value.review.assetRevision),before=rows()
    database.sqlite.exec(`CREATE TRIGGER fixture_audit_fail BEFORE INSERT ON operator_decisions WHEN NEW.kind='${kind}' BEGIN SELECT RAISE(ABORT,'QC rollback fixture'); END`)
    if(kind==='QC_DECISION')await call(b,write,body('APPROVED'),'POST',500,review.etag)
    if(kind==='QC_GLOBAL_DECISION')await call(b,'/api/assets/a',{ignored:false},'PATCH',500,all)
    if(kind==='QC_PROFILE_CHANGED')await call(b,profile,{...DEFAULT_QC_PROFILE,requireLoudness:true},'PUT',500,config.etag)
    assert.deepEqual(rows(),before);database.sqlite.exec('DROP TRIGGER fixture_audit_fail')
  }
  const backup=join(directory,'validated-backup.db');await database.sqlite.backup(backup)
  const restored=await validateBackupRestore(backup);assert.equal(restored.integrity,'ok');assert.equal(restored.foreignKeys,'ok')
  const latest=await call(b,read);await stop(b);await start(b);assert.deepEqual((await call(b,read)).value,latest.value)
  evidence={result:'PASS',evidence:'TWO_COMPILED_PROCESSES_QC_REVIEW_AND_ATOMIC_AUDIT',directory,stations:stations.map(({port,pids})=>({port,pids})),serverSha256:createHash('sha256').update(await readFile(join(root,'apps/server/dist/server.cjs'))).digest('hex'),
    blindDecisionAndProfileRejected:true,concurrentDecisionOneWinner:true,hashABArejected:true,profileChangeInvalidatesDecision:true,globalQuarantineInvalidatesChannelReview:true,rollbackIncludingCountersAndAudits:3,
    restartPreservesReview:true,backupRestored:true,migration23Validated:true,transport:'SIMULATED',physicalOutputValidated:false,mediaDecoded:false,browserPlaybackValidated:false,replicationValidated:false}
}finally{
  await Promise.all(stations.map(stop));database.sqlite.close()
}
if(evidence){
  for(const station of stations)await assert.rejects(()=>fetch(`http://127.0.0.1:${station.port}/api/health`,{signal:AbortSignal.timeout(2000)}))
  console.log(JSON.stringify({...evidence,ownChildrenAndListenersClosed:true}))
}
