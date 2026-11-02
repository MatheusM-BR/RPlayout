import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
import {stereoToneStatistics} from './lib/verify-published-audio.ts'

// Recheck completed evidence only; never tune a source or restart a process.
const directory=resolve(process.argv[2]??'')
assert.ok(process.argv[2],'Pass the completed QA evidence directory')
const bytes=await readFile(join(directory,'result.json')),r=JSON.parse(bytes),l=r.lifecycle
const program=l.mode==='COMPILED_NATIVE_PROGRAM_RECOVERY',bus=program?'pgm':'pvw'
assert.equal(r.result,'FIXTURE_FINISHED');assert.equal(r.error,null);assert.equal(r.expired,false)
assert.ok(program||l.mode==='INSTALLED_INPUT_RECOVERY');assert.equal(l.result,'PASS');assert.equal(l.automaticRecovery,true)
assert.ok(['NDI','OMT'].includes(l.kind));assert.equal(l.cueRequests,1)
assert.equal(r.sourceWebOverride,false);assert.equal(r.devicesOverride,false)
assert.match(r.hashes.engine,/^[a-f0-9]{64}$/)
if(l.sourceServerOverride)assert.ok(['e4a01600e18efc6439c3a87bfcd7d4944b959257412fbf005a85914345a3b619','678c891fb823434d6c68636710a791b596ff7510d333983b4407506f46328a6b','6a86a3ce26164c5b55603336f7ce96d469f92a6e48e3f38c0d8c7d9250516d43'].includes(r.hashes.server))
else assert.equal(r.hashes.server,'5f33c58e58e2d26294fad3eff71f994c82d093ae0f6159dac91bde8508a64607')
assert.equal(r.hashes.web,'cd7665dea5b70b1b9cba4d9fb9af667085869e22f67c868b3105eaced818c173')
assert.deepEqual(l.heartbeatFailures??[],[]);assert.deepEqual(l.pollFailures??[],[])
assert.equal(l.receiverAfter.pid,l.receiverBefore.pid)
for(const key of ['restarts','deaths','stalls'])assert.equal(l.receiverAfter.details[key],l.receiverBefore.details[key])
assert.deepEqual(l.selectionAfter,l.selectionBefore)
// TAKE can consume/clear the native PVW opening. PVW identity is meaningful
// for the PVW scenario, never a substitute for a PGM decoder observation.
if(!program){assert.equal(l.decoderAfter.itemId,l.decoderBefore.itemId);assert.equal(l.decoderAfter.decoderId,l.decoderBefore.decoderId)}
assert.ok(['LOST','FAILED'].includes(l.lossObserved.signal.busStates[bus]))
assert.equal(l.lossObserved.signal.busSignals[bus].videoRecent,false)
assert.equal(l.lossObserved.signal.busSignals[bus].audioRecent,false)
assert.equal(l.recoveredSignal.busStates[bus],program?'ON_PGM':'PVW_READY')
assert.equal(l.recoveredSignal.busSignals[bus].videoRecent,true);assert.equal(l.recoveredSignal.busSignals[bus].audioRecent,true)
assert.ok(l.recoveredAt>l.senderReturn.at);assert.notEqual(l.senderReturn.oldPid,l.senderReturn.newPid)
const before=r.captures.find(row=>row.label===l.kind.toLowerCase()+'-before-loss')
const after=r.captures.find(row=>row.label===l.kind.toLowerCase()+'-after-return')
assert.equal(r.captures.length,2);assert.ok(before&&after)
for(const [capture,hz] of [[before,997],[after,1511]]){
  assert.deepEqual(capture.preview,l.selectionBefore)
  if(program){assert.equal(capture.bus,'pgm');assert.equal(capture.onAir.itemId,'live-main');assert.equal(capture.onAir.startedAt,l.programOrigin);assert.match(capture.picture.path,/\/mon$/);assert.match(capture.audio.path,/\/mon$/)}
  assert.equal(capture.picture.width,428);assert.equal(capture.picture.height,240)
  assert.equal(capture.picture.receiverSettlingFrames,75);assert.ok(capture.picture.deviation>10)
  assert.equal(capture.audio.expectedHz,hz);assert.equal(capture.audio.rate,48000)
  assert.equal(capture.audio.rms.length,2);assert.equal(capture.audio.frequencyHz.length,2)
  // Re-read saved decoded pixels/PCM, not merely the controller's summary.
  const gray=await readFile(join(directory,capture.label+'-last.gray'))
  assert.equal(gray.length,428*240)
  const mean=gray.reduce((sum,value)=>sum+value,0)/gray.length
  const deviation=Math.sqrt(gray.reduce((sum,value)=>sum+(value-mean)**2,0)/gray.length)
  assert.equal(mean,capture.picture.mean);assert.equal(deviation,capture.picture.deviation)
  const audio=stereoToneStatistics(await readFile(join(directory,capture.label+'-audio.f32')))
  for(const key of ['frames','analyzedFrames','rate','rms','frequencyHz'])assert.deepEqual(audio[key],capture.audio[key])
  for(let channel=0;channel<2;channel++){
    assert.ok(capture.audio.rms[channel]>0.01&&capture.audio.rms[channel]<0.15)
    assert.ok(Math.abs(capture.audio.frequencyHz[channel]-hz)<35)
  }
}
assert.ok(Math.abs(after.picture.mean-before.picture.mean)>30)
assert.equal(r.senders.length,2)
const original=r.senders.find(row=>row.purpose==='BASELINE'),returned=r.senders.find(row=>row.purpose==='RETURNED_INPUT')
assert.equal(original.name,returned.name);assert.equal(original.name,l.senderReturn.name)
for(const sender of r.senders){assert.equal(sender.exitCode,0);assert.equal(sender.forcedStop,false);assert.equal(sender.closed,true);assert.deepEqual(sender.errors,[])}
assert.ok(r.snapshots.length>0)
if(program){
  assert.equal(l.takeRequests,l.expiringTake?2:1);assert.equal(l.cuedBeforeTake.onAir,null)
  if(l.expiringTake){
    assert.equal(l.expiringTake.itemId,'live-main');assert.equal(l.expiringTake.onAir.itemId,'live-main')
    assert.equal(l.expiringTake.onAir.startedAt,l.programOrigin)
    assert.ok(l.expiringTake.cancelledAt-l.expiringTake.requestedAt>=9000)
    assert.ok(l.expiringTake.cancelledAt-l.expiringTake.requestedAt<=25000)
    assert.match(l.expiringTake.diagnostic,/10 segundos/)
    assert.equal(l.expiringTake.response.live.transport.preparedItemId,'live-main')
    assert.equal(l.expiringTake.response.live.transport.preparingItemId,null)
    for(const observation of l.expiringTake.observations){
      if(observation.alerts.some(row=>row.kind==='ENGINE'&&row.message.includes('10 segundos')))continue
      assert.equal(observation.prepared,'live-main','Automatic Next cannot replace a pending operator TAKE')
      assert.equal(observation.preparing,null)
    }
    assert.ok(l.senderReturn.at>l.expiringTake.cancelledAt,'Input returns only after native rejection; no late TAKE')
  }
  assert.deepEqual(l.cuedBeforeTake.preview,{kind:'ITEM',id:'live-main'})
  assert.equal(r.asRun.count,1);assert.equal(r.items.count,2)
  assert.equal(l.asRunBefore.length,1);assert.equal(l.asRunAfter.length,1)
  assert.equal(l.asRunAfter[0].id,l.asRunBefore[0].id);assert.equal(l.asRunAfter[0].itemId,'live-main');assert.equal(l.asRunAfter[0].endedAt,null)
  assert.equal(l.lossObserved.onAir.itemId,'live-main');assert.equal(l.lossObserved.onAir.startedAt,l.programOrigin)
  assert.equal(l.onAirAfter.itemId,'live-main');assert.equal(l.onAirAfter.startedAt,l.programOrigin)
  assert.ok(l.onAirAfter.elapsed>l.beforeLoss.onAir.elapsed)
  if(l.lossClock){
    assert.ok(l.lossClock.elapsedMs>=3000)
    assert.equal(l.lossClock.expectedFrames,l.lossClock.elapsedMs/40)
    assert.ok(Math.abs(l.lossClock.frames-l.lossClock.expectedFrames)<=10)
    assert.equal(l.lossClock.after.elapsed-l.lossClock.before.elapsed,l.lossClock.frames)
    const window=r.snapshots.filter(row=>row.onAir&&row.onAir.elapsed>=l.lossClock.before.elapsed&&row.onAir.elapsed<=l.lossClock.after.elapsed)
    assert.ok(window.length>=2,'Clock progression needs multiple native snapshots')
    assert.ok(window[0].onAir.elapsed<=l.lossClock.before.elapsed+10)
    assert.ok(window.at(-1).onAir.elapsed>=l.lossClock.after.elapsed-10)
    let received
    for(const row of window){
      const source=row.liveSources.find(signal=>signal.busItemIds?.pgm==='live-main')
      assert.equal(source.busSignals.pgm.videoRecent,false)
      assert.equal(source.busSignals.pgm.audioRecent,false)
      received??=source.measurements.pgm.receivedFrames
      assert.equal(source.measurements.pgm.receivedFrames,received,'Source must remain absent throughout clock measurement')
    }
  }
  let seen=false,elapsed=-1
  for(const row of r.snapshots){if(row.onAir){seen=true;assert.equal(row.onAir.itemId,'live-main');assert.equal(row.onAir.startedAt,l.programOrigin);assert.equal(row.playing,true);assert.ok(row.onAir.elapsed>=elapsed);elapsed=row.onAir.elapsed}else assert.equal(seen,false)}
}else{
  assert.equal(r.asRun.count,0);assert.equal(r.items.count,0)
  for(const row of r.snapshots){assert.equal(row.onAir,null);assert.equal(row.playing,false)}
}
assert.equal(r.nativeStopped,true);assert.equal(r.serverExitObserved,true);assert.equal(r.carrierStopped,true)
const report={result:'PASS',kind:l.kind,bus,programRecoveryValidated:program,lossClockValidated:Boolean(program&&l.lossClock),lossClock:l.lossClock??null,sourceEngineOverride:l.sourceEngineOverride??false,sourceServerOverride:l.sourceServerOverride??false,enginePath:l.enginePath??null,hashes:r.hashes,evidenceSha256:createHash('sha256').update(bytes).digest('hex'),savedPixelsAndPcmRecomputed:true,cueRequests:1,takeRequests:l.takeRequests??0,receiverPid:l.receiverAfter.pid,previewDecoderId:l.decoderAfter?.decoderId??null,programDecoderIdentityValidated:false,loss:l.lossObserved.signal.busStates[bus],asRunPreserved:program?true:null,pictureMeans:[before.picture.mean,after.picture.mean],frequencyHz:[before.audio.frequencyHz,after.audio.frequencyHz],cleanReadDiagnostics:true,cleanupConfirmed:true,limits:['Synthetic loopback signal, not external hardware/vendor/remote qualification',program?'Live already on PGM; not a VT interruption/return or final physical output qualification':'PVW/QC recovery only; no playing PGM interruption test',...(program&&!l.lossClock?['Older recovery evidence does not validate clock progression during source loss']:[]),'No long-run soak, color/audio fidelity or clean-Windows qualification','Source overlays, when true, are not an installed release validation','Preview decoder identity alone does not prove the PGM decoder identity']}
await writeFile(join(directory,'assertions-input-recovery.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))
