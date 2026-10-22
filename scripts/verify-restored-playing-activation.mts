import assert from 'node:assert/strict'
import {spawn,execFile,type ChildProcess} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {createHash,randomUUID} from 'node:crypto'
import {createServer} from 'node:net'
import {createRequire} from 'node:module'

// Own compiled servers, real encoded/decoded fixture; optional own file output.
// Backup is captured during actual PGM, never by manually seeding a cursor.
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(tmpdir(),'RPlayout-restored-playing-'))
const missingVideo=process.argv.includes('--live-no-video'),liveMode=process.argv.includes('--live')||missingVideo,metricsOnly=process.argv.includes('--metrics-only')
const metricLabels=process.argv.includes('--metric-labels')
const nativeCatalog=process.argv.includes('--native-catalog')
const realtime=process.argv.includes('--realtime')
const editBinding=process.argv.includes('--edit-binding')
const restoreCatalog=process.argv.includes('--restore-catalog')
assert.ok(!restoreCatalog||(nativeCatalog&&realtime&&liveMode&&!metricsOnly&&!editBinding&&!missingVideo),'Catalog restoration requires the isolated continuous realtime restoration scenario')
assert.ok(!editBinding||realtime,'Compiled connection edit requires the continuous realtime source')
assert.ok(!realtime||nativeCatalog,'Realtime source is restricted to the isolated native catalog scenario')
assert.ok(!nativeCatalog||((metricsOnly||restoreCatalog)&&liveMode&&!metricLabels),'Native catalog scenario is isolated synthetic live URI, not protocol/hardware qualification')
assert.ok(!metricsOnly||!missingVideo,'Metrics-only and missing-video restoration are separate scenarios')
assert.ok(!metricLabels||(metricsOnly&&!liveMode),'Label scenario uses metrics-only VT plus own local recording, never network or hardware')
const run=promisify(execFile),gst=process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64!
assert.ok(gst,'Actual GStreamer required')
const sourceDir=join(directory,'source'),media=join(directory,'Acervo Çãó'),file=join(media,'Retomada São José.mkv')
await mkdir(sourceDir);await mkdir(media)
const vault=join(sourceDir,'vault.json'),dbFile=join(sourceDir,'service.db'),server=join(root,'apps/server/dist/server.cjs')
const recording=join(directory,'Gravação São José.mkv')
process.env.RPLAYOUT_VAULT_FILE=vault;delete process.env.RPLAYOUT_VAULT_KEY
const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^RPLAYOUT_|^VITEST$/i.test(key))),RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_VAULT_FILE:vault,RPLAYOUT_ENGINE:join(root,'apps/engine/target/release/rplayout-engine.exe'),RPLAYOUT_ENGINE_OUTPUT:'null',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_RELAY:'',RPLAYOUT_DEVICES:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_BACKUP_HOURS:'0',RPLAYOUT_ROLE:'ADMIN',HOST:'127.0.0.1',LOG_LEVEL:'warn',PATH:join(gst,'bin')+';'+process.env.PATH,GST_PLUGIN_PATH:join(gst,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gst,'lib/gstreamer-1.0'),GST_PLUGIN_SCANNER:join(gst,'libexec/gstreamer-1.0/gst-plugin-scanner.exe'),GST_REGISTRY:join(directory,'registry.bin')}
const {openDatabase}=await import('../apps/server/src/db/client.js'),{getChannel}=await import('../apps/server/src/db/repo.js'),{channels,mediaAssets,rundowns,rundownItems,outputProfiles,liveSources}=await import('../apps/server/src/db/schema.js'),{publishOperationalPlaylist}=await import('../apps/server/src/domain/operational-playlist.js'),{sessionDigest}=await import('../apps/server/src/domain/access.js'),{Checkpoints}=await import('../apps/server/src/domain/checkpoints.js'),{readExecutionOwner}=await import('../apps/server/src/db/execution-ownership.js'),{readRestoredActivations}=await import('../apps/server/src/db/restored-activations.js')
const Database=createRequire(new URL('../apps/server/package.json',import.meta.url))('better-sqlite3')
const children:ChildProcess[]=[],logs=new Map<ChildProcess,string>(),enginePids=new Set<number>(),token=randomUUID()+randomUUID()
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
let liveUri=pathToFileURL(file).href
let database:ReturnType<typeof openDatabase>|null=null,result:Record<string,unknown>={result:'FAIL',directory}
async function wait(label:string,check:()=>boolean|Promise<boolean>,milliseconds=30000){const deadline=performance.now()+milliseconds;while(performance.now()<deadline){if(await check())return;await new Promise(resolve=>setTimeout(resolve,100))}throw new Error(label+'; '+JSON.stringify([...logs.values()]))}
const gone=(pid:number)=>{try{process.kill(pid,0);return false}catch(error){return(error as NodeJS.ErrnoException).code==='ESRCH'}}
async function port(){const listener=createServer();await new Promise<void>(resolve=>listener.listen(0,'127.0.0.1',resolve));const value=(listener.address() as {port:number}).port;await new Promise<void>(resolve=>listener.close(()=>resolve()));return value}
async function api(p:number,path:string,body?:object,method='POST',headers:Record<string,string>={},expectedStatus?:number){const response=await fetch(`http://127.0.0.1:${p}${path}`,{headers:{cookie:'rplayout_session='+token,...(body?{'content-type':'application/json'}:{}),...headers},...(body?{method,body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(5000)});const value=await response.json();if(expectedStatus!==undefined)assert.equal(response.status,expectedStatus,path+' '+JSON.stringify(value));else assert.ok(response.ok,path+' '+response.status+' '+JSON.stringify(value));return value as any}
function start(folder:string,p:number,args:string[]=[]){const child=spawn(process.execPath,['-e',"process.on('message',m=>{if(m==='own-shutdown')process.emit('SIGTERM')});require(process.argv[1])",server,...args],{cwd:folder,env:{...env,PORT:String(p),RPLAYOUT_DB:join(folder,'service.db'),RPLAYOUT_MEDIA:media,RPLAYOUT_THUMBS:join(folder,'thumbs'),RPLAYOUT_CACHE:join(folder,'cache'),RPLAYOUT_MEDIA_VERSIONS:join(folder,'versions'),RPLAYOUT_BACKUPS:join(folder,'backups')},windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});children.push(child);logs.set(child,'');for(const stream of [child.stdout,child.stderr])stream?.on('data',chunk=>logs.set(child,((logs.get(child)??'')+chunk).slice(-16000)));return child}
function read<T>(path:string,work:(db:any)=>T):T{const db=new Database(path,{readonly:true,fileMustExist:true});try{return work(db)}finally{db.close()}}
try{
  if(realtime){
    const {createSocket}=await import('node:dgram'),socket=createSocket('udp4')
    await new Promise<void>((resolve,reject)=>{socket.once('error',reject);socket.bind(0,'127.0.0.1',resolve)})
    const inputPort=socket.address().port;await new Promise<void>(resolve=>socket.close(()=>resolve()))
    liveUri=`srt://127.0.0.1:${inputPort}?mode=caller&latency=200`
    const generator=spawn(join(gst,'bin/gst-launch-1.0.exe'),['videotestsrc','is-live=true','pattern=ball','!','video/x-raw,width=320,height=180,framerate=25/1','!','videoconvert','!','x264enc','tune=zerolatency','speed-preset=ultrafast','key-int-max=25','!','h264parse','config-interval=-1','!','queue','!','m.','audiotestsrc','is-live=true','volume=0.05','!','audio/x-raw,rate=48000,channels=2','!','audioconvert','!','avenc_aac','!','aacparse','!','queue','!','m.','mpegtsmux','name=m','alignment=7','!','srtsink',`uri=srt://127.0.0.1:${inputPort}?mode=listener`,'mode=listener','localaddress=127.0.0.1',`localport=${inputPort}`,'wait-for-connection=false','sync=false'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']})
    children.push(generator);logs.set(generator,'');for(const stream of [generator.stdout,generator.stderr])stream?.on('data',chunk=>logs.set(generator,((logs.get(generator)??'')+chunk).slice(-8000)))
    await wait('Own realtime SRT generator ownership',async()=>{assert.equal(generator.exitCode,null,logs.get(generator));const result=await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',`@(Get-NetUDPEndpoint -LocalPort ${inputPort} -ErrorAction SilentlyContinue | Where-Object OwningProcess -eq ${generator.pid}).Count`],{windowsHide:true,timeout:10000});return Number(result.stdout.trim())>=1},20000)
  }
  await run(join(gst,'bin/gst-launch-1.0.exe'),['-q','videotestsrc','num-buffers=750','pattern=ball','!','video/x-raw,width=320,height=180,framerate=25/1','!','videoconvert','!','x264enc','speed-preset=ultrafast','!','h264parse','!','queue','!','m.video_0','audiotestsrc','num-buffers=1407','volume=0.05','!','audio/x-raw,rate=48000,channels=2','!','audioconvert','!','vorbisenc','!','queue','!','m.audio_0','matroskamux','name=m','!','filesink',`location=${file.replaceAll('\\','/')}`],{env,timeout:30000,windowsHide:true})
  const probe=JSON.parse((await run(join(root,'apps/engine/target/release/rplayout-probe.exe'),[file,'--no-loudness'],{env,timeout:45000,windowsHide:true})).stdout.trim().split('\n').at(-1)!)
  assert.equal(probe.ok,true);assert.ok(probe.decodedVideoBuffers>0&&probe.decodedAudioBuffers>0)
  const hash=sha(await readFile(file)),stamp=new Date().toISOString()
  database=openDatabase(dbFile)
  database.sqlite.exec("INSERT INTO users VALUES('u','Admin','NO_LOGIN','ADMIN',1,'now')")
  database.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest(token),'u','2099-01-01','now')
  database.db.insert(channels).values({id:'ch',name:'Restored PGM',width:320,height:180,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:stamp}).run()
  if(metricLabels)database.db.insert(outputProfiles).values({id:'own-recording',channelId:'ch',name:'Gravação São José',kind:'FILE',target:recording,role:'EXTRA',width:320,height:180,rateNum:25,rateDen:1,scan:'PROGRESSIVE',bitrateKbps:500,enabled:true,createdAt:stamp}).run()
  database.db.insert(mediaAssets).values({id:'asset',path:file,title:'Retomada Çãó',contentHash:hash,kind:'VIDEO',durationNs:probe.durationNs,durationFrames:0,width:probe.video.width,height:probe.video.height,rateNum:probe.video.rateNum,rateDen:probe.video.rateDen,interlaceMode:probe.video.interlaceMode,hasAudio:true,audioChannels:probe.audio.channels,audioRate:probe.audio.rate,qcStatus:'APPROVED',createdAt:stamp}).run()
  database.db.insert(rundowns).values({id:'rd',channelId:'ch',name:'RD',date:'2026-10-09',plannedStart:0,loop:false,createdAt:stamp,updatedAt:stamp}).run()
  // Catalog fixtures are inserted directly, not through production CRUD.
  // Realtime mode uses a continuous own loopback SRT sender; legacy mode is
  // a finite file URI and must never qualify a live network protocol.
  if(nativeCatalog){
    database.db.insert(outputProfiles).values({id:'own-preview',channelId:'ch',name:'Preview isolado',kind:'SRT',target:'',role:'PREVIEW',width:320,height:180,rateNum:5,rateDen:1,scan:'PROGRESSIVE',bitrateKbps:180,enabled:true,createdAt:stamp}).run()
    for(const [id,name]of [['catalog-pgm','Estúdio São José'],['catalog-pvw','Estúdio Óscar']])database.db.insert(liveSources).values({id:id!,name:name!,channelId:'ch',kind:'SRT',targetUrl:liveUri,createdAt:stamp}).run()
    database.db.insert(rundownItems).values({id:'qc',rundownId:'rd',sortOrder:1,title:'Conferência',type:'LIVE',configuredSourceId:'catalog-pvw',sourceRef:liveUri,durationOverride:3000,minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',autoNext:false,loop:false,locked:false}).run()
  }
  database.db.insert(rundownItems).values({id:'vt',rundownId:'rd',sortOrder:0,title:liveMode?'Live synthetic URI':metricLabels?'VT São José':'VT',type:liveMode?'LIVE':'VT',...(liveMode?{sourceRef:liveUri,durationOverride:3000,...(nativeCatalog?{configuredSourceId:'catalog-pgm'}:{})}:{mediaId:'asset',trim:{in:25,out:725}}),minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',autoNext:false,loop:false,locked:false}).run()
  const edition=await publishOperationalPlaylist(database.db,(await getChannel(database.db,'ch'))!,'rd','@verifier')
  database.sqlite.close();database=null
  if(nativeCatalog){
    // Fixed managed preview address: refuse if occupied, then prove this
    // run's receiver owns the UDP listener before emitting any preview.
    const {createSocket}=await import('node:dgram'),socket=createSocket('udp4')
    await new Promise<void>((resolve,reject)=>{socket.once('error',reject);socket.bind(8890,'127.0.0.1',()=>resolve())}).finally(()=>socket.close())
    const receiver=spawn(join(gst,'bin/gst-launch-1.0.exe'),['srtsrc','uri=srt://127.0.0.1:8890?mode=listener','mode=listener','localaddress=127.0.0.1','localport=8890','!','fakesink','sync=false'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']})
    children.push(receiver);logs.set(receiver,'');for(const stream of [receiver.stdout,receiver.stderr])stream?.on('data',chunk=>logs.set(receiver,((logs.get(receiver)??'')+chunk).slice(-8000)))
    await wait('Own preview UDP receiver ownership',async()=>{assert.equal(receiver.exitCode,null,logs.get(receiver));const result=await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',`@(Get-NetUDPEndpoint -LocalPort 8890 -ErrorAction SilentlyContinue | Where-Object OwningProcess -eq ${receiver.pid}).Count`],{windowsHide:true,timeout:10000});return Number(result.stdout.trim())>=1},20000)
  }
  const sourcePort=await port(),source=start(sourceDir,sourcePort)
  await wait('Own source native startup',async()=>{assert.equal(source.exitCode,null,logs.get(source));try{return(await api(sourcePort,'/api/health')).engines===1}catch{return false}},60000)
  const sourceProcesses=await api(sourcePort,'/api/processes'),oldEngine=sourceProcesses.processes.find((row:any)=>row.kind==='ENGINE'&&row.channelId==='ch')
  assert.equal(oldEngine?.details?.transport,'NATIVE');assert.ok(oldEngine.pid);enginePids.add(oldEngine.pid)
  await api(sourcePort,'/api/channels/ch/transport',{action:'take',itemId:'vt'})
  await wait('Native playing checkpoint',()=>read(dbFile,db=>{const cp=new Checkpoints(db).read('ch');return Boolean(cp?.playing&&cp.elapsed>=25&&cp.ownerRunId&&(liveMode?!cp.programTrim:cp.programTrim))}))
  if(nativeCatalog)await api(sourcePort,'/api/channels/ch/transport',{action:'cue',itemId:'qc'})
  if(metricsOnly){
    const checkpoint=read(dbFile,db=>new Checkpoints(db).read('ch'))!
    let persisted:any,correlated:any
    // Read SQLite only until an autonomous timer sample exists. Calling the
    // metrics API here could itself collect a sample and invalidate the claim.
    await wait('Autonomous operational history during native PGM',()=>read(dbFile,db=>{
      const rows=db.prepare('SELECT payload FROM host_metric_samples ORDER BY sampled_at DESC LIMIT 20').all() as Array<{payload:string}>
      for(const row of rows){
        const sample=JSON.parse(row.payload),channel=sample.operations?.channels?.find((value:any)=>value.channelId==='ch')
        if(channel?.itemId!=='vt'||channel.revisionId!==edition.id||channel.executionId!==checkpoint.executionId||channel.engine?.pid!==oldEngine.pid||!channel.engine.ready||channel.mode!=='NATIVE')continue
        if(liveMode&&!channel.sources?.some((value:any)=>value.busItemIds?.pgm==='vt'&&value.busSignals?.pgm?.videoRecent===true))continue
        if(nativeCatalog&&!channel.sources?.some((value:any)=>value.busItemIds?.pgm==='vt'&&value.busItemIds?.pvw==='qc'&&value.busSignals?.pvw?.videoRecent===true&&value.busCatalog?.pgm?.identityBasis==='NATIVE_DECODER'&&value.busCatalog?.pvw?.identityBasis==='NATIVE_DECODER'&&value.busCatalog?.pgm?.sourceName==='Estúdio São José'&&value.busCatalog?.pvw?.sourceName==='Estúdio Óscar'&&value.busCatalog.pgm.configuredSourceId!==value.busCatalog.pvw.configuredSourceId))continue
        if(metricLabels&&(channel.itemName!=='VT São José'||!channel.outputs?.some((value:any)=>value.outputName==='Gravação São José'&&value.identityType==='PROFILE'&&value.delivered>0)))continue
        persisted=sample;correlated=channel;return true
      }
      return false
    }),25000)
    const operations=JSON.stringify(persisted.operations)
    assert.ok(!operations.includes(file)&&!operations.includes(pathToFileURL(file).href),'Operational payload must not contain the synthetic source URI or path')
    if(realtime)assert.ok(!operations.includes(liveUri),'Operational payload must omit the loopback source URI')
    for(const name of ['cpuTimeMs','memoryBytes'])assert.ok(correlated.engine[name]===null||(Number.isFinite(correlated.engine[name])&&correlated.engine[name]>=0),'Unavailable OS counters remain null, not fabricated')
    if(liveMode){
      const source=correlated.sources.find((value:any)=>value.busItemIds?.pgm==='vt')
      assert.ok(source.sourceId&&source.sourceId!==pathToFileURL(file).href)
      assert.equal(source.busSignals.pgm.videoRecent,true)
    }
    let renamedOutputId:string|null=null,editEvidence:Record<string,unknown>|null=null
    if(editBinding){
      const originalPayload=read(dbFile,db=>db.prepare('SELECT payload FROM operational_playlist_revisions WHERE id=?').get(edition.id).payload)
      const newUri=liveUri.replace('latency=200','latency=300')
      assert.notEqual(newUri,liveUri)
      const editorial=await api(sourcePort,'/api/rundowns/rd')
      await api(sourcePort,'/api/items/qc',{liveEndpoint:newUri},'PATCH',{'if-match':`w/"${editorial.view.editorialRevision}"`})
      const edited=read(dbFile,db=>db.prepare('SELECT configured_source_id,source_ref,live_endpoint FROM rundown_items WHERE id=?').get('qc'))
      assert.equal(edited.configured_source_id,null)
      // Connection columns use the vault at rest; inspect the public editorial
      // item through the compiled route, not by reading ciphertext as an address.
      const refreshed=await api(sourcePort,'/api/rundowns/rd'),item=refreshed.view.items.find((entry:any)=>entry.item.id==='qc').item
      assert.equal(item.sourceRef,newUri);assert.equal(item.liveEndpoint,newUri);assert.equal(item.configuredSourceId,null)
      assert.equal(read(dbFile,db=>db.prepare('SELECT payload FROM operational_playlist_revisions WHERE id=?').get(edition.id).payload),originalPayload)
      const guardedSimulation=await api(sourcePort,'/api/rundowns/rd/operational-simulation')
      const blocked=await api(sourcePort,'/api/rundowns/rd/operational-publish',{reviewToken:guardedSimulation.review.token},'POST',{'if-match':`w/"${guardedSimulation.review.editorialRevision}"`},409)
      assert.match(blocked.error,/CUE/)
      assert.equal(read(dbFile,db=>new Checkpoints(db).read('ch'))!.executionId,checkpoint.executionId)
      await api(sourcePort,'/api/channels/ch/transport',{action:'cue',itemId:null})
      const simulation=await api(sourcePort,'/api/rundowns/rd/operational-simulation')
      const published=await api(sourcePort,'/api/rundowns/rd/operational-publish',{reviewToken:simulation.review.token},'POST',{'if-match':`w/"${simulation.review.editorialRevision}"`})
      assert.notEqual(published.id,edition.id)
      await api(sourcePort,'/api/channels/ch/transport',{action:'cue',itemId:'qc'})
      let observed:any
      await wait('Edited native preview without PGM interruption',async()=>{
        const value=await api(sourcePort,'/api/n1/state'),channel=value.channels.find((entry:any)=>entry.channelId==='ch')
        const pgm=channel?.state?.liveSources.find((row:any)=>row.busItemIds?.pgm==='vt')
        const pvw=channel?.state?.liveSources.find((row:any)=>row.busItemIds?.pvw==='qc')
        if(!pgm?.busSignals?.pgm?.videoRecent||!pgm.busSignals.pgm.audioRecent||!pvw?.busSignals?.pvw?.videoRecent||!pvw.busSignals.pvw.audioRecent)return false
        assert.equal(channel.state.onAir.itemId,'vt');assert.equal(pvw.source,newUri)
        assert.equal(pvw.nativeCatalogBindings?.pvw,undefined);assert.equal(pgm.nativeCatalogBindings?.pgm,'catalog-pgm')
        observed=channel;return true
      },20000)
      const current=read(dbFile,db=>new Checkpoints(db).read('ch'))!
      assert.equal(current.executionId,checkpoint.executionId);assert.equal(observed.state.onAir.itemId,'vt')
      editEvidence={compiledPatchUpdatesExecutableReference:true,publicationWhileSourceStillCuedRefused:true,explicitCueClearBeforePublish:true,compiledPublishAndRecueUseNewReference:true,manualConnectionClearsNativeCatalogAttribution:true,oldPublishedPayloadPreserved:true,pgmExecutionPreserved:true,pgmAndPvwVideoAndAudioRecentAfterEdit:true}
    }
    if(metricLabels){
      const originalPayload=JSON.stringify(persisted),publisher=correlated.outputs.find((value:any)=>value.outputName==='Gravação São José')
      // Only this run's fixture DB is renamed; this is NOT qualification of
      // the configuration-review API mutation workflow.
      const edit=new Database(dbFile,{fileMustExist:true})
      try{assert.equal(edit.prepare('UPDATE output_profiles SET name=? WHERE id=?').run('Gravação renomeada','own-recording').changes,1)}finally{edit.close()}
      await wait('Autonomous renamed output label',()=>read(dbFile,db=>{
        for(const row of db.prepare('SELECT payload FROM host_metric_samples ORDER BY sampled_at DESC LIMIT 20').all() as Array<{payload:string}>){
          const channel=JSON.parse(row.payload).operations?.channels?.find((value:any)=>value.channelId==='ch')
          const renamed=channel?.outputs?.find((value:any)=>value.outputName==='Gravação renomeada'&&value.identityType==='PROFILE'&&value.delivered>0)
          if(renamed){assert.equal(renamed.outputId,publisher.outputId);assert.equal(channel.itemName,'VT São José');renamedOutputId=renamed.outputId;return true}
        }
        return false
      }),20000)
      assert.equal(JSON.stringify(read(dbFile,db=>JSON.parse(db.prepare('SELECT payload FROM host_metric_samples WHERE sampled_at=?').get(persisted.generatedAt).payload))),originalPayload)
    }
    const history=await api(sourcePort,'/api/channels/ch/operational-metrics/history?hours=1&limit=120')
    assert.equal(history.channelId,'ch');assert.ok(history.totalSamples>=1)
    assert.ok(history.samples.some((sample:any)=>sample.operations?.channels?.some((channel:any)=>channel.executionId===checkpoint.executionId&&channel.itemId==='vt'&&channel.engine.pid===oldEngine.pid)))
    for(const sample of history.samples){
      for(const name of ['cpu','gpu','disk','network','process','memory'])assert.equal(Object.hasOwn(sample,name),false,'Channel endpoint must not expose global host resources')
      assert.ok(!sample.operations||sample.operations.channels.every((channel:any)=>channel.channelId==='ch'))
    }
    await api(sourcePort,'/api/channels/ch/transport',{action:'stop'})
    await wait('Metrics native STOP',()=>read(dbFile,db=>new Checkpoints(db).read('ch')?.itemId===null))
    source.send('own-shutdown');await wait('Own metrics backend shutdown',()=>source.exitCode!==null||source.signalCode!==null)
    assert.equal(source.exitCode,0,logs.get(source));await wait('Own metrics native child exit',()=>gone(oldEngine.pid))
    let recordingProbe:any=null
    if(metricLabels){
      recordingProbe=JSON.parse((await run(join(root,'apps/engine/target/release/rplayout-probe.exe'),[recording,'--no-loudness'],{env,timeout:45000,windowsHide:true})).stdout.trim().split('\n').at(-1)!)
      assert.equal(recordingProbe.ok,true);assert.ok(recordingProbe.decodedVideoBuffers>0&&recordingProbe.decodedAudioBuffers>0)
      assert.ok(history.samples.some((sample:any)=>sample.operations?.channels?.some((channel:any)=>channel.outputs?.some((output:any)=>output.outputId===renamedOutputId&&output.outputName==='Gravação São José'))))
      assert.ok(history.samples.some((sample:any)=>sample.operations?.channels?.some((channel:any)=>channel.outputs?.some((output:any)=>output.outputId===renamedOutputId&&output.outputName==='Gravação renomeada'))))
      assert.ok(!JSON.stringify(history).includes(recording),'Recording path must not leak into channel history')
    }
    result={result:'PASS',directory,compiledServerSha256:sha(await readFile(server)),probeVideoBuffers:probe.decodedVideoBuffers,probeAudioBuffers:probe.decodedAudioBuffers,autonomousPersistenceBeforeMetricsApi:true,exactEditionExecutionAndNativePidCorrelated:true,livePgmVideoCorrelated:liveMode,sourceUriOmitted:true,channelApiOmitsGlobalHostResources:true,engineCounters:{cpuTimeMs:correlated.engine.cpuTimeMs,memoryBytes:correlated.engine.memoryBytes},nativeStopConfirmed:true,nullOutputOnly:!metricLabels,syntheticFixtureOnly:true,physicalOutputValidated:false,browserValidated:false,retentionAndLoadValidated:false,compiledItemAndOutputNamesValidated:metricLabels,renamePreservesHistoricalNameAndProfileId:metricLabels,renameThroughConfigurationApiValidated:false,sourceCatalogNamesValidated:false,recordingVideoBuffers:recordingProbe?.decodedVideoBuffers??null,recordingAudioBuffers:recordingProbe?.decodedAudioBuffers??null}
    if(nativeCatalog){
      const source=correlated.sources.find((value:any)=>value.busItemIds?.pgm==='vt'&&value.busItemIds?.pvw==='qc')
      assert.ok(!JSON.stringify(persisted.operations).includes('catalog-pgm')&&!JSON.stringify(persisted.operations).includes('catalog-pvw'))
      Object.assign(result,{nativeCatalogEchoOnPgmAndPvwValidated:true,distinctCatalogIdentitiesForSameEndpoint:true,pgmSourceName:source.busCatalog.pgm.sourceName,pvwSourceName:source.busCatalog.pvw.sourceName,nullOutputOnly:false,previewOutput:'OWN_LOOPBACK_SRT_RECEIVER',productionCatalogCrudValidated:false,sourceProtocolValidated:false})
      if(realtime)Object.assign(result,{sourceFixture:'CONTINUOUS_REALTIME_LOOPBACK_SRT',loopbackSrtInputValidated:true,pgmAndPvwRecentVideoValidated:true,physicalInputsValidated:false})
    }
    if(editEvidence)Object.assign(result,editEvidence)
  }else{
  const backup=await api(sourcePort,'/api/backups',{})
  const saved=read(backup.file,db=>new Checkpoints(db).read('ch'))!,owner=read(backup.file,db=>readExecutionOwner(db,'ch'))!
  const savedBindings=restoreCatalog?read(backup.file,db=>db.prepare('SELECT id,configured_source_id FROM rundown_items ORDER BY id').all()):null
  const savedEditions=restoreCatalog?read(backup.file,db=>db.prepare('SELECT * FROM operational_playlist_revisions ORDER BY rowid').all()):null
  if(restoreCatalog)assert.deepEqual(savedBindings,[{id:'qc',configured_source_id:'catalog-pvw'},{id:'vt',configured_source_id:'catalog-pgm'}])
  assert.equal(saved.playing,true);assert.equal(saved.ownerRunId,owner.id);assert.equal(saved.revisionId,edition.id);assert.deepEqual(saved.programTrim,liveMode?undefined:{in:25,out:725,contentHash:hash})
  source.kill('SIGKILL')
  await wait('Own source actual exit',()=>source.exitCode!==null||source.signalCode!==null)
  await wait('Own source native child exit',()=>gone(oldEngine.pid))
  const restoredDir=join(directory,'restored')
  await run(process.execPath,[join(root,'apps/server/dist/restore-backup.cjs'),'--backup',backup.file,'--destination',restoredDir,'--vault-file',vault],{env,timeout:60000,windowsHide:true})
  const restoredFile=join(restoredDir,'service.db'),manifest=join(restoredDir,'restore-quarantine.json')
  assert.deepEqual(read(restoredFile,db=>new Checkpoints(db).read('ch')),saved)
  if(restoreCatalog){
    assert.deepEqual(read(restoredFile,db=>db.prepare('SELECT id,configured_source_id FROM rundown_items ORDER BY id').all()),savedBindings)
    assert.deepEqual(read(restoredFile,db=>db.prepare('SELECT * FROM operational_playlist_revisions ORDER BY rowid').all()),savedEditions)
  }
  const protectedBefore=missingVideo?read(restoredFile,db=>({cursor:db.prepare('SELECT * FROM channel_checkpoints').all(),asRun:db.prepare('SELECT * FROM as_run').all(),receipts:db.prepare('SELECT * FROM restoration_records').all(),editions:db.prepare('SELECT * FROM operational_playlist_revisions').all(),origin:db.prepare('SELECT * FROM ha_recovery_origin').all()})):null
  let audioOnlyProbe:any=null
  if(missingVideo){
    // Overwrite ONLY this run's generated synthetic endpoint after its source
    // server/engine exited. No previous evidence or operator media is changed.
    await run(join(gst,'bin/gst-launch-1.0.exe'),['-q','audiotestsrc','num-buffers=1407','volume=0.05','!','audio/x-raw,rate=48000,channels=2','!','audioconvert','!','vorbisenc','!','matroskamux','!','filesink',`location=${file.replaceAll('\\','/')}`],{env,timeout:30000,windowsHide:true})
    audioOnlyProbe=JSON.parse((await run(join(root,'apps/engine/target/release/rplayout-probe.exe'),[file,'--no-loudness'],{env,timeout:45000,windowsHide:true})).stdout.trim().split('\n').at(-1)!)
    assert.equal(audioOnlyProbe.decodedVideoBuffers,0);assert.ok(audioOnlyProbe.decodedAudioBuffers>0)
  }
  const restoredPort=await port(),restored=start(restoredDir,restoredPort,['--activate-restored',manifest])
  if(missingVideo){
    let httpOpened=false
    await wait('No-video activation must exit without HTTP admission',async()=>{
      const active=read(restoredFile,db=>readExecutionOwner(db,'ch'));for(const pid of active?.enginePids??[])enginePids.add(pid)
      try{if((await fetch(`http://127.0.0.1:${restoredPort}/api/health`,{signal:AbortSignal.timeout(200)})).ok)httpOpened=true}catch{}
      return restored.exitCode!==null||restored.signalCode!==null
    },60000)
    assert.equal(restored.exitCode,1,logs.get(restored));assert.equal(httpOpened,false,'No-video restoration cannot be admitted as an operational HTTP backend')
    const activation=read(restoredFile,db=>readRestoredActivations(db).at(-1))!
    assert.equal(activation.phase,'FAILED');assert.deepEqual(activation.nativeReadyChannels,[]);assert.deepEqual(activation.resumedChannels,[])
    assert.equal(activation.originTable,null);assert.equal(activation.physicalOutputValidated,false)
    assert.deepEqual(read(restoredFile,db=>({cursor:db.prepare('SELECT * FROM channel_checkpoints').all(),asRun:db.prepare('SELECT * FROM as_run').all(),receipts:db.prepare('SELECT * FROM restoration_records').all(),editions:db.prepare('SELECT * FROM operational_playlist_revisions').all(),origin:db.prepare('SELECT * FROM ha_recovery_origin').all()})),protectedBefore)
    const {readStorageAdmission}=await import('../apps/server/src/db/storage-admission.js')
    assert.equal(read(restoredFile,db=>readStorageAdmission(db))?.phase,'OPEN')
    result={result:'PASS',directory,compiledServerSha256:sha(await readFile(server)),actualNativeSourceTakeBeforeBackup:true,backupCapturedWhileLivePlaying:true,sourceCrashAndNativeExitObserved:true,audioOnlyDecodedVideoBuffers:audioOnlyProbe.decodedVideoBuffers,audioOnlyDecodedAudioBuffers:audioOnlyProbe.decodedAudioBuffers,noVideoActivationRefused:true,httpOperationalAdmissionRefused:true,signedFailureRecorded:true,cursorAndAsRunAndReceiptsAndEditionAndQuarantinePreserved:true,ownStorageReservationReleased:true,syntheticEndpointOnly:true,physicalOutputValidated:false}
  }else{
  let recovered:any
  await wait('Compiled restored native PGM confirmation',async()=>{assert.equal(restored.exitCode,null,logs.get(restored));try{recovered=(await api(restoredPort,'/api/n1/state')).channels.find((row:any)=>row.channelId==='ch');return recovered?.health.ready&&recovered?.state.playing&&recovered.state.onAir?.itemId==='vt'&&recovered.state.onAir.elapsed>=saved.elapsed}catch{return false}},60000)
  if(liveMode){const signal=recovered.state.liveSources.find((row:any)=>row.busItemIds?.pgm==='vt');assert.equal(signal?.busStates?.pgm,'ON_PGM');assert.equal(signal?.busSignals?.pgm?.videoRecent,true);assert.equal(signal?.busSignals?.pgm?.audioRecent,true)}
  if(restoreCatalog){
    assert.equal(recovered.state.liveSources.find((row:any)=>row.busItemIds?.pgm==='vt')?.nativeCatalogBindings?.pgm,'catalog-pgm')
    await api(restoredPort,'/api/channels/ch/transport',{action:'cue',itemId:'qc'})
    await wait('Restored native catalog PGM and PVW identities with recent frames',async()=>{
      const row=(await api(restoredPort,'/api/n1/state')).channels.find((entry:any)=>entry.channelId==='ch')
      assert.equal(row.state.onAir?.itemId,'vt')
      const pgm=row.state.liveSources.find((entry:any)=>entry.busItemIds?.pgm==='vt'),pvw=row.state.liveSources.find((entry:any)=>entry.busItemIds?.pvw==='qc')
      return pgm?.nativeCatalogBindings?.pgm==='catalog-pgm'&&pvw?.nativeCatalogBindings?.pvw==='catalog-pvw'&&pgm.busSignals?.pgm?.videoRecent&&pgm.busSignals?.pgm?.audioRecent&&pvw.busSignals?.pvw?.videoRecent&&pvw.busSignals?.pvw?.audioRecent
    })
  }
  const current=read(restoredFile,db=>new Checkpoints(db).read('ch'))!,activation=read(restoredFile,db=>readRestoredActivations(db).at(-1))!
  assert.equal(activation.phase,'CONFIRMED');assert.deepEqual(activation.resumedChannels,['ch']);assert.equal(activation.physicalOutputValidated,false)
  assert.deepEqual(current.programTrim,saved.programTrim);assert.equal(current.executionId,saved.executionId);assert.equal(current.revisionId,saved.revisionId);assert.equal(current.audioChannels,saved.audioChannels);assert.deepEqual(current.rate,saved.rate);assert.ok(current.elapsed>=saved.elapsed);assert.notEqual(current.ownerRunId,saved.ownerRunId)
  const runs=read(restoredFile,db=>db.prepare('SELECT revision_id,start_position_frames,ended_by FROM as_run ORDER BY rowid').all())
  assert.equal(runs.length,2);assert.equal(runs[0].ended_by,'RESTART');assert.equal(runs[1].start_position_frames,saved.elapsed)
  const newEngine=(await api(restoredPort,'/api/processes')).processes.find((row:any)=>row.kind==='ENGINE'&&row.channelId==='ch');assert.ok(newEngine.pid);enginePids.add(newEngine.pid)
  await api(restoredPort,'/api/channels/ch/transport',{action:'stop'})
  await wait('Confirmed native STOP',()=>read(restoredFile,db=>new Checkpoints(db).read('ch')?.itemId===null))
  restored.send('own-shutdown');await wait('Own restored shutdown',()=>restored.exitCode!==null||restored.signalCode!==null);assert.equal(restored.exitCode,0,logs.get(restored))
  await wait('Own restored native child exit',()=>gone(newEngine.pid))
  result={result:'PASS',directory,compiledServerSha256:sha(await readFile(server)),probeVideoBuffers:probe.decodedVideoBuffers,probeAudioBuffers:probe.decodedAudioBuffers,actualNativeTake:true,backupCapturedWhilePlaying:true,sourceCrashAndNativeExitObserved:true,savedElapsed:saved.elapsed,resumedElapsed:current.elapsed,programTrim:current.programTrim,exactEditionAndExecutionIdPreserved:true,signedOwnerTransferred:true,signedActivationConfirmed:true,asRunRestartAndPositionVerified:true,nativeStopConfirmed:true,nullOutputOnly:true,physicalOutputValidated:false,frozenPausedProgramValidated:false,liveInputValidated:liveMode,liveFixture:liveMode?'FINITE_FILE_URI_TREATED_AS_LIVE_NOT_NETWORK_HARDWARE':null,restoredLiveRecentVideoAndAudioConfirmed:liveMode}
  if(restoreCatalog)Object.assign(result,{liveFixture:'CONTINUOUS_REALTIME_LOOPBACK_SRT',restoredEditorialBindingsPreserved:true,frozenPublishedPayloadPreserved:true,restoredNativePgmAndPvwCatalogIdentitiesConfirmed:true,restoredPgmAndPvwRecentVideoAndAudioConfirmed:true,ndiOmtDecklinkValidated:false,browserPreviewValidated:false})
  }
  }
}catch(error){result={...result,error:String(error)};throw error}
finally{database?.sqlite.close();for(const child of children)if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await wait('Own verifier processes cleanup',()=>children.every(child=>child.exitCode!==null||child.signalCode!==null)&&[...enginePids].every(gone));await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));await writeFile(join(directory,'server.log'),[...logs.values()].join('\n'));console.log(JSON.stringify(result))}
