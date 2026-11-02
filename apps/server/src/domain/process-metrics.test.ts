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
describe('contadores do engine no Linux (M2)',()=>{
  it('lê CPU acumulada e RSS de /proc, inclusive nome de processo com espaço e parênteses',async()=>{
    const {parseProcStat}=await import('./process-metrics.js')
    const stat='4242 (rplayout (engine) x) S 1 4242 4242 0 -1 4194560 100 0 0 0 250 50 0 0 20 0 12 0 100 1000 3000'
    expect(parseProcStat(stat,'Name:\trplayout\nVmRSS:\t  150528 kB\n')).toEqual({cpuTimeMs:3000,memoryBytes:150528*1024})
    expect(parseProcStat('1 (x) S','')).toEqual({cpuTimeMs:null,memoryBytes:null})
  })
  it('deriva CPU% do processo entre duas leituras',async()=>{
    let cpu=1000;const now=vi.spyOn(Date,'now')
    const metrics=new ProcessMetrics(async()=>new Map([[7,{cpuTimeMs:cpu,memoryBytes:1}]]),0)
    now.mockReturnValue(10_000);expect((await metrics.latest([7])).samples.get(7)?.cpuPercent).toBeUndefined()
    cpu=6000;now.mockReturnValue(20_000)
    expect((await metrics.latest([7])).samples.get(7)?.cpuPercent).toBe(50)
    now.mockRestore()
  })
})
