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
import {mediaAssets} from '../apps/server/src/db/schema.js'
// Own loopback children and SQLite only: not physical media/browser/HA.
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(tmpdir(),'RPlayout-schedule-rule-reviews-'))
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json')
const file=join(directory,'qa.db'),media=join(directory,'media');await mkdir(media)
// Presence only, outside scanner roots: no decoder/probe is enabled and this
// fixture does NOT approve a real video. Availability checks remain unchanged.
const placeholder=join(directory,'metadata-presence-only.mkv');await writeFile(placeholder,'SCHEDULE_METADATA_FIXTURE_NOT_VIDEO')
const database=openDatabase(file),now=new Date().toISOString()
for(const id of ['a','b','ch:ç'])database.sqlite.prepare('INSERT INTO channels(id,name,width,height,rate_num,rate_den,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,'Estúdio çãó '+id,320,180,25,1,-23,-1,5,now)
database.sqlite.prepare('INSERT INTO rundowns(id,channel_id,name,date,planned_start,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('rd-a','a','SIMULATED fixture',now.slice(0,10),0,now,now)
database.sqlite.prepare('INSERT INTO rundown_items(id,rundown_id,sort_order,type,title,source_ref,duration_override,min_duration,anchor,on_overrun,locked,auto_next,loop) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run('live-a','rd-a',0,'LIVE','SIMULATED NOT PHYSICAL','ndi:SIMULATED_NOT_PHYSICAL',150000,0,'{"kind":"FLOW"}','PUSH',0,0,0)
database.sqlite.prepare('INSERT INTO rundowns(id,channel_id,name,date,planned_start,loop,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run('rd-day','b','DAY metadata fixture',now.slice(0,10),0,0,now,now)
database.db.insert(mediaAssets).values({id:'asset',title:'PLACEHOLDER NOT DECODED',path:placeholder,contentHash:'fixture-hash',kind:'VIDEO',durationFrames:1500,durationNs:60_000_000_000,rateNum:25,rateDen:1,width:320,height:180,hasAudio:true,interlaceMode:'progressive',qcStatus:'APPROVED',createdAt:now}).run()
interface Station{port:number;child:ChildProcess|null;pids:number[];logs:string}
const stations:Station[]=[],ports=new Set<number>()
async function freePort(){for(;;){const socket=createServer();await new Promise<void>(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=(socket.address() as {port:number}).port;await new Promise<void>(resolve=>socket.close(()=>resolve()));if(!ports.has(port)){ports.add(port);return port}}}
for(let i=0;i<2;i++)stations.push({port:await freePort(),child:null,pids:[],logs:''})
async function call(station:Station,path:string,body?:object,method=body?'POST':'GET',expected=200,etag?:string){
  const response=await fetch(`http://127.0.0.1:${station.port}${path}`,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(etag?{'If-Match':etag}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10_000)})
  if(expected)assert.equal(response.status,expected,`${method} ${path}: HTTP ${response.status}`)
  return {status:response.status,value:await response.json() as any,etag:response.headers.get('etag')!,cache:response.headers.get('cache-control')}
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
  while(performance.now()<deadline){if(child.exitCode!==null)throw new Error(`Own compiled child exited: ${station.logs.slice(-4000)}`);try{if((await call(station,'/api/health')).value.ok)return}catch{};await new Promise(resolve=>setTimeout(resolve,100))}
  throw new Error('Own compiled server not ready')
}
async function stop(station:Station){const child=station.child;station.child=null;if(child&&child.exitCode===null&&child.signalCode===null){const exited=new Promise<void>(resolve=>child.once('exit',()=>resolve()));child.kill('SIGKILL');await exited}}
const state=()=>({rows:database.sqlite.prepare('SELECT * FROM schedule_rules ORDER BY id').all(),versions:database.sqlite.prepare('SELECT * FROM schedule_rule_versions ORDER BY channel_id').all(),projects:database.sqlite.prepare('SELECT * FROM channel_project_versions ORDER BY channel_id').all(),success:database.sqlite.prepare("SELECT * FROM operator_decisions WHERE kind='SCHEDULE_RULE_EDITED' ORDER BY rowid").all()})
const band={name:'Manhã çãó',weekdays:'0',startMinute:60,endMinute:120,categories:[],avoidHours:0}
let evidence:Record<string,unknown>|null=null,socket:WebSocket|null=null,sequence=0,latest:any=null
async function after(previous:number){const end=performance.now()+10_000;while(performance.now()<end){if(sequence>previous&&latest)return latest.transport;await new Promise(resolve=>setTimeout(resolve,50))}throw new Error('No fresh simulated telemetry')}
try{
  const [a,b]=stations as [Station,Station];await start(a);await start(b)
  const path='/api/channels/a/rules',first=await call(a,path),second=await call(b,path),before=state()
  assert.equal(first.cache,'private, no-store');assert.equal(first.etag,second.etag);assert.deepEqual((await call(a,path)).value,first.value);assert.deepEqual(state(),before)
  await call(a,path,band,'POST',428);assert.deepEqual(state(),before)
  const concurrent=await Promise.all([call(a,path,band,'POST',0,first.etag),call(b,path,{...band,name:'Estação B'},'POST',0,second.etag)])
  assert.deepEqual(concurrent.map(row=>row.status).sort(),[200,409]);assert.equal(state().success.length,1);assert.equal(state().rows.length,1)
  const saved=(await call(a,path)).value.rules[0],url=`/api/rules/${saved.id}`
  for(const method of ['PATCH','DELETE'])await call(a,url,method==='PATCH'?{name:'Draft'}:undefined,method,428)
  const overlapBefore=state();await call(a,path,{...band,startMinute:90,endMinute:150},'POST',409,(await call(a,path)).etag);assert.deepEqual(state(),overlapBefore)
  const adjacent=await call(a,path,{...band,startMinute:120,endMinute:180},'POST',200,(await call(a,path)).etag)
  await call(a,path,{...band,weekdays:'1'},'POST',200,(await call(a,path)).etag)
  const patchBefore=state();await call(a,`/api/rules/${adjacent.value.rule.id}`,{startMinute:90},'PATCH',409,(await call(a,path)).etag);assert.deepEqual(state(),patchBefore)
  await call(a,url,{channelId:'b'},'PATCH',400,(await call(a,path)).etag)
  await call(a,url,{name:'Draft'},'PATCH',400,(await call(a,'/api/channels/b/rules')).etag)
  const original=await call(a,path);database.sqlite.prepare('UPDATE schedule_rules SET name=? WHERE id=?').run('ABA',saved.id);database.sqlite.prepare('UPDATE schedule_rules SET name=? WHERE id=?').run(saved.name,saved.id)
  const aba=state();await call(b,url,{name:'Draft'},'PATCH',409,original.etag);assert.deepEqual(state(),aba)
  const unicode='/api/channels/ch%3A%C3%A7/rules';assert.equal((await call(a,unicode,band,'POST',200,(await call(a,unicode)).etag)).value.channelId,'ch:ç')
  database.sqlite.exec("CREATE TRIGGER fixture_rule_audit_fail BEFORE INSERT ON operator_decisions WHEN NEW.kind='SCHEDULE_RULE_EDITED' BEGIN SELECT RAISE(ABORT,'RULE_AUDIT_FIXTURE'); END")
  for(const method of ['POST','PATCH','DELETE']){const previous=state(),target=method==='POST'?'/api/channels/b/rules':url,proof=await call(a,method==='POST'?'/api/channels/b/rules':path);await call(a,target,method==='POST'?band:method==='PATCH'?{name:'Draft'}:undefined,method,500,proof.etag);assert.deepEqual(state(),previous)}
  database.sqlite.exec('DROP TRIGGER fixture_rule_audit_fail')
  const dayPath='/api/channels/b/rules',dayBand=await call(a,dayPath,{...band,name:'Original day',weekdays:'0123456',startMinute:0,endMinute:1},'POST',200,(await call(a,dayPath)).etag)
  const proposed=(await call(a,'/api/rundowns/rd-day/autofill-day',{preview:true},'POST')).value
  assert.ok(proposed.plan.items.length>0,'Metadata fixture produced no day proposal')
  database.sqlite.prepare('UPDATE schedule_rules SET name=? WHERE id=?').run('ABA day',dayBand.value.rule.id)
  database.sqlite.prepare('UPDATE schedule_rules SET name=? WHERE id=?').run('Original day',dayBand.value.rule.id)
  const dayBefore=database.sqlite.prepare("SELECT * FROM rundown_items WHERE rundown_id='rd-day'").all()
  await call(b,'/api/rundowns/rd-day/autofill-day',{proposalId:proposed.proposal.id},'POST',409,`w/"${proposed.proposal.editorialRevision}"`)
  assert.deepEqual(database.sqlite.prepare("SELECT * FROM rundown_items WHERE rundown_id='rd-day'").all(),dayBefore)
  socket=new WebSocket(`ws://127.0.0.1:${a.port}/ws`);socket.addEventListener('error',()=>{});socket.addEventListener('message',event=>{const message=JSON.parse(String(event.data));if(message.type==='live'&&message.channelId==='a'){latest=message;sequence++}});await after(0)
  await call(a,'/api/channels/a/transport',{action:'cue',sourceRef:'ndi:SIMULATED_NOT_PHYSICAL'},'POST')
  await call(a,'/api/channels/a/transport',{action:'take'},'POST')
  const cued=await call(a,'/api/channels/a/transport',{action:'cue',sourceRef:'ndi:SIMULATED_OTHER_PREVIEW'},'POST'),transport=cued.value.live.transport,previous=sequence
  assert.equal(transport.onAir.itemId,'live-a');assert.equal(transport.preview.source,'ndi:SIMULATED_OTHER_PREVIEW')
  const updateReview=await call(b,path),changed=await call(b,url,{name:'Updated ç'},'PATCH',200,updateReview.etag)
  await call(b,url,{name:'Repeated'},'PATCH',409,updateReview.etag)
  const next=await after(previous);assert.deepEqual(next.preview,transport.preview);assert.equal(next.onAir.itemId,transport.onAir.itemId);assert.equal(next.playing,transport.playing)
  await call(b,url,undefined,'DELETE',200,(await call(b,path)).etag);await call(b,url,undefined,'DELETE',404,changed.etag)
  const restart=await call(a,path);await stop(b);await start(b);assert.equal((await call(b,path)).etag,restart.etag)
  const backup=join(directory,'backup.db');await database.sqlite.backup(backup);const valid=await validateBackupRestore(backup);assert.equal(valid.integrity,'ok');assert.equal(valid.foreignKeys,'ok')
  evidence={result:'PASS',evidence:'COMPILED_SCHEDULE_RULE_ORIGINAL_REVIEW',directory,ports:stations.map(row=>row.port),pids:stations.flatMap(row=>row.pids),serverSha256:createHash('sha256').update(await readFile(join(root,'apps/server/dist/server.cjs'))).digest('hex'),readOnlyStable:true,singleConcurrentWinner:true,blindCrudRejected:true,staleAbaRejected:true,ownerChangeRejected:true,overlapRejected:true,adjacentAndDistinctDaysAccepted:true,unicodeChannelAccepted:true,createUpdateDeleteAuditRollback:true,dayProposalAbaRejected:true,previewAndProgramPreserved:true,restartRevisionPreserved:true,backupValidated:true,transport:'SIMULATED',automaticTake:false,mediaDecoded:false,physicalSignalValidated:false,browserValidated:false,replicationValidated:false}
}finally{socket?.close();for(const station of stations)await stop(station);database.sqlite.close()}
for(const station of stations)await assert.rejects(()=>fetch(`http://127.0.0.1:${station.port}/api/health`,{signal:AbortSignal.timeout(2000)}))
console.log(JSON.stringify({...evidence,ownChildrenAndListenersClosed:true}))
