import { afterEach, describe, expect, it, vi } from 'vitest'
import { SimulatedTransport } from './transport.js'
import type { RundownView } from './plan.js'

function view(): RundownView { return {rundown:{id:'grade',date:'2026-09-30',loop:false},channel:{rate:{num:25,den:1}},
  items:[{item:{id:'vt',autoNext:true,type:'VT'}},{item:{id:'next',autoNext:true,type:'VT'}}],
  schedule:{items:[{id:'vt',duration:250,state:'ON_AIR'},{id:'next',duration:250,state:'SCHEDULED'}]} } as unknown as RundownView }
afterEach(()=>vi.useRealTimers())
describe('simulação não reinicia elapsed na virada',()=>{
  it('VT atravessa meia-noite e continua automaticamente no instante do EOS simulado',()=>{
    vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date(2026,8,30,23,59,58))
    const transport=new SimulatedTransport('ch',view);transport.take('grade','vt')
    vi.setSystemTime(new Date(2026,9,1,0,0,4))
    expect(transport.state().onAir?.elapsed).toBe(150);expect(transport.tick()).toBe(false)
    vi.setSystemTime(new Date(2026,9,1,0,0,9));expect(transport.tick()).toBe(true)
    expect(transport.state().onAir).toMatchObject({itemId:'next',elapsed:25})
    expect(transport.state().mode).toBe('SIMULATED')
  })
  it('resume e seek mantêm a posição real mesmo quando a hora local vira',()=>{
    vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date(2026,8,30,23,59,59))
    const transport=new SimulatedTransport('ch',view);transport.take('grade','vt',100)
    vi.setSystemTime(new Date(2026,9,1,0,0,1));expect(transport.state().onAir?.elapsed).toBe(150)
    transport.seek('pgm',50);vi.setSystemTime(new Date(2026,9,1,0,0,2));expect(transport.state().onAir?.elapsed).toBe(75)
  })
})
