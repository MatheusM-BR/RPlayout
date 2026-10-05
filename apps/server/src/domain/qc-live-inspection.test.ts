import {describe,expect,it,vi} from 'vitest'
import {QcLiveInspection} from './qc-live-inspection.js'

describe('inspeção live por viewer/fonte sem comandos de transporte',()=>{
  it('só abre a fonte que continua no PVW e renova a concessão nativa',async()=>{
    const set=vi.fn().mockResolvedValue(undefined),qc=new QcLiveInspection(()=> 'ndi:ESTÚDIO',set)
    await expect(qc.watch('one','omt:OUTRA',true)).rejects.toThrow('preview ativo')
    expect(set).not.toHaveBeenCalled()
    await qc.watch('one','ndi:ESTÚDIO',true);await qc.watch('one','ndi:ESTÚDIO',true)
    expect(set.mock.calls.map(([source,on])=>[source,on])).toEqual([['ndi:ESTÚDIO',true],['ndi:ESTÚDIO',true]])
  })
  it('fechar uma janela não desliga a outra e off estrangeiro não revoga lease',async()=>{
    const set=vi.fn().mockResolvedValue(undefined),qc=new QcLiveInspection(()=> 'omt:LIVE',set)
    await qc.watch('session-a:1','omt:LIVE',true);await qc.watch('session-b:2','omt:LIVE',true)
    await qc.watch('session-b:1','omt:LIVE',false);await qc.watch('session-a:1','omt:LIVE',false)
    expect(set.mock.calls.filter(([,on])=>!on)).toHaveLength(0)
    await qc.watch('session-b:2','omt:LIVE',false)
    expect(set.mock.calls.at(-1)).toEqual(['omt:LIVE',false])
  })
  it('lease sem heartbeat expira sem desligar PGM/PVW',async()=>{
    let now=0
    const set=vi.fn().mockResolvedValue(undefined),qc=new QcLiveInspection(()=> 'sdi:0',set,()=>now)
    await qc.watch('one','sdi:0',true);now=14_999;await qc.tick();expect(set).toHaveBeenCalledTimes(1)
    now=15_000;await qc.tick();await qc.tick();expect(set.mock.calls.map(([source,on])=>[source,on])).toEqual([['sdi:0',true],['sdi:0',false]])
  })
  it('troca de CUE descarta leases antigas, não abre nem apaga a fonte nova',async()=>{
    let source:string|null='ndi:A'
    const set=vi.fn().mockResolvedValue(undefined),qc=new QcLiveInspection(()=>source,set)
    await qc.watch('one','ndi:A',true);source='ndi:B';await qc.tick()
    await expect(qc.watch('one','ndi:A',true)).rejects.toThrow('preview ativo')
    await qc.watch('one','ndi:A',false);expect(set).toHaveBeenCalledTimes(1)
    await qc.watch('two','ndi:B',true);source=null;await qc.tick();expect(set).toHaveBeenCalledTimes(2)
  })
  it('ACK de ativação depois de mudar a fonte não instala lease na seleção nova',async()=>{
    let source='ndi:A',release!:()=>void
    const pending=new Promise<void>(resolve=>release=resolve),set=vi.fn(()=>pending),qc=new QcLiveInspection(()=>source,set)
    const opening=qc.watch('one','ndi:A',true),refused=expect(opening).rejects.toThrow('preview mudou')
    await vi.waitFor(()=>expect(set).toHaveBeenCalled());source='ndi:B';release();await refused
    await qc.tick();expect(set).toHaveBeenCalledTimes(1)
  })
  it('off durante abertura fica na fila e encerra a própria ativação após ACK',async()=>{
    let release!:()=>void
    const set=vi.fn().mockImplementationOnce(()=>new Promise<void>(resolve=>release=resolve)).mockResolvedValue(undefined)
    const qc=new QcLiveInspection(()=> 'ndi:A',set)
    const on=qc.watch('one','ndi:A',true);await vi.waitFor(()=>expect(set).toHaveBeenCalled())
    const off=qc.watch('one','ndi:A',false);release();await on;await off
    expect(set.mock.calls.map(([source,on])=>[source,on])).toEqual([['ndi:A',true],['ndi:A',false]])
  })
  it('falha de ACK não instala lease e tick não acumula operações pendentes',async()=>{
    const set=vi.fn().mockRejectedValue(new Error('sem quadro')),qc=new QcLiveInspection(()=> 'ndi:A',set)
    await expect(qc.watch('one','ndi:A',true)).rejects.toThrow('sem quadro')
    await qc.tick();expect(set).toHaveBeenCalledTimes(1)
    const a=qc.tick(),b=qc.tick();expect(a).toBe(b);await a
  })
  it('limita janelas, permite renovação e libera capacidade por expiração',async()=>{
    let now=0
    const set=vi.fn().mockResolvedValue(undefined),qc=new QcLiveInspection(()=> 'ndi:A',set,()=>now)
    for(let n=0;n<16;n++)await qc.watch(String(n),'ndi:A',true)
    await expect(qc.watch('extra','ndi:A',true)).rejects.toThrow('Limite')
    await qc.watch('0','ndi:A',true);now=15_000;await qc.watch('extra','ndi:A',true)
    expect(set).toHaveBeenCalledTimes(18)
  })
  it('permissão revogada enquanto aguarda outra janela é reconferida antes de abrir',async()=>{
    let release!:()=>void,allowed=true
    const set=vi.fn().mockImplementationOnce(()=>new Promise<void>(resolve=>release=resolve)).mockResolvedValue(undefined)
    const qc=new QcLiveInspection(()=> 'ndi:A',set),first=qc.watch('one','ndi:A',true)
    await vi.waitFor(()=>expect(set).toHaveBeenCalled())
    const second=qc.watch('two','ndi:A',true,()=>{if(!allowed)throw new Error('revogada')}),refused=expect(second).rejects.toThrow('revogada')
    allowed=false;release();await first;await refused;expect(set).toHaveBeenCalledTimes(1)
  })
})
