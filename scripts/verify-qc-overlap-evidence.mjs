import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
import {stereoToneStatistics,syntheticToneSpectrum,syntheticToneWindows} from './lib/verify-published-audio.ts'
assert.ok(process.argv[2],'Pass completed QC overlap evidence')
const directory=resolve(process.argv[2]),raw=await readFile(join(directory,'result.json')),r=JSON.parse(raw),l=r.lifecycle
const browser=l.mode==='COMPILED_NATIVE_QC_BROWSER',ui=browser?JSON.parse(await readFile(join(directory,'browser-observations.json'),'utf8')):null
assert.equal(r.result,'FIXTURE_FINISHED');assert.equal(r.error,null);assert.equal(r.expired,false)
assert.ok(browser||l.mode==='COMPILED_NATIVE_QC_AUDIO_OVERLAP');if(!browser)assert.equal(l.result,'PASS')
assert.equal(l.sourceEngineOverride,true);assert.equal(l.sourceServerOverride,true)
assert.equal(r.sourceWebOverride,false);assert.equal(r.devicesOverride,false)
assert.equal(r.hashes.engine,'191cd1e112c7afba81896bbf3aa109a100775a7a358b7894faaafbe8d1abdfbc')
assert.equal(r.hashes.server,'a709115f976cc6372f1ffe13d1b9195261ffc217c0ebe2707990477056e0473a')
assert.equal(r.hashes.web,'cd7665dea5b70b1b9cba4d9fb9af667085869e22f67c868b3105eaced818c173')
assert.equal(r.items.count,0);assert.equal(r.asRun.count,0);assert.equal(r.captures.length,browser?3:6)
if(!browser)assert.deepEqual(l.heartbeatFailures,[])
const captures=[]
for(const kind of browser?['OMT']:['NDI','OMT']){
  const source=r.selectedSources.find(row=>row.kind===kind)
  const highState=browser?JSON.parse(await readFile(join(directory,'omt-quality-state.json'),'utf8')):null,lowState=browser?JSON.parse(await readFile(join(directory,'omt-return-state.json'),'utf8')):null
  const run=browser?{source,decoderBefore:highState.previewFrame,decoderAfter:lowState.previewFrame,overlapPaths:highState.paths,inspectionAfter:lowState.paths.inspection}:l.sources.find(row=>row.source.kind===kind)
  assert.ok(source&&run);assert.ok(source.reference.startsWith(kind.toLowerCase()+':'))
  assert.ok(r.discovery[kind.toLowerCase()].sources.some(row=>row.discovery==='DISCOVERED'&&row.reference===source.reference))
  assert.equal(run.decoderBefore.decoderId,run.decoderAfter.decoderId);assert.equal(run.decoderBefore.itemId,run.decoderAfter.itemId)
  assert.equal(run.decoderBefore.delivered,true);assert.equal(run.decoderAfter.delivered,true)
  for(const bus of ['preview','inspection']){assert.equal(run.overlapPaths[bus].ready,true);assert.deepEqual(run.overlapPaths[bus].tracks,['H264','Opus'])}
  assert.equal(run.inspectionAfter.ready,false);assert.equal(Array.isArray(run.inspectionAfter.readers)?run.inspectionAfter.readers.length:run.inspectionAfter.readers,0)
  for(const suffix of browser?['corrected-direct','corrected-quality','corrected-return']:['baseline','overlap-preview','overlap-quality']){
    const label=kind.toLowerCase()+'-'+suffix,capture=r.captures.find(row=>row.label===label);assert.ok(capture)
    assert.equal(capture.preview.kind,'SOURCE');assert.equal(capture.preview.source,source.reference)
    if(!browser)assert.equal(capture.decoder.decoderId,run.decoderBefore.decoderId)
    else assert.equal(capture.signal.busItemIds.pvw,run.decoderBefore.itemId)
    const high=suffix.endsWith('quality'),width=high?640:428,height=high?360:240
    assert.equal(capture.picture.width,width);assert.equal(capture.picture.height,height)
    assert.equal(capture.picture.path,'qa-native-qc/'+(high?'qc':'pvw'));assert.equal(capture.audio.path,capture.picture.path)
    const gray=await readFile(join(directory,label+'-last.gray'));assert.equal(gray.length,width*height)
    const mean=gray.reduce((sum,v)=>sum+v,0)/gray.length,deviation=Math.sqrt(gray.reduce((sum,v)=>sum+(v-mean)**2,0)/gray.length)
    assert.equal(mean,capture.picture.mean);assert.equal(deviation,capture.picture.deviation);assert.ok(deviation>10)
    const pcm=await readFile(join(directory,label+'-audio.f32')),statistics=stereoToneStatistics(pcm),spectrum=syntheticToneSpectrum(pcm),windows=syntheticToneWindows(pcm,spectrum.frequencyHz)
    for(const key of ['frames','analyzedFrames','rate','rms','frequencyHz'])assert.deepEqual(statistics[key],capture.audio[key])
    assert.deepEqual(spectrum,capture.audio.spectrum);assert.deepEqual(windows,capture.audio.toneWindows)
    for(let c=0;c<2;c++){assert.ok(statistics.rms[c]>0.01&&statistics.rms[c]<0.15);assert.ok(Math.abs(spectrum.frequencyHz[c]-997)<15);assert.ok(windows.concentratedWindows[c]>=4)}
    captures.push({label,width,height,decoderId:run.decoderBefore.decoderId,rms:statistics.rms,frequencyHz:spectrum.frequencyHz})
  }
}
assert.ok(r.snapshots.length>0)
for(const row of r.snapshots){assert.equal(row.onAir,null);assert.equal(row.playing,false)}
assert.equal(r.nativeStopped,true);assert.equal(r.carrierStopped,true);assert.equal(r.serverExitObserved,true)
for(const sender of r.senders){assert.equal(sender.exitCode,0);assert.equal(sender.forcedStop,false);assert.equal(sender.closed,true);assert.deepEqual(sender.errors,[])}
const browserEvidenceHashes={}
if(browser){
  assert.equal(ui.tabClosed,true)
  for(const [step,width,height,pressed]of [['OMT corrected direct',428,240,'false'],['OMT corrected quality',640,360,'true'],['OMT corrected returned',428,240,'false']]){
    const row=ui.observations.find(value=>value.step===step);assert.ok(row);assert.equal(row.raster.length,1)
    assert.equal(row.raster[0].width,width);assert.equal(row.raster[0].height,height);assert.equal(row.raster[0].readyState,4);assert.equal(row.raster[0].paused,false);assert.ok(row.raster[0].time>0)
    assert.equal(row.qualityPressed,pressed);assert.equal(row.safePressed,'false');assert.equal(row.safe,null);assert.equal(row.sampled,true);assert.equal(row.pgmStopped,true);assert.ok(row.scripts.includes('/assets/index-DG6oIPgn.js'))
  }
  for(const name of ['browser-observations.json',...ui.screenshots]){const bytes=await readFile(join(directory,name));assert.ok(bytes.length>100);browserEvidenceHashes[name]=createHash('sha256').update(bytes).digest('hex')}
}
const report={result:'PASS',mode:l.mode,hashes:r.hashes,evidenceSha256:createHash('sha256').update(raw).digest('hex'),captures,asRun:0,items:0,browserEvidenceHashes,sourceOpeningPreserved:true,qualityPublisherReleased:true,ownedCleanupConfirmed:true,limits:[browser?'Local browser OMT quality/return with native captures; not full NDI browser replay after correction':'Compiled native/API overlap on synthetic local NDI/OMT, not browser proof','Server/engine overlays on r71 runtimes, not installed r76 qualification','Finite synthetic tone presence, not audio fidelity/loudness/long-run continuity certification','No external devices, remote station or playing PGM test']}
await writeFile(join(directory,browser?'assertions-qc-browser.json':'assertions-qc-overlap.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({result:report.result,captures:captures.length,asRun:0,ownedCleanupConfirmed:true}))
