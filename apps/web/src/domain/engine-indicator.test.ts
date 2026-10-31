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
import { liveEngineStateOf } from './engine-indicator.js'
import { headerHealthTags } from '../components/broadcast/HeaderHealth.js'
describe('estado do engine durante o REINICIAR do Monitor', () => {
  it('sem a linha do engine do canal (canal sendo recriado) vale REINICIANDO, não o OK da amostra antiga', () => {
    expect(liveEngineStateOf([], 'ch')).toBe('RESTARTING')
    expect(liveEngineStateOf(null, 'ch')).toBeNull()
    expect(liveEngineStateOf([{ kind: 'ENGINE', channelId: 'ch', details: { engineState: 'OK' } }], 'ch')).toBe('OK')
    const sample = { disk: { percentUsed: 50, freeBytes: 1e10, totalBytes: 2e10, path: '/' }, operations: { channels: [{ channelId: 'ch', engine: { ready: true, hasError: false, restarts: 1, deaths: 1, stalls: 0 }, outputs: [] }] } } as never
    const [engine] = headerHealthTags(sample, 'ch', { critical: 0, warn: 0 }, liveEngineStateOf([], 'ch'))
    expect(engine!.value).toBe('REINICIANDO')
  })
})
