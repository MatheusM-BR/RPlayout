import { describe, expect, it } from 'vitest'
import { severityOf } from './health.js'

describe('severidade da saúde', () => {
  it('classifica queda como crítica e conexão como atenção', () => {
    expect(severityOf('ENGINE', 'error', 'caiu')).toBe('CRITICAL')
    expect(severityOf('OUTPUT', 'connecting', null)).toBe('WARN')
    expect(severityOf('ENGINE', 'running', null)).toBe('INFO')
  })
})
