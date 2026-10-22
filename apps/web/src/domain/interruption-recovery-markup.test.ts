import {renderToStaticMarkup} from 'react-dom/server'
import {createElement} from 'react'
import {expect,it} from 'vitest'
import type {Channel} from '@rplayout/protocol'
import {UnavailableChannelReturns} from '../components/broadcast/UnavailableChannelReturns.js'
it('oferece conferência dos canais sem depender de grade/live carregados ou prometer TAKE',()=>{
  const channels=[{id:'ch',name:'Canal ÇÃO',rate:{num:25,den:1}},{id:'other',name:'Outro canal',rate:{num:30,den:1}}] as Channel[]
  const html=renderToStaticMarkup(createElement(UnavailableChannelReturns,{channels}))
  expect(html).toContain('Retornos pendentes dos canais');expect(html).toContain('Canal ÇÃO');expect(html).toContain('Outro canal')
  expect(html).toContain('não inicia o PGM nem repete TAKE');expect(html).toContain('não são liberados automaticamente')
  expect(renderToStaticMarkup(createElement(UnavailableChannelReturns,{channels:[]}))).toBe('')
})
