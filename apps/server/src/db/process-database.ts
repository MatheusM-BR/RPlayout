import type Database from 'better-sqlite3'
import {Worker} from 'node:worker_threads'
import {deserialize} from 'node:v8'
import {dirname,resolve,isAbsolute} from 'node:path'
import {existsSync} from 'node:fs'
import {storageProcessEnvironment} from './storage-process-environment.js'

type Reply={ok:boolean;value?:any;inTransaction?:boolean;error?:{name:string;message:string;code?:string}}
type Request={op:string;sql?:string;args?:unknown[];raw?:boolean;pluck?:boolean;safeIntegers?:boolean;cursor?:number;target?:string;options?:Record<string,unknown>}
const result=(reply:Reply)=>{
  if(!reply.ok){const error=Object.assign(new Error(reply.error?.message??'Falha no serviço de banco.'),{name:reply.error?.name??'StorageError',code:reply.error?.code});throw error}
  return reply.value
}

export function storageProcessFiles(){
  if(process.env.RPLAYOUT_STORAGE_BIN_DIR&&!isAbsolute(process.env.RPLAYOUT_STORAGE_BIN_DIR))throw new Error('Pasta dos auxiliares do banco deve ser absoluta.')
  const root=process.env.RPLAYOUT_STORAGE_BIN_DIR??dirname(resolve(process.argv[1]??''))
  return {bridge:resolve(root,'storage-bridge.cjs'),service:resolve(root,'storage-service.cjs')}
}
/** Isolated child per connection, not a network database or HA authority. Lost
 * transport poisons this connection. Restart/replay is an operator decision. */
export class ProcessDatabase {
  readonly name:string
  readonly readonly:boolean
  readonly memory:boolean
  readonly storageMode='PROCESS'
  readonly storagePid:number
  open=true
  inTransaction=false
  private readonly worker:Worker
  private readonly shared=new SharedArrayBuffer(8+16*1024*1024)
  private sequence=0
  private poisoned=false
  private savepoint=0
  private calls=0
  private totalMs=0
  private maxMs=0
  private lastMs=0
  private asyncRequests=new Map<number,{resolve:(value:unknown)=>void;reject:(error:unknown)=>void}>()
  constructor(file:string){
    const files=storageProcessFiles()
    if(!existsSync(files.bridge)||!existsSync(files.service))throw new Error('Processo de banco ausente no pacote. Refaça a build completa; não instale módulos manualmente.')
    this.worker=new Worker(files.bridge,{workerData:{file,service:files.service},env:storageProcessEnvironment()})
    const fail=()=>{
      this.poisoned=true
      for(const request of this.asyncRequests.values())request.reject(new Error('Banco desconectado; resultado desconhecido, sem repetição automática.'))
      this.asyncRequests.clear()
    }
    this.worker.on('error',fail);this.worker.on('exit',fail)
    this.worker.on('message',({fatal,id,reply}:{fatal?:boolean;id:number;reply:Reply})=>{
      if(fatal){fail();return}
      const pending=this.asyncRequests.get(id);if(!pending)return
      this.asyncRequests.delete(id)
      try{pending.resolve(result(reply))}catch(error){pending.reject(error)}
    })
    try{
      const info=this.call({op:'open'});this.name=info.name;this.readonly=info.readonly;this.memory=info.memory;this.storagePid=info.pid
    }catch(error){this.poisoned=true;void this.worker.terminate();throw error}
    this.worker.unref()
  }
  private call(request:Request):any{
    if(this.poisoned||!this.open)throw new Error('Banco indisponível; conexão não será reaberta nem gravação repetida automaticamente.')
    const control=new Int32Array(this.shared,0,2)
    const started=performance.now()
    Atomics.store(control,0,0);Atomics.store(control,1,0)
    this.worker.postMessage({request:{id:++this.sequence,...request},shared:this.shared})
    if(Atomics.wait(control,0,0,30_000)==='timed-out'){
      this.recordLatency(started)
      this.poisoned=true;void this.worker.terminate()
      throw new Error('Banco não respondeu no prazo. Resultado desconhecido; controle de banco bloqueado, sem reenvio automático.')
    }
    const reply=deserialize(Buffer.from(new Uint8Array(this.shared,8,Atomics.load(control,1)))) as Reply
    this.recordLatency(started)
    if(reply.inTransaction!==undefined)this.inTransaction=reply.inTransaction
    if(['StorageDisconnected','StorageResultTooLarge'].includes(reply.error?.name??'')){this.poisoned=true;void this.worker.terminate()}
    return result(reply)
  }
  private recordLatency(started:number){this.lastMs=performance.now()-started;this.calls++;this.totalMs+=this.lastMs;this.maxMs=Math.max(this.maxMs,this.lastMs)}
  storageStatus(){return {mode:'PROCESS' as const,connected:this.open&&!this.poisoned,backendPid:process.pid,storagePid:this.storagePid,automaticReconnect:false,automaticReplay:false,latency:{calls:this.calls,lastMs:this.lastMs,maxMs:this.maxMs,meanMs:this.calls?this.totalMs/this.calls:0},validation:'PENDING' as const}}
  prepare(sql:string){
    const info=this.call({op:'prepare',sql}),database=this
    let raw=false,pluck=false,safeIntegers=false,bound:unknown[]|null=null
    const query=(op:string,args:unknown[]=[])=>database.call({op,sql,raw,pluck,safeIntegers,args:bound??args})
    const stmt={source:sql,database:this,reader:info.reader,readonly:info.readonly,
      run:(...args:unknown[])=>query('run',args),get:(...args:unknown[])=>query('get',args),all:(...args:unknown[])=>query('all',args),columns:()=>query('columns'),
      raw:(value=true)=>{raw=value;return stmt},pluck:(value=true)=>{pluck=value;return stmt},safeIntegers:(value=true)=>{safeIntegers=value;return stmt},
      bind:(...args:unknown[])=>{if(bound)throw new Error('Statement já possui parâmetros vinculados.');bound=args;return stmt},
      *iterate(...args:unknown[]){
        const cursor=query('iterateStart',args)
        try{while(true){const page=database.call({op:'iterateNext',cursor});for(const row of page.rows)yield row;if(page.done)break}}
        finally{if(database.open&&!database.poisoned)database.call({op:'iterateClose',cursor})}
      },
    }
    return stmt
  }
  exec(sql:string){this.call({op:'exec',sql});return this}
  pragma(sql:string,options?:Record<string,unknown>){return this.call({op:'pragma',sql,options})}
  transaction<T extends (...args:any[])=>any>(work:T){
    const execute=(behavior:string,self:unknown,args:unknown[])=>{
      const nested=this.inTransaction,name='process_tx_'+(++this.savepoint)
      this.exec(nested?'SAVEPOINT '+name:'BEGIN '+behavior)
      try{
        const value=work.apply(self,args)
        if(value&&typeof value.then==='function')throw new Error('Transação síncrona não aceita callback assíncrono.')
        this.exec(nested?'RELEASE '+name:'COMMIT');return value
      }catch(error){
        if(!this.poisoned&&this.inTransaction)try{this.exec(nested?'ROLLBACK TO '+name+'; RELEASE '+name:'ROLLBACK')}catch{this.poisoned=true;void this.worker.terminate()}
        throw error
      }
    }
    const fn=function(this:unknown,...args:unknown[]){return execute('DEFERRED',this,args)}
    return Object.assign(fn,{deferred:fn,immediate:function(this:unknown,...args:unknown[]){return execute('IMMEDIATE',this,args)},exclusive:function(this:unknown,...args:unknown[]){return execute('EXCLUSIVE',this,args)}})
  }
  backup(target:string,options?:Record<string,unknown>):Promise<unknown>{
    if(this.poisoned||!this.open)return Promise.reject(new Error('Serviço de banco indisponível.'))
    const id=++this.sequence
    this.worker.ref()
    let timer:ReturnType<typeof setTimeout>|undefined
    return new Promise((resolve,reject)=>{
      this.asyncRequests.set(id,{resolve,reject})
      timer=setTimeout(()=>{
        this.poisoned=true
        for(const pending of this.asyncRequests.values())pending.reject(new Error('Backup sem resposta; resultado desconhecido, conexão bloqueada e sem repetição automática.'))
        this.asyncRequests.clear();void this.worker.terminate()
      },60_000)
      this.worker.postMessage({request:{id,op:'backup',target,options}})
    }).finally(()=>{clearTimeout(timer);if(!this.asyncRequests.size)this.worker.unref()})
  }
  close(){
    if(!this.open)return
    try{if(!this.poisoned)this.call({op:'close'})}finally{this.open=false;void this.worker.terminate()}
  }
}
export function openProcessDatabase(file:string):Database.Database{return new ProcessDatabase(file) as unknown as Database.Database}
export function databaseStorageStatus(sqlite:Database.Database){
  const processDatabase=sqlite as unknown as ProcessDatabase
  return processDatabase.storageMode==='PROCESS'?processDatabase.storageStatus():{mode:'INLINE' as const,connected:sqlite.open,backendPid:process.pid,storagePid:process.pid,automaticReconnect:false,automaticReplay:false,latency:null,validation:'PENDING' as const}
}
