import assert from 'node:assert/strict'
import {spawn,execFile,type ChildProcess} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {randomBytes,randomUUID} from 'node:crypto'
import {createServer} from 'node:net'
import {createInterface} from 'node:readline'
import {HaLeaseClient} from '../apps/server/src/domain/ha-witness.js'
import {mediaProcessEnvironment} from '../apps/server/src/domain/media-process-environment.js'

// Real standalone compiled witness and gated native engines, loopback/null.
// No promotion/import, actual second host, SDI/NDI/OMT receiver or external fence.
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(tmpdir(),'RPlayout-ha-fencing-'))
const key=randomBytes(32).toString('hex'),engines:Array<Native>=[],clients=new Set<HaLeaseClient>()
const reservation=createServer();await new Promise<void>(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=(reservation.address() as {port:number}).port
await new Promise<void>(resolve=>reservation.close(()=>resolve()))
const url=`http://127.0.0.1:${port}`,gstRoot=process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64??'C:/Program Files/gstreamer/1.0/msvc_x86_64'
const gstBin=join(gstRoot,'bin'),environment={...process.env,PATH:gstBin+';'+process.env.PATH,GST_PLUGIN_PATH:join(gstRoot,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gstRoot,'lib/gstreamer-1.0'),GST_PLUGIN_SCANNER:join(gstRoot,'libexec/gstreamer-1.0/gst-plugin-scanner.exe'),GST_REGISTRY:join(directory,'registry.bin')}
const file=join(directory,'Cerca-ÇÃO.mp4')
await promisify(execFile)(join(gstBin,'gst-launch-1.0.exe'),['-q','videotestsrc','num-buffers=1800','!','video/x-raw,width=320,height=180,framerate=25/1','!','videoconvert','!','x264enc','speed-preset=ultrafast','!','h264parse','!','mp4mux','!','filesink',`location=${file.replaceAll('\\','/')}`],{timeout:60_000,windowsHide:true,env:environment})
let witness:ChildProcess|null=null,witnessLogs=''
const alive=(pid:number)=>{try{process.kill(pid,0);return true}catch{return false}}
async function wait(message:string,predicate:()=>boolean|Promise<boolean>,timeout=20_000){const end=performance.now()+timeout;while(performance.now()<end){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,50))}throw new Error(message+'; '+witnessLogs.slice(-1000)+'; '+engines.map(engine=>engine.logs.slice(-600)).join('\n'))}
async function stop(child:ChildProcess|null){if(child?.pid&&alive(child.pid)){child.kill('SIGKILL');await wait('Processo próprio não encerrou',()=>!alive(child.pid!),10_000)}}
async function startWitness(){
  witnessLogs='';witness=spawn(process.execPath,[join(root,'apps/server/dist/ha-witness.cjs')],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...mediaProcessEnvironment(environment),RPLAYOUT_WITNESS_DB:join(directory,'witness.db'),RPLAYOUT_WITNESS_CLUSTER:'fixture',RPLAYOUT_WITNESS_NODES:'a,b',RPLAYOUT_WITNESS_KEY:key,RPLAYOUT_WITNESS_PORT:String(port)}})
  for(const stream of [witness.stdout,witness.stderr])stream?.on('data',chunk=>{witnessLogs=(witnessLogs+String(chunk)).slice(-2000)})
  await wait('Testemunha compilada não iniciou',async()=>{try{return(await(await fetch(url+'/health',{signal:AbortSignal.timeout(1000)})).json() as any).ok}catch{return false}})
}
class Native {
  readonly process:ChildProcess
  readonly owner=randomUUID()
  readonly client:HaLeaseClient
  ready=false;readyAt=0;endedAt=0;renew=true;logs='';frames=0;position=0;onAir:string|null=null;armed:string|null=null;term=0;delayedRejected=false
  private nextId=1
  private delayed=false
  constructor(readonly node:'a'|'b',readonly channelId='channel',readonly delayGrant=false){
    this.client=new HaLeaseClient(url,key,'fixture',node);clients.add(this.client)
    this.process=spawn(join(root,'apps/engine/target/release/rplayout-engine.exe'),['--channel-id',channelId,'--width','320','--height','180','--fps-num','25','--fps-den','1','--bitrate','450','--private-outputs-stdin'],{cwd:directory,windowsHide:true,stdio:['pipe','pipe','pipe'],env:mediaProcessEnvironment(environment)})
    engines.push(this);this.process.on('exit',()=>{this.endedAt=performance.now()});this.process.stdin?.on('error',()=>{})
    this.process.stderr?.on('data',chunk=>{this.logs=(this.logs+String(chunk)).slice(-3000)})
    createInterface({input:this.process.stdout!}).on('line',line=>{
      let event:any;try{event=JSON.parse(line)}catch{return}
      if(event.event==='ready'){this.ready=true;this.readyAt=performance.now()}
      if(event.event==='fenceApplied')this.term=event.term
      if(event.event==='output')this.frames=event.frames
      if(event.event==='position')this.position=event.frames
      if(event.event==='state'){this.onAir=event.onAir??null;this.armed=event.armed??null}
      if(event.event==='ack'&&!event.ok&&event.error?.includes('atrasada'))this.delayedRejected=true
      if(event.event==='fenceRequest'&&this.renew&&event.ownerId===this.owner){
        if(this.delayGrant&&this.delayed)return;this.delayed=true
        void this.client.obtain(channelId,this.owner,event.nonce).then(async grant=>{
          if(this.delayGrant)await new Promise(resolve=>setTimeout(resolve,4300))
          if(this.renew&&this.process.exitCode===null&&this.process.signalCode===null)this.send({cmd:'fenceGrant',ownerId:this.owner,nonce:event.nonce,...grant})
        }).catch(()=>{})
      }
    })
    this.process.stdin!.write(JSON.stringify({outputs:['null'],preview:null,fenceOwner:this.owner})+'\n')
  }
  send(value:object){this.process.stdin?.write(JSON.stringify({id:this.nextId++,...value})+'\n')}
  async play(){this.send({cmd:'load',item:{itemId:'vt',path:file,trimIn:0,trimOut:1800,gainDb:0}});await wait('Preroll não armou',()=>this.armed==='vt');this.send({cmd:'take'});await wait('VT nativo não entrou no PGM',()=>this.onAir==='vt'&&this.position>25)}
}
try{
  await startWitness();await wait('Quarentena inicial não terminou',async()=>!(await(await fetch(url+'/health')).json() as any).quarantined)
  const a=new Native('a');await wait('Engine A não obteve concessão',()=>a.ready);await a.play()
  const b=new Native('b');await new Promise(resolve=>setTimeout(resolve,1800));assert.equal(b.ready,false);assert.equal(b.frames,0);assert.equal(a.onAir,'vt')
  a.renew=false;a.process.stdout!.pause()
  await wait('Watchdog nativo dependeu de stdout/renovação do controle',()=>a.process.exitCode===75,7000)
  await wait('Engine B não recebeu próximo termo depois da expiração',()=>b.ready,7000);assert.ok(b.readyAt>a.endedAt);assert.ok(b.term>a.term);await b.play()
  await stop(witness);await wait('Engine B não expirou depois de perder a testemunha',()=>b.process.exitCode===75,7000)
  await startWitness();const c=new Native('a');await new Promise(resolve=>setTimeout(resolve,3000));assert.equal(c.ready,false)
  await wait('Novo engine não voltou após quarentena',()=>c.ready,15000);assert.ok(c.term>b.term);await c.play()
  const late=new Native('b','late',true);await wait('Concessão atrasada foi aceita ou não foi recusada',()=>late.delayedRejected,8000);assert.equal(late.ready,false);assert.equal(late.frames,0)
  console.log(JSON.stringify({result:'PASS',directory,port,evidence:'COMPILED_WITNESS_NATIVE_EXCLUSIVE_LEASE_EXPIRY_AND_RESTART_QUARANTINE',nativeProgram:true,firstTerm:a.term,secondTerm:b.term,restartTerm:c.term,simultaneousOwnersRefused:true,renewalsAndStdoutStopped:true,nativeExitCodeOnExpiry:75,expiredEngineCannotRevive:true,delayedGrantDoesNotResetDeadline:true,witnessRestartQuarantined:true,physicalOutputValidated:false,physicalHostsValidated:false,promotionWorkflowValidated:false}))
}finally{for(const client of clients)client.close();for(const engine of engines){engine.renew=false;engine.process.stdout?.resume();await stop(engine.process)}await stop(witness)}
