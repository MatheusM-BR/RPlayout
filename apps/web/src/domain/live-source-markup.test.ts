import {describe,expect,it} from 'vitest'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {EntradasAoVivoPanel} from '../components/EntradasAoVivoPanel.js'
const channel={id:'a',name:'A',rate:{num:25,den:1},width:320,height:180} as Parameters<typeof EntradasAoVivoPanel>[0]['channel']
describe('markup de cadastro não promete sinal nem troca implícita',()=>{
  it('oferece reabertura explícita e distingue descoberta de quadro real',()=>{
    const html=renderToStaticMarkup(createElement(EntradasAoVivoPanel,{channel,onMessage:()=>{}}))
    expect(html).toContain('Reabrir lista')
    expect(html).toContain('Cadastro não troca o PGM/PVW. Descoberta não confirma sinal.')
    expect(html).toContain('o sinal só é confirmado após CUE no PVW')
  })
})
