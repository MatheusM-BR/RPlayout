import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { LOUDNESS_TARGETS, TRUE_PEAK_CEILINGS } from './loudness-targets.js'
describe('B7: rótulos de loudness conferem com as normas', () => {
  it('EBU R128 é -23 LUFS e só ele leva esse nome; -24 é ATSC A/85', () => {
    const r128 = LOUDNESS_TARGETS.filter(target => target.label.includes('R128'))
    expect(r128.map(target => target.value)).toEqual([-23])
    expect(LOUDNESS_TARGETS.find(target => target.value === -24)?.label).toContain('ATSC A/85')
    for (const target of LOUDNESS_TARGETS) expect(target.label.startsWith(target.value.toFixed(1))).toBe(true)
    expect(TRUE_PEAK_CEILINGS.find(c => c.label.includes('R128'))?.value).toBe(-1)
  })
  it('a tela usa a lista (sem rótulo solto no JSX)', () => {
    const view = readFileSync(new URL('../views/SettingsView.tsx', import.meta.url), 'utf8')
    expect(view).toContain('LOUDNESS_TARGETS.map')
    expect(view).not.toMatch(/-24\.0 LUFS \([^)]*R128/)
  })
})
