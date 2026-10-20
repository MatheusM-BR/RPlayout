import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {assertMovingPublishedGray} from './lib/held-picture-evidence.js'
import {stereoToneStatistics,syntheticToneSpectrum,syntheticToneWindows} from './lib/verify-published-audio.js'

// Existing captures and authenticated receipts only. Does not activate, replay
// TAKE, repair history or claim original-frame identity/physical qualification.
assert.equal(process.argv.length,3)
const directory=resolve(process.argv[2]!),qa=resolve('D:/RPlayout-builds/qa')
const withinQa=(file:string)=>assert.ok(resolve(file).toLowerCase().startsWith(qa.toLowerCase()+'\\'))
withinQa(directory)
const report=JSON.parse(await readFile(join(directory,'result.json'),'utf8'))
assert.equal(report.result,'PASS');assert.equal(report.directory,directory)
assert.equal(report.ownedFamilyStopped,true);assert.equal(report.qaProfileRestored,true)
assert.equal(report.physicalInputsValidated,false);assert.equal(report.pixelPerfectOriginalFrameValidated,false)
for(const path of [report.target,report.sourceRuntime,report.prepared,report.source.directory,report.source.backupEvidence.file])withinQa(path)
assert.equal(report.prepared,join(directory,'prepared'))
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
assert.equal(hash(await readFile(join(report.target,'package-manifest.json'))),report.targetManifestHash)
for(const [root,engine] of [[report.target,report.engineHash],[report.sourceRuntime,report.source.engineSha]]){
  const manifest=JSON.parse(await readFile(join(root,'package-manifest.json'),'utf8'))
  assert.equal(JSON.parse(await readFile(join(root,'installation-receipt.json'),'utf8')).integrity,'VERIFIED')
  assert.equal(manifest.files.find((entry:any)=>entry.file==='apps/engine/target/release/rplayout-engine.exe').sha256.toLowerCase(),engine)
  assert.equal(hash(await readFile(join(root,'apps/engine/target/release/rplayout-engine.exe'))),engine)
}
assert.equal(report.source.passed,true);assert.equal(report.source.sourceBackendPackaged,false)
assert.equal(report.source.installedRuntime,report.sourceRuntime);assert.equal(report.source.nextItem,'vt-next')
const source=JSON.parse(await readFile(join(report.source.directory,'result.json'),'utf8'))
assert.deepEqual(source,report.source)
assert.equal(hash(await readFile(source.backupEvidence.file)),report.sourceBackupHash)
const prior=await readFile(join(directory,'prior-profile.json')),adopted=await readFile(join(directory,'adopted-profile.json'))
assert.equal(hash(await readFile(join(report.target,'installation-profile.json'))),hash(prior))
assert.equal(hash(adopted),hash(await readFile(join(report.prepared,'installation-profile.candidate.json'))))
process.env.RPLAYOUT_VAULT_FILE=join(report.prepared,'vault.json');delete process.env.RPLAYOUT_VAULT_KEY;delete process.env.VITEST
const {installationVault}=await import('../apps/server/src/domain/secret-vault.js')
const {verifyRestorationManifest}=await import('../apps/server/src/domain/restoration-manifest.js')
const {readRestoredActivations}=await import('../apps/server/src/db/restored-activations.js')
const {pendingUpgradeProfiles}=await import('../apps/server/src/domain/upgrade-profile-adoption.js')
const {parseChannelCheckpoint}=await import('../apps/server/src/domain/checkpoints.js')
const SQLite=createRequire(join(report.target,'apps/server/dist/server.cjs'))('better-sqlite3')
const db=new SQLite(join(report.prepared,'service.db'),{readonly:true,fileMustExist:true}),backup=new SQLite(source.backupEvidence.file,{readonly:true,fileMustExist:true})
let activation:any,adoption:any,checkpoint:any,release:any
try{
  for(const file of [db,backup]){assert.equal(file.pragma('integrity_check',{simple:true}),'ok');assert.deepEqual(file.pragma('foreign_key_check'),[])}
  const receipt=await verifyRestorationManifest(db,join(report.prepared,'restore-quarantine.json'))
  assert.equal(receipt.backupSha256,report.sourceBackupHash)
  activation=readRestoredActivations(db).at(-1);assert.equal(activation.phase,'CONFIRMED')
  assert.equal(activation.requestId,receipt.requestId);assert.deepEqual(activation.resumedChannels,['held'])
  assert.equal(pendingUpgradeProfiles(db).size,0)
  const decisions=db.prepare("SELECT kind,payload FROM operator_decisions WHERE kind LIKE 'UPGRADE_PROFILE_%' OR kind LIKE 'RESTORED_OUTPUT_RELEASE_%' ORDER BY rowid").all().map((row:any)=>({kind:row.kind,value:JSON.parse(installationVault(false).decrypt(row.payload,'operator_decisions.payload'))}))
  const journal=decisions.filter((row:any)=>row.kind.startsWith('UPGRADE_PROFILE_'))
  assert.deepEqual(journal.map((row:any)=>row.kind),['UPGRADE_PROFILE_STARTED','UPGRADE_PROFILE_CONFIRMED'])
  adoption=journal.at(-1).value;assert.equal(adoption.activationId,activation.id);assert.equal(adoption.requestId,receipt.requestId)
  assert.equal(adoption.candidateHash,hash(adopted));assert.equal(adoption.previousHash,hash(prior))
  assert.ok(resolve(adoption.previousProfile).toLowerCase().startsWith(resolve(report.target).toLowerCase()+'\\installation-profile.previous-'))
  assert.equal(hash(await readFile(adoption.previousProfile)),hash(prior))
  const program=decisions.filter((row:any)=>row.value.activationId===activation.id&&row.value.bus==='PROGRAM')
  assert.deepEqual(program.map((row:any)=>row.kind),['RESTORED_OUTPUT_RELEASE_ATTEMPTED','RESTORED_OUTPUT_RELEASE_CONFIRMED'])
  release=program[1].value;assert.equal(release.paused,true);assert.equal(release.channelId,'held')
  assert.equal(release.proof.paused,true);assert.equal(release.proof.itemId,'vt')
  const saved=parseChannelCheckpoint(JSON.parse(backup.prepare("SELECT payload FROM channel_checkpoints WHERE channel_id='held'").get().payload),'held')
  assert.deepEqual(saved,source.saved)
  const held=parseChannelCheckpoint(report.heldCheckpoint,'held')
  assert.equal(held.playing,false);assert.equal(held.realEngine,true);assert.equal(held.programHold?.status,'HELD')
  assert.equal(release.proof.elapsed,saved.elapsed);assert.equal(release.proof.decoderId,held.programHold!.decoderId)
  assert.deepEqual(release.proof.programTrim,saved.programTrim)
  for(const key of ['executionId','revisionId','itemId','rundownId','elapsed'] as const)assert.equal(held[key],saved[key])
  assert.deepEqual(held.programTrim,saved.programTrim)
  checkpoint=parseChannelCheckpoint(JSON.parse(db.prepare("SELECT payload FROM channel_checkpoints WHERE channel_id='held'").get().payload),'held')
  assert.equal(checkpoint.itemId,'vt-next');assert.equal(checkpoint.playing,true);assert.equal(checkpoint.realEngine,true);assert.equal(checkpoint.programHold,undefined)
  assert.equal(checkpoint.executionId,saved.executionId);assert.equal(checkpoint.revisionId,saved.revisionId)
  const rows=db.prepare('SELECT * FROM as_run ORDER BY rowid').all(),original=backup.prepare('SELECT * FROM as_run ORDER BY rowid').all()
  assert.equal(original.length,1);assert.deepEqual(rows,report.asRun);assert.equal(rows.length,3)
  for(const key of ['id','item_id','revision_id','media_hash','execution_kind','start_position_frames','started_at'])assert.equal(rows[0][key],original[0][key])
  assert.equal(rows[0].ended_by,'RESTART');assert.equal(rows[0].duration_evidence,'UNKNOWN')
  assert.equal(rows[0].end_position_frames,null);assert.equal(rows[0].aired_frames,null)
  assert.equal(rows[1].start_position_frames,saved.elapsed);assert.equal(rows[1].end_position_frames,saved.elapsed)
  assert.equal(rows[1].ended_by,'TAKE');assert.ok(rows[1].ended_at);assert.equal(rows[1].item_id,'vt')
  assert.equal(rows[2].item_id,'vt-next');assert.equal(rows[2].start_position_frames,0);assert.equal(rows[2].execution_kind,'NATIVE')
  assert.equal(rows[2].ended_at,null);assert.equal(rows.filter((row:any)=>row.ended_at===null).length,1)
}finally{db.close();backup.close()}
for(const name of ['held','cue']){
  const view=JSON.parse(await readFile(join(directory,name+'-view.json'),'utf8'))
  assert.equal(view.live.transport.mode,'NATIVE');assert.equal(view.live.transport.playing,false)
  assert.equal(view.live.transport.onAir.itemId,'vt');assert.equal(view.live.transport.onAir.elapsed,source.saved.elapsed)
  if(name==='cue'){assert.equal(view.live.transport.previewFrame.itemId,'vt-next');assert.equal(view.live.transport.previewFrame.delivered,true)}
}
const taken=JSON.parse(await readFile(join(directory,'take-view.json'),'utf8'))
assert.equal(taken.live.transport.playing,true);assert.equal(taken.live.transport.onAir.itemId,'vt-next')
const pictures=await Promise.all(['held-first','held-second'].map(label=>readFile(join(directory,label+'-last.gray'))))
for(const pixels of pictures){assert.equal(pixels.length,320*180);const mean=pixels.reduce((sum,value)=>sum+value,0)/pixels.length;assert.ok(Math.sqrt(pixels.reduce((sum,value)=>sum+(value-mean)**2,0)/pixels.length)>10)}
const meanDifference=pictures[0]!.reduce((sum,value,index)=>sum+Math.abs(value-pictures[1]![index]!),0)/pictures[0]!.length
assert.ok(meanDifference<1);assert.equal(meanDifference,report.heldEvidence.meanDifference)
const silence=stereoToneStatistics(await readFile(join(directory,'held-silence.f32')))
assert.ok(silence.rms.every(value=>value<0.0001));assert.deepEqual(silence,report.heldEvidence.silent)
const motion=assertMovingPublishedGray(await readFile(join(directory,'held-take-motion.gray')),320,180)
assert.deepEqual(motion,report.afterTake.motion)
const pcm=await readFile(join(directory,'held-take-audio.f32')),audio=stereoToneStatistics(pcm),spectrum=syntheticToneSpectrum(pcm),windows=syntheticToneWindows(pcm,spectrum.frequencyHz)
for(let channel=0;channel<2;channel++){assert.ok(audio.rms[channel]!>0.01&&audio.rms[channel]!<0.15);assert.ok(Math.abs(spectrum.frequencyHz[channel]!-997)<15);assert.ok(windows.concentratedWindows[channel]!>=4)}
const result={result:'PASS',scope:report.scope,activationId:activation.id,adoptionId:adoption.id,release,checkpoint,heldMeanDifference:meanDifference,silence,motion,audio:{...audio,spectrum,windows},sourceBackendPackaged:false,sourceBackupUntouched:true,onlyOneOpenSegment:true,ownedFamilyStopped:true,qaProfileRestored:true,pixelPerfectOriginalFrameValidated:false,physicalInputsValidated:false}
const quoted=(value:string)=>"'"+value.replaceAll("'","''")+"'"
const inventory=await promisify(execFile)(join(process.env.SystemRoot!,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-Command',`$ErrorActionPreference='Stop'; ConvertTo-Json -InputObject @(Get-CimInstance Win32_Process | Where-Object {$_.ProcessId -ne ${process.pid} -and $_.ExecutablePath -and $_.ExecutablePath.StartsWith(${quoted(report.target+'\\')},[StringComparison]::OrdinalIgnoreCase)} | Select-Object ProcessId,ExecutablePath) -Compress`],{windowsHide:true,timeout:15000,maxBuffer:32768})
assert.deepEqual(JSON.parse(inventory.stdout),[],'Target QA family must still be stopped; never terminate historical PIDs')
await writeFile(join(directory,'assertions-installed-held.json'),JSON.stringify(result,null,2))
console.log(JSON.stringify({result:'PASS',directory,activationId:activation.id,onlyOneOpenSegment:true}))
