import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildCommercialComplianceReport, renderCommercialCompliancePdf } from '../apps/server/src/domain/reports.js'
import type { AsRunEntry } from '../apps/server/src/domain/asrun.js'

// Synthetic report fixture only; never export the operator's database.
const root = fileURLToPath(new URL('..', import.meta.url))
const directory = resolve(root, 'artifacts/qa-20260930/asrun-layout'); await mkdir(directory, { recursive: true })
const rows: AsRunEntry[] = Array.from({ length: 60 }, (_, i) => ({
  id: `qa-${i}`, channelId: 'qa', rundownId: null, itemId: `item-${i}`, mediaId: null,
  title: i === 0 ? 'TÍTULO EXTENSO ÇÃO ' + 'ABCDEFGHIJKLMNOPQRSTUVXYZ0123456789'.repeat(6) : `Comercial QA ${i} — Açúcar (São Paulo)`, type: 'COMMERCIAL', startedAt: '2026-10-01T12:00:00Z', endedAt: '2026-10-01T12:00:30Z',
  actualStart: i * 750, plannedStart: null, plannedFrames: 750, airedFrames: i === 1 ? null : 750, rateNum: 25, rateDen: 1, executionKind: i % 2 ? 'UNKNOWN' : 'SIMULATED', durationEvidence: 'CLOCK_ESTIMATE', endedBy: i === 1 ? 'RESTART' : 'NEXT', createdAt: '',
}))
const report = buildCommercialComplianceReport(rows, { num: 25, den: 1 }, { since: '2026-10-01T12:00:00Z', until: '2026-10-01T13:00:00Z' }, '2026-10-01T13:00:00Z')
const output = join(directory, 'asrun-comerciais-fixture.pdf')
await writeFile(output, renderCommercialCompliancePdf('Canal QA (sem saída física)', report))
console.log(JSON.stringify({ fixture: output, records: rows.length, regulatoryValidated: report.regulatoryValidated, requiresVisualInspection: true }))
