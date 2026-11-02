import assert from 'node:assert/strict'
import {spawn,execFile,type ChildProcess} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,mkdir,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {createHash,randomBytes,randomUUID} from 'node:crypto'
import {createServer} from 'node:net'
import {createRequire} from 'node:module'
import {loadInstallationVault} from '../apps/server/src/domain/secret-vault.js'
import {once} from 'node:events'
import {mediaProcessEnvironment} from '../apps/server/src/domain/media-process-environment.js'
import {DEFAULT_QC_PROFILE} from '../packages/protocol/src/qc.js'

// Two independent compiled servers/databases/vaults on loopback, not physical HA.
// Native PGM on A + encrypted state/media on B. No takeover or output fencing.
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(tmpdir(),'RPlayout-ha-replication-'))
const key=randomBytes(32).toString('hex'),cluster='fixture',names=['primary','reserve'] as const
const useWitness=process.env.RPLAYOUT_VERIFY_WITNESS==='1',witnessKey=randomBytes(32).toString('hex')
const useAudio=process.env.RPLAYOUT_VERIFY_HA_AUDIO==='1'
const rejectMissingAudio=process.env.RPLAYOUT_VERIFY_HA_POLICY_FAILURE==='1'
assert.ok(!rejectMissingAudio||!useAudio,'Policy refusal fixture requires a file without audio')
const probeBinary=join(root,'apps/engine/target/release/rplayout-probe.exe')
const children=new Map<string,ChildProcess>(),engines=new Set<number>(),logs=new Map<string,string>()
const nativeRequire=createRequire(join(root,'apps/server/package.json')),Database=nativeRequire('better-sqlite3') as typeof import('../apps/server/node_modules/better-sqlite3')
const reservations=[...names,...(useWitness?['witness']:[])].map(()=>createServer());await Promise.all(reservations.map(server=>new Promise<void>(r=>server.listen(0,'127.0.0.1',r))))
const ports=reservations.map(server=>(server.address() as {port:number}).port);await Promise.all(reservations.map(server=>new Promise<void>(r=>server.close(()=>r()))))
const dirs={primary:join(directory,'primary'),reserve:join(directory,'reserve')};await Promise.all(Object.values(dirs).map(dir=>mkdir(dir)))
const media=join(dirs.primary,'media');await mkdir(media);const file=join(media,'HA-ÇÃO.mp4')
process.env.RPLAYOUT_VAULT_FILE=join(dirs.primary,'vault.json')
const gstRoot=process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64??'C:/Program Files/gstreamer/1.0/msvc_x86_64',gstBin=join(gstRoot,'bin')
const baseEnvironment={...process.env,GST_REGISTRY:join(directory,'registry.bin'),GST_PLUGIN_SCANNER:join(gstRoot,'libexec/gstreamer-1.0/gst-plugin-scanner.exe'),GST_PLUGIN_PATH:join(gstRoot,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gstRoot,'lib/gstreamer-1.0'),PATH:gstBin+';'+process.env.PATH}
await promisify(execFile)(join(gstBin,'gst-launch-1.0.exe'),['-q','mp4mux','name=mux','!','filesink',`location=${file.replaceAll('\\','/')}`,'videotestsrc','num-buffers=1800','!','video/x-raw,width=320,height=180,framerate=25/1','!','videoconvert','!','x264enc','speed-preset=ultrafast','!','h264parse','!','mux.',...(useAudio?['audiotestsrc','num-buffers=3375','samplesperbuffer=1024','volume=0.05','!','audio/x-raw,rate=48000,channels=2','!','audioconvert','!','avenc_aac','!','aacparse','!','mux.']:[])],{timeout:60_000,windowsHide:true,env:baseEnvironment})
const sourceProbe=JSON.parse((await promisify(execFile)(probeBinary,[file],{timeout:60_000,windowsHide:true,env:mediaProcessEnvironment(baseEnvironment)})).stdout)
assert.equal(sourceProbe.ok,true);assert.ok(sourceProbe.decodedVideoBuffers>0)
if(useAudio){assert.ok(sourceProbe.decodedAudioBuffers>0);assert.ok(Number.isFinite(sourceProbe.audio?.integratedLufs));assert.ok(Number.isFinite(sourceProbe.audio?.truePeakDbtp))}
const {openDatabase}=await import('../apps/server/src/db/client.js'),primaryDb=openDatabase(join(dirs.primary,'main.db'))
const base=(name:typeof names[number])=>`http://127.0.0.1:${ports[names.indexOf(name)]}`
const alive=(pid:number)=>{try{process.kill(pid,0);return true}catch{return false}}
async function wait(message:string,predicate:()=>boolean|Promise<boolean>,timeout=30_000){const end=performance.now()+timeout;while(performance.now()<end){if(await predicate())return;await new Promise(r=>setTimeout(r,150))}throw new Error(message+'; '+[...logs.values()].join('\n').slice(-2000))}
async function api(name:typeof names[number],path:string,body?:object,status=200,headers:Record<string,string>={}){const response=await fetch(base(name)+path,{...(body?{method:'POST',body:JSON.stringify(body)}:{}),headers:{...(body?{'content-type':'application/json'}:{}),...headers},signal:AbortSignal.timeout(path==='/api/ha/rehearsal'?60_000:5000)});const result=await response.json() as any;assert.equal(response.status,status,`${name} ${path}: ${JSON.stringify(result)}`);return result}
async function start(name:typeof names[number]){
  const dir=dirs[name],primary=name==='primary';logs.set(name,'')
  const environment={...baseEnvironment,RPLAYOUT_HA_WITNESS:useWitness?`http://127.0.0.1:${ports[2]}`:'',RPLAYOUT_HA_WITNESS_KEY:useWitness?witnessKey:''}
  const child=spawn(process.execPath,[join(root,'apps/server/dist/server.cjs')],{cwd:dir,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...environment,RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_DB:join(dir,'main.db'),RPLAYOUT_VAULT_FILE:join(dir,'vault.json'),RPLAYOUT_MEDIA:primary?media:join(dir,'media'),RPLAYOUT_THUMBS:join(dir,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(dir,'versions'),RPLAYOUT_CACHE:join(dir,'cache'),RPLAYOUT_BACKUPS:join(dir,'backups'),RPLAYOUT_ENGINE:join(root,'apps/engine/target/release/rplayout-engine.exe'),RPLAYOUT_ENGINE_OUTPUT:'null',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_DEVICES:'',RPLAYOUT_RELAY:'',RPLAYOUT_PROBE:primary?'':probeBinary,RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_N1_PEER:'',RPLAYOUT_HA_ROLE:primary?'PRIMARY':'STANDBY',RPLAYOUT_HA_CLUSTER:cluster,RPLAYOUT_HA_NODE:name,RPLAYOUT_HA_PEER_NODE:primary?'reserve':'primary',RPLAYOUT_HA_KEY:key,RPLAYOUT_HA_PEER:primary?base('reserve'):'',RPLAYOUT_HA_DB:join(dir,'mirror.db'),RPLAYOUT_BACKUP_HOURS:'0',RPLAYOUT_ADMIN_USER:'',RPLAYOUT_ADMIN_PASSWORD:'',RPLAYOUT_ROLE:'ADMIN',RPLAYOUT_CONTROL_TOKEN:'',HOST:'127.0.0.1',PORT:String(ports[names.indexOf(name)]),LOG_LEVEL:'warn'}})
  children.set(name,child);for(const stream of [child.stdout,child.stderr])stream?.on('data',chunk=>logs.set(name,(logs.get(name)+String(chunk)).slice(-8000)))
  child.on('error',error=>logs.set(name,logs.get(name)+error.message))
  await wait('Servidor não iniciou '+name,async()=>{try{return(await api(name,'/api/health')).engines===(primary?1:0)}catch{return false}})
  if(primary){const process=(await api(name,'/api/processes')).processes.find((p:any)=>p.kind==='ENGINE'&&p.channelId==='ch');assert.ok(process?.pid);engines.add(process.pid)}
}
async function stop(name:typeof names[number]){
  const child=children.get(name)
  if(child&&child.exitCode===null&&child.signalCode===null){
    const closed=once(child,'close',{signal:AbortSignal.timeout(10_000)})
    child.kill('SIGKILL');await closed
  }
  if(child?.pid)await wait('Servidor próprio não encerrou',()=>!alive(child.pid!),10_000)
  children.delete(name)
  if(name==='primary')for(const pid of engines)if(alive(pid)){process.kill(pid);await wait('Engine próprio não encerrou',()=>!alive(pid),10_000)}
}
let reserveDb:InstanceType<typeof Database>|null=null,mirrorDb:InstanceType<typeof Database>|null=null
try{
  if(useWitness){
    const witness=spawn(process.execPath,[join(root,'apps/server/dist/ha-witness.cjs')],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...baseEnvironment,RPLAYOUT_WITNESS_DB:join(directory,'witness/witness.db'),RPLAYOUT_WITNESS_CLUSTER:cluster,RPLAYOUT_WITNESS_NODES:'primary,reserve',RPLAYOUT_WITNESS_KEY:witnessKey,RPLAYOUT_WITNESS_PORT:String(ports[2])}})
    children.set('witness',witness);for(const stream of [witness.stdout,witness.stderr])stream?.on('data',chunk=>logs.set('witness',String(chunk).slice(-2000)))
    await wait('Testemunha não iniciou ou não concluiu quarentena',async()=>{try{return!(await(await fetch(`http://127.0.0.1:${ports[2]}/health`)).json() as any).quarantined}catch{return false}})
  }
  const now=new Date().toISOString(),hash=createHash('sha256').update(await readFile(file)).digest('hex')
  primaryDb.sqlite.prepare('INSERT INTO channels(id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run('ch','HA QA',25,1,320,180,-23,-1,5,now)
  primaryDb.sqlite.prepare('UPDATE channels SET qc_profile=? WHERE id=?').run(JSON.stringify({...DEFAULT_QC_PROFILE,codecs:['video/x-h264'],width:320,height:180,fps:25,scan:'PROGRESSIVE',requireAudio:useAudio,requireLoudness:useAudio,minLufs:-40,maxLufs:-15}),'ch')
  primaryDb.sqlite.prepare('INSERT INTO rundowns(id,channel_id,name,planned_start,date,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('rd','ch','Publicada QA',0,now.slice(0,10),now,now)
  primaryDb.sqlite.prepare('INSERT INTO media_assets(id,content_hash,path,title,kind,duration_frames,duration_ns,width,height,rate_num,rate_den,has_audio,audio_channels,video_codec,loudness_file,qc_status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('asset',hash,file,'VT QA','VIDEO',1800,sourceProbe.durationNs,320,180,25,1,useAudio?1:0,useAudio?2:0,sourceProbe.videoCodec,useAudio?JSON.stringify({integratedLufs:sourceProbe.audio.integratedLufs,lra:sourceProbe.audio.lra,truePeakDbtp:sourceProbe.audio.truePeakDbtp,scope:'FILE',measuredAt:now}):null,'APPROVED',now)
  primaryDb.sqlite.prepare('INSERT INTO rundown_items(id,rundown_id,sort_order,title,type,media_id,anchor,on_overrun,min_duration,auto_next,loop,locked) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('vt','rd',0,'PUBLICADO','VT','asset',JSON.stringify({kind:'FLOW'}),'PUSH',0,0,0,0)
  await start('reserve');await start('primary')
  const publication=(await api('primary','/api/rundowns/rd/operational-simulation')).review
  await api('primary','/api/rundowns/rd/operational-publish',{reviewToken:publication.token},201,{'if-match':`w/"${publication.editorialRevision}"`})
  await api('primary','/api/channels/ch/transport',{action:'take',itemId:'vt'})
  primaryDb.sqlite.prepare('UPDATE rundown_items SET title=? WHERE id=?').run('RASCUNHO NÃO PUBLICADO','vt')
  await wait('PGM nativo não iniciou',async()=>{const state=(await api('primary','/api/n1/state')).channels[0].state;return state.mode==='NATIVE'&&state.onAir?.elapsed>25})
  if(useWitness){const health=(await api('primary','/api/n1/state')).channels[0].health;assert.equal(health.fencing.enabled,true);assert.ok(health.fencing.term>0);assert.ok(health.fencing.nonce>0);assert.equal((await api('primary','/api/ha/status')).authority.configured,true)}
  mirrorDb=new Database(join(dirs.reserve,'mirror.db'),{readonly:true})
  await wait('Reserva não começou cópia parcial SHA',()=>{
    const row=mirrorDb!.prepare('SELECT offset,size,state FROM ha_media WHERE hash=?').get(hash) as any
    return row?.state==='PARTIAL'&&row.offset>0&&row.offset<row.size
  },45_000)
  const partialBefore=(mirrorDb.prepare('SELECT offset,size FROM ha_media WHERE hash=?').get(hash) as any).offset
  await stop('reserve')
  const pgmBeforeResume=(await api('primary','/api/n1/state')).channels[0].state
  assert.equal(pgmBeforeResume.mode,'NATIVE');assert.equal(pgmBeforeResume.onAir?.itemId,'vt')
  await start('reserve')
  assert.ok((mirrorDb.prepare('SELECT offset FROM ha_media WHERE hash=?').get(hash) as any).offset>=partialBefore,'Reserva perdeu offset durável')
  await wait('Reserva não concluiu cópia SHA depois do restart',async()=>(await api('reserve','/api/ha/status')).media?.verified===1,60_000)
  const replicaFile=join(dirs.reserve,'media',hash+'.media')
  assert.equal(createHash('sha256').update(await readFile(replicaFile)).digest('hex'),hash)
  await wait('Reserva não recebeu as-run/checkpoint',async()=>{const state=await api('reserve','/api/ha/status');return state.mirroredChannels===1&&state.mirroredAsRun>=1&&state.sequence>=2})
  const mirrored=()=>{const row=mirrorDb!.prepare('SELECT payload FROM ha_state WHERE id=1').get() as {payload:string};return JSON.parse(loadInstallationVault(join(dirs.reserve,'vault.json'),false).decrypt(row.payload,`ha-mirror:v1:${cluster}:reserve`))}
  await wait('Checkpoint nativo não chegou ao espelho',()=>mirrored().channels[0]?.checkpoint?.value?.elapsed>25)
  const snapshot=mirrored();let confirmed=(await api('reserve','/api/ha/status')).sequence
  assert.equal(snapshot.channels[0].revisions[0].payload.items[0].title,'PUBLICADO');assert.equal(snapshot.channels[0].checkpoint.value.realEngine,true)
  assert.equal(snapshot.asRun[0].executionKind,'NATIVE');assert.equal(snapshot.asRun[0].mediaHash,hash)
  assert.equal((await api('reserve','/api/ha/status')).failoverReady,false)
  await api('reserve','/api/channels/ch/transport',{action:'take',itemId:'vt'},409)
  assert.equal((await api('reserve','/api/processes')).processes.some((p:any)=>p.kind==='ENGINE'&&p.pid),false)
  if(rejectMissingAudio){
    // Change only our fixture's channel policy after publishing/playing the
    // silent VT. The newly mirrored policy must not trust its old APPROVED
    // metadata: the reserve's real probe must reject mandatory absent audio.
    primaryDb.sqlite.prepare('UPDATE channels SET qc_profile=? WHERE id=?').run(JSON.stringify({...DEFAULT_QC_PROFILE,codecs:['video/x-h264'],width:320,height:180,fps:25,scan:'PROGRESSIVE',requireAudio:true}),'ch')
    await wait('Nova política QC não chegou ao espelho',()=>mirrored().channels[0]?.configuration?.channel?.qcProfile?.requireAudio===true)
  }
  await stop('primary')
  // Stop our primary fixture to pin one final mirrored sequence. This restores
  // a real frozen edition into an isolated DB, not a reserve takeover.
  const rehearsalRequest={requestId:randomUUID(),channelId:'ch',sequence:(await api('reserve','/api/ha/status')).sequence}
  confirmed=rehearsalRequest.sequence
  const rehearsal=await api('reserve','/api/ha/rehearsal',rehearsalRequest)
  assert.equal(rehearsal.phase,'RESTORED');assert.equal(rehearsal.promotionReady,false);assert.equal(rehearsal.automaticTake,false);assert.equal(rehearsal.localProbeRequired,false)
  assert.equal(rehearsal.localValidation.state,rejectMissingAudio?'FAILED':'PASSED');assert.equal(rehearsal.localValidation.decoded,1);assert.equal(rehearsal.localValidation.technicalBlocked,rejectMissingAudio?1:0)
  assert.equal(rehearsal.localValidation.runtimeHash,createHash('sha256').update(await readFile(probeBinary)).digest('hex'))
  assert.equal(rehearsal.qcBlocked,1,'Legacy APPROVED is not a hash/channel QC decision')
  assert.deepEqual(await api('reserve','/api/ha/rehearsal',rehearsalRequest),rehearsal)
  const recoveryRow=mirrorDb.prepare('SELECT workspace FROM ha_recovery WHERE request_id=?').get(rehearsalRequest.requestId) as {workspace:string}
  // Read with the reserve vault explicitly; never migrate its DB using the
  // verifier's primary installation vault.
  const restored={sqlite:new Database(recoveryRow.workspace,{readonly:true})}
  try{
    assert.equal(restored.sqlite.pragma('integrity_check',{simple:true}),'ok');assert.deepEqual(restored.sqlite.pragma('foreign_key_check'),[])
    assert.ok((restored.sqlite.prepare('SELECT archived_at FROM channels WHERE id=?').get('ch') as any).archived_at)
    const publication=restored.sqlite.prepare('SELECT id FROM operational_playlist_revisions').get() as {id:string}
    const encrypted=restored.sqlite.prepare('SELECT payload FROM operational_playlist_revisions WHERE id=?').get(publication.id) as {payload:string}
    const restoredPayload=JSON.parse(loadInstallationVault(join(dirs.reserve,'vault.json'),false).decrypt(encrypted.payload,'operational_playlist_revisions.payload'))
    assert.equal(restoredPayload.items[0].title,'PUBLICADO');assert.equal(restoredPayload.assets[0].contentHash,hash)
    const cursor=JSON.parse((restored.sqlite.prepare('SELECT payload FROM channel_checkpoints WHERE channel_id=?').get('ch') as {payload:string}).payload)
    assert.equal(cursor.revisionId,publication.id);assert.equal(cursor.playing,false);assert.equal(cursor.realEngine,false);assert.ok(cursor.elapsed>25)
    for(const table of ['users','sessions','output_profiles','live_sources','operator_decisions','as_run'])assert.equal((restored.sqlite.prepare(`SELECT count(*) n FROM ${table}`).get() as any).n,0)
    const asset=restored.sqlite.prepare('SELECT path,qc_status FROM media_assets').get() as {path:string;qc_status:string}
    assert.equal(asset.path,replicaFile);assert.equal(asset.qc_status,'PENDING');assert.equal(createHash('sha256').update(await readFile(asset.path)).digest('hex'),hash)
    const encryptedEvidence=restored.sqlite.prepare('SELECT payload FROM ha_recovery_media WHERE content_hash=?').get(hash) as {payload:string}
    const localEvidence=JSON.parse(loadInstallationVault(join(dirs.reserve,'vault.json'),false).decrypt(encryptedEvidence.payload,`ha-recovery:v1:${cluster}:reserve:${rehearsalRequest.requestId}:media:${hash}`))
    assert.equal(localEvidence.decoded,true);assert.equal(localEvidence.checks.playable,!rejectMissingAudio);assert.ok(localEvidence.probe.decodedVideoBuffers>0)
    if(rejectMissingAudio)assert.ok(localEvidence.checks.errors.includes('Áudio obrigatório ausente ou não sondado.'))
    assert.deepEqual(localEvidence.probe.video,{width:320,height:180,rateNum:25,rateDen:1,interlaceMode:'progressive'})
    assert.equal(localEvidence.probe.videoCodec,'video/x-h264')
    if(useAudio){assert.ok(localEvidence.probe.decodedAudioBuffers>0);assert.equal(localEvidence.probe.audio.channels,2);assert.ok(Number.isFinite(localEvidence.loudnessFile.integratedLufs));assert.ok(Math.abs(localEvidence.loudnessFile.integratedLufs-sourceProbe.audio.integratedLufs)<0.1)}
    else assert.equal(localEvidence.probe.decodedAudioBuffers,0)
  }finally{restored.sqlite.close()}
  // A genuine independent domain builder claims an intent and pauses before
  // media validation. The production compiled HTTP handler must refuse its
  // release while alive, then reconcile after this owned child is killed.
  const interruptedRequest={requestId:randomUUID(),channelId:'ch',sequence:confirmed}
  const workspaceBefore=createHash('sha256').update(await readFile(recoveryRow.workspace)).digest('hex')
  const builder=spawn(process.execPath,['--import',pathToFileURL(join(root,'apps/server/node_modules/tsx/dist/loader.mjs')).href,join(root,'scripts/qa-ha-recovery-builder.mts'),join(dirs.reserve,'mirror.db'),interruptedRequest.requestId,'ch',String(confirmed)],{cwd:dirs.reserve,windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...baseEnvironment,RPLAYOUT_VAULT_FILE:join(dirs.reserve,'vault.json')}})
  children.set('builder',builder);logs.set('builder','')
  for(const stream of [builder.stdout,builder.stderr])stream?.on('data',chunk=>logs.set('builder',(logs.get('builder')+String(chunk)).slice(-8000)))
  await wait('Criador próprio não registrou CHECKING',()=>Boolean(logs.get('builder')?.includes('"paused":true')))
  const paused=JSON.parse(logs.get('builder')!.split('\n').find(line=>line.startsWith('{"paused":'))!)
  assert.equal(paused.pid,builder.pid);assert.equal(paused.requestId,interruptedRequest.requestId)
  const held=await api('reserve','/api/ha/rehearsal/reconcile',interruptedRequest,409)
  assert.ok(held.error.includes('Criador ainda vivo'))
  await api('reserve','/api/ha/rehearsal',{...interruptedRequest,requestId:randomUUID()},409)
  const builderClosed=once(builder,'close',{signal:AbortSignal.timeout(10_000)});builder.kill('SIGKILL');await builderClosed;children.delete('builder')
  await wait('Criador próprio ainda existe',()=>!alive(paused.pid),10_000)
  const reconciled=await api('reserve','/api/ha/rehearsal/reconcile',interruptedRequest)
  assert.equal(reconciled.phase,'REFUSED');assert.ok(reconciled.reconciled?.at);assert.equal(reconciled.promotionReady,false)
  assert.deepEqual(await api('reserve','/api/ha/rehearsal/reconcile',interruptedRequest),reconciled)
  assert.deepEqual(await api('reserve','/api/ha/rehearsal',interruptedRequest),reconciled)
  assert.equal(createHash('sha256').update(await readFile(recoveryRow.workspace)).digest('hex'),workspaceBefore,'Reconciliation changed completed workspace')
  const subsequent=await api('reserve','/api/ha/rehearsal',{...interruptedRequest,requestId:randomUUID()})
  assert.equal(subsequent.phase,'RESTORED');assert.equal(subsequent.promotionReady,false)
  assert.equal((await api('reserve','/api/processes')).processes.some((p:any)=>p.kind==='ENGINE'&&p.pid),false)
  await stop('reserve')
  reserveDb=new Database(join(dirs.reserve,'main.db'))
  reserveDb.prepare('INSERT INTO channels(id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run('local','Reserva local não autorizada',25,1,320,180,-23,-1,5,now)
  assert.equal((reserveDb.prepare('SELECT count(*) n FROM as_run').get() as any).n,0,'Espelho contaminou as-run local')
  await start('reserve');assert.equal((await api('reserve','/api/ha/status')).sequence,confirmed)
  assert.deepEqual(await api('reserve','/api/ha/rehearsal',rehearsalRequest),rehearsal,'Lost response must not rebuild after restart')
  assert.deepEqual(await api('reserve','/api/ha/rehearsal/reconcile',interruptedRequest),reconciled,'Reconciled result must persist, never repeat work')
  assert.equal((await api('reserve','/api/processes')).processes.some((p:any)=>p.kind==='ENGINE'&&p.pid),false,'Reserva abriu engine após restart com canal local')
  await start('primary')
  await wait('Remetente não continuou sequência durável após crash',async()=>(await api('reserve','/api/ha/status')).sequence>confirmed)
  assert.equal((await api('reserve','/api/processes')).processes.some((p:any)=>p.kind==='ENGINE'&&p.pid),false)
  assert.notEqual(loadInstallationVault(join(dirs.primary,'vault.json'),false).fingerprint,loadInstallationVault(join(dirs.reserve,'vault.json'),false).fingerprint)
  console.log(JSON.stringify({result:'PASS',directory,ports,evidence:'INDEPENDENT_COMPILED_SERVERS_NATIVE_PGM_DURABLE_MIRROR_MEDIA_AND_ISOLATED_RESTORE',nativeWitnessIntegrated:useWitness,nativeProgram:true,publishedEditionNotDraft:true,checkpointAndAsRunReplicated:true,reserveRestartKeepsSequence:true,primaryCrashContinuesSequence:true,independentVaults:true,independentDatabases:true,reserveDoesNotLaunchEngine:true,mediaCopyValidated:true,replicaFile,mediaHash:hash,partialBeforeResume:partialBefore,mediaResumeValidated:true,rehearsal,nativeLocalProbeValidated:true,nativeStereoLoudnessValidated:useAudio,nativeMissingAudioQcRefusalValidated:rejectMissingAudio,recoveryWorkspace:recoveryRow.workspace,rehearsalReplayOnlyQueries:true,interruptedRehearsal:{requestId:interruptedRequest.requestId,ownerPid:paused.pid,reconciled:reconciled.phase,aliveOwnerRefused:true,completedWorkspacePreserved:true,restartPersists:true,newRequestRestored:true},takeoverValidated:false,physicalOutputValidated:false,physicalHostFailoverValidated:false}))
}finally{await stop('primary');await stop('reserve');for(const name of ['builder','witness']){const child=children.get(name);if(child?.pid&&alive(child.pid)){const closed=once(child,'close',{signal:AbortSignal.timeout(10_000)});child.kill('SIGKILL');await closed;await wait('Filho próprio não encerrou '+name,()=>!alive(child.pid!),10_000)}}mirrorDb?.close();reserveDb?.close();primaryDb.sqlite.close()}
