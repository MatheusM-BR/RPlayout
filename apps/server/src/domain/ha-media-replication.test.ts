import {createHash} from 'node:crypto'
import {mkdtemp,writeFile,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {HaReplication,type HaOptions,type HaSnapshot} from './ha-replication.js'
import {HA_CHUNK_BYTES} from './ha-media.js'

const key='ba'.repeat(32),nodes=new Set<HaReplication>(),data=Buffer.from('MÍDIA PRIVADA ÇÃO '.repeat(40)),hash=createHash('sha256').update(data).digest('hex')
let directory:string,path:string,clock:number
beforeEach(async()=>{directory=await mkdtemp(join(tmpdir(),'RPlayout-ha-media-pair-'));path=join(directory,'EDIÇÃO-ÇÃO.mp4');await writeFile(path,data);clock=0;vi.spyOn(performance,'now').mockImplementation(()=>clock)})
afterEach(async()=>{for(const node of nodes){node.close();await node.settled()}nodes.clear();vi.restoreAllMocks()})
const snapshot=():HaSnapshot=>({version:1,capturedAt:new Date().toISOString(),channels:[{channelId:'ch',configuration:{},revisions:[{id:'pub',active:true,payload:{assets:[{id:'asset',contentHash:hash,path,kind:'VIDEO'}]}}],checkpoint:null,transport:null,blockers:{}}],asRun:[],journals:[]})
const config=(role:'PRIMARY'|'STANDBY',files=false):HaOptions=>({role,clusterId:'media',nodeId:role==='PRIMARY'?'a':'b',peerNodeId:role==='PRIMARY'?'b':'a',key,file:files?join(directory,role+'.db'):':memory:',peerUrl:role==='PRIMARY'?'http://peer.invalid':null,mediaRoot:join(directory,role+'-media'),mediaQuotaBytes:2*1024*1024,mediaMbit:8})
const node=(options:HaOptions,capture=snapshot,fetcher?:typeof fetch)=>{const value=new HaReplication(options,capture,fetcher);nodes.add(value);return value}
function pair(files=false,capture=snapshot){
  const reserve=node(config('STANDBY',files))
  const fetcher=vi.fn<typeof fetch>(async(url,init)=>{
    const wire=JSON.parse(String(init!.body)),headers=init!.headers as Record<string,string>
    const result=String(url).endsWith('/media')?await reserve.receiveMedia(wire,headers):reserve.receive(wire,headers)
    return new Response(JSON.stringify(result))
  })
  const primary=node(config('PRIMARY',files),capture,fetcher)
  return {primary,reserve,fetcher}
}
const step=async(primary:HaReplication)=>{clock+=1000;await primary.mediaTick(async()=>path)}
describe('replicação criptografada de mídia independente do estado',()=>{
  it('STATUS/WRITE/VERIFY confirmam conteúdo sem enviar path/dados em claro ou autorizar failover',async()=>{
    const {primary,reserve,fetcher}=pair();await primary.tick()
    await step(primary);await step(primary);expect(reserve.status().media.verified).toBe(0)
    await step(primary)
    expect(await readFile(join(directory,'STANDBY-media',hash+'.media'))).toEqual(data)
    expect(primary.status().media).toMatchObject({required:1,verified:1,ready:false,error:null});expect(reserve.status().failoverReady).toBe(false)
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain('MÍDIA PRIVADA');expect(JSON.stringify(fetcher.mock.calls)).not.toContain(data.toString('base64'));expect(JSON.stringify(fetcher.mock.calls)).not.toContain(path)
    const mediaCalls=fetcher.mock.calls.filter(([url])=>String(url).endsWith('/media'))
    expect(mediaCalls).toHaveLength(3);expect(mediaCalls[0]![1]).toMatchObject({redirect:'error',headers:{'x-rplayout-ha-purpose':'MEDIA'}})
  })
  it('ACK de bloco perdido consulta offset remoto e não duplica bytes',async()=>{
    const {primary,reserve,fetcher}=pair();await primary.tick();await step(primary)
    const original=fetcher.getMockImplementation()!
    fetcher.mockImplementationOnce(async(...args)=>{await original(...args);throw new Error('ACK_LOST_SECRET')})
    await step(primary);expect(primary.status().media).toMatchObject({verified:0});expect(primary.status().media.error).not.toContain('SECRET')
    await step(primary);await step(primary)
    expect(primary.status().media.verified).toBe(1);expect(reserve.status().media.verified).toBe(1)
    expect(await readFile(join(directory,'STANDBY-media',hash+'.media'))).toEqual(data)
  })
  it('rejeita replay entre finalidades, alteração do envelope e edição antiga',async()=>{
    const {primary,reserve,fetcher}=pair();await primary.tick();await step(primary)
    const state=fetcher.mock.calls[0]![1]!,media=fetcher.mock.calls[1]![1]!,wire=JSON.parse(String(media.body)),headers=media.headers as Record<string,string>
    await expect(reserve.receiveMedia(JSON.parse(String(state.body)),state.headers as Record<string,string>)).rejects.toThrow('não autorizado')
    expect(()=>reserve.receive(wire,headers)).toThrow('não autorizado')
    await expect(reserve.receiveMedia({...wire,ciphertext:wire.ciphertext.slice(0,-8)+'AAAAAAAA'},headers)).rejects.toThrow('alterado')
    await primary.tick();await expect(reserve.receiveMedia(wire,headers)).rejects.toThrow('espelhada mudou')
    expect(reserve.status().media.verified).toBe(0)
  })
  it('confirmação forjada ou original alterado não são anunciados prontos',async()=>{
    const {primary,reserve,fetcher}=pair();await primary.tick();await step(primary)
    const original=fetcher.getMockImplementation()!
    fetcher.mockImplementationOnce(async(...args)=>{const reply=await original(...args),body=await reply.json() as any;body.progress.ready=true;return new Response(JSON.stringify(body))})
    await step(primary);expect(primary.status().media.verified).toBe(0)
    await writeFile(path,Buffer.alloc(data.length,65));await step(primary)
    expect(primary.status().media.verified).toBe(0);expect(primary.status().media.error).toContain('Mídia não confirmada');expect(reserve.status().media.verified).toBe(0)
  })
  it('limita bytes do envelope na rede, sem atrasar replicação de estado',async()=>{
    const large=Buffer.alloc(HA_CHUNK_BYTES+100,55),largeHash=createHash('sha256').update(large).digest('hex');await writeFile(path,large)
    const {primary,reserve,fetcher}=pair(false,()=>{const value=snapshot();(value.channels[0]!.revisions[0]!.payload as any).assets[0].contentHash=largeHash;return value})
    await primary.tick();await step(primary);await step(primary)
    const count=fetcher.mock.calls.length;await primary.mediaTick(async()=>path);expect(fetcher).toHaveBeenCalledTimes(count)
    await primary.tick();expect(reserve.status().sequence).toBe(2)
    await step(primary);await step(primary);expect(primary.status().media.verified).toBe(1)
  })
  it('edição confirmada e offset sobrevivem ao reinício de bancos independentes',async()=>{
    const {primary,reserve}=pair(true);await primary.tick();await step(primary);await step(primary)
    primary.close();reserve.close();await reserve.settled()
    const restartedReserve=node(reserve.options)
    const restarted=node(primary.options,()=>{throw new Error('Não recapturar rascunho para copiar edição confirmada')},async(url,init)=>new Response(JSON.stringify(await restartedReserve.receiveMedia(JSON.parse(String(init!.body)),init!.headers as Record<string,string>))))
    await step(restarted);expect(restarted.status().media.verified).toBe(1);expect(restartedReserve.status().media.verified).toBe(1)
    expect(restarted.status().sequence).toBe(1);expect(await readFile(join(directory,'STANDBY-media',hash+'.media'))).toEqual(data)
  })
  it('arquivo removido da publicação não mantém contador de pronto',async()=>{
    let current=snapshot();const {primary,reserve}=pair(false,()=>current)
    await primary.tick();await step(primary);await step(primary);await step(primary)
    expect(reserve.status().media.verified).toBe(1)
    current={...current,channels:[]};await primary.tick()
    expect(primary.status().media).toMatchObject({required:0,verified:0});expect(reserve.status().media).toMatchObject({required:0,verified:0})
    expect(await readFile(join(directory,'STANDBY-media',hash+'.media'))).toEqual(data)
  })
})
