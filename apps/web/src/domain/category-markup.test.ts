import {it,expect} from 'vitest'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {CategoryEditor} from '../components/CategoryEditor.js'
import {CategoriasPanel} from '../components/CategoriasPanel.js'
it('estado inicial não permite salvar/remover categoria sem revisão original',()=>{
  const markup=renderToStaticMarkup(createElement(CategoryEditor,{id:'AÇÃO',onSaved:()=>{},onCancel:()=>{}}))
  expect(markup).toContain('ainda não conferida');expect(markup).toContain('Reabrir conferência')
  expect(markup).toMatch(/disabled=""[^>]*>Salvar cor conferida/);expect(markup).toMatch(/disabled=""[^>]*>Remover categoria conferida/)
})
it('lista ainda não lida não é apresentada como categorias vazias',()=>{
  const markup=renderToStaticMarkup(createElement(CategoriasPanel,{onMessage:()=>{},onChanged:()=>{}}))
  expect(markup).toContain('ainda não conferidas');expect(markup).not.toContain('Nenhuma categoria ainda')
})
