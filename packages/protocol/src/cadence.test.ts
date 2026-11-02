import {describe,it,expect} from 'vitest'
import {frameConverter,sameRate,validateCadence} from './cadence.js'
describe('conversão racional de cadência',()=>{
  it('preserva duração exata sem drift entre 25 e 50 FPS',()=>{
    const converter=frameConverter({num:25,den:1},{num:50,den:1})
    expect(converter.frames(25*24*3600)).toBe(50*24*3600)
    expect(converter.statistics()).toEqual({roundedValues:0,maxRoundingErrorMs:0})
  })
  it('arredonda meio quadro para cima e registra erro',()=>{
    const converter=frameConverter({num:50,den:1},{num:25,den:1})
    expect(converter.frames(1)).toBe(1);expect(converter.frames(3)).toBe(2)
    expect(converter.statistics()).toEqual({roundedValues:2,maxRoundingErrorMs:20})
  })
  it('59,94 para 29,97 mantém a proporção exata',()=>{
    expect(frameConverter({num:60000,den:1001},{num:30000,den:1001}).frames(100000)).toBe(50000)
    expect(sameRate({num:50,den:2},{num:25,den:1})).toBe(true)
    expect(sameRate({num:NaN,den:1},{num:25,den:1})).toBe(false)
  })
  it.each([{num:0,den:1},{num:1,den:0},{num:241,den:1},{num:1,den:2},{num:25.5,den:1},{num:Infinity,den:1}])('recusa cadência inválida %j',rate=>expect(()=>validateCadence(rate)).toThrow('Cadência inválida'))
  it('recusa quadros negativos, fracionários e estouro seguro',()=>{
    const converter=frameConverter({num:1,den:1},{num:240,den:1})
    for(const value of [-1,0.5,NaN])expect(()=>converter.frames(value)).toThrow('quadros inválido')
    expect(()=>converter.frames(Number.MAX_SAFE_INTEGER)).toThrow('limite seguro')
  })
})
