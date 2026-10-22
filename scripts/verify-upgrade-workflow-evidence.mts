import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
import {stereoToneStatistics,syntheticToneSpectrum,syntheticToneWindows} from './lib/verify-published-audio.js'

assert.equal(process.argv.length,3)
const directory=resolve(process.argv[2]!),report=JSON.parse(await readFile(join(directory,'result.json'),'utf8'))
// The first complete r83 execution reached captures/adoption, then its QA
// incorrectly required a single continuous as-run row. Preserve that FAIL;
// independently verify the real, pre-existing RESTART + resumed-segment
// contract without replaying activation or changing the business database.
const knownHarnessFailure=report.result==='FAIL'&&String(report.error).includes('Resume must not duplicate the original occurrence')&&report.captures?.length===2
assert.ok(report.result==='PASS'||knownHarnessFailure)
assert.equal(report.ownedFamilyStopped,true);assert.equal(report.qaProfileRestored,true)
if(report.stage){assert.equal(report.stage.takeRefused,true);assert.equal(report.stage.checkpointPreserved,true)}
else assert.ok(report.returnScenario,'Direct activation scope only for the separately recorded version-return scenario')
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
assert.equal(report.engineHash,'610e03e8a61215e7ddb85570451178456337b8f2f9aa57ab07a057ae954cf7fa')
assert.equal(hash(await readFile(join(report.install,'apps/engine/target/release/rplayout-engine.exe'))),report.engineHash)
assert.equal(hash(await readFile(report.sourceBackup.file)),report.sourceBackup.sha256)
assert.equal(hash(await readFile(join(report.install,'installation-profile.json'))),hash(await readFile(join(directory,'prior-profile.json'))))
const adopted=await readFile(join(directory,'adopted-profile.json'))
assert.equal(hash(adopted),hash(await readFile(join(report.prepared,'installation-profile.candidate.json'))))
const pixels=await readFile(join(directory,'upgrade-restored-last.gray'));assert.equal(pixels.length,320*180)
const mean=pixels.reduce((sum,value)=>sum+value,0)/pixels.length,deviation=Math.sqrt(pixels.reduce((sum,value)=>sum+(value-mean)**2,0)/pixels.length)
assert.ok(deviation>10);assert.ok(Math.abs(deviation-report.captures[0].deviation)<1e-8)
const pcm=await readFile(join(directory,'upgrade-restored-audio.f32')),statistics=stereoToneStatistics(pcm),spectrum=syntheticToneSpectrum(pcm),windows=syntheticToneWindows(pcm,spectrum.frequencyHz)
for(let channel=0;channel<2;channel++){assert.ok(statistics.rms[channel]!>0.01);assert.ok(Math.abs(spectrum.frequencyHz[channel]!-997)<15);assert.ok(windows.concentratedWindows[channel]!>=4)}
process.env.RPLAYOUT_VAULT_FILE=join(report.prepared,'vault.json');delete process.env.RPLAYOUT_VAULT_KEY
const {installationVault}=await import('../apps/server/src/domain/secret-vault.js')
const {verifyRestorationManifest}=await import('../apps/server/src/domain/restoration-manifest.js')
const {readRestoredActivations}=await import('../apps/server/src/db/restored-activations.js')
const {pendingUpgradeProfiles}=await import('../apps/server/src/domain/upgrade-profile-adoption.js')
const SQLite=createRequire(join(report.install,'apps/server/dist/server.cjs'))('better-sqlite3')
const db=new SQLite(join(report.prepared,'service.db'),{readonly:true,fileMustExist:true}),backup=new SQLite(report.sourceBackup.file,{readonly:true,fileMustExist:true})
let activation:any,checkpoint:any,asRun:any,adoption:any
try{
  assert.equal(db.pragma('integrity_check',{simple:true}),'ok')
  const receipt=await verifyRestorationManifest(db,join(report.prepared,'restore-quarantine.json'))
  activation=readRestoredActivations(db).at(-1);assert.equal(activation.phase,'CONFIRMED');assert.equal(activation.requestId,receipt.requestId);assert.deepEqual(activation.resumedChannels,['qa'])
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='ha_recovery_origin'").get().n,0)
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(activation.originTable))
  assert.equal(pendingUpgradeProfiles(db).size,0)
  const journal=db.prepare("SELECT kind,payload FROM operator_decisions WHERE kind LIKE 'UPGRADE_PROFILE_%' ORDER BY rowid").all().map((row:any)=>({kind:row.kind,value:JSON.parse(installationVault(false).decrypt(row.payload,'operator_decisions.payload'))}))
  assert.deepEqual(journal.map((row:any)=>row.kind),['UPGRADE_PROFILE_STARTED','UPGRADE_PROFILE_CONFIRMED'])
  adoption=journal[1].value
  assert.equal(adoption.activationId,activation.id);assert.equal(adoption.requestId,receipt.requestId)
  assert.equal(adoption.candidateHash,hash(adopted));assert.equal(adoption.previousHash,hash(await readFile(join(directory,'prior-profile.json'))))
  assert.ok(adoption.previousProfile.toLowerCase().startsWith(report.install.toLowerCase()+'\\installation-profile.previous-'))
  assert.equal(hash(await readFile(adoption.previousProfile)),adoption.previousHash)
  checkpoint=JSON.parse(db.prepare('SELECT payload FROM channel_checkpoints WHERE channel_id=?').get('qa').payload)
  const previous=JSON.parse(backup.prepare('SELECT payload FROM channel_checkpoints WHERE channel_id=?').get('qa').payload)
  for(const key of ['executionId','itemId','revisionId','rundownId'])assert.equal(checkpoint[key],previous[key])
  assert.ok(checkpoint.elapsed>=previous.elapsed);assert.equal(checkpoint.playing,true);assert.equal(checkpoint.realEngine,true)
  asRun=db.prepare('SELECT * FROM as_run ORDER BY rowid').all();const prior=backup.prepare('SELECT * FROM as_run ORDER BY rowid').all()
  assert.equal(asRun.length,prior.length+1)
  for(const [index,row]of asRun.slice(0,-1).entries()){
    for(const key of ['id','item_id','revision_id','media_hash','execution_kind','start_position_frames','started_at'])assert.equal(row[key],prior[index][key])
    assert.equal(row.ended_by,'RESTART');assert.ok(row.ended_at)
    assert.equal(row.end_position_frames,null);assert.equal(row.aired_frames,null);assert.equal(row.duration_evidence,'UNKNOWN')
  }
  const resumed=asRun.at(-1)!
  assert.equal(resumed.item_id,previous.itemId);assert.equal(resumed.revision_id,previous.revisionId)
  assert.equal(resumed.start_position_frames,previous.elapsed);assert.equal(resumed.execution_kind,'NATIVE');assert.equal(resumed.ended_at,null)
  assert.equal(asRun.filter((row:any)=>row.ended_at===null).length,1)
  if(report.returnScenario){
    assert.equal(report.inheritedBackupReconciliation.initialPhase,'UNCERTAIN');assert.equal(report.inheritedBackupReconciliation.finalPhase,'REFUSED');assert.equal(report.inheritedBackupReconciliation.explicitConfirmation,true)
    assert.equal(report.returnScenario.newEditorialDataViaApi,true);assert.equal(report.returnScenario.pgmPreservedDuringBackup,true)
    assert.notEqual(report.returnScenario.sourceServerHash,report.returnScenario.upgradedServerHash)
    for(const [root,expected]of [[report.returnScenario.sourceInstallation,report.returnScenario.sourceServerHash],[report.install,report.returnScenario.upgradedServerHash]])assert.equal(hash(await readFile(join(root,'apps/server/dist/server.cjs'))),expected)
    assert.equal(report.returnBackup.phase,'READY');assert.equal(hash(await readFile(report.returnBackup.file)),report.returnBackup.sha256)
    const online=new SQLite(report.returnBackup.file,{readonly:true,fileMustExist:true})
    try{
      assert.equal(online.pragma('journal_mode',{simple:true}),'delete');assert.equal(online.pragma('integrity_check',{simple:true}),'ok')
      assert.deepEqual(online.prepare('SELECT * FROM as_run ORDER BY rowid').all(),asRun)
      const created=report.postUpgradeRundown
      assert.equal(backup.prepare('SELECT COUNT(*) AS n FROM rundowns WHERE id=?').get(created.id).n,0)
      assert.deepEqual(online.prepare('SELECT * FROM rundowns WHERE id=?').get(created.id),created)
      assert.deepEqual(db.prepare('SELECT * FROM rundowns WHERE id=?').get(created.id),created)
      const saved=JSON.parse(online.prepare('SELECT payload FROM channel_checkpoints WHERE channel_id=?').get('qa').payload)
      assert.equal(saved.itemId,previous.itemId);assert.equal(saved.executionId,previous.executionId)
      assert.equal(saved.realEngine,true);assert.equal(saved.playing,true);assert.ok(saved.elapsed>previous.elapsed)
    }finally{online.close()}
  }
}finally{db.close();backup.close()}
const result={result:'PASS',sourceRunResult:report.result,correctedHarnessExpectation:knownHarnessFailure?'Existing RESTART predecessor + one resumed native segment, not a single continuous row':null,scope:'Independent readonly persistence and captured raw media; same-schema/account file restoration, not operational rollback or physical qualification',activation:{id:activation.id,phase:activation.phase,requestId:activation.requestId},adoption:{id:adoption.id,phase:adoption.phase,previousProfilePreserved:true},checkpoint,asRunRecords:asRun.length,onlyOneOpenSegment:true,pixels:{width:320,height:180,mean,deviation},audio:{...statistics,spectrum,windows},sourceBackupUntouched:true,qaProfileRestored:true,ownedFamilyStopped:true,latestOnlineBackup:report.returnScenario?{sha256:report.returnBackup.sha256,newEditorialDataPreserved:true,asRunPreserved:true,standalone:true}:null,rollbackValidated:false}
await writeFile(join(directory,'assertions-upgrade-workflow.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({result:'PASS',sourceRunResult:report.result,directory,activation:result.activation,adoption:result.adoption,onlyOneOpenSegment:true}))
