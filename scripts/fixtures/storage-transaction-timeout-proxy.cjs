// QA ONLY. Hold a REAL reply inside an uncommitted transaction. No shortened
// deadline or synthesized success. The product adapter must time out itself.
const assert=require('node:assert/strict')
const {fork}=require('node:child_process')
const {writeFile}=require('node:fs/promises')
const {resolve,join}=require('node:path')
const root=resolve(process.env.RPLAYOUT_QA_STORAGE_FAULT_ROOT||'')
const real=resolve(process.env.RPLAYOUT_QA_STORAGE_REAL_SERVICE||'')
assert.ok(process.send&&process.env.RPLAYOUT_STORAGE_FILE)
assert.equal(root,resolve(__dirname));assert.ok(real.endsWith('\\storage-service.cjs'))
const child=fork(real,[],{execPath:process.execPath,execArgv:[],serialization:'advanced',stdio:['ignore','ignore','ignore','ipc'],env:process.env})
const marker={version:1,stage:'PROXY_CREATED',proxyPid:process.pid,actualServicePid:child.pid,targetRequests:0,replyForwarded:false,parentDisconnected:false,commitRequests:0}
let writes=Promise.resolve(),targetId=null
const save=()=>{const bytes=JSON.stringify(marker,null,2);writes=writes.then(()=>writeFile(join(root,'timeout-marker.json'),bytes));return writes}
const initial=save()
const stopOwn=()=>{if(child.exitCode===null&&child.signalCode===null){marker.killRequested=true;child.kill('SIGKILL')}}
process.on('disconnect',()=>{marker.parentDisconnected=true;marker.stage='PARENT_IPC_DISCONNECTED';void save().finally(stopOwn)})
child.on('error',error=>{marker.error=String(error);marker.stage='CHILD_ERROR';void save().finally(()=>{if(process.connected)process.disconnect()})})
child.on('exit',(code,signal)=>{
  marker.stage=marker.parentDisconnected?'CHILD_EXIT_AFTER_PARENT_DISCONNECT':'CHILD_EXIT_UNEXPECTED'
  marker.exit={code,signal};void save().finally(()=>{if(process.connected)process.disconnect()})
})
process.on('message',request=>{void(async()=>{
  await initial
  if(request.op==='exec'&&/^\s*(COMMIT|END)\b/i.test(request.sql||''))marker.commitRequests++
  if(request.op==='run'&&request.sql==='UPDATE fixture_pending SET value=value+1 WHERE id=?'&&request.args?.[0]==='qa-pending'){
    assert.equal(targetId,null);targetId=request.id;marker.targetRequests++
  }
  assert.ok(child.connected);child.send(request,error=>{if(error){marker.error=String(error);stopOwn()}})
})().catch(error=>{marker.error=String(error);stopOwn()})})
child.on('message',reply=>{void(async()=>{
  if(reply.id===targetId){
    assert.equal(reply.ok,true);assert.equal(reply.inTransaction,true);assert.equal(reply.value.changes,1)
    marker.stage='REAL_UNCOMMITTED_ACK_HELD';marker.actualAck=reply
    await save();return // No timer/kill here: wait for the real adapter timeout.
  }
  if(process.connected)process.send(reply,error=>{if(error)stopOwn()})
})().catch(error=>{marker.error=String(error);stopOwn()})})
