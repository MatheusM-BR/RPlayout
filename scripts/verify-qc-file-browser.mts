import assert from 'node:assert/strict'
import {spawn,execFile,type ChildProcess} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,mkdir,readFile,writeFile,stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash,randomUUID} from 'node:crypto'
import {createServer} from 'node:net'
import {scanETag} from '../packages/protocol/src/scan-review.js'

// Actual compiled scanner/archive/proxy. Seed only editorial shell and test
// account, never media metadata/jobs/QC approval. UI evidence is separate.
const sourceRoot=fileURLToPath(new URL('..',import.meta.url))
const installedArgument=process.argv.find(value=>value.startsWith('--installed-package='))
const root=installedArgument?resolve(installedArgument.slice('--installed-package='.length)):sourceRoot
if(installedArgument)assert.equal(resolve(process.execPath).toLowerCase(),join(root,'runtime/node/node.exe').toLowerCase(),'Use bundled Node')
const directory=await mkdtemp(join(installedArgument?join(sourceRoot,'scratch'):tmpdir(),'RPlayout-QC-file-browser-'))
const serverArgument=process.argv.find(value=>value.startsWith('--server-binary='))
const serverBinary=serverArgument?resolve(serverArgument.slice('--server-binary='.length)):join(root,'apps/server/dist/server.cjs')
await readFile(serverBinary)
const ttlArgument=process.argv.find(value=>value.startsWith('--review-ttl-ms='))
const reviewTtl=ttlArgument?Number(ttlArgument.slice('--review-ttl-ms='.length)):600000
assert.ok(Number.isSafeInteger(reviewTtl)&&reviewTtl>=1000&&reviewTtl<=1200000,'Visual review requires a bounded lifetime')
const media=join(directory,'Acervo São José Çãó');await mkdir(media)
const gst=installedArgument?join(root,'runtime/gstreamer'):process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64??'C:/Program Files/gstreamer/1.0/msvc_x86_64'
const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^RPLAYOUT_|^VITEST$/i.test(key))),PATH:join(gst,'bin')+';'+process.env.PATH,GST_PLUGIN_PATH:join(gst,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gst,'lib/gstreamer-1.0'),GST_PLUGIN_SCANNER:join(gst,'libexec/gstreamer-1.0/gst-plugin-scanner.exe'),GST_REGISTRY:join(directory,'registry.bin')}
if(serverArgument)Object.assign(env,{NODE_PATH:join(root,'apps/server/node_modules')})
if(installedArgument){env.PATH=join(gst,'bin')+';'+join(root,'runtime/node')+';'+join(process.env.SystemRoot!,'System32');delete env.NODE_PATH}
const run=promisify(execFile),sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
function jpegRaster(bytes:Uint8Array):[number,number]{
  assert.equal(bytes[0],0xff);assert.equal(bytes[1],0xd8)
  for(let offset=2;offset+3<bytes.length;){
    assert.equal(bytes[offset++],0xff)
    while(bytes[offset]===0xff)offset++
    const marker=bytes[offset++];assert.notEqual(marker,0xda,'JPEG raster must precede scan')
    const length=bytes[offset]*256+bytes[offset+1];assert.ok(length>=2&&offset+length<=bytes.length)
    if([0xc0,0xc1,0xc2].includes(marker))return [bytes[offset+5]*256+bytes[offset+6],bytes[offset+3]*256+bytes[offset+4]]
    offset+=length
  }
  throw new Error('JPEG has no supported frame header')
}
const fixtures=[]
for(const [label,width,height,pw,ph]of [['01-16x9',640,360,426,240],['02-4x3',640,480,320,240],['03-vertical',360,640,136,240]] as const){
  const file=join(media,`${label} ação.mp4`)
  await run(join(gst,'bin/gst-launch-1.0.exe'),['-q','videotestsrc','num-buffers=250','pattern=smpte','!',`video/x-raw,width=${width},height=${height},framerate=25/1`,'!','x264enc','tune=zerolatency','speed-preset=ultrafast','!','h264parse','!','queue','!','m.video_0','audiotestsrc','num-buffers=469','volume=0.05','!','audio/x-raw,rate=48000,channels=2','!','audioconvert','!','avenc_aac','!','aacparse','!','queue','!','m.audio_0','mp4mux','name=m','faststart=true','!','filesink',`location=${file.replaceAll('\\','/')}`],{env,windowsHide:true,timeout:30000})
  fixtures.push({label,file,hash:sha(await readFile(file)),width,height,pw,ph})
}
if(process.argv.includes('--codec-fallback')){
  const file=join(media,'04-FFV1 original ação.mkv')
  await run(join(gst,'bin/gst-launch-1.0.exe'),['-q','matroskamux','name=m','!','filesink',`location=${file.replaceAll('\\','/')}`,
    'videotestsrc','num-buffers=250','pattern=ball','!','video/x-raw,width=640,height=360,framerate=25/1','!','videoconvert','!','avenc_ffv1','!','queue','!','m.',
    'audiotestsrc','num-buffers=469','volume=0.05','!','audio/x-raw,rate=48000,channels=2','!','audioconvert','!','vorbisenc','!','queue','!','m.'],{env,windowsHide:true,timeout:30000})
  fixtures.push({label:'04-FFV1',file,hash:sha(await readFile(file)),width:640,height:360,pw:426,ph:240})
}
const vault=join(directory,'vault.json');process.env.RPLAYOUT_VAULT_FILE=vault;delete process.env.RPLAYOUT_VAULT_KEY
const {openDatabase}=await import('../apps/server/src/db/client.js'),{channels,rundowns}=await import('../apps/server/src/db/schema.js'),{hashPassword}=await import('../apps/server/src/domain/auth.js'),{sessionDigest}=await import('../apps/server/src/domain/access.js')
const database=openDatabase(join(directory,'service.db')),stamp=new Date().toISOString(),token=randomUUID()+randomUUID()
database.sqlite.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('verifier','qc-file-verifier',await hashPassword('Local-QC-files-20261009'),'ADMIN',1,stamp)
database.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest(token),'verifier','2099-01-01',stamp)
database.db.insert(channels).values({id:'qc',name:'QC arquivos isolados',width:1920,height:1080,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:stamp}).run()
database.db.insert(rundowns).values({id:'rd',channelId:'qc',name:'QC apenas',date:'2026-10-09',plannedStart:0,loop:false,createdAt:stamp,updatedAt:stamp}).run()
const listener=createServer();await new Promise<void>(resolve=>listener.listen(0,'127.0.0.1',resolve));const port=(listener.address() as {port:number}).port;await new Promise<void>(resolve=>listener.close(()=>resolve()))
let server:ChildProcess|null=null,logs='',result:Record<string,unknown>={result:'FAIL',directory}
async function api(path:string,body?:object,headers:Record<string,string>={}){
  const response=await fetch(`http://127.0.0.1:${port}${path}`,{headers:{cookie:'rplayout_session='+token,...(body?{'content-type':'application/json'}:{}),...headers},...(body?{method:'POST',body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)})
  const value=await response.json();assert.ok(response.ok,path+' '+response.status+' '+JSON.stringify(value));return value as any
}
async function wait(label:string,check:()=>boolean|Promise<boolean>,timeout=90000){
  const deadline=performance.now()+timeout
  while(performance.now()<deadline){assert.ok(!server||server.exitCode===null&&server.signalCode===null,logs);if(await check())return;await new Promise(resolve=>setTimeout(resolve,150))}
  throw new Error(label+' '+logs)
}
try{
  server=spawn(process.execPath,[serverBinary],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...env,RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_DB:join(directory,'service.db'),RPLAYOUT_VAULT_FILE:vault,RPLAYOUT_MEDIA:media,RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_CACHE_DIR:join(directory,'cache'),RPLAYOUT_BACKUP_DIR:join(directory,'backups'),RPLAYOUT_ENGINE:'',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_PROXY:join(root,'apps/engine/target/release/rplayout-proxy.exe'),RPLAYOUT_PROBE:join(root,'apps/engine/target/release/rplayout-probe.exe'),RPLAYOUT_DEVICES:'',RPLAYOUT_RELAY:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_BACKUP_HOURS:'0',RPLAYOUT_ROLE:'ADMIN',HOST:'127.0.0.1',PORT:String(port),LOG_LEVEL:'warn'}})
  for(const stream of [server.stdout,server.stderr])stream?.on('data',chunk=>logs=(logs+String(chunk)).slice(-16000))
  await wait('Server ready',async()=>{try{return(await api('/api/health')).ok}catch{return false}})
  await wait('Initial scan settled',async()=>!(await api('/api/library/scan')).running)
  const review=await api('/api/library/scan/review')
  await api('/api/library/scan',{root:media,measure:false,requestId:review.operationId},{'if-match':scanETag(review)})
  await wait('Own requested scan settled',async()=>!(await api('/api/library/scan')).running)
  const assets=(await api('/api/assets')).assets,verified=[]
  for(const fixture of fixtures){
    const asset=assets.find((entry:any)=>entry.path===fixture.file);assert.ok(asset);assert.equal(asset.contentHash,fixture.hash);assert.equal(asset.qcStatus,'PENDING')
    // Preserve the ingest policy: portrait video is reviewable under IGNORED,
    // not absent or failed. Never silently approve/unignore it for visual QA.
    const expectedIgnored=fixture.width/fixture.height<0.8
    assert.equal(Boolean(asset.ignored),expectedIgnored,fixture.label+' ingest visibility')
    assert.equal(asset.probeError,null,fixture.label+' must remain decodable')
    const path=`/api/assets/${encodeURIComponent(asset.id)}/workflow?hash=${fixture.hash}`
    await wait('Actual archived proxy ready '+fixture.label,async()=>(await api(path)).previewReady)
    const job=database.sqlite.prepare("SELECT j.output_path,j.output_hash,j.proxy_recipe FROM media_jobs j JOIN media_versions v ON v.id=j.version_id WHERE v.asset_id=? AND j.kind='PROXY' AND j.state='READY'").get(asset.id) as any
    assert.equal(job.proxy_recipe,'picture-raster-v2')
    const workflow=await api(path),proxy=await fetch(`http://127.0.0.1:${port}${workflow.previewUrl}`,{headers:{cookie:'rplayout_session='+token},signal:AbortSignal.timeout(10000)})
    assert.equal(proxy.status,200);assert.equal(sha(new Uint8Array(await proxy.arrayBuffer())),job.output_hash)
    const decoded=JSON.parse((await run(join(root,'apps/engine/target/release/rplayout-probe.exe'),[job.output_path,'--no-loudness'],{env,windowsHide:true,timeout:30000})).stdout.trim().split('\n').at(-1)!)
    assert.equal(decoded.ok,true);assert.equal(decoded.video.width,fixture.pw);assert.equal(decoded.video.height,fixture.ph);assert.ok(decoded.decodedVideoBuffers>0&&decoded.decodedAudioBuffers>0)
    const original=await fetch(`http://127.0.0.1:${port}/api/assets/${encodeURIComponent(asset.id)}/media?quality=original&hash=${fixture.hash}`,{headers:{cookie:'rplayout_session='+token},signal:AbortSignal.timeout(10000)})
    assert.equal(original.status,200);assert.equal(sha(new Uint8Array(await original.arrayBuffer())),fixture.hash)
    const qualityFrames=[]
    for(const position of [0,12,23]){
      const response=await fetch(`http://127.0.0.1:${port}/api/assets/${encodeURIComponent(asset.id)}/frame/${position}.jpg?total=24&quality=original&hash=${fixture.hash}`,{headers:{cookie:'rplayout_session='+token},signal:AbortSignal.timeout(30000)})
      assert.equal(response.status,200,fixture.label+' quality frame '+position)
      assert.equal(response.headers.get('content-type'),'image/jpeg')
      assert.equal(response.headers.get('x-rplayout-rendition'),`qc-jpeg-${fixture.width}`)
      const bytes=new Uint8Array(await response.arrayBuffer()),raster=jpegRaster(bytes)
      assert.deepEqual(raster,[fixture.width,fixture.height],fixture.label+' quality is original raster, not proxy/thumbnail')
      qualityFrames.push({position,raster,hash:sha(bytes)})
    }
    verified.push({id:asset.id,label:fixture.label,hash:fixture.hash,sourceRaster:[fixture.width,fixture.height],proxyRaster:[fixture.pw,fixture.ph],recipe:job.proxy_recipe,originalHashVerified:true,ignored:expectedIgnored,qcStatus:asset.qcStatus,qualityFrames})
  }
  result={result:'COMPILED_WORKFLOW_PASS',directory,verified,serverSha256:sha(await readFile(serverBinary)),proxySha256:sha(await readFile(join(root,'apps/engine/target/release/rplayout-proxy.exe'))),browserValidated:false,physicalOutputValidated:false,pgmEngineNotEnabled:true}
  await writeFile(join(directory,'workflow-result.json'),JSON.stringify(result,null,2))
  if(process.argv.includes('--failed-proxy')){
    // Deliberately corrupt only this fixture's disposable cache AFTER baseline
    // verification. The real workflow must reject it and expose retry in QC.
    const asset=verified[0]!
    const job=database.sqlite.prepare("SELECT j.id,j.output_path FROM media_jobs j JOIN media_versions v ON v.id=j.version_id WHERE v.asset_id=? AND j.kind='PROXY' AND j.state='READY'").get(asset.id) as {id:string;output_path:string}
    assert.ok(resolve(job.output_path).startsWith(resolve(join(directory,'versions'))+sep),'Only owned fixture cache may be corrupted')
    await writeFile(job.output_path,'QC fixture deliberately invalid proxy')
    const workflow=await api(`/api/assets/${encodeURIComponent(asset.id)}/workflow?hash=${asset.hash}`)
    assert.equal(workflow.previewReady,false)
    assert.ok(workflow.versions.some((version:any)=>version.jobs.some((entry:any)=>entry.id===job.id&&entry.state==='FAILED')))
    if(process.argv.includes('--legacy-proxy')){
      database.sqlite.prepare("UPDATE media_jobs SET error='Trabalho sem responsável identificável; confira encerramento.',owner_host=NULL,owner_pid=NULL,owner_boot=NULL WHERE id=? AND state='FAILED'").run(job.id)
      const legacy=await api(`/api/assets/${encodeURIComponent(asset.id)}/workflow?hash=${asset.hash}`)
      assert.ok(legacy.versions.some((version:any)=>version.jobs.some((entry:any)=>entry.id===job.id&&entry.retryRequiresConfirmation)))
    }
    result={...result,retryFixture:{assetId:asset.id,jobId:job.id,cacheCorrupted:true,originalPreserved:true}}
  }
  const stopFile=join(sourceRoot,'scratch',`qc-file-stop-${randomUUID()}.json`),expires=performance.now()+reviewTtl
  console.log(JSON.stringify({...result,status:'BROWSER_REVIEW_READY',url:`http://127.0.0.1:${port}/?workspace=qc`,fixtureUser:'qc-file-verifier',fixturePassword:'Local-QC-files-20261009',stopFile,expiresInMs:reviewTtl}))
  await wait('Visual stop or finite expiry',async()=>{if(performance.now()>=expires)return true;try{await stat(stopFile);return true}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error}},reviewTtl+5000)
}catch(error){result={...result,result:'FAIL',error:String(error)};throw error}
finally{
  if(server&&server.exitCode===null&&server.signalCode===null){const ended=new Promise<void>(resolve=>server!.once('exit',()=>resolve()));server.kill('SIGKILL');await ended}
  result={...result,serverExitObserved:true}
  database.sqlite.close();await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));await writeFile(join(directory,'server.log'),logs)
  console.log(JSON.stringify({...result,serverExitObserved:true}))
}
