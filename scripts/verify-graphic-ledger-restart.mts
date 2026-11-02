import assert from 'node:assert/strict'
import {spawn,type ChildProcess} from 'node:child_process'
import {mkdtemp,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'

// Real process death/reopen of the durable ledger. Does not send native graphics
// or qualify UI, physical output, native ACK loss or complete server recovery.
const script=fileURLToPath(import.meta.url)
const tsxLoader=createRequire(new URL('../apps/server/package.json',import.meta.url)).resolve('tsx/esm')
const mode=process.argv[2]
if(mode==='worker'){
  const directory=process.argv[3]!,phase=process.argv[4]!,operation=process.argv[5]!
  process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json')
  const {openDatabase}=await import('../apps/server/src/db/client.js')
  const {GraphicCommandLedger}=await import('../apps/server/src/domain/graphic-command-ledger.js')
  const database=openDatabase(join(directory,phase+'.db'))
  database.sqlite.prepare("INSERT OR IGNORE INTO channels(id,name,width,height,rate_num,rate_den,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES('a','A',320,180,25,1,-23,-1,5,'now')").run()
  const ledger=new GraphicCommandLedger(database.db,'a')
  const input={key:'restart-key',actorId:'operator',actorName:'Operador',selection:{action:'SHOW',values:{title:'Çãó'}},native:true}
  if(operation==='prepare'){
    const keepAlive=setInterval(()=>{},1000)
    await ledger.execute(input,()=>{},async beforeSend=>{
      if(phase!=='ACCEPTED')beforeSend()
      if(phase==='CONFIRMED')return
      process.send?.({ready:true,state:ledger.list()[0]!.state})
      await new Promise<void>(()=>{})
    })
    process.send?.({ready:true,state:ledger.list()[0]!.state})
    void keepAlive
  }else{
    const receipt=ledger.list()[0]!
    assert.equal(receipt.state,phase)
    let sends=0
    const work=async(beforeSend:()=>void)=>{sends++;beforeSend()}
    if(phase==='CONFIRMED'){
      const replay=await ledger.execute(input,()=>{},work)
      assert.equal(replay.receipt.replayed,true);assert.equal(sends,0)
    }else{
      await assert.rejects(()=>ledger.execute(input,()=>{},work))
      await assert.rejects(()=>ledger.execute({...input,key:'second-key'},()=>{},work))
      assert.equal(sends,0)
      if(operation==='inspect-live'){
        assert.throws(()=>ledger.review(receipt.id,receipt.reviewToken,'Conferido','admin',()=>{}))
      }else{
        assert.equal(ledger.review(receipt.id,receipt.reviewToken,'Dono parado e imagem conferida, não reenviar','admin',()=>{}).state,'REVIEWED')
        const replay=ledger.list()[0]!
        await assert.rejects(()=>ledger.execute(input,()=>{},work))
        assert.equal(replay.state,'REVIEWED');assert.equal(sends,0)
        const next=await ledger.execute({...input,key:'second-key'},()=>{},work)
        assert.equal(next.receipt.state,'CONFIRMED');assert.equal(sends,1)
      }
    }
    database.sqlite.close()
    process.send?.({checked:true,phase,operation})
    process.disconnect?.()
  }
}else{
  const directory=await mkdtemp(join(tmpdir(),'RPlayout-graphic-ledger-restart-'))
  const children=new Set<ChildProcess>()
  function launch(phase:string,operation:string){
    const child=spawn(process.execPath,['--import',new URL('file:'+tsxLoader.replaceAll('\\','/')).href,script,'worker',directory,phase,operation],{cwd:fileURLToPath(new URL('..',import.meta.url)),windowsHide:true,stdio:['ignore','pipe','pipe','ipc']})
    children.add(child)
    let output='';child.stderr?.on('data',chunk=>{output=(output+chunk).slice(-4000)})
    return {child,output:()=>output}
  }
  async function message(job:ReturnType<typeof launch>,field:string){
    return await new Promise<any>((resolve,reject)=>{
      const timer=setTimeout(()=>finish(new Error('Worker timeout: '+job.output())),15000)
      const receive=(value:any)=>{if(value[field])finish(undefined,value)}
      const ended=()=>finish(new Error('Worker exited before evidence: '+job.output()))
      const failed=(error:Error)=>finish(error)
      function finish(error?:Error,value?:any){clearTimeout(timer);job.child.off('message',receive);job.child.off('exit',ended);job.child.off('error',failed);error?reject(error):resolve(value)}
      job.child.on('message',receive);job.child.once('exit',ended);job.child.once('error',failed)
    })
  }
  async function exit(child:ChildProcess,kill=false){
    if(child.exitCode!==null||child.signalCode!==null)return
    await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Owned worker did not exit')),10000)
      child.once('exit',()=>{clearTimeout(timer);resolve()})
      if(kill)child.kill('SIGKILL')
    })
  }
  const checks:object[]=[]
  try{
    for(const phase of ['ACCEPTED','SENDING','CONFIRMED']){
      const owner=launch(phase,'prepare')
      assert.equal((await message(owner,'ready')).state,phase)
      if(phase!=='CONFIRMED'){
        const live=launch(phase,'inspect-live')
        checks.push(await message(live,'checked'));await exit(live.child)
        assert.equal(live.child.exitCode,0)
      }
      await exit(owner.child,true)
      const restored=launch(phase,'inspect-dead')
      checks.push(await message(restored,'checked'));await exit(restored.child)
      assert.equal(restored.child.exitCode,0)
    }
    const result={result:'PASS',evidence:'REAL_PROCESS_CRASH_AND_DURABLE_LEDGER_REOPEN',directory,checks,ownedCleanupConfirmed:true,nativeCommandSent:false,browserValidated:false,physicalOutputValidated:false}
    await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2))
    console.log(JSON.stringify(result))
  }finally{
    for(const child of children)await exit(child,true)
  }
}
