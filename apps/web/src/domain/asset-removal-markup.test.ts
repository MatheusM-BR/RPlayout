import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe,expect,it} from 'vitest'
import {AssetRemovalDialog} from '../components/AssetRemovalDialog.js'
describe('SSR de remoção não é validação visual no navegador',()=>{
  it.each(['asset:ç',null])('inicia bloqueado e não presume acervo vazio %s',assetId=>{
    const html=renderToStaticMarkup(createElement(AssetRemovalDialog,{assetId,onApplied:()=>{},onCancel:()=>{}}))
    expect(html).toContain('Impacto não conferido');expect(html).toContain('<fieldset disabled=""');expect(html).toContain('Confirmar remoção conferida');expect(html).toContain('Reabrir impacto');expect(html).toContain('não executa CUE ou TAKE')
  })
})
