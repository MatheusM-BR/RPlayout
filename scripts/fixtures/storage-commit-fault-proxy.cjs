// QA-only proxy. The REAL unmodified SQLite service owns the file/commit.
// Withhold one real autocommit ACK, then kill ONLY our direct ChildProcess
// handle. No synthesized success, operational diary, checkpoint or PID kill.
const assert=require('node:assert/strict')
const {fork}=require('node:child_process')
const {writeFile}=require('node:fs/promises')
const {resolve,join}=require('node:path')
const root=resolve(process.env.RPLAYOUT_QA_STORAGE_FAULT_ROOT||'')
const real=resolve(process.env.RPLAYOUT_QA_STORAGE_REAL_SERVICE||'')
assert.ok(process.send&&process.env.RPLAYOUT_STORAGE_FILE)
assert.ok(root.startsWith(resolve(__dirname,'..')+'\\'))
assert.equal(root,resolve(__dirname));assert.ok(real.endsWith('\\storage-service.cjs'))
const child=fork(real,[],{execPath:process.execPath,execArgv:[],serialization:'advanced',stdio:['ignore','ignore','ignore','ipc'],env:process.env})
const marker={version:1,stage:'PROXY_CREATED',proxyPid:process.pid,actualServicePid:child.pid,targetRequests:0,replyForwarded:false}
let writes=Promise.resolve(),targetId=null,faulting=false
const save=()=>{const bytes=JSON.stringify(marker,null,2);writes=writes.then(()=>writeFile(join(root,'fault-marker.json'),bytes));return writes}
const initial=save()
const stopOwn=()=>{if(child.exitCode===null&&child.signalCode===null){marker.killRequested=true;child.kill('SIGKILL')}}
process.on('disconnect',()=>{if(!faulting)stopOwn()})
child.on('error',error=>{marker.stage='CHILD_ERROR';marker.error=String(error);void save().finally(()=>{if(process.connected)process.disconnect()})})
child.on('exit',(code,signal)=>{
  marker.stage=faulting?'CHILD_EXIT_AFTER_WITHHELD_ACK':'CHILD_EXIT_WITHOUT_FAULT'
  marker.exit={code,signal}
  void save().finally(()=>{if(process.connected)process.disconnect()})
})
process.on('message',request=>{void (async()=>{
  await initial
  if(request.op==='run'&&request.sql==='UPDATE fixture_effect SET value=value+1 WHERE id=?'&&request.args?.[0]==='qa-once'){
    assert.equal(targetId,null);targetId=request.id;marker.targetRequests++
  }
  assert.ok(child.connected);child.send(request,error=>{if(error)stopOwn()})
})().catch(error=>{marker.error=String(error);stopOwn()})})
child.on('message',reply=>{void (async()=>{
  if(reply.id===targetId){
    assert.equal(faulting,false);assert.equal(reply.ok,true);assert.equal(reply.inTransaction,false);assert.equal(reply.value.changes,1)
    faulting=true;marker.stage='REAL_AUTOCOMMIT_ACK_WITHHELD';marker.actualAck=reply
    await save();stopOwn();return
  }
  if(process.connected)process.send(reply,error=>{if(error)stopOwn()})
})().catch(error=>{marker.error=String(error);stopOwn()})})
