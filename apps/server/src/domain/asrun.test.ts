import { describe, expect, it } from 'vitest'
import {
  calculateAncineCompliance,
  exportAsRunBxf,
  exportAsRunCsv,
  toAsRunRecordExtended,
  type AsRunEntry,
} from './asrun.js'

describe('as-run compliance e exportadores (Fase C)', () => {
  const dummyEntries: AsRunEntry[] = [
    {
      id: 'ar-1',
      channelId: 'ch-1',
      rundownId: 'rd-1',
      itemId: 'it-1',
      mediaId: 'm-1',
      title: 'Jornal da Manha Bloco 1',
      type: 'VT',
      startedAt: '2026-09-24T14:00:00.000Z',
      endedAt: '2026-09-24T14:15:00.000Z',
      plannedStart: 0,
      actualStart: 0,
      airedFrames: 27000, // 15 minutos a 30fps
      plannedFrames: 27000,
      endedBy: 'NEXT',
      createdAt: '2026-09-24T14:00:00.000Z',
    },
    {
      id: 'ar-2',
      channelId: 'ch-1',
      rundownId: 'rd-1',
      itemId: 'it-2',
      mediaId: 'm-2',
      title: 'Comercial Banco 30s',
      type: 'COMMERCIAL',
      startedAt: '2026-09-24T14:15:00.000Z',
      endedAt: '2026-09-24T14:15:30.000Z',
      plannedStart: 27000,
      actualStart: 27000,
      airedFrames: 900, // 30s
      plannedFrames: 900,
      endedBy: 'NEXT',
      createdAt: '2026-09-24T14:15:00.000Z',
    },
    {
      id: 'ar-3',
      channelId: 'ch-1',
      rundownId: 'rd-1',
      itemId: 'it-3',
      mediaId: 'm-3',
      title: 'Comercial Supermercado 30s',
      type: 'COMMERCIAL',
      startedAt: '2026-09-24T14:15:30.000Z',
      endedAt: '2026-09-24T14:15:45.000Z',
      plannedStart: 27900,
      actualStart: 27900,
      airedFrames: 450, // 15s (truncado)
      plannedFrames: 900,
      endedBy: 'TAKE',
      createdAt: '2026-09-24T14:15:30.000Z',
    },
  ]

  it('converte AsRunEntry para AsRunRecordExtended detectando truncamento', () => {
    const ext1 = toAsRunRecordExtended(dummyEntries[0]!)
    expect(ext1.status).toBe('PLAYED_FULL')
    expect(ext1.ancineQuotaEligible).toBe(true)

    const ext3 = toAsRunRecordExtended(dummyEntries[2]!)
    expect(ext3.status).toBe('INTERRUPTED')
    expect(ext3.ancineQuotaEligible).toBe(false)
    expect(ext3.commercialContractId).toBeDefined()
  })

  it('calcula conformidade com limite de 25% de publicidade por hora (ANCINE)', () => {
    const summary = calculateAncineCompliance(dummyEntries)
    // 30s + 15s = 45s de comercial em 3600s (1.25%)
    expect(summary.hourlyCommercialPercent).toBeLessThan(25.0)
    expect(summary.maxAllowedCommercialPercent).toBe(25.0)
    expect(summary.compliant).toBe(true)
    expect(summary.nationalContentMinutes).toBeGreaterThan(14.0)

    // Cenário não-conforme: 20 minutos de comerciais em 1 hora (33.3% > 25%)
    const heavyCommercialEntries: AsRunEntry[] = [
      {
        ...dummyEntries[1]!,
        airedFrames: 36000, // 20 minutos a 30fps = 1200 segundos
      },
    ]
    const nonCompliant = calculateAncineCompliance(heavyCommercialEntries)
    expect(nonCompliant.hourlyCommercialPercent).toBeCloseTo(33.3, 0)
    expect(nonCompliant.compliant).toBe(false)
  })

  it('exporta log As-Run em formato CSV estruturado', () => {
    const csv = exportAsRunCsv(dummyEntries)
    expect(csv).toContain('id,itemId,title,eventType,scheduledStart,actualStart')
    expect(csv).toContain('Jornal da Manha Bloco 1')
    expect(csv).toContain('Comercial Banco 30s')
    expect(csv).toContain('PLAYED_FULL')
    expect(csv).toContain('INTERRUPTED')
  })

  it('exporta log As-Run em formato SMPTE-2021 BXF XML', () => {
    const bxf = exportAsRunBxf(dummyEntries, {
      channelName: 'TV Teste PGM',
      channelId: 'CH-PGM-01',
    })
    expect(bxf).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(bxf).toContain('<BxfMessage')
    expect(bxf).toContain('messageType="AsRun"')
    expect(bxf).toContain('channelName="TV Teste PGM"')
    expect(bxf).toContain('<ScheduleItem itemId="it-1">')
    expect(bxf).toContain('<BroadcastEvent eventType="VT">')
    expect(bxf).toContain('<ExecutionResult status="PLAYED_FULL"')
    expect(bxf).toContain('<ExecutionResult status="INTERRUPTED"')
  })
})
