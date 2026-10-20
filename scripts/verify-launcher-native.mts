import assert from 'node:assert/strict'
import {spawn,execFile,type ChildProcess} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,mkdir,cp,copyFile,writeFile,readFile,readdir,statfs} from 'node:fs/promises'
import {createServer} from 'node:net'
import {createSocket} from 'node:dgram'
import {join,resolve} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {scanETag} from '../packages/protocol/src/scan-review.js'
import {DEFAULT_QC_PROFILE} from '../packages/protocol/src/qc.js'
import {verifyPublishedPicture} from './lib/verify-published-picture.js'
import {verifyPublishedAudio} from './lib/verify-published-audio.js'

// Default: small facade with explicit shared GStreamer. --installed-package:
// execute only the materialized package (no copied/overridden runtime files),
// with a temporary isolated data profile restored after the owned job stops.
const workspace=resolve('.'),installed=resolve(process.argv[2]??'')
const installedPackageCase=process.argv.includes('--installed-package')
const captureUpgradeBackup=process.argv.includes('--capture-upgrade-backup')
assert.ok(!captureUpgradeBackup||installedPackageCase,'Online backup scenario requires an installed package')
const exerciseAmbientOverrides=installedPackageCase&&!captureUpgradeBackup
const qaArgument=process.argv.find(value=>value.startsWith('--qa-root='))
const qaRoot=qaArgument?resolve(qaArgument.slice('--qa-root='.length)):join(workspace,'scratch')
if(qaArgument){assert.equal(qaRoot.toLowerCase(),resolve('D:/RPlayout-builds/qa').toLowerCase());assert.ok(installedPackageCase,'External QA requires explicitly installed package mode')}
assert.ok(process.argv.length>=4,'Supply installed runtime, compiled hash and optional QA mode')
const expectedServerHash=process.argv[3]!
assert.match(expectedServerHash,/^[a-f0-9]{64}$/)
const reuseArgument=process.argv.find(value=>value.startsWith('--reuse-fixture='))
for(const arg of process.argv.slice(4))assert.ok(arg===reuseArgument||arg===qaArgument||arg==='--installed-package'||arg==='--capture-upgrade-backup','Unknown argument')
assert.ok(!installedPackageCase||!reuseArgument,'Do not combine a fixture and installed package')
const reuseRoot=reuseArgument?resolve(reuseArgument.slice('--reuse-fixture='.length)):null
if(reuseRoot)assert.match(reuseRoot.slice(join(workspace,'scratch').length),/^\\launcher-native-[a-zA-Z0-9]+\\portable-fixture$/)
const space=await statfs(qaRoot);assert.ok(space.bavail*space.bsize>450_000_000,'Space for one bounded native QA required; no cleanup performed')
assert.ok(installed.toLowerCase().startsWith(qaRoot.toLowerCase()+'\\'))
if(installedPackageCase){
  const receipt=JSON.parse(await readFile(join(installed,'installation-receipt.json'),'utf8'))
  assert.equal(receipt.integrity,'VERIFIED');assert.equal(receipt.previousInstallationModified,false)
  const manifest=JSON.parse(await readFile(join(installed,'package-manifest.json'),'utf8'))
  assert.notEqual(manifest.fixture,true)
  assert.equal(manifest.files.find((file:any)=>file.file==='apps/server/dist/server.cjs')?.sha256.toLowerCase(),expectedServerHash)
}
assert.equal(resolve(process.execPath).toLowerCase(),join(installed,'runtime/node/node.exe').toLowerCase())
for(const port of [1935,8554,8888,8889,9997]){
  const listener=createServer();await new Promise<void>((done,reject)=>{listener.once('error',reject);listener.listen(port,'127.0.0.1',done)})
  await new Promise<void>(done=>listener.close(()=>done()))
}
for(const port of [8890,8189,8000,8001]){const socket=createSocket('udp4');await new Promise<void>((done,reject)=>{socket.once('error',reject);socket.bind(port,'127.0.0.1',done)});socket.close()}
const directory=await mkdtemp(join(qaRoot,'launcher-native-')),root=installedPackageCase?installed:reuseRoot??join(directory,'portable-fixture')
if(!reuseRoot&&!installedPackageCase)await mkdir(root)
const profileFile=join(root,'installation-profile.json'),priorProfile=reuseRoot||installedPackageCase?await readFile(profileFile):null
if(priorProfile)await writeFile(join(directory,'prior-profile.json'),priorProfile)
if(reuseRoot){
  const prior=JSON.parse(await readFile(join(root,'../result.json'),'utf8'))
  assert.equal(prior.ownedFamilyStopped,true);assert.equal(prior.allLaunchersStopped,true)
  assert.equal(prior.hashes.server,expectedServerHash)
  assert.equal(JSON.parse(await readFile(join(root,'package-manifest.json'),'utf8')).fixture,true)
}
if(!reuseRoot&&!installedPackageCase){
for(const folder of ['runtime/node','apps/server/node_modules'])await cp(join(installed,folder),join(root,folder),{recursive:true})
for(const folder of ['apps/server/dist','apps/web/dist'])await cp(join(workspace,folder),join(root,folder),{recursive:true})
for(const name of await readdir(installed))if(name.toLowerCase().endsWith('.dll'))await copyFile(join(installed,name),join(root,name))
await copyFile(join(installed,'package.json'),join(root,'package.json'))
const native=join(root,'apps/engine/target/release');await mkdir(native,{recursive:true})
for(const name of ['engine','file-security','host-guard','probe','proxy'])await copyFile(join(installed,`apps/engine/target/release/rplayout-${name}.exe`),join(native,`rplayout-${name}.exe`))
await mkdir(join(root,'mediamtx'));await copyFile(join(installed,'mediamtx/mediamtx.exe'),join(root,'mediamtx/mediamtx.exe'))
await copyFile(join(workspace,'apps/engine/target/release/rplayout.exe'),join(root,'RPlayout-Server.exe'))
await writeFile(join(root,'package-manifest.json'),JSON.stringify({version:1,fixture:true,functionalVerification:'EXPLICIT_SHARED_QA_GSTREAMER_NOT_INSTALLATION',files:[]}))
}
const native=join(root,'apps/engine/target/release')
const data=join(directory,'data'),media=join(directory,'media');await mkdir(data);await mkdir(media)
const databaseFile=join(data,'rplayout.db'),vault=join(data,'vault.json')
const candidateProfile=JSON.stringify({version:1,dataRoot:data,mediaRoot:media,vaultFile:vault})
await writeFile(join(directory,'candidate-profile.json'),candidateProfile)
const gst=join(installed,'runtime/gstreamer'),gstBin=join(gst,'bin'),run=promisify(execFile)
const env:NodeJS.ProcessEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^RPLAYOUT_|^NODE_|^HOST$|^PORT$|^GST_|^GSTREAMER_/i.test(key)))
Object.assign(env,{PATH:[root,native,gstBin,join(root,'runtime/node'),join(process.env.SystemRoot!,'System32')].join(';'),GSTREAMER_1_0_ROOT_MSVC_X86_64:gst,GST_PLUGIN_PATH:join(gst,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gst,'lib/gstreamer-1.0'),GST_PLUGIN_SCANNER:join(gst,'libexec/gstreamer-1.0/gst-plugin-scanner.exe'),GST_REGISTRY:join(directory,'registry.bin'),HOST:'127.0.0.1',RPLAYOUT_ENGINE_OUTPUT:'null',RPLAYOUT_MEDIAMTX_BIND:'127.0.0.1',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_DEVICES:'',RPLAYOUT_RELAY:'',RPLAYOUT_BACKUP_HOURS:'0',LOG_LEVEL:'warn'})
// Deliberately hostile ambient values, scoped ONLY to these QA children.
// A missing filter either prevents startup (CONFKEY) or visibly changes the
// real broker configuration. No actual path hook is ever supplied here.
const ambientOverrides={MTX_CONFKEY:'QA_NOT_AN_ENCRYPTION_KEY',RTSP_CONFKEY:'QA_LEGACY_NOT_A_KEY',MTX_MOQ:'yes',RTSP_APIADDRESS:'0.0.0.0:19997',MTX_RTPADDRESS:':18000',RTSP_WEBRTCLOCALUDPADDRESS:':18189',MTX_PATHS_QA_SOURCE:'rtsp://127.0.0.1:1/never-used'}
if(exerciseAmbientOverrides)Object.assign(env,ambientOverrides)
const file=join(media,'Sinal sintético ação Çãó.mkv')
await run(join(gstBin,'gst-launch-1.0.exe'),['-q','matroskamux','name=m','!','filesink',`location=${file.replaceAll('\\','/')}`,
  'videotestsrc','num-buffers=1500','pattern=smpte','!','video/x-raw,width=320,height=180,framerate=25/1','!','videoconvert','!','vp8enc','deadline=1','threads=2','!','queue','!','m.',
  'audiotestsrc','num-buffers=2813','samplesperbuffer=1024','volume=0.05','freq=997','!','audio/x-raw,rate=48000,channels=2','!','audioconvert','!','vorbisenc','!','queue','!','m.'],{env,windowsHide:true,timeout:60000})
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex'),mediaHash=sha(await readFile(file))
const hashes={launcher:sha(await readFile(join(root,'RPlayout-Server.exe'))),server:sha(await readFile(join(root,'apps/server/dist/server.cjs'))),engine:sha(await readFile(join(native,'rplayout-engine.exe'))),broker:sha(await readFile(join(root,'mediamtx/mediamtx.exe')))}
assert.equal(hashes.launcher,'101a28c9e55c5a826b9805804f10853227d539b9a98cc4b018ddec81f9dc82b8')
assert.equal(hashes.server,expectedServerHash)
const qualifiedEngineHashes=['191cd1e112c7afba81896bbf3aa109a100775a7a358b7894faaafbe8d1abdfbc','610e03e8a61215e7ddb85570451178456337b8f2f9aa57ab07a057ae954cf7fa']
assert.ok(qualifiedEngineHashes.includes(hashes.engine),'Unqualified engine generation')
if(installedPackageCase){const manifest=JSON.parse(await readFile(join(root,'package-manifest.json'),'utf8'));assert.equal(manifest.files.find((entry:any)=>entry.file==='apps/engine/target/release/rplayout-engine.exe').sha256.toLowerCase(),hashes.engine)}
process.env.RPLAYOUT_VAULT_FILE=vault;delete process.env.RPLAYOUT_VAULT_KEY
const {openDatabase}=await import('../apps/server/src/db/client.js'),{channels,rundowns,outputProfiles}=await import('../apps/server/src/db/schema.js'),{hashPassword}=await import('../apps/server/src/domain/auth.js')
const seeded=openDatabase(databaseFile),stamp=new Date().toISOString()
seeded.sqlite.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('qa','launcher-native-verifier',await hashPassword('Local-launcher-native-20261016'),'ADMIN',1,stamp)
seeded.db.insert(channels).values({id:'qa',name:'Launcher native QA',width:320,height:180,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:stamp}).run()
seeded.db.insert(rundowns).values({id:'rd',channelId:'qa',name:'Owned native lifecycle',date:stamp.slice(0,10),plannedStart:0,loop:false,createdAt:stamp,updatedAt:stamp}).run()
seeded.db.insert(outputProfiles).values({id:'off',channelId:'qa',name:'No external program',kind:'RTMP',target:'',role:'PROGRAM',enabled:false,createdAt:stamp}).run()
seeded.sqlite.close() // No seeded media metadata, proxy state or QC decision.
const allocator=createServer();await new Promise<void>(done=>allocator.listen(0,'127.0.0.1',done));const port=(allocator.address() as {port:number}).port;await new Promise<void>(done=>allocator.close(()=>done()))
assert.ok(!(await readdir(root)).includes(`.rplayout-launcher-${port}.json`),'Do not replace a historical descriptor; choose another finite run')
const base='http://127.0.0.1:'+port,owned=new Set<number>(),children:ChildProcess[]=[],logs=new Map<ChildProcess,string>()
let cookie='',heartbeat:ReturnType<typeof setInterval>|null=null,owner:ChildProcess|null=null,profileChanged=false,result:Record<string,any>={result:'FAIL',directory,root,hashes,reusedFacadeBinaries:Boolean(reuseRoot),installedPackageCase,exerciseAmbientOverrides,sharedGStreamer:installedPackageCase?null:gst,packageGStreamer:installedPackageCase?gst:null,ambientOverrideKeys:exerciseAmbientOverrides?Object.keys(ambientOverrides):[],fullInstallationValidated:false},failure:unknown=null
const alive=(pid:number)=>{try{process.kill(pid,0);return true}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return false;throw error}}
function launch(){const child=spawn(join(root,'RPlayout-Server.exe'),['--server-only','--port='+port],{cwd:root,windowsHide:true,env,stdio:['ignore','pipe','pipe']});children.push(child);logs.set(child,'');for(const stream of [child.stdout,child.stderr])stream?.on('data',chunk=>logs.set(child,(logs.get(child)+String(chunk)).slice(-48000)));return child}
async function wait(label:string,check:()=>boolean|Promise<boolean>,timeout=60000){const deadline=performance.now()+timeout;while(performance.now()<deadline){if(await check())return;assert.ok(owner?.exitCode===null&&owner.signalCode===null,logs.get(owner!));await new Promise(done=>setTimeout(done,100))}throw new Error(label+' '+logs.get(owner!))}
async function request(path:string,body?:object,headers:Record<string,string>={},method=body?'POST':'GET',status=200){const response=await fetch(base+path,{method,headers:{...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});const data=await response.json() as any;assert.equal(response.status,status,path+' '+JSON.stringify(data));return {data,etag:response.headers.get('etag')!}}
const snapshot=async()=>(await request('/api/rundowns/rd')).data
async function collect(){const rows=(await request('/api/processes')).data.processes??[];result.latestProcesses=rows;for(const row of rows)if(Number.isSafeInteger(row.pid)&&row.pid>0)owned.add(row.pid)}
async function exit(child:ChildProcess){if(child.exitCode!==null||child.signalCode!==null)return;await new Promise<void>((done,reject)=>{const timer=setTimeout(()=>reject(new Error('Owned launcher did not exit')),10000);child.once('exit',()=>{clearTimeout(timer);done()})})}
try{
  if(reuseRoot||installedPackageCase){
    // Revalidate no process from this owned facade is still running before
    // changing only its test profile; never treat the old result as liveness.
    // In installed mode this verifier itself uses the package's Node. Exclude
    // only the current, known verifier PID, not a command-name/PID allowlist.
    // Invoke with Node --import tsx/loader (no separate tsx CLI parent).
    const inspect=`$taskRoot='${root.replaceAll("'","''")}\\'; @(Get-CimInstance Win32_Process | Where-Object {$_.ProcessId -ne ${process.pid} -and $_.ExecutablePath -and $_.ExecutablePath.StartsWith($taskRoot,[StringComparison]::OrdinalIgnoreCase)}).Count`
    const checked=await run(join(process.env.SystemRoot!,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-Command',inspect],{windowsHide:true,timeout:15000,maxBuffer:1024})
    assert.equal(Number(checked.stdout.trim()),0,'Owned facade still has live processes; no profile change allowed')
  }
  await writeFile(profileFile,candidateProfile)
  profileChanged=true
  owner=launch();const started=performance.now()
  await wait('Launcher identity ready',async()=>{try{return(await request('/_rplayout/launcher')).data.application==='RPlayout'}catch{return false}})
  const identity=(await request('/_rplayout/launcher')).data;owned.add(identity.pid)
  if(installedPackageCase){
    const page=await fetch(base+'/');assert.equal(page.status,200)
    const assetPath=(await page.text()).match(/src="(\/assets\/[^" ]+\.js)"/)?.[1];assert.ok(assetPath)
    const web=await fetch(base+assetPath);assert.equal(web.status,200)
    const webHash=sha(new Uint8Array(await web.arrayBuffer()));assert.equal(webHash,sha(await readFile(join(root,'apps/web/dist',assetPath))))
    result.interfaceAsset=assetPath;result.interfaceHash=webHash
  }
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'launcher-native-verifier',password:'Local-launcher-native-20261016'})})
  assert.equal(login.status,200);cookie=login.headers.get('set-cookie')!.split(';')[0]!
  await wait('Engine and own broker ready under launcher job',async()=>{const health=(await request('/api/health')).data;return health.nativeEngines===1&&health.engines===1&&health.mediamtx==='running'})
  result.startupElapsedMs=performance.now()-started
  const brokerConfigResponse=await fetch('http://127.0.0.1:9997/v3/config/global/get',{signal:AbortSignal.timeout(5000)})
  assert.equal(brokerConfigResponse.status,200);const effective=await brokerConfigResponse.json() as any
  const brokerConfig=Object.fromEntries(['moq','rtspTransports','rtspAddress','rtpAddress','rtcpAddress','srtAddress','webrtcAddress','webrtcLocalUDPAddress','apiAddress'].map(key=>[key,effective[key]]))
  assert.equal(brokerConfig.moq,false);assert.deepEqual([...brokerConfig.rtspTransports as string[]].sort(),['tcp','udp'])
  for(const key of ['rtspAddress','rtpAddress','rtcpAddress','srtAddress','webrtcAddress','webrtcLocalUDPAddress','apiAddress'])assert.ok(String(brokerConfig[key]).startsWith('127.0.0.1:'))
  result.brokerConfig=brokerConfig
  await wait('Initial scan settled',async()=>!(await request('/api/library/scan')).data.running)
  const scan=(await request('/api/library/scan/review')).data
  await request('/api/library/scan',{root:media,measure:false,requestId:scan.operationId},{'if-match':scanETag(scan)})
  await wait('Own scan settled',async()=>!(await request('/api/library/scan')).data.running)
  const asset=(await request('/api/assets')).data.assets.find((row:any)=>row.path===file)
  assert.ok(asset);assert.equal(asset.contentHash,mediaHash);assert.equal(asset.qcStatus,'PENDING');assert.equal(asset.probe.hasAudio,true)
  await wait('Real archive/proxy ready',async()=>(await request(`/api/assets/${asset.id}/workflow?hash=${mediaHash}`)).data.previewReady)
  const profile=await request('/api/channels/qa/qc-profile')
  await request('/api/channels/qa/qc-profile',{...DEFAULT_QC_PROFILE,width:320,height:180,fps:25,requireAudio:true},{'if-match':profile.etag},'PUT')
  const qc=await request(`/api/assets/${asset.id}/qc?channelId=qa`)
  await request(`/api/assets/${asset.id}/qc`,{channelId:'qa',contentHash:mediaHash,status:'APPROVED'},{'if-match':qc.etag})
  const editorial=(await request('/api/rundowns/rd/operational-simulation')).data.review
  await request('/api/rundowns/rd/items',{mediaId:asset.id,type:'VT',autoNext:false},{'if-match':`w/"${editorial.editorialRevision}"`})
  const view=await snapshot(),item=view.view.items[0].item.id,review=(await request('/api/rundowns/rd/operational-simulation')).data.review
  const publication=(await request('/api/rundowns/rd/operational-publish',{reviewToken:review.token},{'if-match':`w/"${review.editorialRevision}"`},'POST',201)).data
  await request('/api/channels/qa/transport',{action:'cue',itemId:item})
  await request('/api/channels/qa/watching',{bus:'pvw'})
  await wait('Real frame of the cued file, not automatic Next',async()=>{
    const state=(await snapshot()).live.transport;result.lastCueState=state
    return state.preview?.kind==='ITEM'&&state.preview.id===item&&state.previewFrame?.itemId===item&&state.previewFrame.delivered
  })
  assert.equal((await snapshot()).live.transport.onAir,null)
  await request('/api/channels/qa/transport',{action:'take'})
  await wait('Actual file PGM selected',async()=>(await snapshot()).live.transport.onAir?.itemId===item)
  const before=await snapshot();result.programBeforeCapture=before.live.transport;await collect()
  let heartbeatBusy=false
  heartbeat=setInterval(()=>{if(heartbeatBusy)return;heartbeatBusy=true;void request('/api/channels/qa/watching',{bus:'mon'}).catch(error=>{result.heartbeatError=String(error)}).finally(()=>{heartbeatBusy=false})},5000)
  await request('/api/channels/qa/watching',{bus:'mon'})
  await wait('Monitor encoder must actually publish both tracks before a reader joins',async()=>{
    const response=await fetch('http://127.0.0.1:9997/v3/paths/get/'+before.monitors.program,{signal:AbortSignal.timeout(3000)})
    if(!response.ok){result.lastMonitorStatus=response.status;return false}
    const path=await response.json() as any;result.lastMonitorStatus={ready:path.ready,tracks:path.tracks}
    return path.ready&&path.tracks?.includes('H264')&&path.tracks?.includes('Opus')
  },30000)
  const outcomes=await Promise.allSettled([verifyPublishedPicture({gstBin,directory,path:before.monitors.program,width:320,height:180,environment:env,label:'launcher-native',videoOnly:true}),verifyPublishedAudio({gstBin,directory,path:before.monitors.program,environment:env,label:'launcher-native',expectedHz:997})])
  result.captureAttempts=outcomes.map((row,index)=>({kind:index?'AUDIO':'PICTURE',result:row.status,error:row.status==='rejected'?String(row.reason):null}))
  for(const outcome of outcomes)if(outcome.status==='rejected')throw outcome.reason
  const [picture,audio]=outcomes.map(row=>(row as PromiseFulfilledResult<any>).value)
  const second=launch();await exit(second);assert.equal(second.exitCode,0);assert.match(logs.get(second)!,/reutilizando a instância confirmada/)
  const after=await snapshot();assert.equal(after.live.transport.onAir.itemId,item);assert.equal(after.live.transport.onAir.startedAt,before.live.transport.onAir.startedAt);assert.ok(after.live.transport.onAir.elapsed>before.live.transport.onAir.elapsed)
  if(captureUpgradeBackup){
    const requestId=randomUUID()
    result.upgradeBackupRequestId=requestId
    await request('/api/backups/upgrade',{requestId})
    await wait('Online upgrade backup finishes without interrupting PGM',async()=>{
      const backup=(await request('/api/backups/upgrade/'+requestId)).data
      result.upgradeBackup=backup
      assert.ok(backup.phase==='CHECKING'||backup.phase==='READY',JSON.stringify(backup))
      return backup.phase==='READY'
    },30000)
    assert.equal(result.upgradeBackup.sha256,sha(await readFile(result.upgradeBackup.file)))
    const duplicate=(await request('/api/backups/upgrade',{requestId})).data
    assert.deepEqual(duplicate,result.upgradeBackup,'Same UUID must query original result, not repeat the backup')
    const afterBackup=(await snapshot()).live.transport.onAir
    assert.equal(afterBackup.itemId,item);assert.equal(afterBackup.startedAt,before.live.transport.onAir.startedAt)
    assert.ok(afterBackup.elapsed>after.live.transport.onAir.elapsed)
    result.afterBackup=afterBackup;result.originalVaultFile=vault;result.originalMediaRoot=media
  }
  await collect();const processes=(await request('/api/processes')).data.processes
  assert.ok(processes.some((row:any)=>row.kind==='ENGINE'&&row.state==='running'));assert.ok(processes.some((row:any)=>row.kind==='MEDIAMTX'&&row.state==='running'))
  const broker=processes.find((row:any)=>row.kind==='MEDIAMTX'&&row.state==='running');assert.ok(Number.isInteger(broker.pid)&&broker.pid>0)
  if(installedPackageCase){
    const engine=processes.find((row:any)=>row.kind==='ENGINE'&&row.state==='running');assert.ok(Number.isSafeInteger(engine.pid)&&engine.pid>0)
    assert.ok(Number.isSafeInteger(identity.pid)&&identity.pid>0)
    // SQLite runs in its admitted storage process, not necessarily in the
    // HTTP backend. Resolve that actual process from this authenticated server.
    const storage=(await request('/api/engineering/storage')).data
    assert.equal(storage.connected,true);assert.equal(storage.backendPid,identity.pid)
    assert.ok(Number.isSafeInteger(storage.storagePid)&&storage.storagePid>0)
    owned.add(storage.storagePid);result.storage=storage
    const moduleInspect=`$ErrorActionPreference='Stop'; $taskModules=@(); $taskModules+=@((Get-Process -Id ${storage.storagePid}).Modules | Where-Object {$_.ModuleName -eq 'better_sqlite3.node'} | Select-Object @{n='kind';e={'SQLITE'}},ModuleName,FileName); $taskModules+=@((Get-Process -Id ${engine.pid}).Modules | Where-Object {$_.ModuleName -eq 'gstreamer-1.0-0.dll'} | Select-Object @{n='kind';e={'GSTREAMER'}},ModuleName,FileName); ConvertTo-Json -InputObject @($taskModules) -Compress`
    const observed=await run(join(process.env.SystemRoot!,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-Command',moduleInspect],{windowsHide:true,timeout:15000,maxBuffer:4096})
    const loadedModules=JSON.parse(observed.stdout);result.loadedModules=loadedModules;assert.equal(loadedModules.length,2)
    assert.deepEqual(loadedModules.map((row:any)=>row.kind).sort(),['GSTREAMER','SQLITE'])
    for(const row of loadedModules)assert.ok(row.FileName.toLowerCase().startsWith(root.toLowerCase()+'\\'),'Loaded runtime outside the installed package')
  }
  const inspect=`$ErrorActionPreference='Stop'; $rows=@(); $rows+=@(Get-NetTCPConnection -OwningProcess ${broker.pid} -State Listen | Select-Object @{n='protocol';e={'TCP'}},LocalAddress,LocalPort); $rows+=@(Get-NetUDPEndpoint -OwningProcess ${broker.pid} | Select-Object @{n='protocol';e={'UDP'}},LocalAddress,LocalPort); ConvertTo-Json -InputObject @($rows) -Compress`
  const {stdout}=await run(join(process.env.SystemRoot!,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-Command',inspect],{windowsHide:true,timeout:15000,maxBuffer:8192})
  const brokerBindings=JSON.parse(stdout);assert.ok(Array.isArray(brokerBindings)&&brokerBindings.length>=8)
  for(const binding of brokerBindings){assert.equal(binding.LocalAddress,'127.0.0.1');assert.ok((binding.protocol==='TCP'?[1935,8554,8888,8889,9997]:[8000,8001,8189,8890]).includes(binding.LocalPort),'Unexpected native listener '+JSON.stringify(binding))}
  assert.ok(!(await readdir(root)).some(name=>name==='auto.key'||name==='auto.crt'),'No implicit MoQ certificate generation')
  assert.ok(Number.isInteger(owner.pid)&&owner.pid!>0)
  const familyInspect=`$ErrorActionPreference='Stop'; $taskRows=@(Get-CimInstance Win32_Process | Where-Object {$_.ProcessId -ne ${process.pid}}); $taskOwned=[Collections.Generic.HashSet[int]]::new(); [void]$taskOwned.Add(${owner.pid}); foreach($taskRow in $taskRows){if($taskRow.ExecutablePath -and $taskRow.ExecutablePath.StartsWith('${root.replaceAll("'","''")}\\',[StringComparison]::OrdinalIgnoreCase)){[void]$taskOwned.Add([int]$taskRow.ProcessId)}}; do {$taskChanged=$false; foreach($taskRow in $taskRows){if($taskOwned.Contains([int]$taskRow.ParentProcessId) -and $taskOwned.Add([int]$taskRow.ProcessId)){$taskChanged=$true}}} while($taskChanged); $taskRows | Where-Object {$taskOwned.Contains([int]$_.ProcessId)} | Select-Object ProcessId,ParentProcessId,ExecutablePath,CreationDate | ConvertTo-Json -Compress`
  const familyOutput=await run(join(process.env.SystemRoot!,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-Command',familyInspect],{windowsHide:true,timeout:15000,maxBuffer:16384})
  const observedFamily=JSON.parse(familyOutput.stdout);assert.ok(Array.isArray(observedFamily)&&observedFamily.length>=4)
  for(const row of observedFamily){assert.ok(Number.isInteger(row.ProcessId)&&row.ProcessId>0);owned.add(row.ProcessId)}
  result={...result,result:'PASS',assetId:asset.id,mediaHash,publicationId:publication.id,item,before:before.live.transport.onAir,after:after.live.transport.onAir,picture,audio,secondLauncherReused:true,processes,brokerBindings,observedFamily}
}catch(error){failure=error;result={...result,error:String(error)};throw error}
finally{
  if(heartbeat)clearInterval(heartbeat)
  if(owner&&owner.exitCode===null&&owner.signalCode===null){try{await collect()}catch{}owner.kill();await exit(owner)}
  for(const child of children)if(child.exitCode===null&&child.signalCode===null){child.kill();await exit(child)}
  const deadline=performance.now()+15000;while([...owned].some(alive)&&performance.now()<deadline)await new Promise(done=>setTimeout(done,100))
  const ownedFamilyStopped=[...owned].every(pid=>!alive(pid))
  if(ownedFamilyStopped&&profileChanged&&priorProfile){await writeFile(profileFile,priorProfile);assert.equal(sha(await readFile(profileFile)),sha(priorProfile));result.priorProfileRestored=true}
  result={...result,ownedPids:[...owned],ownedFamilyStopped,allLaunchersStopped:children.every(child=>child.exitCode!==null||child.signalCode!==null),physicalInputsValidated:false,remoteStationValidated:false}
  if(!ownedFamilyStopped){result.result='FAIL';result.teardownError='Owned native family not stopped; no historical PID killed'}
  for(const [index,child]of children.entries())await writeFile(join(directory,`launcher-${index}.log`),logs.get(child)??'')
  await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({result:result.result,directory,error:result.error,ownedFamilyStopped,picture:result.picture,audio:result.audio}))
  if(!ownedFamilyStopped&&!failure)throw new Error(result.teardownError)
}
