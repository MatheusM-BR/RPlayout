import assert from 'node:assert/strict'
import {spawn,type ChildProcess} from 'node:child_process'
import {createServer} from 'node:net'
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {randomUUID,createHash} from 'node:crypto'

// Seeded historical data: compiled HTTP/ACL/cursor proof, not native signal
// or retention/soak qualification. No ambient server, media or credentials.
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(tmpdir(),'RPlayout-history-pages-'))
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json');delete process.env.RPLAYOUT_VAULT_KEY
const {openDatabase}=await import('../apps/server/src/db/client.js'),{sessionDigest}=await import('../apps/server/src/domain/access.js')
const media=join(directory,'media');await mkdir(media)
const database=openDatabase(join(directory,'service.db')),token=randomUUID()+randomUUID(),serverFile=join(root,'apps/server/dist/server.cjs')
const until=new Date(Date.now()-60000).toISOString(),count=2413
database.sqlite.exec("INSERT INTO users VALUES('u','History QA','NO_LOGIN','ADMIN',1,'now')")
database.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest(token),'u','2099-01-01','now')
database.sqlite.prepare('INSERT INTO user_access(user_id,channel_ids,station_ips,updated_at) VALUES(?,?,NULL,?)').run('u',JSON.stringify(['allowed']),'now')
const insert=database.sqlite.prepare('INSERT INTO host_metric_samples VALUES(?,?)')
function sample(time:string,item:string){return {generatedAt:time,cpu:{percent:99},disk:{path:'PRIVATE_GLOBAL_PATH'},operations:{version:1,capturedAt:time,available:true,channelsTruncated:false,channels:[{channelId:'allowed',itemId:item},{channelId:'denied',itemId:'PRIVATE_DENIED_ITEM'}]}}}
const expected:string[]=[]
database.sqlite.transaction(()=>{for(let index=0;index<count;index++){const time=new Date(Date.parse(until)-index*10000).toISOString();expected.push(time);insert.run(time,JSON.stringify(sample(time,'fixture-'+index)))}})()
const baseline=database.sqlite.prepare('SELECT sampled_at,payload FROM host_metric_samples WHERE sampled_at<=? ORDER BY sampled_at DESC').all(until)
const socket=createServer();await new Promise<void>(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=(socket.address()as {port:number}).port;await new Promise<void>(resolve=>socket.close(()=>resolve()))
let child:ChildProcess|undefined,logs='',result:Record<string,unknown>={result:'FAIL',directory},maxPageMs=0
async function wait(label:string,check:()=>boolean|Promise<boolean>){const deadline=performance.now()+30000;while(performance.now()<deadline){if(await check())return;await new Promise(resolve=>setTimeout(resolve,100))}throw new Error(label+' '+logs)}
async function request(path:string,status=200,authenticated=true){const response=await fetch(`http://127.0.0.1:${port}${path}`,{headers:authenticated?{cookie:'rplayout_session='+token}:{},signal:AbortSignal.timeout(5000)});const body=await response.text();assert.equal(response.status,status,path+' '+body.slice(0,300));return body?JSON.parse(body):null}
try{
  const clean=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^RPLAYOUT_|^VITEST$/i.test(key)))
  child=spawn(process.execPath,['-e',"process.on('message',m=>{if(m==='own-shutdown')process.emit('SIGTERM')});require(process.argv[1])",serverFile],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:{...clean,RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_DB:join(directory,'service.db'),RPLAYOUT_VAULT_FILE:join(directory,'vault.json'),RPLAYOUT_MEDIA:media,RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_CACHE:join(directory,'cache'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_BACKUPS:join(directory,'backups'),RPLAYOUT_ENGINE:'',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_RELAY:'',RPLAYOUT_DEVICES:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_BACKUP_HOURS:'0',HOST:'127.0.0.1',PORT:String(port),LOG_LEVEL:'warn'}})
  for(const stream of [child.stdout,child.stderr])stream?.on('data',chunk=>logs=(logs+String(chunk)).slice(-16000))
  await wait('Own compiled startup',async()=>{assert.equal(child!.exitCode,null,logs);try{return(await request('/api/health')).ok}catch{return false}})
  for(const path of ['/api/host-metrics','/api/host-metrics/history','/api/channels/denied/operational-metrics/history'])await request(path,403)
  await request('/api/channels/allowed/operational-metrics/history',401,false)
  const path='/api/channels/allowed/operational-metrics/history',base=`${path}?hours=14&limit=120&until=${encodeURIComponent(until)}`
  const seen:string[]=[];let before:string|null=null,pages=0
  do{
    const start=performance.now(),page=await request(base+(before?`&before=${encodeURIComponent(before)}`:''));maxPageMs=Math.max(maxPageMs,performance.now()-start)
    assert.equal(page.channelId,'allowed');assert.equal(page.until,until);assert.equal(page.totalSamples,count);assert.ok(page.samples.length<=120)
    for(const row of page.samples){
      seen.push(row.sampledAt)
      for(const field of ['cpu','gpu','disk','network','memory','process'])assert.equal(Object.hasOwn(row,field),false)
      assert.ok(row.operations.channels.every((channel:any)=>channel.channelId==='allowed'))
    }
    assert.ok(!JSON.stringify(page).includes('PRIVATE_'))
    before=page.nextBefore;pages++
    if(pages===1){const later=new Date(Date.parse(until)+1).toISOString();insert.run(later,JSON.stringify(sample(later,'newer-excluded')))}
    assert.ok(pages<=Math.ceil(count/120))
  }while(before)
  assert.deepEqual(seen,expected);assert.equal(new Set(seen).size,count)
  const first=await request(base);assert.deepEqual(first.samples.map((row:any)=>row.sampledAt),expected.slice(0,120))
  for(const query of ['before='+encodeURIComponent(until),'until=invalid',`until=${encodeURIComponent(until)}&before=invalid`,`until=${encodeURIComponent(until)}&before=${encodeURIComponent(new Date(Date.parse(until)+1).toISOString())}`])await request(path+'?'+query,400)
  assert.deepEqual(database.sqlite.prepare('SELECT sampled_at,payload FROM host_metric_samples WHERE sampled_at<=? ORDER BY sampled_at DESC').all(until),baseline)
  await request('/api/processes',403)
  assert.equal((await request('/api/health')).engines,0)
  child.send('own-shutdown');await wait('Own compiled shutdown',()=>child!.exitCode!==null||child!.signalCode!==null);assert.equal(child.exitCode,0,logs)
  await assert.rejects(()=>fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(1000)}))
  result={result:'PASS',directory,compiledServerSha256:createHash('sha256').update(await readFile(serverFile)).digest('hex'),seededHistoricalSamples:count,pages,uniqueSamples:seen.length,exclusiveCursorAndFixedWindow:true,newerInsertExcluded:true,channelAclAndUnauthenticatedRefusal:true,globalResourcesAndDeniedChannelOmitted:true,invalidCursorsRefused:true,historicalPayloadsPreserved:true,noEngineCreated:true,ownChildAndListenerClosed:true,maxObservedPageMs:Math.round(maxPageMs),physicalSignalsValidated:false,browserValidated:false,retentionAndSoakValidated:false,representativeProductionLoadValidated:false}
}catch(error){result={...result,error:String(error)};throw error}
finally{
  if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await wait('Own failed fixture cleanup',()=>child!.exitCode!==null||child!.signalCode!==null)}
  database.sqlite.close();await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));await writeFile(join(directory,'server.log'),logs);console.log(JSON.stringify(result))
}
