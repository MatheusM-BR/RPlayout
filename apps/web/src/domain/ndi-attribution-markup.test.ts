import {describe,it,expect} from 'vitest'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {NdiAttribution} from '../components/broadcast/NdiAttribution.js'
import {SourceDiscoveryCard} from '../components/broadcast/SourceDiscoveryCard.js'

describe('NDI attribution without certification claims',()=>{
  it('links the vendor and names the trademark owner safely',()=>{
    const html=renderToStaticMarkup(createElement(NdiAttribution))
    expect(html).toContain('href="https://ndi.video/"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).toContain('NDI®')
    expect(html).toContain('Vizrt NDI AB')
    expect(html).not.toMatch(/certified|homologado/i)
  })
  it('keeps attribution visible even when NDI discovery is unavailable',()=>{
    const html=renderToStaticMarkup(createElement(SourceDiscoveryCard,{title:'NDI',description:'Fontes',family:undefined,ndi:true}))
    expect(html).toContain('DESCOBERTA NÃO CONSULTADA')
    expect(html).toContain('href="https://ndi.video/"')
  })
})
