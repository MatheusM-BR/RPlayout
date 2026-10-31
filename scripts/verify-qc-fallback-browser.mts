import assert from 'node:assert/strict'
import {spawn,execFile,type ChildProcess} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,mkdir,readFile,writeFile,stat,readdir} from 'node:fs/promises'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash,randomUUID} from 'node:crypto'
import {createServer as netServer} from 'node:net'
import {createServer,request as forward} from 'node:http'

// Own loopback fixture: original FFV1 cannot be played by the browser, while
// the compiled engine can decode it. A transparent local relay can inject
// a frame-only 503 via the named control file; all other requests reach the
// actual compiled server. Never use this relay with operator data or PGM.
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(root,'scratch','qc-fallback-browser-'))
const media=join(directory,'Acervo São José Çãó');await mkdir(media)
const gst=process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64??'C:/Program Files/gstreamer/1.0/msvc_x86_64'
const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^RPLAYOUT_|^VITEST$/i.test(key))),PATH:join(gst,'bin')+';'+process.env.PATH,GST_PLUGIN_PATH:join(gst,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gst,'lib/gstreamer-1.0'),GST_PLUGIN_SCANNER:join(gst,'libexec/gstreamer-1.0/gst-plugin-scanner.exe'),GST_REGISTRY:join(directory,'registry.bin')}
const run=promisify(execFile),sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
const source=join(media,'Conferência FFV1 anamórfica.mkv')
await run(join(gst,'bin/gst-launch-1.0.exe'),['-q','videotestsrc','num-buffers=125','pattern=smpte','!','video/x-raw,width=720,height=576,framerate=25/1,pixel-aspect-ratio=16/15','!','videoconvert','!','avenc_ffv1','!','matroskamux','!','filesink',`location=${source.replaceAll('\\','/')}`],{env,windowsHide:true,timeout:30000})
const hash=sha(await readFile(source)),vault=join(directory,'vault.json');process.env.RPLAYOUT_VAULT_FILE=vault;delete process.env.RPLAYOUT_VAULT_KEY
const {openDatabase}=await import('../apps/server/src/db/client.js'),{channels,rundowns}=await import('../apps/server/src/db/schema.js'),{hashPassword}=await import('../apps/server/src/domain/auth.js'),{sessionDigest}=await import('../apps/server/src/domain/access.js')
const database=openDatabase(join(directory,'service.db')),stamp=new Date().toISOString()
database.sqlite.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('verifier','qc-fallback-verifier',await hashPassword('Local-QC-fallback-20261009'),'ADMIN',1,stamp)
const token=randomUUID()+randomUUID();database.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest(token),'verifier','2099-01-01',stamp)
database.db.insert(channels).values({id:'qc',name:'QC fallback isolado',width:1920,height:1080,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:stamp}).run()
database.db.insert(rundowns).values({id:'rd',channelId:'qc',name:'QC apenas',date:'2026-10-09',plannedStart:0,loop:false,createdAt:stamp,updatedAt:stamp}).run()
const allocator=netServer();await new Promise<void>(resolve=>allocator.listen(0,'127.0.0.1',resolve));const port=(allocator.address() as {port:number}).port;await new Promise<void>(resolve=>allocator.close(()=>resolve()))
const control=join(root,'scratch',`qc-fallback-control-${randomUUID()}.json`),stopFile=control.replace('control','stop'),events:Array<object>=[]
let server:ChildProcess|null=null,logs='',result:Record<string,unknown>={result:'FAIL',directory}
const relay=createServer(async(req,res)=>{
  const url=req.url??'/',start=performance.now();let inject=false
  if(/\/frame\/\d+\.jpg\?/.test(url)&&url.includes('quality=original')){
    try{inject=JSON.parse(await readFile(control,'utf8')).failFrames===true}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT'){res.writeHead(500);res.end('Fixture control invalid');return}}
  }
  if(inject){events.push({url,status:503,injected:true});res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});res.end('{"error":"Own QC fixture: frame failure"}');return}
  const upstream=forward({hostname:'127.0.0.1',port,path:url,method:req.method,headers:req.headers},response=>{
    res.writeHead(response.statusCode??502,response.headers);response.pipe(res)
    response.once('end',()=>{if(url.includes('/frame/')||url.includes('/media?'))events.push({url,status:response.statusCode,injected:false,elapsedMs:Math.round(performance.now()-start)})})
  });upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end()});req.pipe(upstream)
})
async function wait(label:string,check:()=>boolean|Promise<boolean>,timeout=90000){const deadline=performance.now()+timeout;while(performance.now()<deadline){assert.ok(!server||server.exitCode===null&&server.signalCode===null,logs);if(await check())return;await new Promise(resolve=>setTimeout(resolve,150))}throw new Error(label+' '+logs)}
try{
  server=spawn(process.execPath,[join(root,'apps/server/dist/server.cjs')],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...env,RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_DB:join(directory,'service.db'),RPLAYOUT_VAULT_FILE:vault,RPLAYOUT_MEDIA:media,RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_CACHE_DIR:join(directory,'cache'),RPLAYOUT_BACKUP_DIR:join(directory,'backups'),RPLAYOUT_ENGINE:'',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_PROXY:join(root,'apps/engine/target/release/rplayout-proxy.exe'),RPLAYOUT_PROBE:join(root,'apps/engine/target/release/rplayout-probe.exe'),RPLAYOUT_DEVICES:'',RPLAYOUT_RELAY:'',RPLAYOUT_AUDIO_ANALYSIS:'',RPLAYOUT_BACKUP_HOURS:'0',HOST:'127.0.0.1',PORT:String(port),LOG_LEVEL:'warn'}})
  for(const stream of [server.stdout,server.stderr])stream?.on('data',chunk=>logs=(logs+String(chunk)).slice(-16000))
  await wait('Actual proxy READY',()=>Boolean(database.sqlite.prepare("SELECT j.id FROM media_jobs j JOIN media_versions v ON v.id=j.version_id WHERE v.content_hash=? AND j.kind='PROXY' AND j.state='READY' AND j.proxy_recipe='picture-raster-v2'").get(hash)))
  const asset=database.sqlite.prepare('SELECT id,qc_status FROM media_assets WHERE content_hash=?').get(hash) as any;assert.ok(asset);assert.equal(asset.qc_status,'PENDING')
  const firstFrameStart=performance.now()
  const firstFrame=await fetch(`http://127.0.0.1:${port}/api/assets/${asset.id}/frame/0.jpg?total=24&quality=original&hash=${hash}`,{headers:{cookie:'rplayout_session='+token},signal:AbortSignal.timeout(30000)})
  assert.equal(firstFrame.status,200)
  const jpeg=Buffer.from(await firstFrame.arrayBuffer());assert.equal(jpeg.readUInt16BE(0),0xffd8);assert.equal(jpeg.readUInt16BE(jpeg.length-2),0xffd9)
  const elapsedMs=Math.round(performance.now()-firstFrameStart),generatedQualityFrames=(await readdir(join(directory,'thumbs'))).filter(name=>name.includes('-qc-frame-v3-'))
  assert.equal(generatedQualityFrames.length,1,'Quality must not generate the full strip before returning')
  assert.ok(generatedQualityFrames[0]!.endsWith('-0.jpg'))
  const stripStart=performance.now()
  const stripResponse=await fetch(`http://127.0.0.1:${port}/api/assets/${asset.id}/frame/0.jpg?total=24&hash=${hash}`,{headers:{cookie:'rplayout_session='+token},signal:AbortSignal.timeout(30000)})
  assert.equal(stripResponse.status,200)
  assert.equal(stripResponse.headers.get('x-rplayout-rendition'),'thumbnail')
  const stripJpeg=Buffer.from(await stripResponse.arrayBuffer())
  assert.equal(stripJpeg.readUInt16BE(0),0xffd8)
  const navigationStrip={firstFrameMs:Math.round(performance.now()-stripStart),jpegSha256:sha(stripJpeg),generatedFrames:(await readdir(join(directory,'thumbs'))).filter(name=>name.startsWith(`${hash}-24-picture-v2-`)&&!name.includes('qc-frame')).length}
  assert.equal(navigationStrip.generatedFrames,24)
  // Separate strip size avoids the already generated cache. Removing only
  // this fixture's READY status must not cause original decoding as fallback.
  const proxyJob=database.sqlite.prepare("SELECT j.id FROM media_jobs j JOIN media_versions v ON v.id=j.version_id WHERE v.content_hash=? AND j.kind='PROXY' AND j.state='READY'").get(hash) as {id:string}
  assert.ok(proxyJob)
  database.sqlite.prepare("UPDATE media_jobs SET state='FAILED' WHERE id=?").run(proxyJob.id)
  let unavailableProxyFallback:Record<string,unknown>
  try{
    const missing=await fetch(`http://127.0.0.1:${port}/api/assets/${asset.id}/frame/0.jpg?total=23&hash=${hash}`,{headers:{cookie:'rplayout_session='+token},redirect:'manual',signal:AbortSignal.timeout(30000)})
    assert.equal(missing.status,302)
    assert.equal(missing.headers.get('location'),`/api/assets/${asset.id}/thumbnail.svg`)
    const unexpected=(await readdir(join(directory,'thumbs'))).filter(name=>name.startsWith(`${hash}-23-picture-v2`))
    assert.equal(unexpected.length,0,'Missing proxy must not trigger an original strip')
    unavailableProxyFallback={status:missing.status,generatedFrames:0}
  }finally{database.sqlite.prepare("UPDATE media_jobs SET state='READY' WHERE id=?").run(proxyJob.id)}
  await new Promise<void>(resolve=>relay.listen(0,'127.0.0.1',resolve));const relayPort=(relay.address() as {port:number}).port
  result={result:'COMPILED_FIXTURE_READY',directory,assetId:asset.id,hash,sourceCodec:'FFV1',sourceRaster:[720,576],sourcePar:'16/15',navigationStrip,compiledFirstQualityFrame:{status:firstFrame.status,elapsedMs,generatedFrames:generatedQualityFrames.length,jpegSha256:sha(jpeg)},serverSha256:sha(await readFile(join(root,'apps/server/dist/server.cjs'))),probeSha256:sha(await readFile(join(root,'apps/engine/target/release/rplayout-probe.exe'))),browserValidated:false,pgmEngineNotEnabled:true}
  result={...result,unavailableProxyFallback}
  console.log(JSON.stringify({...result,url:`http://127.0.0.1:${relayPort}/?workspace=qc`,fixtureUser:'qc-fallback-verifier',fixturePassword:'Local-QC-fallback-20261009',control,stopFile}))
  if(!process.argv.includes('--http-only')){
    const expires=performance.now()+600000;await wait('Review stop or expiry',async()=>{if(performance.now()>=expires)return true;try{await stat(stopFile);return true}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error}},605000)
  }
  result={...result,qcDecisions:database.sqlite.prepare('SELECT count(*) as count FROM qc_decisions').get(),asRun:database.sqlite.prepare('SELECT count(*) as count FROM as_run').get(),events}
}catch(error){result={...result,result:'FAIL',error:String(error)};throw error}
finally{
  if(relay.listening)await new Promise<void>(resolve=>relay.close(()=>resolve()))
  if(server&&server.exitCode===null&&server.signalCode===null){const ended=new Promise<void>(resolve=>server!.once('exit',()=>resolve()));server.kill('SIGKILL');await ended}
  result={...result,serverExitObserved:!server||server.exitCode!==null||server.signalCode!==null}
  database.sqlite.close();await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));await writeFile(join(directory,'server.log'),logs);console.log(JSON.stringify(result))
}
