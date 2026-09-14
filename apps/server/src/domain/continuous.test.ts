import { describe, expect, it } from 'vitest'
import { activeHorizonRule, shouldFillHorizon } from './continuous.js'

describe('preenchimento contínuo', () => {
  it('só sinaliza quando a grade está no horizonte', () => {
    expect(shouldFillHorizon(600, 604)).toBe(true)
    expect(shouldFillHorizon(600, 606)).toBe(false)
  })
  it('seleciona a faixa do dia e horário atuais', () => {
    const rules = [{ weekdays: '01234', startMinute: 360, endMinute: 720 }, { weekdays: '56', startMinute: 720, endMinute: 1080 }]
    expect(activeHorizonRule(rules, 500, 2)).toEqual(rules[0])
    expect(activeHorizonRule(rules, 500, 6)).toBeNull()
    expect(activeHorizonRule(rules, 800, 6)).toEqual(rules[1])
  })
})
