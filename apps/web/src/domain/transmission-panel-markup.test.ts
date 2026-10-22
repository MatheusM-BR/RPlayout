import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe,expect,it} from 'vitest'
import {SaidasTransmissaoPanel} from '../components/SaidasTransmissaoPanel.js'
import type {Channel} from '@rplayout/protocol'
const channel:Channel={id:'ch',name:'Aprovação',width:1920,height:1080,rate:{num:25,den:1},scan:'PROGRESSIVE',fieldOrder:'TFF',targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,programSdiDeviceId:null,slateTemplateId:null,createdAt:'now',configurationRevision:42}
describe('consulta de saídas não simula disponibilidade',()=>{
  it('primeiro render aguarda snapshot e oferece reabertura explícita em vez de atestar entrega',()=>{
    const html=renderToStaticMarkup(createElement(SaidasTransmissaoPanel,{channel,onMessage:()=>{},onChanged:()=>{}}))
    expect(html).toContain('Consultando saídas…')
    expect(html).not.toContain('Nenhuma saída configurada')
    expect(html).toContain('REABRIR CONFIGURAÇÃO E LIMPAR RASCUNHO')
    expect(html).toContain('Atualizar a lista não reconfirma seu rascunho')
    expect(html).toContain('<fieldset disabled=""')
    expect(html).not.toContain('ATIVO NO AR');expect(html).not.toContain('prontas para transmissão imediata')
  })
})
