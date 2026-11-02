import {it,expect} from 'vitest'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {PastasPanel} from '../components/PastasPanel.js'
it('consulta ausente não presume acervo vazio; seletor do servidor é apresentado na página',()=>{
  const markup=renderToStaticMarkup(createElement(PastasPanel,{onMessage:()=>{},onChanged:()=>{}}))
  expect(markup).toContain('Lista ainda não conferida');expect(markup).toContain('CONFERIR LISTA DE PASTAS');expect(markup).toContain('NAVEGAR NO SERVIDOR')
  expect(markup).not.toContain('Remover conferida');expect(markup).not.toContain('USAR PASTA CONFERIDA')
})
