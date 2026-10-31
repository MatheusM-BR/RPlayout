import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import {createHash} from 'node:crypto'

// Existing data/hash/exit observations only; no new worker, request replay,
// repair, WAL cleanup or journal-mode change. Cannot reconstruct RPC ordering.
assert.equal(process.argv.length,4)
const root=fileURLToPath(new URL('..',import.meta.url)),directory=resolve(process.argv[2]!),binaries=resolve(process.argv[3]!)
assert.ok(directory.startsWith(join(root,'scratch','RPlayout-storage-process-')))
assert.ok(binaries.startsWith(join(root,'scratch','host-history-r88-')))
const report=JSON.parse(await readFile(join(directory,'result.json'),'utf8'))
assert.equal(report.status,'PASS');assert.equal(report.directory,directory)
assert.equal(report.ownedStorageProcessesStopped,true)
assert.equal(report.storage.mode,'PROCESS');assert.equal(report.storage.automaticReplay,false);assert.equal(report.storage.automaticReconnect,false)
for(const field of ['hardwareValidated','loadValidated','pgmRecoveryValidated','installedPackageValidated','multiuserAuthorityValidated'])assert.equal(report[field],false)
assert.equal(report.ownedStoragePids.length,2);assert.equal(new Set(report.ownedStoragePids).size,2)
for(const pid of report.ownedStoragePids){
  assert.ok(Number.isSafeInteger(pid)&&pid>0&&pid<=0xffffffff);assert.notEqual(pid,process.pid)
  let gone=false;try{process.kill(pid,0)}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')gone=true;else throw error}
  assert.ok(gone,'Historical own PID now exists/was reused; refuse instead of terminating it')
}
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
for(const name of ['storage-bridge.cjs','storage-service.cjs'])assert.equal(hash(await readFile(join(binaries,name))),report.hashes[name])
const sourceFile=join(directory,'EXIBIÇÃO-ÇÃO.db'),backupFile=join(directory,'backup.db')
const before=await Promise.all([sourceFile,backupFile].map(async path=>hash(await readFile(path))))
const SQLite=createRequire(new URL('../apps/server/package.json',import.meta.url))('better-sqlite3')
const source=new SQLite(sourceFile,{readonly:true,fileMustExist:true}),backup=new SQLite(backupFile,{readonly:true,fileMustExist:true})
let tableCount=0
try{
  for(const db of [source,backup]){assert.equal(db.pragma('integrity_check',{simple:true}),'ok');assert.deepEqual(db.pragma('foreign_key_check'),[])}
  const schema="SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name"
  assert.deepEqual(backup.prepare(schema).all(),source.prepare(schema).all())
  for(const {name}of source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()){
    const sql='SELECT * FROM "'+String(name).replaceAll('"','""')+'"'
    assert.deepEqual(backup.prepare(sql).all(),source.prepare(sql).all(),name);tableCount++
  }
  assert.deepEqual(source.prepare('SELECT * FROM fixture_values').all(),[{id:'committed',value:3}])
  assert.equal(source.prepare("SELECT name FROM channels WHERE id='fixture'").get().name,'EXIBIÇÃO-ÇÃO')
}finally{source.close();backup.close()}
assert.deepEqual(await Promise.all([sourceFile,backupFile].map(async path=>hash(await readFile(path)))),before)
const result={status:'PASS',scope:'Independent readonly persisted data/schema/binary hashes and current exit observations; not independent reconstruction of RPC ordering or native operational qualification',directory,tableCount,allLogicalTablesAndSchemaMatch:true,sourceAndBackupMainBytesUnchanged:true,rolledBackRowAbsent:true,refusedWriteNotPersisted:true,unicodeDataPreserved:true,ownedStorageProcessesStillAbsent:true,workerHashes:report.hashes,sourceRpcLatency:report.storage.latency,installedPackageValidated:false,multiuserAuthorityValidated:false,pgmRecoveryValidated:false,loadValidated:false}
await writeFile(join(directory,'assertions-storage-process.json'),JSON.stringify(result,null,2))
console.log(JSON.stringify({status:'PASS',directory,tableCount,ownedStorageProcessesStillAbsent:true}))
