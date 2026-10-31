import assert from 'node:assert/strict'
import {spawn,type ChildProcess} from 'node:child_process'
import {createServer,request as forward} from 'node:http'
import {connect,createServer as reserveServer,type Socket} from 'node:net'
import {mkdtemp,mkdir,readFile,writeFile,stat,copyFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'

// Installed product + own HTTP fault gateway and recipient. No operational
// account/media/configuration, external destination, engine or physical output.
const workspace=fileURLToPath(new URL('..',import.meta.url)),installed=resolve(process.argv[2]??'')
assert.ok(process.argv.slice(3).every(arg=>['--source-web','--empty-scan','--editorial-editors'].includes(arg)),'Unknown QA option')
const editorialEditors=process.argv.includes('--editorial-editors')
const emptyScanMode=process.argv.includes('--empty-scan')
assert.ok(!(emptyScanMode&&editorialEditors),'Separate editor tests from scanner/probe execution')
const scanProbe=join(installed,'apps/engine/target/release/rplayout-probe.exe')
if(emptyScanMode)assert.ok((await stat(scanProbe)).isFile())
const sourceWebOverride=process.argv.includes('--source-web'),webRoot=sourceWebOverride?workspace:installed
const webIndex=await readFile(join(webRoot,'apps/web/dist/index.html'),'utf8')
const webAsset=webIndex.match(/src="([^"?]+\.js)"/)?.[1]
assert.ok(webAsset&&webAsset.startsWith('/assets/')&&!webAsset.includes('..'))
const webSha=createHash('sha256').update(await readFile(join(webRoot,'apps/web/dist',webAsset))).digest('hex')
assert.ok(installed.startsWith(join(workspace,'scratch')+'\\'))
assert.equal(resolve(process.execPath).toLowerCase(),join(installed,'runtime/node/node.exe').toLowerCase())
const binary=join(installed,'apps/server/dist/server.cjs')
const serverSha=createHash('sha256').update(await readFile(binary)).digest('hex')
assert.equal(serverSha,'5f33c58e58e2d26294fad3eff71f994c82d093ae0f6159dac91bde8508a64607')
const directory=await mkdtemp(join(workspace,'scratch','editorial-read-browser-')),media=join(directory,'Acervo São José Çãó')
await mkdir(join(media,'Região Óptica'),{recursive:true})
const controlFile=join(directory,'control.json'),stopFile=join(directory,'stop.json')
let control={phase:editorialEditors?'editor-reviews-timeout':emptyScanMode?'scan-review-timeout':'category-list-timeout',hang:editorialEditors?['METADATA_REVIEW','REMOVAL_REVIEW','GRAPHICS_REVIEW','RULES_REVIEW','GRAPHIC_COMMANDS']:[emptyScanMode?'SCAN_REVIEW':'CATEGORY_LIST'],drop:[] as string[]}
await writeFile(controlFile,JSON.stringify(control))
const classes=new Set(['CATEGORY_LIST','CATEGORY_REVIEW','ROOT_CATALOG','ROOT_BROWSE','ROOT_ADD','INTEGRATION_LIST','DELIVERY_LIST','INTEGRATION_CATALOG','INTEGRATION_REVIEW','DELIVERY_REVIEW','SCAN_REVIEW','SCAN_COMMAND','SCAN_RECOVER','METADATA_REVIEW','REMOVAL_REVIEW','GRAPHICS_REVIEW','RULES_REVIEW','GRAPHIC_COMMANDS'])
function classify(url:string){
  const path=url.split('?')[0]!
  if(/^\/api\/assets\/[^/]+\/metadata-review$/.test(path))return 'METADATA_REVIEW'
  if(path==='/api/assets/prune-review'||/^\/api\/assets\/[^/]+\/removal-review$/.test(path))return 'REMOVAL_REVIEW'
  if(path==='/api/graphics/review')return 'GRAPHICS_REVIEW'
  if(/^\/api\/channels\/[^/]+\/rules$/.test(path))return 'RULES_REVIEW'
  if(/^\/api\/channels\/[^/]+\/graphic-commands$/.test(path))return 'GRAPHIC_COMMANDS'
  if(path==='/api/library/scan/review')return 'SCAN_REVIEW'
  if(path==='/api/library/scan')return 'SCAN_COMMAND'
  if(path==='/api/library/scan/recover')return 'SCAN_RECOVER'
  if(path==='/api/categories')return 'CATEGORY_LIST'
  if(/^\/api\/categories\/[^/]+\/review$/.test(path))return 'CATEGORY_REVIEW'
  if(path==='/api/library/roots/review')return 'ROOT_CATALOG'
  if(path==='/api/library/roots/browse')return 'ROOT_BROWSE'
  if(path==='/api/library/roots/add-review')return 'ROOT_ADD'
  if(path==='/api/integrations')return 'INTEGRATION_LIST'
  if(path==='/api/integration-deliveries')return 'DELIVERY_LIST'
  if(path==='/api/integrations/review')return 'INTEGRATION_CATALOG'
  if(/^\/api\/integrations\/[^/]+\/review$/.test(path))return 'INTEGRATION_REVIEW'
  if(/^\/api\/integration-deliveries\/[^/]+\/review$/.test(path))return 'DELIVERY_REVIEW'
  return path
}
async function readControl(){
  try{const next=JSON.parse(await readFile(controlFile,'utf8'));assert.ok(typeof next.phase==='string'&&next.phase.length<100&&Array.isArray(next.hang)&&next.hang.every((key:unknown)=>typeof key==='string'&&classes.has(key)));assert.ok(next.drop===undefined||Array.isArray(next.drop)&&next.drop.every((key:unknown)=>typeof key==='string'&&classes.has(key)));control={...next,drop:next.drop??[]}}catch{}
  return {...control,hang:[...control.hang]}
}
const events:Array<Record<string,unknown>>=[],received:Array<{id:string;type:string;idempotencyKey:string}>=[],sockets=new Set<Socket>(),active=new Map<string,number>(),maximum=new Map<string,number>()
const recipient=createServer(async(req,res)=>{
  if(req.method!=='POST'||req.url!=='/PRIVATE_QA_PATH?token=PRIVATE_QA_TOKEN'){res.writeHead(404);res.end();return}
  let body='';for await(const chunk of req){body+=String(chunk);if(body.length>32768){res.writeHead(413);res.end();return}}
  try{const value=JSON.parse(body),key=req.headers['idempotency-key'];assert.equal(value.type,'rplayout.test');assert.equal(typeof value.id,'string');assert.equal(key,value.id);received.push({id:value.id,type:value.type,idempotencyKey:String(key)});res.writeHead(204);res.end()}
  catch{res.writeHead(400);res.end()}
})
let backendPort=0
const gateway=createServer(async(req,res)=>{
  const url=req.url??'/',kind=classify(url),state=await readControl(),key=state.phase+':'+kind
  const entry:Record<string,unknown>={kind,phase:state.phase,method:req.method,startedAt:Date.now(),fault:req.method==='GET'&&state.hang.includes(kind)}
  if(events.length<2000)events.push(entry)
  active.set(key,(active.get(key)??0)+1);maximum.set(key,Math.max(maximum.get(key)??0,active.get(key)!))
  let timer:ReturnType<typeof setTimeout>|undefined
  res.once('close',()=>{if(timer)clearTimeout(timer);active.set(key,active.get(key)!-1);entry.closedAt=Date.now();entry.finished=res.writableFinished;entry.durationMs=Number(entry.closedAt)-Number(entry.startedAt)})
  if(entry.fault){timer=setTimeout(()=>{entry.status=504;res.writeHead(504);res.end('{}')},25000);return}
  if(req.method==='POST'&&['SCAN_COMMAND','SCAN_RECOVER'].includes(kind)){
    const hash=createHash('sha256');req.on('data',chunk=>hash.update(chunk));req.on('end',()=>{entry.requestBodySha256=hash.digest('hex')})
  }
  const upstream=forward({hostname:'127.0.0.1',port:backendPort,path:url,method:req.method,headers:req.headers},response=>{
    entry.upstreamStatus=response.statusCode
    if(req.method==='POST'&&state.drop.includes(kind)){
      response.resume();response.once('end',()=>{entry.responseReplacedAfterUpstreamCompleted=true;entry.status=502;res.writeHead(502,{'content-type':'application/json'});res.end(JSON.stringify({error:'Resposta sintética perdida após registro no servidor; confira o mesmo pedido.'}))})
    }else{entry.status=response.statusCode;res.writeHead(response.statusCode??502,response.headers);response.pipe(res)}
  })
  upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('{}')});res.on('close',()=>{if(!res.writableFinished)upstream.destroy()});req.pipe(upstream)
})
for(const server of [recipient,gateway])server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket))})
gateway.on('upgrade',(req,socket,head)=>{
  const upstream=connect(backendPort,'127.0.0.1',()=>{upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`+req.rawHeaders.reduce((value,part,index)=>value+part+(index%2?'\r\n':': '),'')+'\r\n');if(head.length)upstream.write(head);socket.pipe(upstream);upstream.pipe(socket)})
  upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());socket.on('close',()=>upstream.destroy())
})
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json');delete process.env.RPLAYOUT_VAULT_KEY
const {openDatabase}=await import('../apps/server/src/db/client.js'),{hashPassword}=await import('../apps/server/src/domain/auth.js')
const {integrations,integrationDeliveries,operatorDecisions,mediaAssets,graphicTemplates,scheduleRules}=await import('../apps/server/src/db/schema.js')
const database=openDatabase(join(directory,'service.db')),stamp=new Date().toISOString()
database.sqlite.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('qa-admin','editorial-verifier',await hashPassword('Local-editorial-read-20261015'),'ADMIN',1,stamp)
database.sqlite.exec("INSERT INTO channels(id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES('qa','QA editorial only',25,1,320,180,-23,-1,5,'now'); INSERT INTO rundowns(id,channel_id,name,planned_start,date,created_at,updated_at) VALUES('rd','qa','QA editorial',0,'2026-10-15','now','now')")
database.sqlite.prepare('INSERT INTO categories VALUES(?,?,?)').run('Jornal São José Çãó','#5b8fd6',stamp)
let editorMediaHash:string|null=null
if(editorialEditors){
  const source=join(workspace,'scratch/RPlayout-ingest-qc-take-ec33c0/Acervo-ação-ÇÃO/Programação-ação-ÇÃO.mkv'),path=join(media,'Vídeo QA São José Çãó.mkv')
  editorMediaHash=createHash('sha256').update(await readFile(source)).digest('hex')
  assert.equal(editorMediaHash,'ec95a8a728c7e83fb89d841983fe29e4818c52ff3387a441bcb467fe792721a2')
  await copyFile(source,path)
  database.db.insert(mediaAssets).values({id:'qa-editorial-asset',contentHash:editorMediaHash,path,title:'Vídeo QA São José Çãó',kind:'VIDEO',durationFrames:250,categoryId:'Jornal São José Çãó',qcStatus:'PENDING',createdAt:stamp}).run()
  database.db.insert(graphicTemplates).values({id:'qa-art',channelId:'qa',name:'Arte QA Çãó',svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><text x="10" y="20">QA</text></svg>',fields:[],fadeMs:300,holdSeconds:null,createdAt:stamp}).run()
  database.db.insert(scheduleRules).values({id:'qa-rule',channelId:'qa',name:'Faixa QA Çãó',weekdays:'0123456',startMinute:60,endMinute:120,categories:[],avoidHours:0,createdAt:stamp}).run()
  for(const phase of ['ACCEPTED','UNCERTAIN'])database.db.insert(operatorDecisions).values({id:'qa-command:'+phase,rundownId:'@graphics:qa',kind:'GRAPHIC_COMMAND_'+phase,actorUsername:'fixture-only',createdAt:stamp,payload:{channelId:'qa',native:false,selection:{action:'SHOW',templateId:'qa-art'},fixtureOnly:true}}).run()
}
let child:ChildProcess|null=null,logs='',failure:unknown=null
try{
  await new Promise<void>(resolve=>recipient.listen(0,'127.0.0.1',resolve));await new Promise<void>(resolve=>gateway.listen(0,'127.0.0.1',resolve))
  const recipientPort=(recipient.address() as {port:number}).port,gatewayPort=(gateway.address() as {port:number}).port
  const target=`http://127.0.0.1:${recipientPort}/PRIVATE_QA_PATH?token=PRIVATE_QA_TOKEN`
  database.db.insert(integrations).values({id:'qa-gateway',channelId:'qa',name:'Gateway QA',url:target,events:['rplayout.test'],enabled:false,createdAt:stamp}).run()
  database.db.insert(integrationDeliveries).values({id:'fixture-retry',integrationId:'qa-gateway',channelId:'qa',event:'rplayout.test',target,payload:{id:'fixture-retry',type:'rplayout.test',sentAt:stamp},manualTest:true,state:'FAILED',attempts:1,nextAttemptAt:stamp,lastError:'Falha sintética inicial; nenhum POST foi enviado.',createdAt:stamp}).run()
  const reserved=reserveServer();await new Promise<void>(resolve=>reserved.listen(0,'127.0.0.1',resolve));backendPort=(reserved.address() as {port:number}).port;await new Promise<void>(resolve=>reserved.close(()=>resolve()))
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^RPLAYOUT_|^NODE_PATH$|^NODE_OPTIONS$|^GST_|^GSTREAMER_/i.test(key)))
  // Explicit diagnostic web overlay: never overwrite the installed package.
  env.RPLAYOUT_INSTALL_ROOT=webRoot
  env.RPLAYOUT_PROBE=emptyScanMode?scanProbe:''
  child=spawn(process.execPath,[binary],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...env,PATH:join(installed,'runtime/node')+';'+join(process.env.SystemRoot!,'System32'),RPLAYOUT_DB:join(directory,'service.db'),RPLAYOUT_VAULT_FILE:join(directory,'vault.json'),RPLAYOUT_MEDIA:media,RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_CACHE_DIR:join(directory,'cache'),RPLAYOUT_BACKUPS:join(directory,'backups'),RPLAYOUT_ALLOWED_HOSTS:`127.0.0.1:${gatewayPort}`,RPLAYOUT_BACKUP_HOURS:'0',RPLAYOUT_ENGINE:'',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_DEVICES:'',RPLAYOUT_RELAY:'',RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:'',HOST:'127.0.0.1',PORT:String(backendPort),LOG_LEVEL:'warn'}})
  for(const stream of [child.stdout,child.stderr])stream?.on('data',chunk=>logs=(logs+String(chunk)).slice(-64000))
  const deadline=performance.now()+30000;let ready=false
  while(performance.now()<deadline){assert.equal(child.exitCode,null);try{ready=(await fetch(`http://127.0.0.1:${backendPort}/api/health`,{signal:AbortSignal.timeout(1000)})).ok}catch{}if(ready)break;await new Promise(resolve=>setTimeout(resolve,100))}
  assert.ok(ready,'Own installed backend readiness')
  await writeFile(join(directory,'launch.json'),JSON.stringify({directory,backendPort,gatewayPort,recipientPort,pid:child.pid,package:installed,serverSha,sourceWebOverride,webRoot,webAsset,webSha,emptyScanMode,editorialEditors},null,2))
  console.log(JSON.stringify({status:'EDITORIAL_READ_QA_READY',directory,url:`http://127.0.0.1:${gatewayPort}/?workspace=settings`,controlFile,stopFile,fixtureUser:'editorial-verifier',fixturePassword:'Local-editorial-read-20261015',scope:'Installed QA + synthetic HTTP recipient only; engine/outputs disabled; no operational account changes'}))
  const expires=performance.now()+1800000
  while(performance.now()<expires){assert.equal(child.exitCode,null);try{await stat(stopFile);break}catch{}await new Promise(resolve=>setTimeout(resolve,200))}
}catch(error){failure=error;throw error}
finally{
  for(const socket of sockets)socket.destroy()
  for(const server of [gateway,recipient])if(server.listening)await new Promise<void>(resolve=>server.close(()=>resolve()))
  if(child&&child.exitCode===null&&child.signalCode===null){const ended=new Promise<void>(resolve=>child!.once('exit',()=>resolve()));child.kill();await ended}
  const audits=database.db.select({kind:operatorDecisions.kind,actor:operatorDecisions.actorUsername}).from(operatorDecisions).all()
  if(editorialEditors){
    const asset=database.db.select().from(mediaAssets).all().find(row=>row.id==='qa-editorial-asset')!
    const actualMediaSha=createHash('sha256').update(await readFile(asset.path)).digest('hex')
    await writeFile(join(directory,'editors-evidence.json'),JSON.stringify({sourceWebOverride,webAsset,webSha,serverSha,editorMediaHash,actualMediaSha,asset:{id:asset.id,title:asset.title,categoryId:asset.categoryId,qcStatus:asset.qcStatus,ignored:asset.ignored,contentHash:asset.contentHash},templates:database.db.select({id:graphicTemplates.id,name:graphicTemplates.name,channelId:graphicTemplates.channelId}).from(graphicTemplates).all(),rules:database.db.select({id:scheduleRules.id,name:scheduleRules.name,channelId:scheduleRules.channelId}).from(scheduleRules).all(),scanBatches:database.sqlite.prepare('SELECT count(*) count FROM ingest_batches').get(),note:'Fixture seeds one media record, template, rule and an uncertain graphic ledger entry. No engine/probe/outputs. Media copied only from earlier synthetic QA.'},null,2))
  }
  if(emptyScanMode){
    const commands=database.db.select().from(operatorDecisions).all().filter(row=>['MEDIA_SCAN_QUEUED','MEDIA_SCAN_RECOVERY_REQUESTED'].includes(row.kind)).map(row=>({id:row.id,kind:row.kind,actor:row.actorUsername,batchId:row.payload.batchId,roots:row.payload.roots,measure:row.payload.measure}))
    await writeFile(join(directory,'scan-evidence.json'),JSON.stringify({sourceWebOverride,webAsset,webSha,serverSha,emptyScanMode,scanProbe,commands,batches:database.sqlite.prepare('SELECT id,state,roots,measure FROM ingest_batches ORDER BY created_at,id').all(),note:'Empty owned QA directories only; no native probe execution or media/signal certification'},null,2))
  }
  const result={result:failure?'FAIL':'FIXTURE_FINISHED',directory,package:installed,serverSha,sourceWebOverride,webRoot,webAsset,webSha,events,maximum:Object.fromEntries(maximum),received,integrations:database.db.select({id:integrations.id,name:integrations.name,enabled:integrations.enabled}).from(integrations).all(),deliveries:database.db.select({id:integrationDeliveries.id,state:integrationDeliveries.state,attempts:integrationDeliveries.attempts,manualTest:integrationDeliveries.manualTest}).from(integrationDeliveries).all(),audits,asRun:database.sqlite.prepare('SELECT count(*) count FROM as_run').get(),accountMutations:audits.filter(row=>['USER_CREATED','USER_UPDATED_SESSIONS_REVOKED','USER_ACCESS_CHANGED_SESSIONS_REVOKED','SESSIONS_REVOKED'].includes(row.kind)).length,serverExitObserved:true,engineDisabled:true,physicalSignalValidated:false,browserValidated:false,error:failure?String(failure):null}
  database.sqlite.close();await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));await writeFile(join(directory,'server.log'),logs);console.log(JSON.stringify({status:result.result,directory,httpEvents:events.length,receivedPosts:received.length,serverExitObserved:true}))
}
