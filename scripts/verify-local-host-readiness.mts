import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {spawn} from 'node:child_process'
import {HostDistributionFence,HostNativeQueryError} from '../apps/server/src/domain/host-distribution-fence.js'

// A separate readiness diagnostic, not a retry of media publication. All native
// requests are ordinary production guard operations. No foreign process kill,
// privilege/policy adjustment, synthetic grant or network connection.
const root=fileURLToPath(new URL('..',import.meta.url)),binary=join(root,'apps/engine/target/release/rplayout-host-guard.exe')
const directory=await mkdtemp(join(root,'scratch','local-host-readiness-'))
const fence=new HostDistributionFence(binary)
let child:ReturnType<typeof spawn>|null=null,failed=false
const steps:Array<Record<string,unknown>>=[]
const step=async(name:string,work:()=>unknown|Promise<unknown>)=>{
  try{const value=await work();steps.push({name,result:'PASS',value});return true}
  catch(error){failed=true;steps.push({name,result:'FAIL',error:error instanceof Error?error.message:String(error),...(error instanceof HostNativeQueryError?{nativeQueryFailure:error.diagnostic}:{})});return false}
}
let childExit:{code:number|null;signal:NodeJS.Signals|null}|null=null
try{
  if(await step('acquire',async()=>assert.equal(await fence.acquire(),true))&&
    await step('fresh-proof',()=>fence.freshProof())&&
    await step('socket-snapshot',async()=>({bindings:(await fence.socketBindings()).length}))){
    child=spawn(process.execPath,['-e',"process.stdin.resume();process.stdin.on('end',()=>process.exit(0))"],{windowsHide:true,stdio:['pipe','ignore','ignore'],env:{SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR}})
    const handle=child
    const ended=new Promise<void>(resolve=>handle.once('exit',(code,signal)=>{childExit={code,signal};resolve()}))
    await step('pin-owned-child',async()=>{
      assert.ok(handle.pid)
      const identity=await fence.pinProcess(handle.pid,'readiness-own-child')
      await step('owned-child-socket-proof',async()=>({bindings:(await fence.processBindings(identity)).length}))
      await fence.releaseProcess(identity)
    })
    handle.stdin!.end()
    await Promise.race([ended,new Promise<void>(resolve=>setTimeout(resolve,3000))])
    if(!childExit){handle.kill('SIGKILL');await ended;failed=true}
  }
}finally{
  if(child&&child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL')
  const report={result:failed?'FAIL':'PASS',directory,scope:'Current host proof and socket/process readiness only, no media engine or publication',steps,hostStatus:fence.status(),ownChildPid:child?.pid??null,ownChildExit:childExit,helperSha256:createHash('sha256').update(await readFile(binary)).digest('hex'),noPolicyChanges:true,noMediaStarted:true}
  fence.close()
  await writeFile(join(directory,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
}
process.exitCode=failed?1:0
