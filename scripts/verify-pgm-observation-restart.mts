import assert from 'node:assert/strict'
import {spawn,type ChildProcess} from 'node:child_process'
import {mkdtemp,readFile,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash,randomUUID} from 'node:crypto'
import {createServer} from 'node:http'
import {createRequire} from 'node:module'
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(tmpdir(),'RPlayout-observation-restart-'))
const gst=process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64;assert.ok(gst,'GStreamer required')
const dbFile=join(directory,'service.db'),vault=join(directory,'vault.json'),token=randomUUID()
process.env.RPLAYOUT_VAULT_FILE=vault;delete process.env.RPLAYOUT_VAULT_KEY
const {openDatabase}=await import('../apps/server/src/db/client.js'),{channels,rundowns,healthEvents,integrations}=await import('../apps/server/src/db/schema.js'),{sessionDigest}=await import('../apps/server/src/domain/access.js')
const Database=createRequire(new URL('../apps/server/package.json',import.meta.url))('better-sqlite3')
const stamp=new Date().toISOString(),incidentId='pgm-signal:'+randomUUID()+':active'
const runtimeIncidents=process.argv.includes('--runtime-incidents')
const nativeCueFailure=process.argv.includes('--native-cue-failure')
const storageCrash=process.argv.includes('--storage-crash')
assert.ok(!storageCrash||!nativeCueFailure&&!runtimeIncidents,'Storage crash is a separate isolated scenario')
let runtimeIncidentId:string|null=null
const receipts:any[]=[],gateway=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=String(chunk);receipts.push(JSON.parse(raw));res.writeHead(204);res.end()})
await new Promise<void>(resolve=>gateway.listen(0,'127.0.0.1',resolve));const gatewayPort=(gateway.address() as {port:number}).port
let child:ChildProcess|null=null,port=0,logs='',enginePid:number|null=null,result:Record<string,unknown>={result:'FAIL',directory}
const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^RPLAYOUT_|^VITEST$/i.test(key))),RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_VAULT_FILE:vault,RPLAYOUT_DB:dbFile,RPLAYOUT_MEDIA:join(directory,'media'),RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_CACHE_DIR:join(directory,'cache'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_BACKUP_DIR:join(directory,'backups'),RPLAYOUT_ENGINE:join(root,'apps/engine/target/release/rplayout-engine.exe'),RPLAYOUT_ENGINE_OUTPUT:'null',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_RELAY:'',RPLAYOUT_DEVICES:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_BACKUP_HOURS:'0',HOST:'127.0.0.1',LOG_LEVEL:'warn',PATH:join(gst,'bin')+';'+process.env.PATH,GST_PLUGIN_PATH:join(gst,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gst,'lib/gstreamer-1.0'),GST_PLUGIN_SCANNER:join(gst,'libexec/gstreamer-1.0/gst-plugin-scanner.exe'),GST_REGISTRY:join(directory,'registry.bin')}
const gone=(pid:number)=>{try{process.kill(pid,0);return false}catch(error){return(error as NodeJS.ErrnoException).code==='ESRCH'}}
async function wait(label:string,check:()=>boolean|Promise<boolean>,ms=30000){const end=performance.now()+ms;while(performance.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,100))}throw new Error(label+' '+logs)}
function query(sql:string){const db=new Database(dbFile,{readonly:true,fileMustExist:true});try{return db.prepare(sql).all()}finally{db.close()}}
async function api(path:string){const response=await fetch(`http://127.0.0.1:${port}${path}`,{headers:{cookie:'rplayout_session='+token},signal:AbortSignal.timeout(3000)});assert.ok(response.ok);return await response.json() as any}
async function start(){
  const listener=createServer();await new Promise<void>(resolve=>listener.listen(0,'127.0.0.1',resolve));port=(listener.address() as {port:number}).port;await new Promise<void>(resolve=>listener.close(()=>resolve()))
  child=spawn(process.execPath,['-e',"process.on('message',m=>{if(m==='own-shutdown')process.emit('SIGTERM')});require(process.argv[1])",join(root,'apps/server/dist/server.cjs')],{cwd:directory,env:{...env,PORT:String(port)},windowsHide:true,stdio:['ignore','pipe','pipe','ipc']})
  for(const stream of [child.stdout,child.stderr])stream?.on('data',chunk=>logs=(logs+String(chunk)).slice(-20000))
  await wait('Own server startup',async()=>{assert.equal(child!.exitCode,null,logs);try{return(await api('/api/health')).engines===1}catch{return false}})
  enginePid=(await api('/api/processes')).processes.find((row:any)=>row.kind==='ENGINE'&&row.channelId==='ch')?.pid;assert.ok(enginePid)
}
async function stop(){const current=child!;current.send('own-shutdown');await wait('Own server exit',()=>current.exitCode!==null||current.signalCode!==null);assert.equal(current.exitCode,0);await wait('Own engine exit',()=>gone(enginePid!));child=null;enginePid=null}
try{
  const database=openDatabase(dbFile)
  try{
    database.sqlite.exec("INSERT INTO users VALUES('u','Admin isolado','NO_LOGIN','ADMIN',1,'now')")
    database.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest(token),'u','2099-01-01','now')
    database.db.insert(channels).values({id:'ch',name:'Restart isolado',width:320,height:180,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:stamp}).run()
    if(nativeCueFailure||storageCrash)database.db.insert(rundowns).values({id:'rd',channelId:'ch',name:'Empty isolated cue fixture',date:'2026-10-10',plannedStart:0,loop:false,createdAt:stamp,updatedAt:stamp}).run()
    if(storageCrash)database.db.insert(integrations).values({id:'own-loopback',channelId:'ch',name:'Fixture',url:`http://127.0.0.1:${gatewayPort}/events`,events:['engineering.observation_gap'],enabled:true,createdAt:stamp}).run()
  }finally{database.sqlite.close()}
  await start()
  if(storageCrash){
    const previous=query('SELECT run_id FROM execution_owner_slots')[0].run_id
    assert.equal(JSON.parse(query('SELECT payload FROM execution_owner_runs')[0].payload).observationClosed,false)
    const fault=new Database(dbFile,{fileMustExist:true})
    try{fault.exec("CREATE TRIGGER fixture_storage_fail BEFORE INSERT ON health_events WHEN NEW.id LIKE 'runtime-%' BEGIN SELECT RAISE(ABORT,'fixture observation storage failure'); END")}finally{fault.close()}
    const response=await fetch(`http://127.0.0.1:${port}/api/channels/ch/transport`,{method:'POST',headers:{cookie:'rplayout_session='+token,'content-type':'application/json'},body:JSON.stringify({action:'cue',sourceRef:'srt://127.0.0.1:54321?mode=caller',sourceTitle:'Own observation queue fixture'}),signal:AbortSignal.timeout(15000)})
    assert.ok([409,500,503].includes(response.status),'Native CUE rejection required without preview bus')
    await wait('Native callback storage fault not observed',()=>logs.includes('fixture observation storage failure'))
    assert.equal(query("SELECT count(*) n FROM health_events WHERE id LIKE 'runtime-%'")[0].n,0)
    // Exact retained server handle only; its native Job family must drain.
    const previousChild=child!,previousEngine=enginePid!
    previousChild.kill('SIGKILL')
    await wait('Own crashed server exit',()=>previousChild.exitCode!==null||previousChild.signalCode!==null)
    await wait('Own crashed engine exit',()=>gone(previousEngine));child=null;enginePid=null
    const repair=new Database(dbFile,{fileMustExist:true})
    try{repair.exec('DROP TRIGGER fixture_storage_fail')}finally{repair.close()}
    await start()
    const gapId='observation-closure-gap:'+previous
    await wait('Unclosed observation warning not persisted',()=>query("SELECT id FROM health_events WHERE id='"+gapId+"'").length===1)
    const gap=(await api('/api/health-events?channelId=ch')).events.find((row:any)=>row.id===gapId)
    assert.equal(gap.state,'observation_gap');assert.equal(gap.resolvedAt,null);assert.equal(gap.acknowledgedAt,null);assert.equal(gap.context,null)
    await wait('Own gap loopback not received',()=>receipts.some(row=>row.type==='engineering.observation_gap'))
    const delivered=receipts.filter(row=>row.type==='engineering.observation_gap')
    assert.equal(delivered.length,1);assert.equal(delivered[0].payload.lostObservations,null);assert.equal(delivered[0].payload.signalRecovered,false)
    await api('/api/health-events?channelId=ch');assert.equal(query("SELECT count(*) n FROM health_events WHERE id='"+gapId+"'")[0].n,1)
    assert.equal(query('SELECT count(*) n FROM as_run')[0].n,0)
    await stop()
    await start();assert.equal(query("SELECT count(*) n FROM health_events WHERE state='observation_gap'")[0].n,1)
    await stop()
    result={result:'PASS',directory,compiledServerSha256:createHash('sha256').update(await readFile(join(root,'apps/server/dist/server.cjs'))).digest('hex'),nativeCallbackStorageFaultObserved:true,failedObservationNotPersisted:true,actualOwnedServerCrash:true,threeServerIncarnations:true,unclosedObservationWarningPersisted:true,loopbackGapDeliveries:1,missingSamplesNotInvented:true,signalRecovered:false,cleanShutdownDoesNotAddGap:true,asRunCount:0,ownNativeFamilyExitsObserved:true,physicalSignalValidated:false,installationTested:false,limits:'SQLite trigger fault, not actual full disk. Missing native snapshots are not recovered; signed epoch records unknown historical completeness. No real input/receiver qualification.'}
  }else if(nativeCueFailure){
    const listener=createServer();await new Promise<void>(resolve=>listener.listen(0,'127.0.0.1',resolve));const missingPort=(listener.address() as {port:number}).port;await new Promise<void>(resolve=>listener.close(()=>resolve()))
    let cueStatus:number|null=null
    try{const response=await fetch(`http://127.0.0.1:${port}/api/channels/ch/transport`,{method:'POST',headers:{cookie:'rplayout_session='+token,'content-type':'application/json'},body:JSON.stringify({action:'cue',sourceRef:`srt://127.0.0.1:${missingPort}?mode=caller`,sourceTitle:'Entrada isolada indisponível'}),signal:AbortSignal.timeout(15000)});cueStatus=response.status;assert.ok([200,409,500,503].includes(cueStatus),'Unexpected cue admission response '+cueStatus)}catch(error){if(!(error instanceof Error&&error.name==='TimeoutError'))throw error}
    await wait('Native unavailable source failure',()=>query("SELECT id FROM health_events WHERE component='LIVE_SOURCE' AND id LIKE 'runtime-signal:%:active'").length===1)
    const events=(await api('/api/health-events?channelId=ch')).events
    assert.ok(events.some((row:any)=>row.id.startsWith('runtime-status:')&&row.state==='CUEING'))
    const failure=events.find((row:any)=>row.component==='LIVE_SOURCE'&&row.id.startsWith('runtime-signal:')&&row.id.endsWith(':active'));assert.equal(failure.resolvedAt,null);assert.equal(failure.context.physicalSignalValidated,false)
    assert.ok(!JSON.stringify(events).includes('srt://127.0.0.1:'))
    assert.equal(query('SELECT count(*) n FROM as_run')[0].n,0)
    await stop()
    result={result:'PASS',directory,compiledServerSha256:createHash('sha256').update(await readFile(join(root,'apps/server/dist/server.cjs'))).digest('hex'),nativeCueRejectionCaptured:true,nativeCueingInformationalEventCaptured:true,syntheticIncidentSeeded:false,cueStatus,previewBusConfigured:false,sourceConnectionFailureValidated:false,privateEndpointAbsentFromHealthApi:true,asRunCount:0,ownServerAndEngineExitsObserved:true,physicalSignalValidated:false,installationTested:false,limits:'No configured preview bus: native rejection occurs before source connection. Not SRT connection failure/recovery or NDI/OMT/DeckLink/physical receiver qualification'}
  }else{
  const previous=query('SELECT run_id FROM execution_owner_slots')[0].run_id;await stop()
  // Seeded historical failure: verifies restart semantics, not signal detection.
  const historical=openDatabase(dbFile)
  try{
    historical.db.insert(healthEvents).values({id:incidentId,channelId:'ch',component:'SIGNAL',state:'black',severity:'CRITICAL',message:'Historical synthetic restart fixture',occurredAt:stamp,acknowledgedAt:stamp,context:{version:1,capturedAt:stamp,channelId:'ch',rundownId:null,revisionId:null,executionId:null,itemId:'synthetic-item',itemName:'Jornal São José (sintético)',elapsedFrames:42,engine:{ready:false,processPresent:false},sources:[],outputs:[],sourcesTruncated:false,outputsTruncated:false,physicalSignalValidated:false}}).run()
    if(runtimeIncidents){
      runtimeIncidentId=`runtime-signal:synthetic-private-key:${previous}:${randomUUID()}:10:active`
      const context=historical.db.select().from(healthEvents).all().find(row=>row.id===incidentId)!.context
      historical.db.insert(healthEvents).values({id:runtimeIncidentId,channelId:'ch',component:'OUTPUT',state:'failed',severity:'CRITICAL',message:'Historical synthetic publisher fixture',occurredAt:stamp,acknowledgedAt:stamp,context}).run()
    }
    historical.db.insert(integrations).values({id:'own-loopback',channelId:'ch',name:'Fixture',url:`http://127.0.0.1:${gatewayPort}/events`,events:['signal.black_unobserved',...(runtimeIncidents?['output.unobserved']:[])],enabled:true,createdAt:stamp}).run()
  }finally{historical.sqlite.close()}
  await start()
  const current=query('SELECT run_id FROM execution_owner_slots')[0].run_id;assert.notEqual(current,previous)
  const run=JSON.parse(query('SELECT payload FROM execution_owner_runs WHERE id='+"'"+current+"'")[0].payload);assert.equal(run.recoveredRunId,previous)
  const events=(await api('/api/health-events?channelId=ch')).events,original=events.find((row:any)=>row.id===incidentId)
  assert.ok(original.observationEndedAt);assert.equal(original.resolvedAt,null);assert.equal(original.acknowledgedAt,stamp);assert.equal(original.context.itemId,'synthetic-item')
  const ended=events.find((row:any)=>row.id===incidentId.slice(0,-6)+'unobserved');assert.ok(ended);assert.deepEqual(ended.context,original.context)
  await wait('Own loopback delivery',()=>receipts.length===(runtimeIncidents?2:1))
  assert.ok(receipts.every(row=>row.payload.signalRecovered===false))
  assert.equal(receipts.find(row=>row.type==='signal.black_unobserved').payload.ownerRunId,current)
  if(runtimeIncidents){
    const old=events.find((row:any)=>row.id===runtimeIncidentId);assert.ok(old.observationEndedAt);assert.equal(old.resolvedAt,null);assert.equal(old.acknowledgedAt,stamp);assert.deepEqual(old.context,original.context)
    assert.equal(query("SELECT count(*) n FROM operator_decisions WHERE kind='RUNTIME_INCIDENT_UNOBSERVED'")[0].n,1)
    assert.equal(query("SELECT count(*) n FROM integration_deliveries WHERE event='output.unobserved'")[0].n,1)
    assert.equal((await api('/api/health-events?channelId=ch')).risk.observationEndedUnresolved,2)
  }
  await api('/api/health-events?channelId=ch');await api('/api/v1/engineering/pgm-probe/status?channelId=ch')
  assert.equal(query("SELECT count(*) n FROM operator_decisions WHERE kind='PGM_OBSERVATION_ENDED'")[0].n,1)
  assert.equal(query("SELECT count(*) n FROM integration_deliveries WHERE event='signal.black_unobserved'")[0].n,1)
  assert.equal(query('SELECT count(*) n FROM as_run')[0].n,0)
  await stop()
  result={result:'PASS',directory,compiledServerSha256:createHash('sha256').update(await readFile(join(root,'apps/server/dist/server.cjs'))).digest('hex'),twoCompiledServerIncarnations:true,bothOwnServerAndEngineExitsObserved:true,signedPredecessorLinked:true,historicalFailureSynthetic:true,originalContextAndAcknowledgementPreserved:true,signalRecovered:false,observationEnded:true,auditCount:runtimeIncidents?2:1,loopbackDeliveries:runtimeIncidents?2:1,runtimePublisherObservationRetired:runtimeIncidents,asRunCount:0,nullOutputOnly:true,physicalSignalValidated:false,installationTested:false}
  }
}catch(error){result={...result,error:String(error)};throw error}
finally{
  if(child&&child.exitCode===null&&child.signalCode===null){const exited=new Promise<void>(resolve=>child!.once('exit',()=>resolve()));child.kill();await exited}
  if(enginePid)await wait('Own cleanup',()=>gone(enginePid!),10000)
  await new Promise<void>(resolve=>gateway.close(()=>resolve()));await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));await writeFile(join(directory,'server.log'),logs);console.log(JSON.stringify(result))
}
