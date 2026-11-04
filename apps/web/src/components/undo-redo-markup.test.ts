import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { UndoRedoButtons } from './UndoRedoButtons.js'
import { undoBlockedReason } from '../domain/editorial-context.js'

const render = (props: Parameters<typeof UndoRedoButtons>[0]) => renderToStaticMarkup(createElement(UndoRedoButtons, props))
describe('B14: desfazer/refazer visíveis', () => {
  it('mostra o que será desfeito e habilita só o que existe', () => {
    const html = render({ history: { canUndo: true, canRedo: false, undoLabel: 'Auto-Fill aplicado', redoLabel: null }, onUndo: () => {}, onRedo: () => {} })
    expect(html).toContain('Desfazer: Auto-Fill aplicado (Ctrl+Z)')
    expect(html).toMatch(/data-testid="btn-undo"(?![^>]*disabled="")/)
    expect(html).toMatch(/data-testid="btn-redo"[^>]*disabled=""/)
    expect(html).toContain('Nada para refazer (Ctrl+Y)')
  })
  it('na PLAYLIST com outra data exibida, explica e desabilita', () => {
    const reason = undoBlockedReason(false)!
    const html = render({ history: { canUndo: true, canRedo: true, undoLabel: 'x', redoLabel: 'y' }, onUndo: () => {}, onRedo: () => {}, blockedReason: reason })
    expect(html.match(/disabled=""/g)).toHaveLength(2)
    expect(html).toContain('grade carregada no Master')
    expect(undoBlockedReason(true)).toBeNull()
  })
  it('MASTER e PLAYLIST recebem os botões ligados ao mesmo undo do teclado', () => {
    const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
    expect(read('../views/MasterControlView.tsx')).toContain('<UndoRedoButtons history={history} onUndo={onUndo} onRedo={onRedo} compact />')
    expect(read('../views/PlaylistScheduleView.tsx')).toContain('<UndoRedoButtons history={history} onUndo={onUndo} onRedo={onRedo} blockedReason={undoBlockedReason(isLoadedEditorial)} />')
    expect(read('../App.tsx').match(/onUndo=\{\(\) => void undo\('undo'\)\}/g)).toHaveLength(2)
  })
})
