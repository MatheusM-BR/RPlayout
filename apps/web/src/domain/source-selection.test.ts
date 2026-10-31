import {afterEach,expect,it,vi} from 'vitest'
import {sourceSelectionKey} from './source-selection.js'
import {inputName} from '../components/broadcast/protocol-config.js'
import {api} from '../api.js'
afterEach(()=>vi.restoreAllMocks())
it('seleciona cadastro exato e seu nome mesmo quando o destino coincide com descoberta e outro cadastro',()=>{
  const choices=[{reference:'ndi:CAM',label:'Discovered'},{configuredId:'one',reference:'ndi:CAM',label:'Câmera São José'},{configuredId:'two',reference:'ndi:CAM',label:'Estúdio Óscar'}]
  expect(new Set(choices.map(sourceSelectionKey)).size).toBe(3)
  const chosen=choices.find(source=>sourceSelectionKey(source)==='configured:two')!
  expect(inputName('',chosen.label,false)).toBe('Estúdio Óscar');expect(chosen.reference).toBe('ndi:CAM')
})
it('API mantém refresh e codifica canal sem alterar operações do engine',async()=>{
  const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('{}',{status:200}))
  await api.sources(true,'São/a')
  expect(fetcher.mock.calls[0]?.[0]).toBe('/api/sources?refresh=1&channelId=S%C3%A3o%2Fa')
  expect(fetcher.mock.calls[0]?.[1]?.method??'GET').toBe('GET')
})
