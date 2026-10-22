import assert from 'node:assert/strict'
import {spawn,execFile,type ChildProcess} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,readFile,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import {createServer} from 'node:net'
import {createHash} from 'node:crypto'
const root=fileURLToPath(new URL('..',import.meta.url)),[backup,vault]=process.argv.slice(2)
assert.ok(backup&&vault,'Prior own native playing backup and original vault required, read-only inputs')
const directory=await mkdtemp(join(tmpdir(),'RPlayout-reservation-recovery-')),folder=join(directory,'restored'),file=join(folder,'service.db'),manifest=join(folder,'restore-quarantine.json'),run=promisify(execFile)
process.env.RPLAYOUT_VAULT_FILE=vault;delete process.env.RPLAYOUT_VAULT_KEY
const {readStorageAdmission}=await import('../apps/server/src/db/storage-admission.js'),{readRestorationRecords}=await import('../apps/server/src/db/restoration-records.js')
const Database=createRequire(new URL('../apps/server/package.json',import.meta.url))('better-sqlite3'),server=join(root,'apps/server/dist/server.cjs'),tool=join(root,'apps/server/dist/recover-restored-reservation.cjs')
const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^RPLAYOUT_|^VITEST$/i.test(key))),RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_VAULT_FILE:vault,RPLAYOUT_ENGINE:'',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_RELAY:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_DEVICES:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_BACKUP_HOURS:'0',HOST:'127.0.0.1',LOG_LEVEL:'warn'}
let child:ChildProcess|null=null,log='',result:Record<string,unknown>={result:'FAIL',directory}
async function wait(check:()=>boolean|Promise<boolean>){const end=performance.now()+30000;while(performance.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,100))}throw new Error('Own process observation expired '+log)}
async function freePort(){const socket=createServer();await new Promise<void>(resolve=>socket.listen(0,'127.0.0.1',resolve));const p=(socket.address() as {port:number}).port;await new Promise<void>(resolve=>socket.close(()=>resolve()));return p}
function read<T>(work:(db:any)=>T){const db=new Database(file,{readonly:true,fileMustExist:true});try{return work(db)}finally{db.close()}}
const snapshot=()=>read(db=>Object.fromEntries(['channel_checkpoints','execution_owner_runs','as_run','restoration_records','ha_recovery_origin'].map(table=>[table,db.prepare(`SELECT * FROM ${table}`).all()])))
const repairArgs=['--database',file,'--manifest',manifest,'--vault-file',vault]
async function start(){const p=await freePort();child=spawn(process.execPath,['-e',"process.on('message',m=>{if(m==='own-shutdown')process.emit('SIGTERM')});require(process.argv[1])",server,'--stage-restored',manifest],{cwd:folder,env:{...env,PORT:String(p),RPLAYOUT_DB:file,RPLAYOUT_MEDIA:join(directory,'media'),RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_CACHE:join(directory,'cache'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_BACKUPS:join(directory,'backups')},windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});for(const stream of [child.stdout,child.stderr])stream?.on('data',chunk=>log=(log+String(chunk)).slice(-16000));await wait(async()=>{assert.equal(child!.exitCode,null,log);try{return(await fetch(`http://127.0.0.1:${p}/api/health`,{signal:AbortSignal.timeout(1000)})).ok}catch{return false}})}
try{
  await run(process.execPath,[join(root,'apps/server/dist/restore-backup.cjs'),'--backup',backup,'--destination',folder,'--vault-file',vault],{env,timeout:60000,windowsHide:true})
  const before=snapshot();await start()
  const reserved=read(db=>readStorageAdmission(db))!
  assert.equal(reserved.phase,'MAINTENANCE')
  try{await run(process.execPath,[tool,...repairArgs],{env,timeout:30000,windowsHide:true});throw new Error('Live reservation must not be recovered')}catch(error:any){assert.equal(error.code,1);assert.match(error.stderr,/Posse nativa não confirmada/)}
  assert.deepEqual(read(db=>readStorageAdmission(db)),reserved)
  child!.kill('SIGKILL');await wait(()=>child!.exitCode!==null||child!.signalCode!==null)
  assert.equal(read(db=>readStorageAdmission(db))?.phase,'MAINTENANCE')
  try{await run(process.execPath,[server],{cwd:folder,env:{...env,RPLAYOUT_DB:file,PORT:String(await freePort())},timeout:30000,windowsHide:true});throw new Error('Crash must not implicitly reopen maintenance')}catch(error:any){assert.equal(error.code,1);assert.match(error.stderr,/reservado para manutenção/)}
  const report=JSON.parse((await run(process.execPath,[tool,...repairArgs],{env,timeout:30000,windowsHide:true})).stdout.trim())
  assert.equal(report.stage,'RESERVATION_RELEASED_NOT_ACTIVATED');assert.equal(report.activationPerformed,false);assert.equal(report.interruptedActivationFailed,false)
  assert.equal(read(db=>readStorageAdmission(db))?.phase,'OPEN');assert.deepEqual(snapshot(),before)
  assert.equal(read(db=>db.prepare("SELECT count(*) n FROM operator_decisions WHERE kind='RESTORED_RESERVATION_RECOVERED'").get().n),1)
  assert.equal(report.requestId,read(db=>readRestorationRecords(db).at(-1)?.requestId))
  await start();assert.equal(read(db=>readStorageAdmission(db))?.phase,'MAINTENANCE')
  child!.send('own-shutdown');await wait(()=>child!.exitCode!==null||child!.signalCode!==null);assert.equal(child!.exitCode,0,log)
  assert.equal(read(db=>readStorageAdmission(db))?.phase,'OPEN');assert.deepEqual(snapshot(),before)
  result={result:'PASS',directory,compiledRecoverySha256:createHash('sha256').update(await readFile(tool)).digest('hex'),actualNativeHostExclusion:true,liveRepairRefused:true,crashReservationPersisted:true,normalBootstrapRefusedAfterCrash:true,explicitRecoveryAudited:true,originalCursorAndOwnersAndAsRunAndReceiptsAndQuarantinePreserved:true,subsequentStagedAdmissionAndNormalRelease:true,engineStarted:false,takeSent:false,interruptedStartingActivationExercised:false,physicalOutputValidated:false}
}catch(error){result={...result,error:String(error)};throw error}
finally{if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await wait(()=>child!.exitCode!==null||child!.signalCode!==null)}await writeFile(join(directory,'server.log'),log);await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result))}
