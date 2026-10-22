import {describe,it,expect,vi} from 'vitest'
import {publicationSnapshot} from './publication-snapshot.js'
import type {Snapshot} from '../types.js'

const snapshot={view:{rundown:{id:'rd'}}} as Snapshot
const fixture=(same=true)=>({revision:7,rundownId:'rd',loadedRundownId:same?'rd':'other',current:vi.fn(()=>true),read:vi.fn(async()=>snapshot),load:vi.fn(async()=>snapshot)})
function deferred(){let resolve!:(value:Snapshot)=>void;const promise=new Promise<Snapshot>(done=>resolve=done);return {promise,resolve}}
describe('snapshot posterior não desfaz uma publicação gravada',()=>{
  it('grade já carregada só consulta; não envia outra carga',async()=>{
    const options=fixture();expect(await publicationSnapshot(options)).toBe(snapshot)
    expect(options.read).toHaveBeenCalledOnce();expect(options.load).not.toHaveBeenCalled()
  })
  it('outra data só carrega uma vez, depois de conferir a seleção',async()=>{
    const options=fixture(false);expect(await publicationSnapshot(options)).toBe(snapshot)
    expect(options.load).toHaveBeenCalledOnce();expect(options.read).not.toHaveBeenCalled();expect(options.current).toHaveBeenCalledTimes(2)
  })
  it('seleção já mudou: não consulta nem carrega a outra grade',async()=>{
    const options=fixture(false);options.current.mockReturnValue(false)
    await expect(publicationSnapshot(options)).rejects.toThrow('Revisão 7 gravada')
    expect(options.read).not.toHaveBeenCalled();expect(options.load).not.toHaveBeenCalled()
  })
  it.each([true,false])('mudança enquanto aguarda resposta impede instalação (mesma grade=%s)',async same=>{
    const options=fixture(same),pending=deferred();(same?options.read:options.load).mockImplementation(()=>pending.promise)
    const result=publicationSnapshot(options);options.current.mockReturnValue(false);pending.resolve(snapshot)
    await expect(result).rejects.toThrow('a resposta não foi aplicada à tela atual')
  })
  it.each([true,false])('falha depois do commit nunca se apresenta como publicação recusada (mesma grade=%s)',async same=>{
    const options=fixture(same);(same?options.read:options.load).mockRejectedValue(new Error('Leitura indisponível'))
    await expect(publicationSnapshot(options)).rejects.toThrow('Revisão 7 gravada; sincronização com o Master não confirmada: Leitura indisponível')
    expect(options.read.mock.calls.length+options.load.mock.calls.length).toBe(1)
  })
})
