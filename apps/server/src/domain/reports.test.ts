import { describe, expect, it } from 'vitest'
import { buildCommercialComplianceReport, renderCommercialCompliancePdf } from './reports.js'
import type { AsRunEntry } from './asrun.js'

describe('comprovante comercial em PDF', () => {
  it('separa spots e entrega um PDF válido', () => {
    const entries: AsRunEntry[] = [
      { id: 'news', channelId: 'c1', rundownId: null, itemId: null, mediaId: null, title: 'Jornal', type: 'VT', startedAt: '2026-09-24T12:00:00Z', endedAt: null, plannedStart: 0, actualStart: 0, airedFrames: 750, plannedFrames: 750, endedBy: 'NEXT', createdAt: '' },
      { id: 'spot', channelId: 'c1', rundownId: null, itemId: null, mediaId: null, title: 'Marca (A)', type: 'COMMERCIAL', startedAt: '2026-09-24T12:00:30Z', endedAt: null, plannedStart: 750, actualStart: 750, airedFrames: 750, plannedFrames: 750, endedBy: 'NEXT', createdAt: '' },
    ]
    const report = buildCommercialComplianceReport(entries, { num: 25, den: 1 }, { since: '2026-09-24T12:00:00Z', until: '2026-09-24T13:00:00Z' }, '2026-09-24T13:00:00Z')
    expect(report.commercialSpots).toHaveLength(1)
    expect(report.hourlyCompliance[0]?.percent).toBe(0.8)
    const pdf = renderCommercialCompliancePdf('TV Teste', report)
    expect(pdf.subarray(0, 8).toString()).toBe('%PDF-1.4')
    expect(pdf.toString('latin1')).toContain('Marca \\(A\\)')
  })

  it('pagina o comprovante sem descartar spots', () => {
    const entries = Array.from({ length: 60 }, (_, index) => ({
      id: `spot-${index}`, channelId: 'c1', rundownId: null, itemId: null, mediaId: null,
      title: `Spot ${index}`, type: 'COMMERCIAL', startedAt: '2026-09-24T12:00:00Z', endedAt: null,
      plannedStart: index * 25, actualStart: index * 25, airedFrames: 25, plannedFrames: 25,
      endedBy: 'NEXT', createdAt: '',
    } satisfies AsRunEntry))
    const report = buildCommercialComplianceReport(entries, { num: 25, den: 1 }, { since: null, until: null })
    const pdf = renderCommercialCompliancePdf('TV Teste', report).toString('latin1')
    expect(pdf).toContain('/Count 2')
    expect(pdf).toContain('Spot 59')
  })
})
