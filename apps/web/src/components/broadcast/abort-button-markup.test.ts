import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe,expect,it} from 'vitest'
import {AbortButton,transportColumns} from './AbortButton.js'

describe('B6: texto do ABORT armado cabe no botão',()=>{
  const render=(armed:boolean)=>renderToStaticMarkup(createElement(AbortButton,{armed,countdown:2,canStop:true,deniedTitle:'x',onClick:()=>{}}))
  it('armado: duas linhas curtas, sem quebra no meio, recortadas dentro do botão',()=>{
    const html=render(true)
    expect(html).toContain('CONFIRMAR 2s</span>')
    expect(html).toContain('Esc cancela</span>')
    expect(html).toContain('overflow-hidden')
    expect(html).not.toContain('CONFIRMAR 2s · Esc cancela')
  })
  it('armado, o ABORT ganha colunas à esquerda e o grid continua com 12',()=>{
    for(const armed of [false,true]){const c=transportColumns(armed);const n=[c.take,c.cue,c.abort].map(x=>Number(x.replace('col-span-','')));expect(n.reduce((a,b)=>a+b)).toBe(12)}
    expect(transportColumns(true).abort).toBe('col-span-5')
    expect(render(true)).toContain('col-span-5')
    expect(render(false)).toContain('col-span-2')
  })
})
