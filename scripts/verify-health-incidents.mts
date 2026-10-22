import assert from 'node:assert/strict'
import {spawn,type ChildProcess} from 'node:child_process'
import {mkdtemp,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createServer} from 'node:net'
import {randomUUID} from 'node:crypto'

// Compiled server, own DB/accounts, no engine or outgoing integrations.
const root=fileURLToPath(new URL('..',import.meta.url))
const directory=await mkdtemp(join(tmpdir(),'RPlayout-health-incidents-'))
const dbFile=join(directory,'service.db'),vault=join(directory,'vault.json'),token=randomUUID()
process.env.RPLAYOUT_VAULT_FILE=vault;delete process.env.RPLAYOUT_VAULT_KEY
const {openDatabase}=await import('../apps/server/src/db/client.js')
const {healthEvents,operatorDecisions}=await import('../apps/server/src/db/schema.js')
const {sessionDigest}=await import('../apps/server/src/domain/access.js')
const database=openDatabase(dbFile)
database.sqlite.exec("INSERT INTO users VALUES('u','Supervisor de prova','NO_LOGIN','SUPERVISOR',1,'now')")
database.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest(token),'u','2099-01-01','now')
database.sqlite.prepare('INSERT INTO user_access(user_id,channel_ids,station_ips,updated_at) VALUES(?,?,NULL,?)').run('u','["a"]','now')
for(const [id,channelId]of [['allowed','a'],['denied','b'],['global',null],['audit-failure','a']] as const){
  database.db.insert(healthEvents).values({id,channelId,component:'ENGINE',state:'NO_VIDEO',severity:'CRITICAL',message:id,occurredAt:'2026-10-10T00:00:00.000Z'}).run()
}
database.sqlite.close()
let child:ChildProcess|null=null,logs='',serverPort=0
const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^RPLAYOUT_|^VITEST$/i.test(key))),RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_DB:dbFile,RPLAYOUT_VAULT_FILE:vault,RPLAYOUT_MEDIA:join(directory,'media'),RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_CACHE_DIR:join(directory,'cache'),RPLAYOUT_BACKUP_DIR:join(directory,'backups'),RPLAYOUT_ENGINE:'',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_PROXY:'',RPLAYOUT_PROBE:'',RPLAYOUT_DEVICES:'',RPLAYOUT_RELAY:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_BACKUP_HOURS:'0',HOST:'127.0.0.1',LOG_LEVEL:'warn'}
async function start(){
  const listener=createServer();await new Promise<void>(resolve=>listener.listen(0,'127.0.0.1',resolve));serverPort=(listener.address() as {port:number}).port;await new Promise<void>(resolve=>listener.close(()=>resolve()))
  child=spawn(process.execPath,['-e',"process.on('message',m=>{if(m==='own-shutdown')process.emit('SIGTERM')});require(process.argv[1])",join(root,'apps/server/dist/server.cjs')],{cwd:directory,env:{...env,PORT:String(serverPort)},windowsHide:true,stdio:['ignore','pipe','pipe','ipc']})
  for(const stream of [child.stdout,child.stderr])stream?.on('data',chunk=>logs=(logs+String(chunk)).slice(-16000))
  const expires=performance.now()+30000
  while(performance.now()<expires){if(child.exitCode!==null)throw new Error('Own server exited '+logs);try{if((await fetch(`http://127.0.0.1:${serverPort}/api/health`)).ok)return}catch{}await new Promise(resolve=>setTimeout(resolve,100))}
  throw new Error('Own server readiness timeout '+logs)
}
async function stop(){if(child&&child.exitCode===null&&child.signalCode===null){const own=child;await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{own.kill();reject(new Error('Own graceful shutdown timed out'))},10000);own.once('exit',()=>{clearTimeout(timer);resolve()});own.send('own-shutdown')})}child=null}
async function api(path:string,method='GET'){const response=await fetch(`http://127.0.0.1:${serverPort}${path}`,{method,headers:{cookie:'rplayout_session='+token,...(method==='POST'?{'content-type':'application/json'}:{})},...(method==='POST'?{body:'{}'}:{}),signal:AbortSignal.timeout(5000)});return {status:response.status,text:await response.text(),cacheControl:response.headers.get('cache-control')}}
let result:Record<string,unknown>={result:'FAIL',directory,pgmEngineEnabled:false}
try{
  await start()
  const list=await api('/api/health-events');assert.equal(list.status,200);assert.equal(list.cacheControl,'private, no-store');const events=JSON.parse(list.text).events
  assert.deepEqual(events.map((row:any)=>row.id).sort(),['allowed','audit-failure'])
  const csv=await api('/api/health-events.csv');assert.equal(csv.status,200);assert.ok(csv.text.includes('allowed')&&!csv.text.includes('denied')&&!csv.text.includes('global'))
  const first=await api('/api/health-events/allowed/ack','POST');assert.equal(first.status,200);const receipt=JSON.parse(first.text);assert.equal(receipt.deduplicated,false);assert.equal(receipt.signalRecovered,false)
  const denied=await api('/api/health-events/denied/ack?channelId=a','POST');assert.equal(denied.status,403)
  const global=await api('/api/health-events/global/ack?channelId=a','POST');assert.equal(global.status,403)
  const missing=await api('/api/health-events/missing/ack?channelId=a','POST');assert.equal(missing.status,404)
  // Payloads are encrypted in production: never apply JSON functions to ciphertext.
  const fault=openDatabase(dbFile)
  try{fault.sqlite.exec("CREATE TRIGGER fixture_audit_failure BEFORE INSERT ON operator_decisions WHEN NEW.kind='HEALTH_EVENT_ACKNOWLEDGED' BEGIN SELECT RAISE(ABORT,'own fixture audit failure'); END")}finally{fault.sqlite.close()}
  const failure=await api('/api/health-events/audit-failure/ack','POST');assert.equal(failure.status,409)
  await stop();await start()
  const replay=await api('/api/health-events/allowed/ack','POST');assert.equal(replay.status,200);assert.deepEqual(JSON.parse(replay.text),{...receipt,deduplicated:true})
  const read=openDatabase(dbFile)
  try{
    const decisions=read.db.select().from(operatorDecisions).all().filter(row=>row.kind==='HEALTH_EVENT_ACKNOWLEDGED')
    assert.equal(decisions.length,1);assert.equal(decisions[0]!.actorUsername,'Supervisor de prova');assert.equal(decisions[0]!.payload.eventId,'allowed')
    assert.deepEqual(read.sqlite.prepare('SELECT acknowledged_at FROM health_events WHERE id=?').get('audit-failure'),{acknowledged_at:null})
    assert.equal((read.sqlite.prepare('SELECT count(*) AS n FROM as_run').get() as {n:number}).n,0)
    result={result:'PASS',directory,compiledServer:true,pgmEngineEnabled:false,asRunCount:0,acknowledgementPersistedAfterRestart:true,originalTimestampPreserved:true,auditActorPersisted:true,ackAuditRows:1,deniedStatus:denied.status,globalStatus:global.status,missingStatus:missing.status,auditFailureStatus:failure.status,auditFailurePreservedUnacknowledged:true,physicalSignalValidated:false,browserValidated:false}
  }finally{read.sqlite.close()}
}finally{await stop();result={...result,ownServerExitObserved:true};await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));await writeFile(join(directory,'server.log'),logs);console.log(JSON.stringify(result))}
