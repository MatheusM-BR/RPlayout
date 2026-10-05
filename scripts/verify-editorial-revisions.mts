import assert from 'node:assert/strict'
import {spawn,type ChildProcess} from 'node:child_process'
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createServer} from 'node:net'
import {createHash} from 'node:crypto'

// Two independent compiled servers on one isolated database. This validates
// shared durable edit preconditions, NOT replication, standby or physical PGM.
const workspace=fileURLToPath(new URL('..',import.meta.url))
const argument=process.argv.indexOf('--package')
const root=argument<0?workspace:resolve(process.argv[argument+1]!)
const directory=await mkdtemp(join(tmpdir(),'RPlayout-editorial-revisions-'))
const media=join(directory,'media');await mkdir(media)
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json')
const {openDatabase}=await import('../apps/server/src/db/client.js')
const database=openDatabase(join(directory,'editorial.db'))
async function reserve(){
  const socket=createServer();await new Promise<void>(resolve=>socket.listen(0,'127.0.0.1',resolve))
  const port=(socket.address() as {port:number}).port;await new Promise<void>(resolve=>socket.close(()=>resolve()))
  return port
}
type Station={port:number;child:ChildProcess|null;logs:string;pids:number[]}
const stations:Station[]=[{port:await reserve(),child:null,logs:'',pids:[]},{port:await reserve(),child:null,logs:'',pids:[]}]
async function api(station:Station,path:string,body?:object,method=body?'POST':'GET',expected=200,etag?:string){
  const response=await fetch(`http://127.0.0.1:${station.port}${path}`,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(etag?{'If-Match':etag}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(5000)})
  const text=await response.text()
  assert.equal(response.status,expected,`${method} ${path}: ${response.status} ${text.slice(0,500)}`)
  return {value:JSON.parse(text),etag:response.headers.get('etag')}
}
async function start(station:Station){
  station.logs=''
  station.child=spawn(argument<0?process.execPath:join(root,'runtime/node/node.exe'),[join(root,'apps/server/dist/server.cjs')],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,
    RPLAYOUT_DB:join(directory,'editorial.db'),RPLAYOUT_VAULT_FILE:join(directory,'vault.json'),RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_MEDIA:media,
    RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_CACHE:join(directory,'cache'),RPLAYOUT_BACKUPS:join(directory,'backups'),
    RPLAYOUT_ENGINE:'',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_DEVICES:'',RPLAYOUT_RELAY:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_N1_PEER:'',RPLAYOUT_BACKUP_HOURS:'0',
    RPLAYOUT_ADMIN_USER:'',RPLAYOUT_ADMIN_PASSWORD:'',RPLAYOUT_ROLE:'ADMIN',RPLAYOUT_CONTROL_TOKEN:'',HOST:'127.0.0.1',PORT:String(station.port),LOG_LEVEL:'warn'}})
  if(station.child.pid)station.pids.push(station.child.pid)
  for(const stream of [station.child.stdout,station.child.stderr])stream?.on('data',chunk=>{station.logs=(station.logs+String(chunk)).slice(-8000)})
  station.child.on('error',error=>{station.logs+=error.message})
  const end=performance.now()+20000
  while(performance.now()<end){
    assert.equal(station.child.exitCode,null,`Servidor terminou: ${station.logs}`)
    try{if((await api(station,'/api/health')).value.ok)return}catch{}
    await new Promise(resolve=>setTimeout(resolve,100))
  }
  throw new Error(`Servidor compilado não iniciou: ${station.logs}`)
}
async function stop(station:Station){
  const child=station.child;station.child=null
  if(!child || child.exitCode!==null || child.signalCode!==null)return
  const exited=new Promise<void>(resolve=>child.once('exit',()=>resolve()))
  child.kill('SIGKILL');await exited
}
function automationState(value:any){const {cueId,event,ok,eventId,...state}=value;return state}
const read='/api/v1/rundowns/rd/revisions',write='/api/v1/rundowns/rd/items/item'
try{
  database.sqlite.exec(`INSERT INTO channels(id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES('edit','Editorial isolado',25,1,320,180,-23,-1,5,'now');
    INSERT INTO rundowns(id,channel_id,name,planned_start,date,created_at,updated_at) VALUES('rd','edit','Duas estações',0,'2026-10-01','now','now');
    INSERT INTO rundown_items(id,rundown_id,sort_order,type,title,duration_override,min_duration,anchor,on_overrun,locked,auto_next,loop) VALUES('item','rd',0,'LIVE','INICIAL',500,0,'{"kind":"FLOW"}','PUSH',0,1,0);`)
  const a=stations[0]!,b=stations[1]!
  // Startup is sequential to isolate migration/bootstrap from the write race.
  await start(a);await start(b)
  const initial=await api(a,read),other=await api(b,read)
  assert.equal(initial.etag,other.etag);assert.deepEqual(initial.value,other.value)
  await api(a,write,{patch:{title:'CEGA'}},'PUT',428)
  const accepted=await api(a,write,{patch:{title:'ESTAÇÃO A ÇÃO'}},'PUT',200,initial.etag!)
  assert.equal(accepted.value.newRundownVersion,initial.value.rundownVersion+1)
  await api(b,write,{patch:{title:'ANTIGA B'}},'PUT',409,initial.etag!)
  const current=await api(b,read)
  await api(b,write,{expectedRundownVersion:current.value.rundownVersion,patch:{title:'CORPO NÃO ANULA HEADER'}},'PUT',409,initial.etag!)
  // A legacy/canonical writer must invalidate cooperative edits on both nodes.
  await api(a,'/api/items/item',{title:'CANÔNICA'},'PATCH',200,current.etag!)
  await api(b,'/api/items/item',{title:'CANÔNICA ANTIGA'},'PATCH',409,current.etag!)
  await api(b,write,{patch:{title:'STALE AFTER PATCH'}},'PUT',409,current.etag!)
  const concurrent=await api(a,read)
  const attempts=await Promise.all(stations.map((station,index)=>fetch(`http://127.0.0.1:${station.port}${write}`,{method:'PUT',headers:{'Content-Type':'application/json','If-Match':concurrent.etag!},body:JSON.stringify({patch:{title:`CONCORRENTE ${index}`}}),signal:AbortSignal.timeout(5000)})))
  assert.deepEqual(attempts.map(res=>res.status).sort(),[200,409])
  const winner=await attempts.find(res=>res.status===200)!.json() as any
  const committed=await api(a,read)
  assert.equal(committed.value.items[0].item.title,winner.item.title)
  assert.equal(committed.value.rundownVersion,concurrent.value.rundownVersion+1)
  assert.deepEqual((await api(b,read)).value,committed.value)
  const timeline=await api(b,'/api/v1/timeline/rd/multitrack')
  assert.equal(timeline.value.rundownVersion,committed.value.rundownVersion)
  await stop(b);await start(b)
  assert.deepEqual((await api(b,read)).value,committed.value)
  await api(b,write,{patch:{title:'ANTIGA APÓS REINÍCIO'}},'PUT',409,concurrent.etag!)
  const discard=await api(b,'/api/v1/rundowns/rd/resolve-conflict',{itemId:'item',clientRundownVersion:committed.value.rundownVersion,resolutionStrategy:'DISCARD_MINE',patch:{title:'IGNORAR'}})
  assert.equal(discard.value.newRundownVersion,committed.value.rundownVersion)
  assert.deepEqual((await api(a,read)).value,committed.value)
  database.sqlite.exec(`INSERT INTO channels(id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES('shared','Compartilhado',25,1,320,180,-23,-1,5,'now');
    UPDATE channels SET rate_num=50 WHERE id='shared';
    INSERT INTO rundowns(id,channel_id,name,planned_start,date,created_at,updated_at) VALUES('shared-grade','shared','Grade compartilhada',0,'2026-10-01','now','now');
    INSERT INTO media_assets(id,content_hash,path,title,kind,duration_frames,rate_num,rate_den,created_at) VALUES('asset','hash','C:/isolated-missing.mp4','VT','VIDEO',500,25,1,'now');
    UPDATE rundown_items SET media_id='asset' WHERE id='item';
    INSERT INTO rundown_items(id,rundown_id,sort_order,type,title,media_id,min_duration,anchor,on_overrun,locked,auto_next,loop) VALUES('shared-item','shared-grade',0,'VT','Compartilhado','asset',0,'{"kind":"FLOW"}','PUSH',0,1,0);`)
  const beforeScoped=await api(a,read),beforeHistory=await api(a,'/api/rundowns/rd')
  await api(a,'/api/items/item/trim',{trim:{in:25,out:250},scope:'ITEM'},'POST',428)
  await api(a,'/api/items/item/audio',{audio:{mode:'MANUAL',gainDb:-3,measured:null},scope:'ITEM',audioTrack:1},'POST',428)
  assert.deepEqual((await api(b,read)).value,beforeScoped.value)
  assert.deepEqual((await api(a,'/api/rundowns/rd')).value.history,beforeHistory.value.history)
  const scopePath='/api/items/item/edit-scope?scope=ASSET_DEFAULT'
  const originalScope=(await api(a,scopePath,undefined,'GET',200,beforeScoped.etag!)).value.review
  assert.equal(originalScope.references,2)
  assert.equal(originalScope.owners.length,2)
  database.sqlite.exec("UPDATE rundown_items SET notes='OUTRA GRADE POSTERIOR' WHERE id='shared-item'")
  assert.equal((await api(a,read)).etag,beforeScoped.etag)
  const supersededScope=await api(a,'/api/items/item/trim',{trim:{in:25,out:250},scope:'ASSET_DEFAULT',scopeReviewToken:originalScope.token},'POST',409,beforeScoped.etag!)
  assert.equal(supersededScope.value.error,'SCOPE_REVIEW_SUPERSEDED')
  assert.deepEqual(database.sqlite.prepare("SELECT default_trim FROM media_assets WHERE id='asset'").get(),{default_trim:null})
  const reviewedScope=(await api(b,scopePath,undefined,'GET',200,beforeScoped.etag!)).value.review
  assert.notEqual(reviewedScope.token,originalScope.token)
  const scopedRequest={trim:{in:25,out:250},scope:'ASSET_DEFAULT',scopeReviewToken:reviewedScope.token}
  database.sqlite.exec("CREATE TRIGGER fail_scoped_edit BEFORE UPDATE OF trim ON rundown_items WHEN NEW.id='item' BEGIN SELECT RAISE(ABORT,'falha isolada após padrão'); END")
  await api(a,'/api/items/item/trim',scopedRequest,'POST',500,beforeScoped.etag!)
  assert.deepEqual((await api(b,read)).value,beforeScoped.value)
  assert.deepEqual(database.sqlite.prepare("SELECT default_trim FROM media_assets WHERE id='asset'").get(),{default_trim:null})
  assert.deepEqual((await api(a,'/api/rundowns/rd')).value.history,beforeHistory.value.history)
  database.sqlite.exec('DROP TRIGGER fail_scoped_edit')
  await api(a,'/api/items/item/trim',scopedRequest,'POST',200,(await api(a,read)).etag!)
  assert.deepEqual(database.sqlite.prepare("SELECT default_trim FROM media_assets WHERE id='asset'").get(),{default_trim:'{"in":25,"out":250}'})
  assert.deepEqual(database.sqlite.prepare("SELECT default_trim_rate_num,default_trim_rate_den FROM media_assets WHERE id='asset'").get(),{default_trim_rate_num:25,default_trim_rate_den:1})
  assert.deepEqual((await api(b,'/api/rundowns/shared-grade')).value.view.items.find((row:any)=>row.item.id==='shared-item').trim,{in:50,out:500})
  const sharedRead='/api/v1/rundowns/shared-grade/revisions',ownAfterDefault=await api(a,read)
  await api(b,'/api/items/shared-item',{notes:'AFTER DEFAULT ON OTHER GRADE'},'PATCH',200,(await api(b,sharedRead)).etag!)
  assert.equal((await api(a,read)).etag,ownAfterDefault.etag)
  const rejectedDefaultUndo=await api(a,'/api/rundowns/rd/undo',{},'POST',409,ownAfterDefault.etag!)
  assert.equal(rejectedDefaultUndo.value.error,'HISTORY_SUPERSEDED')
  assert.deepEqual(database.sqlite.prepare("SELECT default_trim FROM media_assets WHERE id='asset'").get(),{default_trim:'{"in":25,"out":250}'})
  assert.equal((await api(a,'/api/rundowns/rd')).value.history.canUndo,true)
  await api(b,'/api/rundowns/shared-grade/undo',{},'POST',200,(await api(b,sharedRead)).etag!)
  database.sqlite.exec("UPDATE channels SET archived_at='2026-10-01T23:00:00Z' WHERE id='shared'")
  const archivedSnapshot=await api(b,read)
  await api(b,'/api/items/item/trim',{trim:{in:50,out:300},scope:'ASSET_DEFAULT'},'POST',409)
  await api(a,'/api/rundowns/rd/undo',{},'POST',409,(await api(a,read)).etag!)
  assert.deepEqual((await api(b,read)).value,archivedSnapshot.value)
  database.sqlite.exec("UPDATE channels SET archived_at=NULL WHERE id='shared'")
  await api(a,'/api/rundowns/rd/undo',{},'POST',200,(await api(a,read)).etag!)
  assert.deepEqual(database.sqlite.prepare("SELECT default_trim FROM media_assets WHERE id='asset'").get(),{default_trim:null})
  assert.deepEqual(database.sqlite.prepare("SELECT default_trim_rate_num,default_trim_rate_den FROM media_assets WHERE id='asset'").get(),{default_trim_rate_num:null,default_trim_rate_den:null})
  const wideTrimReview=(await api(b,'/api/items/item/edit-scope?scope=ALL_RUNDOWNS',undefined,'GET',200,(await api(a,read)).etag!)).value.review
  await api(a,'/api/items/item/trim',{trim:{in:25,out:250},scope:'ALL_RUNDOWNS',scopeReviewToken:wideTrimReview.token},'POST',200,(await api(a,read)).etag!)
  assert.deepEqual(database.sqlite.prepare("SELECT trim FROM rundown_items WHERE id='shared-item'").get(),{trim:'{"in":50,"out":500}'})
  await api(a,'/api/rundowns/rd/undo',{},'POST',200,(await api(a,read)).etag!)
  assert.deepEqual(database.sqlite.prepare("SELECT trim FROM rundown_items WHERE id='shared-item'").get(),{trim:null})
  assert.equal((await api(a,read)).value.items[0].item.title,winner.item.title)
  const {rundownItems:audioRows}=await import('../apps/server/src/db/schema.js')
  const beforeAudio=database.db.select({track:audioRows.audioTrack,audio:audioRows.audio}).from(audioRows).all()
  await api(a,'/api/items/item/audio',{audio:{mode:'MANUAL',gainDb:-3,measured:null},scope:'ITEM',audioTrack:1},'POST',200,(await api(a,read)).etag!)
  assert.deepEqual(database.sqlite.prepare("SELECT audio_track FROM rundown_items WHERE id='item'").get(),{audio_track:1})
  await api(a,'/api/rundowns/rd/undo',{},'POST',200,(await api(a,read)).etag!)
  assert.deepEqual(database.db.select({track:audioRows.audioTrack,audio:audioRows.audio}).from(audioRows).all(),beforeAudio)
  // A current client revision is not authorization to overwrite the result
  // of a later writer with this process's older local undo frame.
  await api(a,'/api/items/item',{notes:'LOCAL A'},'PATCH',200,(await api(a,read)).etag!)
  await api(b,'/api/items/item',{title:'ESCRITOR B POSTERIOR'},'PATCH',200,(await api(b,read)).etag!)
  const later=await api(a,read)
  const superseded=await api(a,'/api/rundowns/rd/undo',{},'POST',409,later.etag!)
  assert.equal(superseded.value.error,'HISTORY_SUPERSEDED')
  assert.deepEqual((await api(a,read)).value,later.value)
  assert.equal((await api(a,'/api/rundowns/rd')).value.history.canUndo,true)
  // The later writer can undo its own last exact change, and then A can
  // undo its earlier notes without reverting the unrelated durable title.
  await api(b,'/api/rundowns/rd/undo',{},'POST',200,later.etag!)
  await api(a,'/api/rundowns/rd/undo',{},'POST',200,(await api(a,read)).etag!)
  const reverted=await api(a,read)
  assert.equal(reverted.value.items[0].item.title,winner.item.title)
  assert.equal(reverted.value.items[0].item.notes,null)
  await api(b,'/api/rundowns/rd/redo',{},'POST',409,reverted.etag!)
  // Confirm exactly the reviewed dependency snapshot, across two processes.
  database.sqlite.exec("INSERT INTO rundowns(id,channel_id,name,planned_start,date,created_at,updated_at) VALUES('publication','edit','Publicação conferida',0,'2026-10-02','now','now')")
  database.db.insert(audioRows).values({id:'publication-live',rundownId:'publication',sortOrder:0,type:'LIVE',title:'Estúdio',sourceRef:'ndi:CAM',durationOverride:500,minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',locked:false,autoNext:false,loop:false}).run()
  const simulation='/api/rundowns/publication/operational-simulation',publication='/api/rundowns/publication/operational-publish'
  const firstReview=(await api(a,simulation)).value.review,versionHeader=(review:any)=>`w/"${review.editorialRevision}"`
  assert.deepEqual((await api(b,simulation)).value.review,firstReview)
  await api(a,publication,{},'POST',428,versionHeader(firstReview))
  await api(b,'/api/items/publication-live',{notes:'ESCRITOR B'},'PATCH',200,versionHeader(firstReview))
  const changed=(await api(a,simulation)).value.review
  await api(a,publication,{reviewToken:firstReview.token},'POST',409,versionHeader(changed))
  await stop(b);await start(b)
  assert.deepEqual((await api(b,simulation)).value.review,changed)
  const confirmations=await Promise.all(stations.map(station=>fetch(`http://127.0.0.1:${station.port}${publication}`,{method:'POST',headers:{'Content-Type':'application/json','If-Match':versionHeader(changed)},body:JSON.stringify({reviewToken:changed.token}),signal:AbortSignal.timeout(10_000)})))
  assert.deepEqual(confirmations.map(response=>response.status).sort(),[201,409])
  const source=(await confirmations.find(response=>response.status===201)!.json() as any).id
  const publishFresh=async(station:Station)=>{const review=(await api(station,simulation)).value.review;return api(station,publication,{reviewToken:review.token},'POST',201,versionHeader(review))}
  await publishFresh(a)
  const rollbackPath='/api/rundowns/publication/operational-rollback',reviewPath=`/api/rundowns/publication/operational-rollback-review?revisionId=${source}`
  const reviewHeader=versionHeader((await api(a,simulation)).value.review)
  const rollbackBefore=(await api(a,reviewPath,undefined,'GET',200,reviewHeader)).value.review
  await publishFresh(b)
  const currentRollbackHeader=versionHeader((await api(a,simulation)).value.review)
  const rejectedRollback=await api(a,rollbackPath,{revisionId:source,reviewToken:rollbackBefore.token},'POST',409,currentRollbackHeader)
  assert.equal(rejectedRollback.value.error,'OPERATIONAL_REVIEW_SUPERSEDED')
  const freshRollback=(await api(a,reviewPath,undefined,'GET',200,currentRollbackHeader)).value.review
  assert.equal((await api(b,rollbackPath,{revisionId:source,reviewToken:freshRollback.token},'POST',200,currentRollbackHeader)).value.revision,4)
  assert.equal((database.sqlite.prepare("SELECT COUNT(*) AS n FROM operational_playlist_revisions WHERE rundown_id='publication'").get() as any).n,4)
  assert.equal((database.sqlite.prepare("SELECT COUNT(*) AS n FROM operator_decisions WHERE rundown_id='publication' AND kind LIKE 'OPERATIONAL_PLAYLIST_%'").get() as any).n,4)
  assert.equal((database.sqlite.prepare("SELECT notes FROM rundown_items WHERE id='publication-live'").get() as any).notes,'ESCRITOR B')
  const automationRead='/api/items/publication-live/graphics'
  const capturedAutomation=(await api(a,automationRead)).value
  const zones=[{id:'protected',label:'Jornal',from:0,to:2500,priority:5}]
  await api(a,'/api/rundowns/publication/protected-zones',{zones},'PUT',428)
  await api(b,'/api/rundowns/publication/protected-zones',{zones},'PUT',200,versionHeader(capturedAutomation))
  await api(a,'/api/rundowns/publication/protected-zones',{zones:[]},'PUT',409,versionHeader(capturedAutomation))
  assert.deepEqual((await api(a,'/api/rundowns/publication')).value.view.rundown.protectedZones,zones)
  const {graphicTemplates:automationTemplates}=await import('../apps/server/src/db/schema.js')
  database.db.insert(automationTemplates).values({id:'automation-art',channelId:'edit',name:'Tarja QA',svg:'<svg/>',fields:[],fadeMs:0,createdAt:'now'}).run()
  const automationOpened=(await api(a,automationRead)).value
  const cueAdded=(await api(a,automationRead,{templateId:'automation-art',atSeconds:5,values:{title:'QA'}},'POST',200,versionHeader(automationOpened))).value
  assert.equal(cueAdded.cues.length,1);assert.equal(cueAdded.rundownId,'publication')
  assert.deepEqual((await api(b,automationRead)).value,automationState(cueAdded))
  await api(b,`/api/item-graphics/${cueAdded.cues[0].id}`,undefined,'DELETE',409,versionHeader(automationOpened))
  await api(b,`/api/item-graphics/${cueAdded.cues[0].id}`,undefined,'DELETE',200,versionHeader(cueAdded))
  const afterRemoval=(await api(b,automationRead)).value
  await api(b,'/api/rundowns/publication/undo',{},'POST',200,versionHeader(afterRemoval))
  assert.deepEqual((await api(a,automationRead)).value.cues,cueAdded.cues)
  const eventOpened=(await api(a,automationRead)).value
  const eventAdded=(await api(a,'/api/items/publication-live/secondary-events',{name:'Crédito',type:'GRAPHICS_OVERLAY',targetLayer:'LOWER_THIRD',triggerMode:'MANUAL',offsetFrames:0,templateId:'automation-art',payload:{title:'QA'}},'POST',200,versionHeader(eventOpened))).value
  await api(b,'/api/items/publication-live/secondary-events',{name:'Superado',type:'GRAPHICS_OVERLAY',targetLayer:'LOWER_THIRD',triggerMode:'MANUAL',offsetFrames:0,templateId:'automation-art'},'POST',409,versionHeader(eventOpened))
  assert.deepEqual((await api(b,automationRead)).value,automationState(eventAdded))
  assert.equal(eventAdded.events.length,1)
  // Persisted autofill is an immutable encrypted event, not a recomputed plan.
  const {mediaAssets:fillAssets,scheduleRules:fillRules}=await import('../apps/server/src/db/schema.js')
  const original=join(media,'QC-original-ação.mp4');await writeFile(original,'ORIGINAL_QC_BYTES')
  const fillHash=createHash('sha256').update('ORIGINAL_QC_BYTES').digest('hex')
  database.db.insert(fillAssets).values({id:'fill-reviewed',contentHash:fillHash,path:original,title:'Escolha conferida',kind:'VIDEO',durationFrames:2500,
    durationNs:100_000_000_000,rateNum:25,rateDen:1,width:1920,height:1080,qcStatus:'APPROVED',categoryId:'REVIEW_TEST',createdAt:'now'}).run()
  database.sqlite.exec("INSERT INTO rundowns(id,channel_id,name,planned_start,date,created_at,updated_at) VALUES('fill-grade','edit','Montagem conferida',0,'2026-10-02','now','now')")
  const fillPath='/api/rundowns/fill-grade/autofill'
  const fillReview=(await api(a,fillPath,{minutes:2,categories:['REVIEW_TEST'],preview:true})).value
  assert.equal(fillReview.plan.items.length,1)
  assert.match((database.sqlite.prepare('SELECT payload FROM operator_decisions WHERE id=?').get(fillReview.proposal.id) as any).payload,/^rplayout-secret:v1:/)
  await stop(b);await start(b)
  const fillHeader=`w/"${fillReview.proposal.editorialRevision}"`
  const fillAttempts=await Promise.all(stations.map(station=>fetch(`http://127.0.0.1:${station.port}${fillPath}`,{method:'POST',headers:{'Content-Type':'application/json','If-Match':fillHeader},body:JSON.stringify({proposalId:fillReview.proposal.id}),signal:AbortSignal.timeout(10_000)})))
  assert.deepEqual(fillAttempts.map(response=>response.status).sort(),[200,409])
  assert.deepEqual((await fillAttempts.find(response=>response.status===200)!.json() as any).plan,fillReview.plan)
  assert.equal((database.sqlite.prepare("SELECT count(*) AS n FROM rundown_items WHERE rundown_id='fill-grade'").get() as any).n,1)
  const currentFill=(await api(b,'/api/rundowns/fill-grade')).value.view.editorialRevision
  await api(b,fillPath,{proposalId:fillReview.proposal.id},'POST',409,`w/"${currentFill}"`)
  const staleMedia=(await api(b,fillPath,{minutes:2,categories:['REVIEW_TEST'],preview:true})).value
  database.sqlite.exec("UPDATE media_assets SET qc_status='BLOCKED' WHERE id='fill-reviewed'")
  await api(a,fillPath,{proposalId:staleMedia.proposal.id},'POST',409,`w/"${staleMedia.proposal.editorialRevision}"`)
  database.sqlite.exec("UPDATE media_assets SET qc_status='APPROVED' WHERE id='fill-reviewed'")
  database.db.insert(fillRules).values({id:'fill-band',channelId:'edit',name:'Conferida',weekdays:'0123456',startMinute:10,endMinute:12,categories:['REVIEW_TEST'],avoidHours:0,createdAt:'now'}).run()
  const dayPath='/api/rundowns/fill-grade/autofill-day',dayReview=(await api(a,dayPath,{preview:true})).value
  await stop(b);await start(b)
  const dayApplied=(await api(b,dayPath,{proposalId:dayReview.proposal.id},'POST',200,`w/"${dayReview.proposal.editorialRevision}"`)).value
  assert.deepEqual(dayApplied.plan,dayReview.plan);assert.deepEqual(dayApplied.bands,dayReview.bands)
  const staleRules=(await api(a,dayPath,{preview:true})).value
  database.sqlite.exec("UPDATE schedule_rules SET start_minute=20,end_minute=22 WHERE id='fill-band'")
  await api(b,dayPath,{proposalId:staleRules.proposal.id},'POST',409,`w/"${staleRules.proposal.editorialRevision}"`)
  const inspect=await fetch(`http://127.0.0.1:${b.port}/api/assets/fill-reviewed/media?quality=original&hash=${fillHash}`,{headers:{Range:'bytes=0-7'}})
  assert.equal(inspect.status,206);assert.equal(inspect.headers.get('x-rplayout-rendition'),'original');assert.equal(await inspect.text(),'ORIGINAL')
  assert.equal((await fetch(`http://127.0.0.1:${b.port}/api/assets/fill-reviewed/media?quality=original&hash=old`)).status,409)
  await writeFile(original,'WRONG_EDITION_AFTER_REVIEW')
  assert.equal((await fetch(`http://127.0.0.1:${b.port}/api/assets/fill-reviewed/media?quality=original&hash=${fillHash}`)).status,409)
  console.log(JSON.stringify({result:'PASS',evidence:'TWO_COMPILED_PROCESSES_FROZEN_AUTOFILL_AND_EXPLICIT_QC_QUALITY',directory,stations:stations.map(({port,pids})=>({port,pids})),reviewSurvivesRestart:true,oneConfirmationWinner:true,exactWindowPlan:true,replayRejected:true,qcChangeRejected:true,exactDayPlanAfterRestart:true,pautaChangeRejected:true,encryptedProposal:true,explicitOriginalRange:true,staleOriginalRejected:true,transport:'SIMULATED',physicalOutputValidated:false,replicationValidated:false,browserPlaybackValidated:false}))
  console.log(JSON.stringify({result:'PASS',evidence:'TWO_COMPILED_PROCESSES_TIMING_GRAPHICS_SECONDARIES_PRECONDITIONS',directory,blindZonesRejected:true,staleZonesRejected:true,graphicSnapshotCoherent:true,staleCueRemovalRejected:true,cueUndoVisibleOnOtherProcess:true,staleSecondaryRejected:true,secondarySnapshotCoherent:true,physicalOutputValidated:false,replicationValidated:false}))
  console.log(JSON.stringify({result:'PASS',evidence:'TWO_COMPILED_PROCESSES_REVIEWED_PUBLICATION_AND_ROLLBACK',directory,stations:stations.map(({port,pids})=>({port,pids})),blindPublicationRejected:true,freshVersionDoesNotOverrideOldReview:true,reviewSurvivesRestart:true,concurrentConfirmationOneWinner:true,activeRevisionChangeInvalidatesRollback:true,rollbackReviewedOnOtherProcess:true,editorialPreserved:true,atomicPublicationAudits:4,physicalOutputValidated:false,replicationValidated:false}))
  console.log(JSON.stringify({result:'PASS',evidence:'TWO_COMPILED_PROCESSES_DURABLE_EDITORIAL_REVISIONS',root,directory,stations:stations.map(({port,pids})=>({port,pids})),initialVersion:initial.value.rundownVersion,finalVersion:(await api(a,read)).value.rundownVersion,blindWriteRejected:true,staleBodyAndHeaderRejected:true,canonicalWriterInvalidates:true,sameRevisionOneWinner:true,restartPreservesVersion:true,discardDoesNotWrite:true,scopedFailureRollsBackDataAndVersions:true,failedScopeDoesNotAddUndo:true,archivedIndirectScopeAndUndoRejected:true,authorizedUndoRestoresSharedDefault:true,trimAndAudioBlindWriteRejected:true,audioTrackAndLevelUndoAtomic:true,otherGradeEditInvalidatesScopeWithoutChangingSourceVersion:true,scopeReviewedOnOtherProcessAppliesAfterRollback:true,undoDefaultSealsExistingReferenceState:true,supersededUndoRejectedWithFreshRevision:true,supersededUndoPreservesPendingAction:true,laterWriterUndoUnlocksEarlierExactUndo:true,supersededRedoRejected:true,transport:'SIMULATED',physicalOutputValidated:false,replicationValidated:false}))
}finally{await Promise.all(stations.map(stop));database.sqlite.close()}
