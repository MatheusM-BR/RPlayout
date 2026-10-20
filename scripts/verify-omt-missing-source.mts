import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtemp,writeFile,readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {resolve,join} from 'node:path'
import {StringDecoder} from 'node:string_decoder'
import {hostname} from 'node:os'
const root=resolve('.'),installed=join(root,'scratch/r71-installed-qa-20261015'),directory=await mkdtemp(join(root,'scratch','omt-missing-'))
const gst=join(installed,'runtime/gstreamer'),env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^RPLAYOUT_|^NODE_PATH$|^NODE_OPTIONS$|^GST_|^GSTREAMER_|^NDI_/i.test(key)))
Object.assign(env,{PATH:[join(installed,'apps/engine/target/release'),installed,join(gst,'bin'),join(process.env.SystemRoot!,'System32')].join(';'),GST_PLUGIN_PATH:join(gst,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gst,'lib/gstreamer-1.0'),GST_PLUGIN_SCANNER:join(gst,'libexec/gstreamer-1.0/gst-plugin-scanner.exe'),GST_REGISTRY:join(directory,'registry.bin'),RPLAYOUT_OMT_RUNTIME:join(installed,'libomt.dll')})
const child=spawn(join(root,'apps/engine/target/release/rplayout-engine.exe'),['--channel-id','omt-missing-'+process.pid,'--width','640','--height','360','--fps-num','25','--fps-den','1'],{cwd:directory,env,windowsHide:true,stdio:['pipe','pipe','pipe']})
const events:any[]=[],commands:any[]=[],acks=new Map<number,any>();let log='',failure:unknown=null,id=0
const engineSha256=createHash('sha256').update(await readFile(join(root,'apps/engine/target/release/rplayout-engine.exe'))).digest('hex')
let sender:ReturnType<typeof spawn>|null=null
const senderEvents:any[]=[],senderAcks=new Map<number,any>();let senderLog=''
const decoder=new StringDecoder('utf8');let lines=''
child.stdout.on('data',chunk=>{lines+=decoder.write(chunk);let at;while((at=lines.indexOf('\n'))>=0){const line=lines.slice(0,at);lines=lines.slice(at+1);try{const row=JSON.parse(line);events.push({at:Date.now(),...row});if(row.event==='ack')acks.set(row.id,row)}catch{log+=line}}})
child.stderr.on('data',chunk=>log+=String(chunk))
const wait=async(predicate:()=>boolean,ms=15000)=>{const until=performance.now()+ms;while(performance.now()<until){assert.equal(child.exitCode,null);if(predicate())return;await new Promise(done=>setTimeout(done,50))}throw new Error('Native QA wait expired')}
const send=async(command:object)=>{const key=++id;commands.push({at:Date.now(),id:key,...command});child.stdin.write(JSON.stringify({id:key,...command})+'\n');await wait(()=>acks.has(key));assert.equal(acks.get(key).ok,true,JSON.stringify(acks.get(key)))}
try{
  await wait(()=>events.some(row=>row.event==='ready'))
  await send({cmd:'load',item:{itemId:'vt',path:join(root,'scratch/qc-native-browser-ZL8L4z/Acervo QA Çãó/VT — ação Çãó.mkv'),trimIn:0,trimOut:2250,gainDb:0}})
  await send({cmd:'take'});await wait(()=>events.some(row=>row.event==='state'&&row.onAir==='vt'))
  let missingSource=`omt:NONEXISTENT (${process.pid})`
  if(process.argv.includes('--announced')){
    const name=`RPlayout missing diagnostic ${process.pid}`
    sender=spawn(join(root,'apps/engine/target/release/rplayout-engine.exe'),['--channel-id','omt-departing-'+process.pid,'--width','640','--height','360','--fps-num','25','--fps-den','1','--output','omt:'+name],{cwd:directory,env,windowsHide:true,stdio:['pipe','pipe','pipe']})
    let pending='';const decode=new StringDecoder('utf8')
    sender.stdout!.on('data',chunk=>{pending+=decode.write(chunk);let at;while((at=pending.indexOf('\n'))>=0){const line=pending.slice(0,at);pending=pending.slice(at+1);try{const row=JSON.parse(line);senderEvents.push(row);if(row.event==='ack')senderAcks.set(row.id,row)}catch{senderLog+=line}}})
    sender.stderr!.on('data',chunk=>senderLog+=String(chunk))
    await wait(()=>senderEvents.some(row=>row.event==='ready'))
    for(const [id,command]of [[1,{cmd:'load',item:{itemId:'carrier',path:join(root,'scratch/qc-native-browser-ZL8L4z/Acervo QA Çãó/VT — ação Çãó.mkv'),trimIn:0,trimOut:2250,gainDb:0}}],[2,{cmd:'take'}]] as const){sender.stdin!.write(JSON.stringify({id,...command})+'\n');await wait(()=>senderAcks.has(id));assert.equal(senderAcks.get(id).ok,true)}
    await wait(()=>senderEvents.some(row=>row.event==='state'&&row.onAir==='carrier'))
    missingSource=`omt:${hostname()} (${name})`
    // Prove actual delivery before stopping this sender, not just its ACK.
    await send({cmd:'load',item:{itemId:'missing',source:missingSource,trimIn:0,trimOut:25000,gainDb:0}})
    await wait(()=>senderEvents.some(row=>row.event==='publisher'&&row.delivered>0))
    await new Promise(done=>setTimeout(done,3000))
    const ended=new Promise(done=>sender!.once('close',done));sender.stdin!.write(JSON.stringify({id:900,cmd:'shutdown'})+'\n');await ended
    assert.equal(sender.exitCode,0)
    await new Promise(done=>setTimeout(done,3000))
  }
  if(!process.argv.includes('--announced'))await send({cmd:'load',item:{itemId:'missing',source:missingSource,trimIn:0,trimOut:25000,gainDb:0}})
  await send({cmd:'take'})
  const until=performance.now()+13000
  while(performance.now()<until){assert.ok(!events.some(row=>row.event==='state'&&row.onAir==='missing'));await new Promise(done=>setTimeout(done,50))}
  assert.ok(events.some(row=>row.event==='itemError'&&/10 segundos/.test(row.message)))
}catch(error){failure=error;throw error}
finally{
  if(sender&&sender.exitCode===null){const ended=new Promise(done=>sender!.once('close',done));sender.kill();await ended}
  if(child.exitCode===null){const ended=new Promise(done=>child.once('close',done));child.stdin.write(JSON.stringify({id:900,cmd:'shutdown'})+'\n');const timer=setTimeout(()=>child.kill(),6000);await ended;clearTimeout(timer)}
  await writeFile(join(directory,'result.json'),JSON.stringify({result:failure?'FAIL':'PASS',error:failure?String(failure):null,engineSha256,commands,events,log,senderEvents,senderLog,senderExitCode:sender?.exitCode,exitCode:child.exitCode},null,2));console.log(JSON.stringify({directory,result:failure?'FAIL':'PASS'}))
}
