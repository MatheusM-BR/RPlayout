import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {MONITOR_HEARTBEAT_MS,MONITOR_RETRY_MS,emptyMonitorText,monitorRecovery} from './BroadcastMonitor.js'

beforeEach(()=>{vi.useFakeTimers()})
afterEach(()=>{vi.useRealTimers()})

it('WHEP caído continua avisando o servidor e tenta de novo, em vez de desistir para sempre',()=>{
  const beat=vi.fn(),retry=vi.fn()
  const stop=monitorRecovery(beat,retry)
  expect(beat).toHaveBeenCalledTimes(1)
  vi.advanceTimersByTime(MONITOR_HEARTBEAT_MS)
  expect(beat).toHaveBeenCalledTimes(2)
  expect(retry).not.toHaveBeenCalled()
  vi.advanceTimersByTime(MONITOR_RETRY_MS-MONITOR_HEARTBEAT_MS)
  expect(retry).toHaveBeenCalledTimes(1)
  // Heartbeat stays under the server's 20 s idle limit.
  expect(MONITOR_HEARTBEAT_MS).toBeLessThan(20_000)
  stop()
  vi.advanceTimersByTime(60_000)
  expect(beat).toHaveBeenCalledTimes(2)
  expect(retry).toHaveBeenCalledTimes(1)
})

it('PGM no ar com monitor falho não manda apertar TAKE',()=>{
  expect(emptyMonitorText(true,true,true).title).toBe('Saída no ar · prévia sem vídeo')
  expect(emptyMonitorText(true,true,true).detail).toContain('canal está no ar')
  expect(emptyMonitorText(true,true,false).detail).not.toContain('TAKE')
  expect(emptyMonitorText(true,false,false).detail).toContain('TAKE')
  expect(emptyMonitorText(false,false,true).title).toBe('Monitor do engine reconectando')
  expect(emptyMonitorText(false,false,false).title).toBe('Nenhum Item Armado')
})
