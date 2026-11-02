import {describe,it,expect} from 'vitest'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {AuxiliaryAudioPairsEditor} from '../components/broadcast/AuxiliaryAudioPairsEditor.js'
describe('configuração explícita dos auxiliares',()=>{
  it('estéreo não inventa canais e explica como habilitar',()=>{
    const html=renderToStaticMarkup(createElement(AuxiliaryAudioPairsEditor,{channels:2,pairs:[],onChange:()=>{}}))
    expect(html).toContain('Canal estéreo');expect(html).not.toContain('<select');expect(html).not.toContain('SAP')
  })
  it('8/16 oferecem todos os pares, sem nomes presumidos ou atribuição automática',()=>{
    for(const channels of [8,16] as const){
      const html=renderToStaticMarkup(createElement(AuxiliaryAudioPairsEditor,{channels,pairs:[{outputPair:2,inputPair:2,gainDb:-6}],inputChannels:4,onChange:()=>{}}))
      expect(html.match(/<select /g)).toHaveLength(channels/2-1)
      expect(html).toContain('Sem atribuição (silêncio)');expect(html).toContain('indisponível');expect(html).toContain('value="-6"');expect(html).not.toContain('Clean Feed')
    }
  })
})
