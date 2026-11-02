import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../db/client.js'
import { channels } from '../db/schema.js'
import { getChannel } from '../db/repo.js'
import { ChannelRuntime } from '../app.js'

let database: ReturnType<typeof openDatabase>
let runtime: ChannelRuntime
beforeEach(async () => {
  database = openDatabase(':memory:')
  await database.db.insert(channels).values({ id: 'ch', name: 'Canal', rateNum: 25, rateDen: 1, width: 320, height: 180, targetLufs: -23, ceilingDbtp: -1, limiterLookaheadMs: 5, createdAt: new Date().toISOString() })
  runtime = new ChannelRuntime((await getChannel(database.db, 'ch'))!, database.db, ['null'])
})
afterEach(() => { runtime?.transport.close(); database.sqlite.close() })

describe('perda de sinal do ao vivo no PGM vira registro (M4)', () => {
  it('LOST abre a linha uma vez; a volta só fecha depois de 3 s estáveis', () => {
    let pgm = 'ON_PGM'
    const base = runtime.transport.state()
    vi.spyOn(runtime.transport, 'state').mockImplementation(() => ({ ...base, onAir: { itemId: 'live', startedAt: 0, elapsed: 10 },
      liveSources: [{ source: 'srt://:9000', itemId: 'live', state: pgm, message: 'sem quadro', changedAt: '', busStates: { pgm }, busItemIds: { pgm: 'live' } }] }) as never)
    const signal = vi.spyOn((runtime as unknown as { asRun: { signal: (...args: unknown[]) => Promise<void> } }).asRun, 'signal').mockResolvedValue()
    runtime.observeProgramSignal(1000)
    expect(signal).not.toHaveBeenCalled()
    pgm = 'LOST'; runtime.observeProgramSignal(2000); runtime.observeProgramSignal(3000)
    expect(signal.mock.calls.map(call => call.slice(0, 2))).toEqual([['live', true]])
    pgm = 'ON_PGM'; runtime.observeProgramSignal(4000)
    pgm = 'LOST'; runtime.observeProgramSignal(4500)
    pgm = 'ON_PGM'; runtime.observeProgramSignal(5000); runtime.observeProgramSignal(7000)
    expect(signal).toHaveBeenCalledTimes(1)
    runtime.observeProgramSignal(8100)
    expect(signal.mock.calls.map(call => call.slice(0, 2))).toEqual([['live', true], ['live', false]])
  })
})
