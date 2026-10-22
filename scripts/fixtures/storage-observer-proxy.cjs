// QA ownership observer only. Forward real IPC unchanged; no synthetic ACK,
// SQL mutation, PID termination or failure injection in this proxy.
const assert=require('node:assert/strict')
const {fork}=require('node:child_process')
const {writeFile}=require('node:fs/promises')
const {resolve,join}=require('node:path')
const root=resolve(process.env.RPLAYOUT_QA_STORAGE_OBSERVER_ROOT||'')
const real=resolve(process.env.RPLAYOUT_QA_STORAGE_REAL_SERVICE||'')
assert.ok(process.send&&process.env.RPLAYOUT_STORAGE_FILE);assert.equal(root,resolve(__dirname));assert.ok(real.endsWith('\\storage-service.cjs'))
const child=fork(real,[],{execPath:process.execPath,execArgv:[],serialization:'advanced',stdio:['ignore','ignore','ignore','ipc'],env:process.env})
const marker={stage:'STARTED',proxyPid:process.pid,actualServicePid:child.pid,requests:0,parentDisconnected:false}
const initial=writeFile(join(root,'observer-marker.json'),JSON.stringify(marker,null,2))
process.on('message',request=>{void initial.then(()=>{marker.requests++;if(child.connected)child.send(request,()=>{})}).catch(()=>{if(child.connected)child.disconnect()})})
child.on('message',reply=>{if(process.connected)process.send(reply,()=>{})})
process.on('disconnect',()=>{marker.parentDisconnected=true;if(child.connected)child.disconnect()})
child.on('exit',(code,signal)=>{
  marker.stage='EXITED';marker.exit={code,signal}
  void writeFile(join(root,'observer-marker.json'),JSON.stringify(marker,null,2)).finally(()=>{if(process.connected)process.disconnect()})
})
child.on('error',error=>{marker.error=String(error);if(process.connected)process.disconnect()})
