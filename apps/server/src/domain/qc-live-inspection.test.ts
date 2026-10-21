import {describe,expect,it,vi} from 'vitest'
import {QcLiveInspection} from './qc-live-inspection.js'

const setup=(now=()=>0)=>{
  const open=vi.fn<(source:string|null)=>Promise<void>>().mockResolvedValue(undefined)
  const set=vi.fn<(source:string,on:boolean)=>Promise<void>>().mockResolvedValue(undefined)
  return {open,set,qc:new QcLiveInspection(open,set,now)}
}

describe('inspeção ao vivo no decodificador próprio do QC (sem tocar o PVW)',()=>{
  it('abre a fonte no decodificador do QC uma vez e renova a concessão nativa',async()=>{
    const {open,set,qc}=setup()
    await qc.watch('one','ndi:ESTÚDIO',true);await qc.watch('one','ndi:ESTÚDIO',true)
    expect(open.mock.calls).toEqual([['ndi:ESTÚDIO',expect.any(Function)]])
    expect(set.mock.calls.map(([source,on])=>[source,on])).toEqual([['ndi:ESTÚDIO',true],['ndi:ESTÚDIO',true]])
    expect(qc.inspecting()).toEqual({source:'ndi:ESTÚDIO',viewers:1})
  })
  it('fechar uma janela não desliga a outra; a última fecha monitor e decodificador',async()=>{
    const {open,set,qc}=setup()
    await qc.watch('a','omt:LIVE',true);await qc.watch('b','omt:LIVE',true)
    await qc.watch('a','omt:LIVE',false)
    expect(set.mock.calls.filter(([,on])=>!on)).toHaveLength(0);expect(open).toHaveBeenCalledTimes(1)
    await qc.watch('b','omt:LIVE',false)
    expect(set.mock.calls.at(-1)).toEqual(['omt:LIVE',false]);expect(open.mock.calls.at(-1)).toEqual([null])
    expect(qc.inspecting()).toBeNull()
  })
  it('lease sem heartbeat expira e fecha o decodificador do QC',async()=>{
    let now=0
    const {open,set,qc}=setup(()=>now)
    await qc.watch('one','sdi:0',true);now=14_999;await qc.tick();expect(open).toHaveBeenCalledTimes(1)
    now=15_000;await qc.tick();await qc.tick()
    expect(set.mock.calls.map(([source,on])=>[source,on])).toEqual([['sdi:0',true],['sdi:0',false]])
    expect(open.mock.calls.at(-1)).toEqual([null])
  })
  it('a mesma janela troca de entrada; outro operador não é derrubado',async()=>{
    const {open,qc}=setup()
    await qc.watch('one','ndi:A',true);await qc.watch('one','ndi:B',true)
    expect(open.mock.calls.map(([source])=>source)).toEqual(['ndi:A','ndi:B'])
    await qc.watch('two','ndi:B',true)
    await expect(qc.watch('one','ndi:C',true)).rejects.toThrow('Outro QC')
    expect(qc.inspecting()).toEqual({source:'ndi:B',viewers:2})
  })
  it('fonte lenta: a lease fica enquanto aguarda o primeiro quadro; não reabre a cada renovação',async()=>{
    const {open,set,qc}=setup()
    set.mockRejectedValueOnce(new Error('aguardando quadro válido')).mockRejectedValueOnce(new Error('aguardando quadro válido'))
    await expect(qc.watch('one','ndi:A',true)).rejects.toThrow('aguardando')
    await qc.tick()
    await expect(qc.watch('one','ndi:A',true)).rejects.toThrow('aguardando')
    await qc.watch('one','ndi:A',true)
    expect(open).toHaveBeenCalledTimes(1)
  })
  it('falha ao abrir o decodificador não deixa fonte ativa',async()=>{
    const {open,qc}=setup()
    open.mockRejectedValueOnce(new Error('fonte recusada'))
    await expect(qc.watch('one','ndi:A',true)).rejects.toThrow('fonte recusada')
    expect(qc.inspecting()).toBeNull()
    await qc.watch('one','ndi:A',true);expect(qc.inspecting()).toEqual({source:'ndi:A',viewers:1})
  })
  it('limita janelas, permite renovação e libera capacidade por expiração',async()=>{
    let now=0
    const {qc}=setup(()=>now)
    for(let n=0;n<16;n++)await qc.watch(String(n),'ndi:A',true)
    await expect(qc.watch('extra','ndi:A',true)).rejects.toThrow('Limite')
    await qc.watch('0','ndi:A',true);now=15_000;await qc.watch('extra','ndi:A',true)
  })
  it('permissão revogada enquanto aguarda outra janela é reconferida antes de abrir',async()=>{
    let release!:()=>void,allowed=true
    const {set,qc}=setup()
    set.mockImplementationOnce(()=>new Promise<void>(resolve=>release=resolve))
    const first=qc.watch('one','ndi:A',true)
    await vi.waitFor(()=>expect(set).toHaveBeenCalled())
    const second=qc.watch('two','ndi:A',true,()=>{if(!allowed)throw new Error('revogada')}),refused=expect(second).rejects.toThrow('revogada')
    allowed=false;release();await first;await refused;expect(set).toHaveBeenCalledTimes(1)
  })
  it('tick concorrente não acumula operações',async()=>{
    const {qc}=setup()
    const a=qc.tick(),b=qc.tick();expect(a).toBe(b);await a
  })
})
