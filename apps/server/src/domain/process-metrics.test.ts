import { describe,expect,it,vi } from 'vitest'
import { ProcessMetrics,parseProcessCounters } from './process-metrics.js'
describe('contadores de processo compartilhados',()=>{
  it('interpreta objeto/lista e deixa ausências/valores inválidos em N/D',()=>{
    expect(parseProcessCounters('{"Id":42,"CPU":1.25,"WorkingSet64":1048576}').get(42)).toEqual({cpuTimeMs:1250,memoryBytes:1048576})
    expect(parseProcessCounters('[{"Id":42,"CPU":null},{"Id":43,"CPU":-1,"WorkingSet64":"texto"},{"Id":"injetado"}]')).toEqual(new Map([[42,{cpuTimeMs:null,memoryBytes:null}],[43,{cpuTimeMs:null,memoryBytes:null}]]))
  })
  it('deduplica PIDs, compartilha chamada em andamento e conserva cache para vários operadores',async()=>{
    const query=vi.fn(async()=>{await Promise.resolve();return new Map([[42,{cpuTimeMs:10,memoryBytes:20}]])})
    const metrics=new ProcessMetrics(query)
    const [first,second]=await Promise.all([metrics.latest([42,42,-1,NaN]),metrics.latest([42])])
    expect(first).toEqual(second);expect(query).toHaveBeenCalledTimes(1);expect(query).toHaveBeenCalledWith([42])
    await metrics.latest([42]);expect(query).toHaveBeenCalledTimes(1)
    await metrics.latest([43]);expect(query).toHaveBeenCalledTimes(2)
  })
  it('falha não anuncia CPU zero nem dispara novamente a cada polling',async()=>{
    const query=vi.fn(async()=>{throw new Error('Erro interno com caminho privado')})
    const metrics=new ProcessMetrics(query)
    const result=await metrics.latest([42])
    expect(result.samples.size).toBe(0);expect(result.error).toContain('indisponíveis');expect(result.error).not.toContain('privado')
    await metrics.latest([42]);expect(query).toHaveBeenCalledTimes(1)
    expect((await metrics.latest([])).error).toBeNull()
  })
})
