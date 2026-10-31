import assert from 'node:assert/strict'
import {spawn,execFile,type ChildProcess} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,mkdir,readFile,writeFile,copyFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash,randomUUID,randomBytes} from 'node:crypto'
import {createServer as netServer} from 'node:net'
import {createServer as httpServer} from 'node:http'
import type DatabaseType from 'better-sqlite3'
import {createRequire} from 'node:module'
const Database=createRequire(new URL('../apps/server/package.json',import.meta.url))('better-sqlite3') as typeof DatabaseType

// Same-account recovery rehearsal only. Own DBs, children, ports, vault and
// playable fixture; never overwrite a running installation or promote PGM.
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(tmpdir(),'RPlayout-backup-service-'))
const sourceDir=join(directory,'source'),restoreDir=join(directory,'restored'),media=join(directory,'Acervo AÇÃO Çãó')
for(const path of [sourceDir,media])await mkdir(path)
const gstRoot=process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64??'C:/Program Files/gstreamer/1.0/msvc_x86_64',gstBin=join(gstRoot,'bin')
const environment=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^RPLAYOUT_|^VITEST$/i.test(key)))
Object.assign(environment,{PATH:gstBin+';'+process.env.PATH,GST_PLUGIN_PATH:join(gstRoot,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gstRoot,'lib/gstreamer-1.0'),GST_PLUGIN_SCANNER:join(gstRoot,'libexec/gstreamer-1.0/gst-plugin-scanner.exe'),GST_REGISTRY:join(directory,'registry.bin')})
const run=promisify(execFile),sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
const file=join(media,'Programação São José.mkv'),dbFile=join(sourceDir,'service.db'),vaultFile=join(sourceDir,'vault.json')
const token=randomUUID()+randomUUID(),secret='RESTORE_SECRET_'+randomUUID(),children:ChildProcess[]=[],logs=new Map<ChildProcess,string>()
let postCount=0,result:Record<string,unknown>={result:'FAIL',directory},database:ReturnType<typeof import('../apps/server/src/db/client.js').openDatabase>|null=null
const gateway=httpServer((request,response)=>{if(request.method==='POST')postCount++;response.writeHead(204);response.end()})
async function freePort(){const server=netServer();await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const p=(server.address() as {port:number}).port;await new Promise<void>(resolve=>server.close(()=>resolve()));return p}
async function request(port:number,path:string,body?:object,status=200){
  const response=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{cookie:'rplayout_session='+token,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)})
  const value=await response.json();assert.equal(response.status,status,path+' '+JSON.stringify(value));return value
}
async function stop(child:ChildProcess){
  if(child.exitCode!==null||child.signalCode!==null)return
  const ended=new Promise<void>(resolve=>child.once('exit',()=>resolve()));assert.equal(child.kill('SIGKILL'),true)
  let timer:ReturnType<typeof setTimeout>|undefined
  try{await Promise.race([ended,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Own server did not exit')),10000)})])}finally{if(timer)clearTimeout(timer)}
}
async function start(folder:string,probe:boolean,wrongKey=false){
  const port=await freePort(),child=spawn(process.execPath,[join(root,'apps/server/dist/server.cjs')],{cwd:folder,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...environment,RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_DB:join(folder,'service.db'),RPLAYOUT_VAULT_FILE:join(folder,'vault.json'),...(wrongKey?{RPLAYOUT_VAULT_KEY:randomBytes(32).toString('base64')}:{}),RPLAYOUT_MEDIA:media,RPLAYOUT_THUMBS:join(folder,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(folder,'versions'),RPLAYOUT_CACHE:join(folder,'cache'),RPLAYOUT_BACKUPS:join(folder,'backups'),RPLAYOUT_ENGINE:'',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_RELAY:'',RPLAYOUT_DEVICES:'',RPLAYOUT_PROBE:probe?join(root,'apps/engine/target/release/rplayout-probe.exe'):'',RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_BACKUP_HOURS:'0',RPLAYOUT_ROLE:'ADMIN',HOST:'127.0.0.1',PORT:String(port),LOG_LEVEL:'warn'}})
  children.push(child);logs.set(child,'');child.on('error',error=>logs.set(child,(logs.get(child)??'')+String(error)))
  for(const stream of [child.stdout,child.stderr])stream?.on('data',chunk=>logs.set(child,((logs.get(child)??'')+String(chunk)).slice(-16000)))
  const deadline=performance.now()+30000
  while(performance.now()<deadline){
    if(child.exitCode!==null||child.signalCode!==null){if(wrongKey)return {child,port,refused:true};throw new Error('Own server exited '+logs.get(child))}
    try{if((await request(port,'/api/health')).ok){assert.equal(wrongKey,false,'Wrong key must not start service');return {child,port,refused:false}}}catch(error){if(String(error).includes('Wrong key'))throw error}
    await new Promise(resolve=>setTimeout(resolve,100))
  }
  throw new Error('Server startup observation timeout '+logs.get(child))
}
const retainedTables=['users','sessions','rundowns','rundown_items','operational_playlist_revisions','channel_checkpoints','as_run','media_assets','media_versions','media_jobs','ingest_batches','scan_revision','integration_deliveries','integration_delivery_versions','integrations','operator_decisions','vault_metadata']
const snapshot=(db:DatabaseType.Database)=>Object.fromEntries(retainedTables.map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
try{
  await run(join(gstBin,'gst-launch-1.0.exe'),['-q','matroskamux','name=m','!','filesink',`location=${file.replaceAll('\\','/')}`,'videotestsrc','num-buffers=50','pattern=ball','!','video/x-raw,width=320,height=180,framerate=25/1','!','videoconvert','!','vp8enc','deadline=1','!','queue','!','m.','audiotestsrc','num-buffers=95','samplesperbuffer=1024','!','audio/x-raw,rate=48000,channels=2','!','audioconvert','!','vorbisenc','!','queue','!','m.'],{env:environment,windowsHide:true,timeout:30000})
  const originalHash=sha(await readFile(file))
  process.env.RPLAYOUT_VAULT_FILE=vaultFile;delete process.env.RPLAYOUT_VAULT_KEY
  const {openDatabase}=await import('../apps/server/src/db/client.js'),{sessionDigest}=await import('../apps/server/src/domain/access.js')
  const {channels,rundowns,rundownItems,integrations,integrationDeliveries,asRun}=await import('../apps/server/src/db/schema.js')
  const {installationVault}=await import('../apps/server/src/domain/secret-vault.js'),stamp=new Date().toISOString()
  database=openDatabase(dbFile)
  database.sqlite.exec("INSERT INTO users VALUES('u','Admin','NO_LOGIN','ADMIN',1,'now')")
  database.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest(token),'u','2099-01-01','now')
  await new Promise<void>(resolve=>gateway.listen(0,'127.0.0.1',resolve))
  const target=`http://127.0.0.1:${(gateway.address() as {port:number}).port}/hook?token=${secret}`
  database.db.insert(integrations).values({id:'gateway',name:'Gateway preservado',url:target,events:['restore.test'],enabled:true,createdAt:stamp}).run()
  const source=await start(sourceDir,true),deadline=performance.now()+60000
  // No channel existed during source bootstrap: no simulated runtime can race
  // the later imported historical checkpoint fixture. Publication below uses
  // the real domain planner, not a fabricated revision row.
  database.db.insert(channels).values({id:'restore',name:'Ensaio São José',width:320,height:180,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:stamp}).run()
  database.db.insert(rundowns).values({id:'rd',channelId:'restore',name:'Grade restaurável',date:'2026-10-09',plannedStart:0,loop:false,createdAt:stamp,updatedAt:stamp}).run()
  let asset:any
  while(performance.now()<deadline){const assets=(await request(source.port,'/api/assets')).assets;asset=assets.find((row:any)=>row.path===file);if(asset&&!(await request(source.port,'/api/library/scan')).running)break;await new Promise(resolve=>setTimeout(resolve,150))}
  assert.ok(asset,'Actual scanner did not import media');assert.equal(asset.contentHash,originalHash);assert.equal(asset.probe.hasAudio,true);assert.equal(asset.probe.width,320)
  // Let the source's small real archive finish before installing quarantine;
  // no in-flight work is claimed to be undone retroactively by a marker.
  const archiveDeadline=performance.now()+30000
  while(performance.now()<archiveDeadline){const jobs=(await request(source.port,'/api/media/jobs')).jobs;if(jobs.some((job:any)=>job.kind==='ARCHIVE'&&job.state==='READY')&&!jobs.some((job:any)=>job.state==='RUNNING'))break;await new Promise(resolve=>setTimeout(resolve,100))}
  assert.ok(!database.sqlite.prepare("SELECT 1 FROM media_jobs WHERE state='RUNNING'").get(),'Source worker still active; do not introduce rehearsal mid-job')
  database.db.insert(rundownItems).values({id:'vt',rundownId:'rd',sortOrder:0,type:'VT',title:'AÇÃO no ar',mediaId:asset.id,minDuration:0,anchor:{kind:'FLOW'},onOverrun:'CUT',locked:false,autoNext:true,loop:false}).run()
  const {publishOperationalPlaylistNow}=await import('../apps/server/src/domain/operational-playlist.js'),{toChannel}=await import('../apps/server/src/db/repo.js')
  const channel=toChannel(database.db.select().from(channels).get()!)
  const oldEdition=publishOperationalPlaylistNow(database.db,channel,'rd','Admin'),edition=publishOperationalPlaylistNow(database.db,channel,'rd','Admin')
  assert.notEqual(oldEdition.id,edition.id)
  // Imported historical cursor/as-run fixtures, not a claimed physical TAKE.
  database.sqlite.prepare('INSERT INTO channel_checkpoints(channel_id,payload,saved_at) VALUES(?,?,?)').run('restore',JSON.stringify({version:1,channelId:'restore',rundownId:'rd',revisionId:edition.id,itemId:'vt',elapsed:12,playing:true,realEngine:true}),stamp)
  for(const ended of [false,true])database.db.insert(asRun).values({id:ended?'closed-run':'open-run',channelId:'restore',rundownId:'rd',itemId:'vt',mediaId:asset.id,revisionId:ended?oldEdition.id:edition.id,mediaHash:originalHash,title:'Imported history fixture',type:'VT',startedAt:stamp,endedAt:ended?stamp:null,actualStart:0,executionKind:'UNKNOWN',durationEvidence:'UNKNOWN',createdAt:stamp}).run()
  database.sqlite.exec('CREATE TABLE ha_recovery_origin(id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL)')
  database.sqlite.prepare('INSERT INTO ha_recovery_origin VALUES(1,?)').run(installationVault().encrypt(JSON.stringify({rehearsal:true,automaticTake:false,promotionReady:false}),'backup-service-rehearsal'))
  for(const state of ['QUEUED','SENDING'] as const)database.db.insert(integrationDeliveries).values({id:state,integrationId:'gateway',channelId:'restore',event:'restore.test',target,payload:{secret},state,attempts:state==='SENDING'?1:0,nextAttemptAt:'2000-01-01',createdAt:stamp,...(state==='SENDING'?{ownerHost:(await import('../apps/server/src/domain/execution-host.js')).executionHostIdentity(),ownerPid:2147483647,ownerBoot:randomUUID()}:{})}).run()
  // Seed interrupted owner records only; media metadata above is real scanner
  // evidence. A restored copy must not guess these records complete/replayable.
  database.sqlite.exec("UPDATE media_jobs SET state='RUNNING',owner_host=NULL,owner_pid=NULL,owner_boot=NULL WHERE kind='PROXY'; UPDATE media_jobs SET state='PENDING',attempts=3 WHERE kind='ARCHIVE'")
  const before=snapshot(database.sqlite),backup=await request(source.port,'/api/backups',{})
  assert.equal(backup.validation.protectedSecrets,'verified');assert.equal(backup.validation.integrity,'ok');assert.equal(backup.validation.vaultFingerprint,installationVault().fingerprint)
  assert.deepEqual(backup.validation.operationalState,{savedCheckpoints:1,savedPlayingCheckpoints:1,publishedRevisions:2,activeRevisions:1,asRunRecords:2,openAsRunRecords:1,executionResumeAllowed:false})
  await stop(source.child);database.sqlite.close();database=null
  const backupBytes=await readFile(backup.file)
  const restoreCli=join(root,'apps/server/dist/restore-backup.cjs'),restoreArgs=['--backup',backup.file,'--destination',restoreDir,'--vault-file',vaultFile]
  const restoredReport=JSON.parse((await run(process.execPath,[restoreCli,...restoreArgs],{env:{...environment,RPLAYOUT_INSTALL_ROOT:root},windowsHide:true,timeout:45000})).stdout.trim())
  assert.equal(restoredReport.phase,'QUARANTINED');assert.equal(restoredReport.backupSha256,sha(backupBytes));assert.equal(restoredReport.promotionReady,false)
  assert.deepEqual(restoredReport.validation.operationalState,backup.validation.operationalState)
  assert.deepEqual(await readFile(join(restoreDir,'vault.json')),await readFile(vaultFile))
  const restoredBefore=await readFile(join(restoreDir,'service.db'))
  const {readServerInstances}=await import('../apps/server/src/db/server-instances.js'),{serverInstanceStorageStatus}=await import('../apps/server/src/domain/server-instances.js')
  const importedInstancesDb=new Database(join(restoreDir,'service.db'),{readonly:true,fileMustExist:true})
  let importedInstances:any[]
  try{importedInstances=readServerInstances(importedInstancesDb);assert.equal(importedInstances.length,1);assert.equal(importedInstances[0].pid,source.child.pid)}finally{importedInstancesDb.close()}
  await assert.rejects(run(process.execPath,[restoreCli,...restoreArgs],{env:{...environment,RPLAYOUT_INSTALL_ROOT:root},windowsHide:true,timeout:45000}))
  assert.deepEqual(await readFile(join(restoreDir,'service.db')),restoredBefore)
  // A wrong key is tested on a separate owned copy; valid restore is untouched.
  const badDir=join(directory,'wrong-key');await mkdir(badDir);const valid=new Database(join(restoreDir,'service.db'),{readonly:true,fileMustExist:true})
  try{await valid.backup(join(badDir,'service.db'))}finally{valid.close()}
  await copyFile(vaultFile,join(badDir,'vault.json'));const bad=await start(badDir,false,true);assert.equal(bad.refused,true)
  const badDb=new Database(join(badDir,'service.db'),{readonly:true,fileMustExist:true});try{assert.deepEqual(snapshot(badDb),before)}finally{badDb.close()}
  for(let pass=0;pass<2;pass++){
    const restored=await start(restoreDir,false)
    const liveInstancesDb=new Database(join(restoreDir,'service.db'),{readonly:true,fileMustExist:true})
    try{const instances=readServerInstances(liveInstancesDb);assert.deepEqual(instances.slice(0,importedInstances.length),importedInstances);assert.ok(instances.some(row=>row.pid===restored.child.pid&&row.phase==='OPEN'));assert.equal(serverInstanceStorageStatus(liveInstancesDb).storageReleaseBlocked,true)}finally{liveInstancesDb.close()}
    const assets=(await request(restored.port,'/api/assets')).assets,recovered=assets.find((row:any)=>row.id===asset.id)
    assert.equal(recovered.path,file);assert.equal(recovered.contentHash,originalHash);assert.equal(recovered.probe.hasAudio,true)
    // The runtime rundown view is intentionally unavailable in quarantine;
    // inspect the editorial plan without creating a channel execution.
    const grade=await request(restored.port,'/api/rundowns/rd/operational-simulation');assert.ok(JSON.stringify(grade.simulated).includes(asset.id))
    const active=await request(restored.port,'/api/rundowns/rd/operational-playlist');assert.equal(active.id,edition.id)
    const config=await request(restored.port,'/api/integrations/gateway/review');assert.equal(config.name,'Gateway preservado');assert.ok(!JSON.stringify(config).includes(secret))
    const response=await fetch(`http://127.0.0.1:${restored.port}/api/assets/${asset.id}/media?quality=original&hash=${originalHash}`,{headers:{cookie:'rplayout_session='+token},signal:AbortSignal.timeout(30000)})
    assert.equal(response.status,200);assert.equal(sha(new Uint8Array(await response.arrayBuffer())),originalHash)
    assert.equal((await request(restored.port,'/api/distribution/execution-ownership')).diagnostic.code,'REHEARSAL_NOT_PROMOTED')
    assert.equal((await request(restored.port,'/api/channels/restore/transport',{action:'take'},409)).error,'RESTORED_REHEARSAL')
    assert.equal((await request(restored.port,'/api/library/scan',{},409)).error,'RESTORED_REHEARSAL')
    assert.ok((await request(restored.port,'/api/processes')).processes.every((row:any)=>row.pid===null))
    // Wait through >2 outbox cadences to catch accidental background sending.
    await new Promise(resolve=>setTimeout(resolve,2200));assert.equal(postCount,0)
    const inspection=new Database(join(restoreDir,'service.db'),{readonly:true,fileMustExist:true})
    try{
      const observed=snapshot(inspection),oldAudits=before.operator_decisions as any[],audits=observed.operator_decisions as any[]
      assert.deepEqual(audits.slice(0,oldAudits.length),oldAudits)
      const added=audits.slice(oldAudits.length);assert.equal(added.length,2*(pass+1))
      for(const entry of added){assert.equal(entry.kind,'API_MUTATION');assert.equal(entry.actor_username,'Admin');const payload=JSON.parse(installationVault(false).decrypt(entry.payload,'operator_decisions.payload'));assert.equal(payload.status,409);assert.equal(payload.method,'POST');assert.ok(['/api/channels/:id/transport','/api/library/scan'].includes(payload.route));assert.ok(!JSON.stringify(payload).includes(secret))}
      // Denied operator commands remain auditable. Preserve previous audit rows,
      // not pretend that a conference with explicit denied commands is read-only.
      assert.deepEqual({...observed,operator_decisions:oldAudits},before)
    }finally{inspection.close()}
    await stop(restored.child)
  }
  const {stdout}=await run(join(root,'apps/engine/target/release/rplayout-probe.exe'),[file,'--no-loudness'],{env:environment,windowsHide:true,timeout:30000})
  const probe=JSON.parse(stdout.trim().split('\n').at(-1)!);assert.ok(probe.ok&&probe.decodedVideoBuffers>0&&probe.decodedAudioBuffers>0)
  assert.equal(sha(await readFile(file)),originalHash);assert.deepEqual(await readFile(backup.file),backupBytes)
  result={result:'PASS',directory,compiledServerSha256:sha(await readFile(join(root,'apps/server/dist/server.cjs'))),restoreCliSha256:sha(await readFile(restoreCli)),supportedRestoreCli:true,existingDestinationRefusedWithoutOverwrite:true,sameWindowsAccount:true,actualApiBackup:true,originalBackupBytesPreserved:true,copiedOriginalVault:true,wrongKeyStartupRefusedWithoutProtectedDataChange:true,actualScannerAndNativeProbe:true,decodedVideoBuffers:probe.decodedVideoBuffers,decodedAudioBuffers:probe.decodedAudioBuffers,restoredServiceStartsAndRestarts:true,originalMediaViaRestoredAuthenticatedApi:true,editorialReferenceAndProtectedQueueUnchanged:true,mediaJobsAndScanRevisionsPreserved:true,takeAndScanMutationsRefused:true,externalPosts:postCount,quarantinedNoPromotion:true,physicalPgmValidated:false,crossHostRecoveryValidated:false,cleanWindowsValidated:false,browserValidated:false}
  result={...result,publishedRevisionsAndCheckpointAndAsRunPreserved:true,operationalState:backup.validation.operationalState,cursorAndAsRunAreImportedFixturesNotPhysicalTake:true,signedImportedServerInstancePreserved:true,liveConferenceServerInstanceBlocksStorageRelease:true}
}catch(error){result={...result,error:String(error)};throw error}
finally{
  const cleanupErrors:string[]=[];for(const child of children)try{await stop(child)}catch(error){cleanupErrors.push(String(error))}
  database?.sqlite.close();if(gateway.listening)await new Promise<void>(resolve=>gateway.close(()=>resolve()))
  await writeFile(join(directory,'server-logs.json'),JSON.stringify([...logs].map(([child,text])=>({pid:child.pid,text})),null,2))
  await writeFile(join(directory,'result.json'),JSON.stringify({...result,cleanupErrors},null,2));console.log(JSON.stringify({...result,cleanupErrors}));assert.equal(cleanupErrors.length,0)
}
