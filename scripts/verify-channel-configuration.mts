import assert from 'node:assert/strict'
import {spawn,type ChildProcess} from 'node:child_process'
import {mkdtemp} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createServer} from 'node:net'

// Compiled servers + shared isolated SQLite prove edit arbitration, NOT HA.
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(tmpdir(),'RPlayout-channel-configuration-'))
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json')
const {openDatabase}=await import('../apps/server/src/db/client.js')
const database=openDatabase(join(directory,'configuration.db'))
async function reserve(){const socket=createServer();await new Promise<void>(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=(socket.address() as {port:number}).port;await new Promise<void>(resolve=>socket.close(()=>resolve()));return port}
type Station={port:number;child:ChildProcess|null;pids:number[];logs:string}
const stations:Station[]=[{port:await reserve(),child:null,pids:[],logs:''},{port:await reserve(),child:null,pids:[],logs:''}]
async function request(station:Station,path:string,body?:object,method=body?'POST':'GET',expected=200,etag?:string){
  const response=await fetch(`http://127.0.0.1:${station.port}${path}`,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(etag?{'If-Match':etag}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10_000)})
  const text=await response.text();assert.equal(response.status,expected,`${method} ${path}: ${response.status} ${text.slice(0,600)}`)
  return {value:JSON.parse(text),etag:response.headers.get('etag')}
}
async function start(station:Station){
  station.logs=''
  station.child=spawn(process.execPath,[join(root,'apps/server/dist/server.cjs')],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,
    RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_DB:join(directory,'configuration.db'),RPLAYOUT_VAULT_FILE:join(directory,'vault.json'),RPLAYOUT_MEDIA:directory,
    RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_CACHE:join(directory,'cache'),RPLAYOUT_BACKUPS:join(directory,'backups'),
    RPLAYOUT_ENGINE:'',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_DEVICES:'',RPLAYOUT_RELAY:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_N1_PEER:'',RPLAYOUT_BACKUP_HOURS:'0',
    RPLAYOUT_ADMIN_USER:'',RPLAYOUT_ADMIN_PASSWORD:'',RPLAYOUT_CONTROL_TOKEN:'',RPLAYOUT_ROLE:'ADMIN',HOST:'127.0.0.1',PORT:String(station.port),LOG_LEVEL:'warn'}})
  if(station.child.pid)station.pids.push(station.child.pid)
  for(const stream of [station.child.stdout,station.child.stderr])stream?.on('data',chunk=>{station.logs=(station.logs+String(chunk)).slice(-6000)})
  station.child.on('error',error=>{station.logs+=error.message})
  const deadline=performance.now()+20_000
  while(performance.now()<deadline){
    assert.equal(station.child.exitCode,null,station.logs)
    try{if((await request(station,'/api/health')).value.ok)return}catch{}
    await new Promise(resolve=>setTimeout(resolve,100))
  }
  throw new Error('Servidor compilado não ficou disponível: '+station.logs)
}
async function stop(station:Station){
  const child=station.child;station.child=null
  if(!child||child.exitCode!==null||child.signalCode!==null)return
  const exited=new Promise<void>(resolve=>child.once('exit',()=>resolve()));child.kill('SIGKILL');await exited
}
const read='/api/channels/edit/configuration',write='/api/channels/edit'
try{
  database.sqlite.exec("INSERT INTO channels(id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES('edit','Configuração ÇÃO',25,1,320,180,-23,-1,5,'now'),('other','Outro',25,1,320,180,-23,-1,5,'now'); INSERT INTO rundowns(id,channel_id,name,planned_start,date,created_at,updated_at) VALUES('rd','edit','Grade',0,'2026-10-03','now','now')")
  const a=stations[0]!,b=stations[1]!
  await start(a);await start(b)
  const initial=await request(a,read),same=await request(b,read)
  assert.equal(initial.etag,same.etag);assert.deepEqual(initial.value,same.value)
  await request(a,write,{width:640},'PATCH',428)
  await request(a,write,{width:640},'PATCH',400,'*')
  await request(a,write,{width:640},'PATCH',200,initial.etag!)
  await request(b,write,{height:360},'PATCH',409,initial.etag!)
  let current=await request(b,read)
  assert.equal(current.value.channel.width,640);assert.equal(current.value.channel.height,180)
  const aba=current.etag!
  await request(a,write,{targetLufs:-24},'PATCH',200,aba)
  current=await request(b,read);await request(b,write,{targetLufs:-23},'PATCH',200,current.etag!)
  await request(a,write,{height:360},'PATCH',409,aba)
  current=await request(a,read)
  const raced=await Promise.all(stations.map((station,index)=>fetch(`http://127.0.0.1:${station.port}${write}`,{method:'PATCH',headers:{'Content-Type':'application/json','If-Match':current.etag!},body:JSON.stringify({width:800+index*160}),signal:AbortSignal.timeout(10_000)})))
  assert.deepEqual(raced.map(response=>response.status).sort(),[200,409])
  for(const response of raced)await response.text()
  const stable=await request(a,read)
  const decisionsBefore=database.sqlite.prepare("SELECT count(*) AS n FROM operator_decisions WHERE kind='CHANNEL_CONFIGURATION_CHANGED'").get() as {n:number}
  database.sqlite.exec("CREATE TRIGGER qa_fail_configuration BEFORE INSERT ON operator_decisions WHEN NEW.kind='CHANNEL_CONFIGURATION_CHANGED' BEGIN SELECT RAISE(ABORT,'QA configuration audit rollback'); END")
  await request(b,write,{height:360},'PATCH',409,stable.etag!)
  assert.deepEqual((await request(a,read)).value,stable.value)
  assert.deepEqual(database.sqlite.prepare("SELECT count(*) AS n FROM operator_decisions WHERE kind='CHANNEL_CONFIGURATION_CHANGED'").get(),decisionsBefore)
  database.sqlite.exec('DROP TRIGGER qa_fail_configuration')
  const draft=await request(a,read)
  const report=(await request(a,write+'/cadence-preview',{rateNum:50,rateDen:1,format:{height:360}},'POST',200,draft.etag!)).value.report
  await request(b,write+'/cadence-convert',{rateNum:50,rateDen:1,format:{height:480},fingerprint:report.fingerprint,confirm:true},'POST',409,draft.etag!)
  const converted=await request(b,write+'/cadence-convert',{rateNum:50,rateDen:1,format:{height:360},fingerprint:report.fingerprint,confirm:true},'POST',200,draft.etag!)
  assert.equal(converted.value.applied,true);assert.equal(converted.value.engineError,null)
  // Presets participate in the same channel snapshot, including another
  // process's changes. This is shared SQLite arbitration, not replication.
  const presetPath='/api/channels/edit/transmission-presets'
  const presetBody={name:'Destino conferido',kind:'SRT',target:'srt://localhost:9000?mode=caller&passphrase=PRIVATE_PRESET_QA'}
  await request(a,presetPath,presetBody,'POST',428)
  const presetOpening=await request(a,presetPath)
  assert.equal(presetOpening.etag,(await request(b,read)).etag)
  const presetRace=await Promise.all(stations.map(station=>fetch(`http://127.0.0.1:${station.port}${presetPath}`,{method:'POST',headers:{'Content-Type':'application/json','If-Match':presetOpening.etag!},body:JSON.stringify(presetBody),signal:AbortSignal.timeout(10_000)})))
  assert.deepEqual(presetRace.map(response=>response.status).sort(),[201,409])
  for(const response of presetRace){const text=await response.text();assert.ok(!text.includes('PRIVATE_PRESET_QA'))}
  let presetSnapshot=await request(b,presetPath)
  assert.equal(presetSnapshot.value.presets.length,1)
  const presetId=presetSnapshot.value.presets[0].id,presetVersion=presetSnapshot.etag!
  database.sqlite.prepare('UPDATE transmission_presets SET name=? WHERE id=?').run('Mudança externa',presetId)
  database.sqlite.prepare('UPDATE transmission_presets SET name=? WHERE id=?').run(presetBody.name,presetId)
  await request(a,`${presetPath}/${presetId}/apply`,{},'POST',409,presetVersion)
  await request(a,`${presetPath}/${presetId}`,undefined,'DELETE',409,presetVersion)
  for(const [kind,path,method,payload] of [
    ['TRANSMISSION_PRESET_CREATED',presetPath,'POST',presetBody],
    ['TRANSMISSION_PRESET_APPLIED',`${presetPath}/${presetId}/apply`,'POST',{}],
    ['TRANSMISSION_PRESET_REMOVED',`${presetPath}/${presetId}`,'DELETE',undefined],
  ] as const){
    const before=await request(a,presetPath),outputs=await request(a,'/api/channels/edit/outputs')
    database.sqlite.exec(`CREATE TRIGGER qa_fail_preset BEFORE INSERT ON operator_decisions WHEN NEW.kind='${kind}' BEGIN SELECT RAISE(ABORT,'QA preset audit rollback'); END`)
    await request(b,path,payload,method,409,before.etag!)
    assert.deepEqual((await request(a,presetPath)).value,before.value);assert.deepEqual((await request(a,'/api/channels/edit/outputs')).value,outputs.value)
    database.sqlite.exec('DROP TRIGGER qa_fail_preset')
  }
  presetSnapshot=await request(a,presetPath)
  const presetApplied=await request(b,`${presetPath}/${presetId}/apply`,{},'POST',201,presetSnapshot.etag!)
  assert.equal(presetApplied.value.applied,true);assert.equal(presetApplied.value.engineError,null)
  assert.ok(!JSON.stringify(presetApplied.value).includes('PRIVATE_PRESET_QA'))
  presetSnapshot=await request(a,presetPath)
  await request(b,`${presetPath}/${presetId}`,undefined,'DELETE',200,presetSnapshot.etag!)
  assert.equal((await request(a,presetPath)).value.presets.length,0)
  assert.equal((await request(a,'/api/channels/edit/outputs')).value.outputs.length,1)
  const final=await request(a,read)
  await stop(b);await start(b)
  assert.deepEqual((await request(b,read)).value,final.value)
  assert.equal(final.value.channel.rate.num,50);assert.equal(final.value.channel.height,360)
  const other=await request(a,'/api/channels/other/configuration');assert.equal(other.value.channel.width,320)
  const backup=await request(a,'/api/backups',{})
  assert.equal(backup.value.validation.integrity,'ok');assert.equal(backup.value.validation.foreignKeys,'ok')
  assert.equal(backup.value.validation.tables.schema_migrations,22)
  console.log(JSON.stringify({result:'PASS',directory,stations:stations.map(station=>({port:station.port,pids:station.pids})),initialRevision:initial.value.channel.configurationRevision,finalRevision:final.value.channel.configurationRevision,concurrentWinnerCount:1,auditRollback:true,abaRejected:true,formatBoundToConversion:true,presetConcurrentWinnerCount:1,presetAbaRejected:true,presetAuditRollback:true,appliedOutputPreservedAfterPresetDeletion:true,backupValidated:true,transport:'SIMULATED',replicationValidated:false,physicalOutputValidated:false,browserValidated:false}))
}finally{for(const station of stations)await stop(station);database.sqlite.close()}
