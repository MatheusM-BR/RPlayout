import assert from 'node:assert/strict'
import {spawn,type ChildProcess} from 'node:child_process'
import {mkdtemp} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {createRequire} from 'node:module'

// Actual death/reopen of an owned ledger process. No native engine, destination,
// browser or physical ACK is used or qualified by this isolated proof.
const script=fileURLToPath(import.meta.url)
const loader=createRequire(new URL('../apps/server/package.json',import.meta.url)).resolve('tsx/esm')
const mode=process.argv[2]
if(mode==='worker'){
  const directory=process.argv[3]!,phase=process.argv[4]!,operation=process.argv[5]!
  process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json')
  const {openDatabase}=await import('../apps/server/src/db/client.js')
  const {SecondaryEventLedger}=await import('../apps/server/src/domain/secondary-event-ledger.js')
  const {GraphicCommandLedger}=await import('../apps/server/src/domain/graphic-command-ledger.js')
  const database=openDatabase(join(directory,phase+'.db'))
  const secondary=new SecondaryEventLedger(database.db,'ch'),graphics=new GraphicCommandLedger(database.db,'ch')
  const event={id:'event',rundownItemId:'item',targetLayer:'LOWER_THIRD' as const,triggerMode:'OFFSET_FROM_START' as const,offsetFrames:0,templateId:'',payload:{},enabled:true,type:'GRAPHICS_OVERLAY' as const}
  const context={executionId:'execution',itemId:'item',revisionId:'revision',frames:12}
  if(operation==='prepare'){
    setInterval(()=>{},1000)
    await secondary.execute(context,event,'FIRE',async secondaryRunId=>{
      try{
        await graphics.execute({key:'restart-secondary-key',actorId:null,actorName:'AUTOMATIC',native:false,secondaryRunId,selection:{action:'SECONDARY_FIRE',executionId:context.executionId,revisionId:context.revisionId,event}},()=>{},async send=>{
          send()
          if(phase==='UNCERTAIN')throw new Error('ISOLATED_RESULT_UNKNOWN')
        })
      }catch(error){if(phase!=='UNCERTAIN')throw error}
      assert.equal(graphics.list()[0]!.state,phase)
      assert.equal(secondary.fireFor(context,event.id)?.state,'FIRING')
      process.send?.({ready:true,phase})
      await new Promise<void>(()=>{})
    })
  }else{
    assert.equal(secondary.fireFor(context,event.id)?.state,'FIRING')
    const recovered=secondary.reconcileGraphicReceipts()
    assert.equal(recovered,phase==='SIMULATED'?1:0)
    assert.equal(secondary.reconcileGraphicReceipts(),0)
    assert.equal(secondary.hasUnconfirmed(),phase==='UNCERTAIN')
    assert.equal(secondary.fireFor(context,event.id)?.state,phase==='SIMULATED'?'EXECUTED':'FIRING')
    let sends=0
    await secondary.execute(context,event,'FIRE',async()=>{sends++})
    assert.equal(sends,0)
    if(phase==='UNCERTAIN'){
      const receipt=graphics.list()[0]!
      graphics.review(receipt.id,receipt.reviewToken,'Isolated check; destination not validated','test',()=>{})
      assert.equal(secondary.reconcileGraphicReceipts(),0)
      assert.equal(secondary.hasUnconfirmed(),true)
    }
    process.send?.({checked:true,phase,recovered,sends,physicalOutputValidated:false})
    database.sqlite.close();process.disconnect?.()
  }
}else{
  const outputArgument=process.argv.find(value=>value.startsWith('--evidence-root='))
  const directory=await mkdtemp(join(outputArgument?resolve(outputArgument.slice(16)):tmpdir(),'RPlayout-secondary-restart-'))
  const owned=new Set<ChildProcess>()
  function launch(phase:string,operation:string){
    const child=spawn(process.execPath,['--import',pathToFileURL(loader).href,script,'worker',directory,phase,operation],{stdio:['ignore','pipe','pipe','ipc'],windowsHide:true})
    owned.add(child)
    let log=''
    child.stdout?.on('data',value=>{log=(log+String(value)).slice(-3000)})
    child.stderr?.on('data',value=>{log=(log+String(value)).slice(-3000)})
    const exit=new Promise<number|null>((done,reject)=>{child.once('error',reject);child.once('exit',code=>{owned.delete(child);done(code)})})
    const message=new Promise<any>((done,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('Worker observation timeout: '+log)),30000)
      child.once('message',value=>{clearTimeout(timeout);done(value)})
      child.once('exit',()=>{clearTimeout(timeout);reject(new Error('Worker exited before report: '+log))})
      child.once('error',error=>{clearTimeout(timeout);reject(error)})
    })
    return {child,exit,message}
  }
  const results=[]
  try{
    for(const phase of ['SIMULATED','UNCERTAIN']){
      const worker=launch(phase,'prepare')
      assert.deepEqual(await worker.message,{ready:true,phase})
      assert.equal(worker.child.kill('SIGKILL'),true)
      await worker.exit
      const inspector=launch(phase,'inspect')
      results.push(await inspector.message)
      assert.equal(await inspector.exit,0)
    }
    console.log(JSON.stringify({result:'PASS',directory,results,ownedProcessDeathAndReopen:true,nativeEngineValidated:false,fullBackendCrashValidated:false,physicalDestinationValidated:false},null,2))
  }finally{
    for(const child of owned)child.kill('SIGKILL')
  }
}
