import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash,randomUUID} from 'node:crypto'
import {createRequire} from 'node:module'

// Actual route/auth/domain/ORM over PROCESS, using Fastify's internal injector.
// No TCP/HTTP listener, proxy workaround or installed-backend qualification.
assert.equal(process.argv.length,3)
const root=fileURLToPath(new URL('..',import.meta.url)),binaries=resolve(process.argv[2]!)
assert.ok(binaries.startsWith(join(root,'scratch','host-history-r88-')))
const directory=await mkdtemp(join(root,'scratch','storage-category-routes-')),media=join(directory,'media'),file=join(directory,'Categorias-ação.db')
await mkdir(media)
for(const key of Object.keys(process.env))if(/^RPLAYOUT_|^VITEST$/i.test(key))delete process.env[key]
Object.assign(process.env,{NODE_PATH:join(root,'apps/server/node_modules'),RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_STORAGE_MODE:'PROCESS',RPLAYOUT_STORAGE_BIN_DIR:binaries,RPLAYOUT_VAULT_FILE:join(directory,'vault.json'),RPLAYOUT_MEDIA:media,RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_CACHE:join(directory,'cache'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_BACKUPS:join(directory,'backups'),RPLAYOUT_ENGINE:'',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_RELAY:'',RPLAYOUT_DEVICES:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_BACKUP_HOURS:'0'})
const {createApp}=await import('../apps/server/src/app.js'),{registerRoutes}=await import('../apps/server/src/routes.js'),{sessionDigest}=await import('../apps/server/src/domain/access.js'),{databaseStorageStatus}=await import('../apps/server/src/db/process-database.js')
const {installationVault}=await import('../apps/server/src/domain/secret-vault.js')
const Fastify=createRequire(new URL('../apps/server/package.json',import.meta.url))('fastify')
const apps:Array<{app:Awaited<ReturnType<typeof createApp>>;server:any;closed:boolean}>=[],owned=new Set<number>()
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex'),category='AÇÃO São José Çãó',path='/api/categories/'+encodeURIComponent(category)
const tokens={a:randomUUID()+randomUUID(),b:randomUUID()+randomUUID()}
let result:Record<string,any>={result:'FAIL',directory,binaries,scope:'Actual category route/auth/ORM through internal request injection, two app instances in ONE parent with distinct PROCESS workers; not HTTP/WS, independent installed backends or PGM'},failure:unknown=null
async function start(){
  const app=await createApp(file),storage=databaseStorageStatus(app.sqlite)
  assert.equal(storage.mode,'PROCESS');assert.notEqual(storage.storagePid,process.pid);owned.add(storage.storagePid)
  const server=Fastify();registerRoutes(app,server,()=>{})
  const entry={app,server,closed:false};apps.push(entry);return entry
}
async function stop(entry:typeof apps[number]){if(entry.closed)return;await entry.server.close();await entry.app.close();entry.closed=true}
async function call(entry:typeof apps[number],who:'a'|'b',method:string,url:string,payload?:object,etag?:string,status=200){
  const response=await entry.server.inject({method,url,headers:{cookie:'rplayout_session='+tokens[who],...(etag?{'if-match':etag}:{})},...(payload?{payload}:{})})
  const value=response.json();assert.equal(response.statusCode,status,method+' '+url+' '+JSON.stringify(value))
  return {status:response.statusCode,value,etag:response.headers.etag,cache:response.headers['cache-control']}
}
const alive=(pid:number)=>{assert.ok(Number.isSafeInteger(pid)&&pid>0);try{process.kill(pid,0);return true}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return false;throw error}}
try{
  const a=await start(),stamp=new Date().toISOString(),sqlite=a.app.sqlite
  for(const [id,token]of Object.entries(tokens)){
    sqlite.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id,'QA-'+id.toUpperCase(),'NO_LOGIN','ADMIN',1,stamp)
    sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest(token),id,'2099-01-01',stamp)
  }
  const catalogFile=join(media,'NÃO É VÍDEO - fixture catálogo.mp4')
  await writeFile(catalogFile,'CATALOG_FIXTURE_NOT_PLAYABLE_VIDEO')
  const catalogHash=hash(await readFile(catalogFile))
  sqlite.prepare("INSERT INTO media_assets(id,content_hash,path,title,kind,duration_frames,category_id,created_at) VALUES('asset',?,?,'Fixture catálogo','VIDEO',25,?,?)").run(catalogHash,catalogFile,category,stamp)
  const b=await start();assert.notEqual(databaseStorageStatus(a.app.sqlite).storagePid,databaseStorageStatus(b.app.sqlite).storagePid)
  const state=()=>({categories:sqlite.prepare('SELECT * FROM categories ORDER BY id').all(),revision:sqlite.prepare('SELECT * FROM category_revision').all(),links:sqlite.prepare("SELECT category_id FROM media_assets WHERE id='asset'").all()})
  const before=state(),first=await call(a,'a','GET',path+'/review'),second=await call(b,'b','GET',path+'/review')
  assert.equal(first.cache,'private, no-store');assert.equal(first.value.items,1);assert.equal(first.value.stored,false);assert.equal(first.value.canEdit,true)
  assert.deepEqual(first.value,second.value);assert.equal(first.etag,second.etag);assert.deepEqual(state(),before)
  await call(a,'a','PUT',path,{color:'#112233'},undefined,428)
  const race=await Promise.all([a.server.inject({method:'PUT',url:path,headers:{cookie:'rplayout_session='+tokens.a,'if-match':first.etag},payload:{color:'#112233'}}),b.server.inject({method:'PUT',url:path,headers:{cookie:'rplayout_session='+tokens.b,'if-match':second.etag},payload:{color:'#445566'}})])
  assert.deepEqual(race.map(row=>row.statusCode).sort(),[200,409])
  const decisions=()=>sqlite.prepare("SELECT kind,payload,actor_username FROM operator_decisions WHERE kind IN ('CATEGORY_COLOR_CHANGED','CATEGORY_REMOVED') ORDER BY rowid").all() as {kind:string;payload:string;actor_username:string}[]
  assert.equal(decisions().length,1)
  const winner=race[0].statusCode===200?'a':'b';assert.equal(decisions()[0]!.actor_username,'QA-'+winner.toUpperCase())
  result.cas={statuses:race.map(row=>row.statusCode),winner,originalReview:first.value,originalEtag:first.etag,onlyOneColorAudit:true}
  const fresh=await call(b,'b','GET',path+'/review'),frozen=state()
  sqlite.prepare('INSERT INTO user_access(user_id,channel_ids,station_ips,updated_at) VALUES(?,?,NULL,?)').run('b',JSON.stringify(['restricted-channel']),stamp)
  const limited=await call(b,'b','GET',path+'/review');assert.equal(limited.value.canEdit,false)
  await call(b,'b','PUT',path,{color:'#ffffff'},fresh.etag,403);assert.deepEqual(state(),frozen);assert.equal(decisions().length,1)
  sqlite.prepare('DELETE FROM sessions WHERE user_id=?').run('a')
  await call(a,'a','GET',path+'/review',undefined,undefined,401)
  await call(a,'a','PUT',path,{color:'#ffffff'},fresh.etag,401);assert.deepEqual(state(),frozen);assert.equal(decisions().length,1)
  result.freshAuthority={limitedReviewReadOnly:true,limitedGlobalWriteRefused:true,revokedSessionReadAndWriteRefused:true,categoryAndAuditPreserved:true}
  sqlite.prepare('DELETE FROM user_access WHERE user_id=?').run('b')
  const removal=await call(b,'b','GET',path+'/review')
  sqlite.exec("CREATE TRIGGER qa_category_audit_failure BEFORE INSERT ON operator_decisions WHEN NEW.kind='CATEGORY_REMOVED' BEGIN SELECT RAISE(ABORT,'QA_CATEGORY_AUDIT_FAILURE'); END")
  const failedBefore=state();await call(b,'b','DELETE',path,undefined,removal.etag,409)
  assert.deepEqual(state(),failedBefore);assert.equal(decisions().length,1)
  sqlite.exec('DROP TRIGGER qa_category_audit_failure')
  const removed=await call(b,'b','DELETE',path,undefined,removal.etag)
  assert.equal(removed.value.applied,true);assert.equal(removed.value.soltos,1)
  assert.equal((sqlite.prepare("SELECT category_id FROM media_assets WHERE id='asset'").get() as {category_id:string|null}).category_id,null)
  const audit=decisions().map(row=>({...row,payload:JSON.parse(installationVault(false).decrypt(row.payload,'operator_decisions.payload'))}))
  assert.deepEqual(audit.map(row=>row.kind),['CATEGORY_COLOR_CHANGED','CATEGORY_REMOVED']);assert.equal(audit[1]!.actor_username,'QA-B')
  assert.equal(audit[1]!.payload.automaticTake,false);assert.equal(hash(await readFile(catalogFile)),catalogHash)
  result.removal={auditFailureRolledBack:true,removed:removed.value,audit,catalogFile,catalogHash,catalogIsPlayableVideo:false}
  await stop(a);await stop(b)
  const reconstructed=await start(),persisted=await call(reconstructed,'b','GET',path+'/review')
  assert.equal(persisted.value.revision,removed.value.revision);assert.equal(persisted.value.stored,false);assert.equal(persisted.value.items,0)
  result.reconstructed={review:persisted.value,sameParentProcess:true,backendRestartValidated:false}
  assert.equal(reconstructed.app.runtimes.size,0);assert.equal(reconstructed.app.mediamtx,null)
  result.noRuntimeCreated=true
  result.hashes=Object.fromEntries(await Promise.all(['storage-bridge.cjs','storage-service.cjs'].map(async name=>[name,hash(await readFile(join(binaries,name)))])))
  result.result='PASS'
}catch(error){failure=error;result.error=String(error);throw error}
finally{
  const cleanupErrors:string[]=[];for(const entry of apps)try{await stop(entry)}catch(error){cleanupErrors.push(String(error))}
  const deadline=performance.now()+15000;while([...owned].some(alive)&&performance.now()<deadline)await new Promise(done=>setTimeout(done,50))
  result.ownedServicePids=[...owned];result.ownedServicesStopped=[...owned].every(pid=>!alive(pid));result.cleanupErrors=cleanupErrors
  if(!result.ownedServicesStopped||cleanupErrors.length){result.result='FAIL';result.teardownError='Own storage closure not confirmed; no historical PID will be killed'}
  result.httpTransportValidated=false;result.installedBackendValidated=false;result.independentBackendProcessesValidated=false;result.pgmAndAsRunValidated=false
  await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result))
  if(result.result!=='PASS'&&!failure)throw new Error(result.teardownError)
}
