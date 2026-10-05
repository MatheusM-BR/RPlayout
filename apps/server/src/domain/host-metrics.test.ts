import { afterEach, describe, expect, it } from 'vitest'
import { tmpdir } from 'node:os'
import { openDatabase } from '../db/client.js'
import { cpuUtilization, HostMetrics } from './host-metrics.js'
const values: ReturnType<typeof openDatabase>[] = []
afterEach(() => { for (const value of values.splice(0)) value.sqlite.close() })
describe('coleta histórica centralizada do host', () => {
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
