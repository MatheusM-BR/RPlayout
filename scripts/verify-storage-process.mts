import assert from 'node:assert/strict'
import {mkdtemp,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'

// Consolidated verification fixture; added now, not evidence until executed.
// Only own temporary databases and directly owned worker/IPC handles. No PGM,
// live device, release database, external server or historical PID is touched.
const directory=await mkdtemp(join(process.env.RPLAYOUT_EVIDENCE_ROOT??tmpdir(),'RPlayout-storage-process-'))
const binaries=resolve(process.env.RPLAYOUT_STORAGE_BIN_DIR??'apps/server/dist')
process.env.RPLAYOUT_STORAGE_BIN_DIR=binaries
process.env.RPLAYOUT_STORAGE_MODE='PROCESS'
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json')
delete process.env.RPLAYOUT_VAULT_KEY
const [{openDatabase},{databaseStorageStatus},{listChannels}]=await Promise.all([
  import('../apps/server/src/db/client.js'),import('../apps/server/src/db/process-database.js'),import('../apps/server/src/db/repo.js'),
])
const file=join(directory,'EXIBIÇÃO-ÇÃO.db')
let first:ReturnType<typeof openDatabase>|null=null,second:ReturnType<typeof openDatabase>|null=null
const ownedPids=new Set<number>()
let result:Record<string,unknown>={status:'FAIL',directory,scope:'Actual compiled private database worker/bridge with project dependencies; not an installed package, multiuser authority, PGM recovery or representative load'},failure:unknown=null
try{
  first=openDatabase(file)
  const active=first
  const status=databaseStorageStatus(first.sqlite)
  assert.equal(status.mode,'PROCESS');assert.notEqual(status.storagePid,process.pid)
  ownedPids.add(status.storagePid)
  first.sqlite.prepare('INSERT INTO channels(id,name,width,height,rate_num,rate_den,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES(?,?,320,180,25,1,-23,-1,5,?)').run('fixture','EXIBIÇÃO-ÇÃO','now')
  assert.equal((await listChannels(first.db))[0]!.name,'EXIBIÇÃO-ÇÃO')
  first.sqlite.exec('CREATE TABLE fixture_values(id TEXT PRIMARY KEY,value INTEGER NOT NULL)')
  first.sqlite.transaction(()=>{
    active.sqlite.prepare('INSERT INTO fixture_values VALUES(?,?)').run('committed',1)
    assert.throws(()=>active.sqlite.transaction(()=>{active.sqlite.prepare('INSERT INTO fixture_values VALUES(?,?)').run('rolled-back',2);throw new Error('owned rollback')}).immediate(),/owned rollback/)
  }).immediate()
  assert.deepEqual(first.sqlite.prepare('SELECT * FROM fixture_values').all(),[{id:'committed',value:1}])
  assert.deepEqual(first.sqlite.prepare('SELECT value FROM fixture_values').raw().get(),[1])
  assert.deepEqual([...first.sqlite.prepare('SELECT * FROM fixture_values').iterate()],[{id:'committed',value:1}])
  second=openDatabase(file)
  const secondStatus=databaseStorageStatus(second.sqlite)
  ownedPids.add(secondStatus.storagePid);assert.notEqual(secondStatus.storagePid,status.storagePid)
  assert.equal((second.sqlite.prepare('SELECT value FROM fixture_values WHERE id=?').get('committed') as {value:number}).value,1)
  first.sqlite.prepare('UPDATE fixture_values SET value=? WHERE id=?').run(3,'committed')
  assert.equal((second.sqlite.prepare('SELECT value FROM fixture_values WHERE id=?').get('committed') as {value:number}).value,3)
  await first.sqlite.backup(join(directory,'backup.db'))
  const SQLite=createRequire(new URL('../apps/server/package.json',import.meta.url))('better-sqlite3')
  const backup=new SQLite(join(directory,'backup.db'),{readonly:true,fileMustExist:true})
  try{
    assert.equal(backup.pragma('integrity_check',{simple:true}),'ok');assert.deepEqual(backup.pragma('foreign_key_check'),[])
    assert.deepEqual(backup.prepare('SELECT * FROM fixture_values').all(),[{id:'committed',value:3}])
    assert.equal(backup.prepare("SELECT name FROM channels WHERE id='fixture'").get().name,'EXIBIÇÃO-ÇÃO')
  }finally{backup.close()}
  // An oversized result poisons the connection; it cannot be automatically
  // reopened and used to repeat a write. Previously durable data stays intact.
  assert.throws(()=>active.sqlite.prepare('SELECT zeroblob(18000000) AS oversized').get(),/limite privado/)
  assert.equal(databaseStorageStatus(first.sqlite).connected,false)
  assert.throws(()=>active.sqlite.prepare('UPDATE fixture_values SET value=4').run(),/indisponível/)
  assert.equal((second.sqlite.prepare('SELECT value FROM fixture_values WHERE id=?').get('committed') as {value:number}).value,3)
  const hashes=Object.fromEntries(await Promise.all(['storage-bridge.cjs','storage-service.cjs'].map(async name=>[name,createHash('sha256').update(await readFile(join(binaries,name))).digest('hex')])))
  result={...result,status:'PASS',storage:databaseStorageStatus(second.sqlite),hashes,unicodePathAndData:true,nestedRollback:true,secondConnectionSeesCommittedWrites:true,backupIntegrityAndData:true,oversizedReplyPoisonsConnection:true,writeAfterPoisonRefused:true,hardwareValidated:false,loadValidated:false,pgmRecoveryValidated:false,installedPackageValidated:false,multiuserAuthorityValidated:false}
}catch(error){failure=error;result={...result,status:'FAIL',error:String(error)};throw error}
finally{
  try{
    second?.sqlite.close();first?.sqlite.close()
    // Read only known own PIDs to confirm exit. A reused PID causes refusal;
    // never signal/kill a historical PID or infer death from a status file.
    const alive=(pid:number)=>{try{process.kill(pid,0);return true}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return false;throw error}}
    const deadline=performance.now()+10000
    while([...ownedPids].some(alive)&&performance.now()<deadline)await new Promise(done=>setTimeout(done,50))
    result.ownedStoragePids=[...ownedPids];result.ownedStorageProcessesStopped=ownedPids.size>0&&[...ownedPids].every(pid=>!alive(pid))
    if(!result.ownedStorageProcessesStopped){result.status='FAIL';result.teardownError='Own storage process exit not confirmed; no unrelated PID will be stopped'}
  }catch(error){result.status='FAIL';result.teardownError=String(error)}
  await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result))
  if(result.status!=='PASS'&&!failure)throw new Error(String(result.teardownError))
}
