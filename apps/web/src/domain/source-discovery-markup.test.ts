import {describe,expect,it} from 'vitest'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {SourceDiscoveryCard} from '../components/broadcast/SourceDiscoveryCard.js'
import type {SourceFamily} from '../types.js'

const render=(family?:SourceFamily,loading=false)=>renderToStaticMarkup(createElement(SourceDiscoveryCard,{title:'DeckLink',description:'Consulta no servidor.',family,loading}))
describe('discovery cards do not confuse saved endpoint, runtime and signal',()=>{
  it('saved port never claims detected hardware; runtime failure stays visible',()=>{
    const html=render({available:false,reason:'Plugin ausente',sources:[{reference:'sdi:7',label:'Câmera São João',family:'SDI',discovery:'CONFIGURED'}]})
    expect(html).toContain('NENHUMA DESCOBERTA CONFIRMADA')
    expect(html).toContain('Plugin ausente')
    expect(html).toContain('Cadastrada; descoberta não confirmada')
    expect(html).toContain('Câmera São João')
    expect(html).not.toContain('PORTA DETECTADA')
  })
  it('counts explicit discovery only and retains partial-runtime diagnostics',()=>{
    const html=render({available:true,reason:'Alguma porta não enumerada',sources:[
      {reference:'sdi:0',label:'Porta',family:'SDI',discovery:'DISCOVERED'},
      {reference:'sdi:1',label:'Salva',family:'SDI',discovery:'CONFIGURED'},
      {reference:'sdi:2',label:'Legada',family:'SDI'},
    ]})
    expect(html).toContain('1 DESCOBERTA(S)')
    expect(html).toContain('1 cadastrada(s)')
    expect(html).toContain('Alguma porta não enumerada')
    expect(html).toContain('Origem não confirmada')
    expect(html).toContain('sinal ainda não medido')
  })
  it('unknown and loading states do not diagnose absent card',()=>{
    expect(render()).toContain('DESCOBERTA NÃO CONSULTADA')
    expect(render(undefined,true)).toContain('CONSULTANDO')
    expect(render()).not.toContain('SEM SINAL')
  })
})
