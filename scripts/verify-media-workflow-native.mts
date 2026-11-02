import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,readFile,writeFile,stat,readdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'

// Local native proxy/queue proof, not compiled HTTP/browser or broadcast QC.
const root=fileURLToPath(new URL('..',import.meta.url))
const incomingCopyOnly=process.argv.includes('--incoming-copy')
const directory=await mkdtemp(join(tmpdir(),'RPlayout-media-workflow-'))
const gstRoot=process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64??'C:/Program Files/gstreamer/1.0/msvc_x86_64'
process.env.PATH=join(gstRoot,'bin')+';'+process.env.PATH
process.env.GST_REGISTRY=join(directory,'registry.bin')
process.env.GST_PLUGIN_PATH=join(gstRoot,'lib/gstreamer-1.0')
process.env.GST_PLUGIN_SYSTEM_PATH=process.env.GST_PLUGIN_PATH
process.env.GST_PLUGIN_SCANNER=join(gstRoot,'libexec/gstreamer-1.0/gst-plugin-scanner.exe')
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json')
const {openDatabase}=await import('../apps/server/src/db/client.js')
const {MediaWorkflow}=await import('../apps/server/src/domain/media-workflow.js')
const database=openDatabase(join(directory,'workflow.db'))
database.sqlite.exec("INSERT INTO media_assets (id,content_hash,path,title,kind,duration_frames,created_at) VALUES ('a','initial','fixture','AÇÃO','VIDEO',75,'fixture')")
const workflow=new MediaWorkflow(database.sqlite,join(directory,'versions'),join(root,'apps/engine/target/release/rplayout-proxy.exe'))
const source=join(directory,'Programação-ação-ÇÃO.mkv'),run=promisify(execFile)
const sha=async(path:string)=>createHash('sha256').update(await readFile(path)).digest('hex')
async function fixture(pattern:string){
  await run(join(gstRoot,'bin/gst-launch-1.0.exe'),['-q','videotestsrc','num-buffers=75',`pattern=${pattern}`,'!','video/x-raw,width=640,height=360,framerate=25/1','!','vp8enc','deadline=1','!','queue','!','m.video_0','audiotestsrc','num-buffers=141','volume=0.05','!','audio/x-raw,rate=48000,channels=2','!','audioconvert','!','vorbisenc','!','queue','!','m.audio_0','matroskamux','name=m','!','filesink',`location=${source.replaceAll('\\','/')}`],{windowsHide:true,timeout:30_000})
}
async function settled(){
  const end=performance.now()+45_000
  while(performance.now()<end){
    if((workflow.jobs() as Array<{state:string}>).every(j=>!['PENDING','RUNNING'].includes(j.state)))return
    await new Promise(resolve=>setTimeout(resolve,100))
  }
  throw new Error('Media queue timeout: '+JSON.stringify(workflow.jobs()))
}
async function probe(path:string){
  const {stdout}=await run(join(root,'apps/engine/target/release/rplayout-probe.exe'),[path,'--no-loudness'],{windowsHide:true,timeout:30_000})
  return JSON.parse(stdout.trim().split('\n').at(-1)!)
}
let result:Record<string,unknown>|null=null
try{
  await fixture('smpte')
  const firstHash=await sha(source)
  if(incomingCopyOnly){
    // Real filesystem reads/copies of an actual encoded clip. Deliberately
    // register its declared final SHA while the incoming file is still half
    // copied; this tests the durable archive boundary, not scanner approval.
    const incoming=join(directory,'Cópia-pendente-ação-ÇÃO.mkv')
    const complete=await readFile(source),partialBytes=Math.floor(complete.length/2)
    await writeFile(incoming,complete.subarray(0,partialBytes))
    const edition=workflow.record('a',{contentHash:firstHash,kind:'VIDEO',path:incoming})
    await settled();await workflow.tick()
    const failedJobs=workflow.jobs() as Array<{id:string;kind:string;state:string;attempts:number;error:string}>
    const copyJob=failedJobs.find(job=>job.kind==='ARCHIVE')!,proxyJob=failedJobs.find(job=>job.kind==='PROXY')!
    assert.equal(copyJob.state,'FAILED');assert.match(copyJob.error,/arquivo mudou/)
    assert.equal(proxyJob.state,'FAILED');assert.equal(proxyJob.attempts,0)
    assert.equal(await workflow.archived('a',firstHash),null)
    assert.equal(await workflow.preview('a',firstHash),null)
    assert.ok(!(await readdir(join(directory,'versions'))).some(name=>name.endsWith('.part')))
    await writeFile(incoming,complete)
    assert.equal(workflow.record('a',{contentHash:firstHash,kind:'VIDEO',path:incoming}),edition)
    assert.equal(workflow.retry(copyJob.id),true)
    await settled();await workflow.tick()
    const archived=await workflow.archived('a',firstHash),proxy=await workflow.preview('a',firstHash)
    assert.ok(archived&&proxy,JSON.stringify(workflow.jobs()))
    assert.equal(await sha(archived),firstHash)
    const details=await probe(proxy)
    assert.equal(details.ok,true);assert.equal(details.video.width,426);assert.equal(details.video.height,240)
    assert.ok(details.decodedVideoBuffers>0&&details.decodedAudioBuffers>0)
    assert.equal(database.sqlite.prepare('SELECT output_hash FROM media_jobs WHERE id=?').get(proxyJob.id)?.output_hash,await sha(proxy))
    const jobs=workflow.jobs() as Array<{id:string;state:string;attempts:number}>
    // Explicit operator retry renews its three-attempt budget; unlike process
    // restart, it intentionally resets attempts. IDs/edition must stay stable.
    assert.equal(jobs.find(job=>job.id===copyJob.id)?.attempts,1)
    assert.equal(jobs.find(job=>job.id===proxyJob.id)?.attempts,1)
    assert.ok(jobs.every(job=>job.state==='READY'))
    assert.equal(workflow.versions('a').length,1)
    result={result:'PASS',directory,edition,firstHash,partialBytes,completeBytes:complete.length,failedJobs,jobs,details,incompleteIncomingDiskFileRefused:true,dependentProxyBlocked:true,sameEditionAndJobRecovered:true,archiveHashVerified:true,outputHashVerified:true,noPartialAfterFailedCopy:true,scope:'DURABLE_ARCHIVE_BOUNDARY_REAL_INCOMPLETE_INCOMING_DISK_COPY',scannerValidated:false,copyCancelledMidReadValidated:false,compiledApiValidated:false,browserValidated:false}
  }else{
  const firstId=workflow.record('a',{contentHash:firstHash,kind:'VIDEO',path:source});await settled()
  const archived=await workflow.archived('a',firstHash),proxy=await workflow.preview('a',firstHash)
  assert.ok(archived&&proxy,JSON.stringify(workflow.jobs()))
  const details=await probe(proxy)
  assert.equal(details.ok,true,JSON.stringify(details))
  assert.equal(details.video.width,426);assert.equal(details.video.height,240)
  assert.equal(details.video.rateNum,10);assert.equal(details.video.rateDen,1)
  assert.ok(details.audioTracks.length>0,'Proxy must contain actual decoded audio')
  const bytes=(await stat(proxy)).size
  const durationNs=Number(details.durationNs)
  assert.ok(durationNs>2e9&&durationNs<4e9,'Proxy duration must preserve fixture')
  await writeFile(proxy,'cache alterado')
  assert.equal(await workflow.preview('a',firstHash),null,'Altered cache must not be served')
  const failedProxy=(workflow.jobs() as Array<{id:string;kind:string;state:string}>).find(j=>j.kind==='PROXY'&&j.state==='FAILED')!
  assert.ok(failedProxy);assert.equal(workflow.retry(failedProxy.id),true);await settled()
  assert.equal(await workflow.preview('a',firstHash),proxy,'Regeneration must retain selected rendition path')
  const regenerated=await probe(proxy)
  assert.equal(regenerated.ok,true);assert.equal(regenerated.video.width,426)
  assert.ok(regenerated.decodedVideoBuffers>0&&regenerated.decodedAudioBuffers>0)
  assert.equal(database.sqlite.prepare('SELECT output_hash FROM media_jobs WHERE id=?').get(failedProxy.id)?.output_hash,await sha(proxy))
  await fixture('ball')
  const secondHash=await sha(source);assert.notEqual(secondHash,firstHash)
  workflow.record('a',{contentHash:secondHash,kind:'VIDEO',path:source});await settled()
  assert.equal(await sha(archived),firstHash,'Changing source must preserve earlier archive')
  assert.equal(await workflow.inspectionOriginal('a',firstHash,source),archived)
  assert.equal(workflow.record('a',{contentHash:secondHash.toUpperCase(),kind:'VIDEO',path:source}),workflow.versions('a')[0]!.id)
  await settled();assert.deepEqual(workflow.versions('a').map(v=>v.revision),[2,1])
  assert.ok(await workflow.preview('a',secondHash))
  result={result:'PASS',directory,firstId,firstHash,secondHash,details,proxyBytes:bytes,fileAverageKbps:bytes*8/(durationNs/1e9)/1000,versions:2,oldArchivePreserved:true,uppercaseDeduplicated:true,corruptCacheRefused:true,nativeCacheRegenerated:true,regenerated,outputHashVerified:true,jobs:workflow.jobs(),scope:'SOURCE_WORKFLOW_REAL_NATIVE_PROXY_AND_PROBE',compiledApiValidated:false,browserValidated:false,physicalSignalValidated:false}
  }
}catch(error){
  await writeFile(join(directory,'failure.json'),JSON.stringify({error:String(error),jobs:workflow.jobs()},null,2));throw error
}finally{await workflow.close();database.sqlite.close()}
assert.ok(result)
await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2))
console.log(JSON.stringify(result))
