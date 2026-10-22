import assert from 'node:assert/strict'
import {spawn,execFile,type ChildProcess} from 'node:child_process'
import {createServer as httpServer} from 'node:http'
import {createServer} from 'node:net'
import {createSocket} from 'node:dgram'
import {mkdtemp,mkdir,copyFile,readFile,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash,randomUUID} from 'node:crypto'
import {promisify} from 'node:util'

// Actual compiled backends, native broker and local MediaMTX. Separate DBs AND
// working directories. Optional native channel/relay to our own loopback guest.
// No hardware, external target, production data, second host or HA promotion.
assert.equal(process.platform,'win32')
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(tmpdir(),'RPlayout-host-integration-'))
const native=join(root,'apps/engine/target/release/rplayout-host-guard.exe'),fileSecurity=join(root,'apps/engine/target/release/rplayout-file-security.exe'),mediaBinary=join(root,'mediamtx/mediamtx.exe'),serverBinary=join(root,'apps/server/dist/server.cjs'),vault=join(directory,'vault.json')
const nativeChannel=process.argv.includes('--with-native-channel'),engineBinary=join(root,'apps/engine/target/release/rplayout-engine.exe'),relayBinary=join(root,'apps/engine/target/release/rplayout-relay.exe')
const gstRoot=process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64??'C:/Program Files/gstreamer/1.0/msvc_x86_64',gstBin=join(gstRoot,'bin')
const nativeEnv={...process.env,PATH:gstBin+';'+process.env.PATH,GST_PLUGIN_PATH:join(gstRoot,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gstRoot,'lib/gstreamer-1.0'),GST_PLUGIN_SCANNER:join(gstRoot,'libexec/gstreamer-1.0/gst-plugin-scanner.exe'),GST_REGISTRY:join(directory,'registry.bin')}
const physical=join(directory,'EXIBIÇÃO-ÇÃO.mp4')
const observer=join(directory,'observe-own-spawn.cjs')
// Observation ONLY, in a generated private verifier fixture. Calls the actual
// original spawn with unchanged arguments/options and returns the same child.
// Does not fake native admission, replies, readiness, PID, socket or kill.
// Actual broker admission still derives its parent from Windows independently.
await writeFile(observer,`
const cp=require('node:child_process'),path=require('node:path'),original=cp.spawn;
cp.spawn=function(binary,...args){const child=original.call(this,binary,...args),resolved=path.resolve(String(binary));for(const [kind,target]of Object.entries(${JSON.stringify({guard:native,engine:engineBinary,relay:relayBinary})})){if(resolved===target&&Number.isSafeInteger(child.pid))process.send?.({event:'fixture-own-native-spawn',kind,pid:child.pid})}return child};
`,{flag:'wx'})
process.env.RPLAYOUT_VAULT_FILE=vault
const [{openDatabase},{readDistributionOwner},{readExecutionOwner},{guestKeys,destinations}]=await Promise.all([import('../apps/server/src/db/client.js'),import('../apps/server/src/db/distribution-ownership.js'),import('../apps/server/src/db/execution-ownership.js'),import('../apps/server/src/db/schema.js')])
type Database=ReturnType<typeof openDatabase>
interface Station{directory:string;file:string;db:Database;port:number;child:ChildProcess|null;pids:number[];brokerPids:number[];enginePids:number[];relayPids:number[];guestPath:string|null;logs:string}
const stations:Station[]=[],ownMedia=new Set<number>(),ownBrokers=new Set<number>(),ownEngines=new Set<number>(),ownRelays=new Set<number>(),tcp=[1935,8554,8888,8889,9997],udp=[8890,8189,8000,8001]
let foreignHits=0
const foreign=httpServer((_request,response)=>{foreignHits++;response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({items:[{name:'FOREIGN_PGM',ready:true,source:{type:'rtmpSession'},readers:[],bytesReceived:999}]}))})
const alive=(pid:number)=>{try{process.kill(pid,0);return true}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return false;throw error}}
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex')
async function wait(message:string,predicate:()=>boolean|Promise<boolean>,timeout=25000){const deadline=performance.now()+timeout;while(performance.now()<deadline){if(await predicate())return;await new Promise(done=>setTimeout(done,100))}throw new Error(message+'; '+stations.map(value=>value.logs.slice(-1500)).join('\n'))}
async function freeTcp(port:number){const socket=createServer();try{await new Promise<void>((done,reject)=>{socket.once('error',reject);socket.listen(port,'0.0.0.0',done)})}finally{if(socket.listening)await new Promise<void>(done=>socket.close(()=>done()))}}
async function freeUdp(port:number){const socket=createSocket('udp4');try{await new Promise<void>((done,reject)=>{socket.once('error',reject);socket.bind(port,'0.0.0.0',done)})}finally{try{socket.close()}catch{}}}
async function fixture(){
  const cwd=await mkdtemp(join(directory,'installation-'));await mkdir(join(cwd,'media'))
  const file=join(cwd,'fixture.db'),db=openDatabase(file),listener=createServer();await new Promise<void>(done=>listener.listen(0,'127.0.0.1',done));const port=(listener.address() as {port:number}).port;await new Promise<void>(done=>listener.close(()=>done()))
  db.sqlite.prepare('INSERT INTO channels(id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES(?,?,25,1,320,180,-23,-1,5,?)').run('ch','Distribuição ÇÃO',new Date().toISOString())
  await writeFile(join(cwd,'mediamtx.yml'),'ORIGINAL_BYTES',{flag:'wx'})
  const station:Station={directory:cwd,file,db,port,child:null,pids:[],brokerPids:[],enginePids:[],relayPids:[],guestPath:null,logs:''};stations.push(station)
  if(nativeChannel){
    const now=new Date().toISOString(),asset=join(cwd,'media','EXIBIÇÃO-ÇÃO.mp4');await copyFile(physical,asset)
    db.sqlite.prepare('INSERT INTO rundowns(id,channel_id,name,date,planned_start,loop,created_at,updated_at) VALUES(?,?,?,?,0,1,?,?)').run('rd','ch','Fixture','2026-10-06',now,now)
    db.sqlite.prepare('INSERT INTO media_assets(id,content_hash,path,title,kind,duration_frames,duration_ns,width,height,rate_num,rate_den,interlace_mode,has_audio,qc_status,created_at) VALUES(?,?,?,?,?,3000,120000000000,320,180,25,1,?,0,?,?)').run('asset',hash(await readFile(asset)),asset,'EXIBIÇÃO','VIDEO','progressive','APPROVED',now)
    db.sqlite.prepare('INSERT INTO rundown_items(id,rundown_id,sort_order,title,type,media_id,anchor,on_overrun,min_duration,auto_next,loop,locked) VALUES(?,?,0,?,?,?,?,?,0,0,0,0)').run('vt','rd','Fixture native VT','VT','asset',JSON.stringify({kind:'FLOW'}),'PUSH')
    const key='local-fixture-'+randomUUID();station.guestPath='guest/'+key
    db.db.insert(guestKeys).values({id:'own-guest',channelId:'ch',label:'Own loopback fixture',streamKey:key,enabled:true,createdAt:now}).run()
    db.db.insert(destinations).values({id:'own-relay',channelId:'ch',name:'Own loopback relay',url:'rtmp://127.0.0.1:1935/'+station.guestPath,enabled:true,createdAt:now}).run()
  }
  return station
}
async function call(station:Station,url:string,method='GET',body?:object,status=200){const response=await fetch(`http://127.0.0.1:${station.port}${url}`,{method,headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(5000)}),text=await response.text();assert.equal(response.status,status,`${url}: ${response.status} ${text.slice(0,200)}`);return{value:JSON.parse(text),cache:response.headers.get('cache-control')}}
async function start(station:Station){
  const child=spawn(process.execPath,['--require',observer,serverBinary],{cwd:station.directory,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:{...(nativeChannel?nativeEnv:process.env),RPLAYOUT_DB:station.file,RPLAYOUT_VAULT_FILE:vault,RPLAYOUT_HOST_GUARD:native,RPLAYOUT_FILE_SECURITY:fileSecurity,RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_MEDIA:join(station.directory,'media'),RPLAYOUT_THUMBS:join(station.directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(station.directory,'versions'),RPLAYOUT_CACHE:join(station.directory,'cache'),RPLAYOUT_BACKUPS:join(station.directory,'backups'),RPLAYOUT_ENGINE:nativeChannel?engineBinary:'',RPLAYOUT_MEDIAMTX:mediaBinary,RPLAYOUT_MEDIAMTX_BIND:'127.0.0.1',RPLAYOUT_MEDIAMTX_LOGLEVEL:'warn',RPLAYOUT_RELAY:nativeChannel?relayBinary:'',RPLAYOUT_DEVICES:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_BACKUP_HOURS:'0',RPLAYOUT_HA_ROLE:'',RPLAYOUT_HA_PEER:'',RPLAYOUT_N1_PEER:'',RPLAYOUT_ADMIN_USER:'',RPLAYOUT_ADMIN_PASSWORD:'',RPLAYOUT_CONTROL_TOKEN:'',RPLAYOUT_ROLE:'ADMIN',HOST:'127.0.0.1',PORT:String(station.port),LOG_LEVEL:'warn'}})
  child.on('message',message=>{const value=message as {event?:string;kind?:string;pid?:number};if(value.event==='fixture-own-native-spawn'){assert.ok(Number.isSafeInteger(value.pid)&&value.pid!>0);if(value.kind==='guard'){station.brokerPids.push(value.pid!);ownBrokers.add(value.pid!)}else if(value.kind==='engine'){station.enginePids.push(value.pid!);ownEngines.add(value.pid!)}else if(value.kind==='relay'){station.relayPids.push(value.pid!);ownRelays.add(value.pid!)}}})
  station.child=child;if(child.pid)station.pids.push(child.pid);for(const stream of[child.stdout,child.stderr])stream?.on('data',data=>station.logs=(station.logs+String(data)).slice(-12000));child.on('error',error=>station.logs+=error.message)
  await wait('Own compiled backend did not start',async()=>{if(child.exitCode!==null||child.signalCode!==null)throw new Error(station.logs.slice(-3000));try{return(await call(station,'/api/health')).value.ok}catch{return false}})
  const status=await call(station,'/api/distribution/execution-ownership')
  if(status.value.hostState==='READY')assert.ok(station.brokerPids.some(alive),'Actual own broker must remain alive')
  return status
}
async function stop(station:Station){const child=station.child;station.child=null;if(child&&child.exitCode===null&&child.signalCode===null){const exited=new Promise<void>(done=>child.once('exit',()=>done()));child.kill('SIGKILL');await exited}}
function rememberMedia(station:Station){const owner=readDistributionOwner(station.db.sqlite)!;assert.equal(owner.pid,station.child!.pid);const children=Object.values(owner.children).filter(child=>child.resource==='MEDIAMTX');assert.equal(children.length,1);assert.ok(children[0]!.pid);ownMedia.add(children[0]!.pid!);return children[0]!.pid!}
const checkpoint=(station:Station)=>{const row=station.db.sqlite.prepare("SELECT payload FROM channel_checkpoints WHERE channel_id='ch'").get() as {payload:string}|undefined;return row?JSON.parse(row.payload):null}
async function nativeFlow(station:Station,take=true){
  if(!nativeChannel)return
  const owner=readExecutionOwner(station.db.sqlite,'ch')!;assert.equal(owner.pid,station.child!.pid);assert.equal(owner.enginePids.length,1);assert.ok(station.enginePids.includes(owner.enginePids[0]!))
  if(take)await call(station,'/api/channels/ch/transport','POST',{action:'take',itemId:'vt'})
  await wait('Own native decoded PGM did not advance',()=>checkpoint(station)?.playing&&checkpoint(station)?.elapsed>=25)
  await wait('Own native loopback relay did not deliver real buffers',async()=>{
    const value=(await call(station,'/api/distribution')).value
    return value.paths.some((path:any)=>path.name===station.guestPath&&path.ready&&path.bytesReceived>0)&&value.relays.some((relay:any)=>relay.id==='own-relay'&&relay.delivered>0)
  })
  const resources=Object.values(readDistributionOwner(station.db.sqlite)!.children).filter(child=>child.resource==='RELAY:own-relay');assert.equal(resources.length,1);assert.ok(station.relayPids.includes(resources[0]!.pid!))
  assert.deepEqual(await readFile(join(station.directory,'media','EXIBIÇÃO-ÇÃO.mp4')),await readFile(physical))
}
async function ownRelayRecovery(station:Station){
  if(!nativeChannel)return
  const before=checkpoint(station).elapsed,old=Object.values(readDistributionOwner(station.db.sqlite)!.children).find(child=>child.resource==='RELAY:own-relay')!.pid!
  assert.ok(ownRelays.has(old)&&alive(old));process.kill(old,'SIGKILL')
  await wait('Own relay did not restart after confirmed generation exit',()=>{
    const next=Object.values(readDistributionOwner(station.db.sqlite)!.children).find(child=>child.resource==='RELAY:own-relay')?.pid
    return !alive(old)&&Boolean(next&&next!==old&&ownRelays.has(next)&&alive(next))
  })
  await nativeFlow(station,false);assert.ok(checkpoint(station).elapsed>before)
}
const saved=(station:Station)=>JSON.stringify(Object.fromEntries(['distribution_owner_runs','distribution_owner_slot','execution_owner_runs','channels','guest_keys','destinations','output_profiles'].map(table=>[table,station.db.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])))
let evidence:Record<string,unknown>|null=null
try{
  for(const port of tcp)await freeTcp(port);for(const port of udp)await freeUdp(port)
  if(nativeChannel)await promisify(execFile)(join(gstBin,'gst-launch-1.0.exe'),['-q','videotestsrc','num-buffers=3000','!','video/x-raw,width=320,height=180,framerate=25/1','!','videoconvert','!','x264enc','speed-preset=ultrafast','!','h264parse','!','mp4mux','!','filesink',`location=${physical.replaceAll('\\','/')}`],{windowsHide:true,timeout:45_000,env:nativeEnv})
  await new Promise<void>((done,reject)=>{foreign.once('error',reject);foreign.listen(9997,'127.0.0.1',done)})
  const conflict=await fixture();const conflictStatus=await start(conflict);assert.equal(conflictStatus.value.hostState,'READY')
  assert.equal(Object.values(readDistributionOwner(conflict.db.sqlite)!.children).length,0)
  assert.equal(conflict.enginePids.length,0);assert.equal(conflict.relayPids.length,0)
  assert.equal((await call(conflict,'/api/distribution')).value.server.running,false)
  assert.equal(await readFile(join(conflict.directory,'mediamtx.yml'),'utf8'),'ORIGINAL_BYTES');assert.equal(foreignHits,0)
  await stop(conflict);await wait('Own blocked backend broker did not drain',()=>conflict.brokerPids.every(pid=>!alive(pid)));await new Promise<void>(done=>foreign.close(()=>done()))
  const a=await fixture(),b=await fixture();const ownerStatus=await start(a);assert.equal(ownerStatus.value.hostState,'READY');assert.equal(ownerStatus.value.ownedHere,true);const firstMedia=rememberMedia(a)
  assert.equal((await call(a,'/api/distribution')).value.server.running,true)
  await nativeFlow(a)
  const ownConfig=await readFile(join(a.directory,'mediamtx.yml')),before=saved(b),peer=await start(b)
  assert.equal(peer.cache,'private, no-store');assert.equal(peer.value.hostDistributionBlocked,true);assert.equal(peer.value.hostState,'BUSY');assert.equal(peer.value.ownedHere,false)
  assert.equal(b.enginePids.length,0);assert.equal(b.relayPids.length,0)
  for(const secret of['nonce','guardPid','processToken','processPids'])assert.ok(!JSON.stringify(peer.value).includes(secret))
  for(const[method,url,body]of[
    ['PATCH','/api/channels/ch',{name:'NOT_CHANGED'}],['POST','/api/channels/ch/guests',{label:'NOT_CREATED'}],['POST','/api/channels/ch/destinations',{name:'NOT_CREATED',url:'srt://127.0.0.1:9999'}],...['cue','take','stop'].map(action=>['POST','/api/channels/ch/transport',{action,sourceRef:'ndi:NOT_OPENED'}]),
  ] as[string,string,object][]){const denied=await call(b,url,method,body,409);assert.equal(denied.value.hostDistributionBlocked,true)}
  assert.equal(saved(b),before);assert.equal(await readFile(join(b.directory,'mediamtx.yml'),'utf8'),'ORIGINAL_BYTES');assert.deepEqual(await readFile(join(a.directory,'mediamtx.yml')),ownConfig)
  if(nativeChannel)assert.equal(checkpoint(a).playing,true)
  await ownRelayRecovery(a)
  await stop(a);await wait('Own native family did not drain',()=>!alive(firstMedia)&&a.brokerPids.every(pid=>!alive(pid)))
  // A running peer cannot steal after a deadline; explicit fresh bootstrap is
  // required, and only after native predecessor termination is confirmed.
  assert.equal((await call(b,'/api/distribution/execution-ownership')).value.hostDistributionBlocked,true)
  await stop(b);const successor=await start(b);assert.equal(successor.value.hostState,'READY');assert.equal(successor.value.ownedHere,true);rememberMedia(b)
  assert.equal((await call(b,'/api/distribution')).value.server.running,true)
  await nativeFlow(b)
  evidence={result:'PASS',evidence:'COMPILED_BACKENDS_NATIVE_HOST_BROKER_REAL_MEDIAMTX_SEPARATE_DATABASES',directory,ports:stations.map(value=>value.port),serverPids:stations.flatMap(value=>value.pids),guardPids:[...ownBrokers],mediaPids:[...ownMedia],enginePids:[...ownEngines],relayPids:[...ownRelays],serverSha256:hash(await readFile(serverBinary)),nativeGuardSha256:hash(await readFile(native)),fileSecuritySha256:hash(await readFile(fileSecurity)),mediaBinarySha256:hash(await readFile(mediaBinary)),...(nativeChannel?{engineSha256:hash(await readFile(engineBinary)),relaySha256:hash(await readFile(relayBinary))}:{}),spawnObservationOnlyPrivatePreload:true,nativeAdmissionUnmodified:true,crossDatabaseAndWorkingDirectoryExclusionValidated:true,foreignHttp200NotAccepted:true,foreignApiWasNotQueried:true,foreignConfigurationPreserved:true,unappliedConfigurationDoesNotWatchdogSpawn:true,peerMutationsRejectedBeforeEffects:true,privateStatus:true,successorOnlyAfterActualExit:true,explicitRestartAfterBusyRequired:true,engineEnabled:nativeChannel,relayEnabled:nativeChannel,nativeDecodedPgmValidated:nativeChannel,realLoopbackRelayDeliveryValidated:nativeChannel,relayGenerationRecoveryPreservedPgm:nativeChannel,physicalOutputValidated:false,otherHostValidated:false,browserValidated:false,promotionReady:false}
}catch(error){
  // Preserve the real failure, including safe own-fixture diagnostics. Health
  // HTTP is deliberately available after a refused startup, not media proof.
  const diagnostic={result:'FAIL',directory,error:error instanceof Error?error.message:'Unknown verifier error',stations:stations.map(station=>({pids:station.pids,logs:station.logs.slice(-6000)}))}
  await writeFile(join(directory,'failure.json'),JSON.stringify(diagnostic,null,2)+'\n',{flag:'wx'})
  console.log(JSON.stringify(diagnostic));throw error
}finally{
  for(const station of stations){const owner=readDistributionOwner(station.db.sqlite);if(owner&&station.pids.includes(owner.pid))for(const child of Object.values(owner.children))if(child.resource==='MEDIAMTX'&&child.pid)ownMedia.add(child.pid)}
  for(const station of stations)await stop(station)
  for(const pid of ownMedia)if(alive(pid))process.kill(pid,'SIGKILL')
  await wait('Own native families did not close',()=>[...ownMedia,...ownBrokers,...ownEngines,...ownRelays].every(pid=>!alive(pid)),10000)
  for(const station of stations)station.db.sqlite.close()
  if(foreign.listening)await new Promise<void>(done=>foreign.close(()=>done()))
  for(const port of tcp)await freeTcp(port);for(const port of udp)await freeUdp(port)
  console.log(JSON.stringify({cleanup:'OWN_BACKENDS_NATIVE_FAMILIES_AND_LISTENERS_CLOSED',directory,serverPids:stations.flatMap(value=>value.pids),guardPids:[...ownBrokers],mediaPids:[...ownMedia]}))
}
if(evidence){evidence={...evidence,ownChildrenAndListenersClosed:true};if(process.argv[2])await writeFile(resolve(process.argv[2]),JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(evidence))}
