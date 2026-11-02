import assert from 'node:assert/strict'
import {spawn,execFile,type ChildProcess} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,readFile,writeFile,stat,statfs} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createServer} from 'node:net'
import {createSocket} from 'node:dgram'
import {randomUUID,createHash} from 'node:crypto'
import {BoundedRawFrames} from './lib/bounded-raw-frames.js'
import {PcmRtpContinuity} from './lib/pcm-rtp-continuity.js'

// Compiled server + real local RTSP input + native encoder/decoder, not UI
// playback, hardware, external networking or certification of color fidelity.
const root=fileURLToPath(new URL('..',import.meta.url))
const cueTakeOnly=process.argv.includes('--cue-take')
const incidentOnly=process.argv.includes('--incidents')
const graphicExpiry=process.argv.includes('--graphic-expiry')
const graphicProgramAudio=process.argv.includes('--graphic-program-audio')
const graphicReviewRestart=process.argv.includes('--graphic-uncertain-review-restart')
const graphicRestart=process.argv.includes('--secondary-graphic-restart')||graphicReviewRestart
const graphicProgram=process.argv.includes('--graphic-program-emergency')||graphicProgramAudio||graphicRestart
const graphicEmergency=process.argv.includes('--graphic-emergency')||graphicProgram
const graphicIdle=process.argv.includes('--graphic-idle')
const graphicOnly=process.argv.includes('--graphic-confirmation')||graphicExpiry||graphicEmergency||graphicIdle
const publisherOnly=process.argv.includes('--publisher-incidents')||graphicOnly
const browserReview=process.argv.includes('--browser-review')
assert.ok(!(browserReview&&cueTakeOnly),'Browser review is separate from the automated CUE/TAKE scenario')
assert.ok(!incidentOnly||!browserReview&&!cueTakeOnly,'Incident verification is a separate bounded scenario')
assert.ok(!publisherOnly||!incidentOnly&&!browserReview&&!cueTakeOnly,'Publisher verification is a separate bounded scenario')
const reviewTtlArgument=process.argv.find(value=>value.startsWith('--review-ttl-ms='))
const reviewTtl=reviewTtlArgument?Number(reviewTtlArgument.split('=')[1]):600_000
assert.ok(Number.isSafeInteger(reviewTtl)&&reviewTtl>=1000&&reviewTtl<=600_000,'Bounded visual fixture lifetime required')
// Raw receiver evidence can grow by ~60MB on a timed-out scenario. Refuse
// before creating a fixture or opening owned services when storage is unsafe.
const evidenceArgument=process.argv.find(value=>value.startsWith('--evidence-root='))
const evidenceRoot=evidenceArgument?resolve(evidenceArgument.slice(16)):tmpdir()
const storage=await statfs(evidenceRoot)
const minimumTemporaryBytes=publisherOnly?15_000_000:100_000_000
assert.ok(storage.bavail*storage.bsize>=minimumTemporaryBytes,'Native fixture requires '+minimumTemporaryBytes+' free temporary bytes; no services started or evidence deleted')
const directory=await mkdtemp(join(evidenceRoot,'RPlayout-qc-live-quality-'))
const mediaMtxBinary=process.env.RPLAYOUT_QC_VERIFY_MEDIAMTX??join(root,'release/runtime-base-r30/mediamtx/mediamtx.exe')
await readFile(mediaMtxBinary) // Refuse a missing runtime before opening any owned service.
const serverArgument=process.argv.find(value=>value.startsWith('--server-binary='))
const serverBinary=serverArgument?resolve(serverArgument.slice(16)):join(root,'apps/server/dist/server.cjs')
const engineArgument=process.argv.find(value=>value.startsWith('--engine-binary='))
const engineBinary=engineArgument?resolve(engineArgument.slice('--engine-binary='.length)):join(root,'apps/engine/target/release/rplayout-engine.exe')
const securityArgument=process.argv.find(value=>value.startsWith('--file-security-binary='))
const fileSecurityBinary=securityArgument?resolve(securityArgument.slice('--file-security-binary='.length)):join(root,'apps/engine/target/release/rplayout-file-security.exe')
const digest=async(path:string)=>createHash('sha256').update(await readFile(path)).digest('hex')
const binaryHashes={serverSha256:await digest(serverBinary),engineSha256:await digest(engineBinary),mediaMtxSha256:await digest(mediaMtxBinary),fileSecuritySha256:await digest(fileSecurityBinary)}
for(const port of [1935,8554,8888,8889,9997]){
  const socket=createServer()
  await new Promise<void>((resolve,reject)=>{socket.once('error',reject);socket.listen(port,'127.0.0.1',resolve)})
  await new Promise<void>(resolve=>socket.close(()=>resolve()))
}
const udp=createSocket('udp4');await new Promise<void>((resolve,reject)=>{udp.once('error',reject);udp.bind(8890,'127.0.0.1',resolve)});udp.close()
const receiverSocket=createSocket('udp4');await new Promise<void>((resolve,reject)=>{receiverSocket.once('error',reject);receiverSocket.bind(0,'127.0.0.1',resolve)})
const receiverPort=receiverSocket.address().port;receiverSocket.close()
const socket=createServer();await new Promise<void>(resolve=>socket.listen(0,'127.0.0.1',resolve))
const port=(socket.address() as {port:number}).port;await new Promise<void>(resolve=>socket.close(()=>resolve()))
const gstRoot=process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64??'C:/Program Files/gstreamer/1.0/msvc_x86_64',gstBin=join(gstRoot,'bin')
const environment:NodeJS.ProcessEnv={...process.env,GST_REGISTRY:join(directory,'registry.bin'),GST_PLUGIN_SCANNER:join(gstRoot,'libexec/gstreamer-1.0/gst-plugin-scanner.exe'),GST_PLUGIN_PATH:join(gstRoot,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gstRoot,'lib/gstreamer-1.0'),PATH:gstBin+';'+process.env.PATH}
// An external dist directory is a compiled-code test, not an installed package.
// Resolve its declared external native dependency from the workspace explicitly.
if(serverArgument)environment.NODE_PATH=join(root,'apps/server/node_modules')
for(const name of Object.keys(environment))if(name.startsWith('RPLAYOUT_'))delete environment[name]
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json')
const {openDatabase}=await import('../apps/server/src/db/client.js')
const {channels,rundowns,rundownItems,guestKeys,outputProfiles,graphicTemplates,secondaryEvents}=await import('../apps/server/src/db/schema.js')
const database=openDatabase(join(directory,'qc.db')),now=new Date().toISOString()
const {sessionDigest}=await import('../apps/server/src/domain/access.js')
const token=randomUUID()+randomUUID()
database.sqlite.exec("INSERT INTO users VALUES('verifier','QC verifier','NO_LOGIN','ADMIN',1,'now')")
if(browserReview){
  const {hashPassword}=await import('../apps/server/src/domain/auth.js')
  database.sqlite.prepare('UPDATE users SET username=?,password_hash=? WHERE id=?').run('qc-verifier',await hashPassword('Local-QC-fixture-20261009'),'verifier')
}
database.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest(token),'verifier','2099-01-01','now')
database.db.insert(channels).values({id:'qc',name:'QC isolated',width:640,height:360,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,slateTemplateId:null,createdAt:now}).run()
database.db.insert(rundowns).values({id:'rd',channelId:'qc',name:'QC test',date:now.slice(0,10),plannedStart:0,loop:false,createdAt:now,updatedAt:now}).run()
database.db.insert(rundownItems).values({id:'live',rundownId:'rd',sortOrder:0,title:'Live fixture',type:'LIVE',sourceRef:'guest:qc-fixture',durationOverride:25_000,minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',autoNext:false,loop:false,locked:false}).run()
if(cueTakeOnly)database.db.insert(rundownItems).values({id:'live-second',rundownId:'rd',sortOrder:1,title:'Second occurrence of same input',type:'LIVE',sourceRef:'guest:qc-fixture',durationOverride:25_000,minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',autoNext:false,loop:false,locked:false}).run()
database.db.insert(guestKeys).values({id:'guest',channelId:'qc',label:'Local fixture',streamKey:'qc-fixture',enabled:true,createdAt:now}).run()
// PGM stays native/null, not a physical or network output under test.
database.db.insert(outputProfiles).values({id:'pgm',channelId:'qc',name:'Disabled external PGM',kind:'RTMP',target:'',role:'PROGRAM',enabled:false,createdAt:now}).run()
if(publisherOnly)database.db.insert(outputProfiles).values({id:'receiver-test',channelId:'qc',name:'Own local receiver',kind:'SRT',target:`srt://127.0.0.1:${receiverPort}?mode=caller`,role:'EXTRA',width:320,height:180,rateNum:25,rateDen:1,scan:'PROGRESSIVE',bitrateKbps:500,enabled:true,createdAt:now}).run()
if(graphicOnly)database.db.insert(graphicTemplates).values({id:'white-test',channelId:'qc',name:'Tarja Çãó',svg:'<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect x="0" y="180" width="640" height="180" fill="white"/></svg>',fields:[],holdSeconds:null,fadeMs:0,createdAt:now}).run()
if(graphicReviewRestart)database.db.insert(graphicTemplates).values({id:'unknown-white',channelId:'qc',name:'Tarja resultado incerto',svg:'<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="white"/></svg>',fields:[],holdSeconds:null,fadeMs:0,createdAt:now}).run()
if(graphicRestart)database.db.insert(secondaryEvents).values({id:'restart-graphic',channelId:'qc',itemId:'live',definition:{id:'restart-graphic',rundownItemId:'live',targetLayer:'LOWER_THIRD',triggerMode:'MANUAL',offsetFrames:0,templateId:'white-test',payload:{},enabled:true,type:'GRAPHICS_OVERLAY',durationFrames:7500},createdAt:now,updatedAt:now}).run()
const children=new Set<ChildProcess>(),logs=new Map<ChildProcess,string>(),ownedNative=new Set<number>()
let server:ChildProcess|null=null
let incidentHeartbeat:ReturnType<typeof setInterval>|null=null
let result:Record<string,unknown>|null=null
let scenarioProgress:Record<string,unknown>={}
const audioContinuity=new PcmRtpContinuity()
const audioSocket=graphicProgramAudio?createSocket('udp4'):null
let audioPort:number|null=null
if(audioSocket){
  audioSocket.on('message',packet=>audioContinuity.push(packet))
  await new Promise<void>((done,reject)=>{audioSocket.once('error',reject);audioSocket.bind(0,'127.0.0.1',done)})
  audioPort=audioSocket.address().port
}
const alive=(pid:number)=>{try{process.kill(pid,0);return true}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return false;throw error}}
async function stopOwned(child:ChildProcess){
  if(child.exitCode!==null||child.signalCode!==null)return
  let timer:ReturnType<typeof setTimeout>|undefined
  const exited=new Promise<void>(resolve=>child.once('exit',()=>resolve()))
  try{
    child.kill('SIGKILL')
    await Promise.race([exited,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Owned child did not exit')),10000)})])
  }finally{if(timer)clearTimeout(timer)}
}
function launch(binary:string,args:string[],env:NodeJS.ProcessEnv=environment,onStdout?:(chunk:Buffer)=>void){
  const child=spawn(binary,args,{cwd:directory,env,windowsHide:true,stdio:['ignore','pipe','pipe']});children.add(child);logs.set(child,'')
  for(const stream of onStdout?[child.stderr]:[child.stdout,child.stderr])stream?.on('data',data=>logs.set(child,(logs.get(child)+String(data)).slice(-8000)))
  if(onStdout)child.stdout?.on('data',onStdout)
  child.on('error',error=>logs.set(child,String(error)))
  return child
}
async function wait(message:string,predicate:()=>boolean|Promise<boolean>,timeout=40_000){
  const end=performance.now()+timeout
  while(performance.now()<end){if(await predicate())return;assert.ok(!server||server.exitCode===null,'Server exited: '+logs.get(server!));await new Promise(resolve=>setTimeout(resolve,150))}
  throw new Error(message+'\n'+[...logs.values()].join('\n').slice(-6000))
}
async function api(path:string,body?:object,status=200,headers:Record<string,string>={}){
  const response=await fetch(`http://127.0.0.1:${port}${path}`,{...(body?{method:'POST',body:JSON.stringify(body)}:{}),headers:{cookie:'rplayout_session='+token,...(body?{'content-type':'application/json'}:{}),...headers},signal:AbortSignal.timeout(45_000)})
  const data=await response.json() as any;assert.equal(response.status,status,JSON.stringify(data));return data
}
const mediaPath=async(name:string)=>{try{const response=await fetch(`http://127.0.0.1:9997/v3/paths/get/${name}`,{signal:AbortSignal.timeout(3000)});return response.ok?await response.json() as any:null}catch{return null}}
const snapshot=()=>api('/api/rundowns/rd')
async function jpeg(path:string,name:string){
  // MediaMTX can replay the encoder's initial black IDR to a new reader.
  // Decode 50 actual frames and inspect the last one, not that startup GOP.
  const file=join(directory,`${name}-49.jpg`),pattern=join(directory,`${name}-%02d.jpg`),raw=join(directory,`${name}.gray`)
  await promisify(execFile)(join(gstBin,'gst-launch-1.0.exe'),['-q','rtspsrc','name=receiver',`location=rtsp://127.0.0.1:8554/${path}`,'latency=120','protocols=tcp',
    'receiver.','!','application/x-rtp,media=video,encoding-name=H264','!','queue','!','rtph264depay','!','h264parse','!','avdec_h264','!','videoconvert','!','jpegenc','!','identity','eos-after=51','!','multifilesink',`location=${pattern.replaceAll('\\','/')}`,
    'receiver.','!','application/x-rtp,media=audio','!','queue','!','identity','eos-after=300','!','fakesink','sync=false','async=false'],{windowsHide:true,env:environment,timeout:25_000})
  const bytes=await readFile(file);assert.equal(bytes.readUInt16BE(0),0xffd8)
  let size:{width:number;height:number}|null=null
  for(let at=2;at+8<bytes.length;){assert.equal(bytes[at],0xff);const marker=bytes[at+1]!,length=bytes.readUInt16BE(at+2);if([0xc0,0xc1,0xc2].includes(marker)){size={width:bytes.readUInt16BE(at+7),height:bytes.readUInt16BE(at+5)};break}assert.ok(length>=2);at+=length+2}
  assert.ok(size)
  await promisify(execFile)(join(gstBin,'gst-launch-1.0.exe'),['-q','filesrc',`location=${file.replaceAll('\\','/')}`,'!','jpegdec','!','videoconvert','!','video/x-raw,format=GRAY8','!','filesink',`location=${raw.replaceAll('\\','/')}`],{windowsHide:true,env:environment,timeout:15_000})
  const pixels=await readFile(raw),mean=pixels.reduce((sum,value)=>sum+value,0)/pixels.length
  const deviation=Math.sqrt(pixels.reduce((sum,value)=>sum+(value-mean)**2,0)/pixels.length)
  let edges=0,count=0
  const stride=Math.ceil(size.width/4)*4
  for(let y=0;y<size.height;y++)for(let x=1;x<size.width;x++){edges+=Math.abs(pixels[y*stride+x]!-pixels[y*stride+x-1]!);count++}
  return {...size,deviation,horizontalDetail:edges/count}
}
try{
  const startServer=()=>launch(process.execPath,[serverBinary],{...environment,RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_FILE_SECURITY:fileSecurityBinary,RPLAYOUT_DB:join(directory,'qc.db'),RPLAYOUT_VAULT_FILE:join(directory,'vault.json'),RPLAYOUT_MEDIA:directory,RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_CACHE_DIR:join(directory,'cache'),RPLAYOUT_BACKUP_DIR:join(directory,'backups'),RPLAYOUT_ENGINE:engineBinary,RPLAYOUT_ENGINE_OUTPUT:'null',RPLAYOUT_MEDIAMTX:mediaMtxBinary,RPLAYOUT_MEDIAMTX_BIND:'127.0.0.1',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_DEVICES:'',RPLAYOUT_RELAY:'',RPLAYOUT_ADMIN_USER:'',RPLAYOUT_ADMIN_PASSWORD:'',RPLAYOUT_CONTROL_TOKEN:'',RPLAYOUT_ROLE:'ADMIN',RPLAYOUT_BACKUP_HOURS:'0',HOST:'127.0.0.1',PORT:String(port),LOG_LEVEL:'warn'})
  server=startServer()
  await wait('Server/MediaMTX not ready',async()=>{try{return (await api('/api/health')).ok && Boolean(await mediaPath('guest/qc-fixture'))}catch{return false}})
  const startSender=()=>launch(join(gstBin,'gst-launch-1.0.exe'),['-q','mpegtsmux','name=m','alignment=7','latency=500000000','!','srtsink','uri=srt://127.0.0.1:8890?streamid=publish:guest/qc-fixture','videotestsrc','is-live=true',cueTakeOnly||incidentOnly||graphicProgram?'pattern=smpte':'pattern=checkers-2','!','video/x-raw,format=I420,width=1280,height=720,framerate=25/1','!','videoconvert','!','x264enc','threads=2','speed-preset=ultrafast','tune=zerolatency','bitrate=6000','key-int-max=25','!','h264parse','!','queue','!','m.','audiotestsrc','is-live=true','freq=997','volume=0.05','!','audio/x-raw,rate=48000,channels=2','!','audioconvert','!','avenc_aac','!','aacparse','!','queue','!','m.'])
  let sender:ChildProcess|null=null
  if(!publisherOnly||graphicProgram){sender=startSender();await wait('Fixture signal not published',async()=>Boolean((await mediaPath('guest/qc-fixture'))?.ready))}
  if(publisherOnly){
    // Idle PGM's actual black test carrier proves transport/decode only, not
    // editorial content, audio quality or externally reachable destinations.
    const captures=new Map<string,BoundedRawFrames>()
    const size=async(name:string)=>captures.get(name)?.decodedBytes??0
    const saveFrame=async(name:string,label:string)=>{
      const frame=captures.get(name)?.snapshot();assert.ok(frame,'No complete decoded frame for evidence')
      await writeFile(join(directory,label+'.gray'),frame)
    }
    const receiver=(name:string)=>{
      const capture=new BoundedRawFrames(320*180);captures.set(name,capture)
      const audioTail=graphicProgramAudio?['avdec_aac','!','audioconvert','!','audio/x-raw,format=S16BE,rate=48000,channels=2,layout=interleaved','!','rtpL16pay','pt=96','mtu=1200','!','udpsink','host=127.0.0.1',`port=${audioPort}`,'sync=false','async=false']:['fakesink','sync=false','async=false']
      return launch(join(gstBin,'gst-launch-1.0.exe'),['-q','srtsrc',`uri=srt://127.0.0.1:${receiverPort}?mode=listener`,'!','tsdemux','name=d','d.','!','queue','!','h264parse','!','avdec_h264','!','videoconvert','!','video/x-raw,format=GRAY8,width=320,height=180','!','fdsink','fd=1','sync=false','d.','!','queue','!','aacparse','!',...audioTail],environment,chunk=>capture.push(chunk))
    }
    let sink=receiver('publisher-before')
    await snapshot() // Activate only our own isolated native runtime.
    const publisher=async()=> (await api('/api/distribution')).channels.find((row:any)=>row.channelId==='qc')?.publishers.find((row:any)=>row.outputId==='receiver-test')
    // Use the authoritative runtime view; never seed incidents or delivery.
    await wait('Own receiver did not decode native output',async()=> await size('publisher-before')>=320*180*25)
    const initial=await publisher();assert.ok(initial&&Number.isSafeInteger(initial.generation)&&initial.delivered>0,JSON.stringify(await snapshot()))
    if(graphicOnly){
      let rasterCaptureName='publisher-before'
      const raster=()=>{
        const pixels=captures.get(rasterCaptureName)?.snapshot();assert.ok(pixels)
        const half=pixels.length/2
        let upper=0,lower=0,squares=0
        for(let index=0;index<pixels.length;index++){
          const value=pixels[index]!
          if(index<half)upper+=value;else lower+=value
          squares+=value*value
        }
        upper/=half;lower/=half
        const mean=(upper+lower)/2
        return {mean,upper,lower,deviation:Math.sqrt(Math.max(0,squares/pixels.length-mean*mean))}
      }
      const isSlate=()=>{const image=raster();return image.upper<30&&image.lower>220}
      const isProgram=()=>{const image=raster();return image.upper>50&&image.deviation>40&&!isSlate()}
      let programBefore:any=null
      if(graphicProgram){
        const review=(await api('/api/rundowns/rd/operational-simulation')).review
        await api('/api/rundowns/rd/operational-publish',{reviewToken:review.token},201,{'if-match':`w/"${review.editorialRevision}"`})
        await api('/api/channels/qc/load-rundown',{rundownId:'rd'})
        await api('/api/channels/qc/transport',{action:'cue',itemId:'live'})
        await wait('Native live fixture did not become PVW_READY',async()=> (await snapshot()).live.transport.liveSources.some((source:any)=>source.busStates?.pvw==='PVW_READY'))
        await api('/api/channels/qc/transport',{action:'take'})
        await wait('Live did not enter actual PGM',async()=> (await snapshot()).live.transport.onAir?.itemId==='live')
        await wait('Own receiver did not decode real program raster',isProgram)
        programBefore=(await snapshot()).live.transport.onAir
        if(graphicProgramAudio){
          audioContinuity.setPhase('BEFORE')
          await wait('No decoded program audio before emergency',()=>audioContinuity.snapshot().phases.BEFORE.frames>=48000)
        }
      }
      const mean=async()=>{
        const pixels=captures.get('publisher-before')?.snapshot();assert.ok(pixels)
        return pixels.reduce((sum,value)=>sum+value,0)/pixels.length
      }
      const beforeMean=await mean();if(!graphicProgram)assert.ok(beforeMean<30,'Idle carrier must be black before graphic')
      const beforeRaster=raster()
      await saveFrame('publisher-before','graphic-before')
      if(graphicRestart){
        if(!graphicReviewRestart)database.sqlite.exec("CREATE TRIGGER refuse_secondary_bookkeeping BEFORE UPDATE ON secondary_event_runs WHEN OLD.event_id='restart-graphic' BEGIN SELECT RAISE(ABORT,'owned-fixture-completion-fault'); END")
        await api('/api/channels/qc/secondary-events/restart-graphic/fire',{},graphicReviewRestart?200:409)
        const isSecondary=()=>{const image=raster();return image.upper>50&&image.lower>220}
        await wait('Confirmed secondary graphic not visible before crash',isSecondary)
        await saveFrame('publisher-before','secondary-before-crash')
        const runs=()=>database.sqlite.prepare("SELECT * FROM secondary_event_runs WHERE channel_id='qc' AND event_id='restart-graphic'").all() as any[]
        assert.equal(runs().length,1);assert.equal(runs()[0].state,graphicReviewRestart?'EXECUTED':'FIRING')
        const initialCommands=(await api('/api/channels/qc/graphic-commands')).commands
        assert.equal(initialCommands.length,1);assert.equal(initialCommands[0].state,'CONFIRMED')
        const checkpoint=()=>JSON.parse((database.sqlite.prepare("SELECT payload FROM channel_checkpoints WHERE channel_id='qc'").get() as {payload:string}).payload)
        await wait('Confirmed live checkpoint not persisted before crash',()=>{try{const saved=checkpoint();return saved.playing&&saved.itemId==='live'&&saved.executionId&&saved.ownerRunId&&saved.elapsed>0}catch{return false}})
        const beforeCheckpoint=checkpoint(),priorRaster=raster()
        assert.equal(beforeCheckpoint.graphicReceiptId,initialCommands[0].id,'Checkpoint must bind the actual confirmed composition before crash')
        scenarioProgress={initialReceiptConfirmed:true,secondaryStateBeforeCrash:runs()[0].state,savedElapsed:beforeCheckpoint.elapsed}
        let unknownCommandId:string|null=null
        if(graphicReviewRestart){
          // Real native SHOW/ACK, but terminal storage cannot persist. This is
          // durability loss, NOT a claim that the wire ACK was dropped.
          database.sqlite.exec("CREATE TRIGGER refuse_graphic_confirmation BEFORE INSERT ON operator_decisions WHEN NEW.kind IN ('GRAPHIC_COMMAND_CONFIRMED','GRAPHIC_COMMAND_UNCERTAIN') BEGIN SELECT RAISE(ABORT,'owned-confirmation-storage-fault'); END")
          await api('/api/channels/qc/graphic',{templateId:'unknown-white',values:{}},409,{'idempotency-key':'owned-uncertain-show'})
          await wait('Uncertain native effect not visible in own receiver',()=>{const image=raster();return image.upper>220&&image.lower>220})
          await saveFrame('publisher-before','uncertain-effect-before-crash')
          const commands=(await api('/api/channels/qc/graphic-commands')).commands
          assert.equal(commands.length,2);const unknown=commands.find((command:any)=>command.state==='SENDING');assert.ok(unknown)
          unknownCommandId=unknown.id
          assert.equal(checkpoint().graphicReceiptId,beforeCheckpoint.graphicReceiptId)
          scenarioProgress={...scenarioProgress,nativeEffectObservedWithoutDurableTerminal:true,unknownCommandId,unknownDurableState:'SENDING',uncertainRaster:raster()}
        }
        const priorFamily=((await api('/api/processes')).processes??[]).filter((row:any)=>['ENGINE','MEDIAMTX'].includes(row.kind)&&Number.isSafeInteger(row.pid)).map((row:any)=>row.pid) as number[]
        assert.ok(priorFamily.length>=2)
        for(const pid of priorFamily)ownedNative.add(pid)
        await stopOwned(server!);server=null
        await stopOwned(sender!);await stopOwned(sink)
        await wait('Old owning server Job family did not drain',()=>priorFamily.every(pid=>!alive(pid)),10000)
        scenarioProgress={...scenarioProgress,ownBackendKilled:true,oldNativeFamilyGoneObserved:true}
        database.sqlite.exec(graphicReviewRestart?'DROP TRIGGER refuse_graphic_confirmation':'DROP TRIGGER refuse_secondary_bookkeeping')
        rasterCaptureName='publisher-after';sink=receiver(rasterCaptureName)
        server=startServer();sender=startSender()
        await wait('Restarted own server/MediaMTX not ready',async()=>{try{return (await api('/api/health')).ok&&Boolean(await mediaPath('guest/qc-fixture'))}catch{return false}})
        await wait('Fresh sender not received after backend restart',async()=>Boolean((await mediaPath('guest/qc-fixture'))?.ready))
        await wait('Checkpoint PGM not recovered after backend crash',async()=>{try{return (await snapshot()).live.transport.onAir?.itemId==='live'}catch{return false}},60000)
        await wait('New receiver did not decode post-crash output',async()=>await size('publisher-after')>=320*180*25)
        const recoveredProgram=(await snapshot()).live.transport.onAir
        scenarioProgress={...scenarioProgress,pgmRecovered:true,recoveredItemId:recoveredProgram.itemId,recoveredElapsed:recoveredProgram.elapsed,postCrashRaster:raster(),postCrashSecondaryState:runs()[0]?.state}
        await wait('Recovered live cursor regressed below saved occurrence',async()=>{try{return (await snapshot()).live.transport.onAir?.elapsed>=beforeCheckpoint.elapsed}catch{return false}})
        await wait('Recovered live image not present in own receiver',()=>{const image=raster();return image.upper>50&&image.deviation>10})
        scenarioProgress={...scenarioProgress,cursorPreserved:true,recoveredElapsed:(await snapshot()).live.transport.onAir.elapsed,liveImageObserved:true,postCrashRaster:raster()}
        await saveFrame('publisher-after','pgm-after-backend-restart')
        if(graphicReviewRestart){
          await wait('Old graphic visible despite unresolved command',()=>isProgram()&&raster().lower<180)
          const commands=(await api('/api/channels/qc/graphic-commands')).commands,unknown=commands.find((command:any)=>command.id===unknownCommandId)
          assert.equal(commands.length,2);assert.equal(unknown?.state,'SENDING')
          const reviewed=await api('/api/channels/qc/graphic-commands/'+encodeURIComponent(unknown.id)+'/review',{reviewToken:unknown.reviewToken,note:'Owned receiver checked; acknowledge incident, not physical reconstruction',imageAndEngineChecked:true})
          assert.equal(reviewed.graphicCommand.state,'REVIEWED');assert.equal(reviewed.signalRecovered,false)
          await wait('Reviewed uncertainty did not block old display recovery',async()=> (await snapshot()).live.alerts.some((alert:any)=>String(alert.message).includes('Incidente reconhecido')))
          const blockedHistory=(await api('/api/channels/qc/graphic-commands')).commands
          assert.equal(blockedHistory.length,2);assert.equal(blockedHistory.filter((command:any)=>command.state==='CONFIRMED').length,1)
          assert.ok(isProgram()&&raster().lower<180,'Review must not resurrect old secondary or uncertain SHOW')
          const corrected=await api('/api/channels/qc/graphic',{templateId:'white-test',values:{}},200,{'idempotency-key':'owned-explicit-correction'})
          assert.equal(corrected.graphicCommand.state,'CONFIRMED')
          await wait('Explicit corrective composition not visible',isSecondary)
          await wait('Corrective checkpoint not bound to new confirmed composition',()=>checkpoint().graphicReceiptId===corrected.graphicCommand.id)
          await wait('Old recovery warning remained active after confirmed correction',async()=> !(await snapshot()).live.alerts.some((alert:any)=>String(alert.message).includes('Incidente reconhecido')))
          assert.equal((database.sqlite.prepare("SELECT count(*) n FROM operator_decisions WHERE kind='GRAPHIC_RECOVERY_REESTABLISHED'").get() as {n:number}).n,1)
          const afterCheckpoint=checkpoint();assert.equal(afterCheckpoint.executionId,beforeCheckpoint.executionId);assert.equal(afterCheckpoint.revisionId,beforeCheckpoint.revisionId)
          const finalHistory=(await api('/api/channels/qc/graphic-commands')).commands;assert.equal(finalHistory.length,3)
          assert.equal(finalHistory.find((command:any)=>command.id===unknownCommandId)?.state,'REVIEWED')
          const activeAsRun=(database.sqlite.prepare("SELECT count(*) n FROM as_run WHERE ended_at IS NULL").get() as {n:number}).n;assert.equal(activeAsRun,1)
          await saveFrame('publisher-after','explicit-correction-after-review')
          result={result:'PASS',evidence:'COMPILED_NATIVE_DURABILITY_LOSS_REVIEW_CRASH_BLOCKS_OLD_COMPOSITION_AND_EXPLICIT_CORRECTION',directory,port,nativeEffectObservedWithoutDurableTerminal:true,durabilityLossInjected:true,wireAckLossInjected:false,unknownDurableStateBeforeCrash:'SENDING',reviewedIncidentDoesNotProveSignalRecovery:true,noAutomaticOldDisplayReconstructionAfterReview:true,blockedHistoryCount:2,finalHistoryCount:3,explicitCorrectionConfirmedAndCheckpointBound:true,executionAndPublishedRevisionPreserved:true,activeAsRunCount:activeAsRun,savedElapsed:beforeCheckpoint.elapsed,recoveredElapsed:(await snapshot()).live.transport.onAir.elapsed,restoredRaster:raster(),ownBackendKilledAndRestarted:true,oldNativeFamilyGoneObserved:true,physicalInputsValidated:false,externalDestinationValidated:false,browserPlaybackValidated:false,audioRecoveryValidated:false,ackLossValidated:false}
        }else{
        await wait('Secondary graphic not reconstructed on recovered PGM',isSecondary)
        await saveFrame('publisher-after','secondary-after-recovery')
        assert.equal(runs().length,1);assert.equal(runs()[0].state,'EXECUTED')
        assert.equal(runs()[0].execution_id,beforeCheckpoint.executionId)
        const afterCheckpoint=checkpoint();assert.equal(afterCheckpoint.executionId,beforeCheckpoint.executionId)
        assert.equal(afterCheckpoint.revisionId,beforeCheckpoint.revisionId)
        const reconciliations=(await api('/api/channels/qc/graphic-commands')).commands
        assert.equal(reconciliations.length,2);assert.ok(reconciliations.every((command:any)=>command.state==='CONFIRMED'))
        assert.equal((database.sqlite.prepare("SELECT count(*) n FROM operator_decisions WHERE kind='SECONDARY_GRAPHIC_RECONCILED'").get() as {n:number}).n,1)
        const activeAsRun=(database.sqlite.prepare("SELECT count(*) n FROM as_run WHERE ended_at IS NULL").get() as {n:number}).n
        assert.equal(activeAsRun,1)
        result={result:'PASS',evidence:'COMPILED_NATIVE_BACKEND_CRASH_BOUND_SECONDARY_RECONCILIATION_AND_DISPLAY_RESTORE',directory,port,priorRaster,restoredRaster:raster(),initialReceiptConfirmedBeforeCrash:true,secondaryBookkeepingInterrupted:true,ownBackendKilledAndRestarted:true,oldNativeFamilyGoneObserved:true,secondaryRowCount:1,reconciliationAuditCount:1,graphicReceiptCount:2,secondReceiptIsExplicitDisplayReconstruction:true,executionAndPublishedRevisionPreserved:true,activeAsRunCount:activeAsRun,savedElapsed:beforeCheckpoint.elapsed,recoveredElapsed:(await snapshot()).live.transport.onAir.elapsed,physicalInputsValidated:false,externalDestinationValidated:false,browserPlaybackValidated:false,audioRecoveryValidated:false,ackLossValidated:false}
        }
      }else if(graphicIdle){
        database.sqlite.prepare("UPDATE channels SET slate_template_id='white-test' WHERE id='qc'").run()
        await api('/api/channels/qc/load-rundown',{rundownId:'rd'})
        await wait('Automatic idle presentation not visible',async()=>await mean()>80)
        const shownMean=await mean()
        await saveFrame('publisher-before','graphic-shown')
        database.sqlite.prepare("UPDATE channels SET slate_template_id=NULL WHERE id='qc'").run()
        await api('/api/channels/qc/load-rundown',{rundownId:'rd'})
        await wait('Automatic idle presentation removal not visible',async()=>await mean()<30)
        await saveFrame('publisher-before','graphic-hidden')
        const history=await api('/api/channels/qc/graphic-commands')
        assert.equal(history.commands.length,2)
        assert.ok(history.commands.every((command:any)=>command.state==='CONFIRMED'&&command.actor==='AUTOMATIC'))
        assert.equal((await snapshot()).live.transport.onAir,null)
        assert.equal((database.sqlite.prepare('SELECT count(*) n FROM as_run').get() as {n:number}).n,0)
        result={result:'PASS',evidence:'COMPILED_NATIVE_IDLE_PRESENTATION_LEDGER_AND_RECEIVER_PIXELS',directory,port,beforeMean,shownMean,hiddenMean:await mean(),receiverRaster:{width:320,height:180},automaticShowAndHideConfirmed:true,pgmNeverTaken:true,asRunCount:0,ownedReceiptCount:2,physicalInputsValidated:false,externalDestinationValidated:false,browserPlaybackValidated:false}
      }else{
      // The automatic idle presentation is a separate feature. Keep its runtime
      // configuration disabled; emergency reads its frozen template from DB.
      if(graphicEmergency)database.sqlite.prepare("UPDATE channels SET slate_template_id='white-test' WHERE id='qc'").run()
      const showBody=graphicEmergency?{channelId:'qc',action:'TRIGGER'}:{channelId:'qc',action:'SHOW',templateId:'white-test',fadeMs:0,...(graphicExpiry?{durationFrames:75}:{})}
      const showPath=graphicEmergency?'/api/v1/engineering/pgm-probe/emergency-slate':'/api/v1/graphics/layers/LOWER_THIRD/trigger'
      if(graphicProgramAudio)audioContinuity.setPhase('DURING')
      const shown=await api(showPath,showBody,200,{'idempotency-key':'own-native-show-key'})
      if(graphicEmergency)assert.equal(shown.emergencySlateActive,true)
      else {assert.equal(shown.confirmation,'NATIVE_ACK');assert.equal(shown.physicalOutputValidated,false)}
      assert.equal(shown.graphicCommand.state,'CONFIRMED')
      await wait('Confirmed native graphic not visible at own receiver',async()=>graphicProgram?isSlate():await mean()>80)
      const shownMean=await mean()
      const shownRaster=raster()
      await saveFrame('publisher-before','graphic-shown')
      if(graphicProgramAudio)await wait('No decoded program audio during emergency',()=>audioContinuity.snapshot().phases.DURING.frames>=48000)
      if(graphicEmergency){
        const replay=await api(showPath,showBody,200,{'idempotency-key':'own-native-show-key'})
        assert.equal(replay.graphicCommand.replayed,true);assert.equal(replay.emergencySlateActive,true)
        // RESET on an idle channel legitimately allows its configured automatic
        // presentation to return. Disable that separate feature before measuring
        // the clear; after-reset replay is covered by the runtime contract test.
        database.sqlite.prepare("UPDATE channels SET slate_template_id=NULL WHERE id='qc'").run()
        if(graphicProgramAudio)audioContinuity.setPhase('AFTER')
        const hidden=await api(showPath,{channelId:'qc',action:'RESET'},200,{'idempotency-key':'own-native-reset-key'})
        assert.equal(hidden.emergencySlateActive,false);assert.equal(hidden.graphicCommand.state,'CONFIRMED')
      }else if(!graphicExpiry){
        const hidden=await api('/api/v1/graphics/layers/LOWER_THIRD/trigger',{channelId:'qc',action:'HIDE',fadeMs:0})
        assert.equal(hidden.confirmation,'NATIVE_ACK');assert.equal(hidden.layerState.active,false)
      }
      await wait('Confirmed native graphic hide not visible at own receiver',async()=>graphicProgram?isProgram():await mean()<30)
      await saveFrame('publisher-before','graphic-hidden')
      if(graphicProgramAudio)await wait('No decoded program audio after RESET',()=>audioContinuity.snapshot().phases.AFTER.frames>=48000)
      if(!graphicEmergency){
        const repeated=await api(showPath,showBody,200,{'idempotency-key':'own-native-show-key'})
        assert.equal(repeated.graphicCommand.replayed,true);assert.equal(repeated.layerState.active,false)
      }
      if(graphicEmergency)database.sqlite.prepare("UPDATE channels SET slate_template_id=NULL WHERE id='qc'").run()
      const history=await api('/api/channels/qc/graphic-commands')
      assert.equal(history.commands.length,2)
      if(graphicExpiry)assert.equal(history.commands.find((command:any)=>command.actor==='AUTOMATIC')?.state,'CONFIRMED')
      assert.equal((database.sqlite.prepare("SELECT count(*) n FROM operator_decisions WHERE kind='GRAPHIC_COMMAND_ACCEPTED'").get() as {n:number}).n,2)
      if(!graphicProgram){
        assert.equal((await snapshot()).live.transport.onAir,null)
        assert.equal((database.sqlite.prepare('SELECT count(*) n FROM as_run').get() as {n:number}).n,0)
      }
      result={result:'PASS',evidence:graphicEmergency?'COMPILED_NATIVE_EMERGENCY_LEDGER_AND_RECEIVER_PIXELS':graphicExpiry?'COMPILED_NATIVE_AUTOMATIC_GRAPHIC_EXPIRY_AND_RECEIVER_PIXELS':'COMPILED_NATIVE_GRAPHIC_ACK_AND_SRT_RECEIVER_PIXELS',directory,port,beforeMean,shownMean,hiddenMean:await mean(),receiverRaster:{width:320,height:180},pgmNeverTaken:true,asRunCount:0,nativeShowAndHideConfirmed:true,automaticExpiryConfirmed:graphicExpiry,emergencySlateConfirmed:graphicEmergency,durableManualReceipts:true,replayedShowDidNotResend:true,replayPhase:graphicEmergency?'WHILE_ACTIVE':'AFTER_HIDE',idlePresentationDisabledForClear:graphicEmergency,physicalInputsValidated:false,externalDestinationValidated:false,browserPlaybackValidated:false}
      if(graphicProgram){
        const programAfter=(await snapshot()).live.transport.onAir
        assert.equal(programAfter?.itemId,'live');assert.equal(programAfter.startedAt,programBefore.startedAt)
        assert.ok(programAfter.elapsed>programBefore.elapsed)
        const asRunCount=(database.sqlite.prepare('SELECT count(*) n FROM as_run').get() as {n:number}).n
        assert.equal(asRunCount,1,'Overlay must not create another program occurrence')
        await api(showPath,showBody,409,{'idempotency-key':'own-native-show-key'})
        assert.ok(isProgram(),'Old emergency SHOW must not replace restored PGM')
        assert.equal((await api('/api/channels/qc/graphic-commands')).commands.length,2)
        result={...result,evidence:'COMPILED_NATIVE_EMERGENCY_OVER_REAL_PGM_RECEIVER',pgmNeverTaken:false,asRunCount,beforeRaster,shownRaster,restoredRaster:raster(),programOriginPreserved:true,programElapsedAdvanced:true,oldShowAfterResetDidNotReactivate:true,replayPhase:'WHILE_ACTIVE_AND_AFTER_RESET',programInput:'OWN_LOCAL_SRT_TEST_PATTERN',programAudioContinuityValidated:false}
        if(graphicProgramAudio){
          const audio=audioContinuity.snapshot()
          assert.equal(audio.invalidPackets,0);assert.equal(audio.sequenceDiscontinuities,0)
          assert.equal(audio.timestampDiscontinuities,0);assert.equal(audio.ssrcChanges,0)
          for(const phase of Object.values(audio.phases)){
            assert.ok(phase.frames>=48000)
            assert.equal(phase.silentFrames,0)
            assert.ok(phase.rms.every(value=>value>0.005&&value<0.2),JSON.stringify(audio))
          }
          result={...result,evidence:'COMPILED_NATIVE_EMERGENCY_PGM_RASTER_AND_DECODED_AUDIO',programAudioContinuityValidated:true,audio,continuousAudioRecordingWritten:false,audioScope:'OWN_LOCAL_RECEIVER_BOUNDED_MEASUREMENT_NOT_SOAK_OR_PHYSICAL_OUTPUT'}
        }
      }
      }
    }else{
    const health=()=>api('/api/health-events?channelId=qc'),before=new Set((await health()).events.map((row:any)=>row.id))
    await stopOwned(sink)
    await wait('Real destination loss not persisted',async()=> (await health()).events.some((row:any)=>row.component==='OUTPUT'&&row.id.startsWith('runtime-signal:')&&row.id.endsWith(':active')&&!before.has(row.id)&&row.context?.outputs.some((output:any)=>output.name==='Own local receiver'&&['retrying','failed'].includes(output.state))),45_000)
    const incident=(await health()).events.find((row:any)=>row.component==='OUTPUT'&&row.id.startsWith('runtime-signal:')&&row.id.endsWith(':active')&&!before.has(row.id)&&row.context?.outputs.some((output:any)=>output.name==='Own local receiver'&&['retrying','failed'].includes(output.state)))
    assert.ok(incident);assert.equal(incident.resolvedAt,null);assert.equal(incident.acknowledgedAt,null)
    const context=structuredClone(incident.context),lost=await publisher()
    sink=receiver('publisher-after')
    await wait('Reopened receiver did not decode native output',async()=>await size('publisher-after')>=320*180*25,45_000)
    await wait('Native output recovery not persisted',async()=>Boolean((await health()).events.find((row:any)=>row.id===incident.id)?.resolvedAt))
    const final=await publisher(),events=(await health()).events,original=events.find((row:any)=>row.id===incident.id)
    assert.ok(final.generation>=lost.generation&&final.delivered>0)
    assert.deepEqual(original.context,context);assert.equal(original.acknowledgedAt,null)
    assert.ok(events.some((row:any)=>row.id===incident.id.slice(0,-6)+'recovered'))
    assert.equal((await snapshot()).live.transport.onAir,null)
    assert.equal((database.sqlite.prepare('SELECT count(*) n FROM as_run').get() as {n:number}).n,0)
    result={result:'PASS',evidence:'COMPILED_NATIVE_SRT_OUTPUT_OWN_RECEIVER_LOSS_RETURN',directory,port,receiverPort,initialPublisher:initial,lostPublisher:lost,returnedPublisher:final,initialDecodedBytes:await size('publisher-before'),returnedDecodedBytes:await size('publisher-after'),outputFailureIncidentId:incident.id,originalContextPreserved:true,recoveryDidNotAcknowledge:true,pgmNeverTaken:true,asRunCount:0,decodedBlackTestCarrier:true,physicalInputsValidated:false,externalDestinationValidated:false,browserPlaybackValidated:false}
    await saveFrame('publisher-before','publisher-before-last');await saveFrame('publisher-after','publisher-after-last')
    }
    result={...result,boundedReceiverCapture:true,receiverCounts:[...captures].map(([name,capture])=>({name,framesDecoded:capture.framesDecoded,decodedBytes:capture.decodedBytes,retainedPixelBytes:capture.retainedPixelBytes})),continuousRawRecordingWritten:false}
  }else if(incidentOnly){
    incidentHeartbeat=setInterval(()=>void api('/api/channels/qc/watching',{bus:'pvw'}).catch(()=>{}),2500);incidentHeartbeat.unref()
    const sourceRef='guest:qc-fixture'
    const {MediaMtx}=await import('../apps/server/src/domain/mediamtx.js')
    const resolvedSource=MediaMtx.internalRead('guest/qc-fixture')
    const health=()=>api('/api/health-events?channelId=qc')
    const currentSignal=async()=> (await snapshot()).live.transport.liveSources.find((row:any)=>row.source===resolvedSource)?.busSignals?.pvw
    await api('/api/channels/qc/transport',{action:'cue',sourceRef,sourceTitle:'Estúdio São José — ensaio de incidentes'})
    await wait('Actual PVW video/audio not measured',async()=>{const signal=await currentSignal();return signal?.status==='SIGNAL_OK'&&signal.videoRecent&&signal.audioRecent})
    const initial=await snapshot();assert.equal(initial.live.transport.onAir,null)
    await api('/api/channels/qc/watching',{bus:'pvw'})
    await wait('Native low PVW output not received',async()=>Boolean((await mediaPath(initial.monitors.preview))?.ready))
    const initialImage=await jpeg(initial.monitors.preview,'incident-before-loss');assert.ok(initialImage.deviation>10)
    const firstPublisher=(await mediaPath('guest/qc-fixture'))?.source?.id;assert.ok(firstPublisher,'Actual ingest publisher identity required')
    const before=new Set((await health()).events.map((row:any)=>row.id))
    await stopOwned(sender!)
    await wait('Real source loss not persisted',async()=> (await health()).events.some((row:any)=>row.component==='LIVE_SOURCE'&&row.id.startsWith('runtime-signal:')&&row.id.endsWith(':active')&&!before.has(row.id)))
    const lostEvents=(await health()).events,incident=lostEvents.find((row:any)=>row.component==='LIVE_SOURCE'&&row.id.startsWith('runtime-signal:')&&row.id.endsWith(':active')&&!before.has(row.id))
    assert.ok(incident);assert.equal(incident.resolvedAt,null);assert.equal(incident.acknowledgedAt,null);assert.equal(incident.context?.physicalSignalValidated,false)
    const detectionContext=structuredClone(incident.context)
    assert.equal((await snapshot()).live.transport.onAir,null,'Loss must not TAKE')
    // MediaMTX may retain the old SRT connection until its timeout even after
    // input buffers stopped. ready=true alone is not proof of a new publisher.
    await wait('Previous SRT publisher not retired',async()=>!(await mediaPath('guest/qc-fixture'))?.ready)
    sender=startSender();await wait('Returned SRT publisher not received',async()=>{const path=await mediaPath('guest/qc-fixture');return path?.ready&&path.source?.id&&path.source.id!==firstPublisher})
    // Re-CUE is explicit recovery of a PVW decoder. Do not claim automatic
    // reconnect unless it was independently observed and tested.
    await api('/api/channels/qc/transport',{action:'cue',sourceRef,sourceTitle:'Estúdio São José — retorno'})
    await wait('Returned input video/audio not measured',async()=>{const signal=await currentSignal();return signal?.status==='SIGNAL_OK'&&signal.videoRecent&&signal.audioRecent})
    await wait('Measured source recovery not persisted',async()=>Boolean((await health()).events.find((row:any)=>row.id===incident.id)?.resolvedAt))
    const recoveredEvents=(await health()).events,original=recoveredEvents.find((row:any)=>row.id===incident.id),recovery=recoveredEvents.find((row:any)=>row.id===incident.id.slice(0,-6)+'recovered')
    assert.ok(recovery);assert.deepEqual(original.context,detectionContext);assert.equal(original.acknowledgedAt,null)
    assert.equal((await snapshot()).live.transport.onAir,null,'Re-CUE must not TAKE')
    await api('/api/channels/qc/watching',{bus:'pvw'})
    await wait('Returned PVW publication not ready',async()=>Boolean((await mediaPath(initial.monitors.preview))?.ready))
    const returnedImage=await jpeg(initial.monitors.preview,'incident-after-return');assert.ok(returnedImage.deviation>10)
    assert.equal((database.sqlite.prepare('SELECT count(*) n FROM as_run').get() as {n:number}).n,0)
    assert.ok(!JSON.stringify(recoveredEvents).includes('srt://127.0.0.1:'))
    result={result:'PASS',evidence:'COMPILED_NATIVE_SRT_INGEST_RTSP_DECODER_SRT_PVW_RTSP_RECEIVER',directory,port,initialImage,returnedImage,sourceFailureIncidentId:incident.id,originalDetectionContextPreserved:true,measuredVideoAndAudioRecovered:true,recoveryDidNotAcknowledge:true,explicitReCueRequiredByScenario:true,automaticReconnectValidated:false,pgmNeverTaken:true,asRunCount:0,physicalInputsValidated:false,browserPlaybackValidated:false}
  }else if(browserReview){
    const reviewResponse=await fetch(`http://127.0.0.1:${port}/api/channels/qc/live-source-review`,{headers:{cookie:'rplayout_session='+token},signal:AbortSignal.timeout(5000)})
    assert.equal(reviewResponse.status,200);const catalogEtag=reviewResponse.headers.get('etag');assert.ok(catalogEtag)
    await api('/api/sources/live',{channelId:'qc',name:'Estúdio São José — teste QC',kind:'SRT',targetUrl:'srt://127.0.0.1:8890?streamid=read:guest/qc-fixture'},201,{'if-match':catalogEtag})
    const stopFile=join(root,'scratch',`qc-visual-stop-${randomUUID()}.json`),expires=performance.now()+reviewTtl
    console.log(JSON.stringify({status:'BROWSER_REVIEW_READY',directory,url:`http://127.0.0.1:${port}/`,fixtureUser:'qc-verifier',fixturePassword:'Local-QC-fixture-20261009',stopFile,expiresInMs:reviewTtl,stop:'Create the unique stopFile to close this fixture; automatic finite expiry also closes it. Does not rely on tool stdin.'}))
    await wait('Visual fixture stop or finite expiry',async()=>{
      if(performance.now()>=expires)return true
      try{await stat(stopFile);return true}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error}
    },reviewTtl+5000)
    result={result:'BROWSER_REVIEW_STOPPED',directory,port,browserPlaybackValidated:false,physicalInputsValidated:false,note:'Visual evidence is recorded separately, never inferred from this fixture lifetime'}
  }else if(cueTakeOnly){
    const review=(await api('/api/rundowns/rd/operational-simulation')).review
    await api('/api/rundowns/rd/operational-publish',{reviewToken:review.token},201,{'if-match':`w/"${review.editorialRevision}"`})
    const transport=(body:object,status=200)=>api('/api/channels/qc/transport',body,status)
    const ready=()=>wait('Native PVW did not receive current video',async()=> (await snapshot()).live.transport.liveSources.some((s:any)=>s.busStates?.pvw==='PVW_READY'))
    await transport({action:'cue',itemId:'live'})
    await ready()
    const initial=await snapshot()
    assert.equal(initial.live.transport.onAir,null,'CUE must not TAKE')
    assert.deepEqual(initial.live.transport.preview,{kind:'ITEM',id:'live'})
    await transport({action:'cue',itemId:'live'});await ready()
    assert.equal((await snapshot()).live.transport.onAir,null,'Repeated CUE must not TAKE')
    await transport({action:'take'})
    await wait('Implicit TAKE did not select CUE',async()=> (await snapshot()).live.transport.onAir?.itemId==='live')
    const first=await snapshot(),origin=first.live.transport.onAir.startedAt
    await transport({action:'cue',itemId:'live-second'});await ready()
    await api('/api/channels/qc/watching',{bus:'pvw'})
    await wait('Low preview publisher not ready',async()=>Boolean((await mediaPath(first.monitors.preview))?.ready))
    const previewImage=await jpeg(first.monitors.preview,'cue-second')
    assert.equal(previewImage.height,240)
    assert.ok(previewImage.deviation>10,'PVW must deliver real image, not just an ACK')
    const preserved=await snapshot()
    assert.equal(preserved.live.transport.onAir.itemId,'live')
    assert.equal(preserved.live.transport.onAir.startedAt,origin,'CUE must not restart PGM')
    assert.ok(preserved.live.transport.onAir.elapsed>first.live.transport.onAir.elapsed)
    assert.deepEqual(preserved.live.transport.preview,{kind:'ITEM',id:'live-second'})
    await transport({action:'cue',sourceRef:'guest:qc-fixture'})
    await ready()
    await transport({action:'take'},409)
    assert.equal((await snapshot()).live.transport.onAir.itemId,'live','Ambiguous source must preserve PGM')
    await transport({action:'cue',itemId:'live-second'});await ready()
    await transport({action:'take'})
    await wait('TAKE selected something other than second CUE',async()=> (await snapshot()).live.transport.onAir?.itemId==='live-second')
    await transport({action:'cue'})
    await transport({action:'take'},400)
    const after=await snapshot()
    assert.equal(after.live.transport.onAir.itemId,'live-second','No CUE must not fall back to Next')
    assert.equal(after.live.transport.preview,null)
    assert.equal((await mediaPath(after.monitors.inspection))?.ready,false,'CUE/TAKE must not require HQ QC')
    await transport({action:'stop'})
    assert.equal((await snapshot()).live.transport.onAir,null)
    result={result:'PASS',evidence:'COMPILED_API_NATIVE_CUE_TAKE_WITH_REAL_LOW_PVW',directory,port,previewImage,repeatedCue:true,cuePreservesPgmOrigin:true,implicitTakeSelectsCuedItem:true,ambiguousSourceRefused:true,noCueDoesNotTakeNext:true,qcQualityNotRequired:true,browserPlaybackValidated:false,physicalInputsValidated:false}
  }else{
  // QC must tune its own PVW before any playlist publication, TAKE or PGM.
  // The previous PGM-first scenario cannot establish this independence.
  await api('/api/channels/qc/transport',{action:'cue',sourceRef:'guest:qc-fixture',sourceTitle:'Direct QC fixture'})
  await wait('Direct QC did not open PVW before PGM',async()=> (await snapshot()).live.transport.liveSources.some((s:any)=>s.busStates?.pvw==='PVW_READY'))
  const direct=await snapshot(),directViewer=randomUUID()
  assert.equal(direct.live.transport.onAir,null,'Direct QC must not implicitly TAKE')
  assert.equal(direct.live.transport.playing,false,'Direct QC must leave PGM stopped')
  assert.equal(direct.live.transport.preview.source,'guest:qc-fixture')
  assert.equal((await mediaPath('guest/qc-fixture')).readers.length,1,'Direct QC opens only its PVW input')
  assert.equal((await mediaPath(direct.monitors.inspection))?.ready,false,'Direct QC quality starts idle')
  await api('/api/channels/qc/qc/inspection',{viewerId:directViewer,watching:true,sourceRef:'guest:qc-fixture'})
  const directHeartbeat=setInterval(()=>{void api('/api/channels/qc/qc/inspection',{viewerId:directViewer,watching:true,sourceRef:'guest:qc-fixture'}).catch(()=>{})},5000)
  let directQuality:Awaited<ReturnType<typeof jpeg>>
  try{
    await wait('Direct QC quality did not publish before PGM',async()=>Boolean((await mediaPath(direct.monitors.inspection))?.ready))
    directQuality=await jpeg(direct.monitors.inspection,'direct-inspection')
    assert.deepEqual({width:directQuality.width,height:directQuality.height},{width:1280,height:720})
    assert.ok(directQuality.deviation>10 && directQuality.horizontalDetail>30,'Direct QC must deliver actual image, not black')
    const stillStopped=await snapshot()
    assert.equal(stillStopped.live.transport.onAir,null)
    assert.equal(stillStopped.live.transport.playing,false)
    assert.equal((await mediaPath('guest/qc-fixture')).readers.length,1,'Quality reuses direct QC decoder')
  }finally{
    clearInterval(directHeartbeat)
    await api('/api/channels/qc/qc/inspection',{viewerId:directViewer,watching:false,sourceRef:'guest:qc-fixture'})
  }
  await wait('Direct QC quality did not stop',async()=> !(await mediaPath(direct.monitors.inspection))?.ready)
  await writeFile(join(directory,'direct-qc-result.json'),JSON.stringify({result:'PASS',scope:'DIRECT_QC_BEFORE_PGM_API_ONLY',directory,directQuality,inputReaders:1,pgmStopped:true,browserPlaybackValidated:false,cleanupConfirmed:false},null,2))
  const review=(await api('/api/rundowns/rd/operational-simulation')).review
  await api('/api/rundowns/rd/operational-publish',{reviewToken:review.token},201,{'if-match':`w/"${review.editorialRevision}"`})
  await api('/api/channels/qc/transport',{action:'take',itemId:'live'})
  await wait('Native PGM not confirmed',async()=> (await snapshot()).live.transport.onAir?.itemId==='live')
  await api('/api/channels/qc/transport',{action:'cue',sourceRef:'guest:qc-fixture',sourceTitle:'QC fixture'})
  await wait('Native PVW not confirmed',async()=> (await snapshot()).live.transport.liveSources.some((s:any)=>s.busStates?.pvw==='PVW_READY'))
  const before=await snapshot(),inputReaders=(await mediaPath('guest/qc-fixture')).readers.length
  assert.equal(inputReaders,2,'One PGM + one PVW input connection, before QC quality')
  const inspectionPath=before.monitors.inspection,previewPath=before.monitors.preview
  assert.equal(inspectionPath,'qc-isolated/qc')
  assert.equal((await mediaPath(inspectionPath))?.ready,false,'Quality must be idle by default')
  const one=randomUUID(),two=randomUUID(),watch=(viewerId:string,watching:boolean,sourceRef='guest:qc-fixture',status=200)=>api('/api/channels/qc/qc/inspection',{viewerId,watching,sourceRef},status)
  await api('/api/channels/qc/watching',{bus:'pvw'})
  await watch(one,true);await watch(two,true)
  const heartbeat=setInterval(()=>{void watch(two,true).catch(()=>{})},5000)
  try{
    await wait('HQ encoder did not publish',async()=>Boolean((await mediaPath(inspectionPath))?.ready))
    assert.equal((await mediaPath('guest/qc-fixture')).readers.length,inputReaders,'HQ must reuse PVW decoder, no new source connection')
    const low=await jpeg(previewPath,'light'),high=await jpeg(inspectionPath,'inspection')
    assert.equal(low.height,240);assert.deepEqual({width:high.width,height:high.height},{width:1280,height:720})
    // Two-pixel checkers survive 4:2:0 input coding. A 428px upscale cannot
    // recover the lost alternating edges at 1280px. Global variance alone
    // would be fooled by nearest-neighbour aliasing in the cheap preview.
    assert.ok(high.deviation>10 && high.horizontalDetail>30 && high.horizontalDetail>low.horizontalDetail*low.width/high.width*2,`HQ cannot be an upscale of 240p: ${JSON.stringify({low,high})}`)
    const audio=join(directory,'inspection.f32')
    await promisify(execFile)(join(gstBin,'gst-launch-1.0.exe'),['-q','rtspsrc','name=receiver',`location=rtsp://127.0.0.1:8554/${inspectionPath}`,'latency=120','protocols=tcp',
      'receiver.','!','application/x-rtp,media=audio,encoding-name=OPUS','!','queue','!','rtpopusdepay','!','opusdec','!','audioconvert','!','audio/x-raw,format=F32LE,rate=48000,channels=2','!','identity','eos-after=21','!','filesink',`location=${audio.replaceAll('\\','/')}`,
      'receiver.','!','application/x-rtp,media=video','!','queue','!','identity','eos-after=51','!','fakesink','sync=false','async=false'],{windowsHide:true,env:environment,timeout:25_000})
    const samples=await readFile(audio);assert.ok(samples.length>1000 && samples.length%4===0)
    let energy=0;for(let at=0;at<samples.length;at+=4){const value=samples.readFloatLE(at);assert.ok(Number.isFinite(value));energy+=value*value}
    const rms=Math.sqrt(energy/(samples.length/4));assert.ok(rms>0.01 && rms<0.08,`Decoded inspection audio: ${rms}`)
    await watch(one,false);assert.equal((await mediaPath(inspectionPath)).ready,true,'Closing one viewer must preserve the other')
    const during=await snapshot();assert.equal(during.live.transport.onAir.itemId,'live');assert.equal(during.live.transport.preview.source,'guest:qc-fixture');assert.ok(during.live.transport.playing)
    await watch(one,true,'ndi:WRONG',409)
    clearInterval(heartbeat);await watch(two,false)
    await wait('HQ encoder did not stop',async()=> !(await mediaPath(inspectionPath))?.ready)
    await watch(one,true)
    await wait('HQ encoder did not restart',async()=>Boolean((await mediaPath(inspectionPath))?.ready))
    await wait('HQ native/viewer lease did not expire without a heartbeat',async()=> !(await mediaPath(inspectionPath))?.ready,25_000)
    const after=await snapshot();assert.equal(after.live.transport.onAir.itemId,'live');assert.ok(after.live.transport.playing)
    assert.equal((await mediaPath('guest/qc-fixture')).readers.length,inputReaders)
    result={result:'PASS',evidence:'COMPILED_SERVER_NATIVE_LIVE_QC_H264_OPUS',directory,port,directQcBeforePgm:true,directQuality,directQcInputReaders:1,low,high,audioRms:rms,inputReaders,noExtraInputConnection:true,pgmPreserved:true,viewerIsolation:true,idleDefault:true,leaseExpiry:true,browserPlaybackValidated:false,physicalInputsValidated:false}
  }finally{clearInterval(heartbeat)}
  }
  if(sender)assert.equal(sender.exitCode,null)
}catch(error){
  await writeFile(join(directory,'failed-result.json'),JSON.stringify({result:'FAIL',directory,...binaryHashes,scenarioProgress,message:String(error),logs:[...logs.values()],physicalInputsValidated:false,cleanupConfirmed:false},null,2))
  throw error
}finally{
  if(incidentHeartbeat)clearInterval(incidentHeartbeat)
  audioSocket?.close()
  // Retained ChildProcess handles only. Server EOF lets the native broker
  // drain its exact Job family. Historical PIDs are observation, never kills.
  try{
    if(server&&server.exitCode===null&&server.signalCode===null){
      try {for(const row of (await api('/api/processes')).processes??[])if(['ENGINE','MEDIAMTX'].includes(row.kind) && Number.isSafeInteger(row.pid))ownedNative.add(row.pid)}catch{}
    }
    for(const child of children)await stopOwned(child)
    const deadline=performance.now()+10000
    while([...ownedNative].some(alive)&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50))
    assert.ok([...ownedNative].every(pid=>!alive(pid)),'Native family did not drain after owning server exit; no PID kill attempted')
  }finally{database.sqlite.close()}
}
assert.ok(result)
const completed={...result,...binaryHashes,ownedCleanupConfirmed:true,historicalPidKills:false}
await writeFile(join(directory,'result.json'),JSON.stringify(completed,null,2))
console.log(JSON.stringify(completed))
