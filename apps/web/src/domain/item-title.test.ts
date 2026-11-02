import {describe,expect,it} from 'vitest'
import {itemDisplayTitle} from './item-title.js'
describe('título exibido da linha da grade',()=>{
  it('ao vivo sem mídia mostra o título da grade, não o ID',()=>{
    expect(itemDisplayTitle({item:{id:'38abf5fd-521c',title:'Leilão ao vivo'},asset:null})).toBe('Leilão ao vivo')
  })
  it('VT mantém o título da mídia; sem nada usa o ID; sem item usa o texto padrão',()=>{
    expect(itemDisplayTitle({item:{id:'x',title:'linha'},asset:{title:'Mídia'}})).toBe('Mídia')
    expect(itemDisplayTitle({item:{id:'x',title:''},asset:null})).toBe('x')
    expect(itemDisplayTitle(null,'Nenhum item em reprodução')).toBe('Nenhum item em reprodução')
  })
})
