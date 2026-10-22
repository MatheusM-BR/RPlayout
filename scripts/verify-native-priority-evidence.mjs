import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {resolve,join,relative,isAbsolute} from 'node:path'
import {createHash} from 'node:crypto'
import {stereoToneStatistics,syntheticToneSpectrum,syntheticToneWindows} from './lib/verify-published-audio.ts'

// Completed evidence only. No server, source tuning, TAKE or process restart.
assert.ok(process.argv[2],'Pass the completed priority QA directory')
const directory=resolve(process.argv[2]),bytes=await readFile(join(directory,'result.json')),r=JSON.parse(bytes),l=r.lifecycle
const missing=l.scenario==='NO_SIGNAL_AT_ANCHOR'
assert.equal(r.result,'FIXTURE_FINISHED');assert.equal(r.error,null);assert.equal(r.expired,false)
assert.equal(l.mode,'COMPILED_NATIVE_PRIORITY_NETWORK');assert.equal(l.result,'PASS')
assert.equal(l.sourceEngineOverride,true);assert.equal(l.sourceServerOverride,true)
assert.equal(r.sourceWebOverride,false);assert.equal(r.devicesOverride,false)
assert.equal(r.hashes.server,'a709115f976cc6372f1ffe13d1b9195261ffc217c0ebe2707990477056e0473a')
assert.ok(['eaea694fa34c23cef81bf6326fd31367e603a5768d67edf91468ab0aab66305c','7fd481e0b58a147c553477ec2b9eab397ebad4ed9136f0d2d589b6981b141eb9'].includes(r.hashes.engine))
assert.equal(r.hashes.web,'cd7665dea5b70b1b9cba4d9fb9af667085869e22f67c868b3105eaced818c173')
assert.ok(['NDI','OMT'].includes(l.kind));assert.equal(r.selectedSources.length,1)
const source=r.selectedSources[0]
assert.equal(source.kind,l.kind);assert.ok(source.reference.startsWith(l.kind.toLowerCase()+':'))
assert.ok(r.discovery[l.kind.toLowerCase()].sources.some(row=>row.discovery==='DISCOVERED'&&row.reference===source.reference))
assert.equal(l.cueRequests,1);assert.equal(l.takeRequests,1);assert.equal(r.items.count,2)
const total=l.fixtureMedia.frames
assert.ok(total===2250||missing&&total===3000);assert.equal(l.fixtureMedia.rate,25)
assert.equal(l.vtBefore.itemId,'vt');assert.equal(l.vtBefore.mountedDuration,total)
assert.ok(l.simulation.schedule.conflicts.some(row=>row.kind==='OVERRUN'&&row.frames>0))
assert.ok(l.simulation.schedule.compensationReport.actions.some(row=>row.itemId==='vt'&&row.targetAnchorId==='live-main'&&row.originalDuration===total&&row.newDuration<total))
assert.equal(l.frozenRevision.items.length,2)
assert.equal(l.frozenRevision.items.find(row=>row.id==='vt').durationOverride,null)
assert.equal(l.frozenRevision.assets.find(row=>row.id==='vt-asset').contentHash,l.fixtureMedia.hash)
const media=resolve(l.fixtureMedia.file)
assert.ok(!relative(directory,media).startsWith('..')&&!isAbsolute(relative(directory,media)))
assert.equal(createHash('sha256').update(await readFile(media)).digest('hex'),l.fixtureMedia.hash)
assert.deepEqual(l.heartbeatFailures,[])
assert.equal(r.captures.length,3)
const labels=missing?['priority-vt-before','priority-no-signal-vt','priority-no-late-take-vt']:['priority-vt-before','priority-live','priority-vt-return']
const decoded=[]
for(const [index,label]of labels.entries()){
  const capture=r.captures.find(row=>row.label===label);assert.ok(capture)
  assert.equal(capture.bus,'pgm');assert.equal(capture.onAir.itemId,!missing&&index===1?'live-main':'vt')
  assert.equal(capture.picture.width,428);assert.equal(capture.picture.height,240)
  assert.equal(capture.picture.receiverSettlingFrames,75)
  assert.match(capture.picture.path,/\/mon$/);assert.equal(capture.audio.path,capture.picture.path)
  const gray=await readFile(join(directory,label+'-last.gray'));assert.equal(gray.length,428*240)
  const mean=gray.reduce((sum,value)=>sum+value,0)/gray.length
  const deviation=Math.sqrt(gray.reduce((sum,value)=>sum+(value-mean)**2,0)/gray.length)
  assert.equal(mean,capture.picture.mean);assert.equal(deviation,capture.picture.deviation);assert.ok(deviation>10)
  const pcm=await readFile(join(directory,label+'-audio.f32')),stats=stereoToneStatistics(pcm),spectrum=syntheticToneSpectrum(pcm),toneWindows=syntheticToneWindows(pcm,spectrum.frequencyHz)
  for(const key of ['frames','analyzedFrames','rate','rms','frequencyHz'])assert.deepEqual(stats[key],capture.audio[key])
  if(capture.audio.spectrum)assert.deepEqual(spectrum,capture.audio.spectrum)
  if(capture.audio.toneWindows)assert.deepEqual(toneWindows,capture.audio.toneWindows)
  const hz=!missing&&index===1?997:440;assert.equal(capture.audio.expectedHz,hz)
  for(let c=0;c<2;c++){assert.ok(stats.rms[c]>0.01&&stats.rms[c]<0.15);assert.ok(Math.abs(spectrum.frequencyHz[c]-hz)<15);assert.ok(toneWindows.concentratedWindows[c]>=4)}
  decoded.push({label,mean,spectrum,toneWindows})
}
assert.equal(l.asRunFinal.length,missing?1:3);assert.equal(r.asRun.count,l.asRunFinal.length)
for(const row of l.asRunFinal){assert.ok(row.endedAt);assert.equal(row.executionKind,'NATIVE');assert.equal(row.durationEvidence,'ENGINE_POSITION');assert.equal(row.revisionId,l.publicationId);if(row.itemId==='vt')assert.equal(row.mediaHash,l.fixtureMedia.hash)}
if(missing){
  assert.ok(l.noSignalObservedAt>l.scheduledAt)
  assert.ok(l.priorityDecisions.some(row=>row.kind==='LIVE_PRIORITY_FAILED'))
  assert.ok(!l.priorityDecisionsAfter.some(row=>row.kind==='LIVE_PRIORITY_CONFIRMED'))
  assert.ok(l.senderReturnedAt>l.noSignalObservedAt)
  for(const capture of r.captures){assert.equal(capture.onAir.startedAt,l.vtBefore.startedAt);assert.equal(capture.onAir.mountedDuration,total)}
  assert.ok(l.noSignalCapture.onAir.elapsed>l.anchor-l.vtBefore.startedAt)
  assert.equal(l.asRunNoSignal.length,1);assert.equal(l.asRunNoSignal[0].endedAt,null)
  assert.equal(l.asRunFinal[0].itemId,'vt');assert.equal(l.asRunFinal[0].endedBy,'STOP')
}else{
  assert.ok(Math.abs(decoded[1].mean-decoded[0].mean)>30)
  const cursor=l.interruption.frames
  assert.ok(cursor>0&&cursor<2250);assert.equal(l.interruption.revision_id,l.publicationId)
  assert.equal(l.liveSignal.nativeCatalogBindings.pgm,source.configuredId)
  assert.equal(l.liveSignal.busStates.pgm,'ON_PGM')
  const interrupted=l.asRunFinal.find(row=>row.itemId==='vt'&&row.endedBy==='LIVE_PRIORITY')
  assert.ok(interrupted);assert.equal(interrupted.endPositionFrames,cursor)
  const resumed=l.asRunFinal.find(row=>row.itemId==='vt'&&row.startPositionFrames===cursor)
  assert.ok(resumed);assert.equal(resumed.endedBy,'STOP')
  assert.equal(l.resume.run.phase,'CONFIRMED');assert.equal(l.resume.run.nativeProgramConfirmed,true)
  assert.equal(l.resume.run.physicalOutputValidated,false);assert.ok(l.resumeRequest.reviewToken)
  // Capture starts after the confirmed resume; playback may already have
  // advanced. The exact mount cursor is the native as-run start above.
  assert.ok(l.returnCapture.onAir.elapsed>=cursor&&l.returnCapture.onAir.elapsed<2250)
}
let seen=false,liveSeen=false,returned=false,ended=false
for(const row of r.snapshots){
  if(!row.onAir){if(seen){assert.equal(l.stopRequested,true);ended=true}continue}
  assert.equal(ended,false,'PGM cannot disappear and then restart inside the evidence sequence')
  seen=true;assert.equal(row.playing,true)
  if(missing){assert.equal(row.onAir.itemId,'vt');assert.equal(row.onAir.startedAt,l.vtBefore.startedAt)}
  else if(row.onAir.itemId==='live-main'){assert.ok(!returned);liveSeen=true}
  else{assert.equal(row.onAir.itemId,'vt');if(liveSeen)returned=true}
}
assert.equal(r.senders.length,missing?2:1)
for(const sender of r.senders){assert.equal(sender.exitCode,0);assert.equal(sender.forcedStop,false);assert.equal(sender.closed,true);assert.deepEqual(sender.errors,[])}
assert.equal(r.nativeStopped,true);assert.equal(r.serverExitObserved,true);assert.equal(r.carrierStopped,true)
const report={result:'PASS',kind:l.kind,scenario:missing?'NO_SIGNAL_AT_ANCHOR':'CUT_AND_REVIEWED_RESUME',cursor:l.interruption?.frames??null,hashes:r.hashes,evidenceSha256:createHash('sha256').update(bytes).digest('hex'),decoded,asRunRows:l.asRunFinal.length,cleanupConfirmed:true,limits:['Synthetic local network inputs and native/API operation, not browser or external hardware qualification','Source server/engine overlays on r71 runtime, not an installed release qualification','Fixture approved directly for this test: not ingest/QC workflow proof','No physical output, long-run soak or clean-Windows qualification']}
await writeFile(join(directory,'assertions-priority.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))
