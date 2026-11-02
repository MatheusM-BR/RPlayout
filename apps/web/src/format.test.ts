import {describe,expect,it} from 'vitest'
import {formatStandardRate,rateFpsLabel} from './format.js'
describe('formato do canal no navegador',()=>{
  it('não confunde 29.97 progressivo com 59.94 entrelaçado',()=>{
    expect(formatStandardRate({num:30000,den:1001},'PROGRESSIVE')).toBe('1080p29.97')
    expect(formatStandardRate({num:30000,den:1001},'INTERLACED')).toBe('1080i59.94')
    expect(rateFpsLabel({num:30000,den:1001},'PROGRESSIVE')).toBe('1080p29.97')
  })
  it('preserva altura e cadência de campos do formato selecionado',()=>{
    expect(formatStandardRate({num:25,den:1},'INTERLACED',576)).toBe('576i50')
    expect(formatStandardRate({num:25,den:1},'PROGRESSIVE',720)).toBe('720p25')
  })
})
