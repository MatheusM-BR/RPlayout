import assert from 'node:assert/strict'
import {spawn,execFile,type ChildProcess} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,readFile,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {createServer} from 'node:http'
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(tmpdir(),'RPlayout-ingest-parent-'))
const gstRoot=process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64??'C:/Program Files/gstreamer/1.0/msvc_x86_64',gstBin=join(gstRoot,'bin')
const env={...process.env,PATH:gstBin+';'+process.env.PATH,GST_PLUGIN_PATH:join(gstRoot,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gstRoot,'lib/gstreamer-1.0'),GST_PLUGIN_SCANNER:join(gstRoot,'libexec/gstreamer-1.0/gst-plugin-scanner.exe'),GST_REGISTRY:join(directory,'registry.bin')}
const binary=join(root,'apps/engine/target/release/rplayout-probe.exe'),file=join(directory,'AÇÃO Çãó.mkv'),children:ChildProcess[]=[]
await promisify(execFile)(join(gstBin,'gst-launch-1.0.exe'),['-q','matroskamux','name=m','!','filesink',`location=${file.replaceAll('\\','/')}`,'videotestsrc','num-buffers=50','pattern=ball','!','video/x-raw,width=320,height=180,framerate=25/1','!','videoconvert','!','vp8enc','deadline=1','threads=2','!','queue','!','m.','audiotestsrc','num-buffers=94','samplesperbuffer=1024','volume=0.05','!','audio/x-raw,rate=48000,channels=2','!','audioconvert','!','vorbisenc','!','queue','!','m.'],{env,windowsHide:true,timeout:30000})
const original=createHash('sha256').update(await readFile(file)).digest('hex')
function launch(path:string){
  const child=spawn(binary,[path,'--no-loudness','--parent-pipe'],{env,windowsHide:true,stdio:['pipe','pipe','pipe']});children.push(child)
  let output='',error='';child.stdout.on('data',data=>{output+=data});child.stderr.on('data',data=>{error+=data})
  const done=new Promise<{code:number|null;signal:string|null;output:string;error:string}>((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal,output,error}))})
  return {child,done}
}
async function bounded<T>(promise:Promise<T>,ms:number){let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Own native helper timed out')),ms)})])}finally{if(timer)clearTimeout(timer)}}
let accepted!:()=>void;const ready=new Promise<void>(resolve=>{accepted=resolve}),http=createServer((_request,_response)=>{accepted()})
await new Promise<void>(resolve=>http.listen(0,'127.0.0.1',resolve))
let result:object|undefined
try{
  const normal=launch(file),decoded=await bounded(normal.done,20000);assert.equal(decoded.code,0,decoded.error)
  const payload=JSON.parse(decoded.output.trim().split('\n').pop()!);assert.equal(payload.ok,true);assert.ok(payload.decodedVideoBuffers>0);assert.ok(payload.decodedAudioBuffers>0)
  const blocked=launch(`http://127.0.0.1:${(http.address() as {port:number}).port}/owned-stalled-source`)
  await bounded(ready,10000);assert.equal(blocked.child.exitCode,null);assert.equal(blocked.child.signalCode,null)
  const at=performance.now();blocked.child.stdin.end();const stopped=await bounded(blocked.done,10000)
  assert.equal(stopped.code,1,JSON.stringify(stopped));assert.match(stopped.error,/servidor encerrou durante a análise/)
  assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'),original)
  result={result:'PASS',directory,probeSha256:createHash('sha256').update(await readFile(binary)).digest('hex'),parentPipeAliveRealDecodedVideoBuffers:payload.decodedVideoBuffers,parentPipeAliveRealDecodedAudioBuffers:payload.decodedAudioBuffers,ownLocalHttpAcceptedWhileProbeAlive:true,parentPipeEofNativeExitCode:stopped.code,parentPipeEofExitMs:Math.round(performance.now()-at),originalFilePreserved:true,browserPgmHardwareValidated:false,serverCrashAndAutomaticScannerRecoveryValidated:false}
}catch(error){result={result:'FAIL',directory,error:String(error)};throw error}
finally{
  const cleanupErrors:string[]=[]
  for(const child of children){if(child.exitCode!==null||child.signalCode!==null)continue;const ended=new Promise<void>(resolve=>child.once('close',()=>resolve()));try{assert.equal(child.kill(),true);await bounded(ended,10000)}catch(error){cleanupErrors.push(String(error))}}
  http.closeAllConnections();await new Promise<void>(resolve=>http.close(()=>resolve()))
  await writeFile(join(directory,'result.json'),JSON.stringify({...result,cleanupErrors},null,2));console.log(JSON.stringify({...result,cleanupErrors}));assert.equal(cleanupErrors.length,0)
}
