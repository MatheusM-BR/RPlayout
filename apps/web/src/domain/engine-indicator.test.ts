import { describe, expect, it } from 'vitest'
import { engineIndicator } from './engine-indicator.js'

describe('indicação de engine baseada em evidência', () => {
  it('não anuncia estabilidade nem PGM apenas pelo cadastro ou simulação', () => {
    expect(engineIndicator(undefined).ok).toBe(false)
    expect(engineIndicator({ state: 'running', details: { transport: 'SIMULATED' } })).toEqual({ label: 'TRANSPORTE SIMULADO', ok: false })
  })
  it('execução do processo não significa que o sinal físico foi homologado', () => {
    expect(engineIndicator({ state: 'running' }).label).toBe('ENGINE EM EXECUÇÃO')
    expect(engineIndicator({ state: 'running' }, true).ok).toBe(false)
  })
})
