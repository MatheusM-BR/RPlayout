import {EventEmitter} from 'node:events'
import {PassThrough} from 'node:stream'
import {spawn} from 'node:child_process'
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest'
import {MediaMtx,mediaListenAddress} from './mediamtx.js'
import type {HostDistributionFence} from './host-distribution-fence.js'
import {writePrivateConfig} from './private-config-file.js'
vi.mock('node:child_process',async original=>({...await original<Record<string,unknown>>(),spawn:vi.fn()}))
vi.mock('./private-config-file.js',()=>({writePrivateConfig:vi.fn(async(_path,_content,authorize,verifyNative)=>{await verifyNative?.();authorize?.()})}))
let media:MediaMtx,children:ReturnType<typeof child>[],fence:ReturnType<typeof guard>
const child=()=>Object.assign(new EventEmitter(),{pid:900003,exitCode:null,signalCode:null,killed:false,stdout:new PassThrough(),stderr:new PassThrough(),kill:vi.fn()})
const guard=()=>({assertOwned:vi.fn(()=>{}),assertPortsAvailable:vi.fn(async()=>{}),pinProcess:vi.fn(async(pid:number,token:string)=>Object.freeze({pid,token})),releaseProcess:vi.fn(async()=>{}),mediaReady:vi.fn(async()=>true)})
const body={items:[{name:'fixture/pgm',ready:true,source:{type:'rtmpSession'},readers:[],bytesReceived:100}]}
beforeEach(()=>{
  children=[];fence=guard();vi.mocked(spawn).mockReset();vi.mocked(writePrivateConfig).mockClear()
  vi.mocked(spawn).mockImplementation(()=>{const value=child();children.push(value);return value as unknown as ReturnType<typeof spawn>})
  media=new MediaMtx({binary:'fixture-media',configPath:'fixture.yml',bind:'127.0.0.1',logLevel:'warn',hostFence:fence as unknown as HostDistributionFence})
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>body})))
})
afterEach(()=>{media.stop();for(const value of children)value.emit('exit',0,null);vi.unstubAllGlobals();vi.unstubAllEnvs()})
describe('MediaMTX verifica encarnação e sockets, não só HTTP200',()=>{
  it('cada spawn e reinício usam somente a configuração privada, sem overrides atuais ou legados',async()=>{
    for(const [key,value]of Object.entries({MTX_CONFKEY:'PRIVATE_CONFIG_KEY',MTX_MOQ:'yes',MTX_APIADDRESS:'0.0.0.0:19997',RTSP_RTPADDRESS:':18000',RTSP_PATHS_ALL_RUNONINIT:'PRIVATE_HOOK',RPLAYOUT_CONTROL_TOKEN:'PRIVATE_CONTROL_TOKEN'}))vi.stubEnv(key,value)
    await media.start()
    children[0]!.emit('exit',1,null)
    vi.stubEnv('MTX_PATHS_ALL_SOURCE','rtsp://private.invalid/source')
    await media.start()
    expect(spawn).toHaveBeenCalledTimes(2)
    for(const call of vi.mocked(spawn).mock.calls){
      const environment=call[2]!.env!
      expect(Object.keys(environment).some(key=>/^(MTX|RTSP)_/i.test(key))).toBe(false)
      expect(environment).not.toHaveProperty('RPLAYOUT_CONTROL_TOKEN')
      expect(call[1]).toEqual(['fixture.yml'])
    }
    expect(process.env.MTX_CONFKEY).toBe('PRIVATE_CONFIG_KEY')
    expect(process.env.RTSP_PATHS_ALL_RUNONINIT).toBe('PRIVATE_HOOK')
  })
  it.each(['127.0.0.1','0.0.0.0','::1','::'])('endereços TCP e UDP seguem binding %s sem listeners implícitos',async bind=>{
    const instance=new MediaMtx({binary:'fixture',configPath:'fixture.yml',bind,logLevel:'warn'})
    await instance.apply([],[])
    const config=vi.mocked(writePrivateConfig).mock.calls.at(-1)![1]
    expect(config).toContain('moq: no');expect(config).toContain('metrics: no');expect(config).toContain('pprof: no');expect(config).toContain('playback: no')
    expect(config).toContain('rtspTransports: [udp, tcp]')
    for(const [field,port]of [['rtspAddress',8554],['rtmpAddress',1935],['srtAddress',8890],['hlsAddress',8888],['webrtcAddress',8889],['rtpAddress',8000],['rtcpAddress',8001],['webrtcLocalUDPAddress',8189]] as const)expect(config).toContain(`${field}: ${JSON.stringify(mediaListenAddress(bind,port))}`)
    expect(config).not.toMatch(/: \[::/)
    expect(config).toContain('apiAddress: 127.0.0.1:9997')
    expect(config).toContain('webrtcLocalTCPAddress: ""')
  })
  it('binding não injeta YAML e IPv6 recebe colchetes',()=>{
    expect(mediaListenAddress('::1',8554)).toBe('[::1]:8554')
    for(const bind of ['', '127.0.0.1\nmoq: yes','http://host','host:8554','[::1]'])expect(()=>new MediaMtx({binary:'fixture',configPath:'fixture',bind,logLevel:'warn'})).toThrow('Endereço')
    expect(writePrivateConfig).not.toHaveBeenCalled();expect(spawn).not.toHaveBeenCalled()
  })
  it('watchdog não usa configuração herdada quando publicação inicial foi recusada',async()=>{
    media=new MediaMtx({binary:'fixture-media',configPath:'fixture.yml',bind:'127.0.0.1',logLevel:'warn',hostFence:fence as unknown as HostDistributionFence,requireAppliedConfig:true})
    await expect(media.start()).rejects.toThrow('não foi publicada');media.watchdog();await new Promise(done=>setTimeout(done,0));expect(spawn).not.toHaveBeenCalled()
    await media.apply([],[]);await media.start();expect(spawn).toHaveBeenCalledTimes(1)
  })
  it('recusa portas antes de arquivo/spawn e preserva terceiros',async()=>{
    fence.assertPortsAvailable.mockRejectedValue(new Error('FOREIGN_PORT'))
    await expect(media.apply([],[])).rejects.toThrow('FOREIGN_PORT');await expect(media.start()).rejects.toThrow('FOREIGN_PORT')
    expect(spawn).not.toHaveBeenCalled();expect(writePrivateConfig).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled()
  })
  it('start concorrente reserva um único child e vincula sua geração privada',async()=>{
    await Promise.all([media.start(),media.start()]);expect(spawn).toHaveBeenCalledTimes(1);expect(fence.pinProcess).toHaveBeenCalledWith(900003,expect.any(String));expect(await media.waitUntilReady(500)).toBe(true);expect(fence.mediaReady).toHaveBeenCalledTimes(2)
  })
  it('API de terceiro não é consultada quando prova de sockets recusa',async()=>{
    await media.start();fence.mediaReady.mockResolvedValue(false);expect(await media.waitUntilReady(10)).toBe(false);expect(await media.status()).toEqual([]);expect(fetch).not.toHaveBeenCalled();expect(children[0]!.kill).not.toHaveBeenCalled()
  })
  it('morte/reuso durante fetch não confirma prontidão nem mata PGM existente',async()=>{
    await media.start();fence.mediaReady.mockResolvedValueOnce(true).mockResolvedValueOnce(false);expect(await media.waitUntilReady(500)).toBe(false);expect(fetch).toHaveBeenCalledTimes(1);expect(children[0]!.kill).not.toHaveBeenCalled()
  })
  it('status não atribui paths quando encarnação muda durante leitura da resposta',async()=>{
    await media.start();fence.mediaReady.mockResolvedValueOnce(true).mockResolvedValueOnce(false);expect(await media.status()).toEqual([]);expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('exit antigo não limpa identidade do sucessor, e stop durante preflight impede spawn',async()=>{
    await media.start();const old=children[0]!;old.emit('exit',0,null);await media.start();old.emit('exit',0,null);expect(await media.waitUntilReady(500)).toBe(true);expect(fence.releaseProcess).toHaveBeenCalledTimes(1)
    media.stop();children[1]!.emit('exit',0,null)
    media=new MediaMtx({binary:'fixture-media',configPath:'fixture.yml',bind:'127.0.0.1',logLevel:'warn',hostFence:fence as unknown as HostDistributionFence})
    let done!:()=>void;fence.assertPortsAvailable.mockImplementationOnce(()=>new Promise<void>(resolve=>{done=resolve}));const start=media.start();media.stop();done();await expect(start).rejects.toThrow('encerrado');expect(spawn).toHaveBeenCalledTimes(2)
  })
  it('configuração enfileirada revalida identidade/sockets antes de publicar',async()=>{
    await media.start();await media.apply([],[]);expect(fence.assertPortsAvailable).toHaveBeenLastCalledWith(expect.objectContaining({pid:900003}));expect(writePrivateConfig).toHaveBeenCalledTimes(1)
    fence.assertPortsAvailable.mockRejectedValue(new Error('CHANGED_PORTS'));await expect(media.apply([],[])).rejects.toThrow('CHANGED_PORTS');expect(writePrivateConfig).toHaveBeenCalledTimes(1);expect(children[0]!.kill).not.toHaveBeenCalled()
  })
})
