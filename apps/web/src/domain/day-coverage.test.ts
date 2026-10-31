import { describe, expect, it } from 'vitest'
import { dayCoverage } from './day-coverage.js'

const fps = 30000 / 1001, day = Math.round(86_400 * fps), s = (n: number) => Math.round(n * fps)

describe('cobertura do dia na PLAYLIST (M2)', () => {
  it('2 min de conteúdo numa grade linear: o resto do dia é lacuna', () => {
    const coverage = dayCoverage([{ start: 0, end: s(60) }, { start: s(60), end: s(120) }], false, day, fps)
    expect(coverage.gapCount).toBe(1)
    expect(coverage.gapFrames).toBe(day - s(120))
  })
  it('em loop não há lacuna, mas o ciclo e as repetições ficam explícitos', () => {
    const coverage = dayCoverage([{ start: 0, end: s(120) }], true, day, fps)
    expect(coverage).toMatchObject({ loop: true, gapFrames: 0, gapCount: 0, cycleFrames: s(120), repeats: 721 })
  })
  it('buraco entre itens conta junto com o fim do dia; grade vazia é o dia inteiro', () => {
    const coverage = dayCoverage([{ start: 0, end: s(60) }, { start: s(600), end: s(660) }], false, day, fps)
    expect(coverage.gapCount).toBe(2)
    expect(coverage.gapFrames).toBe(s(600) - s(60) + day - s(660))
    expect(dayCoverage([], false, day, fps)).toMatchObject({ gapFrames: day, gapCount: 1 })
  })
})
