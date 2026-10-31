import { describe, expect, it } from 'vitest'
import { asRunCsv, asRunDuration, asRunHold, asRunReport, asRunStatus, asRunXml, summarizeAsRun } from './asrun-evidence.js'
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
  it('registra o tempo real no PGM e o congelamento além da duração nominal (A6)', () => {
    // 40,04 s nominais (1200 quadros a 29,97) entre 07:59:32.9 e 08:00:23.5.
    const frozen = { ...entry, startedAt: '2026-10-31T07:59:32.900Z', endedAt: '2026-10-31T08:00:23.500Z', airedFrames: 1200, rateNum: 30000, rateDen: 1001 }
    const hold = asRunHold(frozen)
    expect(hold.wallSeconds).toBeCloseTo(50.6, 3)
    expect(hold.heldSeconds).toBe(10.6)
    expect(asRunCsv([frozen])).toContain('Parado/congelado além da duração (s)')
    expect(asRunReport([frozen], { id: 'c', name: 'C' }, new Date(0))).toContain('congelado +10.6s')
    // Diferença de relógio abaixo de 1 s não é congelamento.
    expect(asRunHold(entry).heldSeconds).toBeNull()
  })
})

describe('paradas do ao vivo na exportação do AIRED', () => {
  const live: AsRunEntry = { ...entry, id: 'live', title: 'Leilão', type: 'LIVE', startedAt: '2026-10-31T12:00:00.000Z', endedAt: '2026-10-31T14:00:00.000Z', outageTotalMs: 25000,
    outages: [
      { id: 'o1', asRunId: 'live', itemId: 'i', sourceName: 'Câmera', startedAt: '2026-10-31T13:10:00.000Z', endedAt: '2026-10-31T13:10:15.000Z', durationMs: 15000, reasons: ['SIGNAL_LOSS'], action: 'WAIT_ART', closedBy: 'SIGNAL_RETURNED' },
      { id: 'o2', asRunId: 'live', itemId: 'i', sourceName: 'Câmera', startedAt: '2026-10-31T13:59:50.000Z', endedAt: '2026-10-31T14:00:00.000Z', durationMs: 10000, reasons: ['BLACK'], action: 'CONTINGENCY', closedBy: 'ITEM_ENDED' },
    ] }
  it('com a opção (padrão): sub-linhas com início, fim, duração, motivo e ação, e o total parado', () => {
    const csv = asRunCsv([live])
    expect(csv).toContain('Parado total (s)')
    expect(csv).toContain('↳ parada: sem sinal')
    expect(csv).toContain('2026-10-31T13:10:00.000Z')
    expect(csv).toContain('fechada no fim do item')
    const xml = asRunXml([live], { id: 'c', name: 'Canal' })
    expect(xml).toContain('<LiveOutages totalSeconds="25.0"><Outage start="2026-10-31T13:10:00.000Z" end="2026-10-31T13:10:15.000Z" seconds="15.0" reason="SIGNAL_LOSS" action="WAIT_ART"')
    const report = asRunReport([live], { id: 'c', name: 'Canal' }, new Date('2026-10-31T15:00:00Z'))
    expect(report).toContain('parado no item: 25 s em 2 parada(s)')
    expect(report).toContain('↳ 2026-10-31T13:10:00.000Z → 2026-10-31T13:10:15.000Z (15 s) · sem sinal · grafismo de espera')
  })
  it('sem a opção: exportação igual à de antes', () => {
    const plain = { ...live, outages: undefined, outageTotalMs: undefined }
    expect(asRunCsv([live], { includeOutages: false })).toBe(asRunCsv([plain], { includeOutages: false }))
    expect(asRunCsv([live], { includeOutages: false }).split('\n')[0]).not.toContain('Parado total')
    expect(asRunXml([live], { id: 'c', name: 'Canal' }, { includeOutages: false })).toBe(asRunXml([plain], { id: 'c', name: 'Canal' }))
    expect(asRunReport([live], { id: 'c', name: 'Canal' }, new Date(0), { includeOutages: false })).toBe(asRunReport([plain], { id: 'c', name: 'Canal' }, new Date(0)))
  })
})
