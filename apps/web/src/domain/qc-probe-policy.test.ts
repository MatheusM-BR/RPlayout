import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe,it,expect} from 'vitest'
import {QcProbePolicy} from '../components/broadcast/QcProbePolicy.js'
describe('política explícita de sondagem no QC',()=>{
  it('perfil rigoroso é distinto de áudio obrigatório',()=>{
    const html=renderToStaticMarkup(createElement(QcProbePolicy,{required:true,onChange:()=>{}}))
    expect(html).toContain('checked=""');expect(html).toContain('Sondagem técnica completa obrigatória');expect(html).toContain('permitir silêncio')
  })
  it('modo legado avisa, não afirma conformidade com sonda inexistente',()=>{
    const html=renderToStaticMarkup(createElement(QcProbePolicy,{required:false}))
    expect(html).toContain('Compatibilidade de legado');expect(html).toContain('não comprova sondagem completa');expect(html).not.toContain('checked=""')
  })
})
