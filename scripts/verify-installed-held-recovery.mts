import assert from 'node:assert/strict'
import {spawn,execFile,type ChildProcess} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createRequire} from 'node:module'
import {createHash} from 'node:crypto'
import {createServer} from 'node:net'
import {verifyPublishedPicture} from './lib/verify-published-picture.js'
import {verifyPublishedAudio,stereoToneStatistics} from './lib/verify-published-audio.js'
import {assertMovingPublishedGray} from './lib/held-picture-evidence.js'

assert.equal(process.argv.length,4)
const target=resolve(process.argv[2]!),sourceRuntime=resolve(process.argv[3]!),qa=resolve('D:/RPlayout-builds/qa')
for(const root of [target,sourceRuntime])assert.ok(root.toLowerCase().startsWith(qa.toLowerCase()+'\\'))
assert.equal(resolve(process.execPath).toLowerCase(),join(target,'runtime/node/node.exe').toLowerCase())
const directory=await mkdtemp(join(qa,'installed-held-')),prepared=join(directory,'prepared')
await mkdir(join(directory,'temp'))
const run=promisify(execFile),hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex'),ps=join(process.env.SystemRoot!,'System32/WindowsPowerShell/v1.0/powershell.exe')
const SQLite=createRequire(join(target,'apps/server/dist/server.cjs'))('better-sqlite3')
const read=<T,>(file:string,work:(db:any)=>T):T=>{const db=new SQLite(file,{readonly:true,fileMustExist:true});try{return work(db)}finally{db.close()}}
const priorProfile=await readFile(join(target,'installation-profile.json'));await writeFile(join(directory,'prior-profile.json'),priorProfile)
const env:NodeJS.ProcessEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^RPLAYOUT_|^NODE_|^GST_|^GSTREAMER_|^MTX_|^RTSP_|^HOST$|^PORT$/i.test(key)))
const gst=join(target,'runtime/gstreamer'),gstBin=join(gst,'bin')
Object.assign(env,{PATH:[join(target,'runtime/node'),gstBin,join(target,'apps/engine/target/release'),join(process.env.SystemRoot!,'System32')].join(';'),TEMP:join(directory,'temp'),TMP:join(directory,'temp'),HOST:'127.0.0.1',RPLAYOUT_INSTALL_ROOT:target,RPLAYOUT_ENGINE_OUTPUT:'null',RPLAYOUT_MEDIAMTX_BIND:'127.0.0.1',RPLAYOUT_BACKUP_HOURS:'0',LOG_LEVEL:'warn',GSTREAMER_1_0_ROOT_MSVC_X86_64:gst,GST_PLUGIN_PATH:join(gst,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gst,'lib/gstreamer-1.0'),GST_PLUGIN_SCANNER:join(gst,'libexec/gstreamer-1.0/gst-plugin-scanner.exe'),GST_REGISTRY:join(directory,'registry.bin')})
let child:ChildProcess|null=null,captured:any=null,logs='',base='',cookie='',heartbeat:ReturnType<typeof setInterval>|null=null,failure:unknown=null,result:Record<string,any>={result:'FAIL',directory,target,sourceRuntime,prepared,scope:'Native domain HELD source fixture with packaged engine, then actual installed target backend/broker and explicit CUE/TAKE; not a packaged source backend, ingest/QC certification or external hardware'}
const owned=new Set<number>(),q=(value:string)=>"'"+value.replaceAll("'","''")+"'",alive=(pid:number)=>{try{process.kill(pid,0);return true}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return false;throw error}}
async function inventory(){
  const code=`$ErrorActionPreference='Stop'; $rows=@(Get-CimInstance Win32_Process | Where-Object {$_.ProcessId -ne ${process.pid}}); $ids=[Collections.Generic.HashSet[int]]::new(); if(${child?.pid??0} -gt 0){[void]$ids.Add(${child?.pid??0})}; foreach($row in $rows){if($row.ExecutablePath -and $row.ExecutablePath.StartsWith(${q(target+'\\')},[StringComparison]::OrdinalIgnoreCase)){[void]$ids.Add([int]$row.ProcessId)}}; do {$changed=$false; foreach($row in $rows){if($ids.Contains([int]$row.ParentProcessId) -and $ids.Add([int]$row.ProcessId)){$changed=$true}}} while($changed); ConvertTo-Json -InputObject @($rows | Where-Object {$ids.Contains([int]$_.ProcessId)} | Select-Object ProcessId,ParentProcessId,ExecutablePath) -Compress`
  const output=await run(ps,['-NoProfile','-NonInteractive','-Command',code],{env,windowsHide:true,timeout:15000,maxBuffer:32768})
  const rows=JSON.parse(output.stdout);for(const row of rows)owned.add(row.ProcessId);return rows
}
async function request(path:string,body?:object,status=200){const response=await fetch(base+path,{method:body?'POST':'GET',headers:{...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(5000)});const value=await response.json() as any;assert.equal(response.status,status,path+' '+JSON.stringify(value));return value}
async function wait(label:string,check:()=>Promise<boolean>,timeout=600000){const deadline=performance.now()+timeout;while(performance.now()<deadline){if(await check())return;assert.equal(child?.exitCode,null,logs);await new Promise(done=>setTimeout(done,100))}throw new Error(label+' '+logs)}
try{
  assert.equal((await inventory()).length,0,'Target installation has live processes; no profile change permitted')
  assert.equal(JSON.parse(await readFile(join(target,'installation-receipt.json'),'utf8')).integrity,'VERIFIED')
  result.targetManifestHash=hash(await readFile(join(target,'package-manifest.json')))
  result.engineHash=hash(await readFile(join(target,'apps/engine/target/release/rplayout-engine.exe')))
  const source=await run(ps,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',resolve('scripts/qa-owned-held-source.ps1'),'-InstallRoot',sourceRuntime],{env,cwd:sourceRuntime,windowsHide:true,timeout:120000,maxBuffer:2*1024*1024})
  await writeFile(join(directory,'source.log'),source.stdout+'\n'+source.stderr)
  captured=JSON.parse(source.stdout.slice(source.stdout.indexOf('{')))
  assert.equal(captured.passed,true);assert.equal(captured.sourceBackendPackaged,false);assert.equal(captured.nextItem,'vt-next')
  for(const pid of [captured.sourcePid,...captured.sourceEnginePids])assert.equal(alive(pid),false,'Source lifetime not confirmed stopped; never stop an unrelated reused PID')
  result.source=captured;result.sourceBackupHash=hash(await readFile(captured.backupEvidence.file))
  const preparation=await run(ps,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',join(target,'prepare-rplayout-upgrade.ps1'),'-Backup',captured.backupEvidence.file,'-Destination',prepared,'-VaultFile',join(captured.directory,'vault.json'),'-MediaRoot',captured.directory],{env,cwd:target,windowsHide:true,timeout:600000,maxBuffer:65536})
  await writeFile(join(directory,'prepare.log'),preparation.stdout+'\n'+preparation.stderr)
  assert.deepEqual(read(join(prepared,'service.db'),db=>JSON.parse(db.prepare("SELECT payload FROM channel_checkpoints WHERE channel_id='held'").get().payload)),captured.saved)
  assert.equal(hash(await readFile(join(target,'installation-profile.json'))),hash(priorProfile))
  const allocator=createServer();await new Promise<void>(done=>allocator.listen(0,'127.0.0.1',done));const port=(allocator.address() as {port:number}).port;await new Promise<void>(done=>allocator.close(()=>done()));base='http://127.0.0.1:'+port
  child=spawn(ps,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',resolve('scripts/qa-owned-upgrade.ps1'),'-InstallRoot',target,'-Workspace',prepared,'-Mode','ACTIVATE','-AdoptProfile'],{env:{...env,PORT:String(port)},cwd:target,windowsHide:true,stdio:['ignore','pipe','pipe']})
  for(const stream of [child.stdout,child.stderr])stream?.on('data',chunk=>logs=(logs+String(chunk)).slice(-64000))
  await wait('Installed HELD activation readiness',async()=>{try{return(await request('/_rplayout/launcher')).application==='RPlayout'}catch{return false}})
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'held-frame-verifier',password:'Local-held-frame-20261017'})});assert.equal(login.status,200);cookie=login.headers.get('set-cookie')!.split(';')[0]!
  const view=await request('/api/rundowns/rd')
  await writeFile(join(directory,'held-view.json'),JSON.stringify(view,null,2))
  assert.equal(view.live.transport.mode,'NATIVE');assert.equal(view.live.transport.playing,false);assert.equal(view.live.transport.onAir.itemId,captured.saved.itemId)
  const checkpoint=()=>read(join(prepared,'service.db'),db=>JSON.parse(db.prepare("SELECT payload FROM channel_checkpoints WHERE channel_id='held'").get().payload))
  const held=checkpoint();assert.equal(held.elapsed,captured.saved.elapsed);assert.equal(held.programHold.status,'HELD')
  for(const key of ['executionId','revisionId','itemId','rundownId'])assert.equal(held[key],captured.saved[key]);assert.deepEqual(held.programTrim,captured.saved.programTrim)
  result.heldCheckpoint=held
  await request('/api/channels/held/watching',{bus:'mon'})
  let busy=false;heartbeat=setInterval(()=>{if(busy)return;busy=true;void request('/api/channels/held/watching',{bus:'mon'}).catch(error=>{result.heartbeatError=String(error)}).finally(()=>{busy=false})},5000)
  await wait('Held program publishes both tracks',async()=>{const response=await fetch('http://127.0.0.1:9997/v3/paths/get/'+view.monitors.program,{signal:AbortSignal.timeout(3000)});if(!response.ok)return false;const media=await response.json() as any;return media.ready&&media.tracks.includes('H264')&&media.tracks.includes('Opus')},30000)
  const pictures=[]
  for(const label of ['held-first','held-second'])pictures.push(await verifyPublishedPicture({gstBin,directory,path:view.monitors.program,width:320,height:180,environment:env,label,videoOnly:true}))
  const pixels=[await readFile(join(directory,'held-first-last.gray')),await readFile(join(directory,'held-second-last.gray'))]
  const meanDifference=pixels[0]!.reduce((sum,value,index)=>sum+Math.abs(value-pixels[1]![index]!),0)/pixels[0]!.length
  assert.ok(meanDifference<1,'Frozen published pixels must stay stable across independent receivers')
  const silence=join(directory,'held-silence.f32')
  await run(join(gstBin,'gst-launch-1.0.exe'),['-q','rtspsrc','name=r',`location=rtsp://127.0.0.1:8554/${view.monitors.program}`,'latency=120','protocols=tcp','r.','!','application/x-rtp,media=audio,encoding-name=OPUS','!','queue','!','rtpopusdepay','!','opusdec','!','audioconvert','!','audio/x-raw,format=F32LE,rate=48000,channels=2,layout=interleaved','!','identity','eos-after=31','!','filesink',`location=${silence.replaceAll('\\','/')}`],{env,windowsHide:true,timeout:30000})
  const silent=stereoToneStatistics(await readFile(silence));assert.ok(silent.rms.every(value=>value<0.0001),'Held PGM must not replay audio')
  assert.equal(checkpoint().elapsed,held.elapsed);assert.equal(checkpoint().playing,false)
  result.heldEvidence={pictures,meanDifference,silent,cursorStable:true}
  await request('/api/channels/held/transport',{action:'cue',itemId:'vt-next'})
  await request('/api/channels/held/watching',{bus:'pvw'})
  await wait('New CUE actual frame while PGM stays held',async()=>{const value=await request('/api/rundowns/rd');assert.equal(value.live.transport.onAir.itemId,'vt');assert.equal(value.live.transport.playing,false);return value.live.transport.previewFrame?.itemId==='vt-next'&&value.live.transport.previewFrame.delivered},30000)
  await writeFile(join(directory,'cue-view.json'),JSON.stringify(await request('/api/rundowns/rd'),null,2))
  assert.equal(checkpoint().elapsed,held.elapsed)
  await request('/api/channels/held/transport',{action:'take'})
  await wait('Explicit TAKE replaces confirmed held PGM',async()=>{const value=await request('/api/rundowns/rd');return value.live.transport.playing&&value.live.transport.onAir.itemId==='vt-next'&&value.live.transport.onAir.elapsed>0},30000)
  result.afterTake={picture:await verifyPublishedPicture({gstBin,directory,path:view.monitors.program,width:320,height:180,environment:env,label:'held-take',videoOnly:true}),audio:await verifyPublishedAudio({gstBin,directory,path:view.monitors.program,environment:env,label:'held-take',expectedHz:997}),checkpoint:checkpoint()}
  const moving=join(directory,'held-take-motion.gray')
  await run(join(gstBin,'gst-launch-1.0.exe'),['-q','rtspsrc','name=r',`location=rtsp://127.0.0.1:8554/${view.monitors.program}`,'latency=120','protocols=tcp','r.','!','application/x-rtp,media=video,encoding-name=H264','!','queue','!','rtph264depay','request-keyframe=true','wait-for-keyframe=true','!','video/x-h264,alignment=au','!','h264parse','!','avdec_h264','!','videoconvert','!','video/x-raw,format=GRAY8,width=320,height=180','!','identity','eos-after=76','!','filesink',`location=${moving.replaceAll('\\','/')}`],{env,windowsHide:true,timeout:30000})
  result.afterTake.motion=assertMovingPublishedGray(await readFile(moving),320,180)
  result.afterTake.checkpoint=checkpoint()
  await writeFile(join(directory,'take-view.json'),JSON.stringify(await request('/api/rundowns/rd'),null,2))
  assert.equal(result.afterTake.checkpoint.programHold,undefined)
  assert.equal(result.afterTake.checkpoint.itemId,'vt-next');assert.equal(result.afterTake.checkpoint.playing,true)
  const rows=read(join(prepared,'service.db'),db=>db.prepare('SELECT * FROM as_run ORDER BY rowid').all())
  assert.equal(rows.length,3);assert.equal(rows[0].ended_by,'RESTART');assert.equal(rows[1].ended_by,'TAKE');assert.equal(rows[1].end_position_frames,held.elapsed);assert.equal(rows[2].item_id,'vt-next');assert.equal(rows.filter((row:any)=>row.ended_at===null).length,1)
  assert.equal(hash(await readFile(captured.backupEvidence.file)),result.sourceBackupHash,'Original backup must remain unchanged')
  result.asRun=rows;result.result='PASS'
  await writeFile(join(directory,'adopted-profile.json'),await readFile(join(target,'installation-profile.json')))
}catch(error){failure=error;result.error=String(error);throw error}
finally{
  if(heartbeat)clearInterval(heartbeat)
  result.observedFamily=await inventory()
  if(child&&child.exitCode===null&&child.signalCode===null)await new Promise<void>((done,reject)=>{const timer=setTimeout(()=>reject(new Error('Own held QA job did not exit')),15000);child!.once('exit',()=>{clearTimeout(timer);done()});child!.kill('SIGKILL')})
  const deadline=performance.now()+15000;while([...owned].some(alive)&&performance.now()<deadline)await new Promise(done=>setTimeout(done,100))
  result.ownedFamilyStopped=[...owned].every(pid=>!alive(pid))&&(await inventory()).length===0
  if(result.ownedFamilyStopped){await writeFile(join(target,'installation-profile.json'),priorProfile);result.qaProfileRestored=hash(await readFile(join(target,'installation-profile.json')))===hash(priorProfile);if(!result.qaProfileRestored){result.result='FAIL';result.teardownError='Original QA profile not restored'}}
  else{result.result='FAIL';result.teardownError='Own processes still exist; profile preserved'}
  result.physicalInputsValidated=false;result.pixelPerfectOriginalFrameValidated=false
  await writeFile(join(directory,'target.log'),logs);await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({result:result.result,directory,error:result.error,ownedFamilyStopped:result.ownedFamilyStopped}))
  if(result.result!=='PASS'&&!failure)throw new Error(result.teardownError)
}
