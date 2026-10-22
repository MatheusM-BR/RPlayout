import assert from 'node:assert/strict'
import {spawn,execFile,type ChildProcess} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {createServer} from 'node:net'

// Isolated compiled server/release engine. Local files + null output only.
// No operational DB, browser, network source or DeckLink board is touched.
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(tmpdir(),'RPlayout-audio-routing-'))
const audioChannels=Number(process.env.RPLAYOUT_VERIFY_AUDIO_CHANNELS??2)
assert.ok([2,8,16].includes(audioChannels),'RPLAYOUT_VERIFY_AUDIO_CHANNELS deve ser 2, 8 ou 16.')
const auxiliaryPairs=audioChannels===2?[]:[{outputPair:2,inputPair:2,gainDb:-6},{outputPair:audioChannels/2,inputPair:1,gainDb:-12}]
const partialAudioMetadata=process.env.RPLAYOUT_VERIFY_PARTIAL_AUDIO_METADATA==='1'
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json')
const gstRoot=process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64??'C:/Program Files/gstreamer/1.0/msvc_x86_64',gstBin=join(gstRoot,'bin')
const env={...process.env,GST_REGISTRY:join(directory,'gst-registry.bin'),GST_PLUGIN_SCANNER:join(gstRoot,'libexec/gstreamer-1.0/gst-plugin-scanner.exe'),GST_PLUGIN_PATH:join(gstRoot,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gstRoot,'lib/gstreamer-1.0'),PATH:gstBin+';'+process.env.PATH}
for(const name of Object.keys(env))if(name.startsWith('RPLAYOUT_'))delete env[name]
// The isolated child must not fall back to an installation/operational vault.
env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json')
const media=join(directory,'media');await mkdir(media)
const {openDatabase}=await import('../apps/server/src/db/client.js')
const {channels,rundowns,rundownItems,mediaAssets,operationalPlaylistRevisions}=await import('../apps/server/src/db/schema.js')
const {localDate}=await import('../apps/server/src/domain/rundown-clock.js')
const database=openDatabase(join(directory,'audio.db'))
const reservation=createServer();await new Promise<void>(resolve=>reservation.listen(0,'127.0.0.1',resolve))
const port=(reservation.address() as {port:number}).port;await new Promise<void>(resolve=>reservation.close(()=>resolve()))
const base=`http://127.0.0.1:${port}`;let child:ChildProcess|null=null,enginePid:number|undefined,diagnostics=''
let result:Record<string,unknown>|null=null,failure:unknown=null
async function api(path:string,body?:object,expected=200,headers:Record<string,string>={}){
  const reply=await fetch(base+'/api'+path,{...(body?{method:'POST',body:JSON.stringify(body)}:{}),headers:{...(body?{'Content-Type':'application/json'}:{}),...headers},signal:AbortSignal.timeout(20_000)})
  const text=await reply.text();assert.equal(reply.status,expected,`${path}: ${text}`);return JSON.parse(text)
}
async function wait(message:string,check:()=>Promise<boolean>,timeout=20_000){
  const end=performance.now()+timeout;while(performance.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,100))}throw new Error(message+'; '+diagnostics.slice(-3000))
}
const snapshot=()=>api('/rundowns/rd'),transport=(body:object)=>api('/channels/audio/transport',body)
const setAudio=async(id:string,routing:object,gainDb=0,audioTrack=0,expected=200)=>{
  const view=(await snapshot()).view
  return api(`/items/${id}/audio`,{scope:'ITEM',audioTrack,audio:{mode:'MANUAL',gainDb,measured:null,routing,auxiliaryPairs}},expected,{'if-match':`w/"${view.editorialRevision}"`})
}
async function startServer(){
  child=spawn(process.execPath,[join(root,'apps/server/dist/server.cjs')],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...env,RPLAYOUT_DB:join(directory,'audio.db'),RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_MEDIA:media,RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_CACHE:join(directory,'cache'),RPLAYOUT_BACKUPS:join(directory,'backups'),RPLAYOUT_ENGINE:join(root,'apps/engine/target/release/rplayout-engine.exe'),RPLAYOUT_AUDIO_ANALYSIS:join(root,'apps/engine/target/release/rplayout-audio-analysis.exe'),RPLAYOUT_ENGINE_OUTPUT:'null',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_DEVICES:'',RPLAYOUT_RELAY:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_N1_PEER:'',RPLAYOUT_BACKUP_HOURS:'0',RPLAYOUT_ADMIN_USER:'',RPLAYOUT_ADMIN_PASSWORD:'',RPLAYOUT_ROLE:'ADMIN',RPLAYOUT_CONTROL_TOKEN:'',HOST:'127.0.0.1',PORT:String(port),LOG_LEVEL:'warn'}})
  for(const stream of [child.stdout,child.stderr])stream?.on('data',chunk=>{diagnostics=(diagnostics+String(chunk)).slice(-8000)})
  child.on('error',error=>{diagnostics+=String(error)})
  await wait('Servidor não iniciou',async()=>{try{return (await api('/health')).engines===1}catch{return false}})
  enginePid=(await api('/processes')).processes.find((row:any)=>row.kind==='ENGINE'&&row.channelId==='audio')?.pid;assert.ok(enginePid)
}
async function stopServer(){
  const own=child;if(!own)return
  if(own.exitCode===null&&own.signalCode===null){
    const ended=new Promise<void>(resolve=>own.once('exit',()=>resolve()));own.kill('SIGKILL')
    let timer:ReturnType<typeof setTimeout>|undefined
    try{await Promise.race([ended,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Owned server did not exit')),10000)})])}finally{if(timer)clearTimeout(timer)}
  }
  child=null
  if(enginePid)await wait('Engine próprio não encerrou com EOF',async()=>{try{process.kill(enginePid!,0);return false}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return true;throw error}})
  enginePid=undefined // Observe old PID only for drainage; never terminate it.
}
try{
  const stamp=new Date().toISOString()
  database.db.insert(channels).values({id:'audio',name:'Mix isolado',audioChannels:audioChannels as 2|8|16,rateNum:25,rateDen:1,width:320,height:180,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:stamp}).run()
  database.db.insert(rundowns).values({id:'rd',channelId:'audio',name:'Áudio',date:localDate(new Date()),plannedStart:0,loop:false,publicationRequired:true,createdAt:stamp,updatedAt:stamp}).run()
  for(const count of [4,2]){
    const path=join(media,`AÇÃO-${count}-canais.mkv`),target=path.replaceAll('\\','/')
    const args=['-q','matroskamux','name=m','!','filesink',`location=${target}`,'videotestsrc','num-buffers=1250','!','video/x-raw,width=160,height=90,framerate=25/1','!','videoconvert','!','vp8enc','deadline=1','!','queue','!','m.video_0','interleave','name=join','channel-positions-from-input=false','!','audio/x-raw,format=F32LE,rate=48000,channels='+count+',channel-mask=(bitmask)0x0','!','queue','!','m.audio_0']
    for(let i=0;i<count;i++)args.push('audiotestsrc','num-buffers=2500','wave=sine',`freq=${(i+1)*300}`,`volume=${(i+1)/10}`,'!','audio/x-raw,format=F32LE,rate=48000,channels=1','!',`join.sink_${i}`)
    if(count===4){
      args.push('interleave','name=alternate','channel-positions-from-input=false','!','audio/x-raw,format=F32LE,rate=48000,channels=4,channel-mask=(bitmask)0x0','!','queue','!','m.audio_1')
      for(let i=0;i<4;i++)args.push('audiotestsrc','num-buffers=2500','wave=sine',`freq=${(i+1)*500}`,`volume=${(i+1)/100}`,'!','audio/x-raw,format=F32LE,rate=48000,channels=1','!',`alternate.sink_${i}`)
    }
    await promisify(execFile)(join(gstBin,'gst-launch-1.0.exe'),args,{timeout:60_000,windowsHide:true,env})
    database.db.insert(mediaAssets).values({id:'asset'+count,title:'ÁUDIO '+count,path,contentHash:createHash('sha256').update(await readFile(path)).digest('hex'),kind:'VIDEO',durationFrames:1250,durationNs:50_000_000_000,width:160,height:90,rateNum:25,rateDen:1,interlaceMode:'progressive',hasAudio:true,audioChannels:count===4?4:null,audioTracks:count===4?[{index:0,channels:4,rate:48000}]:null,qcStatus:'APPROVED',createdAt:stamp}).run()
    database.db.insert(rundownItems).values({id:'vt'+count,rundownId:'rd',sortOrder:count===4?0:10,title:'Áudio '+count,type:'VT',mediaId:'asset'+count,minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',autoNext:false,loop:false,locked:false}).run()
    if(count===4)database.sqlite.prepare('UPDATE media_assets SET audio_tracks=? WHERE id=?').run(JSON.stringify([{index:0,channels:4,rate:48000},{index:1,channels:4,rate:48000}]),'asset4')
    if(count===4){
      const output=await promisify(execFile)(join(root,'apps/engine/target/release/rplayout-audio-analysis.exe'),[path,JSON.stringify({audioTrack:0,routing:{mode:'DEFAULT'}})],{timeout:60000,windowsHide:true,env})
      const measured=JSON.parse(output.stdout);assert.equal(measured.ok,true)
      database.sqlite.prepare('UPDATE media_assets SET loudness_file=? WHERE id=?').run(JSON.stringify({integratedLufs:measured.integratedLufs,lra:measured.lra,truePeakDbtp:measured.truePeakDbtp,scope:'FILE',measuredAt:new Date().toISOString()}),'asset4')
    }
    if(partialAudioMetadata&&count===4)database.sqlite.prepare("UPDATE media_assets SET has_audio=NULL,audio_channels=NULL,audio_tracks=NULL WHERE id='asset4'").run()
  }
  await startServer()
  assert.equal((await api('/state')).channels.find((row:any)=>row.id==='audio')?.audioChannels,audioChannels)
  await setAudio('vt4',{mode:'STEREO_3_4'});await setAudio('vt2',{mode:audioChannels===2?'STEREO_3_4':'STEREO_1_2'})
  const publish=async()=>{const {review}=await api('/rundowns/rd/operational-simulation');return api('/rundowns/rd/operational-publish',{reviewToken:review.token},201,{'if-match':`w/"${review.editorialRevision}"`})}
  const revision=(await publish()).id
  await api('/channels/audio/load-rundown',{rundownId:'rd'})
  assert.equal((await snapshot()).live.transport.playing,false)
  await transport({action:'take',itemId:'vt4'})
  let peaks:number[]=[];await wait('Par 3-4 não chegou ao PGM',async()=>{const result=await snapshot();peaks=result.live.meters.program.peakDbfs;return result.live.transport.onAir?.itemId==='vt4'&&peaks.length===2&&peaks.every((p:number,i:number)=>Math.abs(p-20*Math.log10((i+3)/10))<0.5)})
  const selectedPairPeaks=[...peaks]
  // Legacy metadata deliberately unknown: the real caps, not a DB guess,
  // must reject 3-4 on a two-channel file and leave the current PGM intact.
  const invalid=await fetch(base+'/api/channels/audio/transport',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'take',itemId:'vt2'})});assert.ok(invalid.status>=400,await invalid.text())
  assert.equal((await snapshot()).live.transport.onAir.itemId,'vt4')
  await transport({action:'stop'})
  await setAudio('vt4',{mode:'STEREO_1_2'},-6);const second=(await publish()).id
  await transport({action:'take',itemId:'vt4'})
  await wait('Par 1-2/ganho não chegou ao PGM',async()=>{peaks=(await snapshot()).live.meters.program.peakDbfs;return peaks.length===2&&peaks.every((p:number,i:number)=>Math.abs(p-(20*Math.log10((i+1)/10)-6))<0.5)})
  const gainAfterRoutingPeaks=[...peaks]
  await transport({action:'stop'})
  const fileBefore=await snapshot(),fileMeasurement=fileBefore.view.items.find((entry:any)=>entry.item.id==='vt4').asset.loudnessFile
  assert.ok(fileMeasurement)
  await api('/items/vt4/audio',{scope:'ITEM',audioTrack:0,audio:{mode:'AUTO',gainDb:20,routing:{mode:'DEFAULT'},measured:{...fileMeasurement,scope:'TRIM',integratedLufs:10}}},200,{'if-match':`w/"${fileBefore.view.editorialRevision}"`})
  const fileRevision=(await publish()).id
  await transport({action:'take',itemId:'vt4'})
  let fileAutoPgmLufs=0
  await wait('AUTO padrão não usou a medição real do acervo',async()=>{fileAutoPgmLufs=(await snapshot()).live.meters.program.integratedLufs;return Math.abs(fileAutoPgmLufs+23)<0.3})
  assert.deepEqual((await snapshot()).view.items.find((entry:any)=>entry.item.id==='vt4').audio.measured,fileMeasurement)
  const beforeAnalysis=await snapshot(),hash=beforeAnalysis.view.items.find((entry:any)=>entry.item.id==='vt4').asset.contentHash
  const queued=await api('/items/vt4/audio-analysis',{contentHash:hash,audioTrack:0,routing:{mode:'STEREO_3_4'}},202,{'if-match':`w/"${beforeAnalysis.view.editorialRevision}"`})
  let analysis:any;await wait('Mix não foi medido',async()=>{analysis=(await api('/items/vt4/audio-analysis/'+queued.analysis.id)).analysis;assert.notEqual(analysis.state,'FAILED',JSON.stringify(analysis));return analysis.state==='READY'})
  const afterAnalysis=await snapshot();assert.equal(afterAnalysis.view.editorialRevision,beforeAnalysis.view.editorialRevision);assert.equal(afterAnalysis.live.transport.onAir.itemId,'vt4')
  assert.equal(analysis.measurement.input.contentHash,hash);assert.equal(analysis.measurement.input.routing.mode,'STEREO_3_4')
  await transport({action:'stop'})
  const firstPid=child!.pid,firstEnginePid=enginePid;await stopServer();await startServer()
  const persisted=(await api('/items/vt4/audio-analysis/'+analysis.id)).analysis;assert.equal(persisted.state,'READY');assert.deepEqual(persisted.measurement,analysis.measurement)
  assert.equal((await snapshot()).live.transport.playing,false)
  const beforeCut=(await snapshot()).view.editorialRevision
  await api('/items/vt4/trim',{scope:'ITEM',trim:{in:25,out:275}},200,{'if-match':`w/"${beforeCut}"`})
  const cutSnapshot=await snapshot(),cutRevision=cutSnapshot.view.editorialRevision
  const trimQueued=await api('/items/vt4/audio-analysis',{contentHash:hash,audioTrack:0,routing:{mode:'STEREO_3_4'},scope:'TRIM'},202,{'if-match':`w/"${cutRevision}"`})
  let trimAnalysis:any
  await wait('Trecho não foi medido na API compilada',async()=>{trimAnalysis=(await api('/items/vt4/audio-analysis/'+trimQueued.analysis.id)).analysis;assert.notEqual(trimAnalysis.state,'FAILED',JSON.stringify(trimAnalysis));return trimAnalysis.state==='READY'})
  assert.equal(trimAnalysis.measurement.scope,'TRIM')
  assert.deepEqual(trimAnalysis.trim,{inNs:1e9,outNs:11e9});assert.deepEqual(trimAnalysis.measurement.input.trim,trimAnalysis.trim)
  assert.equal((await snapshot()).view.editorialRevision,cutRevision)
  await api('/items/vt4/audio',{scope:'ITEM',audioTrack:0,audio:{mode:'AUTO',gainDb:20,measured:null,routing:{mode:'STEREO_3_4'},analysisId:trimAnalysis.id}},200,{'if-match':`w/"${cutRevision}"`})
  const trimPublished=(await publish()).id;await transport({action:'take',itemId:'vt4'})
  let trimAutoPgmLufs=0;await wait('AUTO do corte não chegou ao PGM',async()=>{trimAutoPgmLufs=(await snapshot()).live.meters.program.integratedLufs;return Math.abs(trimAutoPgmLufs+23)<0.3})
  const beforeTrimChange=await snapshot(),trimStartedAt=beforeTrimChange.live.transport.onAir.startedAt
  await api('/items/vt4/trim',{scope:'ITEM',trim:{in:25,out:300}},200,{'if-match':`w/"${beforeTrimChange.view.editorialRevision}"`})
  const changedTrim=await snapshot(),changedTrimRevision=changedTrim.view.editorialRevision
  await api('/items/vt4/audio',{scope:'ITEM',audioTrack:0,audio:{mode:'AUTO',gainDb:0,measured:null,routing:{mode:'STEREO_3_4'},analysisId:trimAnalysis.id}},409,{'if-match':`w/"${changedTrimRevision}"`})
  await api('/rundowns/rd/operational-simulation',undefined,409)
  assert.equal((await snapshot()).live.transport.onAir.startedAt,trimStartedAt)
  await transport({action:'stop'})
  await setAudio('vt4',{mode:'STEREO_3_4'},0,0)
  const afterManual=(await snapshot()).view.editorialRevision
  await api('/items/vt4/trim',{scope:'ITEM',trim:{in:0,out:1250}},200,{'if-match':`w/"${afterManual}"`})
  await setAudio('vt4',{mode:'STEREO_3_4'},0,1)
  const alternateRevision=(await publish()).id
  await transport({action:'take',itemId:'vt4'})
  let alternateTrackPeaks:number[]=[]
  await wait('Segunda trilha não chegou ao PGM',async()=>{alternateTrackPeaks=(await snapshot()).live.meters.program.peakDbfs;return alternateTrackPeaks.length===2&&alternateTrackPeaks.every((p:number,i:number)=>Math.abs(p-(selectedPairPeaks[i]-20))<0.5)})
  assert.equal(database.db.select().from(operationalPlaylistRevisions).all().find(row=>row.id===alternateRevision)!.payload.items.find(item=>item.id==='vt4')!.audioTrack,1)
  const trackRevision=(await snapshot()).view.editorialRevision
  await api('/items/vt4/audio',{scope:'ITEM',audioTrack:1,audio:{mode:'AUTO',gainDb:0,measured:null,routing:{mode:'STEREO_3_4'},analysisId:analysis.id}},409,{'if-match':`w/"${trackRevision}"`})
  const refusedTrack=await snapshot()
  assert.equal(refusedTrack.view.editorialRevision,trackRevision)
  assert.equal(refusedTrack.live.transport.onAir.itemId,'vt4')
  await transport({action:'stop'})
  await api('/items/vt4/audio',{scope:'ITEM',audioTrack:0,audio:{mode:'AUTO',gainDb:20,measured:null,routing:{mode:'STEREO_3_4'},auxiliaryPairs,analysisId:analysis.id}},200,{'if-match':`w/"${trackRevision}"`})
  const third=(await publish()).id;await transport({action:'take',itemId:'vt4'})
  let normalizedLufs=0;await wait('AUTO não levou o mix ao alvo no PGM',async()=>{normalizedLufs=(await snapshot()).live.meters.program.integratedLufs;return Math.abs(normalizedLufs+23)<0.3})
  const current=await snapshot(),frozen=database.db.select().from(operationalPlaylistRevisions).all().find(row=>row.id===third)!
  assert.equal(frozen.payload.audioChannels,audioChannels)
  assert.deepEqual(current.view.items.find((entry:any)=>entry.item.id==='vt4').audio.auxiliaryPairs,auxiliaryPairs)
  result={result:'PASS',evidence:'COMPILED_SERVER_RELEASE_ENGINE_ACTUAL_MASTER_PGM_METER_AND_MIX_LOUDNESS',audioChannels,auxiliaryPairs,partialAudioMetadata,directory,port,serverPids:[firstPid,child!.pid],enginePids:[firstEnginePid,enginePid],revision,secondRevision:second,thirdRevision:third,selectedPairPeaks,gainAfterRoutingPeaks,analysisId:analysis.id,measuredMixLufs:analysis.measurement.integratedLufs,normalizedPgmLufs:normalizedLufs,analysisSurvivesServerRestart:true,analysisPreservesPgmAndEditorialRevision:true,invalidRealChannelsPreservedProgram:true,physicalOutputValidated:false,liveNetworkSourceValidated:false,previewPublisherEnabled:false,cueValidated:false}
  Object.assign(result!,{alternateRevision,alternateTrackPeaks,actualSecondTrackValidated:true,wrongTrackAnalysisRefusedWithoutMutation:true,fileRevision,fileAutoPgmLufs,defaultAutoIgnoresForgedClientTrimMeasurement:true,trimAnalysisId:trimAnalysis.id,compiledTrimMeasurementValidated:true,trimIdentity:trimAnalysis.trim,trimAnalysisPreservesEditorialRevision:true,trimPublished,trimAutoPgmLufs,changedTrimAnalysisAndPublicationRefused:true,changedTrimPreservesMountedPgm:true})
}catch(error){failure=error}finally{
  try{await stopServer()}catch(error){failure??=error}
  database.sqlite.close()
  const evidence=failure?{result:'FAIL',directory,error:String(failure),stack:failure instanceof Error?failure.stack:null}:result
  await writeFile(join(directory,'server.log'),diagnostics)
  await writeFile(join(directory,failure?'failure.json':'result.json'),JSON.stringify(evidence,null,2))
  console.log(JSON.stringify(evidence));if(failure)process.exitCode=1
}
