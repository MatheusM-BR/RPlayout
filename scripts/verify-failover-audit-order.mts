import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {randomUUID,createHash} from 'node:crypto'
import {createRequire} from 'node:module'

// Diagnostic reproducer. A FAIL is retained as a defect, not green evidence
// of desired behavior. Own in-memory app, no engine/HTTP socket/source/device.
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(root,'scratch','failover-audit-order-'))
assert.ok(process.argv.length===2||process.argv.length===3)
const binaries=process.argv[2]?resolve(process.argv[2]):null
if(binaries)assert.ok(binaries.startsWith(join(root,'scratch','host-history-r88-')))
await mkdir(join(directory,'media'))
for(const name of Object.keys(process.env))if(/^(RPLAYOUT_|GST_|GSTREAMER_|MTX_|RTSP_|VITEST$)/i.test(name))delete process.env[name]
Object.assign(process.env,{RPLAYOUT_ENGINE:'',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_RELAY:'',RPLAYOUT_DEVICES:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_AUDIO_BUS_PROBE:'',RPLAYOUT_GRAPHIC_PROBE:'',RPLAYOUT_MEDIA:join(directory,'media'),RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_CACHE:join(directory,'cache'),RPLAYOUT_BACKUPS:join(directory,'backups'),RPLAYOUT_VAULT_FILE:join(directory,'vault.json'),RPLAYOUT_BACKUP_HOURS:'0',RPLAYOUT_STORAGE_MODE:'INLINE',RPLAYOUT_ROLE:'ADMIN',RPLAYOUT_ADMIN_USER:'',RPLAYOUT_ADMIN_PASSWORD:''})
if(binaries)Object.assign(process.env,{RPLAYOUT_STORAGE_MODE:'PROCESS',RPLAYOUT_STORAGE_BIN_DIR:binaries,NODE_PATH:join(root,'apps/server/node_modules')})
const Fastify=createRequire(new URL('../apps/server/package.json',import.meta.url))('fastify') as typeof import('../apps/server/node_modules/fastify/fastify.js').default
const {createApp}=await import('../apps/server/src/app.js'),{registerRoutes}=await import('../apps/server/src/routes.js')
const {channels,liveSources}=await import('../apps/server/src/db/schema.js'),{globalSrtManager}=await import('../apps/server/src/domain/srt.js')
const {databaseStorageStatus}=await import('../apps/server/src/db/process-database.js')
const observations:any[]=[],result:Record<string,any>={result:'FAIL',directory,binaries,borrowedDevelopmentDependencies:Boolean(binaries),scope:'Source internal route injection and controlled pre-INSERT audit rejection; local metadata only, not native failover, real storage timeout, network, hardware or installed qualification',routesSourceSha256:createHash('sha256').update(await readFile(join(root,'apps/server/src/routes.ts'))).digest('hex'),observations}
let app:Awaited<ReturnType<typeof createApp>>
try{app=await createApp(binaries?join(directory,'failover-ação.db'):':memory:')}
catch(error){result.stage='STARTUP';result.error=String(error);await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(result));throw error}
result.storage=databaseStorageStatus(app.sqlite)
const server=Fastify();registerRoutes(app,server,()=>{})
try{
 app.db.insert(channels).values({id:'qa',name:'QA metadata only',width:320,height:180,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:new Date().toISOString()}).run()
 for(const path of['/api/v1/engineering/failover/trigger','/api/engineering/failover/trigger','/api/v1/sources/live/@id/force-failover','/api/sources/live/@id/force-failover']){
  const id=randomUUID(),key=randomUUID(),stamp=new Date().toISOString()
  app.db.insert(liveSources).values({id,channelId:'qa',name:'QA no opened SRT source',kind:'SRT',targetUrl:'srt://127.0.0.1:1',role:'PRIMARY',autoFailover:false,enabled:true,createdAt:stamp}).run()
  const url=path.replace('@id',id),request={method:'POST' as const,url,headers:{'idempotency-key':key},payload:path.includes('/engineering/')?{sourceId:id}:{}}
  globalSrtManager.failover.setActiveRole(id,'PRIMARY')
  const count=()=>Number((app.sqlite.prepare("SELECT count(*) n FROM health_events WHERE component='FAILOVER_CONTROLLER'").get() as {n:number}).n)
  const before=count()
  app.sqlite.exec("CREATE TRIGGER qa_reject_failover_audit BEFORE INSERT ON health_events WHEN NEW.component='FAILOVER_CONTROLLER' BEGIN SELECT RAISE(ABORT,'QA_FAILOVER_AUDIT_REJECTED'); END")
  const rejected=await server.inject(request),afterRejectedRole=globalSrtManager.failover.getActiveRole(id)
  assert.equal(rejected.statusCode,500);assert.equal(count(),before)
  app.sqlite.exec('DROP TRIGGER qa_reject_failover_audit')
  const retry=await server.inject(request),afterRetryRole=globalSrtManager.failover.getActiveRole(id),repeat=await server.inject(request),afterRepeatRole=globalSrtManager.failover.getActiveRole(id)
  observations.push({path,rejectedStatus:rejected.statusCode,beforeRole:'PRIMARY',afterRejectedRole,afterRejectedAuditCount:before,retryStatus:retry.statusCode,afterRetryRole,repeatStatus:repeat.statusCode,afterRepeatRole,newAuditEvents:count()-before,retryBody:retry.json(),repeatBody:repeat.json(),sameIdempotencyKey:true})
 }
 result.unchangedOnAuditFailure=observations.every(row=>row.afterRejectedRole===row.beforeRole)
 result.retriesDeduplicated=observations.every(row=>row.retryStatus===200&&row.repeatStatus===200&&row.afterRepeatRole===row.afterRetryRole&&row.newAuditEvents===1&&row.repeatBody.metadataDecision?.replayed===true&&row.repeatBody.nativeProgramConfirmed===false)
 result.result=result.unchangedOnAuditFailure&&result.retriesDeduplicated?'PASS':'FAIL'
}catch(error){result.error=String(error)}
finally{
 await server.close();await app.close();assert.equal(app.runtimes.size,0)
 if(binaries){
  const end=Date.now()+10000;let absent=false
  while(Date.now()<end){try{process.kill(result.storage.storagePid,0)}catch(error){absent=(error as NodeJS.ErrnoException).code==='ESRCH'}if(absent)break;await new Promise(done=>setTimeout(done,25))}
  result.ownStorageProcessAbsent=absent;if(!absent)result.result='FAIL'
 }
 await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2),{flag:'wx'})
}
console.log(JSON.stringify(result))
if(result.result!=='PASS')process.exitCode=1
