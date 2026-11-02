import assert from 'node:assert/strict'
import {spawn,type ChildProcess} from 'node:child_process'
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createServer as createSocket} from 'node:net'
import {createServer,type ServerResponse} from 'node:http'
import {fileURLToPath} from 'node:url'
import {randomUUID,createHash} from 'node:crypto'
import {openDatabase} from '../apps/server/src/db/client.js'
import {sessionDigest} from '../apps/server/src/domain/access.js'
import {integrationDeliveries,operatorDecisions,integrations,channels} from '../apps/server/src/db/schema.js'
import {executionHostIdentity} from '../apps/server/src/domain/execution-host.js'
import {ExecutionOwnership} from '../apps/server/src/domain/execution-ownership.js'

// All listeners, databases and children belong to this verifier. No existing
// installation, real gateway, signal, or broadcast output is contacted.
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(tmpdir(),'RPlayout-integration-review-'))
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json')
const file=join(directory,'qa.db'),db=openDatabase(file),media=join(directory,'media');await mkdir(media)
const token=randomUUID()+randomUUID(),headers={cookie:'rplayout_session='+token},children:ChildProcess[]=[],logs=new Map<ChildProcess,string>()
db.sqlite.exec("INSERT INTO users VALUES('u','Admin','NO_LOGIN','ADMIN',1,'now')")
db.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest(token),'u','2099-01-01','now')
const received:{id:string|undefined;path:string;body:string}[]=[],held:ServerResponse[]=[]
const gateway=createServer((request,response)=>{let body='';request.on('data',data=>{body+=data});request.on('end',()=>{received.push({id:request.headers['idempotency-key'] as string|undefined,path:request.url!,body});held.push(response)})})
await new Promise<void>(resolve=>gateway.listen(0,'127.0.0.1',resolve))
const target=`http://127.0.0.1:${(gateway.address() as {port:number}).port}/PRIVATE?token=SECRET`
async function port(){const socket=createSocket();await new Promise<void>(resolve=>socket.listen(0,'127.0.0.1',resolve));const value=(socket.address() as {port:number}).port;await new Promise<void>(resolve=>socket.close(()=>resolve()));return value}
async function call(p:number,url:string,method='GET',body?:object,etag?:string,status=200){
  const response=await fetch(`http://127.0.0.1:${p}${url}`,{method,headers:{...headers,...(body?{'content-type':'application/json'}:{}),...(etag?{'if-match':etag}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)})
  const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));return {value,etag:response.headers.get('etag'),cache:response.headers.get('cache-control')}
}
async function start(){
  const p=await port(),env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^RPLAYOUT_/i.test(key)))
  const child=spawn(process.execPath,[join(root,'apps/server/dist/server.cjs')],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...env,RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_DB:file,RPLAYOUT_VAULT_FILE:join(directory,'vault.json'),RPLAYOUT_MEDIA:media,RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_CACHE:join(directory,'cache'),RPLAYOUT_BACKUPS:join(directory,'backups'),RPLAYOUT_ENGINE:'',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_RELAY:'',RPLAYOUT_DEVICES:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_BACKUP_HOURS:'0',RPLAYOUT_ROLE:'ADMIN',HOST:'127.0.0.1',PORT:String(p),LOG_LEVEL:'warn'}})
  children.push(child);logs.set(child,'');child.on('error',error=>logs.set(child,(logs.get(child)??'')+String(error)))
  for(const stream of [child.stdout,child.stderr])stream?.on('data',data=>logs.set(child,((logs.get(child)??'')+String(data)).slice(-20000)))
  const deadline=performance.now()+25000
  while(performance.now()<deadline){if(child.exitCode!==null||child.signalCode!==null)throw new Error('Own server exited '+logs.get(child));try{if((await call(p,'/api/health')).value.ok)return {child,port:p}}catch{}await new Promise(resolve=>setTimeout(resolve,100))}
  throw new Error('Own server not ready '+logs.get(child))
}
async function stop(child:ChildProcess){if(child.exitCode!==null||child.signalCode!==null)return;const ended=new Promise<void>(resolve=>child.once('exit',()=>resolve()));assert.equal(child.kill('SIGKILL'),true);let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([ended,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Own server did not exit')),10000)})])}finally{if(timer)clearTimeout(timer)}}
async function until(predicate:()=>boolean){const deadline=performance.now()+4000;while(performance.now()<deadline){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,40))}assert.ok(predicate(),'Local integration condition timed out')}
const state=(id:string)=>db.sqlite.prepare('SELECT state,attempts,owner_host,owner_pid,owner_boot FROM integration_deliveries WHERE id=?').get(id) as {state:string;attempts:number;owner_host:string;owner_pid:number;owner_boot:string}
let result:object|undefined
try{
 if(process.argv.includes('--ownership-only')){
  const a=await start(),b=await start()
  for(const id of ['idle','local','remote','opening','legacy'])db.db.insert(channels).values({id,name:id,rateNum:25,rateDen:1,width:320,height:180,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:'now'}).run()
  const local=new ExecutionOwnership(db.db,{host:executionHostIdentity(),pid:process.pid,boot:randomUUID()})
  local.claim('local');local.claim('opening').beforeSpawn(randomUUID())
  new ExecutionOwnership(db.db,{host:'fixture-remote-host',pid:process.pid,boot:randomUUID()}).claim('remote')
  db.sqlite.prepare('INSERT INTO channel_checkpoints VALUES(?,?,?)').run('legacy',JSON.stringify({version:1,channelId:'legacy',rundownId:'fixture-rd',revisionId:'fixture-rev',itemId:'fixture-vt',elapsed:750,playing:true,realEngine:true}),'now')
  const snapshot=()=>Object.fromEntries(['execution_owner_runs','execution_owner_slots','distribution_owner_runs','distribution_owner_slot','channel_checkpoints','as_run','operator_decisions'].map(table=>[table,db.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
  const before=snapshot()
  for(const [channel,expected] of [['idle','UNCLAIMED'],['local','LOCAL_EXECUTION_PROTECTED'],['remote','OWNER_REMOTE'],['opening','SPAWN_UNCONFIRMED'],['legacy','LEGACY_UNVERIFIED']]){
   const response=await call(b.port,'/api/channels/'+channel+'/execution-ownership');assert.equal(response.cache,'private, no-store');assert.equal(response.value.diagnostic.code,expected);assert.equal(response.value.physicalOutputValidated,false);assert.equal(response.value.promotionReady,false)
   assert.ok(!JSON.stringify(response.value).match(/fixture-remote-host|fixture-vt|enginePids|engineTokens|signature|ownerPid|ownerBoot/))
  }
  const global=await call(a.port,'/api/distribution/execution-ownership');assert.equal(global.value.diagnostic.code,'CHANNEL_EXECUTION_PROTECTED');assert.equal(global.cache,'private, no-store');assert.deepEqual(snapshot(),before)
  db.sqlite.exec("INSERT INTO user_access VALUES('u','[\"idle\"]',NULL,'now')");await call(b.port,'/api/channels/local/execution-ownership',undefined,undefined,undefined,403)
  assert.equal((await call(b.port,'/api/channels/idle/execution-ownership')).value.diagnostic.code,'UNCLAIMED');db.sqlite.exec('DELETE FROM user_access')
  db.sqlite.exec("UPDATE execution_owner_runs SET signature='PRIVATE_CORRUPTED' WHERE channel_id='local'")
  const damaged=snapshot(),invalid=await call(a.port,'/api/channels/local/execution-ownership',undefined,undefined,undefined,409)
  assert.equal(invalid.value.diagnostic.code,'INVALID_RECORD');assert.ok(!JSON.stringify(invalid.value).includes('PRIVATE_CORRUPTED'))
  // The aggregate fence may short-circuit on another already protected
  // channel. It must remain blocked, not claim every record was inspected.
  const stillProtected=await call(b.port,'/api/distribution/execution-ownership');assert.equal(stillProtected.value.blocked,true);assert.equal(stillProtected.value.diagnostic.code,'CHANNEL_EXECUTION_PROTECTED');assert.deepEqual(snapshot(),damaged)
  db.sqlite.exec('DELETE FROM sessions');await call(b.port,'/api/channels/idle/execution-ownership',undefined,undefined,undefined,401)
  assert.equal(received.length,0)
  result={result:'PASS',directory,mode:'ownership-only',compiledServerSha256:createHash('sha256').update(await readFile(join(root,'apps/server/dist/server.cjs'))).digest('hex'),twoOwnCompiledServersPrivateStructuredReadOnlyDiagnostics:true,localRemotePendingSpawnLegacyFixturesDistinguished:true,globalChannelBlockerDistinguished:true,malformedSignedRecordsReturnGenericInvalidDiagnosisWithoutRepair:true,reservationsCheckpointAsrunAuditUnchangedByReads:true,scopedChannelAndRevokedSessionRefused:true,ownerCoordinatesNotExposed:true,noPostOnOwnGateway:true,ownerCasesSeededNoNativeEnginesOrSignals:true,browserPgmHardwareValidated:false}
 }else if(process.argv.includes('--listing-only')){
  const a=await start()
  for(const id of ['a','b'])db.db.insert(channels).values({id,name:id,rateNum:25,rateDen:1,width:320,height:180,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:'now'}).run()
  for(const [id,channelId] of [['global',null],['ga','a'],['gb','b']] as const)db.db.insert(integrations).values({id,channelId,name:id,url:target,events:['source.lost'],enabled:false,createdAt:'now'}).run()
  for(const [id,integrationId,channelId,stateName,ownerHost,ownerPid,ownerBoot] of [
   ['qa-unknown','ga','a','SENDING',null,null,null],
   ['qa-live-fixture','ga','a','SENDING',executionHostIdentity(),process.pid,'fixture-only-parent'],
   ['qa-remote','ga','a','SENDING','fixture-remote-host',process.pid,'fixture-remote'],
   ['qa-legacy','ga','a','FAILED',null,null,null],
   ['qa-global-for-a','global','a','SENDING',null,null,null],
   ['qa-other-channel','gb','b','SENDING',null,null,null],
   ['qa-wrong-config','gb','a','SENDING',null,null,null],
   ['qa-orphan','missing','a','SENDING',null,null,null],
   ['qa-global-event','global',null,'SENDING',null,null,null],
  ] as const)db.db.insert(integrationDeliveries).values({id,integrationId,channelId,state:stateName,event:'source.lost',target,payload:{private:'PAYLOADSECRET'},attempts:1,nextAttemptAt:'2099-01-01',createdAt:'now',ownerHost,ownerPid,ownerBoot,lastError:stateName==='FAILED'?'Envio legado sem responsável identificável. '+target:null}).run()
  const before=db.sqlite.prepare('SELECT * FROM integration_deliveries ORDER BY id').all(),versions=db.sqlite.prepare('SELECT * FROM integration_delivery_versions ORDER BY id').all(),b=await start()
  const all=await call(a.port,'/api/integration-deliveries');assert.equal(all.cache,'private, no-store');assert.equal(all.value.deliveries.length,9)
  assert.ok(!JSON.stringify(all.value).match(/PRIVATE|SECRET|target|payload|ownerHost|ownerPid|ownerBoot|fixture-remote-host/))
  const byId=new Map<string,any>(all.value.deliveries.map((row:any)=>[row.id,row]))
  assert.equal(byId.get('qa-unknown').diagnostic.ownership,'UNKNOWN');assert.equal(byId.get('qa-remote').diagnostic.ownership,'REMOTE');assert.equal(byId.get('qa-live-fixture').diagnostic.ownership,'LOCAL_ALIVE');assert.equal(byId.get('qa-legacy').diagnostic.ownership,'UNKNOWN')
  db.sqlite.exec("INSERT INTO user_access VALUES('u','[\"a\"]',NULL,'now')")
  await call(a.port,'/api/integration-deliveries',undefined,undefined,undefined,403);await call(b.port,'/api/integration-deliveries?channelId=b',undefined,undefined,undefined,403)
  const scoped=await call(b.port,'/api/integration-deliveries?channelId=a')
  assert.deepEqual(scoped.value.deliveries.map((row:any)=>row.id).sort(),['qa-global-for-a','qa-legacy','qa-live-fixture','qa-remote','qa-unknown'])
  assert.deepEqual(db.sqlite.prepare('SELECT * FROM integration_deliveries ORDER BY id').all(),before);assert.deepEqual(db.sqlite.prepare('SELECT * FROM integration_delivery_versions ORDER BY id').all(),versions);assert.equal(received.length,0)
  await stop(a.child);await stop(b.child);const restarted=await start()
  assert.deepEqual((await call(restarted.port,'/api/integration-deliveries?channelId=a')).value.deliveries,scoped.value.deliveries)
  db.sqlite.exec('DELETE FROM sessions');await call(restarted.port,'/api/integration-deliveries?channelId=a',undefined,undefined,undefined,401)
  assert.deepEqual(db.sqlite.prepare('SELECT * FROM integration_deliveries ORDER BY id').all(),before);assert.equal(received.length,0)
  result={result:'PASS',directory,mode:'listing-only',compiledServerSha256:createHash('sha256').update(await readFile(join(root,'apps/server/dist/server.cjs'))).digest('hex'),twoOwnCompiledServersPrivateReadOnlyOverview:true,channelAndConfigurationScopeFiltersBeforeLimit:true,restrictedGlobalAndForeignChannelRefused:true,restrictedOrphanAndWrongOwnerExcluded:true,ownerAndTargetPayloadNotExposed:true,legacyErrorUrlRedacted:true,unknownRemoteLegacyNotReclassified:true,noPostOnOwnGateway:true,restartPreservesOverviewAndRevokedSessionRefused:true,ownerCasesSeededNotActualHttpClaim:true,browserPgmHardwareValidated:false}
 }else{
  const a=await start(),catalog=await call(a.port,'/api/integrations/review')
  assert.equal(catalog.cache,'private, no-store')
  await call(a.port,'/api/integrations','POST',{name:'Local QA',url:target,events:['source.lost'],channelId:null},undefined,428)
  const created=await call(a.port,'/api/integrations','POST',{name:'Local QA',url:target,events:['source.lost'],channelId:null},catalog.etag!)
  const id=created.value.integration.id,path='/api/integrations/'+encodeURIComponent(id),review=await call(a.port,path+'/review')
  assert.equal(review.value.enabled,false);assert.equal(review.cache,'private, no-store');assert.ok(!JSON.stringify(review.value).match(/PRIVATE|SECRET/))
  const command={requestId:randomUUID()},first=await call(a.port,path+'/test','POST',command,review.etag!),again=await call(a.port,path+'/test','POST',command,review.etag!)
  assert.equal(again.value.deliveryId,first.value.deliveryId);assert.equal(again.value.deduplicated,true)
  const deliveryId=first.value.deliveryId;await until(()=>received.length===1)
  const claimed=state(deliveryId);assert.equal(claimed.state,'SENDING');assert.equal(received[0].id,deliveryId);assert.equal(received[0].path,'/PRIVATE?token=SECRET')
  const b=await start();assert.deepEqual(state(deliveryId),claimed);assert.equal(received.length,1)
  held[0].writeHead(204);held[0].end();await until(()=>state(deliveryId).state==='DELIVERED')
  const repeated=await call(b.port,path+'/test','POST',command,review.etag!);assert.equal(repeated.value.deliveryId,deliveryId);assert.equal(repeated.value.state,'DELIVERED');assert.equal(received.length,1)
  await call(b.port,path,'PATCH',{name:'Renamed'},review.etag!)
  await call(a.port,path+'/test','POST',{requestId:randomUUID()},review.etag!,409)
  const fresh=await call(a.port,path+'/review')
  db.sqlite.exec("CREATE TRIGGER integration_audit_failure BEFORE INSERT ON operator_decisions WHEN NEW.kind='INTEGRATION_TEST_QUEUED' BEGIN SELECT RAISE(ABORT,'AUDIT_FAILED');END")
  await call(a.port,path+'/test','POST',{requestId:randomUUID()},fresh.etag!,409)
  assert.equal((db.sqlite.prepare('SELECT COUNT(*) n FROM integration_deliveries').get() as {n:number}).n,1)
  db.sqlite.exec('DROP TRIGGER integration_audit_failure')
  assert.ok(!JSON.stringify(db.sqlite.prepare('SELECT target,payload FROM integration_deliveries').all()).match(/PRIVATE|SECRET/))
  assert.ok(!JSON.stringify(db.sqlite.prepare('SELECT payload FROM operator_decisions').all()).match(/PRIVATE|SECRET/))
  // Seed ONLY these verifier-owned ambiguous records. They are not evidence
  // of a real remote gateway or migration; the API must diagnose, not send.
  for(const [fixture,stateName,error,ownerHost,ownerPid,ownerBoot] of [
    ['qa-unknown','SENDING',null,null,null,null],
    ['qa-remote','SENDING',null,'fixture-remote-host',a.child.pid!,'fixture-remote-boot'],
    ['qa-legacy','FAILED','Envio legado sem responsável identificável. Confirmar.',null,null,null],
  ] as const)db.db.insert(integrationDeliveries).values({id:fixture,integrationId:id,channelId:null,event:'rplayout.test',target,payload:{fixture},manualTest:true,state:stateName,attempts:1,nextAttemptAt:'2000-01-01',createdAt:new Date().toISOString(),lastError:error,ownerHost,ownerPid,ownerBoot}).run()
  const fixtureRows=db.sqlite.prepare("SELECT * FROM integration_deliveries WHERE id LIKE 'qa-%' ORDER BY id").all()
  for(const fixture of ['qa-unknown','qa-remote','qa-legacy']){
    const diagnosis=await call(b.port,'/api/integration-deliveries/'+fixture+'/review')
    assert.equal(diagnosis.cache,'private, no-store');assert.equal(diagnosis.value.canRetry,false)
    assert.equal(diagnosis.value.diagnostic.ownership,fixture==='qa-remote'?'REMOTE':'UNKNOWN')
    assert.ok(!JSON.stringify(diagnosis.value).match(/PRIVATE|SECRET|owner_pid|owner_host|owner_boot|fixture-remote-host/))
    await call(b.port,'/api/integration-deliveries/'+fixture+'/retry','POST',{confirmedPreviousStopped:true},diagnosis.etag!,409)
  }
  assert.deepEqual(db.sqlite.prepare("SELECT * FROM integration_deliveries WHERE id LIKE 'qa-%' ORDER BY id").all(),fixtureRows)
  assert.equal(received.length,1)
  const second=await call(a.port,path+'/test','POST',{requestId:randomUUID()},fresh.etag!)
  await until(()=>received.length===2)
  const interruptedId=second.value.deliveryId,interrupted=state(interruptedId)
  assert.equal(interrupted.state,'SENDING');assert.equal(received[1].id,interruptedId)
  const rawOriginal=db.sqlite.prepare('SELECT target,payload FROM integration_deliveries WHERE id=?').get(interruptedId)
  db.sqlite.exec("CREATE TRIGGER auto_delivery_audit_failure BEFORE INSERT ON operator_decisions WHEN NEW.kind='INTEGRATION_DELIVERY_AUTO_RECOVERED' BEGIN SELECT RAISE(ABORT,'AUDIT_FAILED');END")
  const owner=[a,b].find(server=>server.child.pid===interrupted.owner_pid);assert.ok(owner);await stop(owner.child)
  const peer=owner===a?b:a
  await until(()=>{try{process.kill(interrupted.owner_pid,0);return false}catch(error){return (error as NodeJS.ErrnoException).code==='ESRCH'}})
  await new Promise(resolve=>setTimeout(resolve,1200))
  const blocked=await call(peer.port,'/api/integration-deliveries/'+interruptedId+'/review')
  assert.equal(blocked.value.diagnostic.ownership,'LOCAL_DEAD');assert.equal(blocked.value.canRetry,false)
  const version=blocked.value.revision;assert.deepEqual(state(interruptedId),interrupted);assert.equal(received.length,2)
  assert.equal((await call(peer.port,'/api/integration-deliveries/'+interruptedId+'/review')).value.revision,version)
  assert.equal(db.db.select().from(operatorDecisions).all().filter(row=>row.kind==='INTEGRATION_DELIVERY_AUTO_RECOVERED').length,0)
  db.sqlite.exec('DROP TRIGGER auto_delivery_audit_failure')
  await until(()=>received.length===3);assert.equal(received[2].id,interruptedId);assert.equal(received[2].path,received[1].path)
  assert.equal(received[2].body,received[1].body)
  held[2].writeHead(204);held[2].end();await until(()=>state(interruptedId).state==='DELIVERED')
  const recoveries=db.db.select().from(operatorDecisions).all().filter(row=>row.kind==='INTEGRATION_DELIVERY_AUTO_RECOVERED')
  assert.equal(recoveries.length,1);assert.equal(recoveries[0]!.payload.deliveryId,interruptedId);assert.equal(recoveries[0]!.payload.proof,'LOCAL_PROCESS_ABSENT')
  assert.equal(recoveries[0]!.payload.deliverySemantics,'at-least-once');assert.equal(recoveries[0]!.payload.originalTargetAndPayloadPreserved,true)
  assert.deepEqual(db.sqlite.prepare('SELECT target,payload FROM integration_deliveries WHERE id=?').get(interruptedId),rawOriginal)
  await stop(a.child);await stop(b.child)
  const restarted=await start(),persisted=await call(restarted.port,path+'/review')
  assert.equal(persisted.value.revision,fresh.value.revision);assert.equal(state(deliveryId).state,'DELIVERED');assert.equal(received.length,3)
  assert.deepEqual(db.sqlite.prepare("SELECT * FROM integration_deliveries WHERE id LIKE 'qa-%' ORDER BY id").all(),fixtureRows)
  db.sqlite.exec('DELETE FROM sessions');await call(restarted.port,path+'/test','POST',command,persisted.etag!,401)
  assert.ok(![...logs.values()].join('\n').match(/PRIVATE|SECRET/))
  result={result:'PASS',directory,compiledServerSha256:createHash('sha256').update(await readFile(join(root,'apps/server/dist/server.cjs'))).digest('hex'),twoCompiledServersProtectLiveClaim:true,durableManualTestDisabledConfiguration:true,repeatedCommandOneDeliveryOneLocalPost:true,stableIdempotencyKey:true,onlyActualLocalResponseConfirmsDelivery:true,staleProofRefused:true,auditFailureRollsBack:true,privateReadOnlyOwnerDiagnosisAndAmbiguousRetryRefused:true,unknownRemoteLegacyStatePreservedAfterRestart:true,ownActualHttpClaimCrashRecoveryAuditFailurePreservesOwnerRevisionNoPost:true,oneEncryptedRecoveryAuditAndSameIdTargetPayloadRetried:true,reviewAuditStorageLogsRedactPrivateTarget:true,revisionAndDeliveredStatePersistAfterRestart:true,revokedSessionRefused:true,externalGatewayAndHardwareValidated:false,browserValidated:false,exactlyOnceNotClaimed:true}
 }
}catch(error){result={result:'FAIL',directory,error:String(error)};throw error}
finally{
  const cleanupErrors:string[]=[];for(const child of children)try{await stop(child)}catch(error){cleanupErrors.push(String(error))}
  for(const response of held)response.destroy();gateway.closeAllConnections();await new Promise<void>(resolve=>gateway.close(()=>resolve()));db.sqlite.close()
  await writeFile(join(directory,'server-logs.json'),JSON.stringify([...logs].map(([child,text])=>({pid:child.pid,text})),null,2))
  await writeFile(join(directory,'result.json'),JSON.stringify({...result,cleanupErrors},null,2));console.log(JSON.stringify({...result,cleanupErrors}));assert.equal(cleanupErrors.length,0)
}
