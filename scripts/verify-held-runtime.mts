import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'

// Real SQLite/runtime/native generation fixture. Null or explicit local file; not a
// physical/hardware qualification or server-host power loss rehearsal.
const root=fileURLToPath(new URL('..',import.meta.url))
const installedArgument=process.argv.find(value=>value.startsWith('--installed-runtime='))
const installed=installedArgument?resolve(installedArgument.slice('--installed-runtime='.length)):null
const qaArgument=process.argv.find(value=>value.startsWith('--qa-root='))
const qaRoot=qaArgument?resolve(qaArgument.slice('--qa-root='.length)):join(root,'scratch')
if(installed){
  assert.equal(qaRoot.toLowerCase(),resolve('D:/RPlayout-builds/qa').toLowerCase())
  assert.ok(installed.toLowerCase().startsWith(qaRoot.toLowerCase()+'\\'))
  assert.equal(resolve(process.execPath).toLowerCase(),join(installed,'runtime/node/node.exe').toLowerCase())
}
const directory=await mkdtemp(join(qaRoot,'held-runtime-'))
const failCheckpoint=process.argv.includes('--fail-checkpoint')
const watchdogHeld=process.argv.includes('--watchdog-held')
const graphicsHeld=process.argv.includes('--graphics-held')
const captureHeldBackup=process.argv.includes('--capture-held-backup')
const captureTwoHeld=process.argv.includes('--capture-two-held')
const captureNextItem=process.argv.includes('--capture-next-item')
assert.ok(!captureNextItem||captureHeldBackup&&installed,'Next item only in the packaged-engine held capture')
assert.ok(!captureTwoHeld||captureHeldBackup,'Two channels only in own backup capture')
const backupHeld=process.argv.includes('--backup-held')||captureHeldBackup
const compensationCue=process.argv.includes('--compensation-cue')
const localHeldPreview=process.argv.includes('--local-held-preview')
const localHeldFile=process.argv.includes('--local-held-file')
const localHeldAdmission=process.argv.includes('--local-held-admission')||localHeldPreview||localHeldFile
const engineArgument=process.argv.find(value=>value.startsWith('--engine-binary='))
assert.ok(!localHeldFile||engineArgument,'Local file requires the explicit updated engine binary')
assert.ok(!localHeldFile||!installed&&!localHeldPreview&&!captureNextItem,'Local file uses source fixture and no network preview')
assert.ok(!engineArgument||localHeldFile,'Engine override is restricted to the local-file QA scenario')
if(localHeldFile){
  assert.equal(qaRoot.toLowerCase(),join(root,'scratch').toLowerCase(),'Local file writes only in workspace scratch')
  // Clean only this QA process before imports. Do not borrow service credentials,
  // network destinations, hardware decode or registry paths from an operator.
  for(const key of Object.keys(process.env))if(/^(RPLAYOUT_|GST_|GSTREAMER_|MTX_|RTSP_)/i.test(key))delete process.env[key]
  Object.assign(process.env,{RPLAYOUT_MEDIAMTX:'',RPLAYOUT_RELAY:'',RPLAYOUT_ENCODER:'x264enc',RPLAYOUT_STORAGE_MODE:'INLINE',GSTREAMER_1_0_ROOT_MSVC_X86_64:'C:/Program Files/gstreamer/1.0/msvc_x86_64',TEMP:directory,TMP:directory})
}
assert.ok(!localHeldAdmission||!compensationCue&&!graphicsHeld&&!watchdogHeld&&!failCheckpoint&&!backupHeld,'Local admission is its own isolated scenario')
assert.ok(!graphicsHeld||!watchdogHeld&&!failCheckpoint,'graphics fixture uses new runtime recovery mode')
const binary=engineArgument?resolve(engineArgument.slice('--engine-binary='.length)):installed?join(installed,'apps/engine/target/release/rplayout-engine.exe'):join(root,'apps/engine/target/debug/rplayout-engine.exe')
if(engineArgument){
  assert.equal(binary.toLowerCase(),resolve('D:/RPlayout-builds/native-r83-20261016/release/rplayout-engine.exe').toLowerCase())
  assert.equal(createHash('sha256').update(await readFile(binary)).digest('hex'),'0250cf3164ed72ea7ed2bd3c7e641d0e7ac79b225bdb6d4f7bab9478a8ec0c7e','Previously compiled product binary only; no rebuild or D: write')
}
const gstRoot=installed?join(installed,'runtime/gstreamer'):process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64??'C:/Program Files/gstreamer/1.0/msvc_x86_64'
const gstBin=join(gstRoot,'bin')
if(localHeldFile)console.log(JSON.stringify({directory,scenario:'local-held-file',engine:binary,networkOutputs:false}))
Object.assign(process.env,{RPLAYOUT_ENGINE:binary,RPLAYOUT_VAULT_FILE:join(directory,'vault.json'),PATH:gstBin+';'+process.env.PATH,GST_PLUGIN_PATH:join(gstRoot,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gstRoot,'lib/gstreamer-1.0'),GST_PLUGIN_SCANNER:join(gstRoot,'libexec/gstreamer-1.0/gst-plugin-scanner.exe'),GST_REGISTRY:join(directory,'registry.bin')})
if(installed){
  process.env.RPLAYOUT_INSTALL_ROOT=installed
  const manifest=JSON.parse(await readFile(join(installed,'package-manifest.json'),'utf8'))
  assert.equal(createHash('sha256').update(await readFile(binary)).digest('hex'),manifest.files.find((entry:any)=>entry.file==='apps/engine/target/release/rplayout-engine.exe').sha256.toLowerCase())
}
const file=join(directory,'Fonte-ação.mkv')
await promisify(execFile)(join(gstBin,'gst-launch-1.0.exe'),['-q','matroskamux','name=m','!','filesink',`location=${file.replaceAll('\\','/')}`,'videotestsrc','num-buffers=500','pattern=ball','!','video/x-raw,width=320,height=180,framerate=25/1','!','videoconvert','!','vp8enc','deadline=1','!','queue','!','m.','audiotestsrc','num-buffers=940',captureNextItem||localHeldFile?'volume=0.05':'volume=0.4',...(captureNextItem||localHeldFile?['freq=997']:[]),'!','audio/x-raw,channels=2,rate=48000','!','audioconvert','!','vorbisenc','!','queue','!','m.'],{env:process.env,windowsHide:true,timeout:60000})
const {openDatabase}=await import('../apps/server/src/db/client.js')
const {channels,rundowns,mediaAssets,rundownItems}=await import('../apps/server/src/db/schema.js')
const {getChannel}=await import('../apps/server/src/db/repo.js')
const {publishOperationalPlaylist}=await import('../apps/server/src/domain/operational-playlist.js')
const {ExecutionOwnership}=await import('../apps/server/src/domain/execution-ownership.js')
const {Checkpoints}=await import('../apps/server/src/domain/checkpoints.js')
const {ChannelRuntime}=await import('../apps/server/src/app.js')
const {EngineTransport}=await import('../apps/server/src/domain/engine.js')
const {GraphicCommandLedger}=await import('../apps/server/src/domain/graphic-command-ledger.js')
const {backupDatabase}=await import('../apps/server/src/domain/backup.js')
const Sqlite=createRequire(new URL('../apps/server/package.json',import.meta.url))('better-sqlite3') as typeof import('../apps/server/node_modules/@types/better-sqlite3/index.js')
const database=openDatabase(join(directory,'runtime.db')),stamp=new Date().toISOString()
const hash=createHash('sha256').update(await readFile(file)).digest('hex')
database.db.insert(channels).values({id:'held',name:'Held fixture',width:320,height:180,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:stamp}).run()
database.db.insert(rundowns).values({id:'rd',channelId:'held',name:'Published held fixture',date:stamp.slice(0,10),plannedStart:0,loop:false,createdAt:stamp,updatedAt:stamp}).run()
database.db.insert(mediaAssets).values({id:'asset',title:'Real generated VT',path:file,contentHash:hash,kind:'VIDEO',durationFrames:500,durationNs:20_000_000_000,width:320,height:180,rateNum:25,rateDen:1,hasAudio:true,interlaceMode:'progressive',qcStatus:'APPROVED',createdAt:stamp}).run()
database.db.insert(rundownItems).values({id:'vt',rundownId:'rd',sortOrder:0,title:'Published VT',type:'VT',mediaId:'asset',trim:{in:25,out:400},minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',autoNext:false,loop:false,locked:false}).run()
if(captureNextItem||localHeldFile){
  const {hashPassword}=await import('../apps/server/src/domain/auth.js')
  database.sqlite.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('held-qa','held-frame-verifier',await hashPassword('Local-held-frame-20261017'),'ADMIN',1,stamp)
  database.db.insert(rundownItems).values({id:'vt-next',rundownId:'rd',sortOrder:1,title:'Explicit next after HELD',type:'VT',mediaId:'asset',trim:{in:0,out:450},minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',autoNext:false,loop:false,locked:false}).run()
}
const channel=(await getChannel(database.db,'held'))!
if(compensationCue)database.db.insert(rundownItems).values({id:'future-filler',rundownId:'rd',sortOrder:1,title:'Future filler',type:'FILLER',mediaId:'asset',durationOverride:100,trim:{in:0,out:100},elastic:{min:25,max:200},minDuration:25,anchor:{kind:'FLOW'},onOverrun:'PUSH',autoNext:false,loop:false,locked:false}).run()
await publishOperationalPlaylist(database.db,channel,'rd','@isolated-verifier')
let secondChannel:typeof channel|null=null
if(captureTwoHeld){
 database.db.insert(channels).values({id:'held-second',name:'Held second fixture',width:320,height:180,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:stamp}).run()
 database.db.insert(rundowns).values({id:'rd-second',channelId:'held-second',name:'Second published fixture',date:stamp.slice(0,10),plannedStart:0,loop:false,createdAt:stamp,updatedAt:stamp}).run()
 database.db.insert(rundownItems).values({id:'vt-second',rundownId:'rd-second',sortOrder:0,title:'Second VT',type:'VT',mediaId:'asset',trim:{in:50,out:425},minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',autoNext:false,loop:false,locked:false}).run()
 secondChannel=(await getChannel(database.db,'held-second'))!
 await publishOperationalPlaylist(database.db,secondChannel,'rd-second','@isolated-verifier')
}
const ownership=new ExecutionOwnership(database.db)
const {HostDistributionFence}=await import('../apps/server/src/domain/host-distribution-fence.js')
const {DistributionOwnership}=await import('../apps/server/src/domain/distribution-ownership.js')
const hostFence=localHeldAdmission?new HostDistributionFence(join(root,'apps/engine/target/release/rplayout-host-guard.exe')):null
let distribution:InstanceType<typeof DistributionOwnership>|null=null
const runtimes:Array<InstanceType<typeof ChannelRuntime>>=[]
async function wait(label:string,condition:()=>boolean|Promise<boolean>,timeout=30000){
  const deadline=Date.now()+timeout
  while(Date.now()<deadline){if(await condition())return;await new Promise(resolve=>setTimeout(resolve,25))}
  throw new Error(`${label}: ${JSON.stringify(runtimes.map(runtime=>({health:runtime.transport.health(),error:runtime.recoveryError})))}`)
}
function create(targetChannel=channel){
  const lease=ownership.claim(targetChannel.id),checkpoints=new Checkpoints(database.sqlite,lease)
  const runtime=new ChannelRuntime(targetChannel,database.db,[localHeldFile?'file:'+join(directory,'published-held-take.mkv'):'null'],compensationCue||localHeldPreview?'srt://127.0.0.1:19003?mode=caller':null,new Set(),new Map(),null,checkpoints,null,null,null,null,null,null,lease,distribution,localHeldAdmission?{host:hostFence!,assertAdmission:()=>{hostFence!.assertOwned();distribution!.assertOwned()}}:null)
  runtimes.push(runtime);assert.ok(runtime.transport instanceof EngineTransport)
  return {runtime,lease,checkpoints,engine:runtime.transport as InstanceType<typeof EngineTransport>}
}
let result:Record<string,unknown>|null=null
try{
  if(hostFence){
    assert.equal(await hostFence.acquire(),true,'Own host admission unavailable; no resource will be stolen')
    if(localHeldFile){await hostFence.freshProof();await hostFence.socketBindings()}
    distribution=new DistributionOwnership(database.db,ownership.identity,undefined,hostFence);distribution.claim()
  }
  const first=create();await first.runtime.load('rd')
  await first.engine.take('rd','vt');await wait('first PGM cursor',()=>Boolean(first.engine.state().onAir?.elapsed!>=5))
  await wait('first as-run',()=>Boolean(database.sqlite.prepare('SELECT id FROM as_run WHERE ended_at IS NULL').get()))
  const graphicsLedger=new GraphicCommandLedger(database.db,'held')
  if(graphicsHeld){
    const authorize=()=>{first.lease.assertOwned()}
    await graphicsLedger.execute({key:'held-graphic-fixture',actorId:null,actorName:'@isolated-verifier',native:true,context:()=>first.runtime.graphicContext(),selection:{action:'SHOW',layer:'STATION_LOGO',fixture:true}},authorize,send=>first.runtime.graphics.triggerLayerConfirmed('STATION_LOGO','SHOW',{name:'Held fixture logo',payload:{text:'HELD'},fadeMs:0},authorize,send))
    assert.equal(first.runtime.graphics.displaySnapshot().layers.STATION_LOGO.active,true)
  }
  if(compensationCue){
    const {inspectCompensation,commitCompensation}=await import('../apps/server/src/domain/operational-compensation.js')
    const context=()=>({...first.runtime.insertionContext(),onAir:first.engine.state().onAir,preview:first.engine.state().preview})
    const before=first.engine.programDecoderBinding()!,input={itemId:'future-filler',expectedFrames:100,action:'FILLER' as const,deltaFrames:25}
    const review=inspectCompensation(database.db,context(),input,'@isolated-verifier')
    await first.engine.cue({kind:'ITEM',id:'future-filler'})
    await wait('preview state after acknowledged CUE',()=>Boolean(first.engine.state().previewPosition))
    await wait('actual delivered PVW frame of current decoder',()=>first.engine.previewFrameEvidence()?.delivered===true)
    const selectedPreview=first.engine.state().preview
    assert.equal(selectedPreview?.kind,'ITEM');assert.equal(selectedPreview?.kind==='ITEM'?selectedPreview.id:null,'future-filler')
    assert.deepEqual(first.engine.programDecoderBinding(),before)
    assert.throws(()=>commitCompensation(database.db,context(),input,'isolated-cue-request',review.review.reviewToken,'@isolated-verifier',()=>first.lease.assertOwned()),/CUE/)
    assert.deepEqual(database.sqlite.prepare("SELECT count(*) n FROM operator_decisions WHERE kind='OPERATIONAL_COMPENSATION'").get(),{n:0})
    const initialFrame=first.engine.previewFrameEvidence()!
    await first.engine.cue(null)
    assert.equal(first.engine.previewFrameEvidence(),null,'Clear cannot retain a previously delivered frame')
    await first.engine.cue({kind:'ITEM',id:'future-filler'})
    await wait('replacement PVW decoder delivery',()=>{const frame=first.engine.previewFrameEvidence();return Boolean(frame?.delivered&&frame.decoderId!==initialFrame.decoderId)})
    const replacementFrame=first.engine.previewFrameEvidence()!
    assert.deepEqual(first.engine.programDecoderBinding(),before)
    first.runtime.checkpoint(true)
    const child=(first.engine as unknown as {child:import('node:child_process').ChildProcess}).child
    const oldPid=child.pid
    const ended=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await ended
    assert.equal(first.engine.previewFrameEvidence(),null,'Dead engine cannot retain PVW proof')
    await wait('watchdog new engine ready',()=>{first.engine.watchdog();return first.engine.health().ready&&first.lease.assertOwned().enginePids.some(pid=>pid!==oldPid)})
    assert.equal(first.engine.previewFrameEvidence(),null,'Restart must not certify old PVW before fresh CUE')
    await first.engine.cue({kind:'ITEM',id:'future-filler'})
    await wait('new process PVW delivery',()=>first.engine.previewFrameEvidence()?.delivered===true)
    result={passed:true,directory,scope:'Current, replacement and restarted process deliver PVW; on-demand publisher not activated, no pixel capture or browser',preview:first.engine.state().preview,position:first.engine.state().previewPosition,initialFrame,replacementFrame,restartedFrame:first.engine.previewFrameEvidence(),oldPid,newPid:first.lease.assertOwned().enginePids[0],clearDropsEvidence:true,exitDropsEvidence:true,restartNeedsNewCue:true,pgmBeforeRestart:before,compensationRefused:true,engineSha:createHash('sha256').update(await readFile(binary)).digest('hex')}
  }else{
  const binding=first.engine.programDecoderBinding()!
  await (first.engine as unknown as {request(command:Record<string,unknown>):Promise<void>}).request({cmd:'programHold',itemId:'vt',decoderId:binding.decoderId,on:true})
  first.runtime.checkpoint(true)
  const saved=first.checkpoints.read('held')!
  assert.equal(saved.playing,false);assert.equal(saved.programHold?.status,'HELD');assert.ok(saved.executionId&&saved.programTrim)
  let secondSaved:typeof saved|null=null
  if(secondChannel){
    const second=create(secondChannel);await second.runtime.load('rd-second');await second.engine.take('rd-second','vt-second')
    await wait('second native PGM cursor',()=>Boolean(second.engine.state().onAir?.elapsed!>=5))
    const decoder=second.engine.programDecoderBinding()!
    await (second.engine as unknown as {request(command:Record<string,unknown>):Promise<void>}).request({cmd:'programHold',itemId:'vt-second',decoderId:decoder.decoderId,on:true})
    second.runtime.checkpoint(true);secondSaved=second.checkpoints.read(secondChannel.id)!
    assert.equal(secondSaved.programHold?.status,'HELD')
  }
  let backupEvidence:Record<string,unknown>|null=null
  if(backupHeld){
    const backup=await backupDatabase(database.sqlite,join(directory,'backups'),{retainExisting:true})
    assert.equal(backup.validation.operationalState.savedHeldCheckpoints,secondChannel?2:1)
    assert.equal(backup.validation.operationalState.savedPlayingCheckpoints,0)
    assert.equal(backup.validation.operationalState.executionResumeAllowed,false)
    const copy=new Sqlite(backup.file,{readonly:true,fileMustExist:true})
    try{assert.deepEqual(new Checkpoints(copy).read('held'),saved)}finally{copy.close()}
    backupEvidence={file:backup.file,validation:backup.validation,identicalCheckpoint:true,automaticResumeAllowed:false}
  }
  if(captureHeldBackup){
    result={passed:true,directory,saved,secondSaved,backupEvidence,installedRuntime:installed,nextItem:captureNextItem?'vt-next':null,sourceBackendPackaged:false,sourcePid:process.pid,sourceEnginePids:runtimes.map(runtime=>(runtime.transport as InstanceType<typeof EngineTransport>).processId()),sourceEnginePid:first.engine.processId(),engineSha:createHash('sha256').update(await readFile(binary)).digest('hex'),scope:'Actual domain/runtime HELD fixture with declared metadata and native engine; not installed source backend or ingest/QC certification; processes close in finally before parent restores'}
  }else if(localHeldAdmission){
    assert.equal((first.engine as unknown as {programOutputsHeld:boolean}).programOutputsHeld,true)
    await writeFile(join(directory,'before-paused-admission.json'),JSON.stringify({saved,state:first.engine.state(),health:first.engine.health()},null,2))
    await wait('paused native position catches up to hold receipt',()=>first.engine.state().onAir?.elapsed===saved.elapsed)
    if(localHeldPreview)await assert.rejects(first.engine.releasePreviewOutput(async()=>{}),/admissão de PGM/)
    const proof=await first.engine.releaseProgramOutputs(async()=>{await hostFence!.freshProof();first.lease.assertOwned();distribution!.assertOwned()},true)
    assert.equal(proof.paused,true);assert.equal(proof.elapsed,saved.elapsed);assert.equal(proof.itemId,'vt')
    assert.equal((first.engine as unknown as {programOutputsHeld:boolean}).programOutputsHeld,false)
    if(localHeldPreview){await first.engine.releasePreviewOutput(async()=>{await hostFence!.freshProof();first.lease.assertOwned();distribution!.assertOwned()})}
    await new Promise(resolve=>setTimeout(resolve,1200))
    assert.equal(first.engine.state().playing,false);assert.equal(first.engine.state().onAir?.elapsed,saved.elapsed)
    result={passed:true,directory,scope:'Real local host/process/channel admission and native paused output release; Null output, not backup activation or physical publication',proof,previewReleasedAfterProgram:localHeldPreview,cursorStable:true,engineSha:createHash('sha256').update(await readFile(binary)).digest('hex')}
    if(localHeldFile){
      result.passed=false;result.scope='Source runtime with actual host/channel/process fencing and local encoded file; not installed backend, network output, ingest/QC, exact old-frame identity or physical signal qualification'
      const before=first.engine.programDecoderBinding()
      await first.engine.cue({kind:'ITEM',id:'vt-next'})
      await wait('New CUE frame while old PGM stays HELD',()=>first.engine.previewFrameEvidence()?.delivered===true)
      assert.deepEqual(first.engine.programDecoderBinding(),before)
      assert.equal(first.engine.state().playing,false);assert.equal(first.engine.state().onAir?.elapsed,saved.elapsed)
      result.cue={frame:first.engine.previewFrameEvidence(),heldState:first.engine.state()}
      await first.engine.take('rd','vt-next')
      await wait('Explicit TAKE leaves HELD',()=>first.engine.state().playing&&first.engine.state().onAir?.itemId==='vt-next'&&first.engine.state().onAir!.elapsed>=75)
      first.runtime.checkpoint(true)
      result.afterTake={state:first.engine.state(),checkpoint:first.checkpoints.read('held')}
      assert.equal(first.engine.health().programHold,null)
      const child=(first.engine as unknown as {child:import('node:child_process').ChildProcess}).child
      const ended=new Promise<{code:number|null;signal:NodeJS.Signals|null}>(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})))
      first.runtime.close()
      // Observe graceful native mux shutdown first. closeConfirmed below is
      // cleanup proof, not evidence that a killed file was finalized cleanly.
      const exit=await Promise.race([ended,new Promise<null>(resolve=>setTimeout(()=>resolve(null),6000))])
      result.engineExit=exit;assert.ok(exit,'Graceful file publisher shutdown not observed');assert.equal(exit.code,0);assert.equal(exit.signal,null)
      const {verifyLocalHeldFile}=await import('./lib/local-held-file-evidence.js')
      result.capture=await verifyLocalHeldFile({directory,gstBin,environment:process.env})
      result.asrun=database.sqlite.prepare('SELECT id,ended_at,ended_by,start_position_frames FROM as_run ORDER BY rowid').all()
      assert.deepEqual(database.sqlite.pragma('foreign_key_check'),[])
      result.hostProof=hostFence!.status();assert.equal(hostFence!.status().ownedHere,true)
      result.sourceMediaHash=hash;result.sourceBackendPackaged=false;result.physicalInputsValidated=false
      result.passed=true
    }
  }else{
  const ownedChild=(first.engine as unknown as {child:import('node:child_process').ChildProcess}).child
  const oldPid=ownedChild.pid;assert.ok(oldPid)
  const exited=new Promise(resolve=>ownedChild.once('exit',resolve));ownedChild.kill('SIGKILL');await exited
  await wait('owner observes old engine exit',()=>first.lease.assertOwned().enginePids.length===0)
  if(watchdogHeld){
    await wait('watchdog restores HELD with durable commit',()=>{
      first.engine.watchdog();first.runtime.checkpoint(true)
      return first.engine.health().ready&&first.engine.health().programHold?.status==='HELD'
    })
    const restored=first.checkpoints.read('held')!,health=first.engine.health()
    assert.equal(restored.executionId,saved.executionId);assert.equal(restored.elapsed,saved.elapsed);assert.equal(restored.playing,false)
    assert.deepEqual(restored.programTrim,saved.programTrim);assert.equal(restored.ownerRunId,saved.ownerRunId)
    assert.equal(first.engine.state().playing,false);assert.equal(health.programHold?.frames,saved.elapsed)
    assert.ok(first.lease.assertOwned().enginePids[0]);assert.equal(first.lease.assertOwned().predecessorResolved,true)
    assert.deepEqual(database.sqlite.prepare('SELECT count(*) AS n FROM as_run').get(),{n:2})
    assert.deepEqual(database.sqlite.prepare('SELECT count(*) AS n FROM as_run WHERE ended_at IS NULL').get(),{n:1})
    await new Promise(resolve=>setTimeout(resolve,1200));assert.equal(first.engine.state().onAir?.elapsed,saved.elapsed)
    result={passed:true,scope:'real runtime watchdog HELD recovery, SQLite/as-run/owner commit and native restart; Null output',directory,oldPid,newPid:first.lease.assertOwned().enginePids[0],saved,restored,health}
  }else{
  first.runtime.close();assert.equal((await first.engine.closeConfirmed(5000)).ownedNativeProcessesStopped,true)
  const second=create();assert.equal(await second.runtime.recoverCheckpoint(),true,second.runtime.recoveryError??undefined)
  if(failCheckpoint)database.sqlite.exec("CREATE TRIGGER held_runtime_fail_checkpoint BEFORE UPDATE ON channel_checkpoints BEGIN SELECT RAISE(ABORT,'held checkpoint write fixture refused'); END")
  second.runtime.checkpoint(true)
  if(failCheckpoint){
    await wait('checkpoint failure remains protected',()=>{
      second.runtime.checkpoint(true);return second.runtime.recoveryError?.includes('held checkpoint write fixture refused')===true
    })
    assert.deepEqual(second.checkpoints.read('held'),saved)
    assert.equal(second.lease.assertOwned().predecessorResolved,false)
    assert.equal(second.engine.health().ready,false)
    assert.equal(second.engine.state().playing,false)
    assert.deepEqual(database.sqlite.prepare('SELECT count(*) AS n FROM as_run').get(),{n:1},'checkpoint failure must roll back restored as-run segment too')
    result={passed:true,scope:'real native HELD confirmed, checkpoint write fault preserves old cursor/owner and rolls back predecessor resolution',directory,saved,remaining:second.checkpoints.read('held'),health:second.engine.health(),error:second.runtime.recoveryError,asrunCount:database.sqlite.prepare('SELECT count(*) AS n FROM as_run').get()}
  }else{
  await wait('committed HELD checkpoint',()=>{
    // Production's periodic runtime loop drives pending recovery after Ready.
    second.runtime.checkpoint(true)
    return second.checkpoints.read('held')?.ownerRunId===second.lease.assertOwned().id&&second.engine.health().ready
  })
  const restored=second.checkpoints.read('held')!,health=second.engine.health(),state=second.engine.state()
  assert.equal(restored.executionId,saved.executionId);assert.equal(restored.elapsed,saved.elapsed);assert.equal(restored.playing,false)
  assert.deepEqual(restored.programTrim,saved.programTrim);assert.equal(health.programHold?.status,'HELD');assert.equal(state.playing,false)
  assert.equal(health.programHold?.frames,saved.elapsed);assert.equal(restored.programHold?.decoderId,health.programHold?.decoderId)
  assert.equal(second.lease.assertOwned().predecessorResolved,true)
  const segments=database.sqlite.prepare('SELECT id,ended_by,start_position_frames,ended_at FROM as_run ORDER BY rowid').all() as Array<{id:string;ended_by:string|null;start_position_frames:number;ended_at:string|null}>
  assert.equal(segments.length,2);assert.ok(segments[0]!.ended_at);assert.equal(segments[1]!.start_position_frames,saved.elapsed);assert.equal(segments[1]!.ended_at,null)
  assert.equal(second.lease.ownsAsRun(segments[1]!.id),true)
  assert.deepEqual(database.sqlite.pragma('foreign_key_check'),[])
  let graphicsEvidence:Record<string,unknown>|null=null
  if(graphicsHeld){
    assert.ok(saved.graphicReceiptId,'checkpoint must bind confirmed native composition')
    const originalDisplay=graphicsLedger.confirmedDisplay(saved.graphicReceiptId)
    await wait('confirmed graphics restored while HELD',()=>{
      second.runtime.fireDueGraphics()
      return !graphicsLedger.hasUnresolved()&&graphicsLedger.latestNativeCompositionId()!==saved.graphicReceiptId&&second.runtime.graphics.displaySnapshot().layers.STATION_LOGO.active
    })
    const restoredReceipt=graphicsLedger.latestNativeCompositionId()!,display=graphicsLedger.confirmedDisplay(restoredReceipt)
    assert.equal(display.layers.STATION_LOGO.svg,originalDisplay.layers.STATION_LOGO.svg)
    assert.equal(second.engine.state().playing,false);assert.equal(second.engine.state().onAir?.elapsed,saved.elapsed)
    second.runtime.checkpoint(true);assert.equal(second.checkpoints.read('held')?.graphicReceiptId,restoredReceipt)
    graphicsEvidence={originalReceipt:saved.graphicReceiptId,restoredReceipt,layerActive:display.layers.STATION_LOGO.active,sameLayerSvg:true,checkpointBound:true,physicalPixelsValidated:false}
  }
  await new Promise(resolve=>setTimeout(resolve,1200));assert.equal(second.engine.state().onAir?.elapsed,saved.elapsed)
  result={passed:true,scope:'real runtime, SQLite, published plan and native processes; Null output, no physical pixels',directory,engineSha:createHash('sha256').update(await readFile(binary)).digest('hex'),oldPid,newPid:second.lease.assertOwned().enginePids[0]??null,saved,restored,finalCheckpoint:second.checkpoints.read('held'),health,segments,graphicsEvidence,backupEvidence}
  }
  }
  }
  }
  console.log(JSON.stringify(result,null,2))
}catch(error){
  if(localHeldFile)result={...result,passed:false,directory,error:error instanceof Error?{name:error.name,message:error.message}:String(error),hostStatus:hostFence?.status(),diagnostics:runtimes.map(runtime=>({health:runtime.transport.health(),error:runtime.recoveryError}))}
  throw error
}finally{
  const nativeCleanup=[]
  for(const runtime of runtimes){
    const engine=runtime.transport as InstanceType<typeof EngineTransport>
    const pid=(engine as unknown as {child:import('node:child_process').ChildProcess}).child?.pid??null
    runtime.close();const stopped=await engine.closeConfirmed(5000)
    nativeCleanup.push({pid,...stopped});assert.equal(stopped.ownedNativeProcessesStopped,true)
  }
  if(localHeldFile&&result){result.nativeCleanup=nativeCleanup;result.binary=binary;result.engineSha=createHash('sha256').update(await readFile(binary)).digest('hex')}
  await writeFile(join(directory,'result.json'),JSON.stringify(result??{passed:false,diagnostics:runtimes.map(runtime=>({health:runtime.transport.health(),error:runtime.recoveryError}))},null,2))
  distribution?.close();ownership.close();hostFence?.close();database.sqlite.close()
}
