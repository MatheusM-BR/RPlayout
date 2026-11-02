import {spawn,type ChildProcess} from 'node:child_process'
import {createServer} from 'node:net'
import {mkdtemp,mkdir,readFile,realpath} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {randomUUID,createHash} from 'node:crypto'
import assert from 'node:assert/strict'
import {openDatabase} from '../apps/server/src/db/client.js'
import {hashPassword} from '../apps/server/src/domain/auth.js'
import {sessionDigest} from '../apps/server/src/domain/access.js'
import {validateBackupRestore} from '../apps/server/src/domain/backup.js'
import {accountETag} from '../packages/protocol/src/account-review.js'

// Compiled HTTP/WS and persistence proof; no browser, decoder or HA qualification.
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(tmpdir(),'RPlayout-account-reviews-'))
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json')
const file=join(directory,'qa.db'),media=join(directory,'media');await mkdir(media)
const database=openDatabase(file),now=new Date().toISOString(),adminToken=randomUUID()+randomUUID(),adminHeaders={cookie:'rplayout_session='+adminToken},target='operador:ç',targetPath='/api/users/'+encodeURIComponent(target),targetPassword=randomUUID()+randomUUID()
for(const [id,role,password]of [['admin','ADMIN',randomUUID()], [target,'OPERATOR',targetPassword]])database.sqlite.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id,id,await hashPassword(password!),role,1,now)
database.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest(adminToken),'admin','2099-01-01',now)
for(const id of ['a','b'])database.sqlite.prepare('INSERT INTO channels(id,name,width,height,rate_num,rate_den,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,'Estúdio '+id,320,180,25,1,-23,-1,5,now)
database.sqlite.prepare('INSERT INTO rundowns(id,channel_id,name,date,planned_start,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('rd-a','a','SIMULATED NOT PHYSICAL',now.slice(0,10),0,now,now)
database.sqlite.prepare('INSERT INTO rundown_items(id,rundown_id,sort_order,type,title,source_ref,duration_override,min_duration,anchor,on_overrun,locked,auto_next,loop) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run('live-a','rd-a',0,'LIVE','SIMULATED NOT PHYSICAL','ndi:SIMULATED_NOT_PHYSICAL',150000,0,'{"kind":"FLOW"}','PUSH',0,0,0)
interface Station {port:number;child:ChildProcess|null;pids:number[];logs:string}
const stations:Station[]=[],ports=new Set<number>()
async function port(){for(;;){const socket=createServer();await new Promise<void>(resolve=>socket.listen(0,'127.0.0.1',resolve));const id=(socket.address()as {port:number}).port;await new Promise<void>(resolve=>socket.close(()=>resolve()));if(!ports.has(id)){ports.add(id);return id}}}
for(let n=0;n<2;n++)stations.push({port:await port(),child:null,pids:[],logs:''})
async function call(station:Station,path:string,method='GET',body?:object,etag?:string,expected=200,headers:Record<string,string>=adminHeaders){
  const response=await fetch(`http://127.0.0.1:${station.port}${path}`,{method,headers:{...headers,...(body?{'Content-Type':'application/json'}:{}),...(etag?{'If-Match':etag}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15_000)})
  const text=await response.text();if(expected!==0)assert.equal(response.status,expected,`${method} ${path}: ${response.status} ${text.slice(0,300)}`)
  return {status:response.status,value:JSON.parse(text),etag:response.headers.get('etag')!,cache:response.headers.get('cache-control'),cookie:response.headers.get('set-cookie')?.split(';')[0]}
}
async function start(station:Station){
  station.logs='';const child=spawn(process.execPath,[join(root,'apps/server/dist/server.cjs')],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,
    RPLAYOUT_DB:file,RPLAYOUT_VAULT_FILE:join(directory,'vault.json'),RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_MEDIA:media,
    RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_CACHE:join(directory,'cache'),RPLAYOUT_BACKUPS:join(directory,'backups'),
    RPLAYOUT_ENGINE:'',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_DEVICES:'',RPLAYOUT_RELAY:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_N1_PEER:'',RPLAYOUT_BACKUP_HOURS:'0',
    RPLAYOUT_HA_ROLE:'',RPLAYOUT_HA_PEER:'',RPLAYOUT_ADMIN_USER:'',RPLAYOUT_ADMIN_PASSWORD:'',RPLAYOUT_ROLE:'ADMIN',RPLAYOUT_CONTROL_TOKEN:'',HOST:'127.0.0.1',PORT:String(station.port),LOG_LEVEL:'warn'}})
  station.child=child;if(child.pid)station.pids.push(child.pid)
  child.stdout?.on('data',chunk=>station.logs=(station.logs+String(chunk)).slice(-8000));child.stderr?.on('data',chunk=>station.logs=(station.logs+String(chunk)).slice(-8000));child.on('error',error=>station.logs+=error.message)
  const deadline=performance.now()+25_000
  while(performance.now()<deadline){if(child.exitCode!==null)throw new Error(`Own compiled child exited: ${station.logs.slice(-3000)}`);try{if((await call(station,'/api/health')).value.ok)return}catch{}await new Promise(resolve=>setTimeout(resolve,100))}
  throw new Error(`Own compiled server not ready: ${station.logs.slice(-3000)}`)
}
async function stop(station:Station){const child=station.child;station.child=null;if(child&&child.exitCode===null&&child.signalCode===null){const ended=new Promise<void>(resolve=>child.once('exit',()=>resolve()));child.kill('SIGKILL');await ended}}
const state=()=>Object.fromEntries(['users','user_access','sessions','account_versions','channels'].map(table=>[table,database.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
const audits=()=>database.sqlite.prepare("SELECT * FROM operator_decisions WHERE kind IN ('USER_CREATED','USER_UPDATED_SESSIONS_REVOKED','USER_ACCESS_CHANGED_SESSIONS_REVOKED','SESSIONS_REVOKED','SESSION_ENDED') ORDER BY rowid").all()
let evidence:Record<string,unknown>|null=null,socket:{close():void}|null=null,sequence=0,latest:any=null
const targetSockets:Array<{close():void}>=[],revokedSocketCodes:number[]=[]
async function wait(check:()=>boolean,description:string){const deadline=performance.now()+10_000;while(performance.now()<deadline){if(check())return;await new Promise(resolve=>setTimeout(resolve,50))}throw new Error(description)}
async function after(previous:number){const deadline=performance.now()+10_000;while(performance.now()<deadline){if(sequence>previous&&latest)return latest.transport;await new Promise(resolve=>setTimeout(resolve,50))}throw new Error('No fresh SIMULATED telemetry')}
try {
  const [a,b]=stations as [Station,Station];await Promise.all(stations.map(start))
  const original=await call(a,'/api/users/review'),beforeRead=state();assert.equal(original.cache,'private, no-store');assert.deepEqual((await call(b,'/api/users/review')).value,original.value);assert.deepEqual(state(),beforeRead)
  for(const secret of [adminToken,targetPassword,sessionDigest(adminToken),'passwordHash','token'])assert.ok(!JSON.stringify(original.value).includes(secret))
  const draft={username:'Nova conta Çãó',password:randomUUID()+randomUUID(),role:'OPERATOR'}
  for(const operation of ['CREATE','UPDATE','ACCESS','REVOKE']) {
    const before=state(),success=audits()
    await call(a,operation==='CREATE'?'/api/users':operation==='ACCESS'?targetPath+'/access':operation==='REVOKE'?targetPath+'/sessions':targetPath,operation==='CREATE'?'POST':operation==='ACCESS'?'PUT':operation==='REVOKE'?'DELETE':'PATCH',operation==='CREATE'?draft:operation==='ACCESS'?{channelIds:null,stationIps:null}:operation==='REVOKE'?undefined:{enabled:false},undefined,428)
    assert.deepEqual(state(),before);assert.deepEqual(audits(),success)
  }
  const results=await Promise.all(stations.map(station=>call(station,'/api/users','POST',draft,original.etag,0)));assert.deepEqual(results.map(row=>row.status).sort(),[200,409]);assert.equal(audits().length,1)
  const old=await call(a,'/api/users/review');database.sqlite.prepare('UPDATE users SET role=? WHERE id=?').run('SUPERVISOR',target);database.sqlite.prepare('UPDATE users SET role=? WHERE id=?').run('OPERATOR',target)
  const abaState=state();await call(a,targetPath,'PATCH',{enabled:false},accountETag(old.value,target),409);assert.deepEqual(state(),abaState)
  const local=await call(a,'/api/users/review');await call(a,targetPath,'PATCH',{passwordHash:'FORGED'},accountETag(local.value,target),400)
  await call(a,'/api/users/admin','PATCH',{enabled:false},accountETag(local.value,'admin'),409)
  const targetLogin=async()=>{const result=await call(a,'/api/auth/login','POST',{username:target,password:targetPassword},undefined,200,{});assert.ok(result.cookie);return {cookie:result.cookie!}}
  const first=await targetLogin(),sessions=await call(a,targetPath+'/sessions');assert.equal(sessions.value.sessions.length,1)
  assert.ok(!JSON.stringify(sessions.value).includes(sessionDigest(first.cookie.slice(17))))
  const second=await targetLogin(),beforeNewSession=state();await call(a,targetPath+'/sessions','DELETE',undefined,sessions.etag,409);assert.deepEqual(state(),beforeNewSession)
  for(const operation of ['CREATE','UPDATE','ACCESS','REVOKE','LOGOUT']) {
    const review=await call(a,'/api/users/review'),sessionProof=await call(a,targetPath+'/sessions'),before=state(),success=audits()
    database.sqlite.exec("CREATE TRIGGER account_audit_failure BEFORE INSERT ON operator_decisions WHEN NEW.kind IN ('USER_CREATED','USER_UPDATED_SESSIONS_REVOKED','USER_ACCESS_CHANGED_SESSIONS_REVOKED','SESSIONS_REVOKED','SESSION_ENDED') BEGIN SELECT RAISE(ABORT,'ACCOUNT_AUDIT_FIXTURE'); END")
    const result=await call(a,operation==='CREATE'?'/api/users':operation==='ACCESS'?targetPath+'/access':operation==='REVOKE'?targetPath+'/sessions':operation==='LOGOUT'?'/api/auth/logout':targetPath,operation==='CREATE'||operation==='LOGOUT'?'POST':operation==='ACCESS'?'PUT':operation==='REVOKE'?'DELETE':'PATCH',operation==='CREATE'?{...draft,username:'Rollback'}:operation==='ACCESS'?{channelIds:null,stationIps:null}:operation==='REVOKE'?undefined:operation==='LOGOUT'?{}:{enabled:false},operation==='CREATE'?review.etag:operation==='REVOKE'?sessionProof.etag:accountETag(review.value,target),500)
    assert.equal(result.cookie,undefined);assert.deepEqual(state(),before);assert.deepEqual(audits(),success);database.sqlite.exec('DROP TRIGGER account_audit_failure')
  }
  const Ws=createRequire(await realpath(join(root,'apps/server/node_modules/@fastify/websocket/package.json')))('ws')
  const targetSocket=async(cookie:Record<string,string>)=>{
    const connection=new Ws(`ws://127.0.0.1:${a.port}/ws`,{headers:cookie});targetSockets.push(connection)
    let received=false,closed:number|undefined
    connection.on('error',()=>{});connection.on('close',(code:number)=>{closed=code})
    connection.on('message',(data:unknown)=>{if(JSON.parse(String(data)).type==='live')received=true})
    await wait(()=>received,'Own target session has no authenticated live telemetry')
    return async()=>{await wait(()=>closed!==undefined,'Revoked target socket did not close');assert.equal(closed,4401);revokedSocketCodes.push(closed!)}
  }
  const ws=new Ws(`ws://127.0.0.1:${a.port}/ws`,{headers:adminHeaders});socket=ws
  ws.on('error',()=>{});ws.on('message',(data:unknown)=>{
    const text=String(data);assert.ok(!text.includes(adminToken)&&!text.includes(targetPassword))
    const message=JSON.parse(text);if(message.type==='live'&&message.channelId==='a'){latest=message;sequence++}
  })
  await after(0)
  await call(a,'/api/channels/a/transport','POST',{action:'cue',sourceRef:'ndi:SIMULATED_NOT_PHYSICAL'});await call(a,'/api/channels/a/transport','POST',{action:'take'})
  const pvw=(await call(a,'/api/channels/a/transport','POST',{action:'cue',sourceRef:'ndi:SIMULATED_OTHER_PREVIEW'})).value.live.transport
  assert.equal(pvw.onAir.itemId,'live-a')
  assert.equal(pvw.playing,true)
  const assertAccessSocketRevoked=await targetSocket(first)
  const accessReview=await call(a,'/api/users/review');await call(a,targetPath+'/access','PUT',{channelIds:null,stationIps:['127.0.0.1']},accountETag(accessReview.value,target))
  await call(a,'/api/state','GET',undefined,undefined,401,first);await call(a,'/api/state','GET',undefined,undefined,401,second)
  await assertAccessSocketRevoked()
  const freshCookie=await targetLogin(),assertSessionSocketRevoked=await targetSocket(freshCookie),freshSessions=await call(a,targetPath+'/sessions')
  const revoked=await call(a,targetPath+'/sessions','DELETE',undefined,freshSessions.etag);assert.equal(revoked.value.revokedCount,1)
  await call(a,'/api/state','GET',undefined,undefined,401,freshCookie)
  await assertSessionSocketRevoked()
  const transport=await after(sequence)
  assert.equal(transport.onAir.itemId,pvw.onAir.itemId);assert.equal(transport.playing,pvw.playing);assert.equal(transport.onAir.startedAt,pvw.onAir.startedAt);assert.deepEqual(transport.preview,pvw.preview)
  const stable=await call(a,'/api/users/review'),sessionStable=await call(a,targetPath+'/sessions'),beforeRestart=state();await stop(b);await start(b);assert.equal((await call(b,'/api/users/review')).etag,stable.etag);assert.equal((await call(b,targetPath+'/sessions')).etag,sessionStable.etag);assert.deepEqual(state(),beforeRestart)
  const backup=join(directory,'validated-backup.db');await database.sqlite.backup(backup);const validation=await validateBackupRestore(backup);assert.equal(validation.integrity,'ok');assert.equal(validation.foreignKeys,'ok')
  evidence={result:'PASS',evidence:'COMPILED_ACCOUNT_AND_SESSION_REVIEWS',directory,ports:stations.map(station=>station.port),pids:stations.flatMap(station=>station.pids),serverSha256:createHash('sha256').update(await readFile(join(root,'apps/server/dist/server.cjs'))).digest('hex'),
    readOnlyStable:true,noHashesOrTokensReturned:true,blindMutationsRejected:true,singleConcurrentWinner:true,staleAbaRejected:true,hiddenFieldsRejected:true,lastAdminProtected:true,newSessionInvalidatesReview:true,fiveAuditRollbacks:true,noLogoutCookieOnRollback:true,revocationImmediate:true,revokedSocketCodes,previewAndProgramPreserved:true,restartRevisionsPreserved:true,backupValidated:true,
    transport:'SIMULATED',automaticTake:false,physicalSignalValidated:false,mediaDecoded:false,browserValidated:false,replicationValidated:false}
} finally {
  socket?.close();for(const targetSocket of targetSockets)targetSocket.close();for(const station of stations)await stop(station);database.sqlite.close()
}
if(evidence){for(const station of stations)await assert.rejects(()=>fetch(`http://127.0.0.1:${station.port}/api/health`,{signal:AbortSignal.timeout(2000)}));console.log(JSON.stringify({...evidence,ownChildrenAndListenersClosed:true}))}
