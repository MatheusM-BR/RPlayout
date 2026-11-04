import { describe, expect, it } from 'vitest'
import { insertionConflicts, joinNotice } from './insertion-conflicts.js'

describe('B11: conferência da inserção operacional', () => {
  const anchor = { kind: 'ANCHOR_MISSED', itemId: 'fixo-0410', message: 'A âncora de 04:10:00 já passou.' }
  it('conflito antigo e sem relação com o item inserido não aparece', () => {
    expect(insertionConflicts([anchor], [anchor], 'urgent:1')).toEqual([])
  })
  it('conflito novo, ou do próprio item inserido, aparece uma vez', () => {
    const overrun = { kind: 'OVERRUN', itemId: 'urgent:1', message: 'Estoura 00:05.' }
    const pushed = { kind: 'ANCHOR_MISSED', itemId: 'fixo-0500', message: 'A âncora de 05:00:00 não vai bater.' }
    expect(insertionConflicts([anchor], [anchor, overrun, overrun, pushed], 'urgent:1')).toEqual([overrun, pushed])
  })
  it('conflito que já existia e a inserção piora (mesmo tipo e item, mensagem diferente, atraso maior) aparece', () => {
    const before = { kind: 'ANCHOR_MISSED', itemId: 'fixo-0500', frames: 150, severity: 'WARN', message: 'A âncora de 05:00:00 atrasa 00:05.' }
    const worse = { ...before, frames: 900, message: 'A âncora de 05:00:00 atrasa 00:30.' }
    const same = { ...before }
    const better = { ...before, frames: 60, message: 'A âncora de 05:00:00 atrasa 00:02.' }
    const escalated = { ...before, severity: 'ERROR', message: 'A âncora de 05:00:00 não vai bater.' }
    expect(insertionConflicts([before], [worse], 'urgent:1')).toEqual([worse])
    expect(insertionConflicts([before], [same], 'urgent:1')).toEqual([])
    expect(insertionConflicts([before], [better], 'urgent:1')).toEqual([])
    expect(insertionConflicts([before], [escalated], 'urgent:1')).toEqual([escalated])
    // Sem tamanho em frames: mensagem diferente conta como mudança.
    const plain = { kind: 'OVERLAP', itemId: 'x', message: 'Sobrepõe 2 s.' }
    expect(insertionConflicts([plain], [{ ...plain, message: 'Sobrepõe 9 s.' }], 'urgent:1')).toEqual([{ ...plain, message: 'Sobrepõe 9 s.' }])
  })
  it('motivo de HOLD não repete "PGM anterior preservado"', () => {
    const text = joinNotice('Passagem não preparada; PGM anterior preservado.', 'arquivo não entregou quadro de vídeo no preroll; PGM anterior preservado')
    expect(text.match(/PGM anterior preservado/g)).toHaveLength(1)
    expect(text).toBe('Passagem não preparada; PGM anterior preservado. arquivo não entregou quadro de vídeo no preroll.')
  })
})
