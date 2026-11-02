import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {createHmac,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto'
import {mkdtemp,access} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve,join} from 'node:path'
import {createServer} from 'node:net'
import {createInterface} from 'node:readline'

// A portability gate, not a physical failover certificate. Runs the packaged
// witness and native engines with the invoking (bundled) Node and null output.
const root=resolve(process.argv[2]??'.'),node=join(root,'runtime/node/node.exe')
assert.equal(resolve(process.execPath).toLowerCase(),node.toLowerCase(),'Use o Node do pacote, não Node/tsx global.')
const entry=join(root,'apps/server/dist/ha-witness.cjs'),engineExe=join(root,'apps/engine/target/release/rplayout-engine.exe')
await Promise.all([entry,engineExe,join(root,'start-rplayout-witness.ps1')].map(file=>access(file)))
const directory=await mkdtemp(join(tmpdir(),'RPlayout-package-witness-')),key=randomBytes(32),owners=[]
const cleanEnv=Object.fromEntries(Object.entries(process.env).filter(([name])=>!name.startsWith('RPLAYOUT_')))
const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve))
const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve))
const url=`http://127.0.0.1:${port}`,database=join(directory,'witness.db')
const mac=(data,context)=>{
  const derived=createHmac('sha256',key).update('rplayout:review-key:v1').digest()
  try{return createHmac('sha256',derived).update(context).update('\0').update(data).digest('base64url')}
  finally{derived.fill(0)}
}
const canonical=request=>JSON.stringify([request.version,request.purpose,request.clusterId,request.channelId,request.nodeId,request.ownerId,request.nonce,request.requestTime])
let witness=null
async function wait(message,predicate,timeout=20000){
  const deadline=performance.now()+timeout
  while(performance.now()<deadline){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,50))}
  throw new Error(message)
}
async function stop(child){
  if(!child||child.exitCode!==null||child.signalCode!==null)return
  const ended=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL')
  await Promise.race([ended,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('Processo próprio não encerrou.')),10000);timer.unref()})])
}
async function health(){try{const result=await fetch(url+'/health',{signal:AbortSignal.timeout(1000)});return result.ok?await result.json():null}catch{return null}}
async function startWitness(){
  witness=spawn(node,[entry],{cwd:directory,windowsHide:true,stdio:['ignore','ignore','pipe'],env:{...cleanEnv,
    RPLAYOUT_WITNESS_DB:database,RPLAYOUT_WITNESS_CLUSTER:'portable',RPLAYOUT_WITNESS_NODES:'a,b',
    RPLAYOUT_WITNESS_KEY:key.toString('hex'),RPLAYOUT_WITNESS_HOST:'127.0.0.1',RPLAYOUT_WITNESS_PORT:String(port)}})
  witness.stderr.on('data',()=>{})
  await wait('Testemunha portátil não iniciou.',async()=>{assert.equal(witness.exitCode,null,'Testemunha encerrou antes da saúde.');return Boolean((await health())?.ok)})
}
async function grant(nodeId,ownerId,nonce){
  const request={version:1,purpose:'LEASE',clusterId:'portable',channelId:'portable-channel',nodeId,ownerId,nonce,requestTime:Date.now()}
  const response=await fetch(url+'/lease',{method:'POST',redirect:'error',signal:AbortSignal.timeout(1500),headers:{'content-type':'application/json'},
    body:JSON.stringify({request,signature:mac(canonical(request),'ha-witness-request:v1')})})
  if(!response.ok)return null
  const value=await response.json(),{signature,...receipt}=value
  assert.deepEqual(receipt,{...request,term:value.term,ttlMs:5000})
  assert.ok(Number.isSafeInteger(value.term)&&value.term>0)
  const expected=Buffer.from(mac(canonical(receipt)+'\0'+receipt.term+'\0'+receipt.ttlMs,'ha-witness-grant:v1')),actual=Buffer.from(signature)
  assert.ok(actual.length===expected.length&&timingSafeEqual(actual,expected),'Concessão do pacote não autenticada.')
  return {term:value.term,ttlMs:5000}
}
class Native {
  owner=randomUUID();ready=false;term=0;renew=true;endedAt=0;readyAt=0;nextId=1;failure=null
  constructor(nodeId){
    this.child=spawn(engineExe,['--channel-id','portable-channel','--width','320','--height','180','--fps-num','25','--fps-den','1','--private-outputs-stdin'],
      {cwd:directory,windowsHide:true,stdio:['pipe','pipe','pipe'],env:cleanEnv})
    owners.push(this);this.child.on('error',error=>{this.failure=error});this.child.on('exit',()=>{this.endedAt=performance.now()})
    this.child.stdin.on('error',()=>{});this.child.stderr.on('data',()=>{})
    this.lines=createInterface({input:this.child.stdout})
    this.lines.on('line',line=>{
      let event;try{event=JSON.parse(line)}catch{return}
      if(event.event==='ready'){this.ready=true;this.readyAt=performance.now()}
      if(event.event==='fenceApplied')this.term=event.term
      if(event.event==='fenceRequest'&&this.renew&&event.ownerId===this.owner){
        void grant(nodeId,this.owner,event.nonce).then(value=>{
          if(value&&this.renew&&this.child.exitCode===null&&this.child.signalCode===null){
            this.child.stdin.write(JSON.stringify({id:this.nextId++,cmd:'fenceGrant',ownerId:this.owner,nonce:event.nonce,...value})+'\n')
          }
        }).catch(()=>{})
      }
    })
    this.child.stdin.write(JSON.stringify({outputs:['null'],preview:null,fenceOwner:this.owner})+'\n')
  }
}
try{
  await startWitness();assert.equal((await health()).quarantined,true)
  await wait('Quarentena inicial não terminou.',async()=>{const value=await health();return Boolean(value?.ok&&!value.quarantined)})
  const a=new Native('a');await wait('Engine portátil não confirmou concessão/Ready.',()=>a.ready)
  assert.ok(a.term>0)
  const b=new Native('b');await new Promise(resolve=>setTimeout(resolve,1200))
  assert.equal(b.ready,false,'Segundo dono publicou durante posse do primeiro.');assert.equal(a.child.exitCode,null)
  a.renew=false;a.child.stdout.pause()
  await wait('Watchdog portátil não encerrou sem renovação.',()=>a.child.exitCode===75,7000)
  await wait('Segundo dono não obteve posse depois da expiração.',()=>b.ready,7000)
  assert.ok(b.readyAt>a.endedAt);assert.ok(b.term>a.term)
  await stop(witness);await wait('Perda da testemunha não expirou engine.',()=>b.child.exitCode===75,7000)
  await startWitness();assert.equal((await health()).quarantined,true)
  const c=new Native('a');await new Promise(resolve=>setTimeout(resolve,1500));assert.equal(c.ready,false)
  await wait('Reinício não preservou concessão/quarentena.',()=>c.ready,15000);assert.ok(c.term>b.term)
  console.log(JSON.stringify({result:'PASS',evidence:'PORTABLE_NODE_SQLITE_WITNESS_NATIVE_LEASE_EXPIRY',directory,port,
    nativeLeaseRequired:true,exclusiveOwners:true,nativeExpiryCode:75,restartTerm:c.term,
    physicalOutputValidated:false,takeoverWorkflowValidated:false,physicalHostsValidated:false}))
}finally{
  for(const value of owners){value.renew=false;value.child.stdout.resume();await stop(value.child);value.lines.close()}
  await stop(witness);key.fill(0)
}
