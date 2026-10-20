import assert from 'node:assert/strict'
import {spawn,type ChildProcess} from 'node:child_process'
import {mkdtemp,mkdir,readFile,writeFile,realpath} from 'node:fs/promises'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createServer} from 'node:net'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
import {openDatabase} from '../apps/server/src/db/client.js'
import {hashPassword} from '../apps/server/src/domain/auth.js'
import {mediaAssets} from '../apps/server/src/db/schema.js'

// Real compiled HTTP/info logging/WS, own DB and fake byte fixture. No engine,
// video decoding, real credentials, browser, external sender or native output.
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(root,'scratch','http-privacy-'))
const media=join(directory,'media');await mkdir(media)
const file=join(media,'fixture-bytes.mp4'),bytes=Buffer.from([0,1,2,3,4,5,6,7]);await writeFile(file,bytes)
// A file where the backup directory should be makes mkdir fail, before any
// backup copy. Only this fixture's bytes are affected; no disk-full injection.
const backupPath=join(directory,'PRIVATE_BACKUP_PATH');await writeFile(backupPath,'own backup refusal fixture')
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json')
const database=openDatabase(join(directory,'privacy.db')),stamp=new Date().toISOString()
const password='PRIVATE_PRIVACY_PASSWORD',hash=await hashPassword(password)
database.sqlite.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('qa-admin','privacy-verifier',hash,'ADMIN',1,stamp)
database.sqlite.exec("INSERT INTO channels(id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES('qa','Privacy fixture',25,1,320,180,-23,-1,5,'now')")
database.db.insert(mediaAssets).values({id:'fixture-media',title:'Byte fixture, not approved video',path:file,contentHash:createHash('sha256').update(bytes).digest('hex'),kind:'VIDEO',durationFrames:1,createdAt:stamp}).run()
const reserved=createServer();await new Promise<void>(resolve=>reserved.listen(0,'127.0.0.1',resolve))
const port=(reserved.address() as {port:number}).port;await new Promise<void>(resolve=>reserved.close(()=>resolve()))
const Ws=createRequire(await realpath(join(root,'apps/server/node_modules/@fastify/websocket/package.json')))('ws')
let child:ChildProcess|null=null,socket:any=null,logs='',result:Record<string,unknown>|null=null,failure:unknown=null
const privateValues=['PRIVATE_QUERY','PRIVATE_PATH','PRIVATE_COOKIE','PRIVATE_BEARER','PRIVATE_BAD_PASSWORD','PRIVATE_BAD_JSON','PRIVATE_WS_QUERY','PRIVATE_BACKUP_PATH','PRIVATE_AUDIT_MESSAGE',password,hash]
async function call(path:string,options:RequestInit={},status=200){
  const response=await fetch(`http://127.0.0.1:${port}${path}`,{...options,signal:AbortSignal.timeout(5000)})
  const body=Buffer.from(await response.arrayBuffer());assert.equal(response.status,status,`${path}: status${response.status}`)
  if(path.startsWith('/api/')){assert.match(response.headers.get('cache-control')??'',/^private/);if((response.headers.get('content-type')??'').includes('json'))assert.equal(response.headers.get('cache-control'),'private, no-store')}
  return {response,body}
}
try{
  const environment={...process.env};for(const name of Object.keys(environment))if(name.startsWith('RPLAYOUT_'))delete environment[name]
  child=spawn(process.execPath,[join(root,'apps/server/dist/server.cjs')],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...environment,
    RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_DB:join(directory,'privacy.db'),RPLAYOUT_VAULT_FILE:join(directory,'vault.json'),RPLAYOUT_MEDIA:media,
    RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_CACHE_DIR:join(directory,'cache'),RPLAYOUT_BACKUPS:backupPath,
    RPLAYOUT_ENGINE:'',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_DEVICES:'',RPLAYOUT_RELAY:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_BACKUP_HOURS:'0.0006',RPLAYOUT_ADMIN_USER:'',RPLAYOUT_ADMIN_PASSWORD:'',RPLAYOUT_ALLOWED_ORIGINS:'',HOST:'127.0.0.1',PORT:String(port),LOG_LEVEL:'info'}})
  for(const stream of [child.stdout,child.stderr])stream?.on('data',chunk=>logs+=String(chunk))
  const deadline=performance.now()+30000;let ready=false
  while(performance.now()<deadline){assert.equal(child.exitCode,null,'Own server terminated');try{ready=(await call('/api/health')).response.ok}catch{}if(ready)break;await new Promise(resolve=>setTimeout(resolve,100))}
  assert.ok(ready,'Own server readiness')
  await call('/api/state?opaque=PRIVATE_QUERY',{headers:{cookie:'rplayout_session=PRIVATE_COOKIE',authorization:'Bearer PRIVATE_BEARER'}},401)
  await call('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'privacy-verifier',password:'PRIVATE_BAD_PASSWORD'})},401)
  const login=await call('/api/auth/login?opaque=PRIVATE_QUERY',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'privacy-verifier',password})})
  const cookie=login.response.headers.get('set-cookie')?.split(';')[0]!;assert.ok(cookie);privateValues.push(cookie.split('=')[1]!)
  const sessionsBefore=database.sqlite.prepare('SELECT count(*) n FROM sessions').get()!.n
  database.sqlite.exec("CREATE TRIGGER privacy_audit_failure BEFORE INSERT ON operator_decisions WHEN NEW.kind='SESSION_CREATED' BEGIN SELECT RAISE(ABORT,'PRIVATE_AUDIT_MESSAGE'); END")
  const refused=await call('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'privacy-verifier',password})},500)
  assert.equal(refused.response.headers.get('set-cookie'),null);assert.ok(!refused.body.toString().includes('PRIVATE_AUDIT_MESSAGE'))
  const failedResponse=JSON.parse(refused.body.toString());assert.ok(failedResponse.requestId);assert.ok(failedResponse.message.includes(failedResponse.requestId))
  assert.equal(database.sqlite.prepare('SELECT count(*) n FROM sessions').get()!.n,sessionsBefore)
  database.sqlite.exec('DROP TRIGGER privacy_audit_failure')
  const state=await call('/api/state?opaque=PRIVATE_QUERY',{headers:{cookie}});assert.ok(JSON.parse(state.body.toString()).channels)
  await call('/api/state?opaque=PRIVATE_QUERY',{method:'HEAD',headers:{cookie}})
  await call('/api/state',{headers:{cookie,origin:'https://foreign.invalid'}},403)
  await call('/api/missing/PRIVATE_PATH?opaque=PRIVATE_QUERY',{headers:{cookie}},404)
  await call('/api/channels?opaque=PRIVATE_QUERY',{method:'POST',headers:{cookie,'content-type':'application/json'},body:'{"password":"PRIVATE_BAD_JSON"'},400)
  const ranged=await call('/api/assets/fixture-media/media?opaque=PRIVATE_QUERY',{headers:{cookie,range:'bytes=0-2'}},206)
  assert.deepEqual(ranged.body,bytes.subarray(0,3));assert.equal(ranged.response.headers.get('content-range'),'bytes 0-2/8')
  const websocket=await new Promise<any>((resolve,reject)=>{
    const opened=new Ws(`ws://127.0.0.1:${port}/ws?opaque=PRIVATE_WS_QUERY`,{headers:{cookie,origin:`http://127.0.0.1:${port}`}});socket=opened
    const timer=setTimeout(()=>{opened.terminate();reject(new Error('Own WS did not open'))},5000)
    opened.once('error',error=>{clearTimeout(timer);reject(error)});opened.once('open',()=>{clearTimeout(timer);resolve(opened)})
  })
  await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Own WS did not close')),5000);websocket.once('close',()=>{clearTimeout(timer);resolve()});websocket.close()});socket=null
  const foreignStatus=await new Promise<number>((resolve,reject)=>{
    const rejected=new Ws(`ws://127.0.0.1:${port}/ws?opaque=PRIVATE_WS_QUERY`,{headers:{cookie,origin:'https://foreign.invalid'}})
    const timer=setTimeout(()=>{rejected.terminate();reject(new Error('Foreign WS not denied'))},5000)
    rejected.on('error',()=>{});rejected.once('unexpected-response',(_,response)=>{clearTimeout(timer);const status=response.statusCode;response.resume();rejected.terminate();resolve(status)});rejected.once('open',()=>{clearTimeout(timer);rejected.close();reject(new Error('Foreign WS opened'))})
  });assert.equal(foreignStatus,403)
  const backupDeadline=performance.now()+5000
  while(!logs.includes('A cópia de segurança do banco falhou.')&&performance.now()<backupDeadline)await new Promise(resolve=>setTimeout(resolve,100))
  assert.ok(logs.includes('A cópia de segurança do banco falhou.'),'Real periodic backup failure observed')
  assert.ok(logs.includes('incoming request')&&logs.includes('request completed'),'Actual info logger observed')
  for(const value of privateValues)assert.ok(!logs.includes(value),'Private fixture value present in logs (value withheld)')
  result={result:'PASS',directory,port,serverSha256:createHash('sha256').update(await readFile(join(root,'apps/server/dist/server.cjs'))).digest('hex'),infoLoggerObserved:true,credentialMarkersAbsent:privateValues.length,controlCachePrivateNoStore:true,authenticatedStateRead:true,headValidated:true,foreignHttpOriginDenied:true,foreignWebsocketOriginDenied:true,ownWebsocketOpened:true,unknownRouteNoRawLog:true,malformedBodyNoRawLog:true,unhandledAuditFailureNoRawLog:true,failedLoginCreatesNoSessionOrCookie:true,periodicBackupFailureNoRawPath:true,rangeMediaBytesPreserved:true,physicalSignalValidated:false,browserValidated:false,scope:'Compiled HTTP/WS and privacy/cache only. Byte fixture is not video or media/QC approval; backup deliberately refused, not restoration proof.'}
}catch(error){failure=error;throw error}
finally{
  socket?.terminate()
  if(child&&child.exitCode===null&&child.signalCode===null){const exited=new Promise<void>(resolve=>child!.once('exit',()=>resolve()));child.kill();await exited}
  database.sqlite.close()
  await writeFile(join(directory,'result.json'),JSON.stringify({...result??{result:'FAIL',directory},serverExitObserved:true,error:failure?String(failure):null},null,2))
  await writeFile(join(directory,'server.log'),logs)
}
await assert.rejects(()=>fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(1000)}))
console.log(JSON.stringify({...result,serverExitObserved:true,listenerClosed:true}))
