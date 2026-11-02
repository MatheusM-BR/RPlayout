import {renderToStaticMarkup} from 'react-dom/server'
import {createElement} from 'react'
import {describe,expect,it} from 'vitest'
import {SharedMultiview} from '../components/broadcast/SharedMultiview.js'
describe('markup multiview conferido não equivale a homologação de navegador',()=>{
  it('antes de conferir bloqueia gravação/layout e oferece reabertura explícita',()=>{
    const html=renderToStaticMarkup(createElement(SharedMultiview,{channelId:'a',sources:[],onWatchingBus:()=>{}}))
    expect(html).toContain('Salvar layout no canal');expect(html).toContain('Reabrir conferência');expect(html).toContain('não da configuração salva')
    expect(html).toMatch(/disabled=""[^>]*>Salvar layout no canal/)
    expect(html).toContain('Conferindo layout salvo')
  })
})
