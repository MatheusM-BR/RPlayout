import assert from 'node:assert/strict'
import {spawn,execFile,type ChildProcess} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,mkdir,readFile,writeFile,stat,statfs} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash,randomUUID} from 'node:crypto'
import {StringDecoder} from 'node:string_decoder'
import {createServer as tcp,connect,type Socket} from 'node:net'
import {createSocket} from 'node:dgram'
import {createServer,request as forward} from 'node:http'
import {verifyPublishedPicture} from './lib/verify-published-picture.js'
import {verifyPublishedAudio} from './lib/verify-published-audio.js'

// Real synthetic SRT carrier -> two native engine NDI/OMT senders -> product
// QC receiver. Default: browser drives tuning. --lifecycle is an API-only
// shutdown/fault-injection test against installed web/devices, not UI proof.
const workspace=fileURLToPath(new URL('..',import.meta.url)),installed=resolve(process.argv[2]??'')
const priorityArgument=process.argv.find(value=>value.startsWith('--priority-live=')),priorityMode=Boolean(priorityArgument)
const qcBrowserCurrent=process.argv.includes('--qc-browser-current')
const qcAudioOverlap=process.argv.includes('--qc-audio-overlap')
assert.ok(!qcAudioOverlap||qcBrowserCurrent,'Audio overlap uses the explicit current native QC fixture')
const qcOnlyArgument=process.argv.find(value=>value.startsWith('--qc-only=')),qcOnly=qcOnlyArgument?.slice('--qc-only='.length)
assert.ok(!qcOnlyArgument||qcBrowserCurrent&&!qcAudioOverlap&&['NDI','OMT'].includes(qcOnly!),'Protocol restriction applies only to the current browser fixture')
const recoveryArgument=process.argv.find(value=>value.startsWith('--input-recovery='))
assert.ok(!priorityArgument||!recoveryArgument,'Priority and recovery are separate scenarios')
const recoveryKind=priorityArgument?.slice('--priority-live='.length)??recoveryArgument?.slice('--input-recovery='.length)
assert.ok(recoveryKind===undefined||recoveryKind==='NDI'||recoveryKind==='OMT','Select native input recovery NDI or OMT')
const recoveryMode=Boolean(recoveryKind),lifecycleMode=process.argv.includes('--lifecycle')
const programRecovery=process.argv.includes('--program-recovery'),sourceServerOverride=process.argv.includes('--source-server')
const expireRetake=process.argv.includes('--expire-retake')
const priorityNoSignal=process.argv.includes('--priority-no-signal')
assert.ok(!priorityNoSignal||priorityMode,'Missing-signal guard requires explicit priority mode')
assert.ok(!priorityMode||!programRecovery&&!expireRetake&&!lifecycleMode,'Select priority separately')
assert.ok(!expireRetake||programRecovery,'Retake expiry requires the isolated PGM scenario')
assert.ok(!programRecovery||recoveryMode,'Program recovery requires an explicit input protocol')
assert.ok(!sourceServerOverride||recoveryMode||qcBrowserCurrent,'Source server overlay requires an explicit native QA mode')
const sourceEngineOverride=process.argv.includes('--source-engine')
assert.ok(!qcBrowserCurrent||!recoveryMode&&!lifecycleMode&&sourceServerOverride&&sourceEngineOverride,'Current QC browser QA requires explicit server/engine overlays and no other scenario')
assert.ok(!sourceEngineOverride||recoveryMode||qcBrowserCurrent,'Source engine overlay requires an explicit native QA mode')
assert.ok(!recoveryMode||!lifecycleMode,'Native recovery and shutdown lifecycle are separate scenarios')
const currentWebOverlay=process.argv.includes('--source-web')
const expectedWebArgument=process.argv.find(value=>value.startsWith('--web-sha256='))?.slice('--web-sha256='.length)
assert.ok(!currentWebOverlay||qcBrowserCurrent&&!!expectedWebArgument&&/^[a-f0-9]{64}$/.test(expectedWebArgument),'Current web overlay requires current QC mode and explicit compiled hash')
assert.ok(!expectedWebArgument||currentWebOverlay,'Expected web hash belongs to the explicit current web overlay')
const devicesOverride=!lifecycleMode&&!recoveryMode&&!qcBrowserCurrent
const sourceWebOverride=devicesOverride||currentWebOverlay,webRoot=sourceWebOverride?workspace:installed
assert.ok(installed.toLowerCase().startsWith(join(workspace,'scratch').toLowerCase()+'\\'))
assert.equal(resolve(process.execPath).toLowerCase(),join(installed,'runtime/node/node.exe').toLowerCase())
const storage=await statfs(join(workspace,'scratch'));assert.ok(storage.bavail*storage.bsize>150_000_000,'Space for bounded QA evidence required')
for(const port of [1935,8554,8888,8889,9997]){const socket=tcp();await new Promise<void>((done,reject)=>{socket.once('error',reject);socket.listen(port,'127.0.0.1',done)});await new Promise<void>(done=>socket.close(()=>done()))}
for(const port of [8890,8189]){const socket=createSocket('udp4');await new Promise<void>((done,reject)=>{socket.once('error',reject);socket.bind(port,'127.0.0.1',done)});socket.close()}
const directory=await mkdtemp(join(workspace,'scratch','qc-native-browser-')),media=join(directory,'Acervo QA Çãó');await mkdir(media)
const controlFile=join(directory,'control.json'),stopFile=join(directory,'stop.json')
await writeFile(controlFile,JSON.stringify({phase:'baseline',catalog:'OK',telemetry:'OK',capture:null}))
const native=join(installed,'apps/engine/target/release'),gst=join(installed,'runtime/gstreamer'),gstBin=join(gst,'bin')
const engine=join(sourceEngineOverride?join(workspace,'apps/engine/target/release'):native,'rplayout-engine.exe'),devices=join(devicesOverride?workspace:installed,'apps/engine/target/release/rplayout-devices.exe'),binary=join(sourceServerOverride?workspace:installed,'apps/server/dist/server.cjs')
const sha=async(path:string)=>createHash('sha256').update(await readFile(path)).digest('hex')
const webAsset=(await readFile(join(webRoot,'apps/web/dist/index.html'),'utf8')).match(/src="(\/assets\/[^"?]+\.js)"/)?.[1];assert.ok(webAsset&&!webAsset.includes('..'))
const hashes={server:await sha(binary),engine:await sha(engine),devices:await sha(devices),web:await sha(join(webRoot,'apps/web/dist',webAsset)),controller:await sha(fileURLToPath(import.meta.url))}
assert.equal(hashes.server,sourceServerOverride?'a709115f976cc6372f1ffe13d1b9195261ffc217c0ebe2707990477056e0473a':'5f33c58e58e2d26294fad3eff71f994c82d093ae0f6159dac91bde8508a64607')
if(priorityMode)assert.ok(['eaea694fa34c23cef81bf6326fd31367e603a5768d67edf91468ab0aab66305c','7fd481e0b58a147c553477ec2b9eab397ebad4ed9136f0d2d589b6981b141eb9','191cd1e112c7afba81896bbf3aa109a100775a7a358b7894faaafbe8d1abdfbc'].includes(hashes.engine),'Explicitly compiled priority engine required')
if(qcBrowserCurrent){assert.ok(['7fd481e0b58a147c553477ec2b9eab397ebad4ed9136f0d2d589b6981b141eb9','191cd1e112c7afba81896bbf3aa109a100775a7a358b7894faaafbe8d1abdfbc'].includes(hashes.engine));assert.equal(hashes.web,currentWebOverlay?expectedWebArgument:'cd7665dea5b70b1b9cba4d9fb9af667085869e22f67c868b3105eaced818c173')}
if(!sourceEngineOverride)assert.equal(hashes.engine,'3f0c9616a55cc83ee0c31e6a12c17ee952f35a3bc2c14b41dd685025b1969d65')
const env:NodeJS.ProcessEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^RPLAYOUT_|^NODE_PATH$|^NODE_OPTIONS$|^GST_|^GSTREAMER_|^NDI_/i.test(key)))
Object.assign(env,{PATH:[native,installed,gstBin,join(installed,'runtime/node'),join(process.env.SystemRoot!,'System32')].join(';'),GST_PLUGIN_PATH:join(gst,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gst,'lib/gstreamer-1.0'),GST_PLUGIN_SCANNER:join(gst,'libexec/gstreamer-1.0/gst-plugin-scanner.exe'),GST_REGISTRY:join(directory,'registry.bin'),GST_DEBUG:'0',RPLAYOUT_OMT_RUNTIME:join(installed,'libomt.dll')})
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json');delete process.env.RPLAYOUT_VAULT_KEY
const {openDatabase}=await import('../apps/server/src/db/client.js'),{hashPassword}=await import('../apps/server/src/domain/auth.js'),{sessionDigest}=await import('../apps/server/src/domain/access.js')
const {channels,rundowns,rundownItems,mediaAssets,operationalPlaylistRevisions,guestKeys,outputProfiles,liveSources,operatorDecisions}=await import('../apps/server/src/db/schema.js')
const database=openDatabase(join(directory,'service.db')),stamp=new Date().toISOString(),token=randomUUID()+randomUUID()
database.sqlite.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('qa-admin','qc-native-verifier',await hashPassword('Local-QC-native-20261015'),'ADMIN',1,stamp)
database.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest(token),'qa-admin','2099-01-01',stamp)
database.db.insert(channels).values({id:'qa',name:'QA native QC',width:640,height:360,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:stamp}).run()
database.db.insert(rundowns).values({id:'rd',channelId:'qa',name:'Empty QC only',date:stamp.slice(0,10),plannedStart:0,loop:false,createdAt:stamp,updatedAt:stamp}).run()
database.db.insert(guestKeys).values({id:'feed',channelId:'qa',label:'Synthetic local carrier',streamKey:'qc-native-feed',enabled:true,createdAt:stamp}).run()
database.db.insert(outputProfiles).values({id:'off',channelId:'qa',name:'No external PGM',kind:'RTMP',target:'',role:'PROGRAM',enabled:false,createdAt:stamp}).run()
let backendPort=0,server:ChildProcess|null=null,carrier:ChildProcess|null=null,failure:unknown=null,expired=false,discovery:unknown=null
let intentionalServerStop=false
const lifecycle:Record<string,any>={mode:qcAudioOverlap?'COMPILED_NATIVE_QC_AUDIO_OVERLAP':qcBrowserCurrent?'COMPILED_NATIVE_QC_BROWSER':priorityMode?'COMPILED_NATIVE_PRIORITY_NETWORK':programRecovery?'COMPILED_NATIVE_PROGRAM_RECOVERY':recoveryMode?'INSTALLED_INPUT_RECOVERY':lifecycleMode?'INSTALLED_NATIVE_LIFECYCLE':'BROWSER_REVIEW',sourceEngineOverride,sourceServerOverride,enginePath:engine,serverPath:binary,browserValidated:false}
const logs=new Map<ChildProcess,string>(),sockets=new Set<Socket>(),events:Array<Record<string,unknown>>=[],active=new Map<string,number>(),maximum=new Map<string,number>()
const captures:Array<Record<string,unknown>>=[],snapshots:Array<Record<string,unknown>>=[],ownedNative=new Set<number>()
let lastSnapshot='',control={phase:'baseline',catalog:'OK',telemetry:'OK',capture:null as string|null}
async function readControl(){try{const value=JSON.parse(await readFile(controlFile,'utf8'));assert.ok(typeof value.phase==='string'&&value.phase.length<80);for(const key of ['catalog','telemetry'])assert.ok(['OK','FAIL','HANG'].includes(value[key]));assert.ok(value.capture===null||/^(ndi|omt)-[a-z0-9-]+$/.test(value.capture));control=value}catch{}return {...control}}
const gateway=createServer(async(req,res)=>{
  const path=req.url??'/',kind=path.startsWith('/api/sources/live?')?'catalog':path==='/api/srt/telemetry'?'telemetry':'other',state=await readControl(),key=state.phase+':'+kind
  const entry:Record<string,unknown>={phase:state.phase,kind,method:req.method,path:path.split('?')[0],startedAt:Date.now()};if(events.length<2500)events.push(entry)
  active.set(key,(active.get(key)??0)+1);maximum.set(key,Math.max(maximum.get(key)??0,active.get(key)!))
  let timer:ReturnType<typeof setTimeout>|undefined
  res.once('close',()=>{if(timer)clearTimeout(timer);active.set(key,active.get(key)!-1);entry.closedAt=Date.now();entry.durationMs=Number(entry.closedAt)-Number(entry.startedAt);entry.finished=res.writableFinished})
  const fault=req.method==='GET'&&kind!=='other'?state[kind]:'OK'
  if(fault!=='OK'){entry.fault=fault;const respond=()=>{entry.status=fault==='FAIL'?503:504;res.writeHead(Number(entry.status),{'content-type':'application/json'});res.end('{"error":"Falha sintética de leitura QA"}')};if(fault==='HANG')timer=setTimeout(respond,25000);else respond();return}
  const upstream=forward({hostname:'127.0.0.1',port:backendPort,path,method:req.method,headers:req.headers},response=>{entry.status=response.statusCode;res.writeHead(response.statusCode??502,response.headers);response.pipe(res)})
  upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('{}')});res.on('close',()=>{if(!res.writableFinished)upstream.destroy()});req.pipe(upstream)
})
gateway.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket))})
gateway.on('upgrade',(req,socket,head)=>{const upstream=connect(backendPort,'127.0.0.1',()=>{upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`+req.rawHeaders.reduce((value,part,index)=>value+part+(index%2?'\r\n':': '),'')+'\r\n');if(head.length)upstream.write(head);socket.pipe(upstream);upstream.pipe(socket)});upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());socket.on('close',()=>upstream.destroy())})
function launch(path:string,args:string[],stdin=false){const child=spawn(path,args,{cwd:directory,env,windowsHide:true,stdio:[stdin?'pipe':'ignore','pipe','pipe']});logs.set(child,'');child.on('error',error=>logs.set(child,String(error)));child.stderr?.on('data',chunk=>logs.set(child,(logs.get(child)+String(chunk)).slice(-64000)));if(!stdin)child.stdout?.on('data',chunk=>logs.set(child,(logs.get(child)+String(chunk)).slice(-64000)));return child}
async function wait(label:string,predicate:()=>boolean|Promise<boolean>,ms=45000){const end=performance.now()+ms;while(performance.now()<end){assert.ok(!server||intentionalServerStop||server.exitCode===null&&server.signalCode===null,logs.get(server!));if(await predicate())return;await new Promise(done=>setTimeout(done,100))}throw new Error(label)}
async function api(path:string,body?:object,headers:Record<string,string>={},status=200){const response=await fetch(`http://127.0.0.1:${backendPort}${path}`,{headers:{cookie:'rplayout_session='+token,...(body?{'content-type':'application/json'}:{}),...headers},...(body?{method:'POST',body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});const data=await response.json() as any;assert.equal(response.status,status,path+' '+JSON.stringify(data));return {data,etag:response.headers.get('etag')}}
const snapshot=async()=>{
  const value=(await api('/api/rundowns/rd')).data,state=value.live.transport
  if(priorityMode){
    if(state.onAir){
      assert.equal(lifecycle.programMayStart,true,'CUE must not TAKE')
      assert.ok(['vt','live-main'].includes(state.onAir.itemId),'Priority flow cannot select another item')
      assert.equal(state.playing,true)
      lifecycle.anyProgramSeen=true
      if(state.onAir.itemId==='live-main'){
        assert.ok(lifecycle.vtBefore,'Live must interrupt an actual running VT')
        assert.ok(!lifecycle.returnSeen,'Priority live cannot reenter after return')
        lifecycle.liveSeen=true
        if(lifecycle.liveOrigin!==undefined)assert.equal(state.onAir.startedAt,lifecycle.liveOrigin)
        lifecycle.liveOrigin??=state.onAir.startedAt
      }else if(lifecycle.liveSeen){assert.equal(lifecycle.resumeRequested,true,'VT cannot resume without reviewed operator action');lifecycle.returnSeen=true}
    }else assert.ok(!lifecycle.anyProgramSeen||lifecycle.stopRequested,'PGM cannot disappear during priority/return')
  }else if(programRecovery){
    if(state.onAir){
      assert.equal(lifecycle.programMayStart,true,'CUE must not TAKE')
      assert.equal(state.onAir.itemId,'live-main','Input loss must never advance to the next item')
      assert.equal(state.playing,true)
      if(lifecycle.programOrigin!==undefined)assert.equal(state.onAir.startedAt,lifecycle.programOrigin,'Input return must not restart PGM origin')
      if(lifecycle.lastProgramElapsed!==undefined)assert.ok(state.onAir.elapsed>=lifecycle.lastProgramElapsed,'Native PGM cursor must not rewind')
      lifecycle.programOrigin??=state.onAir.startedAt;lifecycle.lastProgramElapsed=state.onAir.elapsed;lifecycle.programSeen=true
    }else assert.ok(!lifecycle.programSeen,'Once confirmed, PGM cannot disappear during input loss')
  }else{assert.equal(state.onAir,null,'QC must never start service PGM');assert.equal(state.playing,false)}
  const row={at:Date.now(),onAir:state.onAir,playing:state.playing,preview:state.preview,liveSources:state.liveSources,monitors:value.monitors}
  const key=JSON.stringify(row.preview)+JSON.stringify(row.liveSources?.map((source:any)=>({source:source.source,state:source.state,busStates:source.busStates})))+(programRecovery||priorityMode?JSON.stringify(row.onAir):'')
  if(key!==lastSnapshot&&snapshots.length<(programRecovery||priorityMode?1000:100)){snapshots.push(row);lastSnapshot=key}return value
}
const mediaPath=async(path:string)=>{try{const response=await fetch(`http://127.0.0.1:9997/v3/paths/get/${path}`,{signal:AbortSignal.timeout(2000)});return response.ok?await response.json() as any:null}catch{return null}}
let lifecyclePhase='RUNNING'
type Sender={child:ChildProcess;kind:'NDI'|'OMT';purpose:'BASELINE'|'UPSTREAM_LOSS'|'RETURNED_INPUT';name:string;ready:boolean;state:any;signal:any;signalAt:number;publisher:any;errors:Array<{at:number;phase:string;message:string}>;notifications:Array<Record<string,unknown>>;acks:Map<number,any>;forcedStop:boolean;closed:boolean}
const senders:Sender[]=[],selectedSources:Array<{kind:string;reference:string;label:string;configuredId:string}>=[]
let commandId=0
async function send(sender:Sender,command:object){const id=++commandId;sender.child.stdin!.write(JSON.stringify({id,...command})+'\n');await wait('Sender ACK '+id,()=>sender.acks.has(id),30000);assert.equal(sender.acks.get(id).ok,true,JSON.stringify(sender.acks.get(id)))}
async function startSender(kind:'NDI'|'OMT',purpose:Sender['purpose']='BASELINE'){
  const suffix=purpose==='UPSTREAM_LOSS'?' loss-check':'',name=`RPlayout QC Çãó ${process.pid} ${kind}${suffix}`,child=launch(engine,['--channel-id','sender-'+kind.toLowerCase()+suffix.replace(' ','-'),'--width','640','--height','360','--fps-num','25','--fps-den','1','--bitrate','1000','--output',kind.toLowerCase()+':'+name],true)
  const sender:Sender={child,kind,purpose,name,ready:false,state:null,signal:null,signalAt:0,publisher:null,errors:[],notifications:[],acks:new Map(),forcedStop:false,closed:false};senders.push(sender)
  child.once('close',()=>{sender.closed=true})
  const decoder=new StringDecoder('utf8');let lines=''
  child.stdout?.on('data',chunk=>{lines+=decoder.write(chunk);let end:number;while((end=lines.indexOf('\n'))>=0){const line=lines.slice(0,end);lines=lines.slice(end+1);try{const event=JSON.parse(line),at=Date.now(),phase=lifecyclePhase;if(event.event==='ready')sender.ready=true;if(event.event==='ack')sender.acks.set(event.id,event);if(event.event==='state')sender.state=event;if(event.event==='publisher')sender.publisher=event;if(event.event==='sourceTelemetry'&&event.bus==='pgm'){sender.signal=event.signal;sender.signalAt=at}if(event.event==='error'||event.event==='itemError')sender.errors.push({at,phase,message:event.message});if(['sourceLost','sourceReady','itemError','error','state'].includes(event.event)&&sender.notifications.length<100)sender.notifications.push({at,phase,...event})}catch{logs.set(child,(logs.get(child)+line).slice(-64000))}}})
  await wait(kind+' sender ready',()=>sender.ready)
  await send(sender,{cmd:'load',item:{itemId:'carrier',source:'rtsp://127.0.0.1:8554/guest/qc-native-feed',trimIn:0,trimOut:0,gainDb:0}})
  await send(sender,{cmd:'take'})
  await wait(kind+' sender actually decoded carrier',()=>sender.state?.onAir==='carrier'&&sender.signal?.videoPresent&&sender.signal?.audioPresent&&Date.now()-sender.signalAt<2000)
  return sender
}
async function stopSender(sender:Sender){
  if(sender.closed)return
  const drained=new Promise<void>(done=>sender.child.once('close',()=>done()))
  if(sender.child.exitCode===null&&sender.child.signalCode===null)sender.child.stdin!.write(JSON.stringify({id:900,cmd:'shutdown'})+'\n')
  const timer=setTimeout(()=>{if(sender.child.exitCode===null&&sender.child.signalCode===null){sender.forcedStop=true;sender.child.kill()}},6000)
  await drained;clearTimeout(timer)
}
async function collectNative(){for(const row of (await api('/api/processes')).data.processes??[])if(Number.isSafeInteger(row.pid)&&row.pid!==server?.pid)ownedNative.add(row.pid)}
function startCarrier(pattern='smpte',frequency=997){return launch(join(gstBin,'gst-launch-1.0.exe'),['-q','mpegtsmux','name=m','alignment=7','latency=500000000','!','srtsink','uri=srt://127.0.0.1:8890?streamid=publish:guest/qc-native-feed','videotestsrc','is-live=true',`pattern=${pattern}`,'!','video/x-raw,format=I420,width=640,height=360,framerate=25/1','!','x264enc','threads=2','speed-preset=ultrafast','tune=zerolatency','bitrate=1500','key-int-max=25','!','h264parse','!','queue','!','m.','audiotestsrc','is-live=true',`freq=${frequency}`,'volume=0.05','!','audio/x-raw,rate=48000,channels=2','!','audioconvert','!','avenc_aac','!','aacparse','!','queue','!','m.'])}
async function seedPriority(){
  const file=join(media,'VT — ação Çãó.mkv'),frames=priorityNoSignal?3000:2250,audioBuffers=Math.ceil(frames/25*48000/1024)
  await promisify(execFile)(join(gstBin,'gst-launch-1.0.exe'),['-q','matroskamux','name=m','!','filesink',`location=${file.replaceAll('\\','/')}`,
    'videotestsrc',`num-buffers=${frames}`,'pattern=ball','!','video/x-raw,width=320,height=180,framerate=25/1','!','videoconvert','!','vp8enc','deadline=1','threads=2','!','queue','!','m.',
    'audiotestsrc',`num-buffers=${audioBuffers}`,'samplesperbuffer=1024','freq=440','volume=0.05','!','audio/x-raw,rate=48000,channels=2','!','audioconvert','!','vorbisenc','!','queue','!','m.'],{env,windowsHide:true,timeout:60000})
  const hash=await sha(file),instant=new Date(),midnight=new Date(instant);midnight.setHours(0,0,0,0)
  const start=Math.floor((instant.getTime()-midnight.getTime())/40),anchor=start+1125
  const date=`${instant.getFullYear()}-${String(instant.getMonth()+1).padStart(2,'0')}-${String(instant.getDate()).padStart(2,'0')}`
  database.sqlite.prepare('UPDATE rundowns SET date=?,planned_start=? WHERE id=?').run(date,start,'rd')
  database.db.insert(mediaAssets).values({id:'vt-asset',title:`VT original ${frames/25} s`,path:file,contentHash:hash,kind:'VIDEO',durationFrames:frames,durationNs:frames*40_000_000,width:320,height:180,rateNum:25,rateDen:1,hasAudio:true,interlaceMode:'progressive',qcStatus:'APPROVED',createdAt:stamp}).run()
  database.db.insert(rundownItems).values({id:'vt',rundownId:'rd',sortOrder:0,title:'Published VT',type:'VT',mediaId:'vt-asset',minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',autoNext:false,loop:false,locked:false}).run()
  database.db.insert(rundownItems).values({id:'live-main',rundownId:'rd',sortOrder:1,title:selectedSources[0].label,type:'LIVE',sourceRef:selectedSources[0].reference,configuredSourceId:selectedSources[0].configuredId,durationOverride:25000,liveAutoFollowOnEnd:false,minDuration:0,anchor:{kind:'HARD_TIME',at:anchor},onOverrun:'PUSH',autoNext:false,loop:false,locked:false}).run()
  lifecycle.fixtureMedia={file,hash,frames,rate:25};lifecycle.anchor=anchor;lifecycle.scheduledAt=midnight.getTime()+anchor*40
}
async function runPriority(){
  lifecycle.kind=selectedSources[0].kind;lifecycle.startedAt=Date.now();lifecycle.cueRequests=0;lifecycle.takeRequests=0
  const revision=()=>database.db.select().from(operationalPlaylistRevisions).all().find(row=>row.id===lifecycle.publicationId)!
  const capture=async(label:string,expectedHz:number)=>{
    const value=await snapshot(),path=value.monitors.program
    await wait('Actual PGM monitor must advertise both H264 and Opus before opening finite readers',async()=>{
      const publication=await mediaPath(path)
      if(!publication?.ready||!publication.tracks?.includes('H264')||!publication.tracks?.includes('Opus'))return false
      lifecycle.monitorPublications??=[];lifecycle.monitorPublications.push({label,at:Date.now(),ready:publication.ready,tracks:publication.tracks,bytesReceived:publication.bytesReceived});return true
    })
    const outcomes=await Promise.allSettled([verifyPublishedPicture({gstBin,directory,path,width:428,height:240,environment:env,label,videoOnly:true}),verifyPublishedAudio({gstBin,directory,path,environment:env,label,expectedHz})])
    lifecycle.captureAttempts??=[];lifecycle.captureAttempts.push({label,at:Date.now(),outcomes:outcomes.map((row,index)=>({kind:index===0?'PICTURE':'AUDIO',result:row.status,error:row.status==='rejected'?String(row.reason):null}))})
    for(const row of outcomes)if(row.status==='rejected')throw row.reason
    const [picture,audio]=outcomes.map(row=>(row as PromiseFulfilledResult<any>).value)
    const after=(await snapshot()).live.transport.onAir
    assert.equal(after?.itemId,value.live.transport.onAir?.itemId,'A capture cannot straddle the priority switch')
    assert.equal(after?.startedAt,value.live.transport.onAir?.startedAt)
    const row={label,bus:'pgm',onAir:value.live.transport.onAir,picture,audio,at:Date.now()};captures.push(row);return row
  }
  lifecycle.heartbeatFailures=[];let heartbeatBusy=false
  const heartbeat=setInterval(()=>{if(heartbeatBusy)return;heartbeatBusy=true;void api('/api/channels/qa/watching',{bus:'mon'}).catch(error=>lifecycle.heartbeatFailures.push({at:Date.now(),error:String(error)})).finally(()=>{heartbeatBusy=false})},5000)
  try{
    const review=(await api('/api/rundowns/rd/operational-simulation')).data
    lifecycle.simulation=review.simulated
    assert.ok(review.simulated.schedule.conflicts.some((row:any)=>row.kind==='OVERRUN'&&row.frames>0),'Grade must expose the real overrun before priority live')
    const published=(await api('/api/rundowns/rd/operational-publish',{reviewToken:review.review.token},{'if-match':`w/"${review.review.editorialRevision}"`},201)).data
    lifecycle.publicationId=published.id;lifecycle.frozenRevision=revision().payload
    await api('/api/channels/qa/watching',{bus:'mon'})
    await api('/api/channels/qa/transport',{action:'cue',itemId:'vt'});lifecycle.cueRequests++
    const cued=await snapshot();assert.equal(cued.live.transport.onAir,null)
    lifecycle.programMayStart=true
    await api('/api/channels/qa/transport',{action:'take'});lifecycle.takeRequests++
    await wait('VT must run before the hard-time live',async()=>{const value=await snapshot();if(value.live.transport.onAir?.itemId!=='vt')return false;lifecycle.vtBefore=value.live.transport.onAir;return true})
    assert.equal(lifecycle.vtBefore.mountedDuration,lifecycle.fixtureMedia.frames,'Priority must interrupt an unfinished mounted VT, not a pretrimmed surrogate')
    lifecycle.vtCapture=await capture('priority-vt-before',440)
    if(priorityNoSignal){
      lifecycle.scenario='NO_SIGNAL_AT_ANCHOR';lifecycle.senderStoppedAt=Date.now()
      await stopSender(senders[0]!)
      const decisions=()=>database.sqlite.prepare('SELECT kind,payload FROM operator_decisions WHERE kind LIKE ? ORDER BY created_at').all('LIVE_PRIORITY_%') as Array<{kind:string;payload:unknown}>
      await wait('Absent priority input must fail while preserving VT',async()=>{
        const value=await snapshot();assert.equal(value.live.transport.onAir?.itemId,'vt')
        return decisions().some(row=>row.kind==='LIVE_PRIORITY_FAILED')
      },65000)
      assert.ok(Date.now()>lifecycle.scheduledAt)
      lifecycle.priorityDecisions=decisions();lifecycle.noSignalObservedAt=Date.now()
      lifecycle.noSignalCapture=await capture('priority-no-signal-vt',440)
      assert.ok(lifecycle.noSignalCapture.onAir.elapsed>lifecycle.anchor-lifecycle.vtBefore.startedAt,'Native VT must pass the planned cut with real pixels/PCM')
      assert.deepEqual((await api('/api/channels/qa/interruptions')).data.items,[])
      lifecycle.asRunNoSignal=(await api('/api/channels/qa/asrun')).data.entries
      assert.equal(lifecycle.asRunNoSignal.length,1);assert.equal(lifecycle.asRunNoSignal[0].endedAt,null)
      const returned=await startSender(selectedSources[0].kind as 'NDI'|'OMT');lifecycle.senderReturnedAt=Date.now()
      assert.equal(returned.name,senders[0]!.name)
      await wait('Returned source must be genuinely announced again',async()=>{
        const value=(await api('/api/sources?refresh=1&channelId=qa')).data
        return value[lifecycle.kind.toLowerCase()]?.sources.some((row:any)=>row.discovery==='DISCOVERED'&&row.reference===selectedSources[0].reference)
      },15000)
      const until=performance.now()+5000
      while(performance.now()<until){assert.equal((await snapshot()).live.transport.onAir?.itemId,'vt');await new Promise(done=>setTimeout(done,100))}
      lifecycle.afterReturnCapture=await capture('priority-no-late-take-vt',440)
      assert.equal(lifecycle.afterReturnCapture.onAir.startedAt,lifecycle.vtBefore.startedAt)
      assert.deepEqual(revision().payload,lifecycle.frozenRevision)
      assert.deepEqual((await api('/api/channels/qa/interruptions')).data.items,[])
      lifecycle.priorityDecisionsAfter=decisions();assert.ok(!decisions().some(row=>row.kind==='LIVE_PRIORITY_CONFIRMED'))
      lifecycle.stopRequested=true;await api('/api/channels/qa/transport',{action:'stop'})
      await wait('Explicit STOP after missing-source guard',async()=>(await snapshot()).live.transport.onAir===null)
      lifecycle.asRunFinal=(await api('/api/channels/qa/asrun')).data.entries
      assert.equal(lifecycle.asRunFinal.length,1);assert.ok(lifecycle.asRunFinal[0].endedAt)
      assert.equal(lifecycle.asRunFinal[0].endedBy,'STOP','Fixture must remain running until explicit STOP, not silently reach EOS during capture')
      assert.equal(lifecycle.asRunFinal[0].executionKind,'NATIVE')
      assert.deepEqual(lifecycle.heartbeatFailures,[])
      for(const sender of senders)assert.deepEqual(sender.errors,[])
      lifecycle.result='PASS';console.log(JSON.stringify({status:'NETWORK_PRIORITY_NO_SIGNAL_PASS',kind:lifecycle.kind,asRunRows:1}));return
    }
    lifecycle.scenario='CUT_AND_REVIEWED_RESUME'
    await wait('Hard-time network live must interrupt automatically, without operator TAKE',async()=>{const value=await snapshot();return value.live.transport.onAir?.itemId==='live-main'},60000)
    await wait('Priority network live must deliver fresh video and audio',async()=>{const value=await snapshot();return value.live.transport.liveSources.some((row:any)=>row.source===selectedSources[0].reference&&row.busItemIds?.pgm==='live-main'&&row.busSignals?.pgm?.videoRecent&&row.busSignals?.pgm?.audioRecent)})
    lifecycle.liveConfirmedAt=Date.now();const live=await snapshot();lifecycle.liveBefore=live.live.transport.onAir
    lifecycle.liveSignal=live.live.transport.liveSources.find((row:any)=>row.source===selectedSources[0].reference)
    assert.equal(lifecycle.liveSignal.nativeCatalogBindings.pgm,selectedSources[0].configuredId,'Actual selected decoder must confirm the configured network input')
    const pending=(await api('/api/channels/qa/interruptions')).data
    const interruption=pending.items.find((row:any)=>row.item_id==='vt');assert.ok(interruption)
    lifecycle.interruption=interruption
    assert.ok(interruption.frames>0&&interruption.frames<lifecycle.fixtureMedia.frames);assert.equal(interruption.revision_id,lifecycle.publicationId)
    lifecycle.asRunCut=(await api('/api/channels/qa/asrun')).data.entries
    const exit=lifecycle.asRunCut.find((row:any)=>row.itemId==='vt'&&row.endedBy==='LIVE_PRIORITY');assert.ok(exit)
    assert.equal(exit.executionKind,'NATIVE');assert.equal(exit.durationEvidence,'ENGINE_POSITION');assert.equal(exit.endPositionFrames,interruption.frames);assert.equal(exit.mediaHash,lifecycle.fixtureMedia.hash);assert.equal(exit.revisionId,lifecycle.publicationId)
    console.log(JSON.stringify({status:'NETWORK_PRIORITY_CUT',kind:lifecycle.kind,cursor:interruption.frames,revision:lifecycle.publicationId}))
    lifecycle.liveCapture=await capture('priority-live',997)
    assert.ok(Math.abs(lifecycle.liveCapture.picture.mean-lifecycle.vtCapture.picture.mean)>30,'Live must contain different real pixels from the interrupted VT')
    const current=await snapshot();assert.ok(current.executionView.items.some((row:any)=>row.item.id==='live-main'))
    const reviewed=(await api('/api/channels/qa/interruptions')).data.items.find((row:any)=>row.id===interruption.id);assert.ok(reviewed?.reviewToken)
    lifecycle.resumeRequested=true;lifecycle.resumeRequest={action:'RESUME',requestId:randomUUID(),reviewToken:reviewed.reviewToken}
    lifecycle.resume=(await api(`/api/channels/qa/interruptions/${interruption.id}`,lifecycle.resumeRequest)).data;assert.equal(lifecycle.resume.ok,true)
    await wait('Reviewed VT resume must return to PGM',async()=>(await snapshot()).live.transport.onAir?.itemId==='vt')
    lifecycle.asRunReturn=(await api('/api/channels/qa/asrun')).data.entries
    const resumed=lifecycle.asRunReturn.find((row:any)=>row.itemId==='vt'&&row.startPositionFrames===interruption.frames&&row.endedAt===null);assert.ok(resumed)
    assert.equal(resumed.executionKind,'NATIVE');assert.equal(resumed.revisionId,lifecycle.publicationId);assert.equal(resumed.mediaHash,lifecycle.fixtureMedia.hash)
    lifecycle.returnCapture=await capture('priority-vt-return',440)
    assert.deepEqual((await api('/api/channels/qa/interruptions')).data.items,[])
    assert.deepEqual(revision().payload,lifecycle.frozenRevision)
    assert.equal(lifecycle.takeRequests,1);assert.equal(lifecycle.cueRequests,1)
    lifecycle.stopRequested=true;await api('/api/channels/qa/transport',{action:'stop'})
    await wait('Explicit STOP must clear PGM',async()=>(await snapshot()).live.transport.onAir===null)
    lifecycle.asRunFinal=(await api('/api/channels/qa/asrun')).data.entries
    assert.equal(lifecycle.asRunFinal.length,3);assert.ok(lifecycle.asRunFinal.every((row:any)=>row.endedAt&&row.executionKind==='NATIVE'))
    assert.deepEqual(lifecycle.heartbeatFailures,[]);assert.deepEqual(senders[0].errors,[])
    lifecycle.result='PASS';console.log(JSON.stringify({status:'NETWORK_PRIORITY_RESUME_PASS',kind:lifecycle.kind,cursor:interruption.frames,asRunRows:3}))
  }finally{clearInterval(heartbeat)}
}
async function runInputRecovery(){
  assert.equal(sourceWebOverride,false);assert.equal(devicesOverride,false)
  assert.equal(selectedSources.length,1)
  const source=selectedSources[0],original=senders[0]
  const bus=programRecovery?'pgm':'pvw',monitorBus=programRecovery?'mon':'pvw'
  lifecycle.kind=source.kind;lifecycle.bus=bus;lifecycle.startedAt=Date.now();lifecycle.cueRequests=0;lifecycle.takeRequests=0
  const selected=(value:any)=>value.live.transport.liveSources.find((row:any)=>row.source===source.reference)
  const healthy=(value:any)=>{const row=selected(value);return row?.busStates?.[bus]===(programRecovery?'ON_PGM':'PVW_READY')&&row.busSignals?.[bus]?.videoRecent&&row.busSignals?.[bus]?.audioRecent}
  const receiver=async()=>{const rows=(await api('/api/processes')).data.processes;const row=rows.find((row:any)=>row.kind==='ENGINE'&&row.channelId==='qa');assert.ok(Number.isSafeInteger(row?.pid)&&row.pid>0);return row}
  const capture=async(label:string,expectedHz:number)=>{
    const current=await snapshot();assert.ok(healthy(current),'Capture must have current decoded video and audio')
    const path=programRecovery?current.monitors.program:current.monitors.preview
    const outcomes=await Promise.allSettled([
      verifyPublishedPicture({gstBin,directory,path,width:428,height:240,environment:env,label,videoOnly:true}),
      verifyPublishedAudio({gstBin,directory,path,environment:env,label,expectedHz}),
    ])
    lifecycle.captureAttempts??=[]
    lifecycle.captureAttempts.push({label,at:Date.now(),outcomes:outcomes.map((outcome,index)=>({kind:index===0?'PICTURE':'AUDIO',result:outcome.status,error:outcome.status==='rejected'?String(outcome.reason):null}))})
    for(const outcome of outcomes)if(outcome.status==='rejected')throw outcome.reason
    const [picture,audio]=outcomes.map(outcome=>(outcome as PromiseFulfilledResult<any>).value)
    const row={label,phase:lifecyclePhase,bus,preview:current.live.transport.preview,onAir:current.live.transport.onAir,picture,audio,at:Date.now()};captures.push(row);return row
  }
  let heartbeatBusy=false
  lifecycle.heartbeatFailures=[];lifecycle.pollFailures=[];lifecycle.returnObservations=[]
  const heartbeat=setInterval(()=>{
    if(heartbeatBusy)return
    heartbeatBusy=true
    void api('/api/channels/qa/watching',{bus:monitorBus}).catch(error=>{if(lifecycle.heartbeatFailures.length<20)lifecycle.heartbeatFailures.push({at:Date.now(),phase:lifecyclePhase,error:String(error)})}).finally(()=>{heartbeatBusy=false})
  },5000)
  try{
    if(programRecovery){
      const review=(await api('/api/rundowns/rd/operational-simulation')).data.review
      const published=(await api('/api/rundowns/rd/operational-publish',{reviewToken:review.token},{'if-match':`w/"${review.editorialRevision}"`},201)).data
      lifecycle.published=published
    }
    await api('/api/channels/qa/transport',programRecovery?{action:'cue',itemId:'live-main'}:{action:'cue',sourceRef:source.reference,sourceTitle:source.label});lifecycle.cueRequests++
    await api('/api/channels/qa/watching',{bus:monitorBus})
    if(programRecovery){
      await wait('CUE must really receive picture/audio before TAKE',async()=>{const current=await snapshot(),row=selected(current);return row?.busStates?.pvw==='PVW_READY'&&row.busSignals?.pvw?.videoRecent&&row.busSignals?.pvw?.audioRecent})
      lifecycle.cuedBeforeTake=(await snapshot()).live.transport
      assert.equal(lifecycle.cuedBeforeTake.onAir,null)
      lifecycle.programMayStart=true
      await api('/api/channels/qa/transport',{action:'take'});lifecycle.takeRequests++
    }
    await wait('Initial native input video/audio',async()=>healthy(await snapshot()))
    const before=await snapshot();lifecycle.receiverBefore=await receiver();lifecycle.selectionBefore=before.live.transport.preview;lifecycle.decoderBefore=before.live.transport.previewFrame
    const initial=await capture(source.kind.toLowerCase()+'-before-loss',997)
    lifecycle.beforeLoss={at:Date.now(),signal:selected(await snapshot()),capture:initial,onAir:(await snapshot()).live.transport.onAir}
    if(programRecovery){lifecycle.asRunBefore=(await api('/api/channels/qa/asrun')).data.entries;assert.equal(lifecycle.asRunBefore.length,1);assert.equal(lifecycle.asRunBefore[0].itemId,'live-main');assert.equal(lifecycle.asRunBefore[0].endedAt,null)}
    lifecyclePhase='EXPECTED_INPUT_LOSS';lifecycle.lossStartedAt=Date.now()
    await stopSender(original);assert.equal(original.child.exitCode,0);assert.equal(original.forcedStop,false);assert.deepEqual(original.errors,[])
    await wait('Source absence must be visible, never a retained frame marked SIGNAL_OK',async()=>{const current=await snapshot(),row=selected(current);return !row?.busSignals?.[bus]?.videoRecent&&['LOST','FAILED'].includes(row?.busStates?.[bus])},20000)
    const missing=await snapshot();lifecycle.lossObserved={at:Date.now(),signal:selected(missing),preview:missing.live.transport.preview,onAir:missing.live.transport.onAir,decoder:missing.live.transport.previewFrame,receiver:await receiver()}
    assert.equal(lifecycle.lossObserved.receiver.pid,lifecycle.receiverBefore.pid)
    console.log(JSON.stringify({status:'INPUT_LOSS_OBSERVED',kind:source.kind,bus,state:lifecycle.lossObserved.signal?.busStates?.[bus],receiverPid:lifecycle.receiverBefore.pid}))
    if(programRecovery){
      const value=await snapshot(),started=performance.now(),initial=value.live.transport.onAir
      let final=value
      await wait('Observe PGM occurrence clock while native source stays absent',async()=>{
        final=await snapshot();const signal=selected(final)
        assert.equal(signal.busSignals.pgm.videoRecent,false)
        assert.equal(signal.measurements.pgm.receivedFrames,selected(value).measurements.pgm.receivedFrames)
        return performance.now()-started>=3000
      },10000)
      const elapsedMs=performance.now()-started,frames=final.live.transport.onAir.elapsed-initial.elapsed
      lifecycle.lossClock={elapsedMs,frames,expectedFrames:elapsedMs/40,before:initial,after:final.live.transport.onAir}
      assert.ok(Math.abs(frames-elapsedMs/40)<=10,'Live PGM time must track monotonic time through loss, not the last source PTS: '+JSON.stringify(lifecycle.lossClock))
    }
    if(expireRetake){
      lifecycle.expiringTake={requestedAt:Date.now(),itemId:'live-main',observations:[]}
      lifecycle.expiringTake.response=(await api('/api/channels/qa/transport',{action:'take',itemId:'live-main'})).data;lifecycle.takeRequests++
      await wait('Native expired retake must be cancelled while previous PGM remains selected',async()=>{
        const value=await snapshot(),diagnostic=value.live.alerts.find((row:any)=>row.kind==='ENGINE'&&row.message.includes('10 segundos'))
        lifecycle.expiringTake.observations.push({at:Date.now(),prepared:value.live.transport.preparedItemId,preparing:value.live.transport.preparingItemId,onAir:value.live.transport.onAir,alerts:value.live.alerts})
        if(lifecycle.expiringTake.observations.length>80)lifecycle.expiringTake.observations.shift()
        if(value.live.transport.preparedItemId==='live-main'||!diagnostic)return false
        lifecycle.expiringTake.cancelledAt=Date.now();lifecycle.expiringTake.diagnostic=diagnostic.message;lifecycle.expiringTake.onAir=value.live.transport.onAir
        return true
      },25000)
      const delay=lifecycle.expiringTake.cancelledAt-lifecycle.expiringTake.requestedAt
      assert.ok(delay>=9000&&delay<=25000,'Bounded native deadline, not a synthetic ItemError')
      console.log(JSON.stringify({status:'NATIVE_RETAKE_EXPIRED',kind:source.kind,elapsedMs:delay,onAir:lifecycle.expiringTake.onAir}))
    }
    // Change the actual test carrier, not its metadata. The returning publisher
    // has the SAME advertised name, but new pixels/audio and its own new PID.
    const oldCarrier=carrier!;const ended=new Promise<void>(done=>oldCarrier.once('close',()=>done()));oldCarrier.kill();await ended
    await wait('Old synthetic carrier no longer published',async()=>!(await mediaPath('guest/qc-native-feed'))?.ready)
    carrier=startCarrier('ball',1511)
    await wait('New test carrier ready',async()=>Boolean((await mediaPath('guest/qc-native-feed'))?.ready))
    lifecyclePhase='INPUT_RETURN';lifecycle.returnStartedAt=Date.now()
    const returned=await startSender(source.kind as 'NDI'|'OMT','RETURNED_INPUT');assert.equal(returned.name,original.name)
    lifecycle.senderReturn={oldPid:original.child.pid,newPid:returned.child.pid,name:returned.name,at:Date.now()}
    await wait('Native input must automatically recover without a second CUE',async()=>{
      const started=Date.now()
      try{
        const value=await snapshot(),row=selected(value)
        if(lifecycle.returnObservations.length<100)lifecycle.returnObservations.push({at:Date.now(),elapsedMs:Date.now()-started,state:row?.busStates?.[bus],signal:row?.busSignals?.[bus],measurement:row?.measurements?.[bus],onAir:value.live.transport.onAir,previewFrame:value.live.transport.previewFrame})
        return healthy(value)
      }catch(error){
        const failure:Record<string,unknown>={at:Date.now(),elapsedMs:Date.now()-started,error:String(error)}
        try{const health=await fetch(`http://127.0.0.1:${backendPort}/api/health`,{signal:AbortSignal.timeout(3000)});failure.healthStatus=health.status;failure.healthBody=await health.json()}catch(healthError){failure.healthError=String(healthError)}
        lifecycle.pollFailures.push(failure)
        await writeFile(join(directory,'recovery-read-diagnostic.json'),JSON.stringify({lifecycle,serverExitCode:server?.exitCode,serverLog:server?logs.get(server):null},null,2))
        console.log(JSON.stringify({status:'INPUT_RETURN_READ_FAILED',kind:source.kind,...failure}))
        return false
      }
    },45000)
    const recovered=await snapshot();lifecycle.receiverAfter=await receiver();lifecycle.decoderAfter=recovered.live.transport.previewFrame;lifecycle.selectionAfter=recovered.live.transport.preview
    assert.equal(lifecycle.receiverAfter.pid,lifecycle.receiverBefore.pid,'Channel engine must not restart')
    assert.equal(lifecycle.receiverAfter.details.restarts,lifecycle.receiverBefore.details.restarts)
    assert.equal(lifecycle.receiverAfter.details.deaths,lifecycle.receiverBefore.details.deaths)
    assert.deepEqual(lifecycle.selectionAfter,lifecycle.selectionBefore,'Input recovery must preserve the selected source')
    assert.equal(lifecycle.cueRequests,1)
    const final=await capture(source.kind.toLowerCase()+'-after-return',1511)
    assert.ok(Math.abs(final.picture.mean-initial.picture.mean)>30,'Returned picture must be the new carrier, not retained color bars')
    assert.deepEqual(returned.errors,[])
    assert.deepEqual(lifecycle.heartbeatFailures,[]);assert.deepEqual(lifecycle.pollFailures,[])
    if(programRecovery){
      const current=await snapshot();lifecycle.onAirAfter=current.live.transport.onAir
      assert.ok(lifecycle.onAirAfter.elapsed>lifecycle.beforeLoss.onAir.elapsed)
      lifecycle.asRunAfter=(await api('/api/channels/qa/asrun')).data.entries
      assert.equal(lifecycle.asRunAfter.length,1);assert.equal(lifecycle.asRunAfter[0].id,lifecycle.asRunBefore[0].id);assert.equal(lifecycle.asRunAfter[0].endedAt,null)
      assert.equal(lifecycle.takeRequests,expireRetake?2:1)
    }
    lifecycle.recoveredAt=Date.now();lifecycle.recoveredSignal=selected(await snapshot());lifecycle.automaticRecovery=true;lifecycle.result='PASS'
    console.log(JSON.stringify({status:'INPUT_RECOVERY_PASS',kind:source.kind,receiverPid:lifecycle.receiverAfter.pid,means:[initial.picture.mean,final.picture.mean],tones:[initial.audio.frequencyHz,final.audio.frequencyHz]}))
  }finally{clearInterval(heartbeat)}
}
async function runQcAudioOverlap(){
  let activeSource:string|null=null,busy=false
  const viewerId=randomUUID();lifecycle.heartbeatFailures=[];lifecycle.sources=[]
  const heartbeat=setInterval(()=>{if(busy)return;busy=true;void(async()=>{
    await api('/api/channels/qa/watching',{bus:'pvw'})
    if(activeSource)await api('/api/channels/qa/qc/inspection',{viewerId,sourceRef:activeSource,watching:true})
  })().catch(error=>lifecycle.heartbeatFailures.push(String(error))).finally(()=>{busy=false})},5000)
  const ready=async(path:string)=>{const value=await mediaPath(path);return Boolean(value?.ready&&value.tracks?.includes('H264')&&value.tracks?.includes('Opus'))}
  const capture=async(label:string,path:string,width:number,height:number)=>{
    const before=await snapshot(),outcomes=await Promise.allSettled([
      verifyPublishedPicture({gstBin,directory,path,width,height,environment:env,label,videoOnly:true}),
      verifyPublishedAudio({gstBin,directory,path,environment:env,label,expectedHz:997}),
    ])
    lifecycle.captureAttempts??=[];lifecycle.captureAttempts.push({label,outcomes:outcomes.map((row,index)=>({kind:index?'AUDIO':'PICTURE',result:row.status,error:row.status==='rejected'?String(row.reason):null}))})
    for(const row of outcomes)if(row.status==='rejected')throw row.reason
    const [picture,audio]=outcomes.map(row=>(row as PromiseFulfilledResult<any>).value),after=await snapshot()
    assert.equal(after.live.transport.previewFrame?.decoderId,before.live.transport.previewFrame?.decoderId)
    const row={label,preview:before.live.transport.preview,decoder:before.live.transport.previewFrame,picture,audio,at:Date.now()};captures.push(row);return row
  }
  try{
    for(const source of selectedSources){
      await api('/api/channels/qa/transport',{action:'cue',sourceRef:source.reference,sourceTitle:source.label})
      await api('/api/channels/qa/watching',{bus:'pvw'})
      await wait('Native QC source ready',async()=>{const value=await snapshot();return value.live.transport.liveSources.some((row:any)=>row.source===source.reference&&row.busSignals?.pvw?.videoRecent&&row.busSignals?.pvw?.audioRecent)})
      const before=await snapshot(),decoder=before.live.transport.previewFrame;assert.ok(decoder?.decoderId)
      const signal=before.live.transport.liveSources.find((row:any)=>row.source===source.reference)
      // QC's ad-hoc CUE carries a reference, not a catalog ID. Prove the
      // actual preview opening; never invent a configured-ID echo here.
      assert.equal(before.live.transport.preview.source,source.reference)
      assert.equal(signal.busItemIds.pvw,decoder.itemId)
      await wait('PVW media ready',()=>ready(before.monitors.preview))
      await capture(source.kind.toLowerCase()+'-baseline',before.monitors.preview,428,240)
      await api('/api/channels/qa/qc/inspection',{viewerId,sourceRef:source.reference,watching:true});activeSource=source.reference
      await wait('PVW and HQ must both publish',async()=>await ready(before.monitors.preview)&&await ready(before.monitors.inspection))
      const overlapPaths={preview:await mediaPath(before.monitors.preview),inspection:await mediaPath(before.monitors.inspection)}
      const results=await Promise.allSettled([
        capture(source.kind.toLowerCase()+'-overlap-preview',before.monitors.preview,428,240),
        capture(source.kind.toLowerCase()+'-overlap-quality',before.monitors.inspection,signal.measurements.pvw.width,signal.measurements.pvw.height),
      ])
      for(const row of results)if(row.status==='rejected')throw row.reason
      activeSource=null;while(busy)await new Promise(done=>setTimeout(done,50))
      await api('/api/channels/qa/qc/inspection',{viewerId,sourceRef:source.reference,watching:false})
      await wait('HQ must stop after lease release',async()=>!(await mediaPath(before.monitors.inspection))?.ready)
      const after=await snapshot();assert.equal(after.live.transport.previewFrame?.decoderId,decoder.decoderId)
      lifecycle.sources.push({source,decoderBefore:decoder,decoderAfter:after.live.transport.previewFrame,overlapPaths,inspectionAfter:await mediaPath(before.monitors.inspection)})
      console.log(JSON.stringify({status:'QC_SIMULTANEOUS_AUDIO_PASS',kind:source.kind,decoderId:decoder.decoderId}))
    }
    assert.deepEqual(lifecycle.heartbeatFailures,[]);lifecycle.result='PASS'
  }finally{activeSource=null;clearInterval(heartbeat);while(busy)await new Promise(done=>setTimeout(done,50))}
}
async function runLifecycle(){
  assert.equal(sourceWebOverride,false);assert.equal(devicesOverride,false)
  assert.equal(hashes.web,'cd7665dea5b70b1b9cba4d9fb9af667085869e22f67c868b3105eaced818c173','Installed r71 web required')
  const web=await fetch(`http://127.0.0.1:${backendPort}${webAsset}`,{signal:AbortSignal.timeout(10000)});assert.equal(web.status,200)
  lifecycle.servedWebSha=createHash('sha256').update(new Uint8Array(await web.arrayBuffer())).digest('hex');assert.equal(lifecycle.servedWebSha,hashes.web)
  lifecycle.startedAt=Date.now()
  const heartbeat=setInterval(()=>{void api('/api/channels/qa/watching',{bus:'pvw'}).catch(()=>{})},5000)
  try{
    for(const source of selectedSources){
      await api('/api/channels/qa/transport',{action:'cue',sourceRef:source.reference,sourceTitle:source.label})
      await api('/api/channels/qa/watching',{bus:'pvw'})
      await wait('Actual '+source.kind+' QC preview video/audio',async()=>{const current=await snapshot();return current.live.transport.liveSources.some((row:any)=>row.source===source.reference&&row.busStates?.pvw==='PVW_READY'&&row.measurements?.pvw?.videoPresent&&row.measurements?.pvw?.audioPresent)})
      const current=await snapshot(),label=source.kind.toLowerCase()+'-lifecycle'
      const picture=await verifyPublishedPicture({gstBin,directory,path:current.monitors.preview,width:428,height:240,environment:env,label})
      captures.push({label,phase:'INSTALLED_NATIVE_LIFECYCLE',preview:current.live.transport.preview,picture,at:Date.now()})
      console.log(JSON.stringify({status:'LIFECYCLE_PICTURE',kind:source.kind,picture}))
    }
    await api('/api/channels/qa/transport',{action:'cue'})
    await snapshot()
  }finally{clearInterval(heartbeat)}
  const baseline=senders.filter(sender=>sender.purpose==='BASELINE')
  for(const sender of baseline){assert.deepEqual(sender.errors,[]);assert.ok(sender.signal?.videoPresent&&sender.signal?.audioPresent&&Date.now()-sender.signalAt<2000)}
  lifecycle.beforeOrderedShutdown=JSON.parse(JSON.stringify(baseline.map(({kind,signal,signalAt,errors})=>({kind,signal,signalAt,errors}))))
  lifecycle.orderedShutdownStartedAt=Date.now();lifecyclePhase='ORDERED_SHUTDOWN'
  for(const sender of baseline)await stopSender(sender)
  for(const sender of baseline){assert.equal(sender.child.exitCode,0);assert.equal(sender.forcedStop,false);assert.deepEqual(sender.errors,[])}
  assert.ok((await mediaPath('guest/qc-native-feed'))?.ready,'Upstream must remain available until senders exit')
  lifecycle.orderedShutdown={finishedAt:Date.now(),upstreamStillReady:true,senders:baseline.map(sender=>({kind:sender.kind,exitCode:sender.child.exitCode,closed:sender.closed,errors:sender.errors}))}
  console.log(JSON.stringify({status:'ORDERED_SENDER_SHUTDOWN_PASS',senders:2,upstreamStillReady:true}))
  lifecyclePhase='LOSS_PROBE_SETUP'
  const probe=await startSender('OMT','UPSTREAM_LOSS');assert.deepEqual(probe.errors,[])
  lifecycle.beforeInjectedLoss={at:Date.now(),signal:probe.signal,signalAt:probe.signalAt,onAir:probe.state?.onAir}
  await collectNative()
  lifecycle.injectedLossAt=Date.now();lifecyclePhase='EXPECTED_UPSTREAM_LOSS';intentionalServerStop=true
  const owner=server!;const exited=new Promise<void>(done=>owner.once('exit',()=>done()));owner.kill();await exited
  // Reproduce the old upstream-first shutdown deliberately, with a new sender
  // and a timestamped boundary. This does not timestamp the historical event.
  await wait('Expected OMT sender decoder refusal after broker shutdown',()=>probe.errors.some(error=>error.phase==='EXPECTED_UPSTREAM_LOSS'&&error.at>=lifecycle.injectedLossAt&&/decoder da entrada recusou o sinal/.test(error.message)),45000)
  lifecycle.lossProbe={observedAt:Date.now(),onAir:probe.state?.onAir,errors:JSON.parse(JSON.stringify(probe.errors)),notifications:JSON.parse(JSON.stringify(probe.notifications))}
  assert.equal(probe.state?.onAir,'carrier','Loss must not invent a different selected program item')
  lifecycle.result='PASS'
  console.log(JSON.stringify({status:'UPSTREAM_LOSS_REPRODUCED',injectedAt:lifecycle.injectedLossAt,diagnostics:probe.errors}))
}
try{
  await new Promise<void>(done=>gateway.listen(0,'127.0.0.1',done));const gatewayPort=(gateway.address() as {port:number}).port
  const reserve=tcp();await new Promise<void>(done=>reserve.listen(0,'127.0.0.1',done));backendPort=(reserve.address() as {port:number}).port;await new Promise<void>(done=>reserve.close(()=>done()))
  server=spawn(process.execPath,[binary],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...env,RPLAYOUT_INSTALL_ROOT:webRoot,RPLAYOUT_HOST_GUARD:join(native,'rplayout-host-guard.exe'),RPLAYOUT_FILE_SECURITY:join(native,'rplayout-file-security.exe'),RPLAYOUT_DB:join(directory,'service.db'),RPLAYOUT_VAULT_FILE:join(directory,'vault.json'),RPLAYOUT_MEDIA:media,RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_CACHE_DIR:join(directory,'cache'),RPLAYOUT_BACKUPS:join(directory,'backups'),RPLAYOUT_BACKUP_HOURS:'0',RPLAYOUT_ENGINE:engine,RPLAYOUT_ENGINE_OUTPUT:'null',RPLAYOUT_MEDIAMTX:join(installed,'mediamtx/mediamtx.exe'),RPLAYOUT_MEDIAMTX_BIND:'127.0.0.1',RPLAYOUT_DEVICES:devices,RPLAYOUT_RELAY:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_ALLOWED_HOSTS:`127.0.0.1:${gatewayPort}`,HOST:'127.0.0.1',PORT:String(backendPort),LOG_LEVEL:'warn'}})
  logs.set(server,'');for(const stream of [server.stdout,server.stderr])stream?.on('data',chunk=>logs.set(server!,(logs.get(server!)+String(chunk)).slice(-64000)))
  await wait('Own HTTP/MediaMTX ready',async()=>{try{return(await api('/api/health')).data.ok&&Boolean(await mediaPath('guest/qc-native-feed'))}catch{return false}})
  carrier=startCarrier()
  await wait('Synthetic SRT carrier ready',async()=>Boolean((await mediaPath('guest/qc-native-feed'))?.ready))
  for(const kind of recoveryMode?[recoveryKind as 'NDI'|'OMT']:qcOnly?[qcOnly as 'NDI'|'OMT']:['NDI','OMT'] as const)await startSender(kind)
  await wait('Both official native discoveries',async()=>{const value=(await api('/api/sources?refresh=1&channelId=qa')).data;discovery=value;return senders.every(sender=>value[sender.kind.toLowerCase()]?.sources.some((row:any)=>row.discovery==='DISCOVERED'&&row.label.toLowerCase().includes(sender.name.toLowerCase())))},60000)
  for(const sender of senders){const family=(discovery as any)[sender.kind.toLowerCase()],source=family.sources.find((row:any)=>row.discovery==='DISCOVERED'&&row.label.toLowerCase().includes(sender.name.toLowerCase()));const review=await api('/api/channels/qa/live-source-review');const configured=await api('/api/sources/live',{channelId:'qa',name:source.label,kind:sender.kind,targetUrl:source.reference},{'if-match':review.etag!},201);selectedSources.push({kind:sender.kind,reference:source.reference,label:source.label,configuredId:configured.data.id})}
  if(programRecovery)for(const [index,id] of ['live-main','live-next'].entries())database.db.insert(rundownItems).values({id,rundownId:'rd',sortOrder:index,title:id,type:'LIVE',sourceRef:selectedSources[0].reference,durationOverride:25000,minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',autoNext:true,loop:false,locked:false}).run()
  if(priorityMode)await seedPriority()
  const initial=await snapshot();assert.equal(initial.live.transport.preview,null)
  await writeFile(join(directory,'launch.json'),JSON.stringify({directory,package:installed,backendPort,gatewayPort,serverPid:server.pid,hashes,sourceWebOverride,devicesOverride,selectedSources,controlFile,stopFile,lifecycleMode},null,2))
  if(qcAudioOverlap){await runQcAudioOverlap()}else if(priorityMode){await runPriority()}else if(recoveryMode){await runInputRecovery()}else if(lifecycleMode){await runLifecycle()}else{
  console.log(JSON.stringify({status:'QC_NATIVE_BROWSER_READY',directory,url:`http://127.0.0.1:${gatewayPort}/?workspace=qc`,controlFile,stopFile,fixtureUser:'qc-native-verifier',fixturePassword:'Local-QC-native-20261015',selectedSources,scope:'Native synthetic local NDI/OMT; null service PGM; browser must tune QC itself'}))
  const expires=performance.now()+1200000,completedCaptures=new Set<string>()
  while(performance.now()<expires){
    for(const child of [carrier,...senders.map(sender=>sender.child)])assert.ok(child.exitCode===null&&child.signalCode===null,logs.get(child))
    const state=await readControl(),current=await snapshot()
    if(state.capture&&!completedCaptures.has(state.capture)){
      completedCaptures.add(state.capture)
      assert.ok(current.live.transport.liveSources.some((row:any)=>row.busStates?.pvw==='PVW_READY'&&row.measurements?.pvw?.videoPresent),'Capture requires real PVW video')
      const quality=qcBrowserCurrent&&state.capture.endsWith('-quality'),path=quality?current.monitors.inspection:current.monitors.preview
      const signal=current.live.transport.liveSources.find((row:any)=>row.source===current.live.transport.preview?.source)
      assert.ok(path);await wait('QC capture requires both real media tracks',async()=>{const value=await mediaPath(path);return value?.ready&&value.tracks?.includes('H264')&&value.tracks?.includes('Opus')})
      const width=quality?signal.measurements.pvw.width:428,height=quality?signal.measurements.pvw.height:240
      const outcomes=await Promise.allSettled([verifyPublishedPicture({gstBin,directory,path,width,height,environment:env,label:state.capture,videoOnly:qcBrowserCurrent}),...(qcBrowserCurrent?[verifyPublishedAudio({gstBin,directory,path,environment:env,label:state.capture,expectedHz:997})]:[])])
      lifecycle.captureAttempts??=[];lifecycle.captureAttempts.push({label:state.capture,outcomes:outcomes.map((row,index)=>({kind:index?'AUDIO':'PICTURE',result:row.status,error:row.status==='rejected'?String(row.reason):null}))})
      for(const row of outcomes)if(row.status==='rejected')throw row.reason
      const [picture,audio]=outcomes.map(row=>(row as PromiseFulfilledResult<any>).value)
      captures.push({label:state.capture,phase:state.phase,preview:current.live.transport.preview,quality,picture,audio,signal,at:Date.now()});await writeFile(join(directory,'captures.json'),JSON.stringify(captures,null,2));console.log(JSON.stringify({status:'QC_PICTURE_CAPTURED',label:state.capture,picture,audio}))
    }
    try{await stat(stopFile);break}catch{}
    await new Promise(done=>setTimeout(done,600))
  }
  expired=performance.now()>=expires
  }
}catch(error){failure=error;throw error}
finally{
  const teardownStartedAt=Date.now(),preStopSenders=JSON.parse(JSON.stringify(senders.map(({kind,state,signal,publisher,errors})=>({kind,state,signal,publisher,errors}))))
  lifecyclePhase='STOPPING_SENDERS'
  if(server&&server.exitCode===null&&server.signalCode===null){try{for(const row of (await api('/api/processes')).data.processes??[])if(Number.isSafeInteger(row.pid)&&row.pid!==server.pid)ownedNative.add(row.pid)}catch{}}
  for(const socket of sockets)socket.destroy();if(gateway.listening)await new Promise<void>(done=>gateway.close(()=>done()))
  // Consumers first, upstream carrier/broker last. Record the boundary too:
  // losing a synthetic carrier during teardown is not an in-run QC diagnosis.
  for(const sender of senders)await stopSender(sender)
  lifecyclePhase='STOPPING_UPSTREAM'
  for(const child of [carrier,server])if(child&&child.exitCode===null&&child.signalCode===null){const ended=new Promise<void>(done=>child.once('exit',()=>done()));child.kill();await ended}
  const alive=(pid:number)=>{try{process.kill(pid,0);return true}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return false;throw error}}
  const deadline=performance.now()+15000;while([...ownedNative].some(alive)&&performance.now()<deadline)await new Promise(done=>setTimeout(done,100))
  const nativeStopped=[...ownedNative].every(pid=>!alive(pid))
  const result={result:failure?'FAIL':'FIXTURE_FINISHED',directory,package:installed,error:failure?String(failure):null,expired,hashes,sourceWebOverride,devicesOverride,lifecycle,teardownStartedAt,preStopSenders,selectedSources,discovery,captures,snapshots,events,maximum:Object.fromEntries(maximum),asRun:database.sqlite.prepare('SELECT count(*) count FROM as_run').get(),items:database.sqlite.prepare('SELECT count(*) count FROM rundown_items').get(),sources:database.db.select({id:liveSources.id,name:liveSources.name,kind:liveSources.kind,targetUrl:liveSources.targetUrl}).from(liveSources).all(),audits:database.db.select({kind:operatorDecisions.kind,actor:operatorDecisions.actorUsername}).from(operatorDecisions).all(),senders:senders.map(({child,acks,...row})=>({...row,acks:[...acks.values()],exitCode:child.exitCode,signalCode:child.signalCode,log:logs.get(child)})),serverExitObserved:server===null||server.exitCode!==null||server.signalCode!==null,carrierStopped:carrier===null||carrier.exitCode!==null||carrier.signalCode!==null,nativeStopped,physicalSignalValidated:false,browserValidated:false}
  database.sqlite.close();await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));await writeFile(join(directory,'server.log'),server?logs.get(server)??'':'');await writeFile(join(directory,'carrier.log'),carrier?logs.get(carrier)??'':'')
  console.log(JSON.stringify({status:result.result,directory,error:result.error,nativeStopped,captures:captures.length,serverExitObserved:result.serverExitObserved}))
}
