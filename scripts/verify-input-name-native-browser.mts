import assert from 'node:assert/strict'
import {spawn,execFile,type ChildProcess} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,mkdir,readFile,writeFile,stat} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {StringDecoder} from 'node:string_decoder'
import {createServer} from 'node:net'

// Actual native announcements and product discovery; never a mocked /sources.
// The service's playout engine is disabled. These owned senders publish only
// their default synthetic idle picture/audio; no operational file or output.
const workspace=fileURLToPath(new URL('..',import.meta.url)),installed=resolve(process.argv[2]??'')
assert.ok(installed.toLowerCase().startsWith(join(workspace,'scratch').toLowerCase()+'\\'))
assert.equal(resolve(process.execPath).toLowerCase(),join(installed,'runtime/node/node.exe').toLowerCase())
const directory=await mkdtemp(join(workspace,'scratch','input-names-native-')),media=join(directory,'Acervo QA Çãó')
await mkdir(media)
const stopFile=join(directory,'stop.json'),binary=join(installed,'apps/server/dist/server.cjs'),nativeBin=join(installed,'apps/engine/target/release')
const engine=join(nativeBin,'rplayout-engine.exe'),devices=process.argv[3]?resolve(process.argv[3]):join(nativeBin,'rplayout-devices.exe'),gst=join(installed,'runtime/gstreamer')
const devicesOverride=Boolean(process.argv[3]);assert.ok(devices.toLowerCase().startsWith(workspace.toLowerCase())&&devices.endsWith('.exe'))
const hash=async(path:string)=>createHash('sha256').update(await readFile(path)).digest('hex')
const serverSha=await hash(binary),engineSha=await hash(engine)
const devicesSha=await hash(devices),probeAttempts:Array<Record<string,unknown>>=[]
assert.equal(serverSha,'5f33c58e58e2d26294fad3eff71f994c82d093ae0f6159dac91bde8508a64607')
assert.equal(engineSha,'3f0c9616a55cc83ee0c31e6a12c17ee952f35a3bc2c14b41dd685025b1969d65')
const webIndex=await readFile(join(workspace,'apps/web/dist/index.html'),'utf8'),webAsset=webIndex.match(/src="(\/assets\/[^"?]+\.js)"/)?.[1]
assert.ok(webAsset&&!webAsset.includes('..'))
const webSha=await hash(join(workspace,'apps/web/dist',webAsset))
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^RPLAYOUT_|^NODE_PATH$|^NODE_OPTIONS$|^GST_|^GSTREAMER_|^NDI_/i.test(key)))
Object.assign(env,{PATH:[nativeBin,installed,join(gst,'bin'),join(installed,'runtime/node'),join(process.env.SystemRoot!,'System32')].join(';'),GST_PLUGIN_PATH:join(gst,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gst,'lib/gstreamer-1.0'),GST_PLUGIN_SCANNER:join(gst,'libexec/gstreamer-1.0/gst-plugin-scanner.exe'),GST_REGISTRY:join(directory,'registry-devices.bin'),GST_DEBUG:'0',RPLAYOUT_OMT_RUNTIME:join(installed,'libomt.dll')})
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json');delete process.env.RPLAYOUT_VAULT_KEY
const {openDatabase}=await import('../apps/server/src/db/client.js'),{hashPassword}=await import('../apps/server/src/domain/auth.js')
const {operatorDecisions,liveSources,rundownItems}=await import('../apps/server/src/db/schema.js')
const database=openDatabase(join(directory,'service.db')),stamp=new Date().toISOString()
database.sqlite.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('qa-admin','names-verifier',await hashPassword('Local-input-names-20261015'),'ADMIN',1,stamp)
database.sqlite.exec("INSERT INTO channels(id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES('qa','QA input names',25,1,320,180,-23,-1,5,'now'); INSERT INTO rundowns(id,channel_id,name,planned_start,date,created_at,updated_at) VALUES('rd','qa','QA names',0,'2026-10-15','now','now')")
type Sender={child:ChildProcess;kind:'NDI'|'OMT';name:string;ready:boolean;lastPublisher:unknown;errors:string[];log:string;forcedStop:boolean;exitObserved:boolean}
const senders:Sender[]=[],marker=`RPlayout QA Çãó ${process.pid}`
// libomt returns its discovery addresses in lowercase. Match only these owned
// announcements case-insensitively for OMT; retain the exact discovered label
// and reference as the UI/persistence expectations (never rewrite product data).
const matchesAnnouncement=(sender:Sender,source:{reference:string;label:string})=>{
  const identity=(value:string)=>sender.kind==='OMT'?value.toLowerCase():value
  return identity(source.reference).includes(identity(sender.name))&&identity(source.label).includes(identity(sender.name))
}
let server:ChildProcess|null=null,serverLogs='',failure:unknown=null,discovery:unknown=null,servicePort=0,expired=false
const wait=async(label:string,predicate:()=>boolean,ms:number)=>{const deadline=performance.now()+ms;while(performance.now()<deadline){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,100))}assert.fail(label)}
try{
  for(const kind of ['NDI','OMT'] as const)for(const suffix of ['A','B']){
    const name=`${marker} ${kind} ${suffix}`,channelId=`names-${kind.toLowerCase()}-${suffix.toLowerCase()}`
    const child=spawn(engine,['--channel-id',channelId,'--width','320','--height','180','--fps-num','25','--fps-den','1','--bitrate','450','--output',`${kind.toLowerCase()}:${name}`],{cwd:directory,windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...env,GST_REGISTRY:join(directory,`registry-${channelId}.bin`)}})
    const sender:Sender={child,kind,name,ready:false,lastPublisher:null,errors:[],log:'',forcedStop:false,exitObserved:false};senders.push(sender)
    const decoder=new StringDecoder('utf8');let lines=''
    child.stdout?.on('data',chunk=>{lines+=decoder.write(chunk);let end:number;while((end=lines.indexOf('\n'))>=0){const line=lines.slice(0,end);lines=lines.slice(end+1);try{const event=JSON.parse(line);if(event.event==='ready')sender.ready=true;if(event.event==='publisher')sender.lastPublisher=event;if(event.event==='error')sender.errors.push(String(event.message))}catch{sender.log=(sender.log+line+'\n').slice(-32000)}}})
    child.stderr?.on('data',chunk=>sender.log=(sender.log+String(chunk)).slice(-32000))
    child.on('error',error=>sender.errors.push(error.message));child.once('exit',()=>{sender.exitObserved=true})
  }
  await wait('Native senders must become ready',()=>{for(const sender of senders)assert.equal(sender.child.exitCode,null,sender.log);return senders.every(sender=>sender.ready)},45000)
  const probe=promisify(execFile),deadline=performance.now()+45000
  while(performance.now()<deadline){
    const started=performance.now();let stdout:string
    try{const output=await probe(devices,devicesOverride?['--trace']:[],{cwd:directory,env,windowsHide:true,timeout:20000,maxBuffer:1024*1024});stdout=output.stdout;probeAttempts.push({elapsedMs:performance.now()-started,result:'OK',stderr:output.stderr})}
    catch(error){probeAttempts.push({elapsedMs:performance.now()-started,result:'FAIL',stderr:(error as {stderr?:string}).stderr??'',stdout:(error as {stdout?:string}).stdout??'',killed:(error as {killed?:boolean}).killed??false});throw error}
    const observed=JSON.parse(stdout.trim().split('\n').at(-1)!);discovery=observed
    if(senders.every(sender=>observed[sender.kind.toLowerCase()]?.sources.some((source:{reference:string;label:string})=>matchesAnnouncement(sender,source))))break
    await new Promise(resolve=>setTimeout(resolve,500))
  }
  const observed=discovery as Record<string,{available:boolean;sources:Array<{reference:string;label:string}>}>
  assert.ok(senders.every(sender=>observed[sender.kind.toLowerCase()]?.available&&observed[sender.kind.toLowerCase()]?.sources.some(source=>matchesAnnouncement(sender,source))),'Official discovery must see each actual named sender')
  const allocator=createServer();await new Promise<void>(resolve=>allocator.listen(0,'127.0.0.1',resolve));servicePort=(allocator.address() as {port:number}).port;await new Promise<void>(resolve=>allocator.close(()=>resolve()))
  server=spawn(process.execPath,[binary],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...env,RPLAYOUT_INSTALL_ROOT:workspace,RPLAYOUT_DB:join(directory,'service.db'),RPLAYOUT_VAULT_FILE:join(directory,'vault.json'),RPLAYOUT_MEDIA:media,RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_CACHE_DIR:join(directory,'cache'),RPLAYOUT_BACKUPS:join(directory,'backups'),RPLAYOUT_BACKUP_HOURS:'0',RPLAYOUT_ENGINE:'',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_DEVICES:devices,RPLAYOUT_RELAY:'',RPLAYOUT_PROBE:'',RPLAYOUT_PROXY:'',RPLAYOUT_AUDIO_ANALYSIS:'',HOST:'127.0.0.1',PORT:String(servicePort),LOG_LEVEL:'warn'}})
  for(const stream of [server.stdout,server.stderr])stream?.on('data',chunk=>serverLogs=(serverLogs+String(chunk)).slice(-64000))
  let ready=false;const readyUntil=performance.now()+30000
  while(performance.now()<readyUntil){assert.equal(server.exitCode,null,serverLogs);try{ready=(await fetch(`http://127.0.0.1:${servicePort}/api/health`,{signal:AbortSignal.timeout(1000)})).ok}catch{}if(ready)break;await new Promise(resolve=>setTimeout(resolve,100))}
  assert.ok(ready,'Own service readiness')
  await writeFile(join(directory,'launch.json'),JSON.stringify({directory,servicePort,serverPid:server.pid,serverSha,engineSha,devices,devicesSha,devicesOverride,webAsset,webSha,sourceWebOverride:true,marker,senders:senders.map(row=>({pid:row.child.pid,kind:row.kind,name:row.name})),discovery,stopFile},null,2))
  console.log(JSON.stringify({status:'NATIVE_INPUT_NAME_QA_READY',directory,url:`http://127.0.0.1:${servicePort}/?workspace=settings`,stopFile,marker,fixtureUser:'names-verifier',fixturePassword:'Local-input-names-20261015',scope:'Actual native announcements; own service PGM/engine disabled; not external/physical signal qualification'}))
  const expires=performance.now()+900000
  while(performance.now()<expires){assert.equal(server.exitCode,null,serverLogs);for(const sender of senders)assert.equal(sender.child.exitCode,null,sender.log);try{await stat(stopFile);break}catch{}await new Promise(resolve=>setTimeout(resolve,200))}
  expired=performance.now()>=expires
}catch(error){failure=error;throw error}
finally{
  if(server&&server.exitCode===null&&server.signalCode===null){const ended=new Promise<void>(resolve=>server!.once('exit',()=>resolve()));server.kill();await ended}
  for(const sender of senders){
    if(sender.child.exitCode!==null||sender.child.signalCode!==null)continue
    const ended=new Promise<void>(resolve=>sender.child.once('exit',()=>resolve()))
    sender.child.stdin?.write(JSON.stringify({id:900,cmd:'shutdown'})+'\n')
    const timeout=setTimeout(()=>{if(sender.child.exitCode===null&&sender.child.signalCode===null){sender.forcedStop=true;sender.child.kill()}},6000)
    await ended;clearTimeout(timeout)
  }
  const result={result:failure?'FAIL':'FIXTURE_FINISHED',directory,expired,serverSha,engineSha,devices,devicesSha,devicesOverride,probeAttempts,webAsset,webSha,sourceWebOverride:true,marker,discovery,senders:senders.map(({child,...row})=>({...row,pid:child.pid,exitCode:child.exitCode,signalCode:child.signalCode})),serviceEngineDisabled:true,serviceExitObserved:server===null||server.exitCode!==null||server.signalCode!==null,liveSources:database.db.select({id:liveSources.id,channelId:liveSources.channelId,name:liveSources.name,kind:liveSources.kind,targetUrl:liveSources.targetUrl}).from(liveSources).all(),items:database.db.select({id:rundownItems.id,title:rundownItems.title,sourceRef:rundownItems.sourceRef}).from(rundownItems).all(),audits:database.db.select({kind:operatorDecisions.kind,actor:operatorDecisions.actorUsername}).from(operatorDecisions).all(),asRun:database.sqlite.prepare('SELECT count(*) count FROM as_run').get(),physicalSignalValidated:false,error:failure?String(failure):null}
  database.sqlite.close();await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));await writeFile(join(directory,'server.log'),serverLogs)
  console.log(JSON.stringify({status:result.result,directory,expired,error:result.error,sendersStopped:result.senders.every(row=>row.exitObserved),forcedStops:result.senders.filter(row=>row.forcedStop).length}))
}
