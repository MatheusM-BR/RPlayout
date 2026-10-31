import { describe, expect, it } from 'vitest'
import { primaryHealthy } from './relays.js'

describe('failover de relay', () => {
  it('mantém backup durante conexão e só troca após NO AR', () => {
    expect(primaryHealthy('CONECTANDO')).toBe(false)
    expect(primaryHealthy('CAIU')).toBe(false)
    expect(primaryHealthy('FALHOU')).toBe(false)
    expect(primaryHealthy('NO AR')).toBe(true)
    expect(primaryHealthy(undefined)).toBe(false)
  })
})
