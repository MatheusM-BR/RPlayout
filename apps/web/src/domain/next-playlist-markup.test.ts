import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe,expect,it} from 'vitest'
import {NextPlaylistPanel} from '../components/broadcast/NextPlaylistPanel.js'

describe('Master disponibiliza passagem conferida sem autorizar ao abrir',()=>{
  it('painel é recolhido por padrão e não executa confirmação no render',()=>{
    const html=renderToStaticMarkup(createElement(NextPlaylistPanel,{channelId:'ch'}))
    expect(html).toContain('PRÓXIMA GRADE');expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('ENFILEIRAR AO FIM DA GRADE')
  })
  it('conferir/enfileirar/cancelar ficam inativos sem origem, revisão ou permissão',()=>{
    const html=renderToStaticMarkup(createElement(NextPlaylistPanel,{channelId:'ch',defaultOpen:true}))
    expect(html).toContain('STOP cancela a fila');expect(html).toContain('não monta nem publica outras grades')
    for(const label of ['CONFERIR PASSAGEM','ENFILEIRAR AO FIM DA GRADE','CANCELAR PASSAGEM']) expect(html).toMatch(new RegExp(`disabled=""[^>]*>${label}`))
    expect(html).not.toContain('RECONHECER INCERTEZA COM CANAL PARADO')
  })
})
