import { describe, expect, it } from 'vitest'
import { finalCount, gradeEndWarning, mmss } from './broadcast-cues.js'

describe('contagem final do item no ar', () => {
  it('normal acima de 10 s, âmbar até 10 s, pisca até 5 s', () => {
    expect(finalCount(30 * 11, 30, true, 0)).toBeNull()
    expect(finalCount(30 * 10, 30, true, 0)).toBe('last10')
    expect(finalCount(30 * 5, 30, true, 0)).toBe('last5')
    expect(finalCount(1, 29.97, true, 0)).toBe('last5')
  })
  it('itens curtos (vinhetas, spots) não piscam', () => {
    expect(finalCount(30 * 4, 30, true, 0, 30 * 13)).toBeNull()
    expect(finalCount(30 * 4, 30, true, 0, 30 * 30)).toBe('last5')
  })
  it('sem contagem parado, pausado, estourado ou zerado', () => {
    expect(finalCount(30 * 3, 30, false, 0)).toBeNull()
    expect(finalCount(30 * 3, 30, true, 12)).toBeNull()
    expect(finalCount(0, 30, true, 0)).toBeNull()
  })
})

describe('aviso de fim da grade', () => {
  const now = Date.UTC(2026, 9, 28, 23, 0)
  it('só nos últimos 15 minutos; urgente nos últimos 2', () => {
    expect(gradeEndWarning(now + 16 * 60_000, now)).toBeNull()
    expect(gradeEndWarning(now + 15 * 60_000, now)).toEqual({ level: 'warn', leftMs: 15 * 60_000 })
    expect(gradeEndWarning(now + 90_000, now)?.level).toBe('urgent')
    expect(gradeEndWarning(now - 1, now)).toBeNull()
    expect(gradeEndWarning(null, now)).toBeNull()
  })
  it('formata mm:ss arredondando para cima', () => {
    expect(mmss(61_001)).toBe('01:02')
    expect(mmss(0)).toBe('00:00')
  })
})

import { nextFixedCommitment, countdownText } from './broadcast-cues.js'
describe('próximo horário fixo', () => {
  const ms = (frames: number) => frames * 40 // 25 fps
  const now = 1000 * 40
  const items = [
    { id: 'a', title: 'Fluxo', anchor: { kind: 'FLOW' } },
    { id: 'b', title: 'Leilão 20h', anchor: { kind: 'FIXED', at: 5000 } },
    { id: 'c', title: 'Rede', anchor: { kind: 'HARD_TIME', at: 3000 } },
    { id: 'd', title: 'Passado', anchor: { kind: 'FIXED', at: 500 } },
  ]
  it('escolhe o compromisso mais próximo ainda por vir', () => {
    const next = nextFixedCommitment(items, new Map([['c', { anchorHit: false, deviation: 50 }]]), ms, now)
    expect(next).toEqual(expect.objectContaining({ itemId: 'c', kind: 'HARD_TIME', leftMs: 2000 * 40, hit: false, deviationMs: 2000 }))
  })
  it('sem âncoras futuras não mostra nada', () => {
    expect(nextFixedCommitment([items[0]!, items[3]!], new Map(), ms, now)).toBeNull()
  })
  it('contagem com hora quando passa de 60 min', () => {
    expect(countdownText(3_725_000)).toBe('01:02:05')
    expect(countdownText(65_000)).toBe('01:05')
  })
})
