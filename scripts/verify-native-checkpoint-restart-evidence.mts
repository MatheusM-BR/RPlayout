import assert from 'node:assert/strict'
import {readFile,mkdtemp,writeFile,lstat,realpath} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
import {assertMovingPublishedGray} from './lib/held-picture-evidence.js'
import {stereoToneStatistics,syntheticToneSpectrum,syntheticToneWindows} from './lib/verify-published-audio.js'

// Independent read-back of successful artifacts. No child process, native
// decoder, HTTP client, repair, execution claim or scenario replay.
assert.equal(process.argv.length,3)
const root=fileURLToPath(new URL('..',import.meta.url)),source=resolve(process.argv[2]!)
assert.ok(source.startsWith(join(root,'scratch','native-checkpoint-restart-')))
assert.equal((await lstat(source)).isSymbolicLink(),false)
assert.equal(resolve(await realpath(source)).toLowerCase(),source.toLowerCase())
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
const reportBytes=await readFile(join(source,'result.json')),report=JSON.parse(reportBytes.toString())
assert.equal(report.directory,source);assert.equal(report.result,'PASS');assert.deepEqual(report.backendExit,{code:0,signal:null});assert.notEqual(report.fixtureForceRequested,true)
assert.equal(hash(await readFile(join(report.binaries,'server.cjs'))),report.serverSha256)
const firstDirectory=resolve(report.phaseOne.directory)
assert.ok(firstDirectory.startsWith(join(root,'scratch','normal-pgm-storage-timeout-')))
assert.equal((await lstat(firstDirectory)).isSymbolicLink(),false);assert.equal(resolve(await realpath(firstDirectory)).toLowerCase(),firstDirectory.toLowerCase())
const firstBytes=await readFile(join(firstDirectory,'result.json')),first=JSON.parse(firstBytes.toString())
assert.equal(hash(firstBytes),report.phaseOne.reportSha256);assert.equal(first.result,'PASS')
assert.deepEqual(first.normalCloseProof,{ownedNativeProcessesStopped:true,graceful:true,forceRequested:false})
assert.ok(first.timeout.blockedMs>=29500);assert.equal(first.timeout.storage.connected,false)
assert.equal(hash(await readFile(join(firstDirectory,'normal-pgm.mkv'))),first.capture.encodedSha256)
for(const [name,key] of [['app','app'],['engine','engine']] as const)assert.equal(hash(await readFile(join(firstDirectory,`control-${name}.source.ts`))),first.controlSourceHashes[key])
const ownPids=[first.beforeFault.storage.backendPid,first.enginePid,first.marker.proxyPid,first.marker.actualServicePid,report.restartedBackendPid,...report.afterAutomaticRecovery.owner.enginePids]
for(const pid of ownPids){assert.ok(Number.isSafeInteger(pid)&&pid>0);let absent=false;try{process.kill(pid,0)}catch(error){absent=(error as NodeJS.ErrnoException).code==='ESRCH'}assert.equal(absent,true,'No PID reuse/unknown absence may certify cleanup')}
process.env.RPLAYOUT_VAULT_FILE=join(firstDirectory,'vault.json');delete process.env.RPLAYOUT_VAULT_KEY
const {readServerInstances}=await import('../apps/server/src/db/server-instances.js')
const {readExecutionOwner,validateExecutionOwnership}=await import('../apps/server/src/db/execution-ownership.js')
const {Checkpoints}=await import('../apps/server/src/domain/checkpoints.js')
const {installationVault}=await import('../apps/server/src/domain/secret-vault.js')
const SQLite=createRequire(new URL('../apps/server/package.json',import.meta.url))('better-sqlite3') as typeof import('../apps/server/node_modules/@types/better-sqlite3/index.js')
const frozen=resolve(report.phaseOneSnapshot.file);assert.equal(frozen,join(source,'phase-one-evidence.db'))
assert.equal(hash(await readFile(frozen)),report.phaseOneSnapshot.sha256)
const live=join(firstDirectory,'Banco-PGM-ação.db')
async function snapshot(){
 const result:Record<string,string|null>={}
 for(const file of[frozen,live,live+'-wal'])try{result[file]=hash(await readFile(file))}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;result[file]=null}
 return result
}
const before=await snapshot()
function inspect(file:string){
 const db=new SQLite(file,{readonly:true,fileMustExist:true})
 try{
  assert.equal(db.pragma('integrity_check',{simple:true}),'ok');assert.deepEqual(db.pragma('foreign_key_check'),[]);validateExecutionOwnership(db)
  return{checkpoint:new Checkpoints(db).read('qa-normal'),owner:readExecutionOwner(db,'qa-normal'),instances:readServerInstances(db),
   rows:db.prepare('SELECT id,ended_at,ended_by,start_position_frames,aired_frames,duration_evidence FROM as_run ORDER BY rowid').all() as any[],
   decisions:(db.prepare("SELECT payload FROM operator_decisions WHERE kind='CHECKPOINT_AUTO_RECOVERY_REQUESTED'").all() as {payload:string}[]).map(row=>JSON.parse(installationVault(false).decrypt(row.payload,'operator_decisions.payload')))}
 }finally{db.close()}
}
const original=inspect(frozen),current=inspect(live)
assert.equal(original.checkpoint!.elapsed,report.phaseOneSnapshot.before.checkpoint.elapsed)
assert.equal(original.owner!.phase,'ACTIVE');assert.equal(original.owner!.finalRelease,false);assert.equal(original.instances.length,1);assert.equal(original.instances[0]!.phase,'OPEN')
assert.equal(original.rows.length,1);assert.equal(original.rows[0].ended_at,null);assert.equal(original.decisions.length,0)
assert.equal(current.rows.length,2);assert.equal(current.rows[0].id,original.rows[0].id)
assert.equal(current.rows[0].ended_by,'RESTART');assert.ok(current.rows[0].ended_at)
assert.equal(current.rows[0].aired_frames,null);assert.equal(current.rows[0].duration_evidence,'UNKNOWN','Do not invent the unpersisted first segment duration')
assert.equal(current.rows[1].start_position_frames,original.checkpoint!.elapsed);assert.equal(current.rows[1].ended_by,'SHUTDOWN');assert.ok(current.rows[1].ended_at)
assert.equal(current.rows[1].duration_evidence,'CLOCK_ESTIMATE','Graceful process exit alone is not an exact native end cursor')
assert.equal(current.owner!.id,report.afterAutomaticRecovery.owner.id);assert.equal(current.owner!.phase,'RELEASED');assert.equal(current.owner!.finalRelease,true);assert.deepEqual(current.owner!.enginePids,[])
assert.equal(current.instances.length,2);assert.equal(current.instances[0]!.phase,'OPEN');assert.equal(current.instances[1]!.phase,'STORAGE_CLOSED')
assert.equal(current.decisions.length,1)
assert.deepEqual(current.decisions,report.afterAutomaticRecovery.decisions.map((value:any)=>value.payload))
assert.equal(current.decisions[0].positionFrames,original.checkpoint!.elapsed);assert.equal(current.decisions[0].operatorConfirmationRequired,false);assert.equal(current.decisions[0].nativeRecoveryConfirmed,false)
const pixels=await readFile(join(source,'recovered.gray')),audio=await readFile(join(source,'recovered.f32')),encoded=await readFile(join(source,'recovered-native.mkv'))
assert.equal(hash(pixels),report.capture.graySha256);assert.equal(hash(audio),report.capture.pcmSha256);assert.equal(hash(encoded),report.capture.encodedSha256)
const size=320*180,frames=pixels.length/size,samples=audio.length/8
assert.equal(frames,report.capture.videoFrames);assert.equal(samples,report.capture.audioFrames)
assert.equal(pixels.length%size,0);assert.equal(audio.length%8,0);assert.ok(frames>=100&&samples>=192000)
const windows=[]
for(const fraction of[0.25,0.5,0.75]){
 const at=Math.floor(frames*fraction),audioAt=Math.floor(samples*fraction)
 const movement=assertMovingPublishedGray(pixels.subarray(at*size,(at+25)*size),320,180)
 const bytes=audio.subarray(audioAt*8,(audioAt+48000)*8),statistics=stereoToneStatistics(bytes),spectrum=syntheticToneSpectrum(bytes),toneWindows=syntheticToneWindows(bytes,spectrum.frequencyHz)
 for(let c=0;c<2;c++)assert.ok(statistics.rms[c]!>0.01&&Math.abs(spectrum.frequencyHz[c]!-997)<15&&toneWindows.concentratedWindows[c]!>=4)
 windows.push({fraction,movement,statistics,spectrum,toneWindows})
}
assert.deepEqual(await snapshot(),before)
const directory=await mkdtemp(join(root,'scratch','native-checkpoint-restart-evidence-'))
const result={result:'PASS',directory,source,sourceReportSha256:hash(reportBytes),scope:'Read-only restart SQL/audit and existing decoded motion/tone artifacts, not exact image seek/PTS, installed/physical/HTTP/restored/HA or full recovery qualification',resumedPositionFrames:original.checkpoint!.elapsed,unpersistedFirstSegmentDurationStillUnknown:true,videoFrames:frames,audioFrames:samples,windows,databaseAndWalBytesUnchanged:true,ownPidsAbsent:ownPids}
await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2),{flag:'wx'})
console.log(JSON.stringify({result:result.result,directory,source,resumedPositionFrames:result.resumedPositionFrames,videoFrames:frames,audioFrames:samples}))
