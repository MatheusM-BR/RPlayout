import assert from 'node:assert/strict'
import {spawn,execFile,type ChildProcess} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createServer} from 'node:net'
import {createSocket} from 'node:dgram'
import {randomUUID} from 'node:crypto'

// Compiled server + real local RTSP input + native encoder/decoder, not UI
// playback, hardware, external networking or certification of color fidelity.
const root=fileURLToPath(new URL('..',import.meta.url))
const directory=await mkdtemp(join(tmpdir(),'RPlayout-qc-live-quality-'))
for(const port of [1935,8554,8888,8889,9997]){
  const socket=createServer()
  await new Promise<void>((resolve,reject)=>{socket.once('error',reject);socket.listen(port,'127.0.0.1',resolve)})
  await new Promise<void>(resolve=>socket.close(()=>resolve()))
}
const udp=createSocket('udp4');await new Promise<void>((resolve,reject)=>{udp.once('error',reject);udp.bind(8890,'127.0.0.1',resolve)});udp.close()
const socket=createServer();await new Promise<void>(resolve=>socket.listen(0,'127.0.0.1',resolve))
const port=(socket.address() as {port:number}).port;await new Promise<void>(resolve=>socket.close(()=>resolve()))
const gstRoot=process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64??'C:/Program Files/gstreamer/1.0/msvc_x86_64',gstBin=join(gstRoot,'bin')
const environment={...process.env,GST_REGISTRY:join(directory,'registry.bin'),GST_PLUGIN_SCANNER:join(gstRoot,'libexec/gstreamer-1.0/gst-plugin-scanner.exe'),GST_PLUGIN_PATH:join(gstRoot,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gstRoot,'lib/gstreamer-1.0'),PATH:gstBin+';'+process.env.PATH}
for(const name of Object.keys(environment))if(name.startsWith('RPLAYOUT_'))delete environment[name]
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json')
const {openDatabase}=await import('../apps/server/src/db/client.js')
const {channels,rundowns,rundownItems,guestKeys,outputProfiles}=await import('../apps/server/src/db/schema.js')
const database=openDatabase(join(directory,'qc.db')),now=new Date().toISOString()
database.db.insert(channels).values({id:'qc',name:'QC isolated',width:640,height:360,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:now}).run()
database.db.insert(rundowns).values({id:'rd',channelId:'qc',name:'QC test',date:now.slice(0,10),plannedStart:0,loop:false,createdAt:now,updatedAt:now}).run()
database.db.insert(rundownItems).values({id:'live',rundownId:'rd',sortOrder:0,title:'Live fixture',type:'LIVE',sourceRef:'guest:qc-fixture',durationOverride:25_000,minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',autoNext:false,loop:false,locked:false}).run()
database.db.insert(guestKeys).values({id:'guest',channelId:'qc',label:'Local fixture',streamKey:'qc-fixture',enabled:true,createdAt:now}).run()
// PGM stays native/null, not a physical or network output under test.
database.db.insert(outputProfiles).values({id:'pgm',channelId:'qc',name:'Disabled external PGM',kind:'RTMP',target:'',role:'PROGRAM',enabled:false,createdAt:now}).run()
const children=new Set<ChildProcess>(),logs=new Map<ChildProcess,string>(),ownedNative=new Set<number>()
let server:ChildProcess|null=null
function launch(binary:string,args:string[],env:NodeJS.ProcessEnv=environment){
  const child=spawn(binary,args,{cwd:directory,env,windowsHide:true,stdio:['ignore','pipe','pipe']});children.add(child);logs.set(child,'')
  for(const stream of [child.stdout,child.stderr])stream?.on('data',data=>logs.set(child,(logs.get(child)+String(data)).slice(-8000)))
  child.on('error',error=>logs.set(child,String(error)))
  return child
}
async function wait(message:string,predicate:()=>boolean|Promise<boolean>,timeout=40_000){
  const end=performance.now()+timeout
  while(performance.now()<end){if(await predicate())return;assert.ok(!server||server.exitCode===null,'Server exited: '+logs.get(server!));await new Promise(resolve=>setTimeout(resolve,150))}
  throw new Error(message+'\n'+[...logs.values()].join('\n').slice(-6000))
}
async function api(path:string,body?:object,status=200,headers:Record<string,string>={}){
  const response=await fetch(`http://127.0.0.1:${port}${path}`,{...(body?{method:'POST',body:JSON.stringify(body)}:{}),headers:{...(body?{'content-type':'application/json'}:{}),...headers},signal:AbortSignal.timeout(45_000)})
  const data=await response.json() as any;assert.equal(response.status,status,JSON.stringify(data));return data
}
const mediaPath=async(name:string)=>{try{const response=await fetch(`http://127.0.0.1:9997/v3/paths/get/${name}`,{signal:AbortSignal.timeout(3000)});return response.ok?await response.json() as any:null}catch{return null}}
const snapshot=()=>api('/api/rundowns/rd')
async function jpeg(path:string,name:string){
  // MediaMTX can replay the encoder's initial black IDR to a new reader.
  // Decode 50 actual frames and inspect the last one, not that startup GOP.
  const file=join(directory,`${name}-49.jpg`),pattern=join(directory,`${name}-%02d.jpg`),raw=join(directory,`${name}.gray`)
  await promisify(execFile)(join(gstBin,'gst-launch-1.0.exe'),['-q','rtspsrc',`location=rtsp://127.0.0.1:8554/${path}`,'latency=120','!','rtph264depay','!','h264parse','!','avdec_h264','!','videoconvert','!','jpegenc','!','identity','eos-after=51','!','multifilesink',`location=${pattern.replaceAll('\\','/')}`],{windowsHide:true,env:environment,timeout:25_000})
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
  server=launch(process.execPath,[join(root,'apps/server/dist/server.cjs')],{...environment,RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_DB:join(directory,'qc.db'),RPLAYOUT_VAULT_FILE:join(directory,'vault.json'),RPLAYOUT_MEDIA:directory,RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_CACHE_DIR:join(directory,'cache'),RPLAYOUT_BACKUP_DIR:join(directory,'backups'),RPLAYOUT_ENGINE:join(root,'apps/engine/target/release/rplayout-engine.exe'),RPLAYOUT_ENGINE_OUTPUT:'null',RPLAYOUT_MEDIAMTX:join(root,'release/RPlayout-1.1-broadcast-20261004-r23/mediamtx/mediamtx.exe'),RPLAYOUT_MEDIAMTX_BIND:'127.0.0.1',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_DEVICES:'',RPLAYOUT_RELAY:'',RPLAYOUT_ADMIN_USER:'',RPLAYOUT_ADMIN_PASSWORD:'',RPLAYOUT_CONTROL_TOKEN:'',RPLAYOUT_ROLE:'ADMIN',RPLAYOUT_BACKUP_HOURS:'0',HOST:'127.0.0.1',PORT:String(port),LOG_LEVEL:'warn'})
  await wait('Server/MediaMTX not ready',async()=>{try{return (await api('/api/health')).ok && Boolean(await mediaPath('guest/qc-fixture'))}catch{return false}})
  const sender=launch(join(gstBin,'gst-launch-1.0.exe'),['-q','mpegtsmux','name=m','alignment=7','latency=500000000','!','srtsink','uri=srt://127.0.0.1:8890?streamid=publish:guest/qc-fixture','videotestsrc','is-live=true','pattern=checkers-2','!','video/x-raw,format=I420,width=1280,height=720,framerate=25/1','!','videoconvert','!','x264enc','threads=2','speed-preset=ultrafast','tune=zerolatency','bitrate=6000','key-int-max=25','!','h264parse','!','queue','!','m.','audiotestsrc','is-live=true','freq=997','volume=0.05','!','audio/x-raw,rate=48000,channels=2','!','audioconvert','!','avenc_aac','!','aacparse','!','queue','!','m.'])
  await wait('Fixture signal not published',async()=>Boolean((await mediaPath('guest/qc-fixture'))?.ready))
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
    await promisify(execFile)(join(gstBin,'gst-launch-1.0.exe'),['-q','rtspsrc',`location=rtsp://127.0.0.1:8554/${inspectionPath}`,'latency=120','!','rtpopusdepay','!','opusdec','!','audioconvert','!','audio/x-raw,format=F32LE,rate=48000,channels=2','!','identity','eos-after=21','!','filesink',`location=${audio.replaceAll('\\','/')}`],{windowsHide:true,env:environment,timeout:25_000})
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
    console.log(JSON.stringify({result:'PASS',evidence:'COMPILED_SERVER_NATIVE_LIVE_QC_H264_OPUS',directory,port,low,high,audioRms:rms,inputReaders,noExtraInputConnection:true,pgmPreserved:true,viewerIsolation:true,idleDefault:true,leaseExpiry:true,browserPlaybackValidated:false,physicalInputsValidated:false}))
  }finally{clearInterval(heartbeat)}
  assert.equal(sender.exitCode,null)
}finally{
  // Only owned fixtures. Graceful shutdown lets the server stop its engine
  // and MediaMTX; explicit owned PIDs are fallback, never broad process kills.
  if(server && server.exitCode===null && server.signalCode===null){
    try {for(const row of (await api('/api/processes')).processes??[])if(['ENGINE','MEDIAMTX'].includes(row.kind) && Number.isSafeInteger(row.pid))ownedNative.add(row.pid)}catch{}
    server.kill();await Promise.race([new Promise<void>(resolve=>server!.once('exit',()=>resolve())),new Promise<void>(resolve=>setTimeout(resolve,5000))])
  }
  for(const child of children)if(child.exitCode===null&&child.signalCode===null){const ended=new Promise<void>(resolve=>child.once('exit',()=>resolve()));child.kill('SIGKILL');await ended}
  for(const pid of ownedNative){try{process.kill(pid,'SIGKILL')}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error}}
  database.sqlite.close()
}
