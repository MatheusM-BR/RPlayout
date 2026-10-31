import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {createServer} from 'node:net'
import {mkdtemp,writeFile,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {createHash} from 'node:crypto'

// Actual compiled IPC client + actual native broker, private fixtures only.
// Not compiled application bootstrap, MediaMTX, PGM, hardware or HA validation.
assert.equal(process.platform,'win32')
const root=fileURLToPath(new URL('..',import.meta.url)),binary=join(root,'apps/engine/target/release/rplayout-host-guard.exe'),client=join(root,'scratch/exec03-host-fence-client.mjs'),directory=await mkdtemp(join(tmpdir(),'RPlayout-host-client-')),fixture=join(directory,'fixture.mjs'),stations=[],guards=new Set(),ownChildren=new Set(),listener=createServer()
await writeFile(fixture,`
import {HostDistributionFence} from ${JSON.stringify(pathToFileURL(client).href)};
import {spawn} from 'node:child_process';
const guard=new HostDistributionFence(process.argv[2],5000);
let media=null,identity=null;
process.on('message',async message=>{if(message.action==='close'){guard.close();process.send({event:'closed',status:guard.status()})}else if(message.action==='retire-child'){const exited=new Promise(done=>media.once('exit',done));media.kill('SIGKILL');await exited;let rejected=false;try{await guard.processBindings(identity)}catch{rejected=true}process.send({event:'retired',rejected,childPid:media.pid,status:guard.status()})}});
const acquired=await guard.acquire();
if(acquired){await guard.freshProof();media=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});identity=await guard.pinProcess(media.pid,'native-client-child');await guard.processBindings(identity);const bindings=await guard.socketBindings();let portsRejected=false;try{await guard.assertPortsAvailable(identity)}catch{portsRejected=true}const mediaReady=await guard.mediaReady({pid:Number(process.argv[3]),token:'unbound-foreign'});process.send({event:'ready',pid:process.pid,guardPid:guard.child.pid,childPid:media.pid,status:guard.status(),bindings,portsRejected,mediaReady});}else{process.send({event:'blocked',pid:process.pid,status:guard.status()});guard.close()}
setInterval(()=>{},1000);
`,{flag:'wx'})
const alive=pid=>{try{process.kill(pid,0);return true}catch(error){if(error.code==='ESRCH')return false;throw error}}
async function wait(message,predicate,timeout=15000){const end=performance.now()+timeout;while(performance.now()<end){if(predicate())return;await new Promise(done=>setTimeout(done,50))}throw new Error(message+'; '+stations.map(station=>station.logs.slice(-1000)).join('\n'))}
async function station(){
 const cwd=await mkdtemp(join(directory,'installation-')),child=spawn(process.execPath,[fixture,binary,String(process.pid)],{cwd,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']}),value={child,cwd,events:[],logs:''};stations.push(value)
 child.on('message',event=>{assert.equal(event.pid??child.pid,child.pid);value.events.push(event);if(event.event==='ready'){guards.add(event.guardPid);ownChildren.add(event.childPid)}});for(const stream of[child.stdout,child.stderr])stream.on('data',data=>value.logs=(value.logs+String(data)).slice(-4000));child.on('error',error=>value.logs+=error.message)
 await wait('Compiled client fixture did not answer',()=>value.events.some(event=>['ready','blocked'].includes(event.event))||child.exitCode!==null||child.signalCode!==null);return value
}
async function stop(value){const child=value.child;if(child.exitCode===null&&child.signalCode===null){const exited=new Promise(done=>child.once('exit',done));child.kill('SIGKILL');await exited}}
let evidence=null
try{
 await new Promise((done,reject)=>{listener.once('error',reject);listener.listen(9997,'127.0.0.1',done)})
 const a=await station(),first=a.events.find(event=>event.event==='ready');assert.ok(first,a.logs);assert.equal(first.portsRejected,true);assert.equal(first.mediaReady,false);assert.ok(first.bindings.some(row=>row.protocol==='TCP'&&row.port===9997&&row.pid===process.pid&&row.included===false));assert.equal(first.status.ownedHere,true)
 for(const secret of[String(a.child.pid),String(first.guardPid),'nonce','processPids'])assert.ok(!JSON.stringify(first.status).includes(secret))
 const b=await station();assert.ok(b.events.some(event=>event.event==='blocked'));assert.equal(b.events[0].status.ownedHere,false);await stop(b)
 a.child.send({action:'retire-child'});await wait('Exact native child death not tested',()=>a.events.some(event=>event.event==='retired'));assert.equal(a.events.find(event=>event.event==='retired').rejected,true);assert.equal(a.events.find(event=>event.event==='retired').status.ownedHere,true);assert.ok(!alive(first.childPid))
 a.child.send({action:'close'});await wait('Compiled client close not confirmed',()=>a.events.some(event=>event.event==='closed'));assert.equal(a.events.find(event=>event.event==='closed').status.ownedHere,false);assert.ok(alive(first.guardPid),'Client close must not kill/release broker while parent still alive')
 const c=await station();assert.ok(c.events.some(event=>event.event==='blocked'));await stop(c)
 await stop(a);await wait('Own parent/broker did not drain',()=>!alive(a.child.pid)&&!alive(first.guardPid))
 const d=await station(),next=d.events.find(event=>event.event==='ready');assert.ok(next,d.logs);assert.equal(next.portsRejected,true);assert.equal(next.mediaReady,false)
 d.child.send({action:'retire-child'});await wait('Successor native child death not tested',()=>d.events.some(event=>event.event==='retired'));assert.equal(d.events.find(event=>event.event==='retired').rejected,true)
 d.child.send({action:'close'});await wait('Successor client close not confirmed',()=>d.events.some(event=>event.event==='closed'));await stop(d);await wait('Successor broker did not drain',()=>!alive(next.guardPid))
 evidence={result:'PASS',evidence:'COMPILED_IPC_CLIENT_REAL_WINDOWS_BROKER',directory,parentPids:stations.map(value=>value.child.pid),guardPids:[...guards],childPids:[...ownChildren],compiledClientSha256:createHash('sha256').update(await readFile(client)).digest('hex'),nativeGuardSha256:createHash('sha256').update(await readFile(binary)).digest('hex'),actualParentAndFamilyProof:true,exactChildIncarnationPinned:true,terminatedHandleNotReplacedByPid:true,foreignApiPidObserved:true,foreignApiNotMediaReady:true,foreignPortsRefuseConfiguration:true,peerRefused:true,privateStatusWithoutProcessIds:true,clientCloseDoesNotReleaseLiveParent:true,successorOnlyAfterActualExit:true,backendBootstrapValidated:false,mediaMtxValidated:false,physicalOutputValidated:false,otherHostValidated:false,promotionReady:false}
}finally{
 for(const value of stations)await stop(value)
 for(const pid of ownChildren)if(alive(pid))process.kill(pid,'SIGKILL')
 try{await wait('Own client brokers did not drain',()=>[...guards].every(pid=>!alive(pid)),10000)}finally{if(listener.listening)await new Promise(done=>listener.close(done))}
 console.log(JSON.stringify({cleanup:'OWN_CLIENTS_BROKERS_LISTENER_CLOSED',directory,parentPids:stations.map(value=>value.child.pid),guardPids:[...guards],childPids:[...ownChildren]}))
}
if(evidence){evidence={...evidence,ownChildrenAndListenerClosed:true};if(process.argv[2])await writeFile(resolve(process.argv[2]),JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(evidence))}
