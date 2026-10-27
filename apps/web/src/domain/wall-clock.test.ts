import { describe, expect, it } from 'vitest'
import { wallClock, wallTime, parseHms, nowHms, anchorFramesFor, anchorWall, resolveWallInstant, formatHms } from './wall-clock.js'

const rate = { num: 30000, den: 1001 }
const fps = rate.num / rate.den
const now = new Date(2026, 9, 27, 16, 54, 26)

describe('relógio de parede da grade', () => {
  it('grade em loop de 20/10 vista em 27/10 mostra 16:54:26, não 184:54:26', () => {
    const frames = Math.round((7 * 86400 + 16 * 3600 + 54 * 60 + 26) * fps)
    expect(wallClock(frames, rate, '2026-10-20', now)).toBe('16:54:26')
    expect(wallTime(frames, rate, '2026-10-20')).toBe('16:54:26')
  })
  it('outro dia aparece com DD/MM', () => {
    const frames = Math.round((24 * 3600 + 30 * 60) * fps)
    expect(wallClock(frames, rate, '2026-10-27', now)).toBe('28/10 00:30:00')
  })
  it('âncora de "17:00 hoje" numa grade antiga fica a 7 dias + 17 h da base', () => {
    const instant = resolveWallInstant(17 * 3600, 'today', '2026-10-20', now)
    const at = anchorFramesFor(instant, rate, '2026-10-20')
    expect(Math.abs(at - Math.round((7 * 86400 + 17 * 3600) * fps))).toBeLessThanOrEqual(1)
    expect(anchorWall(at, rate, '2026-10-20', now)).toEqual({ seconds: 17 * 3600, day: 'today' })
  })
  it('grade futura: "hoje" é o dia da grade', () => {
    const instant = resolveWallInstant(8 * 3600, 'today', '2026-10-29', now)
    expect(instant.getDate()).toBe(29)
    expect(anchorFramesFor(instant, rate, '2026-10-29')).toBe(Math.round(8 * 3600 * fps))
  })
  it('valida HH:MM:SS e arredonda a hora atual para o próximo minuto', () => {
    expect(parseHms('17:05:09')).toBe(17 * 3600 + 5 * 60 + 9)
    expect(parseHms('7:05')).toBe(7 * 3600 + 5 * 60)
    for (const bad of ['24:00:00', '12:60:00', 'ab:cd', '', '12:00:61']) expect(parseHms(bad)).toBeNull()
    expect(nowHms(now)).toBe('16:54:26')
    expect(nowHms(now, 1)).toBe('16:55:00')
    expect(formatHms(86400 + 5)).toBe('00:00:05')
  })
})
