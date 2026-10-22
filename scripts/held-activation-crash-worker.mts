import {activateRestoredApp} from '../apps/server/src/domain/activate-restored-app.js'
import {EngineTransport} from '../apps/server/src/domain/engine.js'
import {HostDistributionFence} from '../apps/server/src/domain/host-distribution-fence.js'
import {ExecutionLease} from '../apps/server/src/domain/execution-ownership.js'
let guardPid:number|undefined
const acquire=HostDistributionFence.prototype.acquire
HostDistributionFence.prototype.acquire=async function(){const owned=await acquire.call(this);if(owned)guardPid=(this as unknown as {child:import('node:child_process').ChildProcess}).child.pid;return owned}
const [file,manifest]=process.argv.slice(2)
if(!file||!manifest)throw new Error('Own restored database and manifest required')
if(process.argv.includes('--before-spawn')){
 const reserve=ExecutionLease.prototype.beforeSpawn
 ExecutionLease.prototype.beforeSpawn=function(token){reserve.call(this,token);console.log(JSON.stringify({stage:'SPAWN_RESERVED',pid:process.pid,guardPid}));Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,15000);throw new Error('Own spawn fixture timed out')}
}
const release=EngineTransport.prototype.releaseProgramOutputs
EngineTransport.prototype.releaseProgramOutputs=async function(authorize,paused){
 const proof=await release.call(this,authorize,paused)
 console.log(JSON.stringify({stage:'RELEASE_RECEIPT',pid:process.pid,enginePid:this.processId(),guardPid,proof}))
 // Parent kills this exact direct-spawned worker, never a guessed PID. The
 // bounded fallback throws and lets activation cleanup close its own resources.
 Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,15000)
 throw new Error('Own crash fixture timed out waiting for parent')
}
await activateRestoredApp(file,manifest)
