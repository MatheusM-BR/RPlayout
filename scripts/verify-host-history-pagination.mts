import assert from 'node:assert/strict'
import {spawn,type ChildProcess} from 'node:child_process'
import {createServer} from 'node:net'
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises'
import {join,resolve,relative} from 'node:path'
import {fileURLToPath} from 'node:url'
import {randomUUID,createHash} from 'node:crypto'

// Source-build HTTP/ACL proof over declared historical fixtures. Project Node
// dependencies are explicit; NOT an installed/standalone/native qualification.
assert.equal(process.argv.length,3)
const root=fileURLToPath(new URL('..',import.meta.url)),serverFile=resolve(process.argv[2]!)
assert.ok(relative(join(root,'scratch'),serverFile).startsWith('host-history-r88-'))
assert.equal(serverFile,join(resolve(serverFile,'..'),'server.cjs'))
const directory=await mkdtemp(join(root,'scratch','host-history-http-')),media=join(directory,'media')
await mkdir(media)
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json');delete process.env.RPLAYOUT_VAULT_KEY
const {openDatabase}=await import('../apps/server/src/db/client.js'),{sessionDigest}=await import('../apps/server/src/domain/access.js')
const database=openDatabase(join(directory,'service.db')),stamp=new Date().toISOString()
const tokens={global:randomUUID()+randomUUID(),scoped:randomUUID()+randomUUID()}
for(const [id,token]of Object.entries(tokens)){
  database.sqlite.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id,'History-'+id,'NO_LOGIN','ADMIN',1,stamp)
  database.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest(token),id,'2099-01-01',stamp)
}
database.sqlite.prepare('INSERT INTO user_access(user_id,channel_ids,station_ips,updated_at) VALUES(?,?,NULL,?)').run('scoped',JSON.stringify(['allowed']),stamp)
const until=new Date(Date.now()-60000).toISOString(),count=2413,expected:string[]=[]
const insert=database.sqlite.prepare('INSERT INTO host_metric_samples VALUES(?,?)')
const sample=(time:string)=>({generatedAt:time,sampleIntervalSeconds:10,cpu:{percent:null,cores:4},memory:{totalBytes:1000,usedBytes:500,freeBytes:500,percent:50},process:{rssBytes:100,heapUsedBytes:50},gpu:{utilizationPercent:null,memoryUsedMiB:null,memoryTotalMiB:null,temperatureC:null,name:null,error:'Synthetic unavailable'},disk:{path:'SYNTHETIC_QA_ONLY',totalBytes:1000,freeBytes:500,percentUsed:50,error:null},network:{receivedBytesPerSecond:0,sentBytesPerSecond:null,source:'SYNTHETIC_QA_ONLY',error:null}})
database.sqlite.transaction(()=>{for(let index=0;index<count;index++){const time=new Date(Date.parse(until)-index*10000).toISOString();expected.push(time);insert.run(time,JSON.stringify(sample(time)))}})()
const baseline=database.sqlite.prepare('SELECT sampled_at,payload FROM host_metric_samples WHERE sampled_at<=? ORDER BY sampled_at DESC').all(until)
const allocator=createServer();await new Promise<void>(done=>allocator.listen(0,'127.0.0.1',done));const port=(allocator.address() as {port:number}).port;await new Promise<void>(done=>allocator.close(()=>done()))
let child:ChildProcess|null=null,logs='',probeError='',result:Record<string,unknown>={result:'FAIL',directory},maxPageMs=0
async function wait(label:string,check:()=>boolean|Promise<boolean>){const deadline=performance.now()+30000;while(performance.now()<deadline){if(await check())return;await new Promise(done=>setTimeout(done,100))}throw new Error(label+' '+probeError+' '+logs)}
async function request(path:string,status=200,token:string|null=tokens.global){const response=await fetch(`http://127.0.0.1:${port}${path}`,{headers:token?{cookie:'rplayout_session='+token}:{},signal:AbortSignal.timeout(5000)});const text=await response.text();assert.equal(response.status,status,path+' '+text.slice(0,300));return text?JSON.parse(text):null}
try{
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^RPLAYOUT_|^VITEST$|^NODE_PATH$|^HOST$|^PORT$/i.test(key)))
  child=spawn(process.execPath,['-e',"process.on('message',m=>{if(m==='own-shutdown')process.emit('SIGTERM')});require(process.argv[1])",serverFile],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:{...env,NODE_PATH:join(root,'apps/server/node_modules'),RPLAYOUT_STARTUP_TRACE:'1',RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_DB:join(directory,'service.db'),RPLAYOUT_VAULT_FILE:join(directory,'vault.json'),RPLAYOUT_MEDIA:media,RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_CACHE:join(directory,'cache'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_BACKUPS:join(directory,'backups'),RPLAYOUT_ENGINE:'',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_RELAY:'',RPLAYOUT_DEVICES:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_BACKUP_HOURS:'0',HOST:'127.0.0.1',PORT:String(port),LOG_LEVEL:'warn'}})
  for(const stream of [child.stdout,child.stderr])stream?.on('data',chunk=>logs=(logs+String(chunk)).slice(-16000))
  await wait('Own source-build server',async()=>{assert.equal(child!.exitCode,null,logs);try{const health=await request('/api/health');if(!health.ok)probeError=JSON.stringify(health);return health.ok}catch(error){probeError=String(error);return false}})
  const base='/api/host-metrics/history?hours=14&limit=120&until='+encodeURIComponent(until)
  await request(base,401,null);await request(base,403,tokens.scoped)
  const seen:string[]=[];let before:string|null=null,pages=0
  do{
    const started=performance.now(),page=await request(base+(before?'&before='+encodeURIComponent(before):''));maxPageMs=Math.max(maxPageMs,performance.now()-started)
    assert.equal(page.until,until);assert.equal(page.totalSamples,count);assert.ok(page.samples.length<=120)
    assert.equal(page.since,new Date(Date.parse(until)-14*3600_000).toISOString())
    for(const row of page.samples){seen.push(row.generatedAt);assert.equal(row.cpu.percent,null);assert.equal(row.network.receivedBytesPerSecond,0);assert.equal(row.disk.path,'SYNTHETIC_QA_ONLY')}
    before=page.nextBefore;pages++
    if(pages===1){const newer=new Date(Date.parse(until)+1).toISOString();insert.run(newer,JSON.stringify(sample(newer)))}
    assert.ok(pages<=Math.ceil(count/120))
  }while(before)
  assert.deepEqual(seen,expected);assert.equal(new Set(seen).size,count)
  assert.deepEqual(database.sqlite.prepare('SELECT sampled_at,payload FROM host_metric_samples WHERE sampled_at<=? ORDER BY sampled_at DESC').all(until),baseline)
  const first=await request(base);assert.deepEqual(first.samples.map((row:any)=>row.generatedAt),expected.slice(0,120))
  for(const query of ['before='+encodeURIComponent(until),'until=invalid','limit=5001',`until=${encodeURIComponent(until)}&before=${encodeURIComponent(first.since)}`])await request('/api/host-metrics/history?'+query,400)
  // Delete ONLY this fixture's seeded tail, simulating availability after expiry.
  database.sqlite.prepare('DELETE FROM host_metric_samples WHERE sampled_at<?').run(first.nextBefore)
  const expired=await request(base+'&before='+encodeURIComponent(first.nextBefore))
  assert.equal(expired.until,until);assert.equal(expired.since,first.since);assert.equal(expired.totalSamples,120);assert.deepEqual(expired.samples,[]);assert.equal(expired.nextBefore,null)
  assert.equal((await request('/api/health')).engines,0)
  child.send('own-shutdown');await wait('Own source-build shutdown',()=>child!.exitCode!==null||child!.signalCode!==null);assert.equal(child.exitCode,0,logs)
  await assert.rejects(()=>fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(1000)}))
  result={result:'PASS',directory,compiledServer:serverFile,compiledServerSha256:createHash('sha256').update(await readFile(serverFile)).digest('hex'),seededHistoricalSamples:count,pages,uniqueSamples:seen.length,exclusiveCursorAndFixedWindow:true,newerInsertExcluded:true,globalAclAndUnauthenticatedRefusal:true,invalidCursorsRefused:true,historicalPayloadsPreservedBeforeSimulatedExpiry:true,expiredTailHandledWithoutWindowDrift:true,projectDependenciesUsed:true,noEngineCreated:true,ownChildAndListenerClosed:true,maxObservedPageMs:Math.round(maxPageMs),installedPackageValidated:false,browserValidated:false,physicalSignalsValidated:false,retentionSoakAndProductionLoadValidated:false}
}catch(error){result={...result,error:String(error)};throw error}
finally{
  if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await wait('Own failed source-build cleanup',()=>child!.exitCode!==null||child!.signalCode!==null)}
  database.sqlite.close();await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));await writeFile(join(directory,'server.log'),logs);console.log(JSON.stringify(result))
}
