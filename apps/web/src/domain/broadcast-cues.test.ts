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
