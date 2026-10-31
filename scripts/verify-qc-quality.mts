import assert from 'node:assert/strict'
import {spawn,execFile,type ChildProcess} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {createServer} from 'node:net'
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(tmpdir(),'RPlayout-QC-quality-'))
const gstRoot=process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64??'C:/Program Files/gstreamer/1.0/msvc_x86_64',gstBin=join(gstRoot,'bin')
const environment={...process.env,PATH:gstBin+';'+process.env.PATH,GST_PLUGIN_PATH:join(gstRoot,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gstRoot,'lib/gstreamer-1.0'),GST_PLUGIN_SCANNER:join(gstRoot,'libexec/gstreamer-1.0/gst-plugin-scanner.exe'),GST_REGISTRY:join(directory,'gst-registry.bin')}
const file=join(directory,'Aprovação-4K-ação.mp4')
await promisify(execFile)(join(gstBin,'gst-launch-1.0.exe'),['-q','videotestsrc','num-buffers=50','!','video/x-raw,width=3840,height=2160,framerate=25/1','!','videoconvert','!','x264enc','threads=2','speed-preset=ultrafast','!','h264parse','!','mp4mux','!','filesink',`location=${file.replaceAll('\\','/')}`],{timeout:60_000,windowsHide:true,env:environment})
const bytes=await readFile(file),hash=createHash('sha256').update(bytes).digest('hex')
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json')
const {openDatabase}=await import('../apps/server/src/db/client.js'),{mediaAssets}=await import('../apps/server/src/db/schema.js')
const database=openDatabase(join(directory,'qc.db'))
database.db.insert(mediaAssets).values({id:'4k',title:'Original de aprovação',path:file,contentHash:hash,kind:'VIDEO',durationFrames:50,durationNs:2_000_000_000,
  rateNum:25,rateDen:1,width:3840,height:2160,qcStatus:'PENDING',createdAt:new Date().toISOString()}).run()
const socket=createServer();await new Promise<void>(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=(socket.address() as {port:number}).port
await new Promise<void>(resolve=>socket.close(()=>resolve()))
let server:ChildProcess|null=null,logs=''
function jpegSize(bytes:Buffer){
  assert.equal(bytes.readUInt16BE(0),0xffd8)
  for(let at=2;at+8<bytes.length;){
    assert.equal(bytes[at],0xff);const marker=bytes[at+1]!,length=bytes.readUInt16BE(at+2)
    if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker))return {width:bytes.readUInt16BE(at+7),height:bytes.readUInt16BE(at+5)}
    if(marker===0xda||marker===0xd9)break
    assert.ok(length>=2);at+=length+2
  }
  throw new Error('JPEG não contém geometria verificável.')
}
try{
  server=spawn(process.execPath,[join(root,'apps/server/dist/server.cjs')],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...environment,
    RPLAYOUT_INSTALL_ROOT:root,RPLAYOUT_DB:join(directory,'qc.db'),RPLAYOUT_VAULT_FILE:join(directory,'vault.json'),RPLAYOUT_THUMBS:join(directory,'thumbs'),RPLAYOUT_MEDIA_VERSIONS:join(directory,'versions'),RPLAYOUT_MEDIA:directory,
    RPLAYOUT_ENGINE:'',RPLAYOUT_MEDIAMTX:'',RPLAYOUT_PROXY:'',RPLAYOUT_PROBE:join(root,'apps/engine/target/release/rplayout-probe.exe'),RPLAYOUT_DEVICES:'',RPLAYOUT_RELAY:'',RPLAYOUT_N1_PEER:'',
    RPLAYOUT_ADMIN_USER:'',RPLAYOUT_ADMIN_PASSWORD:'',RPLAYOUT_CONTROL_TOKEN:'',RPLAYOUT_ROLE:'ADMIN',RPLAYOUT_BACKUP_HOURS:'0',HOST:'127.0.0.1',PORT:String(port),LOG_LEVEL:'warn'}})
  for(const stream of [server.stdout,server.stderr])stream?.on('data',chunk=>{logs=(logs+String(chunk)).slice(-4000)})
  const deadline=performance.now()+20_000
  while(true){
    assert.equal(server.exitCode,null,logs)
    try{const response=await fetch(`http://127.0.0.1:${port}/api/health`);if(response.ok)break}catch{}
    assert.ok(performance.now()<deadline,logs);await new Promise(resolve=>setTimeout(resolve,100))
  }
  const get=async(path:string)=>fetch(`http://127.0.0.1:${port}${path}`,{signal:AbortSignal.timeout(120_000)})
  const high=await get(`/api/assets/4k/frame/0.jpg?total=24&quality=original&hash=${hash}`)
  assert.equal(high.status,200,await(high.status===200?Promise.resolve(''):high.text()))
  const highSize=jpegSize(Buffer.from(await high.arrayBuffer()));assert.deepEqual(highSize,{width:3840,height:2160})
  assert.equal(high.headers.get('x-rplayout-rendition'),'qc-jpeg-3840')
  const low=await get(`/api/assets/4k/frame/0.jpg?total=24&hash=${hash}`);assert.equal(low.status,200)
  const lowSize=jpegSize(Buffer.from(await low.arrayBuffer()));assert.deepEqual(lowSize,{width:320,height:180})
  const original=await get(`/api/assets/4k/media?quality=original&hash=${hash}`);assert.equal(original.status,200)
  assert.equal(createHash('sha256').update(Buffer.from(await original.arrayBuffer())).digest('hex'),hash)
  const pending=(database.sqlite.prepare("SELECT qc_status FROM media_assets WHERE id='4k'").get() as any).qc_status;assert.equal(pending,'PENDING')
  assert.equal((database.sqlite.prepare("SELECT count(*) AS n FROM qc_decisions WHERE asset_id='4k'").get() as any).n,0)
  console.log(JSON.stringify({result:'PASS',evidence:'COMPILED_SERVER_NATIVE_QC_4K_JPEG_AND_HASH_VERIFIED_ORIGINAL',directory,port,pid:server.pid,highSize,lowSize,originalHashMatches:true,qualityDefaultRemainsLightweight:true,inspectionDoesNotApprove:true,browserPlaybackValidated:false,physicalOutputValidated:false}))
}finally{
  if(server && server.exitCode===null && server.signalCode===null){const ended=new Promise<void>(resolve=>server!.once('exit',()=>resolve()));server.kill('SIGKILL');await ended}
  database.sqlite.close()
}
