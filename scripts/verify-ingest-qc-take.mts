import assert from 'node:assert/strict'
import {spawn,execFile,type ChildProcess} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {createServer} from 'node:net'
import {createSocket} from 'node:dgram'
import {verifyPublishedPicture} from './lib/verify-published-picture.js'
import {DEFAULT_QC_PROFILE} from '../packages/protocol/src/qc.js'
import {scanETag} from '../packages/protocol/src/scan-review.js'

// Real scanner/probe/archive/proxy, compiled HTTP and native file PGM.
// Seed only channel/editorial shell, NEVER media metadata or QC decisions.
// Null output is not a physical publisher, browser or live CUE approval.
const sourceRoot=fileURLToPath(new URL('..',import.meta.url))
const installedArgument=process.argv.find(value=>value.startsWith('--installed-package='))
const root=installedArgument?resolve(installedArgument.slice('--installed-package='.length)):sourceRoot
const serverArgument=process.argv.find(value=>value.startsWith('--server-binary='))
const serverBinary=serverArgument?resolve(serverArgument.slice('--server-binary='.length)):join(root,'apps/server/dist/server.cjs')
if(installedArgument)assert.equal(resolve(process.execPath).toLowerCase(),join(root,'runtime/node/node.exe').toLowerCase(),'Installed package must use bundled Node')
const sourceReplacementOnly=process.argv.includes('--source-replacement')
const cueQcOnly=process.argv.includes('--cue-qc')
const loudnessProfileOnly=process.argv.includes('--loudness-profile')
const strictProbeOnly=process.argv.includes('--strict-probe')
if([sourceReplacementOnly,cueQcOnly,loudnessProfileOnly,strictProbeOnly].filter(Boolean).length>1)throw new Error('Select exactly one directed mode')
if(cueQcOnly){
  // Refuse occupied ports. Never stop/reuse another installation's broker.
  for(const port of [1935,8554,8888,8889,9997]){
    const socket=createServer();await new Promise<void>((resolve,reject)=>{socket.once('error',reject);socket.listen(port,'127.0.0.1',resolve)})
    await new Promise<void>(resolve=>socket.close(()=>resolve()))
  }
  const udp=createSocket('udp4');await new Promise<void>((resolve,reject)=>{udp.once('error',reject);udp.bind(8890,'127.0.0.1',resolve)});udp.close()
}
const directory=await mkdtemp(join(installedArgument?join(sourceRoot,'scratch'):tmpdir(),'RPlayout-ingest-qc-take-'))
const media=join(directory,'Acervo-ação-ÇÃO');await mkdir(media)
const gstRoot=installedArgument?join(root,'runtime/gstreamer'):process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64??'C:/Program Files/gstreamer/1.0/msvc_x86_64'
const gstBin=join(gstRoot,'bin'),environment={...process.env,PATH:gstBin+';'+process.env.PATH,GST_PLUGIN_PATH:join(gstRoot,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gstRoot,'lib/gstreamer-1.0'),GST_PLUGIN_SCANNER:join(gstRoot,'libexec/gstreamer-1.0/gst-plugin-scanner.exe'),GST_REGISTRY:join(directory,'registry.bin')}
for(const name of Object.keys(environment))if(name.startsWith('RPLAYOUT_')||name==='NODE_OPTIONS')delete environment[name]
if(installedArgument){
  environment.PATH=gstBin+';'+join(root,'runtime/node')+';'+join(process.env.SystemRoot!,'System32')
  delete environment.NODE_PATH
}
const run=promisify(execFile),file=join(media,'Programação-ação-ÇÃO.mkv')
await run(join(gstBin,'gst-launch-1.0.exe'),['-q','matroskamux','name=m','!','filesink',`location=${file.replaceAll('\\','/')}`,'videotestsrc','num-buffers=1500',cueQcOnly?'pattern=smpte':'pattern=ball','!','video/x-raw,width=320,height=180,framerate=25/1','!','videoconvert','!','vp8enc','deadline=1','threads=2','!','queue','!','m.','audiotestsrc','num-buffers=2813','samplesperbuffer=1024','volume=0.05','!','audio/x-raw,rate=48000,channels=2','!','audioconvert','!','vorbisenc','!','queue','!','m.'],{env:environment,windowsHide:true,timeout:60000})
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex'),mediaHash=sha(await readFile(file))
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json')
const {openDatabase}=await import('../apps/server/src/db/client.js')
const {channels,rundowns,outputProfiles}=await import('../apps/server/src/db/schema.js')
const database=openDatabase(join(directory,'workflow.db')),stamp=new Date().toISOString()
database.db.insert(channels).values({id:'qc',name:'Isolated QC workflow',width:320,height:180,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:stamp}).run()
database.db.insert(rundowns).values({id:'rd',channelId:'qc',name:'Actual ingest workflow',date:'2026-10-08',plannedStart:0,loop:false,createdAt:stamp,updatedAt:stamp}).run()
database.db.insert(outputProfiles).values({id:'disabled',channelId:'qc',name:'No external output',kind:'RTMP',target:'',role:'PROGRAM',enabled:false,createdAt:stamp}).run()
const listener=createServer();await new Promise<void>(resolve=>listener.listen(0,'127.0.0.1',resolve))
const port=(listener.address() as {port:number}).port;await new Promise<void>(resolve=>listener.close(()=>resolve()))
let server:ChildProcess|null=null,logs='',result:Record<string,unknown>|null=null,failure:unknown=null
const ownNativePids=new Set<number>()
async function request(path:string,body?:object,status=200,headers:Record<string,string>={},method=body?'POST':'GET'){
  const response=await fetch(`http://127.0.0.1:${port}${path}`,{method,headers:{...(body?{'content-type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)})
  const data=await response.json() as any
  assert.equal(response.status,status,path+' '+JSON.stringify(data));return {data,etag:response.headers.get('etag')!}
}
async function wait(label:string,predicate:()=>Promise<boolean>,timeout=60000){
  const deadline=performance.now()+timeout
  while(performance.now()<deadline){if(await predicate())return;assert.ok(server?.exitCode===null&&server?.signalCode===null,logs);await new Promise(resolve=>setTimeout(resolve,150))}
  throw new Error(label+'\n'+logs)
}
const snapshot=async()=>(await request('/api/rundowns/rd')).data
async function actualPreview(path:string){
  // A late receiver must wait for a keyframe, not accept concealment frames.
  // Keep the picture/dimension criteria; monitor never upscales this180p bus.
  return verifyPublishedPicture({gstBin,directory,path,width:320,height:180,environment,label:'installed-cue'})
}
async function stop(){
  if(server?.exitCode===null&&server.signalCode===null){
    try{for(const row of (await request('/api/processes')).data.processes??[])if(Number.isSafeInteger(row.pid)&&row.pid!==server.pid)ownNativePids.add(row.pid)}catch{}
    const current=server,exited=new Promise<void>(resolve=>current.once('exit',()=>resolve()));current.kill('SIGKILL')
    let timer:ReturnType<typeof setTimeout>|undefined
    try{await Promise.race([exited,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Owned server did not exit')),10000)})])}finally{if(timer)clearTimeout(timer)}
  }
  const alive=(pid:number)=>{try{process.kill(pid,0);return true}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return false;throw error}}
  const end=performance.now()+15000
  while([...ownNativePids].some(alive)&&performance.now()<end)await new Promise(resolve=>setTimeout(resolve,100))
  assert.ok([...ownNativePids].every(pid=>!alive(pid)),'Own native family did not drain; no historical PID killed')
}
try{
  const brokerBinary=cueQcOnly?join(root,installedArgument?'mediamtx/mediamtx.exe':'release/RPlayout-1.1-parcial-20261008-r24/mediamtx/mediamtx.exe'):''
  server=spawn(process.execPath,[serverBinary],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...environment,RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_DB:join(directory,'workflow.db'),RPLAYOUT_VAULT_FILE:join(directory,'vault.json'),RPLAYOUT_MEDIA:media,RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_CACHE_DIR:join(directory,'cache'),RPLAYOUT_BACKUPS:join(directory,'backups'),RPLAYOUT_ENGINE:join(root,'apps/engine/target/release/rplayout-engine.exe'),RPLAYOUT_ENGINE_OUTPUT:'null',RPLAYOUT_PROBE:join(root,'apps/engine/target/release/rplayout-probe.exe'),RPLAYOUT_PROXY:join(root,'apps/engine/target/release/rplayout-proxy.exe'),RPLAYOUT_MEDIAMTX:brokerBinary,RPLAYOUT_MEDIAMTX_BIND:'127.0.0.1',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_DEVICES:'',RPLAYOUT_RELAY:'',RPLAYOUT_ADMIN_USER:'',RPLAYOUT_ADMIN_PASSWORD:'',RPLAYOUT_CONTROL_TOKEN:'',RPLAYOUT_ROLE:'ADMIN',RPLAYOUT_BACKUP_HOURS:'0',HOST:'127.0.0.1',PORT:String(port),LOG_LEVEL:'warn'}})
  for(const stream of [server.stdout,server.stderr])stream?.on('data',chunk=>{logs=(logs+String(chunk)).slice(-16000)})
  await wait('Compiled API not ready',async()=>{try{return (await request('/api/health')).data.ok}catch{return false}})
  // Auto-scan and explicit scan may overlap. Wait for the actual current scan,
  // then request a fresh scan; never restart a still-running worker.
  await wait('Initial scan did not settle',async()=>!(await request('/api/library/scan')).data.running)
  const scanReview=(await request('/api/library/scan/review')).data
  await request('/api/library/scan',{root:media,measure:loudnessProfileOnly,requestId:scanReview.operationId},200,{'if-match':scanETag(scanReview)})
  await wait('Requested scan did not settle',async()=>!(await request('/api/library/scan')).data.running)
  const assets=(await request('/api/assets')).data.assets,asset=assets.find((entry:any)=>entry.path===file)
  assert.ok(asset,'Actual scanner did not import Unicode file: '+JSON.stringify(assets))
  assert.equal(asset.contentHash,mediaHash);assert.equal(asset.probe.width,320);assert.equal(asset.probe.height,180);assert.equal(asset.probe.hasAudio,true)
  assert.equal(asset.qcStatus,'PENDING')
  const workflowPath=`/api/assets/${asset.id}/workflow?hash=${mediaHash}`
  await wait('Native archive/proxy not ready',async()=>(await request(workflowPath)).data.previewReady)
  const workflow=(await request(workflowPath)).data,jobs=(await request('/api/media/jobs')).data.jobs
  assert.ok(jobs.length>=2&&jobs.every((job:any)=>job.state==='READY'),JSON.stringify(jobs))
  const proxyResponse=await fetch(`http://127.0.0.1:${port}${workflow.previewUrl}`,{signal:AbortSignal.timeout(30000)})
  assert.equal(proxyResponse.status,200)
  const proxyBytes=new Uint8Array(await proxyResponse.arrayBuffer()),proxyHash=sha(proxyBytes)
  const recordedProxy=database.sqlite.prepare("SELECT output_hash,output_path FROM media_jobs WHERE kind='PROXY' AND state='READY'").get() as any
  assert.equal(proxyHash,recordedProxy.output_hash);assert.equal(proxyHash,sha(await readFile(recordedProxy.output_path)))
  const {stdout}=await run(join(root,'apps/engine/target/release/rplayout-probe.exe'),[recordedProxy.output_path,'--no-loudness'],{env:environment,windowsHide:true,timeout:30000})
  const proxyProbe=JSON.parse(stdout.trim().split('\n').at(-1)!)
  assert.ok(proxyProbe.ok&&proxyProbe.decodedVideoBuffers>0&&proxyProbe.decodedAudioBuffers>0)
  // A low-resolution original must not be upscaled merely to reach the cap.
  assert.equal(proxyProbe.video.width,320);assert.equal(proxyProbe.video.height,180);assert.equal(proxyProbe.video.rateNum,10)
  const profilePath='/api/channels/qc/qc-profile'
  const configure=async(width:number)=>{const review=await request(profilePath);return request(profilePath,{...DEFAULT_QC_PROFILE,width,height:180,fps:25,requireAudio:true},200,{'if-match':review.etag},'PUT')}
  await configure(320)
  const insert=async(status=200)=>{
    const review=(await request('/api/rundowns/rd/operational-simulation')).data.review
    return request('/api/rundowns/rd/items',{mediaId:asset.id,type:'VT',autoNext:false},status,{'if-match':`w/"${review.editorialRevision}"`})
  }
  await insert(400)
  const qcPath=`/api/assets/${asset.id}/qc?channelId=qc`
  const decide=async(status:string,expected=200)=>{const review=await request(qcPath);return request(`/api/assets/${asset.id}/qc`,{channelId:'qc',contentHash:mediaHash,status},expected,{'if-match':review.etag})}
  await decide('APPROVED')
  if(strictProbeOnly){
    // Emulate one legacy metadata field in OUR isolated catalog. The actual
    // scanner/file/decoder remain real. Never present this as a native probe
    // failing to detect codec, or mutate an operator asset.
    database.sqlite.prepare('UPDATE media_assets SET video_codec=NULL WHERE id=?').run(asset.id)
  }
  await insert();await insert()
  const items=(await snapshot()).view.items,first=items[0].item.id,second=items[1].item.id
  const review=(await request('/api/rundowns/rd/operational-simulation')).data.review
  const publication=(await request('/api/rundowns/rd/operational-publish',{reviewToken:review.token},201,{'if-match':`w/"${review.editorialRevision}"`})).data
  await request('/api/channels/qc/transport',{action:'take',itemId:first})
  await wait('First file not confirmed in native PGM',async()=>(await snapshot()).live.transport.onAir?.itemId===first)
  const before=(await snapshot()).live.transport.onAir
  if(sourceReplacementOnly){
    const archivedOld=database.sqlite.prepare('SELECT archive_path FROM media_versions WHERE asset_id=? AND content_hash=?').get(asset.id,mediaHash) as any
    assert.ok(archivedOld.archive_path&&archivedOld.archive_path!==file)
    assert.equal(sha(await readFile(archivedOld.archive_path)),mediaHash)
    const oldReview=await request(qcPath)
    // Replace only our isolated test fixture, never an operator original.
    await run(join(gstBin,'gst-launch-1.0.exe'),['-q','matroskamux','name=m','!','filesink',`location=${file.replaceAll('\\','/')}`,'videotestsrc','num-buffers=250','pattern=smpte','!','video/x-raw,width=320,height=180,framerate=25/1','!','videoconvert','!','vp8enc','deadline=1','threads=2','!','queue','!','m.','audiotestsrc','num-buffers=469','samplesperbuffer=1024','volume=0.08','!','audio/x-raw,rate=48000,channels=2','!','audioconvert','!','vorbisenc','!','queue','!','m.'],{env:environment,windowsHide:true,timeout:30000})
    const nextHash=sha(await readFile(file));assert.notEqual(nextHash,mediaHash)
    await wait('Current scan must settle before replacement scan',async()=>!(await request('/api/library/scan')).data.running)
    const replacementScanReview=(await request('/api/library/scan/review')).data
    await request('/api/library/scan',{root:media,measure:false,requestId:replacementScanReview.operationId},200,{'if-match':scanETag(replacementScanReview)})
    await wait('Replacement not ingested',async()=>{
      const current=(await request('/api/assets')).data.assets.find((row:any)=>row.id===asset.id)
      return !(await request('/api/library/scan')).data.running&&current?.contentHash===nextHash
    })
    const nextAsset=(await request('/api/assets')).data.assets.find((row:any)=>row.id===asset.id)
    assert.equal(nextAsset.qcStatus,'PENDING');assert.equal(nextAsset.id,asset.id)
    await request(`/api/assets/${asset.id}/qc`,{channelId:'qc',contentHash:mediaHash,status:'APPROVED'},409,{'if-match':oldReview.etag})
    const currentWorkflow=`/api/assets/${asset.id}/workflow?hash=${nextHash}`
    await request(workflowPath,undefined,409)
    await wait('New edition proxy not ready',async()=>(await request(currentWorkflow)).data.previewReady)
    const editions=(await request(currentWorkflow)).data.versions
    assert.equal(editions.length,2);assert.equal(sha(await readFile(archivedOld.archive_path)),mediaHash)
    await wait('Operational edition not pinned to old archive',async()=>{
      const entry=(await snapshot()).executionView.items.find((row:any)=>row.item.id===second)
      return entry?.asset.contentHash===mediaHash&&entry.asset.path===archivedOld.archive_path
    })
    assert.equal((await snapshot()).live.transport.onAir.startedAt,before.startedAt)
    await insert(400)
    const newQc=await request(qcPath)
    await request(`/api/assets/${asset.id}/qc`,{channelId:'qc',contentHash:nextHash,status:'BLOCKED'},200,{'if-match':newQc.etag})
    // A block on new bytes cannot revoke the already-approved old edition.
    await request('/api/channels/qc/transport',{action:'take',itemId:second})
    await wait('Old approved edition cannot be played from archive',async()=>(await snapshot()).live.transport.onAir?.itemId===second)
    const pinned=(await snapshot()).executionView.items.find((row:any)=>row.item.id===second)
    assert.equal(pinned.asset.contentHash,mediaHash);assert.equal(pinned.asset.path,archivedOld.archive_path)
    const approveNew=await request(qcPath)
    await request(`/api/assets/${asset.id}/qc`,{channelId:'qc',contentHash:nextHash,status:'APPROVED'},200,{'if-match':approveNew.etag})
    const whileOnAir=(await request('/api/rundowns/rd/operational-simulation')).data.review
    await request('/api/rundowns/rd/operational-publish',{reviewToken:whileOnAir.token},409,{'if-match':`w/"${whileOnAir.editorialRevision}"`})
    assert.equal((await snapshot()).executionView.items.find((row:any)=>row.item.id===second).asset.contentHash,mediaHash)
    const oldRuns=()=>database.sqlite.prepare("SELECT media_hash,revision_id FROM as_run WHERE item_id=? AND execution_kind='NATIVE'").all(second) as any[]
    await wait('Pinned old native TAKE missing as-run evidence',async()=>oldRuns().some(row=>row.media_hash===mediaHash&&row.revision_id===publication.id))
    await request('/api/channels/qc/transport',{action:'stop'})
    const nextReview=(await request('/api/rundowns/rd/operational-simulation')).data.review
    const newPublication=(await request('/api/rundowns/rd/operational-publish',{reviewToken:nextReview.token},201,{'if-match':`w/"${nextReview.editorialRevision}"`})).data
    assert.notEqual(newPublication.id,publication.id)
    await request('/api/channels/qc/transport',{action:'take',itemId:first})
    await wait('New approved publication not confirmed in native PGM',async()=>(await snapshot()).live.transport.onAir?.itemId===first)
    assert.equal((await snapshot()).executionView.items.find((row:any)=>row.item.id===first).asset.contentHash,nextHash)
    await wait('New publication/native hash missing as-run evidence',async()=>Boolean(database.sqlite.prepare("SELECT id FROM as_run WHERE item_id=? AND media_hash=? AND revision_id=? AND execution_kind='NATIVE'").get(first,nextHash,newPublication.id)))
    const frozen=database.sqlite.prepare('SELECT payload FROM operational_playlist_revisions WHERE id=?').get(publication.id) as any
    // The column is installation-vault protected. Check the owning DB's mapper,
    // not JSON.parse ciphertext or a freshly recomputed editorial view.
    const {operationalPlaylistRevisions}=await import('../apps/server/src/db/schema.js')
    const oldPublication=database.db.select().from(operationalPlaylistRevisions).all().find(row=>row.id===publication.id)!
    assert.ok(frozen);assert.equal((oldPublication.payload as any).assets.find((row:any)=>row.id===asset.id).contentHash,mediaHash)
    result={result:'PASS',scope:'COMPILED_SCANNER_CHANGED_ORIGINAL_PUBLISHED_ARCHIVE_AND_RE_QC_NATIVE_TAKE',directory,port,assetId:asset.id,mediaHash,nextHash,oldPublicationId:publication.id,newPublicationId:newPublication.id,editions:editions.length,replacementPending:true,staleQcRefused:true,stalePreviewRefused:true,oldArchiveHashPreserved:true,newBlockDoesNotRevokeOld:true,publishedDecoderPreserved:true,onAirReplacementPublicationRefused:true,newApprovedPublicationNativeTake:true,asRunOldAndNewHashesVerified:true,frozenOldPublicationPreserved:true,physicalInputsValidated:false,browserValidated:false,cueValidated:false}
  }else if(strictProbeOnly){
    const savePolicy=async(required:boolean)=>{
      const current=await request(profilePath)
      return request(profilePath,{...current.data.profile,requireProbe:required},200,{'if-match':current.etag},'PUT')
    }
    assert.equal((await snapshot()).executionView.items.find((row:any)=>row.item.id===second).asset.probe.codec,null)
    await savePolicy(true)
    const strict=(await request(qcPath)).data
    assert.equal(strict.profile.requireProbe,true);assert.equal(strict.checks.playable,false)
    await decide('APPROVED',409)
    const refused=(await request('/api/channels/qc/transport',{action:'take',itemId:second},409)).data
    assert.match(refused.error,/Codec do original não identificado/)
    assert.equal((await snapshot()).live.transport.onAir.startedAt,before.startedAt)
    const opened=await request(profilePath),{requireProbe:omitted,...oldClientProfile}=opened.data.profile
    await request(profilePath,oldClientProfile,200,{'if-match':opened.etag},'PUT')
    assert.equal((await request(profilePath)).data.profile.requireProbe,true)
    await request('/api/channels/qc/transport',{action:'take',itemId:second},409)
    assert.equal((await snapshot()).live.transport.onAir.itemId,first)
    await savePolicy(false)
    assert.equal((await request(qcPath)).data.profile.requireProbe,false)
    await decide('APPROVED')
    await request('/api/channels/qc/transport',{action:'take',itemId:second})
    await wait('Explicit legacy compatibility TAKE not confirmed',async()=>(await snapshot()).live.transport.onAir?.itemId===second)
    await wait('Confirmed legacy edition as-run missing',async()=>Boolean(database.sqlite.prepare("SELECT id FROM as_run WHERE item_id=? AND media_hash=? AND revision_id=? AND execution_kind='NATIVE'").get(second,mediaHash,publication.id)))
    result={result:'PASS',scope:'COMPILED_EXPLICIT_STRICT_PROBE_POLICY_LEGACY_PUBLISHED_EDITION_NATIVE_PGM',directory,port,assetId:asset.id,mediaHash,publicationId:publication.id,legacyCodecMetadataEmulated:true,actualFileAndDecoder:true,strictApprovalAndTakeRefused:true,pgmItemAndOriginPreserved:true,oldClientOmissionDoesNotDisableStrict:true,explicitCompatibilityApprovalAndTakeConfirmed:true,asRunHashAndRevision:true,physicalInputsValidated:false,browserValidated:false}
  }else if(loudnessProfileOnly){
    const measured=asset.loudnessFile
    assert.ok(measured&&measured.scope==='FILE'&&Number.isFinite(measured.integratedLufs)&&Number.isFinite(measured.truePeakDbtp)&&Number.isFinite(Date.parse(measured.measuredAt)),'Native whole-file loudness evidence missing')
    assert.ok(measured.integratedLufs+1<0&&measured.integratedLufs>-99&&measured.truePeakDbtp>-99&&measured.truePeakDbtp<12)
    assert.ok(typeof asset.probe.codec==='string'&&asset.probe.codec.length>0,'Native codec missing')
    const fullProfile={...DEFAULT_QC_PROFILE,codecs:[asset.probe.codec],width:320,height:180,fps:25,scan:'PROGRESSIVE',requireAudio:true,minDurationSeconds:59,requireLoudness:true,minLufs:-100,maxLufs:0,maxTruePeakDbtp:12}
    const saveFull=async(extra:Record<string,unknown>={})=>{
      const current=await request(profilePath)
      return request(profilePath,{...fullProfile,...extra},200,{'if-match':current.etag},'PUT')
    }
    await saveFull()
    assert.equal((await request(qcPath)).data.checks.playable,true)
    await decide('APPROVED')
    await saveFull({minLufs:measured.integratedLufs+1})
    await decide('APPROVED',409)
    const refusedLufs=(await request('/api/channels/qc/transport',{action:'take',itemId:second},409)).data
    assert.match(refusedLufs.error,/Loudness/)
    assert.equal((await snapshot()).live.transport.onAir.startedAt,before.startedAt)
    await saveFull({maxTruePeakDbtp:measured.truePeakDbtp-1})
    await decide('APPROVED',409)
    const refusedPeak=(await request('/api/channels/qc/transport',{action:'take',itemId:second},409)).data
    assert.match(refusedPeak.error,/True peak/)
    assert.equal((await snapshot()).live.transport.onAir.itemId,first)
    assert.equal((await snapshot()).live.transport.onAir.startedAt,before.startedAt)
    await saveFull();await decide('APPROVED')
    await request('/api/channels/qc/transport',{action:'take',itemId:second})
    await wait('Whole-file measurement valid TAKE not confirmed',async()=>(await snapshot()).live.transport.onAir?.itemId===second)
    await wait('Full profile confirmed native as-run missing',async()=>Boolean(database.sqlite.prepare("SELECT id FROM as_run WHERE item_id=? AND media_hash=? AND revision_id=? AND execution_kind='NATIVE'").get(second,mediaHash,publication.id)))
    result={result:'PASS',scope:'COMPILED_REAL_SCANNER_WHOLE_FILE_LOUDNESS_FULL_PROFILE_NATIVE_TAKE',directory,port,assetId:asset.id,mediaHash,publicationId:publication.id,codec:asset.probe.codec,measured,fullProfileValid:true,incompatibleLufsApprovalAndTakeRefused:true,incompatiblePeakApprovalAndTakeRefused:true,pgmItemAndOriginPreserved:true,restoredProfileNativeTakeConfirmed:true,asRunHashAndRevision:true,physicalInputsValidated:false,browserValidated:false,standardCertification:false}
  }else if(cueQcOnly){
    const transport=(body:object,status=200)=>request('/api/channels/qc/transport',body,status)
    await transport({action:'cue',itemId:second})
    assert.deepEqual((await snapshot()).live.transport.preview,{kind:'ITEM',id:second})
    await request('/api/channels/qc/watching',{bus:'pvw'})
    const path=(await snapshot()).monitors.preview
    await wait('Low PVW not published',async()=>{
      try{const response=await fetch(`http://127.0.0.1:9997/v3/paths/get/${path}`,{signal:AbortSignal.timeout(3000)});return response.ok&&(await response.json() as any).ready}catch{return false}
    })
    const previewImage=await actualPreview(path)
    assert.equal((await snapshot()).live.transport.onAir.startedAt,before.startedAt)
    await decide('BLOCKED')
    await transport({action:'take'},409)
    const blocked=(await snapshot()).live.transport
    assert.equal(blocked.onAir.itemId,first);assert.equal(blocked.onAir.startedAt,before.startedAt)
    assert.deepEqual(blocked.preview,{kind:'ITEM',id:second})
    await decide('APPROVED')
    await configure(640)
    await transport({action:'take'},409)
    const invalid=(await snapshot()).live.transport
    assert.equal(invalid.onAir.startedAt,before.startedAt);assert.deepEqual(invalid.preview,{kind:'ITEM',id:second})
    await configure(320)
    await transport({action:'take'})
    await wait('Reapproved CUE was not taken',async()=>(await snapshot()).live.transport.onAir?.itemId===second)
    await wait('Confirmed implicit TAKE as-run missing',async()=>Boolean(database.sqlite.prepare("SELECT id FROM as_run WHERE item_id=? AND media_hash=? AND revision_id=? AND execution_kind='NATIVE'").get(second,mediaHash,publication.id)))
    result={result:'PASS',scope:'COMPILED_FILE_CUE_PUBLISHED_LOW_PVW_RE_QC_PROFILE_IMPLICIT_NATIVE_TAKE',directory,port,assetId:asset.id,mediaHash,publicationId:publication.id,previewImage,cueBeforeBlock:true,blockedImplicitTakeRefused:true,currentProfileAfterCueRefused:true,pgmItemAndOriginPreserved:true,cueSelectionPreserved:true,reapprovalImplicitTakeConfirmed:true,asRunHashAndRevision:true,physicalInputsValidated:false,browserValidated:false}
  }else{
  await decide('BLOCKED')
  const blocked=(await request('/api/channels/qc/transport',{action:'take',itemId:second},409)).data
  assert.match(blocked.error,/PGM anterior preservado/)
  const afterBlock=(await snapshot()).live.transport.onAir
  assert.equal(afterBlock.itemId,first);assert.equal(afterBlock.startedAt,before.startedAt)
  await configure(640);await decide('APPROVED',409)
  await configure(320);await decide('APPROVED')
  await configure(640)
  const incompatible=(await request('/api/channels/qc/transport',{action:'take',itemId:second},409)).data
  assert.match(incompatible.error,/perfil técnico atual/)
  assert.equal((await snapshot()).live.transport.onAir.startedAt,before.startedAt)
  await configure(320)
  await request('/api/channels/qc/transport',{action:'take',itemId:second})
  await wait('Approved next file not confirmed',async()=>(await snapshot()).live.transport.onAir?.itemId===second)
  await wait('Native as-run missing edition SHA/revision',async()=>Boolean(database.sqlite.prepare("SELECT id FROM as_run WHERE item_id=? AND media_hash=? AND revision_id=? AND execution_kind='NATIVE'").get(first,mediaHash,publication.id)))
  result={result:'PASS',directory,port,assetId:asset.id,mediaHash,proxyHash,proxyBytes:proxyBytes.length,publicationId:publication.id,first,second,actualScanner:true,actualNativeProbe:true,actualNativeProxy:true,compiledApi:true,nativeTake:true,pendingInsertionRefused:true,blockedTakePreservesPgm:true,currentProfileTakeRefused:true,invalidApprovalRefused:true,reapprovalTakeConfirmed:true,asRunEditionVerified:true,physicalInputsValidated:false,browserValidated:false,cueValidated:false}
  }
}catch(error){failure=error}
finally{
  try{await stop()}catch(error){failure??=error}
  database.sqlite.close()
  await writeFile(join(directory,'server.log'),logs)
  const evidence=failure?{result:'FAIL',directory,error:String(failure),stack:failure instanceof Error?failure.stack:null,processFailure:failure&&typeof failure==='object'?Object.fromEntries(['code','signal','killed','stdout','stderr'].map(key=>[key,String((failure as Record<string,unknown>)[key]??'').slice(-8000)])):null}:{...result,installedPackage:installedArgument?root:null,compiledServerOverride:Boolean(serverArgument),serverBinary,productionPathMinimal:Boolean(installedArgument),sourceUsedForFixtureSeedOnly:Boolean(installedArgument)&&!serverArgument,serverSha:sha(await readFile(serverBinary)),engineSha:sha(await readFile(join(root,'apps/engine/target/release/rplayout-engine.exe')))}
  await writeFile(join(directory,failure?'failure.json':'result.json'),JSON.stringify(evidence,null,2))
  console.log(JSON.stringify(evidence));if(failure)process.exitCode=1
}
