import assert from 'node:assert/strict'
import {spawn,execFile,type ChildProcess} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,mkdir,readFile,writeFile,lstat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {randomBytes,randomUUID,createHash} from 'node:crypto'
import {createServer} from 'node:net'
import {createRequire} from 'node:module'
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(tmpdir(),'RPlayout-shared-key-restore-'))
const sourceDir=join(directory,'source'),destination=join(directory,'restored');await mkdir(sourceDir)
const environment=Object.fromEntries(Object.entries(process.env).filter(([name])=>!/^RPLAYOUT_|^VITEST$/i.test(name)))
const key=randomBytes(32).toString('base64'),token=randomUUID()+randomUUID(),secret='PRIVATE_'+randomUUID(),run=promisify(execFile),children:ChildProcess[]=[],logs=new Map<ChildProcess,string>()
const env={...environment,RPLAYOUT_INSTALL_ROOT:root},tool=join(root,'apps/server/dist/restore-backup.cjs'),backup=join(sourceDir,'backup.db'),sourceFile=join(sourceDir,'source.db'),Database=createRequire(new URL('../apps/server/package.json',import.meta.url))('better-sqlite3')
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
async function absent(path:string){await assert.rejects(lstat(path),(error:any)=>error.code==='ENOENT')}
async function refused(args:string[],variables:NodeJS.ProcessEnv){try{await run(process.execPath,args,{env:variables,windowsHide:true,timeout:90000});throw new Error('Unexpected acceptance')}catch(error:any){assert.equal(error.code,1,'Expected refusal, not timeout/native crash')}}
async function port(){const listener=createServer();await new Promise<void>(resolve=>listener.listen(0,'127.0.0.1',resolve));const value=(listener.address() as {port:number}).port;await new Promise<void>(resolve=>listener.close(()=>resolve()));return value}
async function stop(child:ChildProcess){if(child.exitCode!==null||child.signalCode!==null)return;const ended=new Promise<void>(resolve=>child.once('exit',()=>resolve()));assert.equal(child.kill('SIGKILL'),true);let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([ended,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Own server did not exit')),10000)})])}finally{if(timer)clearTimeout(timer)}}
async function start(mode:'correct'|'wrong'|'missing'){
  const p=await port(),child=spawn(process.execPath,[join(root,'apps/server/dist/server.cjs')],{cwd:destination,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...env,...(mode==='missing'?{}:{RPLAYOUT_VAULT_KEY:mode==='correct'?key:randomBytes(32).toString('base64')}),RPLAYOUT_VAULT_FILE:join(destination,'vault.json'),RPLAYOUT_DB:join(destination,'service.db'),RPLAYOUT_MEDIA:join(directory,'media'),RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_CACHE:join(directory,'cache'),RPLAYOUT_BACKUPS:join(directory,'backups'),RPLAYOUT_BACKUP_HOURS:'0',RPLAYOUT_ENGINE:'',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_RELAY:'',RPLAYOUT_DEVICES:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:'',HOST:'127.0.0.1',PORT:String(p),LOG_LEVEL:'warn'}})
  children.push(child);logs.set(child,'');child.on('error',error=>logs.set(child,(logs.get(child)??'')+String(error)))
  for(const stream of [child.stdout,child.stderr])stream?.on('data',chunk=>logs.set(child,((logs.get(child)??'')+String(chunk)).slice(-8000)))
  const deadline=performance.now()+25000
  while(performance.now()<deadline){
    if(child.exitCode!==null||child.signalCode!==null){assert.notEqual(mode,'correct',logs.get(child));assert.equal(child.exitCode,1);return {child,port:p,refused:true}}
    try{const response=await fetch(`http://127.0.0.1:${p}/api/health`,{signal:AbortSignal.timeout(1000)});if(response.ok){assert.equal(mode,'correct','Incorrect/missing key must not open service');return {child,port:p,refused:false}}}catch(error){if(String(error).includes('Incorrect/missing'))throw error}
    await new Promise(resolve=>setTimeout(resolve,100))
  }
  throw new Error('Startup observation timeout '+logs.get(child))
}
let result:Record<string,unknown>={result:'FAIL',directory},database:ReturnType<typeof import('../apps/server/src/db/client.js').openDatabase>|null=null
try{
  process.env.RPLAYOUT_VAULT_KEY=key;process.env.RPLAYOUT_VAULT_FILE=join(sourceDir,'vault.json');delete process.env.VITEST
  const {openDatabase}=await import('../apps/server/src/db/client.js'),{integrations}=await import('../apps/server/src/db/schema.js'),{sessionDigest}=await import('../apps/server/src/domain/access.js')
  database=openDatabase(sourceFile)
  database.sqlite.exec("INSERT INTO users VALUES('u','Admin','NO_LOGIN','ADMIN',1,'now')")
  database.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest(token),'u','2099-01-01','now')
  database.db.insert(integrations).values({id:'g',name:'Shared-key protected configuration',url:'https://example.test/hook?token='+secret,events:['unused'],enabled:false,createdAt:'now'}).run()
  const privateRow=database.sqlite.prepare('SELECT url FROM integrations WHERE id=?').get('g');assert.ok(!JSON.stringify(privateRow).includes(secret))
  await database.sqlite.backup(backup);database.sqlite.close();database=null;await absent(join(sourceDir,'vault.json'))
  const originalBackup=await readFile(backup),report=JSON.parse((await run(process.execPath,[tool,'--backup',backup,'--destination',destination],{env:{...env,RPLAYOUT_VAULT_KEY:key},windowsHide:true,timeout:90000})).stdout.trim())
  assert.equal(report.phase,'QUARANTINED');assert.equal(report.vaultMode,'SHARED_ENVIRONMENT');assert.equal(report.validation.protectedSecrets,'verified');assert.equal(report.promotionReady,false);await absent(join(destination,'vault.json'))
  assert.ok(!JSON.stringify(report).includes(key));assert.ok(!JSON.stringify(report).includes(secret))
  const fixed=new Database(join(destination,'service.db'),{readonly:true,fileMustExist:true});let expected:any
  try{expected=fixed.prepare('SELECT * FROM integrations').all();assert.deepEqual(fixed.prepare('SELECT url FROM integrations WHERE id=?').get('g'),privateRow)}finally{fixed.close()}
  for(const mode of ['missing','wrong'] as const){const rejected=await start(mode);assert.equal(rejected.refused,true);await absent(join(destination,'vault.json'));const check=new Database(join(destination,'service.db'),{readonly:true,fileMustExist:true});try{assert.deepEqual(check.prepare('SELECT * FROM integrations').all(),expected)}finally{check.close()}}
  const valid=await start('correct'),response=await fetch(`http://127.0.0.1:${valid.port}/api/integrations/g/review`,{headers:{cookie:'rplayout_session='+token},signal:AbortSignal.timeout(10000)})
  assert.equal(response.status,200);const config=await response.json();assert.equal(config.name,'Shared-key protected configuration');assert.ok(!JSON.stringify(config).includes(secret));await stop(valid.child)
  const missingDestination=join(directory,'missing-key'),wrongDestination=join(directory,'wrong-key')
  await refused([tool,'--backup',backup,'--destination',missingDestination],env);await absent(missingDestination)
  await refused([tool,'--backup',backup,'--destination',wrongDestination],{...env,RPLAYOUT_VAULT_KEY:randomBytes(32).toString('base64')});await absent(wrongDestination)
  assert.deepEqual(await readFile(backup),originalBackup);await absent(join(destination,'vault.json'))
  for(const text of logs.values()){assert.ok(!text.includes(key));assert.ok(!text.includes(secret))}
  result={result:'PASS',directory,compiledServerSha256:sha(await readFile(join(root,'apps/server/dist/server.cjs'))),restoreCliSha256:sha(await readFile(tool)),sharedEnvironmentRestoreAndProtectedServiceStartup:true,originalCiphertextPreserved:true,noKeyFileCreated:true,noKeyInArgumentsLogsOrReport:true,missingAndWrongKeyStartupRefusedWithoutReplacingProtectedConfiguration:true,missingAndWrongKeyRestoreRefusedBeforeDestinationCreation:true,authenticatedRestoredConfigurationRead:true,originalBackupBytesPreserved:true,sameWindowsAccount:true,crossHostOrOtherAccountValidated:false,physicalPgmValidated:false,engineAndOutputsDisabled:true}
}catch(error){result={...result,error:String(error)};throw error}
finally{
  const cleanupErrors:string[]=[];for(const child of children)try{await stop(child)}catch(error){cleanupErrors.push(String(error))};database?.sqlite.close();delete process.env.RPLAYOUT_VAULT_KEY
  await writeFile(join(directory,'server-logs.json'),JSON.stringify([...logs].map(([child,text])=>({pid:child.pid,text})),null,2));await writeFile(join(directory,'result.json'),JSON.stringify({...result,cleanupErrors},null,2));console.log(JSON.stringify({...result,cleanupErrors}));assert.equal(cleanupErrors.length,0)
}
