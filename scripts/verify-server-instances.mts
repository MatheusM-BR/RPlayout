import assert from 'node:assert/strict'
import {spawn,type ChildProcess} from 'node:child_process'
import {mkdtemp,readFile,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createServer} from 'node:net'
import {createHash} from 'node:crypto'
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(tmpdir(),'RPlayout-server-instances-')),file=join(directory,'instances.db'),children:ChildProcess[]=[],logs=new Map<ChildProcess,string>()
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json')
const {openDatabase}=await import('../apps/server/src/db/client.js'),{readServerInstances}=await import('../apps/server/src/db/server-instances.js'),{serverInstanceStorageStatus}=await import('../apps/server/src/domain/server-instances.js'),{validateBackupRestore}=await import('../apps/server/src/domain/backup.js')
const database=openDatabase(file),env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^RPLAYOUT_|^VITEST$/i.test(key)))
const {StorageMaintenance}=await import('../apps/server/src/domain/storage-maintenance.js'),{readStorageAdmission}=await import('../apps/server/src/db/storage-admission.js')
database.sqlite.exec('CREATE TABLE ha_recovery_origin(id INTEGER PRIMARY KEY,payload TEXT)')
async function start(expectBlocked=false){
  const socket=createServer();await new Promise<void>(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=(socket.address() as {port:number}).port;await new Promise<void>(resolve=>socket.close(()=>resolve()))
  const child=spawn(process.execPath,[join(root,'apps/server/dist/server.cjs')],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...env,RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_VAULT_FILE:join(directory,'vault.json'),RPLAYOUT_DB:file,RPLAYOUT_MEDIA:join(directory,'media'),RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_CACHE:join(directory,'cache'),RPLAYOUT_BACKUPS:join(directory,'backups'),RPLAYOUT_BACKUP_HOURS:'0',RPLAYOUT_ENGINE:'',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_RELAY:'',RPLAYOUT_DEVICES:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:'',HOST:'127.0.0.1',PORT:String(port),LOG_LEVEL:'warn'}})
  children.push(child);logs.set(child,'');for(const stream of [child.stdout,child.stderr])stream?.on('data',chunk=>logs.set(child,((logs.get(child)??'')+String(chunk)).slice(-8000)))
  const deadline=performance.now()+25000
  while(performance.now()<deadline){
    if(expectBlocked){if(child.exitCode!==null||child.signalCode!==null){assert.notEqual(child.exitCode,0);assert.match(logs.get(child)??'',/Banco reservado para manutenção/);return child}}
    else{assert.ok(child.exitCode===null&&child.signalCode===null,logs.get(child));try{if((await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(1000)})).ok)return child}catch{}}
    await new Promise(resolve=>setTimeout(resolve,100))
  }
  throw new Error('Own server startup observation expired '+logs.get(child))
}
async function stop(child:ChildProcess){if(child.exitCode!==null||child.signalCode!==null)return;const ended=new Promise<void>(resolve=>child.once('exit',()=>resolve()));assert.equal(child.kill('SIGKILL'),true);let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([ended,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Own server did not exit')),10000)})])}finally{if(timer)clearTimeout(timer)}}
let result:Record<string,unknown>={result:'FAIL',directory}
try{
  const first=await start(),second=await start(),records=readServerInstances(database.sqlite)
  assert.equal(records.length,2);assert.ok(records.some(row=>row.pid===first.pid));assert.ok(records.some(row=>row.pid===second.pid));assert.equal(new Set(records.map(row=>row.boot)).size,2)
  const before=database.sqlite.prepare('SELECT * FROM server_instances').all(),status=serverInstanceStorageStatus(database.sqlite)
  assert.equal(status.protected,2);assert.equal(status.storageReleaseBlocked,true);assert.equal(status.nativeResourcesStopped,false)
  assert.deepEqual(database.sqlite.prepare('SELECT * FROM server_instances').all(),before)
  await stop(first);assert.equal(serverInstanceStorageStatus(database.sqlite).storageReleaseBlocked,true)
  const backup=join(directory,'backup.db');await database.sqlite.backup(backup);const checked=await validateBackupRestore(backup);assert.equal(checked.tables.server_instances,2)
  await stop(second);assert.deepEqual(database.sqlite.prepare('SELECT * FROM server_instances').all(),before)
  const after=serverInstanceStorageStatus(database.sqlite);assert.equal(after.nativeResourcesStopped,false)
  const lease=new StorageMaintenance(database.sqlite);lease.acquire();lease.assertHeld()
  const reservation=readStorageAdmission(database.sqlite)
  const protectedRows=database.sqlite.prepare('SELECT * FROM server_instances').all()
  await start(true)
  assert.deepEqual(readStorageAdmission(database.sqlite),reservation)
  assert.deepEqual(database.sqlite.prepare('SELECT * FROM server_instances').all(),protectedRows)
  assert.ok(database.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='ha_recovery_origin'").get())
  const reservedBackup=join(directory,'maintenance-backup.db');await database.sqlite.backup(reservedBackup);await validateBackupRestore(reservedBackup)
  lease.release();assert.equal(readStorageAdmission(database.sqlite)?.phase,'OPEN')
  const successor=await start();assert.equal(readServerInstances(database.sqlite).length,3);await stop(successor)
  result={result:'PASS',directory,compiledServerSha256:createHash('sha256').update(await readFile(join(root,'apps/server/dist/server.cjs'))).digest('hex'),twoCompiledConferenceInstancesRecorded:true,distinctSignedEncarnations:true,liveInstancesBlockStorageRelease:true,onePeerExitDoesNotReleaseOther:true,signedRecordsPreservedAfterOwnProcessesExit:true,recordsValidatedInIsolatedBackup:true,readOnlyStatusDoesNotReclassifyRecords:true,maintenanceBlocksCompiledStartupWithoutNewInstance:true,maintenanceBackupValidated:true,leaseHolderReleaseAllowsConferenceSuccessor:true,quarantineMarkerPreserved:true,nativeResourcesStoppedAttested:false,physicalPgmValidated:false,activationPerformed:false}
}catch(error){result={...result,error:String(error)};throw error}
finally{const cleanupErrors:string[]=[];for(const child of children)try{await stop(child)}catch(error){cleanupErrors.push(String(error))};database.sqlite.close();await writeFile(join(directory,'server-logs.json'),JSON.stringify([...logs].map(([child,text])=>({pid:child.pid,text})),null,2));await writeFile(join(directory,'result.json'),JSON.stringify({...result,cleanupErrors},null,2));console.log(JSON.stringify({...result,cleanupErrors}));assert.equal(cleanupErrors.length,0)}
