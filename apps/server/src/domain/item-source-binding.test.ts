import {describe,expect,it} from 'vitest'
import type {Db} from '../db/client.js'
import {configuredSourceEndpoint,requireItemSourceBinding} from './item-source-binding.js'

const row={id:'one',channelId:'a',kind:'NDI',targetUrl:'Câmera São José',name:'Entrada Óscar',enabled:true}
const reader=(value:unknown)=>({select:()=>({from:()=>({where:()=>({get:()=>value})})})}) as unknown as Db
describe('explicit configured selection',()=>{
  it('preserves Unicode and normalizes only protocol prefix',()=>{
    expect(configuredSourceEndpoint(row)).toBe('ndi:Câmera São José')
    expect(configuredSourceEndpoint({...row,targetUrl:'ndi:Câmera São José'})).toBe('ndi:Câmera São José')
    expect(configuredSourceEndpoint({kind:'OMT',targetUrl:'Estúdio Óscar'})).toBe('omt:Estúdio Óscar')
    expect(configuredSourceEndpoint({kind:'SRT',targetUrl:'srt://host:9000?passphrase=private'})).toBe('srt://host:9000?passphrase=private')
  })
  it('returns selected catalog identity and name, not arbitrary same-endpoint identity',()=>{
    expect(requireItemSourceBinding(reader(row),'a','one','ndi:Câmera São José','LIVE')).toBe(row)
    const other={...row,id:'two',name:'Outra entrada'}
    expect(requireItemSourceBinding(reader(other),'a','two','ndi:Câmera São José','LIVE').id).toBe('two')
  })
  it('does not expose a foreign channel name',()=>{
    expect(()=>requireItemSourceBinding(reader({...row,name:'PRIVATE_FOREIGN'}),'b','one','ndi:Câmera São José','LIVE')).toThrow('Entrada selecionada indisponível neste canal')
  })
  it('requires a new selection after deletion, disabling or endpoint edit',()=>{
    expect(()=>requireItemSourceBinding(reader(undefined),'a','one','ndi:Câmera São José','LIVE')).toThrow()
    expect(()=>requireItemSourceBinding(reader({...row,enabled:false}),'a','one','ndi:Câmera São José','LIVE')).toThrow()
    expect(()=>requireItemSourceBinding(reader(row),'a','one','ndi:CHANGED','LIVE')).toThrow()
  })
  it('does not bind a file to a live catalog',()=>{
    expect(()=>requireItemSourceBinding(reader(row),'a','one','ndi:Câmera São José','VT')).toThrow()
  })
})
