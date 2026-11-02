import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe,it,expect} from 'vitest'
import {CanonicalProtocolSelector} from './CanonicalProtocolSelector.js'

describe('seleção OMT não é escondida antes da consulta de descoberta',()=>{
  it('NDI salvo fica visível no campo manual antes da descoberta',()=>{
    const html=renderToStaticMarkup(createElement(CanonicalProtocolSelector,{mode:'INPUT',defaultKind:'NDI',initialUri:'ndi:Estúdio Çãó',onChange:()=>{}}))
    expect(html).toContain('value="Estúdio Çãó"')
  })
  it('mostra referência salva mesmo sem lista e não exibe outra fonte',()=>{
    const html=renderToStaticMarkup(createElement(CanonicalProtocolSelector,{mode:'INPUT',defaultKind:'OMT',initialUri:'omt:Estúdio Çãó',onChange:()=>{}}))
    expect(html).toContain('seleção anterior; não listada nesta consulta')
    expect(html).toContain('value="omt:Estúdio Çãó" selected=""')
    expect(html).not.toContain('Nenhuma fonte OMT encontrada')
  })
})
