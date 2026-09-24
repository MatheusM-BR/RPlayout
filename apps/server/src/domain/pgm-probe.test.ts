import { describe, expect, it } from 'vitest'
import { PgmProbe } from './pgm-probe.js'

describe('sonda de qualidade de PGM (pgm-probe)', () => {
  it('dispara alerta de Black Frame quando a duração ultrapassa 2.0s', () => {
    let actionTriggered: string | null = null
    const probe = new PgmProbe(
      { blackThresholdMs: 2000 },
      (action) => { actionTriggered = action },
    )

    // 1.5s de Black: não deve acionar alerta ativo ainda
    probe.feedMetrics({ isBlack: true, deltaMs: 1500 })
    expect(probe.getStatus().activeAlerts).toHaveLength(0)
    expect(actionTriggered).toBeNull()

    // Mais 600ms (total 2.1s): deve disparar alarme e auto-action SLATE_INJECTED
    const alerts = probe.feedMetrics({ isBlack: true, deltaMs: 600 })
    expect(alerts).toHaveLength(1)
    expect(alerts[0]!.type).toBe('BLACK_FRAME')
    expect(alerts[0]!.autoActionTriggered).toBe('SLATE_INJECTED')
    expect(actionTriggered).toBe('SLATE_INJECTED')
    expect(probe.getStatus().emergencySlateActive).toBe(true)

    // Vídeo normaliza: alerta deve ser desativado
    probe.feedMetrics({ isBlack: false, deltaMs: 200 })
    expect(probe.getStatus().activeAlerts).toHaveLength(0)
  })

  it('dispara alerta de Silêncio contínuo (< -60 dBFS) quando ultrapassa 3.0s', () => {
    let triggeredAction: string | null = null
    const probe = new PgmProbe(
      { silenceThresholdMs: 3000, silenceDbfs: -60 },
      (action) => { triggeredAction = action },
    )

    // 2.5s com áudio em -70 dBFS: abaixo de 3s, não aciona
    probe.feedMetrics({ audioDbfs: -70, deltaMs: 2500 })
    expect(probe.getStatus().activeAlerts).toHaveLength(0)

    // Mais 600ms em silêncio: total 3.1s -> dispara FAILOVER_HOST_B
    const triggered = probe.feedMetrics({ audioDbfs: -65, deltaMs: 600 })
    expect(triggered).toHaveLength(1)
    expect(triggered[0]!.type).toBe('SILENCE')
    expect(triggered[0]!.autoActionTriggered).toBe('FAILOVER_HOST_B')
    expect(triggeredAction).toBe('FAILOVER_HOST_B')
  })

  it('dispara alerta de Freeze Frame quando imagem congela por > 2.0s', () => {
    const probe = new PgmProbe({ freezeThresholdMs: 2000 })
    probe.feedMetrics({ isFreeze: true, deltaMs: 2100 })
    const status = probe.getStatus()
    expect(status.activeAlerts).toHaveLength(1)
    expect(status.activeAlerts[0]!.type).toBe('FREEZE_FRAME')
    expect(status.activeAlerts[0]!.autoActionTriggered).toBe('CONTINGENCY_LOOP')
  })

  it('dispara Slate de emergência manualmente', () => {
    const probe = new PgmProbe()
    expect(probe.getStatus().emergencySlateActive).toBe(false)
    const alert = probe.triggerEmergencySlate('Operador acionou botão de pânico')
    expect(alert.autoActionTriggered).toBe('SLATE_INJECTED')
    expect(probe.getStatus().emergencySlateActive).toBe(true)

    probe.resetEmergencySlate()
    expect(probe.getStatus().emergencySlateActive).toBe(false)
  })
})
