import { describe,expect,it } from 'vitest'
import { editorialContext, editorialSelection } from './editorial-context.js'
const loaded={rundown:{id:'yesterday',date:'2026-09-30',channelId:'ch'}}
const today={rundown:{id:'today',date:'2026-10-01',channelId:'ch'}}
describe('calendário não confunde hoje com a execução carregada',()=>{
  it('usa a grade da data real após meia-noite, sem fallback para ontem',()=>{
    expect(editorialContext(loaded,today,'2026-10-01','ch')).toBe(today)
    expect(editorialContext(loaded,null,'2026-10-01','ch')).toBeNull()
  })
  it('prefere a grade carregada apenas quando data/canal coincidem',()=>{
    expect(editorialContext(loaded,today,'2026-09-30','ch')).toBe(loaded)
    expect(editorialContext(loaded,today,'2026-10-01','outro')).toBeNull()
  })
  it('descarta uma resposta atrasada de outra data',()=>{
    expect(editorialContext(loaded,today,'2026-10-02','ch')).toBeNull()
  })
  it('não autoriza remoção enquanto a nova data não está carregada',()=>{
    expect(editorialSelection(null,['ontem'])).toEqual([])
  })
  it('descarta seleção de outra grade e duplicatas antes de editar',()=>{
    expect(editorialSelection({items:[{item:{id:'hoje'}}]},['ontem','hoje','hoje'])).toEqual(['hoje'])
  })
})
