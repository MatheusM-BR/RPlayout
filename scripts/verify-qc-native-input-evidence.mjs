import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
const directory=resolve(process.argv[2]??'')
const read=async name=>JSON.parse(await readFile(join(directory,name),'utf8'))
const result=await read('result.json'),browser=await read('browser-observations.json')
assert.equal(result.result,'FIXTURE_FINISHED');assert.equal(result.error,null);assert.equal(result.expired,false)
assert.equal(result.asRun.count,0);assert.equal(result.items.count,0)
assert.equal(result.sources.length,2);assert.equal(result.captures.length,2)
for(const kind of ['NDI','OMT']){
  const source=result.selectedSources.find(row=>row.kind===kind);assert.ok(source)
  assert.ok(result.discovery[kind.toLowerCase()].sources.some(row=>row.discovery==='DISCOVERED'&&row.reference===source.reference&&row.label===source.label))
  const capture=result.captures.find(row=>row.label===kind.toLowerCase()+'-direct');assert.ok(capture)
  assert.equal(capture.preview.kind,'SOURCE');assert.equal(capture.preview.source,source.reference)
  assert.equal(capture.picture.width,428);assert.equal(capture.picture.height,240);assert.ok(capture.picture.deviation>10)
}
const hang=result.events.filter(row=>row.fault==='HANG'&&row.kind==='catalog');assert.ok(hang.length>0)
for(const row of hang){assert.equal(row.finished,false);assert.ok(row.durationMs>=9500&&row.durationMs<12000)}
for(const [key,max]of Object.entries(result.maximum))if(/:(catalog|telemetry)$/.test(key))assert.equal(max,1,key)
assert.ok(result.events.some(row=>row.phase==='telemetry-failure'&&row.kind==='telemetry'&&row.status===503))
const step=name=>{const row=browser.observations.find(row=>row.step===name);assert.ok(row,name);return row}
for(const name of ['NDI direct QC','Telemetry failure retains selected NDI','Catalog timeout retains selected NDI but blocks new selection','Catalog recovered without player restart','OMT direct QC after source switch','Corrected OMT returned to light preview']){
  const row=step(name);assert.deepEqual(row.raster,[428,240]);assert.equal(row.readyState,4);assert.ok(row.time>0)
}
assert.equal(step('Telemetry failure retains selected NDI').allSourcesEnabled,true)
assert.equal(step('Catalog timeout retains selected NDI but blocks new selection').allSourcesDisabled,true)
assert.equal(step('Catalog recovered without player restart').allSourcesEnabled,true)
assert.ok(step('Catalog recovered without player restart').time>step('Catalog timeout retains selected NDI but blocks new selection').time)
assert.equal(step('OMT quality before JPEG guard correction').scopeFailureObserved,true)
const fixed=step('OMT quality corrected');assert.deepEqual(fixed.raster,[640,360]);assert.equal(fixed.sampled,1);assert.equal(fixed.readyState,4)
assert.ok(step('Corrected web loaded').scripts.includes(browser.correctedWebAsset))
assert.equal(step('Corrected OMT returned to light preview').sampled,1)
assert.equal(browser.brokerQualityBeforeOff.ready,true);assert.deepEqual(browser.brokerQualityBeforeOff.tracks,['H264','Opus'])
assert.equal(browser.brokerQualityAfterOff.ready,false);assert.equal(browser.brokerQualityAfterOff.readers,0)
assert.equal(result.nativeStopped,true);assert.equal(result.serverExitObserved,true);assert.equal(result.carrierStopped,true);assert.equal(browser.tabClosed,true)
for(const sender of result.senders){assert.equal(sender.exitCode,0);assert.equal(sender.forcedStop,false)}
const senderDiagnostics=result.senders.flatMap(sender=>sender.errors.map(error=>({kind:sender.kind,error})))
const evidenceHashes={}
for(const file of ['result.json','browser-observations.json',...browser.screenshots])evidenceHashes[file]=createHash('sha256').update(await readFile(join(directory,file))).digest('hex')
const report={result:senderDiagnostics.length?'PARTIAL_PASS_WITH_UNCLASSIFIED_FINAL_SENDER_DIAGNOSTIC':'PASS',scope:'Native local QC picture and independent read failure recovery; quality scopes corrected',directory,initialWebSha:result.hashes.web,correctedWebSha:browser.correctedWebSha,hashes:result.hashes,sourceWebOverride:true,devicesOverride:true,hangDurationsMs:hang.map(row=>row.durationMs),readConcurrency:1,captures:result.captures.map(row=>({label:row.label,...row.picture})),asRun:0,items:0,ownedCleanupConfirmed:true,senderDiagnostics,evidenceHashes,limits:browser.limits}
await writeFile(join(directory,'assertions-qc-native.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
