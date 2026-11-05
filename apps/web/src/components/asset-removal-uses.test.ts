import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { AssetUsesSummary, groupAssetUses } from './AssetRemovalDialog.js'

const use=(i:number,rundownName:string,action='REMOVE_ITEM')=>({itemId:'i'+i,channelName:'RW',rundownName,itemTitle:'Abertura de Sinal - 2024',action})

describe('conferência de remoção do acervo com muitos usos', () => {
  it('agrupa o mesmo item repetido na mesma grade com a contagem', () => {
    const uses=[...Array.from({length:40},(_,i)=>use(i,'Grade — RW — 2026-10-27')),use(99,'Grade — RW')]
    const groups=groupAssetUses(uses)
    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({rundownName:'Grade — RW — 2026-10-27',count:40})
  })
  it('mostra no máximo 8 grupos e resume o resto sem perder o total', () => {
    const uses=Array.from({length:300},(_,i)=>use(i,'Grade '+(i%20)))
    const html=renderToStaticMarkup(createElement(AssetUsesSummary,{uses}))
    expect(html).toContain('300 item(ns) em 20 grade(s)')
    expect((html.match(/<li/g)??[]).length).toBe(8)
    expect(html).toContain('e mais 180 item(ns) em 12 outra(s) grade(s)')
  })
})
