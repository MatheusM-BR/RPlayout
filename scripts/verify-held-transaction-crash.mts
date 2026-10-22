import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtemp,readFile,writeFile} from 'node:fs/promises'
import {writeFileSync,existsSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

// Production SQLite/ownership/as-run transaction, real abrupt process exit.
// No engine/pixels/hardware: this isolates database crash consistency.
const root=fileURLToPath(new URL('..',import.meta.url))
const worker=process.argv.find(arg=>arg.startsWith('--worker='))
const afterCommit=process.argv.includes('--after-commit')
const directory=worker?resolve(worker.slice(9)):await mkdtemp(join(root,'scratch','held-tx-crash-'))
assert.ok(directory.startsWith(resolve(root,'scratch','held-tx-crash-')))
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json')
const {openDatabase}=await import('../apps/server/src/db/client.js')
const {getChannel}=await import('../apps/server/src/db/repo.js')
const {ExecutionOwnership}=await import('../apps/server/src/domain/execution-ownership.js')
const {Checkpoints}=await import('../apps/server/src/domain/checkpoints.js')
const {AsRun}=await import('../apps/server/src/domain/asrun.js')
const {readExecutionOwner,validateExecutionOwnership}=await import('../apps/server/src/db/execution-ownership.js')
const dbFile=join(directory,'crash.db'),marker=join(directory,'inside-transaction.json')
if(worker){
  const database=openDatabase(dbFile),ownership=new ExecutionOwnership(database.db),lease=ownership.claim('ch')
  const saved=new Checkpoints(database.sqlite).read('ch')!,channel=(await getChannel(database.db,'ch'))!
  const recorder=new AsRun(database.db,channel,'NATIVE',lease)
  const frames=saved.elapsed+(afterCommit?3:0)
  const waitForKill=(point:string)=>{
    writeFileSync(marker,JSON.stringify({pid:process.pid,ownerId:lease.identity.id,point}))
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,15000)
  }
  await recorder.followHeldWithCommit('vt',null,'rev',frames,()=>{
    lease.acknowledgeStoppedPredecessor()
    new Checkpoints(database.sqlite,lease).write({...saved,elapsed:frames,programHold:{status:'HELD',decoderId:8,frames}})
    if(!afterCommit)waitForKill('SQL written, transaction not committed')
  })
  if(afterCommit)waitForKill('transaction committed, application confirmation not delivered')
  throw new Error('Crash fixture was not terminated at requested stage')
}else{
  let database=openDatabase(dbFile)
  database.sqlite.exec("INSERT INTO channels(id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES('ch','Isolated crash fixture',25,1,320,180,-23,-1,5,'now')")
  const ownership=new ExecutionOwnership(database.db),original=ownership.claim('ch'),channel=(await getChannel(database.db,'ch'))!
  await new AsRun(database.db,channel,'NATIVE',original).follow('vt',null,'rev',0)
  const saved={version:1 as const,channelId:'ch',rundownId:'rd',revisionId:'rev',itemId:'vt',elapsed:25,playing:false,realEngine:true,executionId:'database-crash-fixture',programTrim:{in:0,out:75,contentHash:'a'.repeat(64)},programHold:{status:'HELD' as const,decoderId:7,frames:25}}
  const before=new Checkpoints(database.sqlite,original);before.write(saved)
  const checkpoint=before.read('ch')!
  original.finalRelease();database.sqlite.close()
  // Reuse the active TS loader flags, not the CLI wrapper which forks a Node
  // process and would make the observed ChildProcess PID differ from worker.
  const child=spawn(process.execPath,[...process.execArgv,fileURLToPath(import.meta.url),`--worker=${directory}`,...(afterCommit?['--after-commit']:[])],{env:process.env,windowsHide:true,stdio:['ignore','pipe','pipe']})
  let logs='';child.stdout.on('data',data=>{logs+=data});child.stderr.on('data',data=>{logs+=data})
  const exited=new Promise<{code:number|null;signal:NodeJS.Signals|null}>((resolve,reject)=>{child.once('exit',(code,signal)=>resolve({code,signal}));child.once('error',reject)})
  let result:Record<string,unknown>|null=null
  try{
    const deadline=Date.now()+10000
    while(!existsSync(marker)){
      assert.ok(child.exitCode===null&&child.signalCode===null,logs)
      assert.ok(Date.now()<deadline,'worker did not enter transaction: '+logs)
      await new Promise(resolve=>setTimeout(resolve,25))
    }
    const point=JSON.parse(await readFile(marker,'utf8'))
    assert.equal(point.pid,child.pid);assert.equal(child.exitCode,null)
    assert.equal(child.kill('SIGKILL'),true);const exit=await exited
    assert.equal(exit.signal,'SIGKILL')
    database=openDatabase(dbFile)
    const persisted=new Checkpoints(database.sqlite).read('ch')!
    if(afterCommit){
      assert.equal(persisted.ownerRunId,point.ownerId);assert.equal(persisted.elapsed,28);assert.equal(persisted.programHold!.decoderId,8)
      assert.equal(persisted.executionId,checkpoint.executionId)
    }else assert.deepEqual(persisted,checkpoint)
    assert.equal(readExecutionOwner(database.sqlite,'ch')!.predecessorResolved,afterCommit)
    assert.deepEqual(database.sqlite.prepare('SELECT count(*) AS n FROM as_run').get(),{n:afterCommit?2:1})
    assert.deepEqual(database.sqlite.prepare('SELECT count(*) AS n FROM as_run WHERE ended_at IS NULL').get(),{n:1})
    assert.equal(database.sqlite.pragma('integrity_check',{simple:true}),'ok')
    const recoveredOwnership=new ExecutionOwnership(database.db),current=recoveredOwnership.claim('ch')
    assert.equal(current.canRecoverCursorFrom(checkpoint.ownerRunId!),!afterCommit)
    assert.equal(current.canRecoverCursorFrom(persisted.ownerRunId!),true)
    await new AsRun(database.db,channel,'NATIVE',current).followHeldWithCommit('vt',null,'rev',persisted.elapsed,()=>{
      current.acknowledgeStoppedPredecessor()
      new Checkpoints(database.sqlite,current).write({...persisted,programHold:{status:'HELD',decoderId:9,frames:persisted.elapsed}})
    })
    validateExecutionOwnership(database.sqlite)
    const restored=new Checkpoints(database.sqlite).read('ch')!
    assert.equal(restored.ownerRunId,current.identity.id);assert.equal(restored.elapsed,afterCommit?28:25);assert.equal(restored.programHold!.decoderId,9)
    assert.deepEqual(database.sqlite.prepare('SELECT count(*) AS n FROM as_run').get(),{n:afterCommit?3:2})
    assert.deepEqual(database.sqlite.prepare('SELECT count(*) AS n FROM as_run WHERE ended_at IS NULL').get(),{n:1})
    result={passed:true,scope:'real SQLite process-crash and signed ancestry recovery, not native PGM',afterCommit,directory,point,exit,originalCheckpoint:checkpoint,persisted,restored}
    current.finalRelease();recoveredOwnership.close()
    console.log(JSON.stringify(result,null,2))
  }finally{
    if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited}
    await writeFile(join(directory,'result.json'),JSON.stringify(result??{passed:false,logs},null,2))
    if(database.sqlite.open)database.sqlite.close()
  }
}
