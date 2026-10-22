import assert from 'node:assert/strict'
import {spawn,execFile,type ChildProcess} from 'node:child_process'
import {promisify} from 'node:util'
import {createServer} from 'node:net'
import {createSocket} from 'node:dgram'
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'

// Compiled backends + real local MediaMTX; no engine, relay destination,
// physical signal, production DB, other host or automatic promotion.
const root=fileURLToPath(new URL('..',import.meta.url)),binary=join(root,'mediamtx/mediamtx.exe')
const directory=await mkdtemp(join(tmpdir(),'RPlayout-distribution-ownership-')),file=join(directory,'fixture.db'),vault=join(directory,'vault.json'),media=join(directory,'media'),config=join(directory,'mediamtx.yml')
await mkdir(media);process.env.RPLAYOUT_VAULT_FILE=vault
const [{openDatabase},{readDistributionOwner},{validateBackupRestore}]=await Promise.all([import('../apps/server/src/db/client.js'),import('../apps/server/src/db/distribution-ownership.js'),import('../apps/server/src/domain/backup.js')])
const db=openDatabase(file),now=new Date().toISOString()
db.sqlite.prepare('INSERT INTO channels(id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES(?,?,25,1,320,180,-23,-1,5,?)').run('ch','Distribuição ÇÃO',now)
interface Station{port:number;child:ChildProcess|null;pids:number[];logs:string}
const stations:Station[]=[],ownedMediaPids=new Set<number>(),tcp=[1935,8554,8888,8889,9997],udp=[8890,8189,8000,8001]
const alive=(pid:number)=>{try{process.kill(pid,0);return true}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return false;throw error}}
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex')
async function wait(message:string,predicate:()=>boolean|Promise<boolean>,timeout=20000){const end=performance.now()+timeout;while(performance.now()<end){if(await predicate())return;await new Promise(done=>setTimeout(done,100))}throw new Error(message+'; '+stations.map(station=>station.logs.slice(-1000)).join('\n'))}
async function freeTcp(port:number){const listener=createServer();try{await new Promise<void>((done,reject)=>{listener.once('error',reject);listener.listen(port,'0.0.0.0',done)})}finally{if(listener.listening)await new Promise<void>(done=>listener.close(()=>done()))}}
async function freeUdp(port:number){const listener=createSocket('udp4');try{await new Promise<void>((done,reject)=>{listener.once('error',reject);listener.bind(port,'0.0.0.0',done)})}finally{try{listener.close()}catch{}}}
// Refuse occupied documented ports; never kill a foreign listener. This is
// preflight, not a production cross-DB/host exclusion mechanism.
for(const port of tcp)await freeTcp(port)
for(const port of udp)await freeUdp(port)
for(let index=0;index<2;index++){const listener=createServer();await new Promise<void>(done=>listener.listen(0,'127.0.0.1',done));const port=(listener.address() as {port:number}).port;await new Promise<void>(done=>listener.close(()=>done()));stations.push({port,child:null,pids:[],logs:''})}
async function call(station:Station,url:string,method='GET',body?:object,status=200){const response=await fetch(`http://127.0.0.1:${station.port}${url}`,{method,headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)}),text=await response.text();assert.equal(response.status,status,`${method} ${url}: ${response.status} ${text.slice(0,200)}`);return {value:JSON.parse(text),cache:response.headers.get('cache-control')}}
async function start(station:Station){
  const child=spawn(process.execPath,[join(root,'apps/server/dist/server.cjs')],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,RPLAYOUT_DB:file,RPLAYOUT_VAULT_FILE:vault,RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_MEDIA:media,RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_CACHE:join(directory,'cache'),RPLAYOUT_BACKUPS:join(directory,'backups'),RPLAYOUT_ENGINE:'',RPLAYOUT_MEDIAMTX:binary,RPLAYOUT_MEDIAMTX_BIND:'127.0.0.1',RPLAYOUT_MEDIAMTX_LOGLEVEL:'warn',RPLAYOUT_DEVICES:'',RPLAYOUT_RELAY:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_N1_PEER:'',RPLAYOUT_BACKUP_HOURS:'0',RPLAYOUT_HA_ROLE:'',RPLAYOUT_HA_PEER:'',RPLAYOUT_ADMIN_USER:'',RPLAYOUT_ADMIN_PASSWORD:'',RPLAYOUT_ROLE:'ADMIN',RPLAYOUT_CONTROL_TOKEN:'',HOST:'127.0.0.1',PORT:String(station.port),LOG_LEVEL:'warn'}})
  station.child=child;if(child.pid)station.pids.push(child.pid);for(const stream of[child.stdout,child.stderr])stream?.on('data',data=>station.logs=(station.logs+String(data)).slice(-8000));child.on('error',error=>station.logs+=error.message)
  await wait('Own compiled backend did not start',async()=>{if(child.exitCode!==null||child.signalCode!==null)throw new Error(station.logs.slice(-2000));try{return(await call(station,'/api/health')).value.ok}catch{return false}})
}
async function stop(station:Station){const child=station.child;station.child=null;if(child&&child.exitCode===null&&child.signalCode===null){const exited=new Promise<void>(done=>child.once('exit',()=>done()));child.kill('SIGKILL');await exited}}
function rememberMedia(station:Station){const owner=readDistributionOwner(db.sqlite)!;assert.equal(owner.pid,station.child!.pid);assert.equal(owner.phase,'ACTIVE');const children=Object.values(owner.children);assert.equal(children.length,1);assert.equal(children[0]!.resource,'MEDIAMTX');assert.ok(children[0]!.pid);ownedMediaPids.add(children[0]!.pid!);return owner}
async function verifyOwnApi(pid:number){
  // Read-only OS listener evidence; an HTTP200 alone does not prove identity.
  const {stdout}=await promisify(execFile)('netstat.exe',['-ano','-p','tcp'],{windowsHide:true,timeout:5000})
  const pids=stdout.split(/\r?\n/).map(line=>line.trim().split(/\s+/)).filter(columns=>columns[0]==='TCP'&&columns[1]?.endsWith(':9997')&&columns[3]==='LISTENING').map(columns=>Number(columns[4]));assert.ok(pids.length>0);assert.ok(pids.every(owner=>owner===pid))
  const response=await fetch('http://127.0.0.1:9997/v3/paths/list',{signal:AbortSignal.timeout(2000)});assert.equal(response.status,200)
}
let evidence:Record<string,unknown>|null=null
try{
  const [a,b]=stations as[Station,Station];await start(a);const first=rememberMedia(a);await verifyOwnApi(Object.values(first.children)[0]!.pid!)
  const original=await readFile(config),before=JSON.stringify(readDistributionOwner(db.sqlite)),ownerStatus=await call(a,'/api/distribution/execution-ownership');assert.equal(ownerStatus.value.ownedHere,true)
  await start(b);const peer=await call(b,'/api/distribution/execution-ownership');assert.equal(peer.cache,'private, no-store');assert.equal(peer.value.blocked,true);assert.equal(peer.value.ownedHere,false)
  for(const secret of[first.id,first.boot,'signature','children'])assert.ok(!JSON.stringify(peer.value).includes(secret))
  for(const [method,url,body]of[
    ['PATCH','/api/channels/ch',{name:'NOT_CHANGED'}],
    ['POST','/api/channels/ch/guests',{label:'NOT_CREATED'}],
    ['POST','/api/channels/ch/destinations',{name:'NOT_CREATED',url:'srt://127.0.0.1:9999'}],
    ...['cue','take','stop'].map(action=>['POST','/api/channels/ch/transport',{action,sourceRef:'ndi:NOT_OPENED'}]),
  ] as [string,string,object][]){const response=await call(b,url,method,body,409);assert.equal(response.value.distributionOwnershipBlocked,true)}
  assert.equal(JSON.stringify(readDistributionOwner(db.sqlite)),before);assert.deepEqual(await readFile(config),original)
  assert.equal((db.sqlite.prepare('SELECT name FROM channels WHERE id=?').get('ch') as {name:string}).name,'Distribuição ÇÃO')
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM guest_keys').get().n,0);assert.equal(db.sqlite.prepare('SELECT count(*) n FROM destinations').get().n,0);assert.equal(db.sqlite.prepare('SELECT count(*) n FROM execution_owner_runs').get().n,0)
  const backup=join(directory,'validated.db');await db.sqlite.backup(backup);assert.equal((await validateBackupRestore(backup)).integrity,'ok')
  await stop(a);const mediaSurvivedParent=Object.values(first.children).some(child=>alive(child.pid!))
  if(mediaSurvivedParent){assert.equal((await call(b,'/api/distribution/execution-ownership')).value.blocked,true);await call(b,'/api/channels/ch','PATCH',{name:'NOT_CHANGED'},409)}
  for(const pid of ownedMediaPids)if(alive(pid))process.kill(pid,'SIGKILL')
  await wait('Own media predecessor did not exit',()=>[...ownedMediaPids].every(pid=>!alive(pid)),10000)
  await stop(b);await start(b);const second=rememberMedia(b);assert.notEqual(second.id,first.id);assert.equal(second.sequence,2);await verifyOwnApi(Object.values(second.children)[0]!.pid!)
  assert.equal((await call(b,'/api/distribution/execution-ownership')).value.ownedHere,true);assert.deepEqual(await readFile(config),original)
  evidence={result:'PASS',evidence:'COMPILED_BACKENDS_REAL_LOCAL_MEDIAMTX_OWNERSHIP',directory,ports:stations.map(station=>station.port),serverPids:stations.flatMap(station=>station.pids),mediaPids:[...ownedMediaPids],serverSha256:hash(await readFile(join(root,'apps/server/dist/server.cjs'))),mediaBinarySha256:hash(await readFile(binary)),configSha256:hash(original),peerConfigAndMutationsRejected:true,oneMediaProcessPerOwner:true,privateReadOnlyStatus:true,apiListenerPidVerified:true,mediaSurvivedParent,verifiedPredecessorDeath:true,backupValidated:true,engineEnabled:false,relayEnabled:false,physicalOutputValidated:false,crossDatabaseExclusionValidated:false,otherHostValidated:false,promotionReady:false,browserValidated:false}
}finally{
  for(const station of stations)await stop(station)
  // Include only children from this fixture's signed ledger and parent chain.
  const current=readDistributionOwner(db.sqlite);if(current&&stations.flatMap(station=>station.pids).includes(current.pid))for(const child of Object.values(current.children))if(child.resource==='MEDIAMTX'&&child.pid)ownedMediaPids.add(child.pid)
  for(const pid of ownedMediaPids)if(alive(pid))process.kill(pid,'SIGKILL')
  await wait('Own media children did not close',()=>[...ownedMediaPids].every(pid=>!alive(pid)),10000);db.sqlite.close()
  for(const station of stations)await assert.rejects(()=>fetch(`http://127.0.0.1:${station.port}/api/health`,{signal:AbortSignal.timeout(1000)}))
  for(const port of tcp)await freeTcp(port)
  console.log(JSON.stringify({cleanup:'OWN_CHILDREN_AND_LISTENERS_CLOSED',directory,serverPids:stations.flatMap(station=>station.pids),mediaPids:[...ownedMediaPids]}))
}
if(evidence){evidence={...evidence,ownChildrenAndListenersClosed:true};const report=process.argv[2];if(report)await writeFile(resolve(report),JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(evidence))}
