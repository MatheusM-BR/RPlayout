import { expect, it } from 'vitest'
import { clockTag } from './HeaderHealth.js'

const clock = (state: 'OK' | 'WARN' | 'CRITICAL' | 'UNVERIFIED', offsetMs: number | null, checkedAt: string | null = '2026-10-30T12:00:00.000Z') =>
  ({ checkedAt, state, offsetMs, rttMs: 10, servers: [], platform: null, thresholds: { warnMs: 50, criticalMs: 500, unverifiedRounds: 3, jumpMs: 1000 }, reason: 'motivo' })

it('cor e texto por estado do relógio, com offset no tooltip', () => {
  expect(clockTag(clock('OK', 3))).toMatchObject({ label: 'RELÓGIO', value: 'OK', level: 'ok' })
  expect(clockTag(clock('WARN', 120))).toMatchObject({ value: 'AVISO', level: 'warn' })
  expect(clockTag(clock('CRITICAL', -900))).toMatchObject({ value: 'CRÍTICO', level: 'bad' })
  expect(clockTag(clock('UNVERIFIED', null))).toMatchObject({ level: 'warn' })
  expect(clockTag(clock('CRITICAL', -900)).title).toContain('-900 ms')
  expect(clockTag(clock('UNVERIFIED', null, null)).level).toBe('unknown')
  expect(clockTag(null).level).toBe('unknown')
})
