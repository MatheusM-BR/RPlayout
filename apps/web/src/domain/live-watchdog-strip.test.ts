import { describe, expect, it } from 'vitest'
import type { WatchdogInputStatus } from '@rplayout/protocol'
import { watchdogDetail } from '../components/broadcast/LiveWatchdogStrip.js'

const base = (patch: Partial<WatchdogInputStatus>): WatchdogInputStatus => ({
  sourceKey: 'srt://x', sourceId: 'x', name: 'Leilão SRT', kind: 'SRT', bus: 'pgm', itemId: 'i',
  metrics: { videoAgeMs: null, effectiveFps: null, referenceFps: 29.97, lumaPercent: null, lumaStdPercent: null, audioDbfs: null, audioStalledMs: null, inputKbps: null },
  state: 'RETORNO', stateSince: new Date(0).toISOString(), mode: 'AUTOMATIC', waitRemainingMs: null, stableMs: 5000, awaitingOperator: true,
  holdContingency: true, waitArtOnAir: false, contingencyOnAir: true, blindReturn: true, pendingAction: null, lastError: null, conditions: [],
  ...patch,
} as WatchdogInputStatus)

describe('faixa do watchdog sem PVW', () => {
  it('na contingência sem PVW não diz "sinal estável": a entrada não é medida', () => {
    const text = watchdogDetail(base({}))
    expect(text).not.toContain('Sinal estável')
    expect(text).toContain('não medido')
    expect(text).toContain('contingência mantida pelo operador')
  })
  it('com PVW (entrada medida) continua dizendo que o sinal está estável', () => {
    expect(watchdogDetail(base({ blindReturn: false }))).toContain('Sinal estável')
  })
})
