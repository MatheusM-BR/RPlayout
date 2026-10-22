import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe,expect,it} from 'vitest'
import {AssetMetadataEditor} from '../components/AssetMetadataEditor.js'
describe('SSR de metadata não é validação visual de navegador',()=>{
  it('começa bloqueado sem presumir acervo vazio e distingue editar de salvar',()=>{
    const html=renderToStaticMarkup(createElement(AssetMetadataEditor,{assetId:'asset:ç',categories:['Notícias'],onSaved:()=>{},onCancel:()=>{}}))
    expect(html).toContain('Arquivo não conferido');expect(html).toContain('<fieldset disabled=""');expect(html).toContain('Reabrir conferência do arquivo');expect(html).toContain('disabled="">Salvar metadados conferidos');expect(html).toContain('Editar não grava nem aprova no QC')
  })
})
