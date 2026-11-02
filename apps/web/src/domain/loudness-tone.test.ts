import { expect, it } from 'vitest'
import { loudnessTone, loudnessToneClass } from './loudness-tone.js'
it('silêncio (−70 LUFS) não é verde; faixa em torno do alvo é (M6)', () => {
  expect(loudnessTone(-70, -23)).toBe('silence')
  expect(loudnessToneClass[loudnessTone(-70, -23)]).not.toContain('status-ok')
  expect(loudnessTone(-23.3, -23)).toBe('ok')
  expect(loudnessTone(-27, -23)).toBe('warn')
  expect(loudnessTone(2.3, -23)).toBe('bad')
  expect(loudnessTone(NaN, -23)).toBe('unknown')
})
