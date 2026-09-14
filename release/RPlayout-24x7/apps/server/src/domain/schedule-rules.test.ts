import { describe, expect, it } from 'vitest'
import { conflictsWithScheduleRule } from './schedule-rules.js'

describe('conflitos de pauta', () => {
  const base = { id: 'a', weekdays: '01234', startMinute: 60, endMinute: 120 }
  it('detecta interseção no mesmo dia', () => {
    expect(conflictsWithScheduleRule({ weekdays: '2', startMinute: 100, endMinute: 150 }, [base])).toBe(true)
  })
  it('aceita horários encostados ou dias diferentes', () => {
    expect(conflictsWithScheduleRule({ weekdays: '2', startMinute: 120, endMinute: 180 }, [base])).toBe(false)
    expect(conflictsWithScheduleRule({ weekdays: '6', startMinute: 100, endMinute: 150 }, [base])).toBe(false)
  })
  it('ignora a própria faixa durante edição', () => {
    expect(conflictsWithScheduleRule({ weekdays: '2', startMinute: 70, endMinute: 110 }, [base], 'a')).toBe(false)
  })
})
