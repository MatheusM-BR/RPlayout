import assert from 'node:assert/strict'
import {spawn,type ChildProcess} from 'node:child_process'
import {mkdtemp,mkdir,readFile,writeFile,stat,realpath} from 'node:fs/promises'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createServer} from 'node:net'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
import {openDatabase} from '../apps/server/src/db/client.js'
import {hashPassword} from '../apps/server/src/domain/auth.js'

// Compiled startup and HTTP/WS/config authority. Every process/database is
// owned by this fixture. No browser, engine, media transport or production env.
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(root,'scratch','http-origins-'))
const serverBinary=join(root,'apps/server/dist/server.cjs'),media=join(directory,'media');await mkdir(media)
const environment={...process.env};for(const name of Object.keys(environment))if(name.startsWith('RPLAYOUT_'))delete environment[name]
const shared={...environment,RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_MEDIA:media,
  RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_CACHE_DIR:join(directory,'cache'),RPLAYOUT_BACKUPS:join(directory,'backups'),
  RPLAYOUT_ENGINE:'',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_DEVICES:'',RPLAYOUT_RELAY:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_BACKUP_HOURS:'0',RPLAYOUT_ADMIN_USER:'',RPLAYOUT_ADMIN_PASSWORD:'',HOST:'127.0.0.1',LOG_LEVEL:'info'}
let child:ChildProcess|null=null,logs='',socket:any=null,failure:unknown=null,result:Record<string,unknown>|null=null,database:ReturnType<typeof openDatabase>|null=null
const invalidResults:Array<Record<string,unknown>>=[],requestResults:Array<Record<string,unknown>>=[]
const Ws=createRequire(await realpath(join(root,'apps/server/node_modules/@fastify/websocket/package.json')))('ws')
async function port(){const server=createServer();await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const value=(server.address() as {port:number}).port;await new Promise<void>(resolve=>server.close(()=>resolve()));return value}
function start(dbPath:string,vaultPath:string,bindPort:number,origins:string){
  logs='';child=spawn(process.execPath,[serverBinary],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...shared,RPLAYOUT_DB:dbPath,RPLAYOUT_VAULT_FILE:vaultPath,PORT:String(bindPort),RPLAYOUT_ALLOWED_ORIGINS:origins}})
  for(const stream of [child.stdout,child.stderr])stream?.on('data',chunk=>logs+=String(chunk))
}
async function stop(){if(child&&child.exitCode===null&&child.signalCode===null){const current=child,ended=new Promise<void>(resolve=>current.once('exit',()=>resolve()));current.kill();await ended}child=null}
async function ws(bindPort:number,origin:string,cookie:string,expected:number){
  await new Promise<void>((resolve,reject)=>{
    const connection=new Ws(`ws://127.0.0.1:${bindPort}/ws`,{headers:{origin,cookie}});socket=connection
    const timer=setTimeout(()=>{connection.terminate();reject(new Error('Own WS outcome timeout'))},5000)
    connection.on('error',()=>{})
    connection.once('open',()=>{if(expected!==101){clearTimeout(timer);connection.close();reject(new Error('Unexpected WS admission'));return}connection.once('close',()=>{clearTimeout(timer);socket=null;resolve()});connection.close()})
    connection.once('unexpected-response',(_,response)=>{clearTimeout(timer);response.resume();connection.terminate();socket=null;try{assert.equal(response.statusCode,expected);resolve()}catch(error){reject(error)}})
  })
}
try{
  for(const [index,origins]of ['null','*','https://user:PRIVATE_ORIGIN_PASSWORD@host','https://host/path?token=PRIVATE_ORIGIN_TOKEN','https://allowed,'].entries()){
    const bindPort=await port(),dbPath=join(directory,`invalid-${index}.db`),vaultPath=join(directory,`invalid-${index}-vault.json`)
    start(dbPath,vaultPath,bindPort,origins)
    const current=child!
    const code=await new Promise<number|null>((resolve,reject)=>{
      const timer=setTimeout(()=>{current.kill();reject(new Error('Invalid-origin startup did not terminate'))},5000)
      current.once('exit',code=>{clearTimeout(timer);resolve(code)});current.once('error',error=>{clearTimeout(timer);reject(error)})
    })
    assert.equal(code,1);assert.ok(logs.includes('RPLAYOUT_ALLOWED_ORIGINS'))
    assert.ok(!logs.includes('PRIVATE_ORIGIN_PASSWORD')&&!logs.includes('PRIVATE_ORIGIN_TOKEN'))
    await assert.rejects(()=>stat(dbPath));await assert.rejects(()=>stat(vaultPath))
    await assert.rejects(()=>fetch(`http://127.0.0.1:${bindPort}/api/health`,{signal:AbortSignal.timeout(1000)}))
    await writeFile(join(directory,`invalid-${index}.log`),logs)
    invalidResults.push({index,exitCode:code,databaseCreated:false,vaultCreated:false,listenerOpened:false,rawConfigurationLogged:false})
    child=null
  }
  process.env.RPLAYOUT_VAULT_FILE=join(directory,'valid-vault.json');delete process.env.RPLAYOUT_VAULT_KEY
  database=openDatabase(join(directory,'valid.db'));const stamp=new Date().toISOString()
  database.sqlite.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('qa-admin','origin-verifier',await hashPassword('PRIVATE_ORIGIN_VALID_PASSWORD'),'ADMIN',1,stamp)
  database.sqlite.exec("INSERT INTO channels(id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES('qa','Origin fixture',25,1,320,180,-23,-1,5,'now')")
  const bindPort=await port();start(join(directory,'valid.db'),join(directory,'valid-vault.json'),bindPort,'HTTP://LOCALHOST:5173/, https://control.example:443, http://[::1]:5173/')
  const deadline=performance.now()+30000;let ready=false
  while(performance.now()<deadline){assert.equal(child!.exitCode,null,'Own valid-origin server exited');try{ready=(await fetch(`http://127.0.0.1:${bindPort}/api/health`,{signal:AbortSignal.timeout(1000)})).ok}catch{}if(ready)break;await new Promise(resolve=>setTimeout(resolve,100))}
  assert.ok(ready,'Own valid-origin readiness')
  const call=async(path:string,options:RequestInit,status:number,allowOrigin:string|null=null)=>{
    const response=await fetch(`http://127.0.0.1:${bindPort}${path}`,{...options,signal:AbortSignal.timeout(5000)});assert.equal(response.status,status)
    assert.equal(response.headers.get('access-control-allow-origin'),allowOrigin)
    if(status!==204)assert.equal(response.headers.get('cache-control'),'private, no-store')
    const body=await response.text();requestResults.push({path,status,allowOrigin});return {response,body}
  }
  const login=await call('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'origin-verifier',password:'PRIVATE_ORIGIN_VALID_PASSWORD'})},200)
  const cookie=login.response.headers.get('set-cookie')!.split(';')[0]!
  for(const origin of ['http://localhost:5173','https://control.example','http://[::1]:5173']){
    await call('/api/state',{headers:{origin,cookie}},200,origin)
    await call('/api/state',{headers:{origin}},401,origin) // CORS is not auth.
  }
  for(const origin of ['null','https://foreign.invalid','http://localhost:5174','https://control.example.evil','http://localhost:5173/','https://user:PRIVATE_HEADER_PASSWORD@control.example'])await call('/api/state',{headers:{origin,cookie}},403)
  await call('/api/state',{headers:{origin:`http://127.0.0.1:${bindPort}`,cookie}},200)
  await call('/api/state',{headers:{cookie}},200) // CLI still needs this cookie.
  const preflight=await call('/api/channels/qa/transport',{method:'OPTIONS',headers:{origin:'http://localhost:5173','access-control-request-method':'POST','access-control-request-headers':'content-type'}},204,'http://localhost:5173')
  assert.equal(preflight.response.headers.get('access-control-allow-credentials'),'true')
  await call('/api/channels/qa/transport',{method:'POST',headers:{origin:'http://localhost:5173','content-type':'application/json'},body:JSON.stringify({action:'take',itemId:'must-not-execute'})},401,'http://localhost:5173')
  await ws(bindPort,'http://localhost:5173',cookie,101);await ws(bindPort,'null',cookie,403);await ws(bindPort,'https://foreign.invalid',cookie,403)
  assert.ok(!logs.includes('PRIVATE_ORIGIN_VALID_PASSWORD')&&!logs.includes('PRIVATE_HEADER_PASSWORD')&&!logs.includes(cookie.split('=')[1]!))
  assert.equal(database.sqlite.prepare('SELECT count(*) n FROM as_run').get()!.n,0)
  result={result:'PASS',directory,serverSha256:createHash('sha256').update(await readFile(serverBinary)).digest('hex'),invalidStartup:invalidResults,requestResults,explicitCanonicalOrigins:true,opaqueAndUnlistedOriginsDenied:true,ownPageAndAuthenticatedCliPreserved:true,preflightDoesNotAuthorizeCommand:true,explicitOriginWsAccepted:true,foreignAndOpaqueWsDenied:true,asRun:0,engineDisabled:true,browserValidated:false,physicalSignalValidated:false,scope:'Compiled configuration/HTTP/WS loopback only; not TLS, remote browser, host/DNS admission or physical playout.'}
}catch(error){failure=error;throw error}
finally{
  socket?.terminate();await stop();database?.sqlite.close()
  await writeFile(join(directory,'result.json'),JSON.stringify({...result??{result:'FAIL',directory,invalidStartup:invalidResults,requestResults},error:failure?String(failure):null,ownServerExitObserved:true},null,2))
  await writeFile(join(directory,'valid-server.log'),logs)
}
console.log(JSON.stringify({result:result!.result,directory,invalidConfigurations:invalidResults.length,httpCases:requestResults.length,explicitOriginWsAccepted:true,foreignAndOpaqueWsDenied:true,ownServerExitObserved:true,serverSha256:result!.serverSha256}))
