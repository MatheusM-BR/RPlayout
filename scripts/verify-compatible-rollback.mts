import assert from 'node:assert/strict'
import {spawn,execFile,type ChildProcess} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises'
import {join,resolve,dirname} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {createRequire} from 'node:module'
import {createServer} from 'node:net'
import {verifyPublishedPicture} from './lib/verify-published-picture.js'
import {verifyPublishedAudio} from './lib/verify-published-audio.js'

const current=resolve(process.argv[2]??''),target=resolve(process.argv[3]??''),sourceEvidence=resolve(process.argv[4]??''),qa=resolve('D:/RPlayout-builds/qa')
assert.ok(process.argv.length===5||process.argv.length===6)
const preparedArgument=process.argv[5]
assert.ok(!preparedArgument||preparedArgument.startsWith('--prepared='))
const reusedPrepared=preparedArgument?resolve(preparedArgument.slice('--prepared='.length)):null
let previousAttempt:any=null
if(reusedPrepared){
  assert.ok(reusedPrepared.toLowerCase().startsWith(qa.toLowerCase()+'\\compatible-rollback-'));assert.equal(reusedPrepared.slice(reusedPrepared.lastIndexOf('\\')+1),'prepared')
  previousAttempt=JSON.parse(await readFile(join(dirname(reusedPrepared),'result.json'),'utf8'))
  assert.equal(previousAttempt.result,'FAIL');assert.match(previousAttempt.error,/Admissão não está livre/)
  assert.equal(previousAttempt.ownedFamilyStopped,true);assert.equal(previousAttempt.targetQaProfileRestored,true)
  assert.equal(previousAttempt.current,current);assert.equal(previousAttempt.target,target);assert.equal(previousAttempt.sourceEvidence,sourceEvidence);assert.equal(previousAttempt.prepared,reusedPrepared)
}
for(const path of [current,target,sourceEvidence])assert.ok(path.toLowerCase().startsWith(qa.toLowerCase()+'\\'))
assert.equal(resolve(process.execPath).toLowerCase(),join(current,'runtime/node/node.exe').toLowerCase())
const evidence=JSON.parse(await readFile(join(sourceEvidence,'result.json'),'utf8'))
assert.equal(evidence.result,'PASS');assert.equal(evidence.ownedFamilyStopped,true)
const source=JSON.parse(await readFile(join(evidence.sourceDirectory,'result.json'),'utf8'))
const directory=await mkdtemp(join(qa,'compatible-rollback-')),prepared=reusedPrepared??join(directory,'prepared'),latest=previousAttempt?.latest??join(directory,'latest.db')
await mkdir(join(directory,'temp'))
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex'),run=promisify(execFile)
const SQLite=createRequire(join(current,'apps/server/dist/server.cjs'))('better-sqlite3')
const read=<T>(file:string,work:(db:any)=>T):T=>{const db=new SQLite(file,{readonly:true,fileMustExist:true});try{return work(db)}finally{db.close()}}
const originalProfile=await readFile(join(target,'installation-profile.json'));await writeFile(join(directory,'prior-target-profile.json'),originalProfile)
const env:NodeJS.ProcessEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^RPLAYOUT_|^NODE_|^PORT$|^HOST$|^GST_|^GSTREAMER_|^MTX_|^RTSP_/i.test(key)))
const gst=join(target,'runtime/gstreamer'),gstBin=join(gst,'bin'),ps=join(process.env.SystemRoot!,'System32/WindowsPowerShell/v1.0/powershell.exe')
Object.assign(env,{PATH:[join(current,'runtime/node'),join(target,'apps/engine/target/release'),gstBin,join(process.env.SystemRoot!,'System32')].join(';'),TEMP:join(directory,'temp'),TMP:join(directory,'temp'),HOST:'127.0.0.1',RPLAYOUT_ENGINE_OUTPUT:'null',RPLAYOUT_MEDIAMTX_BIND:'127.0.0.1',RPLAYOUT_BACKUP_HOURS:'0',LOG_LEVEL:'warn',GSTREAMER_1_0_ROOT_MSVC_X86_64:gst,GST_PLUGIN_PATH:join(gst,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gst,'lib/gstreamer-1.0'),GST_PLUGIN_SCANNER:join(gst,'libexec/gstreamer-1.0/gst-plugin-scanner.exe'),GST_REGISTRY:join(directory,'registry.bin')})
let child:ChildProcess|null=null,logs='',base='',cookie='',heartbeat:ReturnType<typeof setInterval>|null=null,result:Record<string,any>={result:'FAIL',directory,current,target,sourceEvidence,prepared,scope:'Selected packaged controller and target, using a native r83 snapshot created before standalone export; repeated same-schema restoration only, not newer-edition PGM followed by version downgrade'},failure:unknown=null
const owned=new Set<number>(),q=(text:string)=>"'"+text.replaceAll("'","''")+"'"
const alive=(pid:number)=>{try{process.kill(pid,0);return true}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return false;throw error}}
async function inventory(){
  const code=`$ErrorActionPreference='Stop'; $rows=@(Get-CimInstance Win32_Process | Where-Object {$_.ProcessId -ne ${process.pid}}); $ids=[Collections.Generic.HashSet[int]]::new(); if(${child?.pid??0} -gt 0){[void]$ids.Add(${child?.pid??0})}; foreach($row in $rows){if($row.ExecutablePath -and $row.ExecutablePath.StartsWith(${q(target+'\\')},[StringComparison]::OrdinalIgnoreCase)){[void]$ids.Add([int]$row.ProcessId)}}; do {$changed=$false; foreach($row in $rows){if($ids.Contains([int]$row.ParentProcessId) -and $ids.Add([int]$row.ProcessId)){$changed=$true}}} while($changed); ConvertTo-Json -InputObject @($rows | Where-Object {$ids.Contains([int]$_.ProcessId)} | Select-Object ProcessId,ParentProcessId,ExecutablePath) -Compress`
  const value=await run(ps,['-NoProfile','-NonInteractive','-Command',code],{env,windowsHide:true,timeout:15000,maxBuffer:32768});const rows=JSON.parse(value.stdout);for(const row of rows)owned.add(row.ProcessId);return rows
}
async function request(path:string,body?:object){const response=await fetch(base+path,{method:body?'POST':'GET',headers:{...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(5000)});const value=await response.json() as any;assert.equal(response.status,200,path+' '+JSON.stringify(value));return value}
// Offline package hashing/review spans thousands of files on a cold Windows
// volume. Its QA budget is separate from the unchanged native decoder limits.
async function wait(label:string,check:()=>Promise<boolean>,timeout=600000){const deadline=performance.now()+timeout;while(performance.now()<deadline){if(await check())return;assert.equal(child?.exitCode,null,logs);await new Promise(done=>setTimeout(done,100))}throw new Error(label+' '+logs)}
try{
  assert.equal((await inventory()).length,0,'Target QA installation is not idle')
  if(previousAttempt){assert.equal(hash(await readFile(latest)),previousAttempt.latestHash);assert.equal(hash(originalProfile),hash(await readFile(join(previousAttempt.directory,'prior-target-profile.json'))));result.resumedPreparationFrom=previousAttempt.directory}
  if(evidence.returnScenario){
    assert.equal(resolve(evidence.returnScenario.sourceInstallation).toLowerCase(),target.toLowerCase())
    assert.equal(resolve(evidence.returnScenario.upgradedInstallation).toLowerCase(),current.toLowerCase())
    assert.equal(evidence.returnBackup.phase,'READY')
    assert.equal(hash(await readFile(evidence.returnBackup.file)),evidence.returnBackup.sha256)
    for(const [root,expected]of [[target,evidence.returnScenario.sourceServerHash],[current,evidence.returnScenario.upgradedServerHash]])assert.equal(hash(await readFile(join(root,'apps/server/dist/server.cjs'))),expected)
    const oldReceipt=JSON.parse(await readFile(join(target,'installation-receipt.json'),'utf8')),newReceipt=JSON.parse(await readFile(join(current,'installation-receipt.json'),'utf8'))
    const revision=(edition:string)=>Number(/-r(\d+)$/.exec(edition)?.[1])
    assert.equal(oldReceipt.integrity,'VERIFIED');assert.equal(newReceipt.integrity,'VERIFIED');assert.ok(revision(newReceipt.edition)>revision(oldReceipt.edition))
    result.versionReturn={sourceEdition:oldReceipt.edition,upgradedEdition:newReceipt.edition,targetEdition:oldReceipt.edition,sourceInstallation:target,upgradedInstallation:current,sourceServerHash:evidence.returnScenario.sourceServerHash,upgradedServerHash:evidence.returnScenario.upgradedServerHash,latestApiBackup:evidence.returnBackup,postUpgradeRundown:evidence.postUpgradeRundown}
    result.scope='Installed older edition -> newer edition with native PGM and new editorial data -> older edition using latest online API snapshot; same schema/account, not inverse schema migration or physical power loss'
  }
  // Never mutate previous evidence DB: produce a fresh, closed SQLite backup.
  if(!reusedPrepared){
    const db=new SQLite(evidence.returnBackup?.file??join(evidence.prepared,'service.db'),{readonly:true,fileMustExist:true})
    try{await db.backup(latest)}finally{db.close()}
  }
  // Exercise the PRODUCT'S explicit export for historical WAL-mode sources.
  const baseline=source.upgradeBackup.file
  const latestHash=hash(await readFile(latest)),vault=join(evidence.prepared,'vault.json')
  result.originalBaseline=source.upgradeBackup.file;result.originalBaselineHash=source.upgradeBackup.sha256
  result.latestHash=latestHash;result.latest=latest;result.baseline=baseline
  const before=read(latest,db=>({asRun:db.prepare('SELECT * FROM as_run ORDER BY rowid').all(),checkpoint:JSON.parse(db.prepare('SELECT payload FROM channel_checkpoints WHERE channel_id=?').get('qa').payload)}))
  assert.equal(before.asRun.length,2)
  const described=await run(process.execPath,[join(current,'apps/server/dist/rollback-contract.cjs'),'--describe'],{env,windowsHide:true,timeout:15000,maxBuffer:65536});assert.equal(JSON.parse(described.stdout).migrations.length,50)
  if(!reusedPrepared){
    const preparedOutput=await run(ps,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',join(current,'prepare-rplayout-rollback.ps1'),'-CurrentBackup',latest,'-BaselineBackup',baseline,'-VaultFile',vault,'-TargetInstallation',target,'-Destination',prepared,'-MediaRoot',source.originalMediaRoot,'-ExportSnapshots'],{env,cwd:current,windowsHide:true,timeout:180000,maxBuffer:65536})
    await writeFile(join(directory,'prepare.log'),preparedOutput.stdout+'\n'+preparedOutput.stderr)
  }
  assert.equal(hash(await readFile(latest)),latestHash)
  assert.deepEqual(read(join(prepared,'service.db'),db=>db.prepare('SELECT * FROM as_run ORDER BY rowid').all()),before.asRun)
  const businessTables=['media_assets','media_versions','qc_decisions','rundowns','rundown_items','operational_playlist_revisions','media_jobs']
  for(const table of businessTables)assert.deepEqual(read(join(prepared,'service.db'),db=>db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()),read(latest,db=>db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()),'Latest full snapshot preserves '+table)
  result.preparedBusinessTablesPreserved=businessTables
  assert.equal(hash(await readFile(join(target,'installation-profile.json'))),hash(originalProfile))
  result.preparedLatestHistoryPreserved=true
  process.env.RPLAYOUT_VAULT_FILE=join(prepared,'vault.json');delete process.env.RPLAYOUT_VAULT_KEY
  const {readStorageAdmission}=await import('../apps/server/src/db/storage-admission.js')
  const {verifyRestorationManifest}=await import('../apps/server/src/domain/restoration-manifest.js')
  const {readRestoredActivations}=await import('../apps/server/src/db/restored-activations.js')
  const receiptDatabase=new SQLite(join(prepared,'service.db'),{readonly:true,fileMustExist:true})
  let receipt:Awaited<ReturnType<typeof verifyRestorationManifest>>
  try{receipt=await verifyRestorationManifest(receiptDatabase,join(prepared,'restore-quarantine.json'))}finally{receiptDatabase.close()}
  // A review refusal/QA deadline is resumable only BEFORE any activation for
  // this restoration. An unknown/failed/confirmed TAKE is never replayed.
  assert.equal(read(join(prepared,'service.db'),db=>readRestoredActivations(db).some(row=>row.requestId===receipt.requestId)),false,'Activation was already attempted; inspect receipts instead of replaying')
  const admission=read(join(prepared,'service.db'),db=>readStorageAdmission(db))
  if(admission?.phase==='MAINTENANCE'){
    const recovery=await run(join(target,'runtime/node/node.exe'),[join(target,'apps/server/dist/recover-restored-reservation.cjs'),'--database',join(prepared,'service.db'),'--manifest',join(prepared,'restore-quarantine.json'),'--vault-file',join(prepared,'vault.json')],{env:{...env,RPLAYOUT_INSTALL_ROOT:target},cwd:target,windowsHide:true,timeout:60000,maxBuffer:32768})
    await writeFile(join(directory,'inherited-reservation-recovery.log'),recovery.stdout+'\n'+recovery.stderr)
    result.inheritedReservationRecovery=JSON.parse(recovery.stdout)
    assert.equal(result.inheritedReservationRecovery.stage,'RESERVATION_RELEASED_NOT_ACTIVATED')
    assert.equal(read(join(prepared,'service.db'),db=>readStorageAdmission(db))?.phase,'OPEN')
    assert.deepEqual(read(join(prepared,'service.db'),db=>db.prepare('SELECT * FROM as_run ORDER BY rowid').all()),before.asRun)
  }else if(reusedPrepared){
    const {installationVault}=await import('../apps/server/src/domain/secret-vault.js')
    const vault=installationVault(false)
    const recovery=read(join(prepared,'service.db'),db=>db.prepare("SELECT id,payload FROM operator_decisions WHERE kind='RESTORED_RESERVATION_RECOVERED' ORDER BY rowid").all().map((row:any)=>({id:row.id,value:JSON.parse(vault.decrypt(row.payload,'operator_decisions.payload'))})).filter((row:any)=>row.value.requestId===receipt.requestId))
    assert.equal(recovery.length,1,'Previously recovered reservation needs an authenticated recovery decision')
    assert.equal(admission?.phase,'OPEN');assert.equal(admission.revision,recovery[0].value.previousAdmission.revision+1)
    result.inheritedReservationRecovery={stage:'RESERVATION_RELEASED_NOT_ACTIVATED',requestId:receipt.requestId,revision:admission.revision,activationPerformed:false,source:'AUTHENTICATED_PRIOR_RECOVERY_DECISION',decisionId:recovery[0].id}
  }
  const allocator=createServer();await new Promise<void>(done=>allocator.listen(0,'127.0.0.1',done));const port=(allocator.address() as {port:number}).port;await new Promise<void>(done=>allocator.close(()=>done()));base='http://127.0.0.1:'+port
  child=spawn(ps,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',resolve('scripts/qa-owned-upgrade.ps1'),'-InstallRoot',current,'-Workspace',prepared,'-Mode','ACTIVATE','-AdoptProfile','-Rollback'],{cwd:current,env:{...env,PORT:String(port)},windowsHide:true,stdio:['ignore','pipe','pipe']})
  for(const stream of [child.stdout,child.stderr])stream?.on('data',chunk=>logs=(logs+String(chunk)).slice(-64000))
  await wait('Target real launcher returns with latest snapshot',async()=>{try{return(await request('/_rplayout/launcher')).application==='RPlayout'}catch{return false}})
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'launcher-native-verifier',password:'Local-launcher-native-20261016'})});assert.equal(login.status,200);cookie=login.headers.get('set-cookie')!.split(';')[0]!
  const view=await request('/api/rundowns/rd');assert.equal(view.live.transport.mode,'NATIVE');assert.equal(view.live.transport.onAir.itemId,before.checkpoint.itemId)
  const checkpoint=read(join(prepared,'service.db'),db=>JSON.parse(db.prepare('SELECT payload FROM channel_checkpoints WHERE channel_id=?').get('qa').payload))
  for(const key of ['executionId','revisionId','itemId'])assert.equal(checkpoint[key],before.checkpoint[key])
  await request('/api/channels/qa/watching',{bus:'mon'})
  let busy=false;heartbeat=setInterval(()=>{if(busy)return;busy=true;void request('/api/channels/qa/watching',{bus:'mon'}).catch(error=>{result.heartbeatError=String(error)}).finally(()=>{busy=false})},5000)
  await wait('Real target monitor video and audio',async()=>{const response=await fetch('http://127.0.0.1:9997/v3/paths/get/'+view.monitors.program,{signal:AbortSignal.timeout(3000)});if(!response.ok)return false;const path=await response.json() as any;return path.ready&&path.tracks.includes('H264')&&path.tracks.includes('Opus')},30000)
  const captures=await Promise.allSettled([verifyPublishedPicture({gstBin,directory,path:view.monitors.program,width:320,height:180,environment:env,label:'rollback-target',videoOnly:true}),verifyPublishedAudio({gstBin,directory,path:view.monitors.program,environment:env,label:'rollback-target',expectedHz:997})])
  for(const capture of captures)if(capture.status==='rejected')throw capture.reason
  result.captures=captures.map(value=>(value as PromiseFulfilledResult<any>).value)
  const rows=read(join(prepared,'service.db'),db=>db.prepare('SELECT * FROM as_run ORDER BY rowid').all())
  assert.equal(rows.length,3);assert.equal(rows.filter((row:any)=>row.ended_at===null).length,1)
  for(const [index,row]of before.asRun.entries())for(const key of ['id','item_id','revision_id','media_hash','started_at'])assert.equal(rows[index][key],row[key])
  assert.equal(rows[1].ended_by,'RESTART');assert.equal(rows[2].start_position_frames,before.checkpoint.elapsed)
  if(evidence.returnScenario){
    assert.deepEqual(read(join(prepared,'service.db'),db=>db.prepare('SELECT * FROM rundowns WHERE id=?').get(evidence.postUpgradeRundown.id)),evidence.postUpgradeRundown)
    assert.equal((await request('/api/rundowns/'+evidence.postUpgradeRundown.id)).view.rundown.name,evidence.postUpgradeRundown.name)
    assert.equal(hash(await readFile(evidence.returnBackup.file)),evidence.returnBackup.sha256)
    const inheritedId=evidence.returnBackup.requestId
    assert.equal((await request('/api/backups/upgrade/'+inheritedId)).phase,'UNCERTAIN')
    assert.equal((await request('/api/backups/upgrade/'+inheritedId+'/reconcile',{confirm:true})).phase,'REFUSED')
    const requestId=randomUUID();result.postReturnBackupRequestId=requestId
    await request('/api/backups/upgrade',{requestId})
    await wait('Backup remains usable after returning to the older edition',async()=>{
      result.postReturnBackup=await request('/api/backups/upgrade/'+requestId)
      assert.ok(['CHECKING','READY'].includes(result.postReturnBackup.phase))
      return result.postReturnBackup.phase==='READY'
    },30000)
    assert.equal(hash(await readFile(result.postReturnBackup.file)),result.postReturnBackup.sha256)
    assert.deepEqual(read(result.postReturnBackup.file,db=>db.prepare('SELECT * FROM rundowns WHERE id=?').get(evidence.postUpgradeRundown.id)),evidence.postUpgradeRundown)
    result.postReturnBackupReconciliation={inheritedId,explicitConfirmation:true,noReplay:true}
    result.newerEditionPgmThenRollbackValidated=true
  }
  assert.equal(hash(await readFile(join(target,'installation-profile.json'))),hash(await readFile(join(prepared,'installation-profile.candidate.json'))))
  await writeFile(join(directory,'adopted-target-profile.json'),await readFile(join(target,'installation-profile.json')))
  result.before=before;result.after={checkpoint,asRun:rows};result.result='PASS'
}catch(error){failure=error;result.error=String(error);throw error}
finally{
  if(heartbeat)clearInterval(heartbeat)
  result.observedFamily=await inventory()
  if(child&&child.exitCode===null&&child.signalCode===null)await new Promise<void>((done,reject)=>{const timer=setTimeout(()=>reject(new Error('QA job did not exit')),15000);child!.once('exit',()=>{clearTimeout(timer);done()});child!.kill('SIGKILL')})
  const deadline=performance.now()+15000;while([...owned].some(alive)&&performance.now()<deadline)await new Promise(done=>setTimeout(done,100))
  result.ownedFamilyStopped=[...owned].every(pid=>!alive(pid))&&(await inventory()).length===0
  if(result.ownedFamilyStopped){await writeFile(join(target,'installation-profile.json'),originalProfile);result.targetQaProfileRestored=hash(await readFile(join(target,'installation-profile.json')))===hash(originalProfile)}
  else {result.result='FAIL';result.teardownError='Own target processes not stopped; profile preserved'}
  result.physicalInputsValidated=false;result.changedSchemaDowngradeValidated=false;result.cleanWindowsValidated=false
  await writeFile(join(directory,'target.log'),logs);await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({result:result.result,directory,error:result.error,ownedFamilyStopped:result.ownedFamilyStopped}))
  if(result.result!=='PASS'&&!failure)throw new Error(result.teardownError)
}
