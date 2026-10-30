import { describe, expect, it } from 'vitest'
import { focusOwnsKey, masterDeleteAllowed } from './key-guards'

const el = (match: boolean) => ({ closest: () => (match ? {} : null) })

describe('key-guards', () => {
  it('foco em botão/link/select é dono da tecla; fora disso não', () => {
    expect(focusOwnsKey(el(true))).toBe(true)
    expect(focusOwnsKey(el(false))).toBe(false)
    expect(focusOwnsKey(null)).toBe(false)
  })
  it('Delete do Master respeita defaultPrevented, travamento, diálogo e foco em controle', () => {
    expect(masterDeleteAllowed({ defaultPrevented: false }, el(false), false, false)).toBe(true)
    expect(masterDeleteAllowed({ defaultPrevented: true }, el(false), false, false)).toBe(false)
    expect(masterDeleteAllowed({ defaultPrevented: false }, el(false), true, false)).toBe(false)
    expect(masterDeleteAllowed({ defaultPrevented: false }, el(false), false, true)).toBe(false)
    expect(masterDeleteAllowed({ defaultPrevented: false }, el(true), false, false)).toBe(false)
  })
})
