import assert from 'node:assert/strict'
import {spawn,type ChildProcess} from 'node:child_process'
import {createServer,request as forward} from 'node:http'
import {connect,createServer as portServer,type Socket} from 'node:net'
import {mkdtemp,mkdir,writeFile,stat,readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {randomUUID,createHash} from 'node:crypto'
import {openDatabase} from '../apps/server/src/db/client.js'
import {channels,rundowns,rundownItems} from '../apps/server/src/db/schema.js'
import {readEditorialState} from '../apps/server/src/domain/editorial-state.js'
import {publishOperationalPlaylist} from '../apps/server/src/domain/operational-playlist.js'
import {hashPassword} from '../apps/server/src/domain/auth.js'

// Isolated UI proof only. No decoder, MediaMTX, external output or production
// database. Delay readonly calls, never alter mutation responses/semantics.
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(root,'scratch','operational-review-browser-'))
const stopFile=join(directory,'stop.json'),dbPath=join(directory,'publication.db'),media=join(directory,'media')
await mkdir(media);process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json')
const database=openDatabase(dbPath),stamp=new Date().toISOString(),today=new Date()
const date=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`
database.sqlite.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('qa-publication','publication-verifier',await hashPassword('Local-publication-QA-20261014'),'ADMIN',1,stamp)
database.db.insert(channels).values({id:'qa',name:'Publicação isolada',rateNum:25,rateDen:1,width:320,height:180,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:stamp}).run()
database.db.insert(rundowns).values({id:'rd',channelId:'qa',name:'Grade de conferência',date,plannedStart:0,loop:false,createdAt:stamp,updatedAt:stamp}).run()
database.db.insert(rundownItems).values({id:'live',rundownId:'rd',sortOrder:0,title:'Estúdio publicado A',type:'LIVE',sourceRef:'ndi:QA-NOT-TRANSMITTING',durationOverride:1500,minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',locked:false,autoNext:false,loop:false}).run()
const channel=readEditorialState(database.db,'rd')!.channel
await publishOperationalPlaylist(database.db,channel,'rd','fixture-seed')
database.sqlite.prepare('UPDATE rundown_items SET title=? WHERE id=?').run('Estúdio publicado B','live')
await publishOperationalPlaylist(database.db,channel,'rd','fixture-seed')
database.sqlite.prepare('UPDATE rundown_items SET title=? WHERE id=?').run('Estúdio editorial C','live')
const before=database.sqlite.prepare('SELECT id,payload FROM operational_playlist_revisions ORDER BY revision').all()
const reserved=portServer();await new Promise<void>(resolve=>reserved.listen(0,'127.0.0.1',resolve))
const port=(reserved.address() as {port:number}).port;await new Promise<void>(resolve=>reserved.close(()=>resolve()))
let child:ChildProcess|null=null,logs='',failure:unknown=null,simulationCalls=0,rollbackCalls=0,delayPostCommitRead=false,postCommitDelayed=false
const events:Array<{method:string;path:string;event:string;status?:number;at:string}>=[],sockets=new Set<Socket>()
const gateway=createServer((req,res)=>{
  const path=req.url??'/',method=req.method??'GET'
  const simulation=method==='GET'&&path==='/api/rundowns/rd/operational-simulation'
  const rollback=method==='GET'&&path.startsWith('/api/rundowns/rd/operational-rollback-review?')
  const postCommit=method==='GET'&&path==='/api/rundowns/rd'&&delayPostCommitRead&&!postCommitDelayed
  const delayed=(simulation&&++simulationCalls<=2)||(rollback&&++rollbackCalls===1)||postCommit
  if(delayed){
    if(postCommit)postCommitDelayed=true
    events.push({method,path,event:'DELAY_STARTED',at:new Date().toISOString()})
    const timer=setTimeout(()=>{events.push({method,path,event:'DELAY_EXPIRED',at:new Date().toISOString()});res.writeHead(504);res.end('{}')},20000)
    res.on('close',()=>{clearTimeout(timer);events.push({method,path,event:'CLIENT_CLOSED',at:new Date().toISOString()})})
    return
  }
  const upstream=forward({hostname:'127.0.0.1',port,path,method,headers:req.headers},response=>{
    if(method==='POST'&&path==='/api/rundowns/rd/operational-publish'&&response.statusCode===201)delayPostCommitRead=true
    if(method==='POST')events.push({method,path,event:'FORWARDED_RESPONSE',status:response.statusCode,at:new Date().toISOString()})
    res.writeHead(response.statusCode??502,response.headers);response.pipe(res)
  })
  upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('{}')})
  res.on('close',()=>{if(!res.writableFinished)upstream.destroy()});req.pipe(upstream)
})
gateway.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket))})
gateway.on('upgrade',(req,socket,head)=>{
  const upstream=connect(port,'127.0.0.1',()=>{
    upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`+req.rawHeaders.reduce((value,part,index)=>value+part+(index%2?'\r\n':': '),'')+'\r\n')
    if(head.length)upstream.write(head);socket.pipe(upstream);upstream.pipe(socket)
  })
  upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());socket.on('close',()=>upstream.destroy())
})
try{
  const environment={...process.env};for(const name of Object.keys(environment))if(name.startsWith('RPLAYOUT_'))delete environment[name]
  child=spawn(process.execPath,[join(root,'apps/server/dist/server.cjs')],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...environment,
    RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_DB:dbPath,RPLAYOUT_VAULT_FILE:join(directory,'vault.json'),RPLAYOUT_MEDIA:media,
    RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_CACHE_DIR:join(directory,'cache'),RPLAYOUT_BACKUP_DIR:join(directory,'backups'),
    RPLAYOUT_ENGINE:'',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_DEVICES:'',RPLAYOUT_RELAY:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_BACKUP_HOURS:'0',RPLAYOUT_ADMIN_USER:'',RPLAYOUT_ADMIN_PASSWORD:'',HOST:'127.0.0.1',PORT:String(port),LOG_LEVEL:'warn'}})
  for(const stream of [child.stdout,child.stderr])stream?.on('data',chunk=>logs=(logs+String(chunk)).slice(-16000))
  const deadline=performance.now()+30000;let ready=false
  while(performance.now()<deadline){assert.equal(child.exitCode,null,logs);try{ready=(await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(1000)})).ok}catch{}if(ready)break;await new Promise(resolve=>setTimeout(resolve,100))}
  assert.ok(ready,'Own backend readiness');await new Promise<void>(resolve=>gateway.listen(0,'127.0.0.1',resolve))
  console.log(JSON.stringify({status:'BROWSER_REVIEW_READY',directory,url:`http://127.0.0.1:${(gateway.address() as {port:number}).port}/?workspace=playlist`,fixtureUser:'publication-verifier',fixturePassword:'Local-publication-QA-20261014',stopFile,pgmDisabled:true,seedRevisions:2}))
  const expires=performance.now()+600000
  while(performance.now()<expires){assert.equal(child.exitCode,null,logs);try{await stat(stopFile);break}catch{}await new Promise(resolve=>setTimeout(resolve,200))}
}catch(error){failure=error;throw error}
finally{
  for(const socket of sockets)socket.destroy();if(gateway.listening)await new Promise<void>(resolve=>gateway.close(()=>resolve()))
  if(child&&child.exitCode===null&&child.signalCode===null){const exited=new Promise<void>(resolve=>child!.once('exit',()=>resolve()));child.kill();await exited}
  const revisions=database.db.select().from((await import('../apps/server/src/db/schema.js')).operationalPlaylistRevisions).all().map(row=>({id:row.id,revision:row.revision,active:row.active,payload:row.payload}))
  const result={result:failure?'FAIL':'FIXTURE_COMPLETED',directory,events,seedRevisionsUnchanged:JSON.stringify(database.sqlite.prepare('SELECT id,payload FROM operational_playlist_revisions WHERE revision<=2 ORDER BY revision').all())===JSON.stringify(before),revisions,
    editorial:database.sqlite.prepare('SELECT id,title FROM rundown_items').all(),audit:database.sqlite.prepare("SELECT kind,actor_username FROM operator_decisions WHERE kind LIKE 'OPERATIONAL_PLAYLIST_%'").all(),asRun:database.sqlite.prepare('SELECT count(*) AS count FROM as_run').get(),browserValidated:false,physicalOutputValidated:false,engineDisabled:true,serverExitObserved:true,
    webAssetHash:createHash('sha256').update(await readFile(join(root,'apps/web/dist/assets',/assets\/(index-[^" ]+\.js)/.exec(await readFile(join(root,'apps/web/dist/index.html'),'utf8'))![1]!))).digest('hex'),error:failure?String(failure):null}
  database.sqlite.close();await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));await writeFile(join(directory,'server.log'),logs);console.log(JSON.stringify({result:result.result,directory,revisions:revisions.map(row=>({revision:row.revision,active:row.active})),seedRevisionsUnchanged:result.seedRevisionsUnchanged,asRun:result.asRun,serverExitObserved:true}))
}
