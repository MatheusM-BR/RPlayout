import { describe, expect, it } from 'vitest'
import { trapTab } from './focus-trap'

function fake() {
  const focused: string[] = []
  const mk = (id: string) => ({ id, focus: () => { focused.push(id) } }) as unknown as HTMLElement
  const a = mk('a'); const b = mk('b'); const out = mk('out')
  const container = { querySelectorAll: () => [a, b], contains: (x: unknown) => x === a || x === b } as unknown as HTMLElement
  return { a, b, out, container, focused }
}
const key = (shiftKey = false) => { let prevented = false; return { key: 'Tab', shiftKey, preventDefault: () => { prevented = true }, get prevented() { return prevented } } }

describe('trapTab', () => {
  it('Tab no último volta ao primeiro', () => {
    const f = fake(); const e = key()
    expect(trapTab(e, f.container, f.b)).toBe(true); expect(f.focused).toEqual(['a']); expect(e.prevented).toBe(true)
  })
  it('Shift+Tab no primeiro vai ao último', () => {
    const f = fake()
    expect(trapTab(key(true), f.container, f.a)).toBe(true); expect(f.focused).toEqual(['b'])
  })
  it('foco fora entra no diálogo; no meio do caminho não interfere; outra tecla ignora', () => {
    const f = fake()
    expect(trapTab(key(), f.container, f.out)).toBe(true); expect(f.focused).toEqual(['a'])
    expect(trapTab(key(), f.container, f.a)).toBe(false)
    expect(trapTab({ key: 'Enter', shiftKey: false, preventDefault: () => {} }, f.container, f.b)).toBe(false)
  })
})
