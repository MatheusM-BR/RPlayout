import assert from 'node:assert/strict'
import {readFile,writeFile,access} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {assertStorageQaProxyEvidence} from './lib/storage-qa-proxy.js'
import {assertMovingPublishedGray} from './lib/held-picture-evidence.js'
import {stereoToneStatistics,syntheticToneSpectrum,syntheticToneWindows} from './lib/verify-published-audio.js'

// Existing artifacts only; never restart the source scenario or repair its
// FAIL. Decoding a forcibly closed file does not certify mux finalization.
assert.equal(process.argv.length,3)
const root=fileURLToPath(new URL('..',import.meta.url)),directory=resolve(process.argv[2]!)
assert.ok(directory.startsWith(join(root,'scratch','normal-pgm-storage-timeout-')))
const report=JSON.parse(await readFile(join(directory,'result.json'),'utf8'))
assert.equal(report.directory,directory);assert.equal(report.nativeCleanup.ownedNativeProcessesStopped,true)
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
if(report.controlSourceHashes){for(const name of['app','engine'])assert.equal(hash(await readFile(join(directory,`control-${name}.source.ts`))),report.controlSourceHashes[name])}
if(report.normalCloseProof){assert.deepEqual(report.normalCloseProof,{ownedNativeProcessesStopped:true,graceful:true,forceRequested:false});assert.deepEqual(report.nativeExit,{code:0,signal:null})}
await assertStorageQaProxyEvidence(join(directory,'fault-workers'),report.binaries,report.qaProxy)
const marker=JSON.parse(await readFile(join(directory,'fault-workers/timeout-marker.json'),'utf8'))
assert.deepEqual(marker,report.marker);assert.equal(marker.actualAck.inTransaction,true);assert.equal(marker.targetRequests,1);assert.equal(marker.replyForwarded,false)
assert.ok(report.timeout.blockedMs>=29500);assert.equal(report.timeout.storage.connected,false)
assert.equal(report.beforeFault.health.fencing.enabled,false);assert.equal(report.afterFault.health.fencing.enabled,false)
assert.equal(report.beforeFault.state.onAir.itemId,report.afterFault.state.onAir.itemId)
assert.equal(report.beforeFault.state.onAir.startedAt,report.afterFault.state.onAir.startedAt)
const ownPids=[report.beforeFault.storage.backendPid,report.enginePid,marker.proxyPid,marker.actualServicePid]
for(const pid of ownPids){let gone=false;try{process.kill(pid,0)}catch(error){gone=(error as NodeJS.ErrnoException).code==='ESRCH'}assert.equal(gone,true,'Read-only absence required; never kill a reconstructed PID')}
const recorded=Boolean(report.capture)
const output=join(directory,'normal-pgm.mkv'),gray=join(directory,recorded?'published.gray':'evidence.gray'),pcm=join(directory,recorded?'published.f32':'evidence.f32')
if(!recorded)for(const file of[gray,pcm])await assert.rejects(access(file),'Do not overwrite or replay derivative extraction')
const prior=hash(await readFile(output)),gst='C:/Program Files/gstreamer/1.0/msvc_x86_64'
const env={...process.env,PATH:join(gst,'bin')+';'+process.env.PATH,GST_REGISTRY:join(directory,'evidence-registry.bin'),GST_PLUGIN_PATH:join(gst,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gst,'lib/gstreamer-1.0'),GST_PLUGIN_SCANNER:join(gst,'libexec/gstreamer-1.0/gst-plugin-scanner.exe')}
if(!recorded)for(const branch of[['videoconvert','video/x-raw,format=GRAY8,width=320,height=180',gray],['audioconvert','audio/x-raw,format=F32LE,rate=48000,channels=2,layout=interleaved',pcm]])await promisify(execFile)(join(gst,'bin/gst-launch-1.0.exe'),['-q','filesrc',`location=${output.replaceAll('\\','/')}`,'!','decodebin','name=d','d.','!','queue','!',branch[0]!,'!',branch[1]!,'!','filesink',`location=${branch[2]!.replaceAll('\\','/')}`],{env,windowsHide:true,timeout:30000})
assert.equal(hash(await readFile(output)),prior)
const pixels=await readFile(gray),audio=await readFile(pcm),size=320*180,frames=pixels.length/size,samples=audio.length/8,windows=[]
if(recorded){assert.equal(prior,report.capture.encodedSha256);assert.equal(hash(pixels),report.capture.graySha256);assert.equal(hash(audio),report.capture.pcmSha256)}
assert.equal(pixels.length%size,0);assert.equal(audio.length%8,0)
assert.ok(frames/25>=report.timeout.blockedMs/1000&&samples/48000>=report.timeout.blockedMs/1000)
for(const fraction of[0.25,0.5,0.75]){
 const at=Math.floor(frames*fraction),audioAt=Math.floor(samples*fraction)
 const movement=assertMovingPublishedGray(pixels.subarray(at*size,(at+25)*size),320,180)
 const bytes=audio.subarray(audioAt*8,(audioAt+48000)*8),statistics=stereoToneStatistics(bytes),spectrum=syntheticToneSpectrum(bytes),toneWindows=syntheticToneWindows(bytes,spectrum.frequencyHz)
 for(let c=0;c<2;c++)assert.ok(statistics.rms[c]!>0.01&&Math.abs(spectrum.frequencyHz[c]!-997)<15&&toneWindows.concentratedWindows[c]!>=4)
 windows.push({fraction,movement,statistics,spectrum,toneWindows})
}
const file=join(directory,'Banco-PGM-ação.db'),dbHash=hash(await readFile(file)),SQLite=createRequire(new URL('../apps/server/package.json',import.meta.url))('better-sqlite3')
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json');delete process.env.RPLAYOUT_VAULT_KEY
const {readServerInstances}=await import('../apps/server/src/db/server-instances.js')
const db=new SQLite(file,{readonly:true,fileMustExist:true});let persisted:any
try{assert.equal(db.pragma('integrity_check',{simple:true}),'ok');assert.deepEqual(db.pragma('foreign_key_check'),[]);assert.deepEqual(db.prepare('SELECT * FROM fixture_pending').all(),[{id:'qa-pending',value:0}]);const instances=readServerInstances(db);assert.equal(instances.length,1);assert.equal(instances[0]!.phase,'OPEN');persisted={asrun:db.prepare('SELECT id,ended_at FROM as_run').all(),checkpoints:db.prepare('SELECT payload FROM channel_checkpoints').all(),signedInstancePhases:instances.map(value=>value.phase)}}finally{db.close()}
assert.equal(hash(await readFile(file)),dbHash)
const result={result:'PASS',sourceRunResult:report.result,nativeExit:report.nativeExit,nativeGracefulExitQualified:report.nativeExit.code===0&&report.nativeExit.signal===null,storageClosedQualified:false,scope:'Existing NORMAL local publisher file: decoded duration and moving/tone windows only. Source FAIL is NOT reclassified; no complete native shutdown, PTS/AV alignment, HA/restoration, installed, HTTP, physical or uninterrupted delivery qualification',blockedMs:report.timeout.blockedMs,videoFrames:frames,audioFrames:samples,windows,encodedSha256:prior,graySha256:hash(pixels),pcmSha256:hash(audio),persisted,databaseBytesUnchanged:true,ownPidsAbsent:ownPids}
await writeFile(join(directory,'assertions-local-capture.json'),JSON.stringify(result,null,2))
console.log(JSON.stringify({result:result.result,sourceRunResult:result.sourceRunResult,nativeGracefulExitQualified:result.nativeGracefulExitQualified,videoFrames:frames,audioFrames:samples,windows:windows.length,ownPidsAbsent:ownPids}))
