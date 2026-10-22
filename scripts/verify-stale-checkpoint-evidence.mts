import assert from 'node:assert/strict'
import {readFile,mkdtemp,writeFile,lstat,realpath} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
import type {Db} from '../apps/server/src/db/client.js'

// Existing authenticated artifacts only. No app/runtime, ownership claim,
// native process, cursor rewrite or reconstructed PID termination is allowed.
assert.equal(process.argv.length,3)
const root=fileURLToPath(new URL('..',import.meta.url)),source=resolve(process.argv[2]!)
assert.ok(source.startsWith(join(root,'scratch','normal-pgm-storage-timeout-')))
assert.equal((await lstat(source)).isSymbolicLink(),false)
assert.equal(resolve(await realpath(source)).toLowerCase(),source.toLowerCase())
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
const reportBytes=await readFile(join(source,'result.json')),report=JSON.parse(reportBytes.toString())
assert.equal(report.directory,source);assert.equal(report.result,'PASS')
assert.deepEqual(report.normalCloseProof,{ownedNativeProcessesStopped:true,graceful:true,forceRequested:false})
assert.deepEqual(report.nativeExit,{code:0,signal:null})
const databaseFile=join(source,'Banco-PGM-ação.db')
const snapshot=async()=>{
 const result:Record<string,string|null>={}
 for(const file of[databaseFile,databaseFile+'-wal']){
  try{result[file]=hash(await readFile(file))}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;result[file]=null}
 }
 return result
}
const before=await snapshot()
process.env.RPLAYOUT_VAULT_FILE=join(source,'vault.json');delete process.env.RPLAYOUT_VAULT_KEY
const {readExecutionOwner}=await import('../apps/server/src/db/execution-ownership.js')
const {readServerInstances}=await import('../apps/server/src/db/server-instances.js')
const {Checkpoints}=await import('../apps/server/src/domain/checkpoints.js')
const {ExecutionOwnership}=await import('../apps/server/src/domain/execution-ownership.js')
const SQLite=createRequire(new URL('../apps/server/package.json',import.meta.url))('better-sqlite3')
const sqlite=new SQLite(databaseFile,{readonly:true,fileMustExist:true})
let assessment:unknown
try{
 assert.equal(sqlite.pragma('integrity_check',{simple:true}),'ok');assert.deepEqual(sqlite.pragma('foreign_key_check'),[])
 const channel=report.beforeFault.state.channelId,saved=new Checkpoints(sqlite).read(channel)
 assert.ok(saved?.playing&&saved.realEngine&&saved.ownerRunId)
 const owner=readExecutionOwner(sqlite,channel);assert.ok(owner);assert.equal(owner.id,saved.ownerRunId)
 const instances=readServerInstances(sqlite);assert.equal(instances.length,1);assert.equal(instances[0]!.phase,'OPEN')
 const rows=sqlite.prepare('SELECT ended_at FROM as_run WHERE channel_id=?').all(channel)
 assert.equal(rows.length,1);assert.equal(rows[0].ended_at,null)
 const actualPids=[report.beforeFault.storage.backendPid,report.enginePid,report.marker.proxyPid,report.marker.actualServicePid]
 for(const pid of actualPids){assert.ok(Number.isSafeInteger(pid)&&pid>0);let absent=false;try{process.kill(pid,0)}catch(error){absent=(error as NodeJS.ErrnoException).code==='ESRCH'}assert.equal(absent,true,'Unknown/reused PIDs cannot be assumed stopped')}
 const onAir=report.afterFault.state.onAir
 assert.equal(saved.itemId,onAir.itemId);assert.equal(saved.elapsed,report.beforeFault.state.onAir.elapsed)
 assert.ok(onAir.elapsed>saved.elapsed)
 // status() alone: no claim() or simulated host/death proof. In an identity-
 // restricted environment a historical owner must remain protected.
 const status=new ExecutionOwnership({$client:sqlite} as Db).status(channel)
 assessment={savedFrames:saved.elapsed,observedLaterFrames:onAir.elapsed,observedUnsavedFrames:onAir.elapsed-saved.elapsed,
  rate:saved.rate,secondsBehindObservedCursor:(onAir.elapsed-saved.elapsed)*saved.rate!.den/saved.rate!.num,
  signedOwnerPhase:owner.phase,finalRelease:owner.finalRelease,observationClosed:owner.observationClosed??false,
  signedStoragePhase:instances[0]!.phase,asRunStillOpen:true,status,
  ownPidsAbsent:actualPids,automaticRecoveryOrReplayObserved:false}
}finally{sqlite.close()}
assert.deepEqual(await snapshot(),before)
const directory=await mkdtemp(join(root,'scratch','stale-checkpoint-evidence-'))
const result={result:'PASS',directory,source,sourceReportSha256:hash(reportBytes),scope:'Read-only stale checkpoint evidence, not recovery/replay, physical signal, installed build, host admission or publication qualification',assessment,databaseAndWalBytesUnchanged:true}
await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2),{flag:'wx'})
console.log(JSON.stringify(result))
