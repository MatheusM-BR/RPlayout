import {describe,it,expect} from 'vitest'
import {latestRequestGate} from './latest-request.js'
describe('descoberta só aceita a consulta atual',()=>{
  it('sucesso e finally antigos não substituem consulta mais recente ainda carregando',()=>{
    const gate=latestRequestGate(),old=gate.begin(),recent=gate.begin()
    expect(old()).toBe(false);expect(recent()).toBe(true)
  })
  it('resposta e erro pendentes são descartados ao desmontar',()=>{
    const gate=latestRequestGate(),pending=gate.begin()
    gate.invalidate();expect(pending()).toBe(false)
  })
  it('remontagem permite consulta nova sem reativar a antiga',()=>{
    const gate=latestRequestGate(),old=gate.begin()
    gate.invalidate();const current=gate.begin()
    expect(old()).toBe(false);expect(current()).toBe(true)
  })
})
