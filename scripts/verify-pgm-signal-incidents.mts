import assert from 'node:assert/strict'
import {spawn,execFile,type ChildProcess} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash,randomUUID} from 'node:crypto'
import {createServer} from 'node:http'
import {createRequire} from 'node:module'

const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(tmpdir(),'RPlayout-pgm-incidents-'))
const compiledServerSha256=createHash('sha256').update(await readFile(join(root,'apps/server/dist/server.cjs'))).digest('hex')
const gst=process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64;assert.ok(gst,'GStreamer real requerido')
const media=join(directory,'Acervo São José'),vault=join(directory,'vault.json'),dbFile=join(directory,'service.db')
await mkdir(media);process.env.RPLAYOUT_VAULT_FILE=vault;delete process.env.RPLAYOUT_VAULT_KEY
const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^RPLAYOUT_|^VITEST$/i.test(key))),RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_VAULT_FILE:vault,RPLAYOUT_DB:dbFile,RPLAYOUT_MEDIA:media,RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_CACHE_DIR:join(directory,'cache'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_BACKUP_DIR:join(directory,'backups'),RPLAYOUT_ENGINE:join(root,'apps/engine/target/release/rplayout-engine.exe'),RPLAYOUT_ENGINE_OUTPUT:'null',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_RELAY:'',RPLAYOUT_DEVICES:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_BACKUP_HOURS:'0',HOST:'127.0.0.1',LOG_LEVEL:'warn',PATH:join(gst,'bin')+';'+process.env.PATH,GST_PLUGIN_PATH:join(gst,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gst,'lib/gstreamer-1.0'),GST_PLUGIN_SCANNER:join(gst,'libexec/gstreamer-1.0/gst-plugin-scanner.exe'),GST_REGISTRY:join(directory,'registry.bin')}
const run=promisify(execFile),token=randomUUID(),received:Array<{id:string;body:any;status:number}>=[]
const gateway=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=String(chunk);const id=String(req.headers['idempotency-key']);const status=received.length===0?503:204;received.push({id,body:JSON.parse(raw),status});res.writeHead(status);res.end()})
await new Promise<void>(resolve=>gateway.listen(0,'127.0.0.1',resolve));const gatewayPort=(gateway.address() as {port:number}).port
const Database=createRequire(new URL('../apps/server/package.json',import.meta.url))('better-sqlite3')
const {openDatabase}=await import('../apps/server/src/db/client.js'),schema=await import('../apps/server/src/db/schema.js'),{getChannel}=await import('../apps/server/src/db/repo.js'),{publishOperationalPlaylist}=await import('../apps/server/src/domain/operational-playlist.js'),{sessionDigest}=await import('../apps/server/src/domain/access.js')
let child:ChildProcess|null=null,enginePid:number|null=null,logs='',result:Record<string,unknown>={result:'FAIL',directory}
const gone=(pid:number)=>{try{process.kill(pid,0);return false}catch(error){return(error as NodeJS.ErrnoException).code==='ESRCH'}}
async function wait(label:string,check:()=>boolean|Promise<boolean>,ms=20000){const end=performance.now()+ms;while(performance.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,100))}throw new Error(label+' '+logs)}
function query(sql:string){const db=new Database(dbFile,{readonly:true,fileMustExist:true});try{return db.prepare(sql).all()}finally{db.close()}}
let port=0
async function api(path:string,body?:object){const response=await fetch(`http://127.0.0.1:${port}${path}`,{headers:{cookie:'rplayout_session='+token,...(body?{'content-type':'application/json'}:{})},...(body?{method:'POST',body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(5000)});const value=await response.json();assert.ok(response.ok,path+' '+response.status+' '+JSON.stringify(value));return value as any}
try{
  const stamp=new Date().toISOString(),database=openDatabase(dbFile)
  try{
    database.sqlite.exec("INSERT INTO users VALUES('u','Admin isolado','NO_LOGIN','ADMIN',1,'now')")
    database.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest(token),'u','2099-01-01','now')
    database.db.insert(schema.channels).values({id:'ch',name:'Incidentes isolados',width:320,height:180,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:stamp}).run()
    database.db.insert(schema.rundowns).values({id:'rd',channelId:'ch',name:'RD',date:'2026-10-10',plannedStart:0,loop:false,createdAt:stamp,updatedAt:stamp}).run()
    // SMPTE includes an animated noise patch, so it is not a frozen picture.
    // Healthy SMPTE has an animated noise patch and nonblack mean luma.
    // Default ball has an almost-black background: it is not a black-detector control.
    for(const [id,pattern,volume] of [['bad','black','0'],['frozen','white','0.1'],['good','smpte','0.1']] as const){
      const path=join(media,id+'.mkv')
      await run(join(gst,'bin/gst-launch-1.0.exe'),['-q','videotestsrc','num-buffers=750',`pattern=${pattern}`,'!','video/x-raw,width=320,height=180,framerate=25/1','!','videoconvert','!','x264enc','speed-preset=ultrafast','!','h264parse','!','queue','!','m.video_0','audiotestsrc','num-buffers=1407',`volume=${volume}`,'!','audio/x-raw,rate=48000,channels=2','!','audioconvert','!','vorbisenc','!','queue','!','m.audio_0','matroskamux','name=m','!','filesink',`location=${path.replaceAll('\\','/')}`],{env,timeout:30000,windowsHide:true})
      const probe=JSON.parse((await run(join(root,'apps/engine/target/release/rplayout-probe.exe'),[path,'--no-loudness'],{env,timeout:30000,windowsHide:true})).stdout.trim().split('\n').at(-1)!)
      assert.equal(probe.ok,true);assert.ok(probe.decodedVideoBuffers>0&&probe.decodedAudioBuffers>0)
      database.db.insert(schema.mediaAssets).values({id,path,title:id,contentHash:createHash('sha256').update(await readFile(path)).digest('hex'),kind:'VIDEO',durationNs:probe.durationNs,durationFrames:0,width:320,height:180,rateNum:25,rateDen:1,hasAudio:true,audioChannels:2,audioRate:48000,qcStatus:'APPROVED',createdAt:stamp}).run()
      database.db.insert(schema.rundownItems).values({id,rundownId:'rd',sortOrder:['bad','frozen','good'].indexOf(id),title:id,type:'VT',mediaId:id,minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',autoNext:false,loop:false,locked:false}).run()
    }
    await publishOperationalPlaylist(database.db,(await getChannel(database.db,'ch'))!,'rd','@verifier')
    database.sqlite.prepare('INSERT INTO channel_operational_policies(channel_id,payload,updated_at) VALUES(?,?,?)').run('ch',JSON.stringify({automaticActions:false,thresholds:{freezeThresholdMs:600}}),stamp)
    database.db.insert(schema.integrations).values({id:'own-gateway',channelId:'ch',name:'Gateway local isolado',url:`http://127.0.0.1:${gatewayPort}/events`,events:['signal.black','signal.freeze','signal.silence','signal.black_recovered','signal.freeze_recovered','signal.silence_recovered','signal.recovered'],enabled:true,createdAt:stamp}).run()
  }finally{database.sqlite.close()}
  const listener=createServer();await new Promise<void>(resolve=>listener.listen(0,'127.0.0.1',resolve));port=(listener.address() as {port:number}).port;await new Promise<void>(resolve=>listener.close(()=>resolve()))
  child=spawn(process.execPath,['-e',"process.on('message',m=>{if(m==='own-shutdown')process.emit('SIGTERM')});require(process.argv[1])",join(root,'apps/server/dist/server.cjs')],{cwd:directory,env:{...env,PORT:String(port)},windowsHide:true,stdio:['ignore','pipe','pipe','ipc']})
  for(const stream of [child.stdout,child.stderr])stream?.on('data',chunk=>logs=(logs+String(chunk)).slice(-16000))
  await wait('Own native server startup',async()=>{assert.equal(child!.exitCode,null,logs);try{return(await api('/api/health')).engines===1}catch{return false}},60000)
  enginePid=(await api('/api/processes')).processes.find((row:any)=>row.kind==='ENGINE'&&row.channelId==='ch')?.pid;assert.ok(enginePid)
  await api('/api/channels/ch/transport',{action:'take',itemId:'bad'})
  await wait('Black and silence persisted from native PGM',()=>['black','silence'].every(state=>query("SELECT state FROM health_events WHERE component='SIGNAL'").some((row:any)=>row.state===state)),10000)
  await api('/api/channels/ch/transport',{action:'take',itemId:'frozen'})
  await wait('Nonblack frozen picture persisted from native PGM',()=>query("SELECT state FROM health_events WHERE component='SIGNAL'").some((row:any)=>row.state==='freeze'),10000)
  const unhealthy=await api('/api/v1/engineering/pgm-probe/status?channelId=ch');assert.equal(unhealthy.automaticActionsEnabled,false);assert.equal(unhealthy.emergencySlateActive,false)
  const frozenAlert=unhealthy.activeAlerts.find((row:any)=>row.type==='FREEZE_FRAME')
  assert.equal(frozenAlert?.thresholdMs,600);assert.ok(frozenAlert.durationMs>=600&&frozenAlert.durationMs<2000,'Configured freeze threshold must not wait for the old native 2s debounce')
  await api('/api/channels/ch/transport',{action:'take',itemId:'good'})
  await wait('Actual healthy samples persist recovery',()=>['black_recovered','freeze_recovered','silence_recovered'].every(state=>query("SELECT state FROM health_events WHERE component='SIGNAL'").some((row:any)=>row.state===state)),10000)
  const originalIncidents=query("SELECT state,resolved_at,acknowledged_at,observation_ended_at FROM health_events WHERE component='SIGNAL' AND id LIKE 'pgm-signal:%:active'")
  assert.equal(originalIncidents.length,3)
  assert.ok(originalIncidents.every((row:any)=>row.resolved_at!==null&&row.acknowledged_at===null&&row.observation_ended_at===null),'Measured recovery updates originals without acknowledgement')
  const publicEvents=await api('/api/health-events?channelId=ch')
  const contextualSignals=publicEvents.events.filter((row:any)=>row.id.startsWith('pgm-signal:'))
  assert.ok(contextualSignals.length>=6&&contextualSignals.every((row:any)=>row.context?.version===1&&row.context.channelId==='ch'&&row.context.engine.processPresent&&row.context.physicalSignalValidated===false),'Native incident contexts must survive the compiled API')
  assert.deepEqual(publicEvents.risk,{observedUnresolved:0,observationEndedUnresolved:0,withoutContext:0})
  assert.equal(publicEvents.events.filter((row:any)=>row.id.startsWith('pgm-signal:')&&row.id.endsWith(':active')&&row.resolvedAt).length,3)
  const migrations=query('SELECT version FROM schema_migrations WHERE version=47');assert.equal(migrations.length,1)
  assert.equal(query('SELECT version FROM schema_migrations WHERE version=48').length,1)
  await wait('External queue retry and delivery',()=>query("SELECT state FROM integration_deliveries").length===7&&query("SELECT state FROM integration_deliveries").every((row:any)=>row.state==='DELIVERED'),15000)
  assert.equal(received.length,8);assert.equal(received[0]!.status,503);assert.equal(received.filter(row=>row.id===received[0]!.id).length,2)
  assert.equal(received.filter(row=>row.body.type==='signal.recovered').length,1)
  const incidentIds=new Set(query("SELECT id FROM health_events WHERE component='SIGNAL'").map((row:any)=>row.id))
  assert.ok(received.every(row=>incidentIds.has(row.body.payload.incidentId)))
  assert.ok(received.every(row=>row.body.payload.context?.channelId==='ch'&&row.body.payload.context.physicalSignalValidated===false),'Configured external incident deliveries preserve safe context')
  await api('/api/channels/ch/transport',{action:'stop'})
  child.send('own-shutdown');await wait('Own server shutdown',()=>child!.exitCode!==null||child!.signalCode!==null);assert.equal(child.exitCode,0);await wait('Own engine shutdown',()=>gone(enginePid!))
  result={result:'PASS',directory,compiledServerSha256,nativePgmDecoded:true,syntheticFiles:true,nullOutputOnly:true,blackFreezeSilencePersisted:true,healthySamplesRecoveredAllThree:true,configuredFreezeThresholdMs:600,observedFreezeAlertDurationMs:frozenAlert.durationMs,nativeDoubleDebounceRemoved:true,originalResolutionTimestampsPersisted:true,recoveryDidNotAcknowledge:true,resolutionMetadataExposedByCompiledApi:true,migration47RecordedOnce:true,externalLoopbackDeliveries:7,httpRequests:8,http503RetrySameId:true,legacySilenceRecoverySubscriptionDelivered:true,incidentCorrelationVerified:true,automaticPgmIntervention:false,physicalOutputValidated:false,browserValidated:false,serverExitObserved:true,engineExitObserved:true}
  result={...result,nativeIncidentContextsVerified:true,contextDeliveredToConfiguredLoopback:true,migration48RecordedOnce:true,riskAfterMeasuredRecovery:{observedUnresolved:0,observationEndedUnresolved:0,withoutContext:0}}
}catch(error){result={...result,error:String(error)};throw error}
finally{
  if(child&&child.exitCode===null&&child.signalCode===null){const ended=new Promise<void>(resolve=>child!.once('exit',()=>resolve()));child.kill();await ended}
  if(enginePid)await wait('Own native cleanup',()=>gone(enginePid!),10000)
  await new Promise<void>(resolve=>gateway.close(()=>resolve()));await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));await writeFile(join(directory,'server.log'),logs);console.log(JSON.stringify(result))
}
