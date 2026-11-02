import assert from 'node:assert/strict'
import {readFile,writeFile,realpath} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'

// Read-only verification of the actual installer/startup and a completed
// installed API/native lifecycle run. No UI, mutations or process restarts.
const workspace=resolve(import.meta.dirname,'..'),directory=resolve(process.argv[2]??'')
assert.ok(process.argv[2])
const load=async path=>JSON.parse(await readFile(path,'utf8'))
const installFile=join(workspace,'scratch/r71-install-evidence-20261015/result.json')
const startupFile=join(workspace,'scratch/RPlayout-portable-server-WRguxl/result.json')
const result=await load(join(directory,'result.json')),install=await load(installFile),startup=await load(startupFile)
assert.equal(install.result,'PASS');assert.equal(install.receiptIntegrity,'VERIFIED')
assert.equal(install.previousInstallationModified,false);assert.equal(install.serverStarted,false)
assert.equal(install.shortcutTargetsVerified.length,7);assert.equal(install.cleanWindowsValidated,false)
assert.equal(startup.result,'PASS');assert.equal(startup.compiledServerOverride,false)
assert.equal(startup.sqliteResolvedWithinPackage,true);assert.equal(startup.minimalPathWithoutPowerShell,true)
assert.equal(startup.childNodeOptionsRemoved,true);assert.equal(startup.childNodePathRemoved,true)
assert.equal(startup.serverExitObserved,true);assert.ok(startup.startupElapsedMs<30000)
assert.equal(await realpath(result.package),await realpath(install.destination));assert.equal(await realpath(result.package),await realpath(startup.package))
assert.equal(result.result,'FIXTURE_FINISHED');assert.equal(result.error,null);assert.equal(result.expired,false)
assert.equal(result.sourceWebOverride,false);assert.equal(result.devicesOverride,false)
assert.equal(result.hashes.server,startup.serverSha256);assert.equal(result.hashes.web,startup.interfaceSha256)
assert.equal(result.lifecycle.mode,'INSTALLED_NATIVE_LIFECYCLE');assert.equal(result.lifecycle.result,'PASS')
assert.equal(result.lifecycle.servedWebSha,result.hashes.web)
assert.equal(result.asRun.count,0);assert.equal(result.items.count,0)
assert.ok(result.snapshots.length>0)
for(const snapshot of result.snapshots){assert.equal(snapshot.onAir,null);assert.equal(snapshot.playing,false)}
assert.equal(result.captures.length,2)
for(const kind of ['NDI','OMT']){
  const source=result.selectedSources.find(row=>row.kind===kind);assert.ok(source)
  assert.ok(result.discovery[kind.toLowerCase()].sources.some(row=>row.discovery==='DISCOVERED'&&row.reference===source.reference))
  const capture=result.captures.find(row=>row.label===kind.toLowerCase()+'-lifecycle');assert.ok(capture)
  assert.equal(capture.preview.kind,'SOURCE');assert.equal(capture.preview.source,source.reference)
  assert.equal(capture.picture.width,428);assert.equal(capture.picture.height,240);assert.ok(capture.picture.deviation>10)
}
const baseline=result.senders.filter(sender=>sender.purpose==='BASELINE'),probe=result.senders.filter(sender=>sender.purpose==='UPSTREAM_LOSS')
assert.equal(baseline.length,2);assert.equal(probe.length,1);assert.equal(probe[0].kind,'OMT')
for(const sender of baseline){assert.deepEqual(sender.errors,[]);assert.deepEqual(sender.notifications.filter(event=>event.event==='sourceLost'&&event.phase==='RUNNING'),[])}
assert.equal(result.lifecycle.beforeOrderedShutdown.length,2)
for(const row of result.lifecycle.beforeOrderedShutdown){assert.equal(row.signal.videoPresent,true);assert.equal(row.signal.audioPresent,true);assert.deepEqual(row.errors,[])}
assert.equal(result.lifecycle.orderedShutdown.upstreamStillReady,true)
assert.ok(result.lifecycle.orderedShutdown.finishedAt>=result.lifecycle.orderedShutdownStartedAt)
assert.ok(result.lifecycle.injectedLossAt>result.lifecycle.orderedShutdown.finishedAt)
const before=result.lifecycle.beforeInjectedLoss;assert.equal(before.signal.videoPresent,true);assert.equal(before.signal.audioPresent,true);assert.equal(before.onAir,'carrier')
assert.ok(before.at<=result.lifecycle.injectedLossAt)
const expected=result.lifecycle.lossProbe.errors;assert.ok(expected.length>0)
for(const error of expected){assert.equal(error.phase,'EXPECTED_UPSTREAM_LOSS');assert.ok(error.at>=result.lifecycle.injectedLossAt)}
assert.ok(expected.some(error=>/decoder da entrada recusou o sinal/.test(error.message)))
assert.equal(result.lifecycle.lossProbe.onAir,'carrier')
assert.equal(result.nativeStopped,true);assert.equal(result.serverExitObserved,true);assert.equal(result.carrierStopped,true)
for(const sender of result.senders){assert.equal(sender.exitCode,0);assert.equal(sender.forcedStop,false);assert.equal(sender.closed,true)}
const evidenceHashes={}
for(const path of [installFile,startupFile,join(directory,'result.json')])evidenceHashes[path]=createHash('sha256').update(await readFile(path)).digest('hex')
const report={result:'PASS',scope:'R71 actual install/startup + installed API/native NDI/OMT QC and bounded shutdown/loss diagnostic',directory,package:result.package,archiveSha256:install.archiveSha256,hashes:result.hashes,startupElapsedMs:startup.startupElapsedMs,sourceWebOverride:false,devicesOverride:false,browserValidated:false,baselineSenders:2,baselineErrors:0,baselineSourceLossObserved:0,orderedShutdownUpstreamPreserved:true,upstreamLossInjectedAt:result.lifecycle.injectedLossAt,expectedDiagnostics:expected,pgmStopped:true,asRun:0,items:0,cleanupConfirmed:true,evidenceHashes,limits:['Does not timestamp or retroactively classify the historical ABuYjy error','API/native loopback synthetic sources, not a new browser replay or external-vendor/hardware qualification','Finite scenario, not long-run stability, PCM/color fidelity or remote-network qualification','Host has preinstalled system components; not clean Windows','Original r71 ZIP unchanged; no upgrade/rollback or redistributable-license clearance']}
await writeFile(join(directory,'assertions-r71-lifecycle.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
