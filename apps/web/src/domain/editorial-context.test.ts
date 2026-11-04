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
import { emptyDayState } from './editorial-context.js'
import { readFileSync } from 'node:fs'
describe('B4: grade em branco criada não volta a dizer "nenhuma grade"',()=>{
  it('dia sem grade, grade vazia e grade com itens são estados distintos',()=>{
    expect(emptyDayState(null)).toBe('NO_GRID')
    expect(emptyDayState({items:[]})).toBe('EMPTY_GRID')
    expect(emptyDayState({items:[{}]})).toBe('HAS_ITEMS')
  })
  it('a criação em branco grava a grade da data selecionada, que vira o contexto editorial do dia',()=>{
    const created={rundown:{id:'blank',date:'2026-11-01',channelId:'ch'},items:[]}
    const active=editorialContext({...loaded,items:[{}]},created,'2026-11-01','ch')
    expect(emptyDayState(active)).toBe('EMPTY_GRID')
    const view=readFileSync(new URL('../views/PlaylistScheduleView.tsx',import.meta.url),'utf8')
    expect(view).toContain("emptyDay === 'EMPTY_GRID' ? `Grade de ${selectedDateFormatted} criada · sem eventos`")
    // "Criar Grade em Branco" só aparece quando não há grade.
    const branch=view.indexOf("{emptyDay === 'EMPTY_GRID' ? (")
    expect(branch).toBeGreaterThan(0)
    expect(view.indexOf('>Criar Grade em Branco<')).toBeGreaterThan(branch)
  })
})
