import {describe,expect,it} from 'vitest'
import {renderToStaticMarkup} from 'react-dom/server'
import {createElement} from 'react'
import {OperationalMultiview,type MultiviewSourceItem} from '../components/broadcast/OperationalMultiview.js'

describe('live degradation warning remains visible alongside shared video',()=>{
  it.each(['UNSTABLE','NO_AUDIO'] as const)('shows %s without hiding PGM',signalStatus=>{
    const source:MultiviewSourceItem={id:'live',name:'Câmara',role:'PRIMARY',kind:'NDI',targetUrl:'ndi:CAM',format:'1920×1080',fps:25,tally:'ON_AIR',syncState:'DRIFT',signalStatus,signalLabel:'AVISO',signalMessage:'Medição degradada no decoder',monitorBus:'mon',whepPath:'ch/monitor',whepPort:8889}
    const html=renderToStaticMarkup(createElement(OperationalMultiview,{sources:[source]}))
    expect(html).toContain('role="status"')
    expect(html).toContain('Medição degradada no decoder')
    expect(html).toContain('PGM COMPARTILHADO')
    expect(html).toContain('NO PGM')
  })
})
