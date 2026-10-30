import { expect, it } from 'vitest'
import { escalationForRole, escalationTier } from './escalation.js'

const t = (ms: number, c = 'SIGNAL', s = 'black', sev = 'CRITICAL') => escalationTier(c, s, sev, 1_000_000, 1_000_000 + ms)
it('fronteiras de nível', () => {
  expect(t(0)).toBe('OPERATOR')
  expect(t(119_000)).toBe('OPERATOR')
  expect(t(120_000)).toBe('SUPERVISOR')
  expect(t(419_000)).toBe('SUPERVISOR')
  expect(t(420_000)).toBe('ADMIN')
})
it('outros incidentes não escalam', () => {
  expect(t(500_000, 'ENGINE')).toBeNull()
  expect(t(500_000, 'SIGNAL', 'black_recovered')).toBeNull()
  expect(t(500_000, 'SIGNAL', 'freeze', 'WARN')).toBeNull()
  expect(escalationTier('SIGNAL', 'silence', 'CRITICAL', NaN, 5)).toBeNull()
})
it('forMe por papel', () => {
  expect(escalationForRole('OPERATOR', 'OPERATOR')).toBe(true)
  expect(escalationForRole('OPERATOR', 'SUPERVISOR')).toBe(false)
  expect(escalationForRole('SUPERVISOR', 'SUPERVISOR')).toBe(true)
  expect(escalationForRole('SUPERVISOR', 'ADMIN')).toBe(false)
  expect(escalationForRole('ADMIN', 'ADMIN')).toBe(true)
})
