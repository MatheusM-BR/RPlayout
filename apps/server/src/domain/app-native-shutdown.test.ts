import {afterEach,it,expect,vi} from 'vitest'
import {createApp,runtimeFor,blockRuntimeCreation,type App} from '../app.js'
import {EngineTransport} from './engine.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',RELAY_BINARY:'',DEVICES_BINARY:'',MEDIA_ROOT:'',PROBE_BINARY:'',PROXY_BINARY:''}))
vi.mock('./engine.js',async original=>({...await original<Record<string,unknown>>(),EngineTransport:class{closeConfirmed=vi.fn(async()=>({ownedNativeProcessesStopped:true}));closeGracefully=vi.fn(async()=>({ownedNativeProcessesStopped:true,graceful:true,forceRequested:false}))}}))
let app:App|null=null
afterEach(()=>{if(app?.sqlite.open)app.sqlite.close();vi.restoreAllMocks()})
async function fixture(){
 app=await createApp(':memory:')
 const transport=new (EngineTransport as any)(),runtime={transport,close:vi.fn(),closeGracefully:vi.fn(()=>transport.closeGracefully()),asRun:{finish:vi.fn(async(_reason:string)=>{})}}
 app.runtimes.set('qa-native',runtime as any)
 return {value:app,runtime,transport}
}
it('app normal espera prova graciosa antes de STORAGE_CLOSED e não chama cleanup forçado',async()=>{
 const {value,runtime,transport}=await fixture()
 let finish!:(proof:any)=>void;transport.closeGracefully.mockReturnValue(new Promise(resolve=>{finish=resolve}))
 const close=value.close();expect(value.sqlite.open).toBe(true);expect(runtime.close).not.toHaveBeenCalled();expect(runtime.closeGracefully).toHaveBeenCalledOnce();expect(transport.closeConfirmed).not.toHaveBeenCalled()
 expect(value.close()).toBe(close)
 finish({ownedNativeProcessesStopped:true,graceful:true,forceRequested:false});await close
 expect(value.sqlite.open).toBe(false)
})
it('close direto captura o as-run antes de limpar runtimes e aguarda sua drenagem',async()=>{
 const {value,runtime}=await fixture()
 let finish!:()=>void;runtime.asRun.finish.mockReturnValue(new Promise(resolve=>{finish=resolve}))
 const close=value.close();expect(value.runtimes.size).toBe(0)
 await vi.waitFor(()=>expect(runtime.asRun.finish).toHaveBeenCalledWith('SHUTDOWN'))
 expect(value.sqlite.open).toBe(true);expect(value.close()).toBe(close)
 finish();await close;expect(value.sqlite.open).toBe(false)
 expect(runtime.asRun.finish).toHaveBeenCalledOnce()
})
it('flush e close compartilham resultado incerto sem reenviar escrita ou assinar fechamento',async()=>{
 const {value,runtime,transport}=await fixture(),error=new Error('QA_HISTORY_RESULT_UNKNOWN')
 runtime.asRun.finish.mockRejectedValue(error)
 const first=value.flush(),second=value.flush();expect(first).toBe(second)
 await expect(first).rejects.toBe(error)
 await expect(value.close()).rejects.toBe(error)
 expect(runtime.asRun.finish).toHaveBeenCalledOnce();expect(transport.closeGracefully).toHaveBeenCalledOnce()
 expect(value.sqlite.open).toBe(true)
})
it('flush concluído antes de close não repete o fechamento da linha',async()=>{
 const {value,runtime}=await fixture()
 await value.flush();await value.close()
 expect(runtime.asRun.finish).toHaveBeenCalledOnce();expect(value.sqlite.open).toBe(false)
})
it('parada sem prova normal não encerra storage nem certifica sucesso por kill',async()=>{
 const {value,transport}=await fixture();transport.closeGracefully.mockResolvedValue({ownedNativeProcessesStopped:true,graceful:false,forceRequested:true})
 await expect(value.close()).rejects.toThrow('não confirmou encerramento normal');expect(value.sqlite.open).toBe(true)
})
it('contexto HA preserva close/cleanup forçado existente, sem aguardar grace',async()=>{
 const {value,runtime,transport}=await fixture();Object.assign(value,{ha:{close:vi.fn(),settled:async()=>{},isDraining:false}})
 await value.close()
 expect(runtime.close).toHaveBeenCalledOnce();expect(runtime.closeGracefully).not.toHaveBeenCalled();expect(transport.closeConfirmed).toHaveBeenCalledWith(5000);expect(value.sqlite.open).toBe(false)
})
it('falha síncrona de outro controlador não pula NativeDrain nem vira rejeição solta',async()=>{
 const {value,transport}=await fixture()
 vi.spyOn(value.relays,'closeAll').mockImplementation(()=>{throw new Error('QA_CONTROLLER_FAILED')})
 transport.closeGracefully.mockResolvedValue({ownedNativeProcessesStopped:true,graceful:false,forceRequested:true})
 const unhandled:unknown[]=[];const onUnhandled=(error:unknown)=>unhandled.push(error);process.on('unhandledRejection',onUnhandled)
 try{await expect(value.close()).rejects.toBeInstanceOf(AggregateError);await new Promise(done=>setImmediate(done));expect(unhandled).toEqual([]);expect(value.sqlite.open).toBe(true)}finally{process.off('unhandledRejection',onUnhandled)}
})
it('encerramento impede reabrir runtime existente ou criar outro canal',async()=>{
 const {value}=await fixture();blockRuntimeCreation(value)
 expect(await runtimeFor(value,'qa-native')).toBeNull();expect(await runtimeFor(value,'new-channel')).toBeNull()
 await value.close()
})
