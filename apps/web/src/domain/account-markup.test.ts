import {describe,expect,it} from 'vitest'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {UsersPanel} from '../components/UsersPanel.js'
describe('administração começa bloqueada sem inventar ausência de contas',()=>{
  it('SSR não anuncia catálogo vazio nem libera criação antes de conferir',()=>{
    const html=renderToStaticMarkup(createElement(UsersPanel,{onMessage:()=>{}}))
    expect(html).toContain('Contas não conferidas');expect(html).not.toContain('Nenhuma conta cadastrada nesta conferência');expect(html).toMatch(/<fieldset disabled=""/);expect(html).toContain('Reabrir conferência das contas');expect(html).toContain('type="password"')
  })
})
