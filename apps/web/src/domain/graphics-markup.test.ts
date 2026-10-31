import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe,expect,it} from 'vitest'
import {GraphicsPanel} from '../components/GraphicsPanel.js'
import {GraphicTemplatesEditor} from '../components/GraphicTemplatesEditor.js'
describe('markup de artes não é homologação visual de navegador',()=>{
  it('painel inicial não considera falha como lista vazia, nem permite disparo cego',()=>{
    const html=renderToStaticMarkup(createElement(GraphicsPanel,{channelId:'a',slateTemplateId:null,onAir:null,onClose:()=>{},onMessage:()=>{}}))
    expect(html).toContain('Artes ainda não conferidas');expect(html).not.toContain('Nenhuma arte cadastrada');expect(html).toContain('Reabrir conferência das artes');expect(html).toContain('disabled="">pôr no ar')
  })
  it('cadastro mantém SVG no textarea e bloqueia escrita até conferir',()=>{
    const html=renderToStaticMarkup(createElement(GraphicTemplatesEditor,{channelId:'a',onMutation:()=>{},onMessage:()=>{}}))
    expect(html).toContain('<fieldset disabled=""');expect(html).toContain('<textarea');expect(html).toContain('&lt;svg');expect(html).not.toContain('<svg');expect(html).toContain('Reabrir conferência das artes');expect(html).toContain('Gravar não homologa')
  })
})
