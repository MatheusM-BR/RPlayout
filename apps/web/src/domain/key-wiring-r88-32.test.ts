import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('ligação das teclas (r88-32)', () => {
  it('Espaço só vira TAKE se o foco não é de um controle', () => {
    const app = read('../App.tsx')
    const space = app.indexOf("event.code === 'Space'")
    expect(space).toBeGreaterThan(0)
    expect(app.slice(space, space + 200)).toContain('focusOwnsKey(element)')
  })
  it('Delete do Master usa a mesma guarda e ABORT desarma com Esc', () => {
    const master = read('../views/MasterControlView.tsx')
    expect(master).toContain('masterDeleteAllowed(e, element, panelLocked, dialogOpen)')
    expect(master).toContain("event.key !== 'Escape'")
  })
  it('rejeitar no QC pede confirmação e ALINHAR prende o foco', () => {
    expect(read('../views/QualityControlView.tsx')).toMatch(/handleReject = async[\s\S]{0,400}confirmAction/)
    const focus = read('../components/FocusAlignment.tsx')
    expect(focus).toContain('trapTab(event, dialogRef.current)')
    expect(focus).toContain('actions().length === 0')
  })
})
