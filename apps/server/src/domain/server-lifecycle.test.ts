import { describe, expect, it } from 'vitest'
import { serverShutdownEvent, serverStartedEvent } from './server-lifecycle.js'

describe('partida e encerramento do servidor ficam no histórico de incidentes', () => {
  it('encerramento com PGM no ar é aviso e diz que o canal parou junto', () => {
    const row = serverShutdownEvent('SIGTERM', ['Agro Reteste'])
    expect(row).toMatchObject({ component: 'SERVER', state: 'shutdown', severity: 'WARN' })
    expect(row.message).toContain('SIGTERM')
    expect(row.message).toContain('Agro Reteste')
    expect(row.message).toContain('parou junto')
  })
  it('encerramento sem nada no ar é informativo', () => {
    expect(serverShutdownEvent('SIGINT', [])).toMatchObject({ severity: 'INFO', state: 'shutdown' })
  })
  it('partida registra PID e versão', () => {
    const row = serverStartedEvent(1234, 'RPlayout 0.1.0 (abc1234)')
    expect(row).toMatchObject({ component: 'SERVER', state: 'started', severity: 'INFO' })
    expect(row.message).toContain('PID 1234')
    expect(row.message).toContain('abc1234')
  })
})
