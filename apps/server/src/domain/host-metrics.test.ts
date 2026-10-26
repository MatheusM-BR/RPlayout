import { afterEach, describe, expect, it } from 'vitest'
import { tmpdir } from 'node:os'
import { openDatabase } from '../db/client.js'
import { cpuUtilization, HostMetrics } from './host-metrics.js'
const values: ReturnType<typeof openDatabase>[] = []
afterEach(() => { for (const value of values.splice(0)) value.sqlite.close() })
describe('coleta histórica centralizada do host', () => {
  it('coleta real não serve cache não persistido após falha de retenção e permite retry imediato',async()=>{
    const value=openDatabase(':memory:');values.push(value)
    const metrics=new HostMetrics(value.sqlite,tmpdir());let captures=0
    metrics.onCapture=async()=>{captures++;return {version:1,capturedAt:new Date().toISOString(),available:true,channelsTruncated:false,channels:[]}}
    value.sqlite.prepare('INSERT INTO host_metric_samples VALUES(?,?)').run('2000-01-01T00:00:00.000Z',JSON.stringify({generatedAt:'2000-01-01T00:00:00.000Z'}))
    value.sqlite.exec("CREATE TRIGGER qa_expiry_fail BEFORE DELETE ON host_metric_samples BEGIN SELECT RAISE(ABORT,'fixture_expiry_failure'); END")
    try{
      await expect(metrics.latest()).rejects.toThrow('fixture_expiry_failure')
      expect(captures).toBe(1);expect(value.sqlite.prepare('SELECT COUNT(*) AS count FROM health_events').get()).toEqual({count:0})
      expect(metrics.history('1999-01-01')).toHaveLength(1)
      value.sqlite.exec('DROP TRIGGER qa_expiry_fail')
      const committed=await metrics.latest()
      expect(captures).toBe(2);expect(metrics.history('1999-01-01')).toEqual([committed]);expect((await metrics.latest())).toBe(committed)
      expect(value.sqlite.prepare('SELECT COUNT(*) AS count FROM health_events').get()).toEqual({count:1})
    }finally{metrics.close()}
  },15000)
  it('pagina com cursor exclusivo e janela fixa sem repetir linhas ou incluir novas coletas',()=>{
    const value=openDatabase(':memory:');values.push(value)
    const metrics=new HostMetrics(value.sqlite,tmpdir())
    for(let index=0;index<5;index++){
      const time=new Date(Date.UTC(2026,9,9,12,0,index)).toISOString()
      value.sqlite.prepare('INSERT INTO host_metric_samples VALUES(?,?)').run(time,JSON.stringify({generatedAt:time}))
    }
    const since='2026-10-09T12:00:00.000Z',until='2026-10-09T12:00:03.000Z'
    const first=metrics.historyPage(since,until,undefined,2)
    expect(first.totalSamples).toBe(4);expect(first.samples.map(row=>row.sampledAt)).toEqual(['2026-10-09T12:00:03.000Z','2026-10-09T12:00:02.000Z'])
    expect(first.nextBefore).toBe('2026-10-09T12:00:02.000Z')
    const next=metrics.historyPage(since,until,first.nextBefore!,2)
    expect(next.samples.map(row=>row.sampledAt)).toEqual(['2026-10-09T12:00:01.000Z',since]);expect(next.nextBefore).toBeNull()
    expect(next.totalSamples).toBe(4);expect(metrics.historyPage(since,until,since,2).samples).toEqual([])
    metrics.close()
  })
  it('página respeita o limite de bytes da resposta do banco e continua pelo cursor',()=>{
    const value=openDatabase(':memory:');values.push(value)
    const metrics=new HostMetrics(value.sqlite,tmpdir()),filler='x'.repeat(600_000)
    for(let index=0;index<20;index++){
      const time=new Date(Date.UTC(2026,9,9,12,0,index)).toISOString()
      value.sqlite.prepare('INSERT INTO host_metric_samples VALUES(?,?)').run(time,JSON.stringify({generatedAt:time,filler}))
    }
    const since='2026-10-09T12:00:00.000Z',until='2026-10-09T12:00:19.000Z',seen:string[]=[]
    let before:string|undefined,pages=0
    for(;;){
      const page=metrics.historyPage(since,until,before,5000);pages++
      const bytes=page.samples.reduce((sum,row)=>sum+JSON.stringify(row.sample).length,0)
      expect(bytes).toBeLessThanOrEqual(4*2**20)
      seen.push(...page.samples.map(row=>row.sampledAt))
      if(!page.nextBefore)break
      before=page.nextBefore
    }
    expect(pages).toBeGreaterThan(1);expect(seen).toHaveLength(20);expect(new Set(seen).size).toBe(20)
    expect(metrics.history(since,5000).length).toBeLessThan(20)
    metrics.close()
  })
  it('CPU só tem percentual após dois contadores válidos; reseta contadores não estimáveis', () => {
    expect(cpuUtilization(null, { idle: 5, total: 10 })).toBeNull()
    expect(cpuUtilization({ idle: 5, total: 10 }, { idle: 10, total: 30 })).toBe(75)
    expect(cpuUtilization({ idle: 5, total: 10 }, { idle: 2, total: 20 })).toBeNull()
  })
  it('compartilha coleta, persiste uma amostra real e mantém ausência de GPU/rede explícita', async () => {
    const value = openDatabase(':memory:'); values.push(value)
    const metrics = new HostMetrics(value.sqlite, tmpdir())
    const [first, second] = await Promise.all([metrics.latest(), metrics.latest()])
    expect(first).toBe(second)
    expect(first.cpu.percent).toBeNull()
    expect(first.memory.totalBytes).toBeGreaterThan(0)
    expect(first.disk.freeBytes).toBeGreaterThan(0)
    expect(first.network.receivedBytesPerSecond).toBeNull()
    const history = metrics.history('2000-01-01')
    expect(history).toEqual([first])
    expect((await metrics.latest()).generatedAt).toBe(first.generatedAt)
    metrics.close()
  })
})
