import {describe,expect,it} from 'vitest'
import {reasonsOf} from '../components/AddItemDialog.js'
import type {SourceList} from '../types.js'

const empty={available:false,reason:null,sources:[]}
describe('add-item discovery diagnostics agree with input settings',()=>{
  it('does not infer installed driver from an empty discovery',()=>{
    const list:SourceList={sdi:empty,sdiOutputs:empty,ndi:empty,omt:empty,guests:empty}
    expect(reasonsOf(list)[0]).toContain('presença de driver/placa não confirmada')
    expect(reasonsOf(list)[0]).not.toContain('driver presente')
  })
  it('saved endpoints cannot hide runtime diagnosis',()=>{
    const list:SourceList={sdi:{...empty,reason:'Plugin ausente',sources:[{reference:'sdi:0',label:'Salva',family:'SDI',discovery:'CONFIGURED'}]},sdiOutputs:empty,ndi:empty,omt:empty,guests:empty}
    expect(reasonsOf(list)).toContain('placa: Plugin ausente')
  })
})
