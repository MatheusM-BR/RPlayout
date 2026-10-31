import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe,expect,it} from 'vitest'
import type {ManagedLiveSource} from '@rplayout/protocol'
import {LiveReplacementControl} from './LiveReplacementControl.js'

const source=(id:string,role:'PRIMARY'|'BACKUP',paired:string,enabled=true)=>({id,channelId:'ch',name:id==='primary'?'Câmera Principal':'Câmera Reserva',kind:'NDI',targetUrl:'ndi:'+id,role,pairedSourceId:paired,enabled}) as unknown as ManagedLiveSource
const sources=[source('primary','PRIMARY','backup'),source('backup','BACKUP','primary')]
const render=(info:Parameters<typeof LiveReplacementControl>[0]['info'],list=sources)=>renderToStaticMarkup(createElement(LiveReplacementControl,{channelId:'ch',info,sources:list}))
const base={supported:true,selectionUncertain:false,pgmSourceId:'primary',openTransactionId:null}

describe('troca de fonte da live no PGM (markup, sem engine)',()=>{
  it('não aparece no simulador nem com engine sem o protocolo',()=>{
    expect(render(null)).toBe('')
    expect(render({...base,supported:false})).toBe('')
  })
  it('oferece preparar o par reserva habilitado, sem botão de corte antes do preparo',()=>{
    const html=render(base)
    expect(html).toContain('Fonte da live no PGM: Câmera Principal')
    expect(html).toContain('Preparar Câmera Reserva')
    expect(html).not.toContain('Cortar fonte')
  })
  it('sem par habilitado não inventa alternativa',()=>{
    const html=render(base,[sources[0]!,source('backup','BACKUP','primary',false)])
    expect(html).toContain('Sem par reserva habilitado')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Sem par reserva habilitado/)
  })
  it('seleção inconclusiva bloqueia novo preparo e avisa',()=>{
    const html=render({...base,selectionUncertain:true})
    expect(html).toContain('Seleção nativa inconclusiva')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Preparar Câmera Reserva/)
  })
  it('transação aberta no servidor oferece consultar/cancelar; corte só depois de READY nesta tela',()=>{
    const html=render({...base,openTransactionId:'A'.repeat(43)})
    expect(html).toContain('Consultar');expect(html).toContain('Cancelar')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Cortar fonte/)
    expect(html).not.toContain('Preparar Câmera Reserva')
  })
  it('transação pendente continua visível mesmo se o engine atual não anuncia o protocolo',()=>{
    expect(render({...base,supported:false,openTransactionId:'A'.repeat(43)})).toContain('Consultar')
  })
})
