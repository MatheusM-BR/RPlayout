import assert from 'node:assert/strict'
import {spawn,execFile,type ChildProcess} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,mkdir,readFile,writeFile,readdir} from 'node:fs/promises'
import {resolve,join,dirname} from 'node:path'
import {createServer} from 'node:net'
import {createHash,randomUUID} from 'node:crypto'
import {createRequire} from 'node:module'
import {verifyPublishedPicture} from './lib/verify-published-picture.js'
import {verifyPublishedAudio} from './lib/verify-published-audio.js'

// Qualified installed source -> qualified target, SAME schema/account. Never
// touches an operational installation, deletes data or fabricates restore state.
const qaRoot=resolve('D:/RPlayout-builds/qa'),install=resolve(process.argv[2]??''),sourceDirectory=resolve(process.argv[3]??'')
assert.ok(process.argv.length===4||process.argv.length===5)
const interruptAfterPublication=process.argv[4]==='--interrupt-adoption-published'
const interruptAdoption=process.argv[4]==='--interrupt-adoption'||interruptAfterPublication
const captureReturnBackup=process.argv[4]==='--capture-return-backup'
const preparedArgument=interruptAdoption||captureReturnBackup?undefined:process.argv[4]
assert.ok(!preparedArgument||preparedArgument.startsWith('--prepared='))
const reusedPrepared=preparedArgument?resolve(preparedArgument.slice('--prepared='.length)):null
if(reusedPrepared){
  assert.ok(reusedPrepared.toLowerCase().startsWith(qaRoot.toLowerCase()+'\\upgrade-workflow-'))
  assert.equal(reusedPrepared.slice(reusedPrepared.lastIndexOf('\\')+1),'prepared')
  const previous=JSON.parse(await readFile(join(dirname(reusedPrepared),'result.json'),'utf8'))
  assert.equal(previous.install,install);assert.equal(previous.sourceDirectory,sourceDirectory)
  assert.equal(previous.ownedFamilyStopped,true);assert.equal(previous.qaProfileRestored,true)
  assert.equal(previous.stage,undefined,'Do not reuse an already admitted candidate as a fresh preparation')
}
for(const path of [install,sourceDirectory])assert.ok(path.toLowerCase().startsWith(qaRoot.toLowerCase()+'\\'))
assert.equal(resolve(process.execPath).toLowerCase(),join(install,'runtime/node/node.exe').toLowerCase())
const source=JSON.parse(await readFile(join(sourceDirectory,'result.json'),'utf8'))
assert.equal(source.result,'PASS');assert.equal(source.ownedFamilyStopped,true);assert.equal(source.upgradeBackup.phase,'READY')
assert.ok(['e226c793e654679bfb33c4a737948b2c1ac53c8d5afc1285c4cf8f123a291c65','7d2568300761ae477a60a4c3c9b8ea26821d4680b3c840052117f5a98ed0348b'].includes(source.hashes.server),'Unqualified source edition')
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
const installedServerHash=hash(await readFile(join(install,'apps/server/dist/server.cjs')))
assert.ok(['6b3e024c59d7537be04c00bf7e1aafad30bc2747bd52345b445c5d213744092f','3f52de22cd416a920a273de2489a3d3ff6a490b8bfbf2790e647b0101c7f030d'].includes(installedServerHash),'Unqualified target edition')
for(const [root,expected]of [[source.root,source.hashes.server],[install,installedServerHash]]){
  const manifest=JSON.parse(await readFile(join(root,'package-manifest.json'),'utf8'))
  assert.equal(JSON.parse(await readFile(join(root,'installation-receipt.json'),'utf8')).integrity,'VERIFIED')
  assert.equal(manifest.files.find((entry:any)=>entry.file==='apps/server/dist/server.cjs').sha256.toLowerCase(),expected)
  assert.equal(hash(await readFile(join(root,'apps/server/dist/server.cjs'))),expected)
}
const engineHash=hash(await readFile(join(install,'apps/engine/target/release/rplayout-engine.exe')))
assert.equal(engineHash,'610e03e8a61215e7ddb85570451178456337b8f2f9aa57ab07a057ae954cf7fa')
assert.equal(hash(await readFile(source.upgradeBackup.file)),source.upgradeBackup.sha256)
const directory=await mkdtemp(join(qaRoot,'upgrade-workflow-')),prepared=reusedPrepared??join(directory,'prepared')
await mkdir(join(directory,'temp'))
const profileFile=join(install,'installation-profile.json'),priorProfile=await readFile(profileFile)
await writeFile(join(directory,'prior-profile.json'),priorProfile)
const ps=join(process.env.SystemRoot!,'System32/WindowsPowerShell/v1.0/powershell.exe'),run=promisify(execFile)
const gst=join(install,'runtime/gstreamer'),gstBin=join(gst,'bin')
const env:NodeJS.ProcessEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^RPLAYOUT_|^NODE_|^MTX_|^RTSP_|^GST_|^GSTREAMER_|^PORT$|^HOST$/i.test(key)))
Object.assign(env,{PATH:[join(install,'runtime/node'),gstBin,join(install,'apps/engine/target/release'),join(process.env.SystemRoot!,'System32')].join(';'),TEMP:join(directory,'temp'),TMP:join(directory,'temp'),HOST:'127.0.0.1',RPLAYOUT_MEDIAMTX_BIND:'127.0.0.1',RPLAYOUT_ENGINE_OUTPUT:'null',RPLAYOUT_BACKUP_HOURS:'0',LOG_LEVEL:'warn',GSTREAMER_1_0_ROOT_MSVC_X86_64:gst,GST_PLUGIN_PATH:join(gst,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gst,'lib/gstreamer-1.0'),GST_PLUGIN_SCANNER:join(gst,'libexec/gstreamer-1.0/gst-plugin-scanner.exe'),GST_REGISTRY:join(directory,'registry.bin')})
const sql= createRequire(join(install,'apps/server/dist/server.cjs'))('better-sqlite3')
const read=<T>(file:string,work:(db:any)=>T):T=>{const db=new sql(file,{readonly:true,fileMustExist:true});try{return work(db)}finally{db.close()}}
const businessTables=['media_assets','media_versions','qc_decisions','rundowns','rundown_items','operational_playlist_revisions','as_run','media_jobs']
const snapshot=(file:string)=>read(file,db=>Object.fromEntries(businessTables.map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])))
const original=snapshot(source.upgradeBackup.file),checkpoint=read(source.upgradeBackup.file,db=>JSON.parse(db.prepare('SELECT payload FROM channel_checkpoints WHERE channel_id=?').get('qa').payload))
assert.equal(checkpoint.playing,true);assert.equal(checkpoint.realEngine,true);assert.equal(checkpoint.itemId,source.item)
const database=join(prepared,'service.db'),manifest=join(prepared,'restore-quarantine.json'),vault=join(prepared,'vault.json')
let cookie='',base='',current:ChildProcess|null=null,result:Record<string,any>={result:'FAIL',directory,install,sourceDirectory,prepared,engineHash,interruptAdoption,interruptAfterPublication,reusedPrepared:Boolean(reusedPrepared),sourceBackup:source.upgradeBackup,scope:interruptAdoption?'Real interruption of own native adoption, observed-file reconciliation; not physical power loss or operational rollback':'Installed same-schema upgrade rehearsal; not downgrade, clean Windows, external protocols or power-loss qualification'},failure:unknown=null
const wrappers:ChildProcess[]=[],logs=new Map<ChildProcess,string>(),ownedPids=new Set<number>()
let heartbeat:ReturnType<typeof setInterval>|null=null
const q=(value:string)=>"'"+value.replaceAll("'","''")+"'"
const alive=(pid:number)=>{try{process.kill(pid,0);return true}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return false;throw error}}
async function command(label:string,script:string,args:string[],expected=0){
  try{const value=await run(ps,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,...args],{cwd:install,env,windowsHide:true,timeout:180000,maxBuffer:262144});await writeFile(join(directory,label+'.log'),value.stdout+'\n'+value.stderr);assert.equal(expected,0);return value.stdout}
  catch(error){const e=error as any;await writeFile(join(directory,label+'.log'),String(e.stdout??'')+'\n'+String(e.stderr??''));throw error}
}
async function inspect(){
  const owned=current?.pid??0
  const code=`$ErrorActionPreference='Stop'; $rows=@(Get-CimInstance Win32_Process | Where-Object {$_.ProcessId -ne ${process.pid}}); $ids=[Collections.Generic.HashSet[int]]::new(); if(${owned} -gt 0){[void]$ids.Add(${owned})}; foreach($row in $rows){if($row.ExecutablePath -and $row.ExecutablePath.StartsWith(${q(install+'\\')},[StringComparison]::OrdinalIgnoreCase)){[void]$ids.Add([int]$row.ProcessId)}}; do {$changed=$false; foreach($row in $rows){if($ids.Contains([int]$row.ParentProcessId) -and $ids.Add([int]$row.ProcessId)){$changed=$true}}} while($changed); ConvertTo-Json -InputObject @($rows | Where-Object {$ids.Contains([int]$_.ProcessId)} | Select-Object ProcessId,ParentProcessId,ExecutablePath) -Compress`
  const output=await run(ps,['-NoProfile','-NonInteractive','-Command',code],{env,windowsHide:true,timeout:15000,maxBuffer:32768})
  const rows=JSON.parse(output.stdout);for(const row of rows)ownedPids.add(row.ProcessId);return rows
}
async function stopped(child:ChildProcess){
  if(child.exitCode!==null||child.signalCode!==null)return
  await new Promise<void>((done,reject)=>{const timer=setTimeout(()=>reject(new Error('Owned QA wrapper did not stop')),15000);child.once('exit',()=>{clearTimeout(timer);done()});child.kill('SIGKILL')})
}
async function stopCurrent(label:string){
  if(!current)return
  const family=await inspect();result[label+'Family']=family
  await stopped(current);const deadline=performance.now()+15000
  while(family.some((row:any)=>alive(row.ProcessId))&&performance.now()<deadline)await new Promise(done=>setTimeout(done,100))
  assert.ok(family.every((row:any)=>!alive(row.ProcessId)),'Owned QA job left live descendants')
  current=null
}
async function wait(label:string,check:()=>Promise<boolean>,timeout=180000){
  const deadline=performance.now()+timeout
  while(performance.now()<deadline){if(await check())return;assert.ok(current?.exitCode===null&&current.signalCode===null,label+' '+logs.get(current!));await new Promise(done=>setTimeout(done,200))}
  throw new Error(label+' '+logs.get(current!))
}
async function request(path:string,body?:object,expected=200){
  const response=await fetch(base+path,{method:body?'POST':'GET',headers:{...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(5000)})
  const value=await response.json() as any;assert.equal(response.status,expected,path+' '+JSON.stringify(value));return value
}
async function start(mode:'STAGE'|'ACTIVATE',adopt=false,interrupt=false){
  const allocator=createServer();await new Promise<void>(done=>allocator.listen(0,'127.0.0.1',done));const port=(allocator.address() as {port:number}).port;await new Promise<void>(done=>allocator.close(()=>done()))
  base='http://127.0.0.1:'+port;cookie=''
  const child=spawn(ps,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',resolve('scripts/qa-owned-upgrade.ps1'),'-InstallRoot',install,'-Workspace',prepared,'-Mode',mode,...(adopt?['-AdoptProfile']:[])],{env:{...env,PORT:String(port)},cwd:install,windowsHide:true,stdio:['ignore','pipe','pipe']})
  wrappers.push(child);current=child;logs.set(child,'')
  for(const stream of [child.stdout,child.stderr])stream?.on('data',chunk=>logs.set(child,(logs.get(child)!+String(chunk)).slice(-64000)))
  child.on('error',error=>logs.set(child,(logs.get(child)??'')+String(error)))
  if(interrupt){
    const {pendingUpgradeProfiles}=await import('../apps/server/src/domain/upgrade-profile-adoption.js')
    const preexistingProfileTemps=new Set((await readdir(install)).filter(name=>name.startsWith('.installation-profile.json.private-')))
    await inspect()
    const deadline=performance.now()+600000
    let observed=false
    while(performance.now()<deadline){
      assert.equal(child.exitCode,null,logs.get(child))
      const pending=read(database,db=>[...pendingUpgradeProfiles(db).values()])
      if(pending.length){
        assert.equal(pending.length,1);result.interruptedIntent=pending[0]
        if(interruptAfterPublication){
          // Do not block the entire adoption: live observation/checkpoint
          // writes would stall its event loop before it reaches publication.
          // Wait until the TARGET profile temp actually exists (archive step
          // completed), then hold only the short final publication window.
          const temporaryDeadline=performance.now()+10000
          let targetTemporary:string|undefined
          while(performance.now()<temporaryDeadline){
            assert.equal(child.exitCode,null,logs.get(child))
            targetTemporary=(await readdir(install)).find(name=>name.startsWith('.installation-profile.json.private-')&&!preexistingProfileTemps.has(name))
            if(targetTemporary)break
            assert.equal(read(database,db=>pendingUpgradeProfiles(db).has(String(result.interruptedIntent.id))),true,'Adoption completed before the target temp was observed')
            await new Promise(done=>setTimeout(done,2))
          }
          assert.ok(targetTemporary,'Target publication temp was not observed; do not claim this window')
          // Fault injection is ordinary SQLite WRITE CONTENTION, never an
          // UPDATE/forged diary or a product hook. STARTED is already committed.
          // Readers/proof checks remain allowed; the final audit cannot commit
          // until this QA-only transaction is rolled back after our job stops.
          const blocker=new sql(database,{fileMustExist:true,timeout:0})
          let locked=false
          try{
            blocker.exec('BEGIN IMMEDIATE');locked=true
            assert.equal([...pendingUpgradeProfiles(blocker).values()].some(row=>row.id===result.interruptedIntent.id),true,'Publication already completed before the contention; do not fake interruption')
            const publicationDeadline=performance.now()+10000
            let published=false
            while(performance.now()<publicationDeadline){
              assert.equal(child.exitCode,null,logs.get(child))
              const bytes=await readFile(profileFile)
              if(hash(bytes)===result.interruptedIntent.candidateHash){
                result.candidateObservedBeforeStop={sha256:hash(bytes),at:new Date().toISOString()}
                // Stop the exact owned job BEFORE releasing the database lock.
                await stopped(child);published=true;break
              }
              await new Promise(done=>setTimeout(done,2))
            }
            assert.ok(published,'Candidate was not observed before the stop; no candidate-published claim')
            result.publicationFault={kind:'QA_SQLITE_WRITE_CONTENTION',targetTemporary,businessWrites:0,journalWrites:0,ownJobStoppedBeforeUnlock:true}
          }finally{
            await stopped(child)
            try{if(locked)blocker.exec('ROLLBACK')}finally{blocker.close()}
          }
        }else{
          // Kill this already-owned job immediately, BEFORE a slow inventory or
          // profile read. No injected SQL or synthetic journal phases.
          await stopped(child)
        }
        observed=true;break
      }
      await new Promise(done=>setTimeout(done,10))
    }
    assert.ok(observed,'Did not observe native publication intent; no replay on this candidate')
    await stopCurrent('interrupted')
    const pending=read(database,db=>[...pendingUpgradeProfiles(db).values()])
    assert.equal(pending.length,1,'Publication completed before the stop; do not pretend it was interrupted')
    assert.equal(pending[0].id,result.interruptedIntent.id)
    return
  }
  await wait(mode+' backend readiness',async()=>{try{return(await request('/_rplayout/launcher')).application==='RPlayout'}catch{return false}})
  assert.match(logs.get(child)!,/QA_JOB_ENTERED/)
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'launcher-native-verifier',password:'Local-launcher-native-20261016'})})
  assert.equal(login.status,200);cookie=login.headers.get('set-cookie')!.split(';')[0]!
  await inspect()
}
try{
  assert.equal((await inspect()).length,0,'New installation is not idle')
  if(!reusedPrepared)await command('prepare',join(install,'prepare-rplayout-upgrade.ps1'),['-Backup',source.upgradeBackup.file,'-Destination',prepared,'-VaultFile',source.originalVaultFile,'-MediaRoot',source.originalMediaRoot])
  assert.equal(hash(await readFile(profileFile)),hash(priorProfile))
  assert.equal(hash(await readFile(source.upgradeBackup.file)),source.upgradeBackup.sha256)
  assert.equal(hash(await readFile(vault)),hash(await readFile(source.originalVaultFile)))
  assert.deepEqual(snapshot(database),original)
  const preparation=JSON.parse(await readFile(join(prepared,'upgrade-preparation.json'),'utf8')),envelope=JSON.parse(await readFile(manifest,'utf8')),receipt=envelope.report
  process.env.RPLAYOUT_VAULT_FILE=vault;delete process.env.RPLAYOUT_VAULT_KEY
  const {verifyRestorationManifest}=await import('../apps/server/src/domain/restoration-manifest.js')
  const verifiedDatabase=new sql(database,{readonly:true,fileMustExist:true})
  try{assert.deepEqual(await verifyRestorationManifest(verifiedDatabase,manifest),receipt)}finally{verifiedDatabase.close()}
  assert.equal(preparation.phase,'QUARANTINED');assert.equal(preparation.activeProfileChanged,false)
  assert.equal(receipt.backupSha256,source.upgradeBackup.sha256);assert.equal(receipt.promotionReady,false)
  result.preparation={requestId:receipt.requestId,businessTablesPreserved:true,backupUntouched:true,vaultCopied:true,profileUnchanged:true}
  if(interruptAdoption){
    await start('ACTIVATE',true,true)
    const {pendingUpgradeProfiles,assertNoUncertainUpgradeProfile}=await import('../apps/server/src/domain/upgrade-profile-adoption.js')
    const {readRestoredActivations}=await import('../apps/server/src/db/restored-activations.js')
    const {readStorageAdmission}=await import('../apps/server/src/db/storage-admission.js')
    assert.throws(()=>read(database,db=>assertNoUncertainUpgradeProfile(db)),/interrompida/)
    const activation=read(database,db=>readRestoredActivations(db).at(-1))!
    assert.equal(activation.phase,'CONFIRMED');assert.equal(activation.id,result.interruptedIntent.activationId)
    assert.equal(read(database,db=>readStorageAdmission(db)!.phase),'MAINTENANCE')
    const observedProfile=await readFile(profileFile),observedHash=hash(observedProfile)
    assert.ok([result.interruptedIntent.previousHash,result.interruptedIntent.candidateHash].includes(observedHash))
    if(interruptAfterPublication)assert.equal(observedHash,result.interruptedIntent.candidateHash)
    await writeFile(join(directory,'interrupted-profile.json'),observedProfile)
    const beforeReconcile=read(database,db=>({checkpoint:db.prepare('SELECT * FROM channel_checkpoints').all(),asRun:db.prepare('SELECT * FROM as_run ORDER BY rowid').all()}))
    const tool=join(install,'apps/server/dist/reconcile-upgrade-profile.cjs')
    const arguments_=['--database',database,'--vault-file',vault,'--installation',install,'--adoption-id',result.interruptedIntent.id,'--confirm','RECONCILIAR']
    let refused=false
    try{await run(process.execPath,[tool,...arguments_],{env,cwd:directory,windowsHide:true,timeout:30000,maxBuffer:16384})}
    catch(error){const e=error as any;assert.equal(e.code,1);assert.match(String(e.stderr),/Reserva interrompida/);refused=true;await writeFile(join(directory,'reconcile-without-release.log'),String(e.stderr))}
    assert.equal(refused,true,'Ordinary reconciliation must not steal maintenance')
    assert.equal(read(database,db=>pendingUpgradeProfiles(db).size),1)
    assert.equal(hash(await readFile(profileFile)),observedHash)
    await command('explicit-reconcile',resolve('scripts/qa-owned-upgrade.ps1'),['-InstallRoot',install,'-Workspace',prepared,'-Mode','RECONCILE','-AdoptionId',result.interruptedIntent.id,'-RecoverMaintenance'])
    assert.equal(read(database,db=>pendingUpgradeProfiles(db).size),0)
    assert.equal(read(database,db=>readStorageAdmission(db)!.phase),'OPEN')
    assert.deepEqual(read(database,db=>({checkpoint:db.prepare('SELECT * FROM channel_checkpoints').all(),asRun:db.prepare('SELECT * FROM as_run ORDER BY rowid').all()})),beforeReconcile)
    assert.equal(hash(await readFile(profileFile)),observedHash)
    const {installationVault}=await import('../apps/server/src/domain/secret-vault.js')
    const journal=read(database,db=>db.prepare("SELECT kind,payload FROM operator_decisions WHERE kind LIKE 'UPGRADE_PROFILE_%' ORDER BY rowid").all()).map((row:any)=>({kind:row.kind,value:JSON.parse(installationVault(false).decrypt(row.payload,'operator_decisions.payload'))}))
    assert.equal(journal.length,2)
    const terminal=journal[1].value,expected=observedHash===result.interruptedIntent.candidateHash?'UPGRADE_PROFILE_CONFIRMED':'UPGRADE_PROFILE_REFUSED'
    assert.equal(terminal.phase,expected);assert.equal(terminal.reconciliation,'OBSERVED_FILE_ONLY');assert.equal(terminal.historicalPublicationAckKnown,false)
    result.reconciliation={phase:expected,observedProfileHash:observedHash,recoveryExplicit:true,withoutReleaseRefused:true,noPendingIntents:true,noProfileWrite:true,checkpointAndAsRunPreserved:true,historicalPublicationAckKnown:false}
    result.result='PASS'
  }else{
  if(!captureReturnBackup){
  await start('STAGE')
  const staged=await request('/api/health'),stagedProcesses=await request('/api/processes')
  assert.equal(staged.nativeEngines,0);assert.ok(!stagedProcesses.processes.some((row:any)=>['ENGINE','MEDIAMTX'].includes(row.kind)&&row.state==='running'))
  await request('/api/channels/qa/transport',{action:'take'},409)
  assert.deepEqual(read(database,db=>JSON.parse(db.prepare('SELECT payload FROM channel_checkpoints WHERE channel_id=?').get('qa').payload)),checkpoint)
  assert.deepEqual(read(database,db=>db.prepare('SELECT * FROM as_run ORDER BY rowid').all()),original.as_run)
  assert.equal(hash(await readFile(profileFile)),hash(priorProfile))
  result.stage={backendAdmitted:true,checkpointPreserved:true,asRunPreserved:true,noNativeEngine:true,takeRefused:true,profileUnchanged:true}
  await stopCurrent('stage') // Deliberate own-process interruption, not normal shutdown.
  const recovery=await run(join(install,'runtime/node/node.exe'),[join(install,'apps/server/dist/recover-restored-reservation.cjs'),'--database',database,'--manifest',manifest,'--vault-file',vault],{env:{...env,RPLAYOUT_INSTALL_ROOT:install},cwd:install,windowsHide:true,timeout:60000,maxBuffer:32768})
  await writeFile(join(directory,'recovery.log'),recovery.stdout+'\n'+recovery.stderr)
  result.reservationRecovery=JSON.parse(recovery.stdout);assert.equal(result.reservationRecovery.stage,'RESERVATION_RELEASED_NOT_ACTIVATED')
  }
  await start('ACTIVATE',true)
  await wait('Recovered file in native PGM',async()=>{const view=await request('/api/rundowns/rd');return view.live.transport.onAir?.itemId===source.item&&view.live.transport.mode==='NATIVE'},30000)
  const restored=await request('/api/rundowns/rd');result.restoredTransport=restored.live.transport
  assert.equal(hash(await readFile(profileFile)),hash(await readFile(join(prepared,'installation-profile.candidate.json'))))
  await writeFile(join(directory,'adopted-profile.json'),await readFile(profileFile))
  const checkpointNow=read(database,db=>JSON.parse(db.prepare('SELECT payload FROM channel_checkpoints WHERE channel_id=?').get('qa').payload))
  assert.equal(checkpointNow.executionId,checkpoint.executionId);assert.equal(checkpointNow.itemId,source.item);assert.equal(checkpointNow.revisionId,checkpoint.revisionId)
  const activation=read(database,db=>JSON.parse(db.prepare('SELECT payload FROM restored_activation_runs ORDER BY rowid DESC LIMIT 1').get().payload))
  assert.equal(activation.phase,'CONFIRMED');assert.ok(activation.resumedChannels.includes('qa'))
  await request('/api/channels/qa/watching',{bus:'mon'})
  let heartbeatBusy=false
  heartbeat=setInterval(()=>{if(heartbeatBusy)return;heartbeatBusy=true;void request('/api/channels/qa/watching',{bus:'mon'}).catch(error=>{result.heartbeatError=String(error)}).finally(()=>{heartbeatBusy=false})},5000)
  await wait('Restored monitor actually publishes both tracks',async()=>{
    const response=await fetch('http://127.0.0.1:9997/v3/paths/get/'+restored.monitors.program,{signal:AbortSignal.timeout(3000)})
    if(!response.ok)return false
    const path=await response.json() as any;return path.ready&&path.tracks?.includes('H264')&&path.tracks?.includes('Opus')
  },30000)
  const outcomes=await Promise.allSettled([verifyPublishedPicture({gstBin,directory,path:restored.monitors.program,width:320,height:180,environment:env,label:'upgrade-restored',videoOnly:true}),verifyPublishedAudio({gstBin,directory,path:restored.monitors.program,environment:env,label:'upgrade-restored',expectedHz:997})])
  for(const outcome of outcomes)if(outcome.status==='rejected')throw outcome.reason
  result.captures=outcomes.map(row=>(row as PromiseFulfilledResult<any>).value)
  const restoredAsRun=read(database,db=>db.prepare('SELECT * FROM as_run ORDER BY rowid').all())
  // A restored occurrence keeps its execution ID, but MUST split the as-run:
  // close the authenticated dead predecessor as RESTART, then open a native
  // segment at the saved cursor. One continuous row would hide the downtime.
  assert.equal(restoredAsRun.length,original.as_run.length+1,'Resume must add exactly one segment, not duplicate open PGM')
  for(const [index,row]of restoredAsRun.slice(0,-1).entries()){
    const previous=original.as_run[index]
    for(const key of ['id','item_id','revision_id','media_hash','execution_kind','start_position_frames','started_at'])assert.equal(row[key],previous[key],key+' changed during resume')
    assert.equal(row.ended_by,'RESTART');assert.ok(row.ended_at)
  }
  const resumed=restoredAsRun.at(-1)!
  assert.equal(resumed.item_id,checkpoint.itemId);assert.equal(resumed.revision_id,checkpoint.revisionId)
  assert.equal(resumed.start_position_frames,checkpoint.elapsed);assert.equal(resumed.execution_kind,'NATIVE');assert.equal(resumed.ended_at,null)
  assert.equal(restoredAsRun.filter((row:any)=>row.ended_at===null).length,1)
  result.restoredAsRun=restoredAsRun;result.originalCheckpoint=checkpoint
  result.activation={...activation,checkpoint:checkpointNow,adoptedProfile:true}
  if(captureReturnBackup){
    assert.notEqual(source.hashes.server,installedServerHash)
    // The online snapshot necessarily contains its OWN producer's CHECKING
    // intent (READY is recorded only after that snapshot is fully verified).
    // This inherited gate must be explicitly reconciled; never clear it with
    // SQL, auto-retry its UUID or bypass a live/unknown creator.
    const inheritedId=source.upgradeBackup.requestId
    const inherited=await request('/api/backups/upgrade/'+inheritedId)
    assert.equal(inherited.phase,'UNCERTAIN')
    const reconciled=await request('/api/backups/upgrade/'+inheritedId+'/reconcile',{confirm:true})
    assert.equal(reconciled.phase,'REFUSED')
    assert.equal((await request('/api/backups/upgrade/'+inheritedId)).phase,'REFUSED')
    result.inheritedBackupReconciliation={requestId:inheritedId,initialPhase:inherited.phase,finalPhase:reconciled.phase,explicitConfirmation:true,noReplay:true}
    const created=await request('/api/channels/qa/rundowns',{date:'2099-12-31',name:'Criada APÓS upgrade — ação Çãó '+randomUUID()})
    result.postUpgradeRundown=read(database,db=>db.prepare('SELECT * FROM rundowns WHERE id=?').get(created.rundown.id))
    assert.ok(result.postUpgradeRundown);assert.equal(original.rundowns.some((row:any)=>row.id===created.rundown.id),false)
    const liveBefore=await request('/api/rundowns/rd'),requestId=randomUUID()
    result.returnBackupRequestId=requestId
    await request('/api/backups/upgrade',{requestId})
    await wait('New edition exports latest state while PGM remains running',async()=>{
      result.returnBackup=await request('/api/backups/upgrade/'+requestId)
      assert.ok(['CHECKING','READY'].includes(result.returnBackup.phase))
      return result.returnBackup.phase==='READY'
    },30000)
    assert.equal(hash(await readFile(result.returnBackup.file)),result.returnBackup.sha256)
    assert.deepEqual(await request('/api/backups/upgrade',{requestId}),result.returnBackup)
    const liveAfter=await request('/api/rundowns/rd')
    assert.equal(liveAfter.live.transport.onAir.itemId,liveBefore.live.transport.onAir.itemId)
    assert.equal(liveAfter.live.transport.onAir.startedAt,liveBefore.live.transport.onAir.startedAt)
    const exported=read(result.returnBackup.file,db=>({journal:db.pragma('journal_mode',{simple:true}),rundown:db.prepare('SELECT * FROM rundowns WHERE id=?').get(created.rundown.id),asRun:db.prepare('SELECT * FROM as_run ORDER BY rowid').all()}))
    assert.equal(exported.journal,'delete');assert.deepEqual(exported.rundown,result.postUpgradeRundown)
    assert.equal(exported.asRun.length,2);assert.equal(exported.asRun.filter((row:any)=>row.ended_at===null).length,1)
    result.returnScenario={sourceInstallation:source.root,sourceServerHash:source.hashes.server,upgradedInstallation:install,upgradedServerHash:installedServerHash,latestBackupRequestId:requestId,newEditorialDataViaApi:true,pgmPreservedDuringBackup:true}
  }
  result.result='PASS'
  }
}catch(error){failure=error;result.error=String(error);throw error}
finally{
  if(heartbeat)clearInterval(heartbeat)
  try{await stopCurrent('final')}catch(error){result.result='FAIL';result.stopError=String(error)}
  for(const wrapper of wrappers)if(wrapper.exitCode===null&&wrapper.signalCode===null)await stopped(wrapper)
  const allStopped=[...ownedPids].every(pid=>!alive(pid))
  const remaining=await inspect();result.ownedFamilyStopped=allStopped&&remaining.length===0
  if(result.ownedFamilyStopped){await writeFile(profileFile,priorProfile);result.qaProfileRestored=hash(await readFile(profileFile))===hash(priorProfile)}
  else {result.result='FAIL';result.teardownError='Live descendants remain; profile preserved, no historical PID killed'}
  for(const [index,wrapper]of wrappers.entries())await writeFile(join(directory,'wrapper-'+index+'.log'),logs.get(wrapper)??'')
  result.physicalInputsValidated=false;result.cleanWindowsValidated=false;result.rollbackValidated=false
  await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({result:result.result,directory,error:result.error,ownedFamilyStopped:result.ownedFamilyStopped}))
  if(result.result!=='PASS'&&!failure)throw new Error(result.stopError??result.teardownError)
}
