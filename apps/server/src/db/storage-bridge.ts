import {fork} from 'node:child_process'
import {parentPort,workerData} from 'node:worker_threads'
import {serialize} from 'node:v8'
import {storageProcessEnvironment} from './storage-process-environment.js'

// The bridge waits asynchronously for the isolated SQLite process. Shared
// replies retain the existing synchronous Drizzle transaction contract without
// opening SQLite in the HTTP process or replaying an uncertain write.
const parent=parentPort!
const child=fork(workerData.service,[],{execPath:process.execPath,execArgv:[],serialization:'advanced',stdio:['ignore','ignore','ignore','ipc'],env:{...storageProcessEnvironment(),RPLAYOUT_STORAGE_FILE:workerData.file}})
const pending=new Map<number,SharedArrayBuffer|null>()
let dead=false
const deliver=(id:number,reply:unknown)=>{
  if(!pending.has(id))return
  const shared=pending.get(id);pending.delete(id)
  if(!shared){parent.postMessage({id,reply});return}
  const control=new Int32Array(shared,0,2),output=new Uint8Array(shared,8)
  let encoded=serialize(reply)
  if(encoded.length>output.length)encoded=serialize({id,ok:false,error:{name:'StorageResultTooLarge',message:'Resposta de banco excede o limite privado; use leitura paginada.'}})
  output.set(encoded);Atomics.store(control,1,encoded.length);Atomics.store(control,0,1);Atomics.notify(control,0)
}
const fail=()=>{
  if(dead)return;dead=true
  for(const id of [...pending.keys()])deliver(id,{id,ok:false,error:{name:'StorageDisconnected',message:'Serviço de banco desconectado. Resultado de gravação desconhecido; nenhum reenvio automático.'}})
  parent.postMessage({fatal:true})
  if(child.connected)child.disconnect()
}
child.on('message',(reply:any)=>deliver(reply.id,reply))
child.on('error',fail);child.on('exit',fail);child.on('disconnect',fail)
parent.on('message',({request,shared}:{request:{id:number};shared?:SharedArrayBuffer})=>{
  pending.set(request.id,shared??null)
  if(dead){deliver(request.id,{id:request.id,ok:false,error:{name:'StorageDisconnected',message:'Serviço encerrado; nenhuma reconexão ou repetição automática.'}});return}
  child.send(request,error=>{if(error)fail()})
})
parent.on('close',()=>{if(child.connected)child.disconnect()})
