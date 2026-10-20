import assert from 'node:assert/strict'
import {spawn,type ChildProcess} from 'node:child_process'
import {mkdtemp,mkdir,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createServer} from 'node:net'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
import {openDatabase} from '../apps/server/src/db/client.js'
import {channels,rundowns,rundownItems,channelProjectSnapshots,secondaryEvents,scheduleRules} from '../apps/server/src/db/schema.js'
import {validateBackupRestore} from '../apps/server/src/domain/backup.js'

// Own compiled server and private DB only. This does NOT qualify physical
// video, physical publication, browser UI or distributed HA.
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(tmpdir(),'RPlayout-project-isolation-'))
const {eq}=createRequire(new URL('../apps/server/package.json',import.meta.url))('drizzle-orm')
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json')
const file=join(directory,'qa.db'),media=join(directory,'media');await mkdir(media)
const database=openDatabase(file),db=database.db,now=new Date().toISOString()
for(const id of ['a','b']){
  db.insert(channels).values({id,name:'Projeto çãó '+id,width:320,height:180,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:now}).run()
  db.insert(rundowns).values({id:'rd-'+id,channelId:id,name:id,date:'2026-10-05',plannedStart:0,loop:false,createdAt:now,updatedAt:now}).run()
  db.insert(rundownItems).values({id:'item-'+id,rundownId:'rd-'+id,sortOrder:0,type:'LIVE',title:id,sourceRef:'ndi:FIXTURE_NOT_PHYSICAL_'+id,minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',locked:false,autoNext:true,loop:false}).run()
  db.insert(secondaryEvents).values({id:'event-'+id,channelId:id,itemId:'item-'+id,definition:{id:'event-'+id,rundownItemId:'item-'+id,targetLayer:'LOWER_THIRD',triggerMode:'MANUAL',offsetFrames:0,templateId:'',payload:{},enabled:false},createdAt:now,updatedAt:now}).run()
}
for(const [id,startMinute,endMinute] of [['band-1',100,160],['band-2',160,220]] as const){
  db.insert(scheduleRules).values({id,channelId:'a',name:id,weekdays:'1',startMinute,endMinute,categories:[],avoidHours:6,createdAt:now}).run()
}
const socket=createServer();await new Promise<void>(resolve=>socket.listen(0,'127.0.0.1',resolve))
const port=(socket.address() as {port:number}).port;await new Promise<void>((resolve,reject)=>socket.close(error=>error?reject(error):resolve()))
let child:ChildProcess|null=null,logs='',evidence:Record<string,unknown>|null=null
async function call(path:string,body?:object,expected=200,headers:Record<string,string>={}){
  const response=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10_000)})
  const text=await response.text();assert.equal(response.status,expected,`${path}: ${response.status} ${text.slice(0,400)}`)
  return {value:JSON.parse(text),cache:response.headers.get('cache-control'),etag:response.headers.get('etag')}
}
function rows(){
  const state=Object.fromEntries(['channels','rundowns','rundown_items','output_profiles','transmission_presets','live_sources','schedule_rules','multiview_configs','destinations','guest_keys','graphic_templates','item_graphics','secondary_events','channel_configuration_versions','channel_project_versions','editorial_revision_counters','live_source_versions','multiview_versions','schedule_rule_versions','graphics_versions','graphics_initialization'].map(table=>[table,database.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
  // A refused request legitimately adds HTTP/fencing-attempt records. Assert
  // that it never adds a successful project capture/restore audit instead.
  state.project_success_audit=database.sqlite.prepare("SELECT * FROM operator_decisions WHERE kind IN ('CHANNEL_PROJECT_SAVED','CHANNEL_PROJECT_RESTORED') ORDER BY rowid").all()
  return state
}
try{
  child=spawn(process.execPath,[join(root,'apps/server/dist/server.cjs')],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,
    RPLAYOUT_DB:file,RPLAYOUT_VAULT_FILE:join(directory,'vault.json'),RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_MEDIA:media,
    RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_CACHE:join(directory,'cache'),RPLAYOUT_BACKUPS:join(directory,'backups'),
    RPLAYOUT_ENGINE:'',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_DEVICES:'',RPLAYOUT_RELAY:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_N1_PEER:'',RPLAYOUT_BACKUP_HOURS:'0',
    RPLAYOUT_HA_ROLE:'',RPLAYOUT_HA_PEER:'',RPLAYOUT_ADMIN_USER:'',RPLAYOUT_ADMIN_PASSWORD:'',RPLAYOUT_ROLE:'ADMIN',RPLAYOUT_CONTROL_TOKEN:'',HOST:'127.0.0.1',PORT:String(port),LOG_LEVEL:'warn'}})
  child.stdout?.on('data',chunk=>logs=(logs+String(chunk)).slice(-8000));child.stderr?.on('data',chunk=>logs=(logs+String(chunk)).slice(-8000));child.on('error',error=>logs+=error.message)
  const end=performance.now()+20_000;let ready=false
  while(performance.now()<end){assert.equal(child.exitCode,null,logs);try{if((await call('/api/health')).value.ok){ready=true;break}}catch{}await new Promise(resolve=>setTimeout(resolve,100))}
  assert.equal(ready,true,logs)
  const list=await call('/api/channels/a/projects');assert.equal(list.cache,'private, no-store')
  const project=(await call('/api/channels/a/projects',{label:'Projeto conferido çãó'})).value.project
  const original=structuredClone(db.select().from(channelProjectSnapshots).where(eq(channelProjectSnapshots.id,project.id)).get()!.payload) as any
  const restore=`/api/channels/a/projects/${project.id}/restore`,reviewUrl=restore.replace(/\/restore$/,'/restore-review')
  const originalReview=await call(reviewUrl);assert.equal(originalReview.cache,'private, no-store')
  const damaged=structuredClone(original);damaged.rundowns[0].id='rd-b'
  db.update(channelProjectSnapshots).set({payload:damaged}).where(eq(channelProjectSnapshots.id,project.id)).run()
  const before=rows()
  await call(reviewUrl,undefined,400)
  await call(restore,{reviewToken:originalReview.value.review.token},409,{'if-match':originalReview.etag!});assert.deepEqual(rows(),before)
  db.update(channelProjectSnapshots).set({payload:original}).where(eq(channelProjectSnapshots.id,project.id)).run()
  const malformed=structuredClone(original);malformed.items[0].anchor={kind:'WINDOW',from:250,to:100,priority:5}
  db.update(channelProjectSnapshots).set({payload:malformed}).where(eq(channelProjectSnapshots.id,project.id)).run()
  const semanticBefore=rows(),revision=(database.sqlite.prepare('SELECT version FROM channel_project_versions WHERE channel_id=?').get('a') as {version:number}).version
  await call(reviewUrl,undefined,400)
  await call(restore,{reviewToken:'0'.repeat(64)},400,{'if-match':`"project:a:${encodeURIComponent(project.id)}:${revision}"`});assert.deepEqual(rows(),semanticBefore)
  db.update(channelProjectSnapshots).set({payload:original}).where(eq(channelProjectSnapshots.id,project.id)).run()
  db.update(rundownItems).set({anchor:malformed.items[0].anchor}).where(eq(rundownItems.id,'item-a')).run()
  const captureBefore=rows(),snapshotsBefore=database.sqlite.prepare('SELECT COUNT(*) AS n FROM channel_project_snapshots').get()
  await call('/api/channels/a/projects',{label:'Configuração inválida'},400);assert.deepEqual(rows(),captureBefore);assert.deepEqual(database.sqlite.prepare('SELECT COUNT(*) AS n FROM channel_project_snapshots').get(),snapshotsBefore)
  db.update(rundownItems).set({anchor:original.items[0].anchor}).where(eq(rundownItems.id,'item-a')).run()
  // Project capture/review/restore must not bypass the ordinary rule overlap
  // guard. Do not normalize, discard bands or refresh old intent implicitly.
  const overlapping=structuredClone(original);overlapping.rules[1].startMinute=150
  db.update(channelProjectSnapshots).set({payload:overlapping}).where(eq(channelProjectSnapshots.id,project.id)).run()
  const overlapBefore=rows(),overlapRevision=(database.sqlite.prepare('SELECT version FROM channel_project_versions WHERE channel_id=?').get('a') as {version:number}).version
  await call(reviewUrl,undefined,400)
  await call(restore,{reviewToken:'0'.repeat(64)},400,{'if-match':`"project:a:${encodeURIComponent(project.id)}:${overlapRevision}"`});assert.deepEqual(rows(),overlapBefore)
  db.update(channelProjectSnapshots).set({payload:original}).where(eq(channelProjectSnapshots.id,project.id)).run()
  db.update(scheduleRules).set({startMinute:150}).where(eq(scheduleRules.id,'band-2')).run()
  const invalidBandsBefore=rows(),invalidBandsSnapshots=database.sqlite.prepare('SELECT COUNT(*) AS n FROM channel_project_snapshots').get()
  await call('/api/channels/a/projects',{label:'Faixas sobrepostas não aprovadas'},400);assert.deepEqual(rows(),invalidBandsBefore);assert.deepEqual(database.sqlite.prepare('SELECT COUNT(*) AS n FROM channel_project_snapshots').get(),invalidBandsSnapshots)
  db.update(scheduleRules).set({startMinute:160}).where(eq(scheduleRules.id,'band-2')).run()
  db.update(channels).set({width:640}).where(eq(channels.id,'a')).run()
  const altered=rows()
  const failedReview=await call(reviewUrl)
  database.sqlite.exec("CREATE TRIGGER fixture_restore_audit_fail BEFORE INSERT ON operator_decisions WHEN NEW.kind='CHANNEL_PROJECT_RESTORED' BEGIN SELECT RAISE(ABORT,'project rollback fixture'); END")
  await call(restore,{reviewToken:failedReview.value.review.token},409,{'if-match':failedReview.etag!});assert.deepEqual(rows(),altered);database.sqlite.exec('DROP TRIGGER fixture_restore_audit_fail')
  const count=database.sqlite.prepare('SELECT COUNT(*) AS n FROM channel_project_snapshots').get(),captureRollbackBefore=rows()
  database.sqlite.exec("CREATE TRIGGER fixture_save_audit_fail BEFORE INSERT ON operator_decisions WHEN NEW.kind='CHANNEL_PROJECT_SAVED' BEGIN SELECT RAISE(ABORT,'capture rollback fixture'); END")
  await call('/api/channels/a/projects',{label:'Não deve gravar'},500);assert.deepEqual(database.sqlite.prepare('SELECT COUNT(*) AS n FROM channel_project_snapshots').get(),count);assert.deepEqual(rows(),captureRollbackBefore);database.sqlite.exec('DROP TRIGGER fixture_save_audit_fail')
  const foreignBefore=db.select().from(secondaryEvents).where(eq(secondaryEvents.channelId,'b')).all()
  db.update(secondaryEvents).set({definition:{...original.secondaryEvents[0].definition,offsetFrames:999}}).where(eq(secondaryEvents.id,'event-a')).run()
  // Old original proof remains invalid even after its snapshot was reverted.
  await call(restore,{reviewToken:originalReview.value.review.token},409,{'if-match':originalReview.etag!})
  const fresh=await call(reviewUrl)
  const restored=(await call(restore,{reviewToken:fresh.value.review.token},200,{'if-match':fresh.etag!})).value;assert.equal(restored.applied,true);assert.equal(restored.automaticTake,false);assert.equal(restored.engineError,undefined)
  await call(restore,{reviewToken:fresh.value.review.token},409,{'if-match':fresh.etag!})
  assert.equal(db.select().from(channels).where(eq(channels.id,'a')).get()!.width,320)
  assert.deepEqual(db.select().from(scheduleRules).where(eq(scheduleRules.channelId,'a')).all().map(row=>({id:row.id,startMinute:row.startMinute,endMinute:row.endMinute})).sort((a,b)=>a.id.localeCompare(b.id)),original.rules.map((row:any)=>({id:row.id,startMinute:row.startMinute,endMinute:row.endMinute})).sort((a:any,b:any)=>a.id.localeCompare(b.id)))
  assert.equal(db.select().from(secondaryEvents).where(eq(secondaryEvents.id,'event-a')).get()!.definition.offsetFrames,0)
  assert.deepEqual(db.select().from(secondaryEvents).where(eq(secondaryEvents.channelId,'b')).all(),foreignBefore)
  const backup=join(directory,'validated-backup.db');await database.sqlite.backup(backup)
  const validation=await validateBackupRestore(backup);assert.equal(validation.integrity,'ok');assert.equal(validation.foreignKeys,'ok')
  evidence={result:'PASS',evidence:'COMPILED_PROJECT_ISOLATION_AND_ATOMIC_AUDIT',directory,port,pid:child.pid,serverSha256:createHash('sha256').update(await readFile(join(root,'apps/server/dist/server.cjs'))).digest('hex'),
    foreignRundownRejected:true,semanticReviewAndCommitRejected:true,invalidCaptureRejected:true,overlappingProjectReviewAndCommitRejected:true,overlappingRulesCaptureRejected:true,adjacentRulesRestored:true,captureAuditRollback:true,restoreAuditAndCountersRollback:true,secondaryEventsReplaced:true,foreignEventsPreserved:true,backupRestored:true,
    automaticTake:false,transport:'SIMULATED',physicalOutputValidated:false,mediaDecoded:false,browserPlaybackValidated:false,staleReviewValidated:true,proofReuseRejected:true,replicationValidated:false}
}finally{
  if(child&&child.exitCode===null&&child.signalCode===null){const stopped=new Promise<void>(resolve=>child!.once('exit',()=>resolve()));child.kill('SIGKILL');await stopped}
  database.sqlite.close()
}
if(evidence){await assert.rejects(()=>fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(2000)}));console.log(JSON.stringify({...evidence,ownChildAndListenerClosed:true}))}
