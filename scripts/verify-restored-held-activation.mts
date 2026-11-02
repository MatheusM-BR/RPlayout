import assert from 'node:assert/strict'
import {execFile,spawn} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import Database from '../apps/server/node_modules/better-sqlite3/lib/index.js'
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(root,'scratch','restored-held-activation-'))
const gst=process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64??'C:/Program Files/gstreamer/1.0/msvc_x86_64'
const run=promisify(execFile)
const partialRelease=process.argv.includes('--fail-second-release')
const worker=await run(process.execPath,['--import',pathToFileURL(join(root,'apps/server/node_modules/tsx/dist/loader.mjs')).href,join(root,'scripts/verify-held-runtime.mts'),'--capture-held-backup',...(partialRelease?['--capture-two-held']:[])],{cwd:root,windowsHide:true,timeout:60000,maxBuffer:4*1024*1024})
const captured=JSON.parse(worker.stdout);assert.equal(captured.passed,true)
for(const pid of [captured.sourcePid,...(captured.sourceEnginePids??[captured.sourceEnginePid])]){
 let gone=false;try{process.kill(pid,0)}catch(error){gone=(error as NodeJS.ErrnoException).code==='ESRCH'}
 assert.ok(gone,'Captured source process still exists; never kill a historical PID')
}
Object.assign(process.env,{RPLAYOUT_ENGINE:join(root,'apps/engine/target/debug/rplayout-engine.exe'),RPLAYOUT_ENGINE_OUTPUT:'null',RPLAYOUT_HOST_GUARD:join(root,'apps/engine/target/release/rplayout-host-guard.exe'),RPLAYOUT_VAULT_FILE:join(captured.directory,'vault.json'),RPLAYOUT_MEDIAMTX:'',RPLAYOUT_RELAY:'',RPLAYOUT_DEVICES:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_BACKUP_HOURS:'0',PATH:join(gst,'bin')+';'+process.env.PATH,GST_PLUGIN_PATH:join(gst,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gst,'lib/gstreamer-1.0'),GST_PLUGIN_SCANNER:join(gst,'libexec/gstreamer-1.0/gst-plugin-scanner.exe'),GST_REGISTRY:join(directory,'registry.bin')})
delete process.env.RPLAYOUT_VAULT_KEY
Object.assign(process.env,{RPLAYOUT_MEDIA:captured.directory,RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_CACHE_DIR:join(directory,'cache'),RPLAYOUT_BACKUP_DIR:join(directory,'backups')})
const {restoreBackupToNewDirectory}=await import('../apps/server/src/domain/backup-restore.js')
const {activateRestoredApp}=await import('../apps/server/src/domain/activate-restored-app.js')
const {Checkpoints}=await import('../apps/server/src/domain/checkpoints.js')
const {readRestoredActivations}=await import('../apps/server/src/db/restored-activations.js')
const {EngineTransport}=await import('../apps/server/src/domain/engine.js')
const {LocalRestoredEngineLease}=await import('../apps/server/src/domain/local-restored-engine-lease.js')
const {readExecutionOwner}=await import('../apps/server/src/db/execution-ownership.js')
const failRelease=process.argv.includes('--fail-before-release')
const failAfterRelease=process.argv.includes('--fail-after-release')
const denyRenewal=process.argv.includes('--deny-renewal')
const crashAfterRelease=process.argv.includes('--crash-after-release')
const crashBeforeSpawn=process.argv.includes('--crash-before-spawn')
const destination=join(directory,'restored')
await restoreBackupToNewDirectory({backup:captured.backupEvidence.file,destination,vaultFile:process.env.RPLAYOUT_VAULT_FILE})
let app:Awaited<ReturnType<typeof activateRestoredApp>>|null=null,result:Record<string,unknown>={passed:false,directory}
const originalRelease=EngineTransport.prototype.releaseProgramOutputs
const originalGrant=LocalRestoredEngineLease.prototype.grant
let renewalStopped=false,fenceExit:unknown=null
try{
 if(denyRenewal)LocalRestoredEngineLease.prototype.grant=function(owner,nonce){if(renewalStopped)return Promise.reject(new Error('Own fixture denies local renewal'));return originalGrant.call(this,owner,nonce)}
 if(crashAfterRelease||crashBeforeSpawn){
  const child=spawn(process.execPath,['--import',pathToFileURL(join(root,'apps/server/node_modules/tsx/dist/loader.mjs')).href,join(root,'scripts/held-activation-crash-worker.mts'),join(destination,'service.db'),join(destination,'restore-quarantine.json'),...(crashBeforeSpawn?['--before-spawn']:[])],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:process.env})
  let logs='',buffer=''
  child.stderr.on('data',chunk=>logs=(logs+String(chunk)).slice(-8000))
  const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})))
  try{
   const marker=await new Promise<{pid:number;enginePid?:number;guardPid:number;proof?:unknown}>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Own worker receipt not observed '+logs)),30000)
    child.once('error',error=>{clearTimeout(timer);reject(error)})
    child.once('exit',()=>{clearTimeout(timer);reject(new Error('Worker ended before receipt '+logs))})
    child.stdout.on('data',chunk=>{buffer+=String(chunk);let end:number;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{const value=JSON.parse(line);if(value.stage===(crashBeforeSpawn?'SPAWN_RESERVED':'RELEASE_RECEIPT')){clearTimeout(timer);resolve(value)}}catch{}}})
   })
   assert.equal(marker.pid,child.pid)
   child.kill('SIGKILL');await exited
   assert.ok(marker.guardPid)
   for(const pid of [marker.enginePid,marker.guardPid].filter((pid):pid is number=>typeof pid==='number')){
    const deadline=Date.now()+10000;let gone=false
    while(Date.now()<deadline&&!gone){try{process.kill(pid,0)}catch(error){gone=(error as NodeJS.ErrnoException).code==='ESRCH'}if(!gone)await new Promise(resolve=>setTimeout(resolve,50))}
    assert.ok(gone,'Own worker engine/guard still exists; no historical PID will be killed')
   }
   const db=new Database(join(destination,'service.db'),{readonly:true,fileMustExist:true})
   try{
    const activation=readRestoredActivations(db).at(-1)!,checkpoint=new Checkpoints(db).read('held')!
    assert.equal(activation.phase,'STARTING');assert.equal(activation.originTable,null)
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='ha_recovery_origin'").get())
    assert.equal(checkpoint.elapsed,captured.saved.elapsed);assert.equal(checkpoint.programHold?.status,'HELD')
    assert.equal(db.prepare("SELECT count(*) n FROM operator_decisions WHERE kind='RESTORED_OUTPUT_RELEASE_ATTEMPTED'").get()!.n,crashBeforeSpawn?0:1)
    assert.equal(db.prepare("SELECT count(*) n FROM operator_decisions WHERE kind='RESTORED_OUTPUT_RELEASE_CONFIRMED'").get()!.n,0)
    if(crashBeforeSpawn){
      const {drizzle}=await import('../apps/server/node_modules/drizzle-orm/better-sqlite3/index.js')
      const {ExecutionOwnership}=await import('../apps/server/src/domain/execution-ownership.js')
      const own=new ExecutionOwnership(drizzle(db))
      assert.equal(own.status('held').diagnostic.code,'SPAWN_UNCONFIRMED')
      assert.throws(()=>own.claim('held'));assert.equal(readExecutionOwner(db,'held')?.spawning,true)
    }
    result={passed:true,directory,activation,checkpoint,marker,sourceExitObserved:true,crashedWorkerExitObserved:true,pendingSpawnProtected:crashBeforeSpawn,nativeEngineGone:!crashBeforeSpawn,scope:'Abrupt own Node crash '+(crashBeforeSpawn?'after spawn reservation before PID callback':'after native release before receipt persisted')+'; STARTING/origin retained, Null output, not host power loss'}
   }finally{db.close()}
   let retryRefusal=''
   await assert.rejects(activateRestoredApp(join(destination,'service.db'),join(destination,'restore-quarantine.json')),error=>{
    retryRefusal=error instanceof Error?error.message:String(error)
    return retryRefusal==='Admissão não está livre; reserva não será substituída.'||retryRefusal==='Tentativa anterior de ativação não concluída.'
   })
   const afterRetry=new Database(join(destination,'service.db'),{readonly:true,fileMustExist:true})
   try{assert.equal(readRestoredActivations(afterRetry).at(-1)?.phase,'STARTING');assert.ok(afterRetry.prepare("SELECT name FROM sqlite_master WHERE name='ha_recovery_origin'").get())}finally{afterRetry.close()}
   result={...result,retryRefused:true,retryRefusal}
  }finally{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited}}
 }else if(failRelease||failAfterRelease||partialRelease||denyRenewal){
  let attempted=0
  let nativeProof:unknown=null
  EngineTransport.prototype.releaseProgramOutputs=async function(authorize,paused){
   attempted++
   if(denyRenewal){
    const child=(this as unknown as {child:import('node:child_process').ChildProcess}).child
    renewalStopped=true
    fenceExit=await new Promise<{pid:number|undefined;code:number|null;signal:NodeJS.Signals|null}>((resolve,reject)=>{
     const timer=setTimeout(()=>reject(new Error('Native lease did not expire within fixture deadline')),8000)
     child.once('exit',(code,signal)=>{clearTimeout(timer);resolve({pid:child.pid,code,signal})})
    })
    assert.equal((fenceExit as {code:number|null}).code,75)
   }
   if(partialRelease&&attempted===1){nativeProof=await originalRelease.call(this,authorize,paused);return nativeProof as Awaited<ReturnType<typeof originalRelease>>}
   if(failAfterRelease)nativeProof=await originalRelease.call(this,authorize,paused)
   throw new Error('Own fixture refused '+(failAfterRelease?'after':'before')+' native output dispatch')
  }
  await assert.rejects(activateRestoredApp(join(destination,'service.db'),join(destination,'restore-quarantine.json')),/Own fixture refused/)
  assert.equal(attempted,partialRelease?2:1)
  const db=new Database(join(destination,'service.db'),{readonly:true,fileMustExist:true})
  try{
   const activation=readRestoredActivations(db).at(-1)!,checkpoint=new Checkpoints(db).read('held')!
   assert.equal(activation.phase,'FAILED');assert.equal(activation.originTable,null)
   assert.ok(activation.message?.includes('não equivale a rollback'))
   assert.equal(db.prepare("SELECT count(*) n FROM operator_decisions WHERE kind='RESTORED_OUTPUT_RELEASE_ATTEMPTED'").get()!.n,partialRelease?2:1)
   assert.equal(db.prepare("SELECT count(*) n FROM operator_decisions WHERE kind='RESTORED_OUTPUT_RELEASE_CONFIRMED'").get()!.n,partialRelease?1:0)
   if(failAfterRelease||partialRelease)assert.ok(nativeProof)
   assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='ha_recovery_origin'").get())
   assert.equal(checkpoint.elapsed,captured.saved.elapsed);assert.equal(checkpoint.programHold?.status,'HELD')
   assert.deepEqual(readExecutionOwner(db,'held')?.enginePids,[])
   if(partialRelease){const second=new Checkpoints(db).read('held-second')!;assert.equal(second.elapsed,captured.secondSaved.elapsed);assert.equal(second.programHold?.status,'HELD');assert.deepEqual(readExecutionOwner(db,'held-second')?.enginePids,[])}
   result={passed:true,directory,activation,checkpoint,nativeProof,fenceExit,partialRelease,originPreserved:true,nativeProcessesReleased:true,scope:'Actual HELD restore with fixture fault '+(denyRenewal?'denying renewal, native expiry before':partialRelease?'on second channel after first admitted':failAfterRelease?'after':'before')+' output dispatch; intent persisted, no false rollback, Null output, no crash qualification'}
  }finally{db.close()}
 }else{
 app=await activateRestoredApp(join(destination,'service.db'),join(destination,'restore-quarantine.json'))
 const runtime=app.runtimes.get('held')!;assert.ok(runtime?.transport instanceof EngineTransport)
 const checkpoint=new Checkpoints(app.sqlite).read('held')!
 assert.equal(checkpoint.programHold?.status,'HELD');assert.equal(checkpoint.elapsed,captured.saved.elapsed)
 assert.deepEqual(checkpoint.programTrim,captured.saved.programTrim);assert.equal(checkpoint.executionId,captured.saved.executionId)
 assert.equal(runtime.transport.health().programAdmission?.held,false)
 await new Promise(resolve=>setTimeout(resolve,1500))
 assert.equal(runtime.transport.state().playing,false);assert.equal(runtime.transport.state().onAir?.elapsed,captured.saved.elapsed)
 const activation=readRestoredActivations(app.sqlite).at(-1)!
 assert.equal(activation.phase,'CONFIRMED')
 assert.deepEqual(activation.resumedChannels,['held'])
 const outputReleaseAudit={attempted:app.sqlite.prepare("SELECT count(*) n FROM operator_decisions WHERE kind='RESTORED_OUTPUT_RELEASE_ATTEMPTED'").get()!.n,confirmed:app.sqlite.prepare("SELECT count(*) n FROM operator_decisions WHERE kind='RESTORED_OUTPUT_RELEASE_CONFIRMED'").get()!.n}
 assert.deepEqual(outputReleaseAudit,{attempted:1,confirmed:1})
 result={passed:true,directory,capturedDirectory:captured.directory,checkpoint,activation,outputReleaseAudit,cursorStable:true,scope:'Actual native HELD backup copy restored and explicitly activated; Null output, no browser/hardware/physical publication'}
 }
}catch(error){result={...result,passed:false,error:String(error)};throw error}
finally{EngineTransport.prototype.releaseProgramOutputs=originalRelease;LocalRestoredEngineLease.prototype.grant=originalGrant;if(app)await app.close();await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result))}
