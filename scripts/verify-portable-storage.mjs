import assert from 'node:assert/strict'
import {Worker} from 'node:worker_threads'
import {deserialize} from 'node:v8'
import {mkdtemp,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const root=resolve(process.argv[2]??'');assert.ok(process.argv[2])
assert.equal(resolve(process.execPath).toLowerCase(),join(root,'runtime/node/node.exe').toLowerCase())
const directory=await mkdtemp(join(fileURLToPath(new URL('..',import.meta.url)),'scratch','portable-storage-'))
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^PATH$|^NODE_PATH$|^RPLAYOUT_|^GST_|^GSTREAMER_/i.test(key)))
env.PATH=join(root,'runtime/node')+';'+join(root,'runtime/gstreamer/bin')+';'+join(process.env.SystemRoot,'System32')
const worker=new Worker(join(root,'apps/server/dist/storage-bridge.cjs'),{workerData:{file:join(directory,'storage.db'),service:join(root,'apps/server/dist/storage-service.cjs')},env})
const shared=new SharedArrayBuffer(8+16*1024*1024),control=new Int32Array(shared,0,2)
const events=[];worker.on('error',error=>events.push({error:error.message,stack:error.stack}));worker.on('exit',code=>events.push({exit:code}));worker.on('message',message=>events.push({message}))
let result={passed:false,directory,package:root},storagePid=null
try{
  worker.postMessage({request:{id:1,op:'open'},shared})
  const deadline=Date.now()+7000
  while(Atomics.load(control,0)===0&&Date.now()<deadline&&!events.length)await new Promise(resolve=>setTimeout(resolve,20))
  if(Atomics.load(control,0)!==0){
    const reply=deserialize(Buffer.from(new Uint8Array(shared,8,Atomics.load(control,1))))
    result={...result,reply};storagePid=reply.value?.pid??null
    assert.equal(reply.ok,true,JSON.stringify(reply))
    result={...result,passed:true}
  }else throw new Error('storage startup: '+JSON.stringify(events))
}catch(error){result={...result,error:String(error),events};throw error}
finally{
  await worker.terminate()
  if(storagePid){const deadline=Date.now()+5000;while(Date.now()<deadline){try{process.kill(storagePid,0)}catch{storagePid=null;break}await new Promise(resolve=>setTimeout(resolve,20))}assert.equal(storagePid,null,'owned storage helper exit not observed')}
  await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}
