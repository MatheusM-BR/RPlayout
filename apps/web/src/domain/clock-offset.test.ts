import { describe, expect, it } from 'vitest'
import { clockLevel, estimateOffset } from './clock-offset.js'

describe('relógio da estação x servidor', () => {
  it('estima pelo meio do tempo de ida e volta', () => {
    const sample = estimateOffset(10_000, 10_200, new Date(7_100).toISOString())
    expect(sample).toEqual({ offsetMs: 3000, rttMs: 200, checkedAt: 10_200 })
    expect(clockLevel(sample)).toBe('warn')
  })
  it('descarta medida com ida e volta longa demais ou data inválida', () => {
    expect(estimateOffset(0, 2500, new Date(0).toISOString())).toBeNull()
    expect(estimateOffset(0, 10, 'x')).toBeNull()
  })
  it('níveis: até 1 s ok, até 5 s atenção, acima disso ruim', () => {
    expect(clockLevel({ offsetMs: -900, rttMs: 1, checkedAt: 0 })).toBe('ok')
    expect(clockLevel({ offsetMs: 6000, rttMs: 1, checkedAt: 0 })).toBe('bad')
    expect(clockLevel(null)).toBe('unknown')
  })
})
