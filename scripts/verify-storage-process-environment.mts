import assert from 'node:assert/strict'
import {mkdtemp,copyFile,readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
import {openProcessDatabase,databaseStorageStatus} from '../apps/server/src/db/process-database.js'

const root=fileURLToPath(new URL('..',import.meta.url))
assert.equal(process.argv.length,3)
const binaries=resolve(process.argv[2]!)
assert.ok(binaries.startsWith(join(root,'scratch','host-history-r88-')))
assert.ok(process.execArgv.some(value=>value.endsWith('/storage-environment-worker-probe.mjs')),'Explicit QA observation preload required')
const directory=await mkdtemp(join(root,'scratch','storage-environment-')),file=join(directory,'Banco-ação-Çãó.db')
const canaryKeys=['RPLAYOUT_ADMIN_PASSWORD','RPLAYOUT_VAULT_KEY','RPLAYOUT_CONTROL_TOKEN','RPLAYOUT_OMT_RUNTIME','FUTURE_SECRET','OPENAI_API_KEY','HTTP_PROXY','NODE_OPTIONS']
for(const key of canaryKeys)process.env[key]=key==='NODE_OPTIONS'?'--qa-storage-option-must-not-reach-a-child':'OWN_QA_CANARY_NOT_A_REAL_CREDENTIAL'
process.env.RPLAYOUT_STORAGE_FILE='PARENT_FILE_MUST_NOT_BE_USED'
process.env.RPLAYOUT_STORAGE_BIN_DIR=directory
process.env.NODE_PATH=join(root,'apps/server/node_modules')
await copyFile(join(binaries,'storage-bridge.cjs'),join(directory,'storage-bridge.cjs'))
await copyFile(join(root,'scripts/fixtures/storage-environment-service-probe.cjs'),join(directory,'storage-service.cjs'))
const scope={kind:'RPlayout-storage-environment-qa',ownerPid:process.pid,database:file,realService:join(binaries,'storage-service.cjs'),canaryKeys}
await writeFile(join(directory,'scope.json'),JSON.stringify(scope,null,2))
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
const SQLite=createRequire(new URL('../apps/server/package.json',import.meta.url))('better-sqlite3') as typeof import('../apps/server/node_modules/@types/better-sqlite3/index.js')
let db:ReturnType<typeof openProcessDatabase>|null=null,failure:unknown=null
const result:Record<string,any>={result:'FAIL',directory,binaries,scope:'Actual source ProcessDatabase and compiled bridge/service; declared Worker preload and same-process compiled-service entry loader observe key presence only, without a proxy/fork; not installed server, PGM, HTTP or general SQLite qualification',noSecretsLogged:true}
const read=async(name:string)=>JSON.parse(await readFile(join(directory,name),'utf8'))
const alive=(pid:number)=>{try{process.kill(pid,0);return true}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return false;throw error}}
try{
  db=openProcessDatabase(file);result.storage=databaseStorageStatus(db)
  const worker=await read('worker-environment.json'),service=await read('service-environment.json')
  assert.equal(worker.pid,process.pid);assert.ok(worker.threadId>0)
  assert.deepEqual(worker.canaries,Object.fromEntries(canaryKeys.map(key=>[key,false])))
  assert.deepEqual(service.canaries,worker.canaries);assert.equal(worker.parentStorageFileInherited,false);assert.equal(service.correctDatabase,true)
  assert.notEqual(service.loaderPid,process.pid);assert.equal(service.realPid,service.loaderPid);assert.equal(service.directCompiledModule,true)
  assert.equal(result.storage.storagePid,service.realPid)
  assert.equal(service.realServiceHash,hash(await readFile(scope.realService)))
  assert.equal(hash(await readFile(join(directory,'storage-bridge.cjs'))),hash(await readFile(join(binaries,'storage-bridge.cjs'))))
  for(const observation of[worker,service]){assert.ok(observation.runtimeKeys.includes('NODE_PATH'));assert.ok(observation.runtimeKeys.includes('PATH'))}
  db.exec('CREATE TABLE qa_environment(id INTEGER PRIMARY KEY,value TEXT NOT NULL)')
  db.prepare('INSERT INTO qa_environment VALUES(?,?)').run(1,'Exibição-ação-Çãó')
  const active=db
  assert.throws(()=>active.transaction(()=>{active.prepare('INSERT INTO qa_environment VALUES(?,?)').run(2,'rolled-back');throw new Error('own QA rollback')})(),/own QA rollback/)
  assert.deepEqual(db.prepare('SELECT * FROM qa_environment').all(),[{id:1,value:'Exibição-ação-Çãó'}])
  const backup=join(directory,'backup.db');await db.backup(backup)
  const copy=new SQLite(backup,{readonly:true,fileMustExist:true})
  try{assert.equal(copy.pragma('integrity_check',{simple:true}),'ok');assert.deepEqual(copy.prepare('SELECT * FROM qa_environment').all(),[{id:1,value:'Exibição-ação-Çãó'}]);assert.deepEqual(copy.pragma('foreign_key_check'),[])}finally{copy.close()}
  result.worker=worker;result.service=service;result.unicodeAndRollback=true;result.backupVerified=true
  result.sourceHashes={bridge:hash(await readFile(join(binaries,'storage-bridge.cjs'))),service:service.realServiceHash,environment:hash(await readFile(join(root,'apps/server/src/db/storage-process-environment.ts'))),workerProbe:hash(await readFile(join(root,'scripts/fixtures/storage-environment-worker-probe.mjs'))),serviceProbe:hash(await readFile(join(directory,'storage-service.cjs')))}
}catch(error){failure=error;result.error=error instanceof Error?{name:error.name,message:error.message}:String(error)}
finally{
  try{db?.close()}catch(error){failure??=error;result.closeError=error instanceof Error?error.message:String(error)}
  try{
    const deadline=Date.now()+5000
    let service=await read('service-environment.json')
    while(Date.now()<deadline&&(service.stage!=='EXITED'||alive(service.realPid))){await new Promise(resolve=>setTimeout(resolve,25));service=await read('service-environment.json')}
    result.finalService=service;result.realPresent=alive(service.realPid)
    assert.equal(service.stage,'EXITED');assert.deepEqual(service.exit,{code:0,signal:null});assert.equal(result.realPresent,false)
    if(!failure)result.result='PASS'
  }catch(error){failure??=error;result.cleanupError=error instanceof Error?error.message:String(error)}
  await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}
if(failure)throw failure
