import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe,expect,it} from 'vitest'
import {SchedulePublicationPanel} from '../components/broadcast/SchedulePublicationPanel.js'
describe('controle editorial recorrente sem autorização implícita',()=>{
  it('inicia recolhido e não presume política desligada antes da resposta do servidor',()=>{
    const html=renderToStaticMarkup(createElement(SchedulePublicationPanel,{channelId:'ch'}))
    expect(html).toContain('CONSULTANDO ESTADO');expect(html).not.toContain('DESLIGADA');expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('HABILITAR MONTAGEM E PUBLICAÇÃO')
  })
  it('conferência e habilitação indisponíveis até carregar direitos/status, com limites claros',()=>{
    const html=renderToStaticMarkup(createElement(SchedulePublicationPanel,{channelId:'ch',defaultOpen:true}))
    expect(html).toContain('Pauta deve cobrir 24h nos sete dias')
    expect(html).toContain('Grades existentes nunca são substituídas')
    expect(html).toContain('Publicar não muda PGM/CUE')
    expect(html.match(/disabled=""/g)).toHaveLength(3)
  })
})
