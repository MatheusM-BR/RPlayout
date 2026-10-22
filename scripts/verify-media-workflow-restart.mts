import assert from 'node:assert/strict'
import {fork,execFile,spawn,type ChildProcess} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,readFile,writeFile,readdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'

const root=fileURLToPath(new URL('..',import.meta.url)),self=fileURLToPath(import.meta.url)
const worker=process.argv[2]==='--worker'
const abrupt=process.argv.includes('--crash')
const directory=worker?process.argv[3]!:await mkdtemp(join(tmpdir(),'RPlayout-workflow-restart-'))
const gstRoot=process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64??'C:/Program Files/gstreamer/1.0/msvc_x86_64'
process.env.PATH=join(gstRoot,'bin')+';'+process.env.PATH
process.env.GST_REGISTRY=join(directory,'registry.bin')
process.env.GST_PLUGIN_PATH=join(gstRoot,'lib/gstreamer-1.0')
process.env.GST_PLUGIN_SYSTEM_PATH=process.env.GST_PLUGIN_PATH
process.env.GST_PLUGIN_SCANNER=join(gstRoot,'libexec/gstreamer-1.0/gst-plugin-scanner.exe')
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json')
const {openDatabase}=await import('../apps/server/src/db/client.js')
const {MediaWorkflow}=await import('../apps/server/src/domain/media-workflow.js')
if(worker){
  const source=process.argv[4]!,hash=process.argv[5]!,mode=process.argv[6]!
  const db=openDatabase(join(directory,'workflow.db'))
  const workflow=new MediaWorkflow(db.sqlite,join(directory,'versions'),join(root,'apps/engine/target/release/rplayout-proxy.exe'))
  try{
    if(mode==='interrupt'||mode==='crash'){
      db.sqlite.exec("INSERT INTO media_assets (id,content_hash,path,title,kind,duration_frames,created_at) VALUES ('a','initial','fixture','AÇÃO','VIDEO',500,'fixture')")
      workflow.record('a',{contentHash:hash,kind:'VIDEO',path:source})
      const deadline=performance.now()+45_000
      let child:ChildProcess|null=null
      while(performance.now()<deadline){
        child=(workflow as unknown as {child:ChildProcess|null}).child
        if(child?.pid&&child.exitCode===null&&child.signalCode===null)break
        await new Promise(resolve=>setTimeout(resolve,5))
      }
      assert.ok(child?.pid&&child.exitCode===null&&child.signalCode===null,'No live native proxy to interrupt')
      const stopping=new Promise<void>(resolve=>process.once('message',()=>resolve()))
      process.send?.({phase:'RUNNING',jobs:workflow.jobs(),nativePid:child.pid,at:new Date().toISOString()})
      await stopping;await workflow.close()
      assert.ok(child.exitCode!==null||child.signalCode!==null,'Owned proxy did not exit before workflow drain')
      assert.ok(!(await readdir(join(directory,'versions'))).some(name=>name.endsWith('.part')))
      process.send?.({phase:'DRAINED',jobs:workflow.jobs(),nativeChildExited:true,noPartialFiles:true})
    }else{
      await workflow.tick()
      const jobs=workflow.jobs() as Array<{kind:string;state:string;attempts:number;id:string}>
      assert.ok(jobs.every(job=>job.state==='READY'),JSON.stringify(jobs))
      const proxy=await workflow.preview('a',hash);assert.ok(proxy)
      const {stdout}=await promisify(execFile)(join(root,'apps/engine/target/release/rplayout-probe.exe'),[proxy,'--no-loudness'],{windowsHide:true,timeout:30_000})
      const probe=JSON.parse(stdout.trim().split('\n').at(-1)!)
      assert.equal(probe.ok,true);assert.ok(probe.decodedVideoBuffers>0&&probe.decodedAudioBuffers>0)
      process.send?.({phase:'RESUMED',jobs,probe})
    }
  }finally{await workflow.close();db.sqlite.close()}
  process.disconnect?.()
}else{
  const source=join(directory,'Cópia-ação-ÇÃO.mkv')
  await promisify(execFile)(join(gstRoot,'bin/gst-launch-1.0.exe'),['-q','videotestsrc',`num-buffers=${abrupt?1500:500}`,'!','video/x-raw,width=640,height=360,framerate=25/1','!','vp8enc','deadline=1','!','queue','!','m.video_0','audiotestsrc',`num-buffers=${abrupt?2813:938}`,'!','audio/x-raw,rate=48000,channels=2','!','audioconvert','!','vorbisenc','!','queue','!','m.audio_0','matroskamux','name=m','!','filesink',`location=${source.replaceAll('\\','/')}`],{windowsHide:true,timeout:60_000})
  const hash=createHash('sha256').update(await readFile(source)).digest('hex')
  const reports:any[]=[]
  const observations:any[]=[]
  const mark=(event:string,detail:object={})=>observations.push({event,at:new Date().toISOString(),...detail})
  let nativeExitEvidence:string|null=null
  async function phase(mode:string){
    let child:ChildProcess|undefined,logs=''
    let monitor:ChildProcess|null=null,monitorDone:Promise<void>|null=null
    if(mode==='crash'){
      // Pin the exact native process while its owning worker is still alive.
      // Observe that handle's exit only; never kill a historical PID.
      const command=`Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class ProxyExit { [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetExitCodeProcess(IntPtr handle,out uint code); }'; $null=Get-CimInstance Win32_Process -Filter 'ProcessId=0'; [Console]::WriteLine('MONITOR_READY'); [Console]::Out.Flush(); $taskInput=[Console]::ReadLine().Split(','); $taskPid=[int]$taskInput[0]; $taskOwner=[int]$taskInput[1]; $taskProxy=Get-Process -Id $taskPid -ErrorAction Stop; $taskPinned=$taskProxy.Handle; $taskParent=Get-CimInstance Win32_Process -Filter ('ProcessId='+$taskPid); if($taskParent.ParentProcessId -ne $taskOwner){throw 'Wrong native parent'}; [uint32]$taskBefore=0; if(![ProxyExit]::GetExitCodeProcess($taskPinned,[ref]$taskBefore) -or $taskBefore -ne 259){throw 'Proxy completed before crash fixture was armed'}; [Console]::WriteLine('PINNED:'+ [DateTime]::UtcNow.ToString('o')); [Console]::Out.Flush(); if(!$taskProxy.WaitForExit(15000)){throw 'Native proxy did not exit after worker crash'}; [uint32]$taskCode=0; if(![ProxyExit]::GetExitCodeProcess($taskPinned,[ref]$taskCode)){throw 'Kernel exit observation failed'}; [Console]::WriteLine('EXIT_KERNEL:'+ $taskCode); [Console]::WriteLine('EXIT_MANAGED:'+ $taskProxy.ExitCode); [Console]::WriteLine('EXIT_TIME:'+ [DateTime]::UtcNow.ToString('o')); [Console]::Out.Flush()`
      monitor=spawn('powershell.exe',['-NoProfile','-Command',command],{windowsHide:true,stdio:['pipe','pipe','pipe']})
      let output=''
      let killRequested=false
      let prepared!:()=>void
      const ready=new Promise<void>(resolve=>{prepared=resolve})
      monitor.stdout!.on('data',data=>{
        output+=String(data);mark('MONITOR_OUTPUT',{text:String(data)})
        if(output.includes('MONITOR_READY'))prepared()
        if(output.includes('PINNED')&&!killRequested&&child&&child.exitCode===null&&child.signalCode===null){
          killRequested=true;mark('WORKER_KILL_REQUEST',{accepted:child.kill('SIGKILL')})
        }
      })
      monitor.stderr!.on('data',data=>{output+=String(data)})
      monitorDone=new Promise<void>((resolve,reject)=>{
        monitor!.once('error',reject)
        monitor!.once('exit',code=>{
          mark('MONITOR_EXIT',{code,output})
          const kernelCode=/EXIT_KERNEL:(\d+)/.exec(output)
          // Exit status alone is not job success: forced family shutdown can
          // report zero. Require a formerly live pinned handle to terminate;
          // independently prove no READY commit and recovery below.
          if(code===0&&kernelCode&&Number(kernelCode[1])!==259){nativeExitEvidence=output;resolve()}
          else reject(new Error('Native handle observation failed: '+output))
        })
      })
      // Preserve the rejection until awaited after the owning worker exits.
      void monitorDone.catch(()=>{})
      await Promise.race([ready,monitorDone.then(()=>{throw new Error('Monitor exited before readiness')})])
    }
    child=fork(self,['--worker',directory,source,hash,mode],{execArgv:process.execArgv,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']})
    mark('WORKER_STARTED',{mode,pid:child.pid})
    child.stdout?.on('data',data=>{logs+=String(data)});child.stderr?.on('data',data=>{logs+=String(data)})
    child.on('message',(message:any)=>{
      reports.push(message);mark('WORKER_MESSAGE',{mode,phase:message.phase})
      if(message.phase!=='RUNNING')return
      if(mode!=='crash'){child!.send({action:'STOP'});return}
      assert.ok(Number.isSafeInteger(message.nativePid)&&Number.isSafeInteger(child!.pid))
      monitor!.stdin!.end(`${message.nativePid},${child!.pid}\n`)
    })
    let timer:ReturnType<typeof setTimeout>|undefined
    try{
      const exited=new Promise<number|null>((resolve,reject)=>{
        child!.once('error',reject);child!.once('exit',(code,signal)=>{mark('WORKER_EXIT',{mode,code,signal});resolve(code)})
        timer=setTimeout(()=>reject(new Error('Owned workflow phase timeout')),60_000)
      })
      const code=await (monitorDone?Promise.race([exited,monitorDone.then(()=>exited)]):exited)
      if(mode==='crash'){assert.notEqual(code,0,'Worker must terminate abruptly');assert.ok(monitorDone);await monitorDone}
      else assert.equal(code,0,logs)
    }finally{
      if(timer)clearTimeout(timer);if(child.exitCode===null&&child.signalCode===null)child.kill()
      if(monitor&&monitor.exitCode===null&&monitor.signalCode===null)monitor.kill()
    }
  }
  let checkpointAfterCrash:unknown=null
  try{
    await phase(abrupt?'crash':'interrupt')
    if(abrupt){
      const killed=observations.find(row=>row.event==='WORKER_KILL_REQUEST')
      const exited=observations.find(row=>row.event==='WORKER_EXIT'&&row.mode==='crash')
      const nativeExit=observations.find(row=>row.event==='MONITOR_OUTPUT'&&row.text.includes('EXIT_KERNEL:'))
      assert.equal(killed?.accepted,true);assert.equal(exited?.signal,'SIGKILL')
      assert.ok(nativeExit&&Date.parse(nativeExit.at)>=Date.parse(killed.at))
      assert.ok(Date.parse(nativeExit.at)-Date.parse(killed.at)<15000,'Native proxy must exit within bounded parent loss time')
      const stalled=openDatabase(join(directory,'workflow.db'))
      try{
        checkpointAfterCrash=stalled.sqlite.prepare("SELECT id,state,attempts,output_hash FROM media_jobs WHERE kind='PROXY'").get()
        assert.equal((checkpointAfterCrash as any).state,'RUNNING','Crash must not certify completed proxy')
        assert.equal((checkpointAfterCrash as any).output_hash,null)
      }finally{stalled.sqlite.close()}
    }
    await phase('resume')
  }
  catch(error){await writeFile(join(directory,'failure.json'),JSON.stringify({error:String(error),reports,nativeExitEvidence,observations},null,2));throw error}
  // Direct EOF verifies native parent-loss handling, not a forced server crash.
  const proxy=spawn(join(root,'apps/engine/target/release/rplayout-proxy.exe'),[source,join(directory,'parent-lost.mp4'),'--parent-pipe'],{windowsHide:true,stdio:['pipe','pipe','pipe']})
  let proxyOutput='',proxyTimer:ReturnType<typeof setTimeout>|undefined
  proxy.stdout.on('data',data=>{proxyOutput+=String(data)})
  proxy.stderr.on('data',data=>{proxyOutput+=String(data)})
  let parentLossCode:number|null=null
  try{
    const exited=new Promise<number|null>((resolve,reject)=>{
      proxy.once('error',reject);proxy.once('exit',resolve)
      proxyTimer=setTimeout(()=>reject(new Error('Owned proxy did not exit on EOF')),15_000)
    })
    proxy.stdin.end()
    parentLossCode=await exited
    assert.equal(parentLossCode,1,proxyOutput)
    assert.match(proxyOutput,/servidor encerrou durante a geração do proxy/)
  }finally{if(proxyTimer)clearTimeout(proxyTimer);if(proxy.exitCode===null&&proxy.signalCode===null)proxy.kill()}
  const before=reports.find(row=>row.phase===(abrupt?'RUNNING':'DRAINED')),after=reports.find(row=>row.phase==='RESUMED')
  assert.ok(before&&after)
  const interrupted=before.jobs.find((job:any)=>job.kind==='PROXY'),resumed=after.jobs.find((job:any)=>job.kind==='PROXY')
  assert.equal(interrupted.state,'RUNNING');assert.equal(resumed.id,interrupted.id)
  assert.equal(resumed.attempts,interrupted.attempts+1)
  const result={result:'PASS',directory,hash,reports,observations,checkpointAfterCrash,sameJobAfterRealWorkerRestart:true,nativeParentPipeLossRefused:true,parentLossCode,proxyOutput,nativeExitEvidence,scope:abrupt?'NATIVE_PROXY_FORCED_WORKER_CRASH_AND_RECOVERY':'NATIVE_PROXY_GRACEFUL_INTERRUPTION_WORKER_RESTART_AND_PARENT_EOF',compiledApiValidated:false,forcedCrashValidated:abrupt,archiveCopyInterruptionValidated:false}
  await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result))
}
