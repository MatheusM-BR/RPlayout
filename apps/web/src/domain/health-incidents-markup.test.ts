import {it,expect} from 'vitest'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {Distribution} from '../components/Distribution.js'

it('acesso de incidentes abre saúde diretamente, sem depender da aba de saídas',()=>{
  const markup=renderToStaticMarkup(createElement(Distribution,{channelId:'a',initialTab:'saude',onClose:()=>{},onMessage:()=>{}}))
  expect(markup).toContain('Eventos Pendentes')
  expect(markup).toContain('Mensagem &amp; Resolução')
  expect(markup).toContain('REGISTROS ANTERIORES')
  expect(markup).toContain('Severidade dos incidentes')
  expect(markup).toContain('Reconhecimento dos incidentes')
  expect(markup).toContain('Consultando incidentes…')
  expect(markup).toContain('Críticos sem reconhecimento: N/D')
  expect(markup).not.toContain('FLUXOS ATIVOS NO SERVIDOR LOCAL')
})

it('acesso legado de distribuição preserva sua aba inicial',()=>{
  const markup=renderToStaticMarkup(createElement(Distribution,{channelId:'a',onClose:()=>{},onMessage:()=>{}}))
  expect(markup).toContain('FLUXOS ATIVOS NO SERVIDOR LOCAL')
  expect(markup).not.toContain('Eventos Pendentes')
})
