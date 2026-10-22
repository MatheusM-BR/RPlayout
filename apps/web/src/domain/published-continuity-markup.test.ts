import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe,expect,it } from 'vitest'
import { PublishedContinuityPanel } from '../components/broadcast/PublishedContinuityPanel.js'
describe('política recorrente exige habilitação explícita',()=>{
  it('não autoriza ao renderizar e informa limites da automação',()=>{
    const html=renderToStaticMarkup(createElement(PublishedContinuityPanel,{channelId:'ch'}))
    expect(html).toContain('Desligada por padrão');expect(html).toContain('STOP suspende')
    expect(html).toContain('Não monta ou publica rascunhos');expect(html).toContain('não garante 48h')
    for(const label of ['CONFERIR CONTINUIDADE','HABILITAR PASSAGENS RECORRENTES','DESLIGAR CONTINUIDADE'])expect(html).toMatch(new RegExp(`disabled=""[^>]*>${label}`))
  })
})
