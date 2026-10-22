import assert from 'node:assert/strict'
import {spawn,type ChildProcess} from 'node:child_process'
import {createServer,request as forward} from 'node:http'
import {connect,createServer as portServer,type Socket} from 'node:net'
import {mkdtemp,mkdir,writeFile,stat} from 'node:fs/promises'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {randomUUID} from 'node:crypto'
import {openDatabase} from '../apps/server/src/db/client.js'
import {hashPassword} from '../apps/server/src/domain/auth.js'

// Gateway fault injection is test-only: delay first GET of each account read.
// The compiled backend, authentication and actual web build remain unmodified.
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(root,'scratch','account-read-browser-'))
const stopFile=join(root,'scratch',`account-read-stop-${randomUUID()}.json`)
const media=join(directory,'media');await mkdir(media)
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json')
const database=openDatabase(join(directory,'accounts.db')),now=new Date().toISOString()
database.sqlite.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('qa-admin','account-read-verifier',await hashPassword('Local-account-read-20261014'),'ADMIN',1,now)
database.sqlite.exec("INSERT INTO channels(id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES('qa','QA accounts only',25,1,320,180,-23,-1,5,'now'); INSERT INTO rundowns(id,channel_id,name,planned_start,date,created_at,updated_at) VALUES('rd','qa','QA accounts',0,'2026-10-14','now','now')")
const reserved=portServer();await new Promise<void>(resolve=>reserved.listen(0,'127.0.0.1',resolve))
const port=(reserved.address() as {port:number}).port;await new Promise<void>(resolve=>reserved.close(()=>resolve()))
let child:ChildProcess|null=null,logs='',failure:unknown=null
const events:Array<{path:string;event:string;at:string}>=[],delayed=new Set<string>(),sockets=new Set<Socket>()
const gateway=createServer((req,res)=>{
  const path=req.url??'/',fault=req.method==='GET'&&(path==='/api/users/review'||/^\/api\/users\/[^/]+\/sessions$/.test(path))
  if(fault&&!delayed.has(path)){
    delayed.add(path);events.push({path,event:'DELAY_STARTED',at:new Date().toISOString()})
    const timer=setTimeout(()=>{events.push({path,event:'DELAY_EXPIRED',at:new Date().toISOString()});res.writeHead(504);res.end('{}')},20000)
    res.on('close',()=>{clearTimeout(timer);events.push({path,event:'CLIENT_CLOSED',at:new Date().toISOString()})})
    return
  }
  const upstream=forward({hostname:'127.0.0.1',port,path,method:req.method,headers:req.headers},response=>{res.writeHead(response.statusCode??502,response.headers);response.pipe(res)})
  upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('{}')})
  res.on('close',()=>{if(!res.writableFinished)upstream.destroy()});req.pipe(upstream)
})
gateway.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket))})
gateway.on('upgrade',(req,socket,head)=>{
  const upstream=connect(port,'127.0.0.1',()=>{
    upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`+req.rawHeaders.reduce((value,part,index)=>value+part+(index%2?'\r\n':': '),'')+'\r\n')
    if(head.length)upstream.write(head)
    socket.pipe(upstream);upstream.pipe(socket)
  })
  upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());socket.on('close',()=>upstream.destroy())
})
try{
  child=spawn(process.execPath,[join(root,'apps/server/dist/server.cjs')],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,
    RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_DB:join(directory,'accounts.db'),RPLAYOUT_VAULT_FILE:join(directory,'vault.json'),RPLAYOUT_MEDIA:media,
    RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_CACHE_DIR:join(directory,'cache'),RPLAYOUT_BACKUP_DIR:join(directory,'backups'),
    RPLAYOUT_ENGINE:'',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_DEVICES:'',RPLAYOUT_RELAY:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_HA_ROLE:'',RPLAYOUT_HA_PEER:'',RPLAYOUT_BACKUP_HOURS:'0',RPLAYOUT_ADMIN_USER:'',RPLAYOUT_ADMIN_PASSWORD:'',HOST:'127.0.0.1',PORT:String(port),LOG_LEVEL:'warn'}})
  for(const stream of [child.stdout,child.stderr])stream?.on('data',chunk=>logs=(logs+String(chunk)).slice(-16000))
  const deadline=performance.now()+30000
  let ready=false
  while(performance.now()<deadline){assert.equal(child.exitCode,null,logs);try{ready=(await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(1000)})).ok}catch{}if(ready)break;await new Promise(resolve=>setTimeout(resolve,100))}
  assert.ok(ready,'Own backend readiness')
  await new Promise<void>(resolve=>gateway.listen(0,'127.0.0.1',resolve))
  const gatewayPort=(gateway.address() as {port:number}).port
  console.log(JSON.stringify({status:'BROWSER_REVIEW_READY',directory,url:`http://127.0.0.1:${gatewayPort}/?workspace=settings`,fixtureUser:'account-read-verifier',fixturePassword:'Local-account-read-20261014',stopFile,pgmDisabled:true,scope:'Test-only read latency; no account edits'}))
  const expires=performance.now()+300000
  while(performance.now()<expires){assert.equal(child.exitCode,null,logs);try{await stat(stopFile);break}catch{}await new Promise(resolve=>setTimeout(resolve,200))}
}catch(error){failure=error;throw error}
finally{
  for(const socket of sockets)socket.destroy()
  if(gateway.listening)await new Promise<void>(resolve=>gateway.close(()=>resolve()))
  if(child&&child.exitCode===null&&child.signalCode===null){const exited=new Promise<void>(resolve=>child!.once('exit',()=>resolve()));child.kill();await exited}
  const changes=database.sqlite.prepare("SELECT count(*) AS count FROM operator_decisions WHERE kind IN ('USER_CREATED','USER_UPDATED_SESSIONS_REVOKED','USER_ACCESS_CHANGED_SESSIONS_REVOKED','SESSIONS_REVOKED')").get()
  database.sqlite.close()
  const result={result:failure?'FAIL':'FIXTURE_COMPLETED',directory,events,accountMutations:changes,browserValidated:false,serverExitObserved:true,error:failure?String(failure):null}
  await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));await writeFile(join(directory,'server.log'),logs);console.log(JSON.stringify(result))
}
