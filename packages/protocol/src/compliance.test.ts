import { describe, expect, it } from 'vitest'
import type {
  ContinuityCacheStatus,
  PgmProbeAlert,
  AsRunRecordExtended,
  AncineComplianceSummary,
} from './compliance.js'

describe('protocolo de compliance e continuidade', () => {
  it('instancia estruturas de dados esperadas com tipagem correta', () => {
    const cacheStatus: ContinuityCacheStatus = {
      coverage48hPercent: 100,
      coverage7dPercent: 95.5,
      totalCachedFiles: 42,
      totalCachedBytes: 1024 * 1024 * 500,
      maxQuotaBytes: 1024 * 1024 * 1024 * 100,
      offlineAutonomyHours: 48,
      status: 'AIR_GAP_READY',
    }
    expect(cacheStatus.status).toBe('AIR_GAP_READY')

    const probeAlert: PgmProbeAlert = {
      id: 'alert-1',
      type: 'BLACK_FRAME',
      durationMs: 2500,
      thresholdMs: 2000,
      active: true,
      autoActionTriggered: 'SLATE_INJECTED',
      timestamp: new Date().toISOString(),
    }
    expect(probeAlert.autoActionTriggered).toBe('SLATE_INJECTED')

    const asRunRec: AsRunRecordExtended = {
      id: 'ar-1',
      itemId: 'item-10',
      title: 'Comercial 30s',
      eventType: 'COMMERCIAL',
      scheduledStart: '14:00:00:00',
      actualStart: '14:00:00:00',
      durationFrames: 900,
      deltaFrames: 0,
      status: 'PLAYED_FULL',
      audioLufs: -24.0,
      audioTruePeakDb: -2.0,
      ancineQuotaEligible: false,
      commercialContractId: 'CTR-2026-99',
    }
    expect(asRunRec.status).toBe('PLAYED_FULL')

    const ancine: AncineComplianceSummary = {
      hourlyCommercialPercent: 20.0,
      maxAllowedCommercialPercent: 25.0,
      nationalContentMinutes: 35,
      nationalContentQuotaMin: 30,
      compliant: true,
    }
    expect(ancine.compliant).toBe(true)
  })
})
