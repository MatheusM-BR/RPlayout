import { describe, expect, it } from 'vitest'
import { cutProposal, fillProposals, focusStatus } from './alignment.js'

const rows = [
  { id: 'a', title: 'No ar', startMs: 0, endMs: 60_000, anchor: { kind: 'FLOW' } },
  { id: 'b', title: 'VT', startMs: 60_000, endMs: 100_000, anchor: { kind: 'FLOW' } },
  { id: 'f', title: 'Leilão 20h', startMs: 160_000, endMs: 400_000, anchor: { kind: 'FIXED', at: 1 } },
]
describe('foco no item', () => {
  it('horário fixo: sobra entre a chegada e o horário vira PREENCHER', () => {
    const status = focusStatus({ focusItemId: 'f', rows, anchorMs: 160_000, operatorTargetMs: null, nowMs: 10_000 })
    expect(status).toMatchObject({ leftMs: 150_000, arrivalMs: 100_000, diffMs: 60_000, mode: 'FILL', fixed: true })
  })
  it('alvo do operador num item de fluxo; atraso vira CORTAR; dentro de 1 s está OK', () => {
    expect(focusStatus({ focusItemId: 'b', rows, anchorMs: null, operatorTargetMs: 50_000, nowMs: 0 })).toMatchObject({ diffMs: -10_000, mode: 'CUT' })
    expect(focusStatus({ focusItemId: 'b', rows, anchorMs: null, operatorTargetMs: 60_500, nowMs: 0 })!.mode).toBe('OK')
    expect(focusStatus({ focusItemId: 'b', rows, anchorMs: null, operatorTargetMs: null, nowMs: 0 })!.mode).toBeNull()
  })
})
describe('compensação automática do agendador', () => {
  it('não esconde o atraso: o agendador pulou o opcional e cortou o VT anterior para bater o horário', () => {
    const compensated = [
      { id: 'a', title: 'No ar', startMs: 0, endMs: 40_000, anchor: { kind: 'FLOW' } },
      { id: 'b', title: 'Bloco 2', startMs: 40_000, endMs: 76_200, anchor: { kind: 'FLOW' }, autoAdjustMs: 3_800 },
      { id: 'o', title: 'Vinheta', startMs: 80_000, endMs: 95_000, anchor: { kind: 'FLOW' }, dropped: true, autoAdjustMs: 15_000 },
      { id: 'f', title: 'Leilão', startMs: 76_200, endMs: 120_000, anchor: { kind: 'FIXED', at: 1 } },
    ]
    const status = focusStatus({ focusItemId: 'f', rows: compensated, anchorMs: 76_200, operatorTargetMs: null, nowMs: 5_000 })
    expect(status).toMatchObject({ scheduledArrivalMs: 76_200, autoCutMs: 18_800, arrivalMs: 95_000, diffMs: -18_800, mode: 'CUT' })
  })
})
describe('propostas', () => {
  const vts = [{ key: 'v30', title: '30', durationMs: 30_000 }, { key: 'v20', title: '20', durationMs: 20_000 }, { key: 'v15', title: '15', durationMs: 15_000 }, { key: 'v13', title: '13', durationMs: 13_000 }]
  it('preencher 45 s: soma exata com menos itens primeiro, nunca passa da sobra, alternativas diferentes', () => {
    const proposals = fillProposals(45_000, vts)
    expect(proposals[0]).toMatchObject({ totalMs: 45_000, restMs: 0 })
    expect(proposals[0]!.keys.sort()).toEqual(['v15', 'v30'])
    for (const proposal of proposals) expect(proposal.totalMs).toBeLessThanOrEqual(45_000)
    expect(new Set(proposals.map(proposal => [...proposal.keys].sort().join())).size).toBe(proposals.length)
    expect(fillProposals(5_000, vts)).toEqual([])
  })
  it('cortar 25 s: menor sobra; se nada alcança, recupera o máximo', () => {
    const options = [{ key: 'drop', title: 'opcional', savesMs: 40_000 }, { key: 'tail', title: 'fim', savesMs: 12_000 }, { key: 'head', title: 'início', savesMs: 14_000 }]
    expect(cutProposal(25_000, options)).toMatchObject({ savedMs: 26_000, reaches: true })
    expect(cutProposal(100_000, options)).toMatchObject({ savedMs: 66_000, reaches: false })
    expect(cutProposal(5_000, [])).toBeNull()
  })
})
