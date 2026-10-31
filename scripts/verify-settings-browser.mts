import {spawn,type ChildProcess} from 'node:child_process'
import {mkdtemp,mkdir,readFile,writeFile,stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {randomUUID} from 'node:crypto'
import {createServer as netServer} from 'node:net'
import {createServer,request as forward} from 'node:http'
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(tmpdir(),'RPlayout-settings-browser-'))
const media=join(directory,'Inicial'),candidate=join(directory,'Acervo São José Çãó'),nested=join(candidate,'Região Óptica');await mkdir(media);await mkdir(nested,{recursive:true})
const vault=join(directory,'vault.json');process.env.RPLAYOUT_VAULT_FILE=vault;delete process.env.RPLAYOUT_VAULT_KEY
const {openDatabase}=await import('../apps/server/src/db/client.js'),{channels,rundowns}=await import('../apps/server/src/db/schema.js'),{hashPassword}=await import('../apps/server/src/domain/auth.js')
const database=openDatabase(join(directory,'service.db')),stamp=new Date().toISOString()
const incidentMode=process.argv.includes('--incidents')
const directMode=process.argv.includes('--direct')
const pollingMode=process.argv.includes('--incident-polling')
const pollControlFile=join(root,'scratch',`settings-browser-poll-${randomUUID()}.json`)
const healthReadMetrics={started:0,active:0,maxActive:0,aborted:0,completed:0}
let historyInjectionPerformed=false
database.sqlite.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('verifier','settings-verifier',await hashPassword('Local-settings-20261009'),'ADMIN',1,stamp)
for(const id of ['a','b']){
  database.db.insert(channels).values({id,name:'Canal isolado '+id.toUpperCase(),width:1920,height:1080,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:stamp}).run()
  database.db.insert(rundowns).values({id:'rd-'+id,channelId:id,name:'Grade vazia',date:'2026-10-09',plannedStart:0,loop:false,createdAt:stamp,updatedAt:stamp}).run()
}
const allocator=netServer();await new Promise<void>(resolve=>allocator.listen(0,'127.0.0.1',resolve));const port=(allocator.address() as {port:number}).port;await new Promise<void>(resolve=>allocator.close(()=>resolve()))
if(incidentMode){
  const {healthEvents}=await import('../apps/server/src/db/schema.js')
  for(const row of [
    {id:'pgm-signal:pending:active',state:'freeze',message:'Exemplo: congelamento pendente de reconhecimento'},
    {id:'pgm-signal:recovered:active',state:'black',message:'Exemplo: preto com recuperação medida',resolvedAt:stamp},
    {id:'pgm-signal:unobserved:active',state:'silence',message:'Exemplo: observação encerrada sem recuperação',acknowledgedAt:stamp,observationEndedAt:stamp},
    {id:'pgm-signal:acknowledged:active',state:'black',message:'Exemplo: reconhecido sem recuperação',acknowledgedAt:stamp},
    {id:'ack-failure',state:'failed',message:'Exemplo: falha de gravação ao reconhecer'}
  ])database.db.insert(healthEvents).values({channelId:'a',component:'SIGNAL',severity:'CRITICAL',occurredAt:stamp,...row,context:pollingMode&&row.id==='pgm-signal:pending:active'?{version:1,capturedAt:stamp,channelId:'a',rundownId:'rd-a',revisionId:'synthetic-edition',executionId:'synthetic-execution',itemId:'synthetic-item',itemName:'Jornal São José (contexto sintético)',elapsedFrames:50,engine:{ready:false,processPresent:false},sources:[{identity:'opaque-source',name:'Estúdio Óptico (sintético)',state:'UNKNOWN',pgm:null,pvw:null,pgmSelection:{identity:'opaque-profile',name:'Estúdio Óptico (sintético)',basis:'PUBLISHED_ITEM'}}],outputs:[{identity:'opaque-output',identityType:'PROFILE',name:'Saída principal (sintética)',state:'failed',hasError:true}],sourcesTruncated:false,outputsTruncated:false,physicalSignalValidated:false}:null}).run()
  database.db.insert(healthEvents).values({id:'other-channel',channelId:'b',component:'SIGNAL',state:'black',severity:'CRITICAL',message:'OUTRO_CANAL_NAO_EXIBIR_NO_A',occurredAt:stamp}).run()
  database.sqlite.exec("CREATE TRIGGER fixture_ack_failure BEFORE UPDATE ON health_events WHEN OLD.id='ack-failure' BEGIN SELECT RAISE(ABORT,'own fixture acknowledgement failure'); END")
  if(process.argv.includes('--incident-history')){
    for(let i=0;i<245;i++)database.db.insert(healthEvents).values({id:`history-${String(i).padStart(3,'0')}`,channelId:'a',component:'VIDEO',state:'running',severity:'INFO',message:`Histórico isolado ${String(i).padStart(3,'0')}`,occurredAt:new Date(Date.parse(stamp)-1000).toISOString()}).run()
    database.db.insert(healthEvents).values({id:'old-critical',channelId:'a',component:'SIGNAL',state:'black',severity:'CRITICAL',message:'Exemplo: crítico antigo ainda sem reconhecimento',occurredAt:new Date(Date.parse(stamp)-60000).toISOString()}).run()
  }
}
const empty={available:false,reason:'Fixture sem hardware',sources:[]}
// Only discovery is synthetic, never a claim of NDI/OMT signal availability.
const discovery={sdi:empty,sdiOutputs:empty,guests:empty,ndi:{available:true,reason:'Descoberta sintética para fluxo de nome',sources:[{reference:'ndi:SJOSE-A',label:'Estúdio São José NDI A',family:'NDI',discovery:'DISCOVERED'},{reference:'ndi:SJOSE-B',label:'Estúdio Óptico NDI B',family:'NDI',discovery:'DISCOVERED'}]},omt:{available:true,reason:'Descoberta sintética para fluxo de nome',sources:[{reference:'omt:REGIAO-01',label:'Região Óptica OMT',family:'OMT',discovery:'DISCOVERED'}]}}
const events:Array<object>=[],stopFile=join(root,'scratch',`settings-browser-stop-${randomUUID()}.json`)
let server:ChildProcess|null=null,logs='',result:Record<string,unknown>={result:'FAIL',directory}
const relay=createServer(async(req,res)=>{
  const url=req.url??'/'
  if(pollingMode&&req.method==='GET'&&/^\/api\/health-events(?:\?|$)/.test(url)){
    healthReadMetrics.started++;healthReadMetrics.active++;healthReadMetrics.maxActive=Math.max(healthReadMetrics.maxActive,healthReadMetrics.active)
    res.once('close',()=>{healthReadMetrics.active--;if(res.writableEnded)healthReadMetrics.completed++;else healthReadMetrics.aborted++})
    let control:{mode?:string;insertNewEvent?:boolean}={}
    try{control=JSON.parse(await readFile(pollControlFile,'utf8'))}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
    if(control.insertNewEvent&&!historyInjectionPerformed){
      const {healthEvents}=await import('../apps/server/src/db/schema.js')
      database.db.insert(healthEvents).values({id:'after-history-anchor',channelId:'a',component:'VIDEO',state:'running',message:'Evento novo após âncora histórica',occurredAt:new Date().toISOString()}).run();historyInjectionPerformed=true
    }
    events.push({url,method:req.method,fixtureReadMode:control.mode??'NORMAL'})
    if(control.mode==='HANG')return // Own fixture connection ends only on browser cancellation.
  }
  if(!directMode&&/^\/api\/sources(?:\?|$)/.test(url)){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(discovery));return}
  const upstream=forward({hostname:'127.0.0.1',port,path:url,method:req.method,headers:req.headers},response=>{res.writeHead(response.statusCode??502,response.headers);response.pipe(res);response.once('end',()=>{if(url.includes('/roots')||url.includes('/sources/live')||url.includes('/live-source-review')||url.includes('/health-events'))events.push({url,method:req.method,status:response.statusCode})})});upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end()});req.pipe(upstream)
})
try{
  // The own gateway has a different external port. Configure its explicit
  // authority rather than weakening the production Host policy for tests.
  if(!directMode)await new Promise<void>(resolve=>relay.listen(0,'127.0.0.1',resolve))
  const relayPort=directMode?port:(relay.address() as {port:number}).port
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^RPLAYOUT_|^VITEST$/i.test(key)))
  server=spawn(process.execPath,[join(root,'apps/server/dist/server.cjs')],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...env,RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_DB:join(directory,'service.db'),RPLAYOUT_VAULT_FILE:vault,RPLAYOUT_MEDIA:media,RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_CACHE_DIR:join(directory,'cache'),RPLAYOUT_BACKUPS:join(directory,'backups'),RPLAYOUT_ALLOWED_HOSTS:directMode?'':`127.0.0.1:${relayPort}`,RPLAYOUT_ENGINE:'',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_PROXY:'',RPLAYOUT_PROBE:'',RPLAYOUT_DEVICES:'',RPLAYOUT_RELAY:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_BACKUP_HOURS:'0',HOST:'127.0.0.1',PORT:String(port),LOG_LEVEL:'warn'}})
  for(const stream of [server.stdout,server.stderr])stream?.on('data',chunk=>logs=(logs+String(chunk)).slice(-16000))
  const deadline=performance.now()+30000
  while(true){if(server.exitCode!==null)throw new Error(logs);try{if((await fetch(`http://127.0.0.1:${port}/api/health`)).ok)break}catch{}if(performance.now()>deadline)throw new Error('Server readiness '+logs);await new Promise(resolve=>setTimeout(resolve,150))}
  result={result:'ISOLATED_SETTINGS_READY',directory,candidate,nested,directMode,syntheticDiscovery:!directMode,syntheticIncidents:incidentMode,pgmEngineNotEnabled:true,browserValidated:false}
  console.log(JSON.stringify({...result,url:`http://127.0.0.1:${relayPort}/?workspace=settings`,fixtureUser:'settings-verifier',fixturePassword:'Local-settings-20261009',stopFile,pollControlFile:pollingMode?pollControlFile:undefined}))
  const expires=performance.now()+600000
  while(performance.now()<expires){if(server.exitCode!==null)throw new Error(logs);try{await stat(stopFile);break}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}await new Promise(resolve=>setTimeout(resolve,150))}
  result={...result,roots:database.sqlite.prepare('SELECT path,label FROM media_roots').all(),liveSources:database.sqlite.prepare('SELECT channel_id,name,kind FROM live_sources').all(),events,asRun:database.sqlite.prepare('SELECT count(*) as count FROM as_run').get(),healthRows:incidentMode?database.sqlite.prepare('SELECT id,channel_id,acknowledged_at,resolved_at,observation_ended_at FROM health_events').all():undefined,healthAckAudits:incidentMode?database.sqlite.prepare("SELECT actor_username FROM operator_decisions WHERE kind='HEALTH_EVENT_ACKNOWLEDGED'").all():undefined}
  result={...result,pollingMode,healthReadMetrics,historyInjectionPerformed,contextRows:pollingMode?database.sqlite.prepare('SELECT id FROM health_events WHERE context IS NOT NULL').all():undefined}
  const {operatorDecisions}=await import('../apps/server/src/db/schema.js')
  result={...result,categories:database.sqlite.prepare('SELECT * FROM categories').all(),editorialAudits:database.db.select({kind:operatorDecisions.kind,actor:operatorDecisions.actorUsername}).from(operatorDecisions).all().filter(row=>row.kind.startsWith('CATEGORY_')||row.kind.startsWith('MEDIA_ROOT_')||row.kind.startsWith('MEDIA_SCAN_')),accountMutations:database.sqlite.prepare("SELECT count(*) count FROM operator_decisions WHERE kind IN ('USER_CREATED','USER_UPDATED_SESSIONS_REVOKED','USER_ACCESS_CHANGED_SESSIONS_REVOKED','SESSIONS_REVOKED')").get()}
}catch(error){result={...result,result:'FAIL',error:String(error)};throw error}
finally{
  if(relay.listening)await new Promise<void>(resolve=>relay.close(()=>resolve()))
  if(server&&server.exitCode===null&&server.signalCode===null){const ended=new Promise<void>(resolve=>server!.once('exit',()=>resolve()));server.kill('SIGKILL');await ended}
  result={...result,serverExitObserved:true};database.sqlite.close();await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));await writeFile(join(directory,'server.log'),logs);console.log(JSON.stringify(result))
}
