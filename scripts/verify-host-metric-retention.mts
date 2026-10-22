import assert from 'node:assert/strict'
import {spawn,type ChildProcess} from 'node:child_process'
import {createServer} from 'node:net'
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(tmpdir(),'RPlayout-history-retention-')),file=join(directory,'service.db'),vault=join(directory,'vault.json'),media=join(directory,'media'),compiled=join(root,'apps/server/dist/server.cjs')
process.env.RPLAYOUT_VAULT_FILE=vault;delete process.env.RPLAYOUT_VAULT_KEY
const {openDatabase}=await import('../apps/server/src/db/client.js');await mkdir(media)
const database=openDatabase(file),expired=new Date(Date.now()-15*86400_000).toISOString(),retained=new Date(Date.now()-13*86400_000).toISOString(),retainedPayload=JSON.stringify({generatedAt:retained,legacy:true})
database.sqlite.prepare('INSERT INTO host_metric_samples VALUES(?,?)').run(expired,JSON.stringify({generatedAt:expired,legacy:true}))
database.sqlite.prepare('INSERT INTO host_metric_samples VALUES(?,?)').run(retained,retainedPayload)
const socket=createServer();await new Promise<void>(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=(socket.address()as {port:number}).port;await new Promise<void>(resolve=>socket.close(()=>resolve()))
let child:ChildProcess|undefined,logs='',result:Record<string,unknown>={result:'FAIL',directory}
async function wait(label:string,check:()=>boolean|Promise<boolean>){const deadline=performance.now()+30000;while(performance.now()<deadline){if(await check())return;await new Promise(resolve=>setTimeout(resolve,100))}throw new Error(label+' '+logs)}
try{
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^RPLAYOUT_|^VITEST$/i.test(key)))
  child=spawn(process.execPath,['-e',"process.on('message',m=>{if(m==='own-shutdown')process.emit('SIGTERM')});require(process.argv[1])",compiled],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:{...env,RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_DB:file,RPLAYOUT_VAULT_FILE:vault,RPLAYOUT_MEDIA:media,RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_CACHE:join(directory,'cache'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_BACKUPS:join(directory,'backups'),RPLAYOUT_ENGINE:'',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_RELAY:'',RPLAYOUT_DEVICES:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_BACKUP_HOURS:'0',HOST:'127.0.0.1',PORT:String(port),LOG_LEVEL:'warn'}})
  for(const stream of [child.stdout,child.stderr])stream?.on('data',chunk=>logs=(logs+String(chunk)).slice(-16000))
  // No metrics API calls: observe only autonomous collection in this own DB.
  await wait('Autonomous compiled retention',()=>{
    assert.equal(child!.exitCode,null,logs)
    return !database.sqlite.prepare('SELECT 1 FROM host_metric_samples WHERE sampled_at=?').get(expired)&&Boolean(database.sqlite.prepare('SELECT 1 FROM host_metric_samples WHERE sampled_at>?').get(retained))
  })
  assert.equal((database.sqlite.prepare('SELECT payload FROM host_metric_samples WHERE sampled_at=?').get(retained)as {payload:string}).payload,retainedPayload)
  const latest=JSON.parse((database.sqlite.prepare('SELECT payload FROM host_metric_samples ORDER BY sampled_at DESC LIMIT 1').get()as {payload:string}).payload)
  assert.ok(latest.memory.totalBytes>0);assert.equal(latest.operations.available,true);assert.deepEqual(latest.operations.channels,[])
  assert.ok((database.sqlite.prepare("SELECT COUNT(*) AS count FROM health_events WHERE component='HOST'").get()as {count:number}).count>=1)
  const health=await(await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(5000)})).json()as {engines:number};assert.equal(health.engines,0)
  child.send('own-shutdown');await wait('Own retention server exit',()=>child!.exitCode!==null||child!.signalCode!==null);assert.equal(child.exitCode,0,logs)
  await assert.rejects(()=>fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(1000)}))
  result={result:'PASS',directory,compiledServerSha256:createHash('sha256').update(await readFile(compiled)).digest('hex'),autonomousExpiryBeforeMetricsApi:true,expired15DayFixtureRemoved:true,retained13DayFixturePayloadUnchanged:true,actualHostSampleAndHealthEventPersisted:true,noEngineRegistered:true,ownChildAndListenerClosed:true,real14DayElapsedSoakValidated:false,representativeLoadValidated:false,physicalSignalsValidated:false,browserValidated:false}
}catch(error){result={...result,error:String(error)};throw error}
finally{if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await wait('Own failure cleanup',()=>child!.exitCode!==null||child!.signalCode!==null)}database.sqlite.close();await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));await writeFile(join(directory,'server.log'),logs);console.log(JSON.stringify(result))}
