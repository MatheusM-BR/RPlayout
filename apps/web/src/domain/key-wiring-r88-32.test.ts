import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('ligação das teclas (r88-32)', () => {
  it('Espaço é sempre TAKE (solta o foco do botão) e vai ao vídeo em foco', () => {
    const app = read('../App.tsx')
    const space = app.indexOf("event.code === 'Space'")
    expect(space).toBeGreaterThan(0)
    const block = app.slice(space, space + 1200)
    expect(block).not.toContain('focusOwnsKey')
    expect(block).toContain('.blur()')
    expect(block).toContain("command('take', { itemId: selectedId })")
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
