import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtemp,writeFile,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {createServer} from 'node:net'
import {createSocket} from 'node:dgram'

// Isolated process-family/kernel test. Only own loopback socket fixtures, no MediaMTX, engine, application
// data, other-host fencing, physical output or production promotion.
assert.equal(process.platform,'win32','This verifier requires Windows kernel jobs')
const root=fileURLToPath(new URL('..',import.meta.url)),binary=join(root,'apps/engine/target/release/rplayout-host-guard.exe'),directory=await mkdtemp(join(tmpdir(),'RPlayout-host-guard-'))
const fixture=join(directory,'fixture.mjs'),stations=[],ownedChildren=new Set(),ownedGuards=new Set()
const foreignTcp=createServer(),foreignUdp=createSocket('udp4')
const childProgram="const net=require('node:net'),udp=require('node:dgram');let bound=0;const ready=()=>{if(++bound===4)process.stdout.write(JSON.stringify({event:'bound',pid:process.pid})+'\\n')};const fail=error=>{process.stderr.write(error.message);process.exit(1)};for(const [port,host]of[[1935,'127.0.0.1'],[8888,'::1']]){const server=net.createServer();server.on('error',fail);server.listen(port,host,ready)}for(const[type,port,host]of[['udp4',8189,'127.0.0.1'],['udp6',8001,'::1']]){const socket=udp.createSocket(type);socket.on('error',fail);socket.bind(port,host,ready)}setInterval(()=>{},1000)"
// This generated file is a verifier artifact, not an application source edit.
await writeFile(fixture,`
import {spawn} from 'node:child_process';import {randomBytes} from 'node:crypto';import {createInterface} from 'node:readline';
const nonce=randomBytes(32).toString('hex'),guard=spawn(process.argv[2],[],{windowsHide:true,detached:true,stdio:['pipe','pipe','pipe'],env:{SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,PATH:process.env.SystemRoot+'\\\\System32'}});
let child=null;let ready=false;
const childProgram=${JSON.stringify(childProgram)};
guard.stderr.on('data',data=>process.stderr.write(data));guard.on('error',error=>process.send({event:'error',message:error.message}));
guard.on('exit',(code,signal)=>process.send?.({event:'guard_exit',code,signal}));
createInterface({input:guard.stdout}).on('line',line=>{const value=JSON.parse(line);if(value.nonce!==nonce)throw new Error('PRIVATE_BINDING_CHANGED');if(value.event==='ready'){ready=true;child=spawn(process.execPath,['-e',childProgram],{windowsHide:true,detached:true,stdio:['ignore','pipe','pipe']});child.stderr.on('data',data=>process.stderr.write(data));createInterface({input:child.stdout}).on('line',line=>{const event=JSON.parse(line);if(event.event==='bound'&&event.pid===child.pid)process.send({event:'child-bound',pid:child.pid})});child.on('error',error=>process.send({event:'error',message:error.message}));process.send({event:'ready',parentPid:process.pid,guardPid:guard.pid,childPid:child.pid,hostExclusive:value.hostExclusive,jobBound:value.jobBound});guard.stdin.write(JSON.stringify({version:1,nonce,action:'contains',request_id:'child-proof',pid:child.pid})+'\\n');}else if(value.event==='membership')process.send({event:'membership',included:value.included});else if(value.event==='blocked')process.send({event:'blocked'});else if(value.event==='asserted')process.send({event:'asserted',activeProcesses:value.activeProcesses,processPids:value.processPids});else if(value.event==='ports')process.send({event:'ports',bindings:value.bindings});else if(value.event==='refused')process.send({event:'refused',reason:value.reason});});
process.on('message',message=>{if(message.action==='assert')guard.stdin.write(JSON.stringify({version:1,nonce,action:'assert',request_id:'fresh-proof'})+'\\n');else if(message.action==='ports')guard.stdin.write(JSON.stringify({version:1,nonce,action:'ports',request_id:'ports-proof'})+'\\n');else if(message.action==='wrong-binding')guard.stdin.write(JSON.stringify({version:1,nonce:'f'.repeat(64),action:'assert',request_id:'wrong'})+'\\n');});
guard.stdin.write(JSON.stringify({version:1,nonce,action:'acquire'})+'\\n');setInterval(()=>{},1000);
`,{flag:'wx'})
const alive=pid=>{try{process.kill(pid,0);return true}catch(error){if(error.code==='ESRCH')return false;throw error}}
async function wait(message,predicate,timeout=15000){const end=performance.now()+timeout;while(performance.now()<end){if(await predicate())return;await new Promise(done=>setTimeout(done,50))}throw new Error(message+'; '+stations.map(station=>station.logs.slice(-1000)).join('\n'))}
async function station(){
 const cwd=await mkdtemp(join(directory,'db-')),child=spawn(process.execPath,[fixture,binary],{cwd,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']}),value={child,cwd,events:[],logs:''};stations.push(value)
 child.on('message',event=>{value.events.push(event);if(event.event==='ready'){assert.equal(event.parentPid,child.pid);assert.ok(event.guardPid);assert.ok(event.childPid);ownedChildren.add(event.childPid);ownedGuards.add(event.guardPid)}});for(const stream of[child.stdout,child.stderr])stream.on('data',data=>value.logs=(value.logs+String(data)).slice(-5000));child.on('error',error=>value.logs+=error.message)
 await wait('Own kernel fixture did not answer',()=>value.events.some(event=>['ready','blocked','error'].includes(event.event))||child.exitCode!==null||child.signalCode!==null)
 return value
}
async function stop(value){const child=value.child;if(child.exitCode===null&&child.signalCode===null){const exited=new Promise(done=>child.once('exit',done));child.kill('SIGKILL');await exited}}
let evidence=null
try{
 // Abort on occupied ports; never stop/replace a foreign listener. All binds
 // are loopback, with no network client, media publisher or firewall change.
 await new Promise((done,reject)=>{foreignTcp.once('error',reject);foreignTcp.listen(9997,'127.0.0.1',done)})
 await new Promise((done,reject)=>{foreignUdp.once('error',reject);foreignUdp.bind(8890,'127.0.0.1',done)})
 const a=await station(),first=a.events.find(event=>event.event==='ready');assert.ok(first,a.logs);assert.equal(first.hostExclusive,true);assert.equal(first.jobBound,true)
 await wait('Future child did not inherit job',()=>a.events.some(event=>event.event==='membership'));assert.equal(a.events.find(event=>event.event==='membership').included,true)
 await wait('Own socket fixture did not bind',()=>a.events.some(event=>event.event==='child-bound'))
 a.child.send({action:'ports'});await wait('Native socket table absent',()=>a.events.some(event=>event.event==='ports'));const bindings=a.events.find(event=>event.event==='ports').bindings
 for(const [protocol,port,family,pid,included]of[['TCP',9997,4,process.pid,false],['UDP',8890,4,process.pid,false],['TCP',1935,4,first.childPid,true],['TCP',8888,6,first.childPid,true],['UDP',8189,4,first.childPid,true],['UDP',8001,6,first.childPid,true]])assert.ok(bindings.some(value=>value.protocol===protocol&&value.port===port&&value.family===family&&value.pid===pid&&value.included===included),JSON.stringify({protocol,port,family,pid,included,bindings}))
 a.child.send({action:'assert'});await wait('Fresh parent proof absent',()=>a.events.some(event=>event.event==='asserted'));const asserted=a.events.find(event=>event.event==='asserted');assert.equal(asserted.activeProcesses,asserted.processPids.length);assert.ok(asserted.processPids.includes(first.parentPid));assert.ok(asserted.processPids.includes(first.childPid));assert.ok(!asserted.processPids.includes(first.guardPid))
 const b=await station();assert.ok(b.events.some(event=>event.event==='blocked'));assert.ok(!b.events.some(event=>event.event==='ready'));await stop(b)
 await stop(a);assert.ok(alive(first.childPid),'Fixture deliberately detached child must survive its killed parent');assert.ok(alive(first.guardPid),'Broker must retain fence after parent EOF')
 const c=await station();assert.ok(c.events.some(event=>event.event==='blocked'),'No TTL/parent death may bypass surviving child');await stop(c)
 // Only PIDs emitted by own fixture and proven members of its kernel job.
 process.kill(first.childPid,'SIGKILL');await wait('Own predecessor child/broker did not drain',()=>!alive(first.childPid)&&!alive(first.guardPid))
 const d=await station(),next=d.events.find(event=>event.event==='ready');assert.ok(next,d.logs);await wait('Successor child membership absent',()=>d.events.some(event=>event.event==='membership'));assert.equal(d.events.find(event=>event.event==='membership').included,true)
 // A broker crash must not leave its own parent/descendants unguarded. The
 // kernel closes ONLY this verifier's job; never TerminateJobObject on peers.
 process.kill(next.guardPid,'SIGKILL');await wait('Kernel did not retire own family after guard crash',()=>!alive(next.guardPid)&&!alive(next.parentPid)&&!alive(next.childPid))
 const e=await station(),last=e.events.find(event=>event.event==='ready');assert.ok(last,e.logs);await wait('Last child membership absent',()=>e.events.some(event=>event.event==='membership'))
 e.child.send({action:'wrong-binding'});await wait('Wrong private binding not refused',()=>e.events.some(event=>event.event==='refused'));assert.ok(alive(last.parentPid)&&alive(last.childPid)&&alive(last.guardPid),'Protocol refusal preserves admitted family/fence')
 const f=await station();assert.ok(f.events.some(event=>event.event==='blocked'));await stop(f);await stop(e);if(alive(last.childPid))process.kill(last.childPid,'SIGKILL');await wait('Refused family did not drain after actual shutdown',()=>!alive(last.parentPid)&&!alive(last.childPid)&&!alive(last.guardPid))
 evidence={result:'PASS',evidence:'REAL_WINDOWS_KERNEL_MUTEX_JOB_AND_SOCKET_IDENTITY',directory,parentPids:stations.map(value=>value.child.pid),guardPids:[...ownedGuards],childPids:[...ownedChildren],actualInitialFamily:asserted.processPids,bindings,binarySha256:createHash('sha256').update(await readFile(binary)).digest('hex'),namespaceIndependentOfDatabaseAndWorkingDirectory:true,parentDerivedByOperatingSystem:true,descendantsInheritJob:true,brokerOutsideOwnedFamily:true,peerRefused:true,parentDeathWithSurvivingChildRetainsFence:true,noTtlSteal:true,predecessorDrainedBeforeSuccessor:true,brokerDeathClosesOwnFamily:true,wrongPrivateBindingFailsClosed:true,protocolRefusalPreservesAdmittedFamily:true,backendIntegrationValidated:false,portsIdentityValidated:true,ipv4AndIpv6Tested:true,tcpAndUdpTested:true,foreignSocketsNotAdopted:true,physicalOutputValidated:false,otherHostValidated:false,promotionReady:false}
}finally{
 for(const value of stations)await stop(value)
 for(const pid of ownedChildren)if(alive(pid))process.kill(pid,'SIGKILL')
 try{await wait('Own brokers did not drain',()=>[...ownedGuards].every(pid=>!alive(pid)),10000)}finally{if(foreignTcp.listening)await new Promise(done=>foreignTcp.close(done));try{foreignUdp.close()}catch{}}
 assert.ok([...ownedChildren].every(pid=>!alive(pid)));console.log(JSON.stringify({cleanup:'OWN_FAMILIES_CLOSED',directory,parentPids:stations.map(value=>value.child.pid),guardPids:[...ownedGuards],childPids:[...ownedChildren]}))
}
if(evidence){evidence={...evidence,ownFamiliesClosed:true};if(process.argv[2])await writeFile(resolve(process.argv[2]),JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(evidence))}
