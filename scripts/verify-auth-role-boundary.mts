import assert from 'node:assert/strict'
import {spawn,type ChildProcess} from 'node:child_process'
import {mkdtemp,mkdir,readFile,realpath,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createServer} from 'node:net'
import {createHash,randomUUID} from 'node:crypto'
import {createRequire} from 'node:module'

// Only own compiled children/private fixtures. No actual media, station UI,
// engine, hardware, HA or production account qualification is claimed.
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(tmpdir(),'RPlayout-auth-role-boundary-'))
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json')
const {openDatabase}=await import('../apps/server/src/db/client.js')
const {hashPassword}=await import('../apps/server/src/domain/auth.js')
const file=join(directory,'auth.db'),localFile=join(directory,'anonymous.db'),media=join(directory,'media');await mkdir(media)
const database=openDatabase(file),local=openDatabase(localFile),now=new Date().toISOString()
for(const db of [database,local])db.sqlite.prepare('INSERT INTO channels(id,name,width,height,rate_num,rate_den,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run('fixture','Authorization fixture',320,180,25,1,-23,-1,5,now)
const password='PRIVATE_AUTH_ROLE_FIXTURE_PASSWORD',hash=await hashPassword(password)
const expiryOnly=process.argv.includes('--session-expiry')
database.sqlite.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('user','fixture-user',hash,'ADMIN',1,now)
const reservation=createServer();await new Promise<void>(resolve=>reservation.listen(0,'127.0.0.1',resolve))
const port=(reservation.address() as {port:number}).port;await new Promise<void>(resolve=>reservation.close(()=>resolve()))
let child:ChildProcess|null=null,socket:{close():void}|null=null,logs='',allLogs='',closedCode:number|undefined,liveReceived=false
const pids:number[]=[]
async function wait(check:()=>boolean|Promise<boolean>,description:string){
  const end=performance.now()+20_000
  while(performance.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,100))}
  throw new Error(description)
}
async function call(path:string,body?:object,expected=200,cookie?:string,headers:Record<string,string>={}){
  const response=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...headers,...(cookie?{cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(5000)})
  const text=await response.text();assert.equal(response.status,expected,`${path}: HTTP ${response.status}`)
  assert.ok(!text.includes(password)&&!text.includes(hash),'Private authentication fixture leaked')
  return {value:JSON.parse(text),cookie:response.headers.get('set-cookie')?.split(';')[0]}
}
async function start(dbFile:string,role='ADMIN'){
  logs='';child=spawn(process.execPath,[join(root,'apps/server/dist/server.cjs')],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,
    RPLAYOUT_DB:dbFile,RPLAYOUT_VAULT_FILE:join(directory,'vault.json'),RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_MEDIA:media,
    RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_CACHE:join(directory,'cache'),RPLAYOUT_BACKUPS:join(directory,'backups'),
    RPLAYOUT_ENGINE:'',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_DEVICES:'',RPLAYOUT_RELAY:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_N1_PEER:'',RPLAYOUT_BACKUP_HOURS:'0',
    RPLAYOUT_HA_ROLE:'',RPLAYOUT_HA_PEER:'',RPLAYOUT_ADMIN_USER:'',RPLAYOUT_ADMIN_PASSWORD:'',RPLAYOUT_ROLE:role,RPLAYOUT_CONTROL_TOKEN:'',HOST:'127.0.0.1',PORT:String(port),LOG_LEVEL:'warn'}})
  if(child.pid)pids.push(child.pid)
  for(const stream of [child.stdout,child.stderr])stream?.on('data',chunk=>{logs=(logs+String(chunk)).slice(-12_000);allLogs+=String(chunk)})
  child.on('error',error=>logs+=error.message)
  await wait(async()=>{assert.equal(child?.exitCode,null,'Own server exited');try{return (await call('/api/health')).value.ok===true}catch{return false}},'Own compiled server not ready')
}
async function stop(){const own=child;child=null;if(own&&own.exitCode===null&&own.signalCode===null){const exited=new Promise<void>(resolve=>own.once('exit',()=>resolve()));own.kill('SIGKILL');await exited}}
function authState(){return {sessions:database.sqlite.prepare('SELECT * FROM sessions ORDER BY token').all(),success:database.sqlite.prepare("SELECT * FROM operator_decisions WHERE kind='SESSION_CREATED' ORDER BY rowid").all()}}
let evidence:Record<string,unknown>|null=null
try{
  if(expiryOnly){
    const expiredToken=createHash('sha256').update(randomUUID()).digest('hex')
    database.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(expiredToken,'user','2000-01-01T00:00:00.000Z',now)
    database.sqlite.exec("CREATE TRIGGER expiry_fixture_audit_failure BEFORE INSERT ON operator_decisions WHEN NEW.kind='SESSION_EXPIRED' BEGIN SELECT RAISE(ABORT,'EXPIRY_AUDIT_FIXTURE'); END")
    await start(file)
    assert.equal(database.sqlite.prepare('SELECT count(*) n FROM sessions').get().n,1,'Audit failure must preserve expired session')
    assert.equal(database.sqlite.prepare("SELECT count(*) n FROM operator_decisions WHERE kind='SESSION_EXPIRED'").get().n,0)
    await wait(()=>logs.includes('Expiração de sessões não auditada; lote preservado para nova tentativa.'),'Actual maintenance audit fault has no safe diagnostic')
    assert.ok(!logs.includes('EXPIRY_AUDIT_FIXTURE'),'Raw private trigger message exposed')
    const expiryLog=logs.split('\n').filter(Boolean).map(line=>{try{return JSON.parse(line)}catch{return null}}).find(line=>line?.msg==='Expiração de sessões não auditada; lote preservado para nova tentativa.')
    assert.equal(expiryLog?.err?.code,'SQLITE_CONSTRAINT_TRIGGER');assert.equal(expiryLog?.err?.detailsOmitted,true)
    database.sqlite.exec('DROP TRIGGER expiry_fixture_audit_failure');await stop();await start(file)
    assert.equal(database.sqlite.prepare('SELECT count(*) n FROM sessions').get().n,0)
    assert.equal(database.sqlite.prepare("SELECT count(*) n FROM operator_decisions WHERE kind='SESSION_EXPIRED'").get().n,1)
    const login=await call('/api/auth/login',{username:'fixture-user',password});assert.ok(login.cookie)
    await call('/api/state',undefined,200,login.cookie)
    const Ws=createRequire(await realpath(join(root,'apps/server/node_modules/@fastify/websocket/package.json')))('ws')
    const ws=new Ws(`ws://127.0.0.1:${port}/ws`,{headers:{cookie:login.cookie!}});socket=ws
    ws.on('error',()=>{});ws.on('close',code=>{closedCode=code});ws.on('message',data=>{if(JSON.parse(String(data)).type==='live')liveReceived=true})
    await wait(()=>liveReceived,'Own valid session websocket did not receive state')
    database.sqlite.prepare('UPDATE sessions SET expires_at=?').run(new Date(Date.now()-1000).toISOString())
    await call('/api/state',undefined,401,login.cookie)
    assert.equal((await call('/api/session',undefined,200,login.cookie)).value.authenticated,false)
    await wait(()=>closedCode===4401,'Expired own websocket not closed')
    socket=null;await stop();await start(file)
    assert.equal(database.sqlite.prepare('SELECT count(*) n FROM sessions').get().n,0)
    assert.equal(database.sqlite.prepare("SELECT count(*) n FROM operator_decisions WHERE kind='SESSION_EXPIRED'").get().n,2)
    await call('/api/auth/login',{username:'fixture-user',password:'x'.repeat(1025)},400)
    await call('/api/auth/login',{username:'x'.repeat(81),password},400)
    assert.equal(database.sqlite.prepare('SELECT count(*) n FROM sessions').get().n,0)
    assert.ok(!logs.includes(password)&&!logs.includes(hash))
    assert.ok(!JSON.stringify(database.sqlite.prepare("SELECT payload FROM operator_decisions WHERE kind='SESSION_EXPIRED'").all()).includes(expiredToken))
    evidence={result:'PASS',evidence:'COMPILED_SESSION_EXPIRY_HTTP_WEBSOCKET_AUDIT',directory,port,pids,serverSha256:createHash('sha256').update(await readFile(join(root,'apps/server/dist/server.cjs'))).digest('hex'),expiryAuditRollback:true,expirySafeDiagnostic:true,restartExpiryAuditOnce:true,controlledExpiryDeniedHttp:true,expiredWebSocketCode:closedCode,loginInputLimitsEnforced:true,transport:'SIMULATED',physicalSignalValidated:false,browserValidated:false,limits:'Controlled DB expiry, not a 12-hour wait. Loopback station only; no remote browser/upgrade qualification.'}
  }else{
  await start(file)
  const login=await call('/api/auth/login',{username:'fixture-user',password});assert.ok(login.cookie)
  assert.equal(login.value.role,'ADMIN');assert.equal((await call('/api/session',undefined,200,login.cookie)).value.authenticated,true)
  await call('/api/state',undefined,200,login.cookie)
  // Node's global WebSocket has no custom headers; use the workspace's ws
  // client to send the exact cookie obtained from the own fixture login.
  // Resolve the pnpm junction before creating require: a fictional package
  // path through the app-level junction loses its dependency parent directory.
  const Ws=createRequire(await realpath(join(root,'apps/server/node_modules/@fastify/websocket/package.json')))('ws')
  const ws=new Ws(`ws://127.0.0.1:${port}/ws`,{headers:{cookie:login.cookie!}})
  ws.on('error',()=>{});ws.on('close',code=>{closedCode=code});ws.on('message',data=>{
    const text=String(data);assert.ok(!text.includes(password)&&!text.includes(hash));if(JSON.parse(text).type==='live')liveReceived=true
  })
  // Ensure finally can close this exact own socket without any ambient app.
  socket=ws
  await wait(()=>liveReceived,'Own authenticated WebSocket has no live fixture')
  for(const role of ['VIEWER','ADMIN ','constructor']){
    database.sqlite.prepare('UPDATE users SET role=? WHERE id=?').run(role,'user')
    const before=authState(),session=(await call('/api/session',undefined,200,login.cookie)).value
    assert.equal(session.role,'DENIED');assert.equal(session.authenticated,false);assert.equal(session.required,true)
    await call('/api/state',undefined,401,login.cookie,{'x-rplayout-role':'ADMIN'})
    const denied=await call('/api/auth/login',{username:'fixture-user',password},401);assert.equal(denied.cookie,undefined)
    assert.deepEqual(authState(),before)
  }
  await wait(()=>closedCode!==undefined,'Revoked WebSocket did not close');assert.equal(closedCode,4401)
  database.sqlite.prepare("UPDATE users SET role='ADMIN' WHERE id='user'").run()
  database.sqlite.exec("CREATE TRIGGER auth_fixture_audit_failure BEFORE INSERT ON operator_decisions WHEN NEW.kind='SESSION_CREATED' BEGIN SELECT RAISE(ABORT,'AUTH_AUDIT_FIXTURE'); END")
  const before=authState(),failed=await call('/api/auth/login',{username:'fixture-user',password},500)
  assert.equal(failed.cookie,undefined);assert.deepEqual(authState(),before)
  database.sqlite.exec('DROP TRIGGER auth_fixture_audit_failure')
  const repaired=await call('/api/auth/login',{username:'fixture-user',password});assert.ok(repaired.cookie)
  await stop();await start(file)
  assert.equal((await call('/api/session',undefined,200,repaired.cookie)).value.role,'ADMIN')
  assert.equal((await call('/api/session',undefined,200,repaired.cookie)).value.authenticated,true)
  await stop();await start(localFile,'VIEWER')
  const configured=(await call('/api/session')).value;assert.equal(configured.role,'DENIED');assert.equal(configured.required,false)
  const localBefore=local.sqlite.prepare('SELECT id FROM channels ORDER BY id').all()
  await call('/api/channels',{name:'Must not create'},403)
  await call('/api/channels',{name:'Must not elevate'},403,undefined,{'x-rplayout-role':'ADMIN'})
  assert.deepEqual(local.sqlite.prepare('SELECT id FROM channels ORDER BY id').all(),localBefore)
  assert.ok(!logs.includes(password)&&!logs.includes(hash))
  evidence={result:'PASS',evidence:'COMPILED_AUTH_ROLE_AND_ATOMIC_SESSION',directory,port,pids,serverSha256:createHash('sha256').update(await readFile(join(root,'apps/server/dist/server.cjs'))).digest('hex'),invalidPersistedRoleRejected:true,invalidRoleLoginNoCookie:true,invalidSessionNoProtectedRead:true,revokedWebSocketCode:closedCode,sessionAuditRollback:true,validSessionSurvivesRestart:true,invalidLocalRoleCannotElevate:true,transport:'SIMULATED',physicalSignalValidated:false,browserValidated:false,replicationValidated:false}
  }
}finally{socket?.close();await stop();database.sqlite.close();local.sqlite.close();await writeFile(join(directory,'result.json'),JSON.stringify(evidence??{result:'FAIL',directory},null,2));await writeFile(join(directory,'server.log'),allLogs)}
await assert.rejects(()=>fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(2000)}))
console.log(JSON.stringify({...evidence,ownChildrenAndListenerClosed:true}))
