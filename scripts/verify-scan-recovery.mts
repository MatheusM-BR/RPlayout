import assert from 'node:assert/strict'
import {spawn,type ChildProcess} from 'node:child_process'
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createServer} from 'node:net'
import {fileURLToPath} from 'node:url'
import {randomUUID,createHash} from 'node:crypto'
import {openDatabase} from '../apps/server/src/db/client.js'
import {sessionDigest} from '../apps/server/src/domain/access.js'
import {executionHostIdentity} from '../apps/server/src/domain/execution-host.js'
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(tmpdir(),'RPlayout-scan-recovery-'))
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json')
const file=join(directory,'qa.db'),db=openDatabase(file),media=join(directory,'AÇÃO Çãó');await mkdir(media)
const token=randomUUID()+randomUUID(),children:ChildProcess[]=[],logs=new Map<ChildProcess,string>()
db.sqlite.exec("INSERT INTO users VALUES('u','Admin','NO_LOGIN','ADMIN',1,'now')")
db.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest(token),'u','2099-01-01','now')
async function port(){const s=createServer();await new Promise<void>(r=>s.listen(0,'127.0.0.1',r));const p=(s.address() as {port:number}).port;await new Promise<void>(r=>s.close(()=>r()));return p}
async function call(p:number,url:string,method='GET',body?:object,etag?:string,status=200){
 const response=await fetch(`http://127.0.0.1:${p}${url}`,{method,headers:{cookie:'rplayout_session='+token,...(body?{'content-type':'application/json'}:{}),...(etag?{'if-match':etag}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)})
 const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));return {value,etag:response.headers.get('etag'),cache:response.headers.get('cache-control')}
}
async function start(){
 const p=await port(),env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^RPLAYOUT_/i.test(key)))
 const child=spawn(process.execPath,[join(root,'apps/server/dist/server.cjs')],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...env,RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_DB:file,RPLAYOUT_VAULT_FILE:join(directory,'vault.json'),RPLAYOUT_MEDIA:media,RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_CACHE:join(directory,'cache'),RPLAYOUT_BACKUPS:join(directory,'backups'),RPLAYOUT_ENGINE:'',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_RELAY:'',RPLAYOUT_DEVICES:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_BACKUP_HOURS:'0',RPLAYOUT_ROLE:'ADMIN',HOST:'127.0.0.1',PORT:String(p),LOG_LEVEL:'warn'}})
 children.push(child);logs.set(child,'');for(const stream of [child.stdout,child.stderr])stream?.on('data',data=>logs.set(child,((logs.get(child)??'')+String(data)).slice(-10000)))
 const deadline=performance.now()+25000
 while(performance.now()<deadline){if(child.exitCode!==null||child.signalCode!==null)throw new Error('Own server exited '+logs.get(child));try{if((await call(p,'/api/health')).value.ok)return {child,port:p}}catch{}await new Promise(r=>setTimeout(r,100))}
 throw new Error('Own server not ready '+logs.get(child))
}
async function stop(child:ChildProcess){if(child.exitCode!==null||child.signalCode!==null)return;const ended=new Promise<void>(r=>child.once('exit',()=>r()));assert.equal(child.kill('SIGKILL'),true);let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([ended,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Own child did not exit')),10000)})])}finally{if(timer)clearTimeout(timer)}}
const rows=()=>db.sqlite.prepare('SELECT * FROM ingest_batches ORDER BY id').all()
const auditCount=()=>Number((db.sqlite.prepare("SELECT COUNT(*) n FROM operator_decisions WHERE kind='MEDIA_SCAN_RECOVERY_REQUESTED'").get() as {n:number}).n)
const seed=(id:string,host:string|null,pid:number|null,boot:string|null,state='RUNNING',roots=JSON.stringify([media]))=>db.sqlite.prepare('INSERT INTO ingest_batches(id,roots,measure,state,created_at,updated_at,owner_host,owner_pid,owner_boot) VALUES(?,?,0,?,?,?,?,?,?)').run(id,roots,state,'now','now',host,pid,boot)
let result:object|undefined
try{
 // Probe intentionally absent: validates compiled API/ledger, not scanner decoding.
 const a=await start(),b=await start(),host=executionHostIdentity()
 const child=spawn(process.execPath,['-e','process.exit(0)'],{windowsHide:true,stdio:'ignore'});children.push(child)
 await new Promise<void>((resolve,reject)=>{child.once('error',reject);child.once('exit',()=>resolve())});assert.equal(child.exitCode,0)
 assert.throws(()=>process.kill(child.pid!,0),(e:NodeJS.ErrnoException)=>e.code==='ESRCH')
 seed('dead',host,child.pid!,'own-stopped-child');seed('alive',host,a.child.pid!,'own-active-server');seed('remote','fixture-different-host',a.child.pid!,'remote-fixture');seed('unknown',null,null,null);seed('invalid',null,null,null,'PENDING','not-json');seed('contradictory',host,a.child.pid!,'still-recorded','PENDING')
 const before=rows(),review=await call(a.port,'/api/library/scan/review')
 assert.equal(review.cache,'private, no-store');assert.deepEqual(rows(),before);assert.equal(auditCount(),0)
 const diag=new Map<string,any>(review.value.activeBatches.map((r:any)=>[r.id,r]))
 for(const [id,state] of [['dead','LOCAL_DEAD'],['alive','LOCAL_ALIVE'],['remote','REMOTE'],['unknown','UNKNOWN'],['invalid','INVALID'],['contradictory','UNKNOWN']])assert.equal(diag.get(id!)!.ownership,state)
 for(const r of review.value.activeBatches){assert.equal('owner_pid' in r,false);assert.equal('owner_host' in r,false);assert.equal('owner_boot' in r,false)}
 for(const id of ['alive','remote','unknown','invalid','contradictory']){assert.equal(diag.get(id)!.canRecover,false);await call(a.port,'/api/library/scan/recover','POST',{requestId:randomUUID(),batchId:id},review.etag!,409)}
 assert.deepEqual(rows(),before);assert.equal(process.kill(a.child.pid!,0),true)
 const body={requestId:review.value.operationId,batchId:'dead'}
 await call(a.port,'/api/library/scan/recover','POST',body,undefined,428)
 await call(a.port,'/api/library/scan/recover','POST',{...body,confirmedPreviousStopped:true},review.etag!,400)
 db.sqlite.exec("CREATE TRIGGER recovery_audit_failure BEFORE INSERT ON operator_decisions WHEN NEW.kind='MEDIA_SCAN_RECOVERY_REQUESTED' BEGIN SELECT RAISE(ABORT,'AUDIT_FAILED');END")
 await call(a.port,'/api/library/scan/recover','POST',body,review.etag!,409)
 assert.deepEqual(rows(),before);assert.equal(auditCount(),0);assert.equal((await call(b.port,'/api/library/scan/review')).etag,review.etag)
 db.sqlite.exec('DROP TRIGGER recovery_audit_failure');db.sqlite.exec("UPDATE ingest_batches SET state=state WHERE id='dead'")
 await call(a.port,'/api/library/scan/recover','POST',body,review.etag!,409)
 const fresh=await call(a.port,'/api/library/scan/review'),command={requestId:fresh.value.operationId,batchId:'dead'}
 const replies=await Promise.all([a,b].map(server=>call(server.port,'/api/library/scan/recover','POST',command,fresh.etag!)))
 assert.deepEqual(replies.map(r=>r.value.deduplicated).sort(),[false,true]);for(const r of replies){assert.equal(r.value.batchId,'dead');assert.equal(r.value.state,'PENDING');assert.deepEqual(r.value.roots,[media])}
 assert.equal(auditCount(),1);assert.deepEqual(db.sqlite.prepare("SELECT state,roots,measure,owner_host,owner_pid,owner_boot FROM ingest_batches WHERE id='dead'").get(),{state:'PENDING',roots:JSON.stringify([media]),measure:0,owner_host:null,owner_pid:null,owner_boot:null})
 await stop(a.child);await stop(b.child);const restarted=await start()
 const repeated=await call(restarted.port,'/api/library/scan/recover','POST',command,fresh.etag!);assert.equal(repeated.value.deduplicated,true);assert.equal(auditCount(),1)
 db.sqlite.exec("UPDATE users SET role='OPERATOR'");await call(restarted.port,'/api/library/scan/recover','POST',command,fresh.etag!,403)
 db.sqlite.exec("UPDATE users SET role='ADMIN'; DELETE FROM sessions");await call(restarted.port,'/api/library/scan/recover','POST',command,fresh.etag!,401)
 result={result:'PASS',directory,compiledServerSha256:createHash('sha256').update(await readFile(join(root,'apps/server/dist/server.cjs'))).digest('hex'),probeIntentionallyDisabled:true,readOnlyPrivateDiagnostics:true,localDeathProvedByOwnExitedChild:true,protectedAliveRemoteUnknownInvalidAndContradictoryOwners:true,atomicAuditFailureRollback:true,sameValueStaleProofRefused:true,twoCompiledServersOneRecoveryOneAudit:true,frozenIntentSameBatch:true,restartDedupAndFreshAuthority:true,nativeScannerBrowserPgmHardwareValidated:false}
}catch(error){result={result:'FAIL',directory,error:String(error)};throw error}
finally{const cleanupErrors:string[]=[];for(const child of children)try{await stop(child)}catch(error){cleanupErrors.push(String(error))}db.sqlite.close();await writeFile(join(directory,'server-logs.json'),JSON.stringify([...logs].map(([child,text])=>({pid:child.pid,text})),null,2));await writeFile(join(directory,'result.json'),JSON.stringify({...result,cleanupErrors},null,2));console.log(JSON.stringify({...result,cleanupErrors}));assert.equal(cleanupErrors.length,0)}
