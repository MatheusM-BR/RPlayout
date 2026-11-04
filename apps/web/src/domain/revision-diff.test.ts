import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { revisionDiffLines } from './revision-diff.js'

describe('B5: diff de revisões legível', () => {
  it('item removido aparece pelo título, não pelo ID interno', () => {
    const { lines } = revisionDiffLines({ simulated: { items: [] }, differences: { added: [], removed: ['urgent:f48501e9-1'], removedTitles: { 'urgent:f48501e9-1': 'SD 4x3' }, changed: [] } })
    expect(lines.map(line => line.text)).toEqual(['− Item removido: SD 4x3'])
    expect(lines[0]!.text).not.toContain('urgent:')
  })
  it('sem título no registro, não expõe o ID', () => {
    const { lines } = revisionDiffLines({ simulated: { items: [] }, differences: { added: [], removed: ['urgent:x'], changed: [] } })
    expect(lines[0]!.text).toBe('− Item removido: item sem título no registro')
  })
  it('deslocamento de posição vira uma linha só e não conta como alteração de conteúdo', () => {
    const items = Array.from({ length: 16 }, (_, index) => ({ id: `i${index}`, title: `VT ${index}` }))
    const changed = items.map(item => ({ itemId: item.id, fields: ['order'] }))
    changed[3] = { itemId: 'i3', fields: ['order', 'title'] }
    const diff = revisionDiffLines({ simulated: { items }, differences: { added: [], removed: [], changed } })
    expect(diff.contentChanges).toBe(1)
    expect(diff.moved).toBe(15)
    expect(diff.lines.map(line => line.text)).toEqual(['VT 3: título (e posição)', '15 item(ns) só mudaram de posição na grade.'])
  })
  it('Esc fecha a conferência de publicação', () => {
    const view = readFileSync(new URL('../views/PlaylistScheduleView.tsx', import.meta.url), 'utf8')
    expect(view).toContain('useEscape(showOperationalReview && !rollbackReview, closeOperationalReview)')
  })
})
