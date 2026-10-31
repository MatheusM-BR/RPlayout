import assert from 'node:assert/strict'
import {spawn,type ChildProcess} from 'node:child_process'
import {mkdtemp,mkdir,readFile,writeFile,stat,realpath} from 'node:fs/promises'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createServer} from 'node:net'
import {request} from 'node:http'
import {hostname} from 'node:os'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
import {openDatabase} from '../apps/server/src/db/client.js'
import {hashPassword} from '../apps/server/src/domain/auth.js'

const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(root,'scratch','http-hosts-')),media=join(directory,'media')
await mkdir(media)
const binary=join(root,'apps/server/dist/server.cjs'),environment={...process.env}
for(const name of Object.keys(environment))if(name.startsWith('RPLAYOUT_'))delete environment[name]
const shared={...environment,RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_MEDIA:media,RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_CACHE_DIR:join(directory,'cache'),RPLAYOUT_BACKUPS:join(directory,'backups'),RPLAYOUT_ENGINE:'',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_DEVICES:'',RPLAYOUT_RELAY:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_BACKUP_HOURS:'0',RPLAYOUT_ADMIN_USER:'',RPLAYOUT_ADMIN_PASSWORD:'',RPLAYOUT_ALLOWED_ORIGINS:'http://localhost:5173',HOST:'127.0.0.1',LOG_LEVEL:'info'}
const Ws=createRequire(await realpath(join(root,'apps/server/node_modules/@fastify/websocket/package.json')))('ws')
let child:ChildProcess|null=null,socket:any=null,database:ReturnType<typeof openDatabase>|null=null,logs='',failure:unknown=null,result:Record<string,unknown>|null=null
const invalid:Array<Record<string,unknown>>=[],httpCases:Array<Record<string,unknown>>=[]
async function port(){const probe=createServer();await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));const value=(probe.address() as {port:number}).port;await new Promise<void>(resolve=>probe.close(()=>resolve()));return value}
function start(db:string,vault:string,bindPort:number,extra:Record<string,string>={}){
  logs='';child=spawn(process.execPath,[binary],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...shared,RPLAYOUT_DB:db,RPLAYOUT_VAULT_FILE:vault,PORT:String(bindPort),...extra}})
  for(const stream of [child.stdout,child.stderr])stream?.on('data',chunk=>logs+=String(chunk))
}
async function stop(){if(child&&child.exitCode===null&&child.signalCode===null){const current=child,ended=new Promise<void>(resolve=>current.once('exit',()=>resolve()));current.kill();await ended}child=null}
function http(bindPort:number,path:string,host:string|string[],status:number,headers:Record<string,string>={},body?:object,method=body?'POST':'GET'){
  return new Promise<{headers:import('node:http').IncomingHttpHeaders;body:string}>((resolve,reject)=>{
    const value=body===undefined?undefined:JSON.stringify(body)
    const ordinaryHeaders={...headers,...(value?{'content-type':'application/json','content-length':String(Buffer.byteLength(value))}:{})}
    const outgoingHeaders=Array.isArray(host)?[...host.flatMap(name=>['host',name]),...Object.entries(ordinaryHeaders).flat()]:{host,...ordinaryHeaders}
    const outgoing=request({hostname:'127.0.0.1',port:bindPort,path,method,headers:outgoingHeaders},response=>{
      let text='';response.on('data',chunk=>text+=String(chunk));response.once('end',()=>{
        try{assert.equal(response.statusCode,status,`${method} ${path}: ${response.statusCode}; response ${text.slice(0,180)}`);httpCases.push({path,method,status});resolve({headers:response.headers,body:text})}catch(error){reject(error)}
      })
    });outgoing.setTimeout(5000,()=>outgoing.destroy(new Error('Own HTTP timeout')));outgoing.once('error',reject);outgoing.end(value)
  })
}
async function ws(bindPort:number,host:string,cookie:string,expected:number){
  await new Promise<void>((resolve,reject)=>{
    const connection=new Ws(`ws://127.0.0.1:${bindPort}/ws`,{headers:{host,cookie,origin:`http://${host}`}});socket=connection
    const timer=setTimeout(()=>{connection.terminate();reject(new Error('Own WS timeout'))},5000)
    connection.on('error',()=>{})
    connection.once('open',()=>{if(expected!==101){clearTimeout(timer);connection.close();reject(new Error('Unexpected WS admission'));return}connection.once('close',()=>{clearTimeout(timer);socket=null;resolve()});connection.close()})
    connection.once('unexpected-response',(_,response)=>{clearTimeout(timer);response.resume();connection.terminate();socket=null;try{assert.equal(response.statusCode,expected);resolve()}catch(error){reject(error)}})
  })
}
try{
  const badConfigurations=[{RPLAYOUT_ALLOWED_HOSTS:'*'},{RPLAYOUT_ALLOWED_HOSTS:'http://host'},{RPLAYOUT_ALLOWED_HOSTS:'user:PRIVATE_HOST_PASSWORD@host'},{RPLAYOUT_ALLOWED_HOSTS:'host,'},{HOST:'http://user:PRIVATE_BIND_PASSWORD@host'},{PORT:'0.5'}]
  for(const [index,extra]of badConfigurations.entries()){
    const bindPort=await port(),db=join(directory,`invalid-${index}.db`),vault=join(directory,`invalid-${index}-vault.json`)
    start(db,vault,bindPort,extra)
    const current=child!,code=await new Promise<number|null>((resolve,reject)=>{
      const timer=setTimeout(()=>{current.kill();reject(new Error('Invalid Host policy did not stop'))},5000)
      current.once('exit',value=>{clearTimeout(timer);resolve(value)});current.once('error',error=>{clearTimeout(timer);reject(error)})
    })
    assert.equal(code,1);await assert.rejects(()=>stat(db));await assert.rejects(()=>stat(vault))
    assert.ok(!logs.includes('PRIVATE_HOST_PASSWORD')&&!logs.includes('PRIVATE_BIND_PASSWORD'))
    await writeFile(join(directory,`invalid-${index}.log`),logs)
    invalid.push({index,exitCode:1,databaseCreated:false,vaultCreated:false,rawConfigurationLogged:false});child=null
  }
  process.env.RPLAYOUT_VAULT_FILE=join(directory,'valid-vault.json');delete process.env.RPLAYOUT_VAULT_KEY
  database=openDatabase(join(directory,'valid.db'));const stamp=new Date().toISOString()
  database.sqlite.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('qa-admin','host-verifier',await hashPassword('PRIVATE_VALID_PASSWORD'),'ADMIN',1,stamp)
  database.sqlite.exec("INSERT INTO channels(id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES('qa','Host fixture',25,1,320,180,-23,-1,5,'now')")
  const bindPort=await port(),ownHost=`127.0.0.1:${bindPort}`,badHost=`PRIVATE_UNLISTED.invalid:${bindPort}`
  start(join(directory,'valid.db'),join(directory,'valid-vault.json'),bindPort,{RPLAYOUT_ALLOWED_HOSTS:'controlled.example,proxy.example:8443'})
  const deadline=performance.now()+30000;let ready=false
  while(performance.now()<deadline){assert.equal(child!.exitCode,null);try{ready=(await fetch(`http://127.0.0.1:${bindPort}/api/health`,{signal:AbortSignal.timeout(1000)})).ok}catch{}if(ready)break;await new Promise(resolve=>setTimeout(resolve,100))}
  assert.ok(ready,'Own server readiness')
  const loginBody={username:'host-verifier',password:'PRIVATE_VALID_PASSWORD'}
  const deniedLogin=await http(bindPort,'/api/auth/login',badHost,403,{origin:`http://${badHost}`},loginBody)
  assert.equal(deniedLogin.headers['set-cookie'],undefined);assert.equal(database.sqlite.prepare('SELECT count(*) n FROM sessions').get()!.n,0)
  const login=await http(bindPort,'/api/auth/login',ownHost,200,{},loginBody),cookie=String(login.headers['set-cookie']![0]).split(';')[0]!
  // Browsers serialize Origin canonically (including lowercase hostname).
  // A Windows hostname can be uppercase in Host, but not in serialized Origin.
  for(const host of [ownHost,`localhost:${bindPort}`,`${hostname()}:${bindPort}`,`controlled.example:${bindPort}`,'controlled.example','proxy.example:8443'])await http(bindPort,'/api/state',host,200,{cookie,origin:new URL(`http://${host}`).origin})
  for(const path of ['/api/state','/','/assets/index.js','/ws']){
    const denied=await http(bindPort,path,badHost,403,{cookie,origin:`http://${badHost}`,'x-forwarded-host':ownHost,'x-forwarded-proto':'https'})
    assert.equal(JSON.parse(denied.body).error,'HTTP_HOST_NOT_ALLOWED');assert.equal(denied.headers['cache-control'],'private, no-store')
  }
  await http(bindPort,'/api/state',`controlled.example:${bindPort===4001?4002:4001}`,403,{cookie})
  await http(bindPort,'/api/state','proxy.example:8444',403,{cookie})
  await http(bindPort,'/api/state',[ownHost,badHost],403,{cookie})
  await http(bindPort,'/api/state',badHost,403,{origin:'http://localhost:5173','access-control-request-method':'POST'},undefined,'OPTIONS')
  await http(bindPort,'/api/state',ownHost,204,{origin:'http://localhost:5173','access-control-request-method':'GET'},undefined,'OPTIONS')
  await http(bindPort,'/api/state',ownHost,401,{origin:'http://localhost:5173'})
  await ws(bindPort,ownHost,cookie,101);await ws(bindPort,`controlled.example:${bindPort}`,cookie,101);await ws(bindPort,badHost,cookie,403)
  assert.equal(database.sqlite.prepare('SELECT count(*) n FROM as_run').get()!.n,0)
  for(const value of ['PRIVATE_UNLISTED','PRIVATE_VALID_PASSWORD',cookie.split('=')[1]!])assert.ok(!logs.includes(value),'Private Host/cookie fixture value logged (withheld)')
  result={result:'PASS',directory,serverSha256:createHash('sha256').update(await readFile(binary)).digest('hex'),invalidStartup:invalid,httpCases,ownAndRealHostnameAccepted:true,explicitAliasesAccepted:true,unlistedHostDeniedBeforeAuthAndStatic:true,matchingOriginDoesNotAuthorizeHost:true,forwardedHeadersDoNotAuthorizeHost:true,wrongAliasPortAndDuplicateHostDenied:true,hostGuardBeforeCorsPreflight:true,preflightNotAuthentication:true,ownAndAliasWsAccepted:true,unlistedWsDenied:true,unlistedHostLoginCreatesNoSessionOrCookie:true,asRun:0,engineDisabled:true,browserValidated:false,physicalSignalValidated:false,scope:'Compiled loopback Host/auth/HTTP/WS only; no real DNS rebinding, TLS proxy, browser or physical signal qualification.'}
}catch(error){failure=error;throw error}
finally{
  socket?.terminate();await stop();database?.sqlite.close()
  await writeFile(join(directory,'result.json'),JSON.stringify({...result??{result:'FAIL',directory,invalidStartup:invalid,httpCases},error:failure?String(failure):null,ownServerExitObserved:true},null,2))
  await writeFile(join(directory,'valid-server.log'),logs)
}
console.log(JSON.stringify({result:result!.result,directory,invalidConfigurations:invalid.length,httpCases:httpCases.length,ownAndAliasWsAccepted:true,unlistedWsDenied:true,ownServerExitObserved:true,serverSha256:result!.serverSha256}))
