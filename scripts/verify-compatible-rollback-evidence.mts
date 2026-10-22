import assert from 'node:assert/strict'
import {readFile,writeFile,access} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
import {stereoToneStatistics,syntheticToneSpectrum,syntheticToneWindows} from './lib/verify-published-audio.js'

// Read persisted receipts and existing captures only. Never repeat activation,
// repair a diary, alter a business database or change a source journal mode.
assert.equal(process.argv.length,3)
const directory=resolve(process.argv[2]!),report=JSON.parse(await readFile(join(directory,'result.json'),'utf8'))
assert.equal(report.result,'PASS');assert.equal(report.ownedFamilyStopped,true);assert.equal(report.targetQaProfileRestored,true)
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
if(report.versionReturn){
  assert.equal(report.newerEditionPgmThenRollbackValidated,true)
  const forward=JSON.parse(await readFile(join(report.sourceEvidence,'result.json'),'utf8'))
  assert.equal(forward.result,'PASS');assert.equal(forward.ownedFamilyStopped,true);assert.equal(forward.qaProfileRestored,true)
  assert.deepEqual(forward.returnBackup,report.versionReturn.latestApiBackup)
  assert.deepEqual(forward.postUpgradeRundown,report.versionReturn.postUpgradeRundown)
  assert.equal(hash(await readFile(forward.returnBackup.file)),forward.returnBackup.sha256)
  assert.equal(report.versionReturn.targetEdition,report.versionReturn.sourceEdition)
  const revision=(edition:string)=>Number(/-r(\d+)$/.exec(edition)?.[1])
  assert.ok(revision(report.versionReturn.upgradedEdition)>revision(report.versionReturn.targetEdition))
  for(const [root,expected]of [[report.target,report.versionReturn.sourceServerHash],[report.current,report.versionReturn.upgradedServerHash]])assert.equal(hash(await readFile(join(root,'apps/server/dist/server.cjs'))),expected)
}
assert.equal(hash(await readFile(report.latest)),report.latestHash)
assert.equal(hash(await readFile(report.originalBaseline)),report.originalBaselineHash)
const prior=await readFile(join(directory,'prior-target-profile.json')),adopted=await readFile(join(directory,'adopted-target-profile.json'))
assert.equal(hash(await readFile(join(report.target,'installation-profile.json'))),hash(prior))
assert.equal(hash(adopted),hash(await readFile(join(report.prepared,'installation-profile.candidate.json'))))
process.env.RPLAYOUT_VAULT_FILE=join(report.prepared,'vault.json');delete process.env.RPLAYOUT_VAULT_KEY
const {installationVault}=await import('../apps/server/src/domain/secret-vault.js')
const {verifyRestorationManifest}=await import('../apps/server/src/domain/restoration-manifest.js')
const {readRestoredActivations}=await import('../apps/server/src/db/restored-activations.js')
const {pendingUpgradeProfiles}=await import('../apps/server/src/domain/upgrade-profile-adoption.js')
const {assertRollbackSchema}=await import('../apps/server/src/domain/rollback-contract.js')
const {assertLosslessRollbackHistory}=await import('../apps/server/src/domain/rollback-history.js')
const vault=installationVault(false),envelope=JSON.parse(await readFile(join(report.prepared,'rollback-preparation.json'),'utf8'))
const preparation=JSON.parse(vault.decrypt(envelope.protectedReport,'compatible-rollback:v1:report'))
assert.equal(preparation.purpose,'COMPATIBLE_ROLLBACK_LATEST_SNAPSHOT')
assert.equal(preparation.historyPolicy,'LATEST_COMPLETE_SNAPSHOT_NO_MERGE')
assert.equal(hash(await readFile(join(report.target,'package-manifest.json'))),preparation.targetManifestSha256)
assert.equal(preparation.profileSha256,hash(adopted))
assert.equal(preparation.restorationManifestSha256,hash(await readFile(join(report.prepared,'restore-quarantine.json'))))
assert.equal(preparation.rollbackReady,false);assert.equal(preparation.automaticTake,false)
const SQLite=createRequire(join(report.current,'apps/server/dist/server.cjs'))('better-sqlite3')
for(const snapshot of [preparation.current,preparation.baseline]){
  assert.notEqual(snapshot.file,report.latest);assert.notEqual(snapshot.file,report.originalBaseline)
  assert.equal(hash(await readFile(snapshot.file)),snapshot.sha256)
  const db=new SQLite(snapshot.file,{readonly:true,fileMustExist:true})
  try{assert.equal(db.pragma('journal_mode',{simple:true}),'delete');assert.equal(db.pragma('integrity_check',{simple:true}),'ok')}finally{db.close()}
  for(const suffix of ['-wal','-shm'])await assert.rejects(access(snapshot.file+suffix),(error:any)=>error.code==='ENOENT')
}
const db=new SQLite(join(report.prepared,'service.db'),{readonly:true,fileMustExist:true}),current=new SQLite(preparation.current.file,{readonly:true,fileMustExist:true}),baseline=new SQLite(preparation.baseline.file,{readonly:true,fileMustExist:true})
let activation:any,adoption:any,checkpoint:any,rows:any[],history:any
try{
  assert.equal(db.pragma('integrity_check',{simple:true}),'ok')
  assertRollbackSchema(db.prepare('SELECT version,name FROM schema_migrations ORDER BY version').all(),preparation.contract)
  const receipt=await verifyRestorationManifest(db,join(report.prepared,'restore-quarantine.json'))
  assert.equal(receipt.requestId,preparation.requestId);assert.equal(receipt.backupSha256,preparation.current.sha256)
  if(report.inheritedReservationRecovery){
    const recovery=report.inheritedReservationRecovery
    assert.equal(recovery.stage,'RESERVATION_RELEASED_NOT_ACTIVATED');assert.equal(recovery.requestId,receipt.requestId);assert.equal(recovery.activationPerformed,false)
    const {storageAdmissionSignature}=await import('../apps/server/src/db/storage-admission.js')
    const recovered=db.prepare("SELECT payload FROM operator_decisions WHERE kind='RESTORED_RESERVATION_RECOVERED' ORDER BY rowid").all().map((row:any)=>JSON.parse(vault.decrypt(row.payload,'operator_decisions.payload'))).filter((row:any)=>row.requestId===receipt.requestId)
    assert.equal(recovered.length,1);assert.equal(recovered[0].previousAdmission.phase,'MAINTENANCE')
    assert.equal(recovered[0].previousSignature,storageAdmissionSignature(recovered[0].previousAdmission))
    assert.equal(recovered[0].executionStarted,false);assert.equal(recovered[0].automaticPromotion,false)
  }
  if(report.resumedPreparationFrom){
    const previous=JSON.parse(await readFile(join(report.resumedPreparationFrom,'result.json'),'utf8'))
    assert.equal(previous.result,'FAIL');assert.match(previous.error,/Admissão não está livre/)
    assert.equal(previous.prepared,report.prepared);assert.equal(previous.latestHash,report.latestHash)
    assert.equal(previous.ownedFamilyStopped,true);assert.equal(previous.targetQaProfileRestored,true)
    assert.ok(report.inheritedReservationRecovery,'Continuation must explicitly recover the inherited reservation, not erase it')
  }
  history=assertLosslessRollbackHistory(baseline,current)
  for(const key of ['newRecords','changedRecords'])assert.equal(history[key],preparation.history[key])
  assert.equal(history.differenceInventoryHash,preparation.history.inventorySha256);assert.ok(history.newRecords>=1)
  activation=readRestoredActivations(db).at(-1);assert.equal(activation.phase,'CONFIRMED');assert.equal(activation.requestId,receipt.requestId);assert.deepEqual(activation.resumedChannels,['qa'])
  const journal=db.prepare("SELECT kind,payload FROM operator_decisions WHERE kind LIKE 'UPGRADE_PROFILE_%' ORDER BY rowid").all().map((row:any)=>({kind:row.kind,value:JSON.parse(vault.decrypt(row.payload,'operator_decisions.payload'))}))
  assert.deepEqual(journal.slice(-2).map((row:any)=>row.kind),['UPGRADE_PROFILE_STARTED','UPGRADE_PROFILE_CONFIRMED'])
  adoption=journal.at(-1).value;assert.equal(adoption.activationId,activation.id);assert.equal(adoption.requestId,receipt.requestId)
  assert.equal(adoption.candidateHash,hash(adopted));assert.equal(adoption.previousHash,hash(prior));assert.equal(hash(await readFile(adoption.previousProfile)),hash(prior))
  assert.equal(pendingUpgradeProfiles(db).size,0)
  const source=current.prepare('SELECT * FROM as_run ORDER BY rowid').all()
  if(report.versionReturn){
    const online=new SQLite(report.versionReturn.latestApiBackup.file,{readonly:true,fileMustExist:true})
    try{
      assert.equal(online.pragma('journal_mode',{simple:true}),'delete')
      assert.deepEqual(online.prepare('SELECT * FROM as_run ORDER BY rowid').all(),source)
      const created=report.versionReturn.postUpgradeRundown
      assert.equal(baseline.prepare('SELECT COUNT(*) AS n FROM rundowns WHERE id=?').get(created.id).n,0)
      assert.deepEqual(db.prepare('SELECT * FROM rundowns WHERE id=?').get(created.id),created)
      assert.deepEqual(online.prepare('SELECT * FROM rundowns WHERE id=?').get(created.id),created)
      for(const table of report.preparedBusinessTablesPreserved)assert.deepEqual(current.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),online.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),table)
    }finally{online.close()}
    assert.equal(report.postReturnBackup.phase,'READY')
    assert.equal(hash(await readFile(report.postReturnBackup.file)),report.postReturnBackup.sha256)
    assert.equal(report.postReturnBackupReconciliation.explicitConfirmation,true)
    const returned=new SQLite(report.postReturnBackup.file,{readonly:true,fileMustExist:true})
    try{
      assert.equal(returned.pragma('journal_mode',{simple:true}),'delete')
      assert.deepEqual(returned.prepare('SELECT * FROM rundowns WHERE id=?').get(report.versionReturn.postUpgradeRundown.id),report.versionReturn.postUpgradeRundown)
      assert.deepEqual(returned.prepare('SELECT * FROM as_run ORDER BY rowid').all(),db.prepare('SELECT * FROM as_run ORDER BY rowid').all())
    }finally{returned.close()}
  }
  rows=db.prepare('SELECT * FROM as_run ORDER BY rowid').all()
  assert.equal(source.length,2);assert.equal(rows.length,3)
  for(const [index,row]of source.entries())for(const key of Object.keys(row)){
    if(index===1&&['ended_at','ended_by','end_position_frames','aired_frames','duration_evidence'].includes(key))continue
    assert.deepEqual(rows[index][key],row[key],`Preserved history ${index}/${key}`)
  }
  assert.equal(rows[1].ended_by,'RESTART');assert.ok(rows[1].ended_at);assert.equal(rows[1].duration_evidence,'UNKNOWN')
  assert.equal(rows[1].end_position_frames,null);assert.equal(rows[1].aired_frames,null)
  const previous=JSON.parse(current.prepare('SELECT payload FROM channel_checkpoints WHERE channel_id=?').get('qa').payload)
  checkpoint=JSON.parse(db.prepare('SELECT payload FROM channel_checkpoints WHERE channel_id=?').get('qa').payload)
  for(const key of ['executionId','revisionId','itemId','rundownId'])assert.equal(checkpoint[key],previous[key])
  assert.ok(checkpoint.elapsed>=previous.elapsed);assert.equal(checkpoint.realEngine,true);assert.equal(checkpoint.playing,true)
  assert.equal(rows[2].start_position_frames,previous.elapsed);assert.equal(rows[2].execution_kind,'NATIVE');assert.equal(rows[2].ended_at,null)
  assert.equal(rows.filter(row=>row.ended_at===null).length,1)
}finally{db.close();current.close();baseline.close()}
const pixels=await readFile(join(directory,'rollback-target-last.gray'));assert.equal(pixels.length,320*180)
const mean=pixels.reduce((sum,value)=>sum+value,0)/pixels.length,deviation=Math.sqrt(pixels.reduce((sum,value)=>sum+(value-mean)**2,0)/pixels.length)
assert.ok(deviation>10);assert.ok(Math.abs(deviation-report.captures[0].deviation)<1e-8)
const pcm=await readFile(join(directory,'rollback-target-audio.f32')),statistics=stereoToneStatistics(pcm),spectrum=syntheticToneSpectrum(pcm),windows=syntheticToneWindows(pcm,spectrum.frequencyHz)
for(let channel=0;channel<2;channel++){assert.ok(statistics.rms[channel]!>0.01);assert.ok(Math.abs(spectrum.frequencyHz[channel]!-997)<15);assert.ok(windows.concentratedWindows[channel]!>=4)}
const result={result:'PASS',scope:report.scope,targetManifestSha256:preparation.targetManifestSha256,historyPolicy:preparation.historyPolicy,history:{newRecords:history.newRecords,changedRecords:history.changedRecords,missingRecords:0},activation:{id:activation.id,requestId:activation.requestId,phase:activation.phase},adoption:{id:adoption.id,phase:adoption.phase},asRunRecords:rows!.length,onlyOneOpenSegment:true,checkpoint,pixels:{mean,deviation,width:320,height:180},audio:{...statistics,spectrum,windows},standaloneExports:true,sourceFilesPreserved:true,targetQaProfileRestored:true,ownedFamilyStopped:true,changedSchemaDowngradeValidated:false,newerEditionPgmThenRollbackValidated:report.versionReturn?true:false,versionReturn:report.versionReturn??null,physicalInputsValidated:false,cleanWindowsValidated:false}
await writeFile(join(directory,'assertions-compatible-rollback.json'),JSON.stringify(result,null,2))
console.log(JSON.stringify({result:'PASS',directory,history:result.history,asRunRecords:rows!.length,onlyOneOpenSegment:true}))
