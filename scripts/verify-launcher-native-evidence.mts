import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
import {stereoToneStatistics,syntheticToneSpectrum,syntheticToneWindows} from './lib/verify-published-audio.js'

assert.ok(process.argv.length===3||process.argv.length===4)
const directory=resolve(process.argv[2]!),report=JSON.parse(await readFile(join(directory,'result.json'),'utf8'))
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
assert.equal(report.result,'PASS')
const expectedServerHash=process.argv[3]??'e226c793e654679bfb33c4a737948b2c1ac53c8d5afc1285c4cf8f123a291c65'
assert.match(expectedServerHash,/^[a-f0-9]{64}$/)
assert.equal(report.hashes.server,expectedServerHash)
if(report.installedPackageCase){
  assert.equal(report.sharedGStreamer,null)
  assert.equal(report.packageGStreamer,join(report.root,'runtime/gstreamer'))
  const manifest=JSON.parse(await readFile(join(report.root,'package-manifest.json'),'utf8'))
  assert.notEqual(manifest.fixture,true)
  assert.equal(manifest.files.find((file:any)=>file.file==='apps/server/dist/server.cjs').sha256.toLowerCase(),expectedServerHash)
  assert.equal(JSON.parse(await readFile(join(report.root,'installation-receipt.json'),'utf8')).integrity,'VERIFIED')
  assert.equal(report.loadedModules.length,2)
  assert.deepEqual(report.loadedModules.map((row:any)=>row.kind).sort(),['GSTREAMER','SQLITE'])
  for(const row of report.loadedModules)assert.ok(row.FileName.toLowerCase().startsWith(report.root.toLowerCase()+'\\'))
  assert.equal(sha(await readFile(join(report.root,'apps/web/dist',report.interfaceAsset))),report.interfaceHash)
  if(report.exerciseAmbientOverrides!==false)for(const key of ['MTX_CONFKEY','RTSP_CONFKEY','MTX_MOQ','RTSP_APIADDRESS','MTX_RTPADDRESS','RTSP_WEBRTCLOCALUDPADDRESS','MTX_PATHS_QA_SOURCE'])assert.ok(report.ambientOverrideKeys.includes(key))
  if(report.upgradeBackup){
    assert.equal(report.upgradeBackup.phase,'READY')
    assert.equal(sha(await readFile(report.upgradeBackup.file)),report.upgradeBackup.sha256)
    assert.equal(report.afterBackup.itemId,report.before.itemId)
    assert.equal(report.afterBackup.startedAt,report.before.startedAt)
    assert.ok(report.afterBackup.elapsed>report.after.elapsed)
  }
}
assert.equal(report.hashes.launcher,'101a28c9e55c5a826b9805804f10853227d539b9a98cc4b018ddec81f9dc82b8')
assert.ok(['191cd1e112c7afba81896bbf3aa109a100775a7a358b7894faaafbe8d1abdfbc','610e03e8a61215e7ddb85570451178456337b8f2f9aa57ab07a057ae954cf7fa'].includes(report.hashes.engine))
assert.equal(sha(await readFile(join(report.root,'apps/engine/target/release/rplayout-engine.exe'))),report.hashes.engine)
assert.equal(sha(await readFile(join(report.root,'RPlayout-Server.exe'))),report.hashes.launcher)
assert.equal(sha(await readFile(join(report.root,'apps/server/dist/server.cjs'))),report.hashes.server)
assert.equal(report.lastCueState.onAir,null)
assert.deepEqual(report.lastCueState.preview,{kind:'ITEM',id:report.item})
assert.equal(report.lastCueState.previewFrame.itemId,report.item);assert.equal(report.lastCueState.previewFrame.delivered,true)
assert.equal(report.before.itemId,report.item);assert.equal(report.after.itemId,report.item)
assert.equal(report.before.startedAt,report.after.startedAt);assert.ok(report.after.elapsed>report.before.elapsed)
assert.equal(report.secondLauncherReused,true)
const pixels=await readFile(join(directory,'launcher-native-last.gray'))
assert.equal(pixels.length,320*180)
const mean=pixels.reduce((sum,value)=>sum+value,0)/pixels.length,deviation=Math.sqrt(pixels.reduce((sum,value)=>sum+(value-mean)**2,0)/pixels.length)
assert.ok(deviation>10);assert.ok(Math.abs(deviation-report.picture.deviation)<1e-8)
const pcm=await readFile(join(directory,'launcher-native-audio.f32')),statistics=stereoToneStatistics(pcm),spectrum=syntheticToneSpectrum(pcm),windows=syntheticToneWindows(pcm,spectrum.frequencyHz)
for(let channel=0;channel<2;channel++){
  assert.ok(statistics.rms[channel]!>0.01&&statistics.rms[channel]!<0.15)
  assert.ok(Math.abs(spectrum.frequencyHz[channel]!-997)<15);assert.ok(windows.concentratedWindows[channel]!>=4)
}
assert.equal(report.brokerConfig.moq,false);assert.equal(report.brokerBindings.length,9)
for(const binding of report.brokerBindings){assert.equal(binding.LocalAddress,'127.0.0.1');assert.ok((binding.protocol==='TCP'?[1935,8554,8888,8889,9997]:[8000,8001,8189,8890]).includes(binding.LocalPort))}
assert.ok(report.observedFamily.some((row:any)=>row.ExecutablePath.endsWith('rplayout-host-guard.exe')))
for(const row of report.observedFamily)assert.ok(report.ownedPids.includes(row.ProcessId))
assert.equal(report.ownedFamilyStopped,true);assert.equal(report.allLaunchersStopped,true)
assert.equal(report.priorProfileRestored,true)
assert.equal(sha(await readFile(join(directory,'prior-profile.json'))),sha(await readFile(join(report.root,'installation-profile.json'))))
const SQLite=createRequire(join(report.root,'apps/server/dist/server.cjs'))('better-sqlite3'),db=new SQLite(join(directory,'data/rplayout.db'),{readonly:true,fileMustExist:true})
let asRun:any,qc:any,jobs:any
try{
  assert.equal(db.pragma('integrity_check',{simple:true}),'ok')
  const asset=db.prepare('SELECT content_hash,path FROM media_assets WHERE id=?').get(report.assetId)
  assert.equal(asset.content_hash,report.mediaHash);assert.equal(sha(await readFile(asset.path)),report.mediaHash)
  qc=db.prepare('SELECT status FROM qc_decisions WHERE asset_id=? AND channel_id=? AND content_hash=? ORDER BY created_at DESC LIMIT 1').get(report.assetId,'qa',report.mediaHash)
  assert.equal(qc.status,'APPROVED')
  jobs=db.prepare('SELECT kind,state FROM media_jobs').all();assert.ok(jobs.some((row:any)=>row.kind==='PROXY'&&row.state==='READY'))
  asRun=db.prepare('SELECT item_id,revision_id,media_hash,execution_kind,ended_at FROM as_run').all()
  assert.equal(asRun.length,1);assert.equal(asRun[0].item_id,report.item);assert.equal(asRun[0].revision_id,report.publicationId);assert.equal(asRun[0].media_hash,report.mediaHash);assert.equal(asRun[0].execution_kind,'NATIVE')
}finally{db.close()}
const result={result:'PASS',scope:'Existing raw media and readonly persistence evidence; no replay or physical/remote/clean-Windows qualification',installedPackageCase:report.installedPackageCase===true,ambientOverridesExercised:report.installedPackageCase===true&&report.exerciseAmbientOverrides!==false,onlineUpgradeBackup:report.upgradeBackup?{requestId:report.upgradeBackup.requestId,sha256:report.upgradeBackup.sha256,pgmPreserved:true}:null,pixels:{width:320,height:180,mean,deviation},audio:{...statistics,spectrum,windows},asRun,qc,jobs,brokerListeners:9,observedFamily:report.observedFamily.length,ownedFamilyStopped:true,priorProfileRestored:true,fullInstallationValidated:false}
await writeFile(join(directory,'assertions-launcher-native.json'),JSON.stringify(result,null,2))
console.log(JSON.stringify(result,null,2))
