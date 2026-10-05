import { describe, expect, it } from 'vitest'
import { asRunCsv, asRunDuration, asRunReport, asRunStatus, asRunXml, summarizeAsRun } from './asrun-evidence.js'
import type { AsRunEntry } from '../types.js'
const entry: AsRunEntry = { id: 'id', title: 'VT', type: 'VT', startedAt: '2026-10-01T12:00:00Z', endedAt: '2026-10-01T12:00:30Z', plannedStart: 0, actualStart: 0, plannedFrames: 900, airedFrames: 750, endedBy: 'NEXT', rateNum: 25, rateDen: 1, executionKind: 'NATIVE', durationEvidence: 'ENGINE_POSITION' }
describe('evidência da ocorrência sem valores regulatórios inventados', () => {
  it('respeita cadência da ocorrência e mistura 25/29.97 sem reinterpretar pela configuração atual', () => {
    const nt = { ...entry, airedFrames: 30000, rateNum: 30000, rateDen: 1001 }
    expect(asRunDuration(nt).seconds).toBe(1001)
    expect(summarizeAsRun([entry, nt]).seconds).toBe(1031)
  })
  it('aberto não herda duração planejada nem vira EOF', () => {
    const open = { ...entry, airedFrames: null, endedAt: null, endedBy: null }
    expect(asRunDuration(open).seconds).toBeNull()
    expect(asRunDuration({ ...open, airedFrames: 9999 })).toMatchObject({ frames: null, seconds: null, evidence: 'UNKNOWN' })
    expect(asRunStatus(open)).toBe('EM EXECUÇÃO')
    expect(summarizeAsRun([open])).toMatchObject({ frames: 0, seconds: 0, eof: 0, missingDurations: 1 })
  })
  it('legado sem cadência usa tempo de relógio explicitamente estimado; data inválida não fabrica duração', () => {
    expect(asRunDuration({ ...entry, rateNum: null, rateDen: null })).toMatchObject({ seconds: 30, evidence: 'CLOCK_ESTIMATE', rate: null })
    expect(asRunDuration({ ...entry, rateNum: null, endedAt: 'invalid' }).seconds).toBeNull()
  })
  it('não chama parada manual de falha nem TAKE de exibição integral, mesmo com 95%', () => {
    expect(asRunStatus(entry)).toBe('CORTE / TAKE')
    expect(asRunStatus({ ...entry, endedBy: 'STOP' })).toBe('PARADA MANUAL')
    expect(asRunStatus({ ...entry, endedBy: null })).toBe('ENCERRAMENTO NÃO CLASSIFICADO')
  })
  it('exporta proveniência, escapa XML/CSV e não gera assinatura/certificado fictício', () => {
    const malicious = { ...entry, title: '=HYPERLINK("https://example.invalid") <&>', executionKind: 'SIMULATED' as const }
    expect(asRunCsv([malicious])).toContain('"\'=HYPERLINK(')
    expect(asRunCsv([malicious])).toContain('NÃO HOMOLOGADA')
    const xml = asRunXml([malicious], { id: 'ch"', name: 'CH <&>' })
    expect(xml).toContain('CH &lt;&amp;&gt;'); expect(xml).toContain('transport="SIMULATED"')
    expect(xml).not.toContain('CONFORME-BR')
    const report = asRunReport([malicious], { id: 'ch', name: 'Canal' }, new Date('2026-10-01T12:00:00Z'))
    expect(report).toContain('Sem assinatura digital'); expect(report).not.toContain('100% VÁLIDO')
  })
})
