import { describe, expect, it } from 'vitest'
import { engineIncidentTransition, severityOf } from './health.js'

describe('severidade da saúde', () => {
  it('classifica queda como crítica e conexão como atenção', () => {
    expect(severityOf('ENGINE', 'error', 'caiu')).toBe('CRITICAL')
    expect(severityOf('OUTPUT', 'connecting', null)).toBe('WARN')
    expect(severityOf('OUTPUT', 'failed', 'Escolha outro arquivo')).toBe('CRITICAL')
    expect(severityOf('ENGINE', 'running', null)).toBe('INFO')
  })
})

describe('incidentes do engine sem duplicar (A5)', () => {
  it('SIGKILL seguido de relançamento pelo watchdog gera UM erro e UM "pronto novamente" com mensagem', () => {
    const events: Array<{ state: string; message: string }> = []
    let previous: string | undefined
    const tick = (health: { error: string | null; ready: boolean; restarts: number }, pid: number | null) => {
      const t = engineIncidentTransition(previous, health, pid)
      if (t) { previous = t.signature; if (t.record) events.push({ state: t.state, message: t.message }) }
    }
    tick({ error: null, ready: false, restarts: 0 }, 10)
    tick({ error: null, ready: true, restarts: 0 }, 10)
    tick({ error: 'O engine foi encerrado por SIGKILL.', ready: false, restarts: 0 }, 10)
    tick({ error: 'O engine foi encerrado por SIGKILL.', ready: false, restarts: 1 }, 11) // watchdog relançou: novo PID
    tick({ error: 'O engine foi encerrado por SIGKILL.', ready: false, restarts: 1 }, 11)
    tick({ error: null, ready: true, restarts: 1 }, 11)
    tick({ error: null, ready: true, restarts: 1 }, 11)
    expect(events).toEqual([
      { state: 'running', message: 'Engine pronto (PID 10).' },
      { state: 'error', message: 'O engine foi encerrado por SIGKILL.' },
      { state: 'running', message: 'Engine pronto novamente (PID 11; reinícios nesta sessão: 1).' },
    ])
  })
})
