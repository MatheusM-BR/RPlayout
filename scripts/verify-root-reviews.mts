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
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(tmpdir(),'RPlayout-root-review-'))
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json')
const file=join(directory,'qa.db'),db=openDatabase(file),media=join(directory,'media');await mkdir(media)
const original=join(media,'AÇÃO Çãó.mp4');await writeFile(original,'CATALOG_FIXTURE_NOT_PLAYABLE_VIDEO')
const originalHash=createHash('sha256').update(await readFile(original)).digest('hex'),token=randomUUID()+randomUUID()
db.sqlite.exec("INSERT INTO users VALUES('u','Admin','NO_LOGIN','ADMIN',1,'now')")
db.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest(token),'u','2099-01-01','now')
db.sqlite.prepare("INSERT INTO media_assets(id,content_hash,path,title,kind,duration_frames,category_id,created_at) VALUES('a',?,?,'Fixture','VIDEO',25,'AÇÃO Çãó','now')").run(originalHash,original)
const headers={cookie:'rplayout_session='+token},children:ChildProcess[]=[],logs=new Map<ChildProcess,string>()
const added=join(directory,'Programação Çãó & Ópera');await mkdir(added)
async function port(){const socket=createServer();await new Promise<void>(resolve=>socket.listen(0,'127.0.0.1',resolve));const value=(socket.address() as {port:number}).port;await new Promise<void>(resolve=>socket.close(()=>resolve()));return value}
async function call(p:number,url:string,method='GET',body?:object,etag?:string,status=200){
  const response=await fetch(`http://127.0.0.1:${p}${url}`,{method,headers:{...headers,...(body?{'content-type':'application/json'}:{}),...(etag?{'if-match':etag}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)})
  const value=await response.json();if(status)assert.equal(response.status,status,JSON.stringify(value));return {status:response.status,value,etag:response.headers.get('etag'),cache:response.headers.get('cache-control')}
}
async function start(){
  const p=await port(),env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^RPLAYOUT_/i.test(key)))
  const child=spawn(process.execPath,[join(root,'apps/server/dist/server.cjs')],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...env,RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_DB:file,RPLAYOUT_VAULT_FILE:join(directory,'vault.json'),RPLAYOUT_MEDIA:media,RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_CACHE:join(directory,'cache'),RPLAYOUT_BACKUPS:join(directory,'backups'),RPLAYOUT_ENGINE:'',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_RELAY:'',RPLAYOUT_DEVICES:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_BACKUP_HOURS:'0',RPLAYOUT_ROLE:'ADMIN',HOST:'127.0.0.1',PORT:String(p),LOG_LEVEL:'warn'}})
  children.push(child);logs.set(child,'');child.on('error',error=>logs.set(child,(logs.get(child)??'')+String(error)))
  for(const stream of [child.stdout,child.stderr])stream?.on('data',data=>logs.set(child,((logs.get(child)??'')+String(data)).slice(-10000)))
  const deadline=performance.now()+25000
  while(performance.now()<deadline){if(child.exitCode!==null||child.signalCode!==null)throw new Error('Own server exited '+logs.get(child));try{if((await call(p,'/api/health')).value.ok)return {child,port:p}}catch{}await new Promise(resolve=>setTimeout(resolve,100))}
  throw new Error('Own server not ready '+logs.get(child))
}
async function stop(child:ChildProcess){
  if(child.exitCode!==null||child.signalCode!==null)return
  const ended=new Promise<void>(resolve=>child.once('exit',()=>resolve()));assert.equal(child.kill('SIGKILL'),true)
  let timer:ReturnType<typeof setTimeout>|undefined
  try{await Promise.race([ended,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Own server did not exit')),10000)})])}finally{if(timer)clearTimeout(timer)}
}

const state=()=>db.sqlite.prepare('SELECT id,path,label FROM media_roots ORDER BY id').all()
let result:object|undefined
try{
  const a=await start(),b=await start(),before=state(),first=await call(a.port,'/api/library/roots/review')
  assert.equal(first.cache,'private, no-store');assert.deepEqual(state(),before);assert.deepEqual((await call(b.port,'/api/library/roots/review')).value,first.value)
  const url='/api/library/roots/add-review?path='+encodeURIComponent(added),review=await call(a.port,url)
  assert.equal(review.value.candidate.path,added);assert.equal(review.cache,'private, no-store');assert.deepEqual(state(),before)
  await call(a.port,'/api/library/roots','POST',{path:added},undefined,428)
  const responses=await Promise.all([a,b].map(server=>call(server.port,'/api/library/roots','POST',{path:added,label:'AÇÃO Çãó'},review.etag!,0)))
  assert.deepEqual(responses.map(row=>row.status).sort(),[200,409])
  const saved=responses.find(row=>row.status===200)!.value,id=saved.root.id,path='/api/library/roots/'+encodeURIComponent(id)
  assert.equal(saved.scanning,false);assert.equal(saved.scanRequired,true)
  assert.equal((db.sqlite.prepare("SELECT COUNT(*) n FROM operator_decisions WHERE kind='MEDIA_ROOT_ADDED'").get() as {n:number}).n,1)
  const next=await call(a.port,'/api/library/roots/review');db.sqlite.exec('UPDATE media_roots SET label=label')
  await call(b.port,path,'DELETE',undefined,next.etag!,409)
  const fresh=await call(a.port,'/api/library/roots/review')
  db.sqlite.exec("CREATE TRIGGER root_audit_failure BEFORE INSERT ON operator_decisions WHEN NEW.kind='MEDIA_ROOT_REMOVED' BEGIN SELECT RAISE(ABORT,'AUDIT_FAILED');END")
  const frozen=state();await call(a.port,path,'DELETE',undefined,fresh.etag!,409);assert.deepEqual(state(),frozen)
  db.sqlite.exec('DROP TRIGGER root_audit_failure')
  db.sqlite.exec("INSERT INTO user_access VALUES('u','[\"restricted\"]',NULL,'now')")
  await call(a.port,path,'DELETE',undefined,fresh.etag!,403);db.sqlite.exec('DELETE FROM user_access')
  const removed=await call(b.port,path,'DELETE',undefined,fresh.etag!);assert.equal(removed.value.applied,true)
  assert.equal(createHash('sha256').update(await readFile(original)).digest('hex'),originalHash)
  assert.ok(db.sqlite.prepare("SELECT 1 FROM media_assets WHERE id='a'").get())
  await stop(a.child);await stop(b.child)
  const restarted=await start(),persisted=await call(restarted.port,'/api/library/roots/review')
  assert.equal(persisted.value.revision,removed.value.review.revision);assert.ok(!persisted.value.roots.some((row:{id:string})=>row.id===id))
  db.sqlite.exec('DELETE FROM sessions');await call(restarted.port,path,'DELETE',undefined,persisted.etag!,401)
  result={result:'PASS',directory,compiledServerSha256:createHash('sha256').update(await readFile(join(root,'apps/server/dist/server.cjs'))).digest('hex'),twoCompiledServersOneCommit:true,unicodePathPreserved:true,readDoesNotCreateRoot:true,sameValueInvalidatesOriginalReview:true,auditFailureRollsBack:true,scopedWriteRefused:true,revokedSessionRefused:true,removalAndRevisionPersistAfterRestart:true,originalFileAndAssetPreserved:true,scanNotStartedImplicitly:true,fixtureIsNotPlayableVideo:true,scanPgmHardwareBrowserValidated:false}
}catch(error){result={result:'FAIL',directory,error:String(error)};throw error}
finally{
  const cleanupErrors:string[]=[];for(const child of children)try{await stop(child)}catch(error){cleanupErrors.push(String(error))}
  db.sqlite.close();await writeFile(join(directory,'server-logs.json'),JSON.stringify([...logs].map(([child,text])=>({pid:child.pid,text})),null,2))
  await writeFile(join(directory,'result.json'),JSON.stringify({...result,cleanupErrors},null,2));console.log(JSON.stringify({...result,cleanupErrors}));assert.equal(cleanupErrors.length,0)
}
