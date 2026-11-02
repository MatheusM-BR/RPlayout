import { expect, it } from 'vitest'
import { PGM_PROBE_HISTORY_LIMIT, PgmProbe } from './pgm-probe.js'

it('histórico de alertas da sonda tem teto: condição repetida o dia todo não cresce sem limite', () => {
  // recoveryHoldMs 0: cada passagem preta abre e fecha um alerta novo, como
  // um VT preto em loop na grade. Antes, 2 000 passagens = 2 000 alertas em
  // memória, copiados e serializados a cada leitura do status.
  const probe = new PgmProbe({ blackThresholdMs: 1000 })
  let t = 1_000_000
  for (let pass = 0; pass < 2000; pass++) {
    t += 1500; probe.feedMetrics({ isBlack: true, timestampMs: t, deltaMs: 1500 })
    t += 1000; probe.feedMetrics({ isBlack: false, timestampMs: t, deltaMs: 1000 })
    probe.confirmTransitions(probe.pendingTransitions().map(row => row.key))
  }
  const status = probe.getStatus()
  expect(status.alerts.length).toBe(PGM_PROBE_HISTORY_LIMIT)
  // Os mais recentes ficam; o último é o da última passagem.
  expect(status.alerts.at(-1)!.timestamp).toBe(new Date(t - 1000).toISOString())
  expect(JSON.stringify(status).length).toBeLessThan(60_000)
})

it('alerta ativo continua no status mesmo depois de sair do histórico', () => {
  const probe = new PgmProbe({ blackThresholdMs: 1000, freezeThresholdMs: 1000 })
  let t = 1_000_000
  t += 1500; probe.feedMetrics({ isFreeze: true, timestampMs: t, deltaMs: 1500 })
  for (let pass = 0; pass < PGM_PROBE_HISTORY_LIMIT + 10; pass++) {
    t += 1500; probe.feedMetrics({ isBlack: true, isFreeze: true, timestampMs: t, deltaMs: 1500 })
    t += 1000; probe.feedMetrics({ isBlack: false, isFreeze: true, timestampMs: t, deltaMs: 1000 })
  }
  const status = probe.getStatus()
  expect(status.alerts.length).toBe(PGM_PROBE_HISTORY_LIMIT)
  expect(status.activeAlerts.map(alert => alert.type)).toEqual(['FREEZE_FRAME'])
})
