import assert from 'node:assert/strict'
import {spawn,execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {createInterface} from 'node:readline'
import {mkdtemp,readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'

// Local native process/receipt rehearsal only. No physical output, production
// database or supervisor. Pixel/silence evidence lives in Rust fixture tests.
const root=fileURLToPath(new URL('..',import.meta.url))
const directory=await mkdtemp(join(root,'scratch','held-process-'))
const binary=resolve(process.argv[2]??join(root,'apps/engine/target/debug/rplayout-engine.exe'))
const gstRoot=process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64??'C:/Program Files/gstreamer/1.0/msvc_x86_64'
const gstBin=join(gstRoot,'bin')
const env={...process.env,PATH:gstBin+';'+process.env.PATH,GST_PLUGIN_PATH:join(gstRoot,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gstRoot,'lib/gstreamer-1.0'),GST_PLUGIN_SCANNER:join(gstRoot,'libexec/gstreamer-1.0/gst-plugin-scanner.exe'),GST_REGISTRY:join(directory,'registry.bin')}
for(const name of Object.keys(env))if(name.startsWith('RPLAYOUT_'))delete env[name]
const file=join(directory,'Fonte-ação.mkv')
const binarySha=createHash('sha256').update(await readFile(binary)).digest('hex')
const processes=[]
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
function launch(name){
  const child=spawn(binary,['--channel-id',name,'--width','320','--height','180','--fps-num','25','--fps-den','1','--bitrate','450','--audio-channels','2'],{env,windowsHide:true,stdio:['pipe','pipe','pipe']})
  const log={pid:child.pid,events:[],stderr:'',exit:null,error:null}
  const exited=new Promise(resolve=>{child.once('exit',(code,signal)=>{log.exit={code,signal};resolve(log.exit)});child.once('error',error=>{log.error=error.message;resolve({error:error.message})})})
  createInterface({input:child.stdout}).on('line',line=>{try{log.events.push(JSON.parse(line))}catch{}})
  child.stderr.on('data',data=>{log.stderr=(log.stderr+data).slice(-12000)})
  async function wait(predicate,from=0,timeout=30000){
    const deadline=Date.now()+timeout
    while(Date.now()<deadline){
      const found=log.events.slice(from).find(predicate);if(found)return found
      if(log.exit||log.error)throw new Error(`${name} exited: ${JSON.stringify(log.exit??log.error)} ${log.stderr}`)
      await delay(10)
    }
    throw new Error(`${name}: native event timeout ${log.stderr}`)
  }
  let next=1
  async function request(command){
    const id=next++,from=log.events.length
    child.stdin.write(JSON.stringify({id,...command})+'\n')
    const ack=await wait(event=>event.event==='ack'&&event.id===id,from)
    assert.equal(ack.ok,true,ack.error)
    return {id,from,ack}
  }
  const result={child,log,exited,wait,request};processes.push(result);return result
}
try{
  await promisify(execFile)(join(gstBin,'gst-launch-1.0.exe'),['-q','matroskamux','name=m','!','filesink',`location=${file.replaceAll('\\','/')}`,'videotestsrc','num-buffers=500','pattern=ball','!','video/x-raw,width=160,height=90,framerate=25/1','!','videoconvert','!','vp8enc','deadline=1','!','queue','!','m.','audiotestsrc','num-buffers=940','volume=0.4','!','audio/x-raw,channels=2,rate=48000','!','audioconvert','!','vorbisenc','!','queue','!','m.'],{env,windowsHide:true,timeout:60000})
  const spec={itemId:'held-vt',path:file,trimIn:25,trimOut:400,startOffsetFrames:0,gainDb:0}
  const first=launch('held-process-before');await first.wait(event=>event.event==='ready')
  await first.request({cmd:'load',item:spec});await first.request({cmd:'take'})
  const state=await first.wait(event=>event.event==='state'&&event.onAir==='held-vt')
  await first.wait(event=>event.event==='position'&&event.itemId==='held-vt'&&event.frames>=5)
  const hold=await first.request({cmd:'programHold',itemId:'held-vt',decoderId:state.onAirDecoderId,on:true})
  const receipt=await first.wait(event=>event.event==='programHold'&&event.id===hold.id,hold.from)
  assert.equal(receipt.decoderId,hold.ack.decoderId);assert.equal(receipt.held,true)
  assert.ok(Number.isSafeInteger(receipt.frames)&&receipt.frames>=5)
  const checkpoint={itemId:'held-vt',trimIn:25,trimOut:400,frames:receipt.frames,sourceSha:createHash('sha256').update(await readFile(file)).digest('hex')}
  await writeFile(join(directory,'saved-cursor.json'),JSON.stringify(checkpoint,null,2))
  first.child.kill('SIGKILL');await first.exited;assert.ok(first.log.exit,'must observe original process termination')
  const second=launch('held-process-after');await second.wait(event=>event.event==='ready')
  assert.notEqual(second.log.pid,first.log.pid)
  const restore=await second.request({cmd:'restoreProgramHold',item:{...spec,startOffsetFrames:checkpoint.frames}})
  const restored=await second.wait(event=>event.event==='programHold'&&event.id===restore.id,restore.from)
  const restoredState=await second.wait(event=>event.event==='state'&&event.onAir==='held-vt'&&event.programHold?.status==='HELD',restore.from)
  assert.equal(restored.frames,checkpoint.frames);assert.equal(restored.held,true)
  assert.equal(restored.decoderId,restore.ack.decoderId);assert.equal(restoredState.onAirDecoderId,restored.decoderId)
  assert.deepEqual(restoredState.programHold,{itemId:'held-vt',decoderId:restored.decoderId,status:'HELD',frames:checkpoint.frames})
  const sampleStart=second.log.events.length
  await second.request({cmd:'status'});await delay(1300)
  const positions=second.log.events.slice(sampleStart).filter(event=>event.event==='position')
  assert.ok(positions.length>=3,'held native position samples required')
  assert.ok(positions.every(event=>event.itemId==='held-vt'&&event.decoderId===restored.decoderId&&event.frames===checkpoint.frames))
  assert.ok(second.log.events.slice(sampleStart).some(event=>event.event==='output'&&event.frames>0),'output clock must continue')
  await second.request({cmd:'shutdown'});await second.exited;assert.equal(second.log.exit?.code,0)
  const evidence={scope:'native subprocess receipts/cursor, not physical pixels or runtime recovery',binary,binarySha,checkpoint,beforePid:first.log.pid,afterPid:second.log.pid,firstExit:first.log.exit,secondExit:second.log.exit,restoredReceipt:restored,positionSamples:positions.length,passed:true}
  await writeFile(join(directory,'result.json'),JSON.stringify(evidence,null,2))
  console.log(JSON.stringify({directory,...evidence},null,2))
}finally{
  for(const process of processes){
    if(!process.log.exit&&!process.log.error){process.child.kill('SIGKILL');await Promise.race([process.exited,delay(5000)]);assert.ok(process.log.exit||process.log.error,'owned process termination not confirmed')}
    await writeFile(join(directory,`process-${process.log.pid??'spawn-error'}.json`),JSON.stringify(process.log,null,2))
  }
}
