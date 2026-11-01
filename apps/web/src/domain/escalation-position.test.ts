import { describe, expect, it } from 'vitest'
import { PENDING_POSITION } from '../components/EscalationInbox.js'

describe('Pendências não cobrem botões de decisão', () => {
  it('ficam no centro da borda de baixo, não no canto direito (APROVAR QC/REJEITAR, Confirmar inserção)', () => {
    expect(PENDING_POSITION).toContain('bottom-3')
    expect(PENDING_POSITION).toContain('left-1/2')
    expect(PENDING_POSITION).not.toContain('right-3')
  })
})
