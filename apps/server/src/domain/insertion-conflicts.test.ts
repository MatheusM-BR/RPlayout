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
  it('motivo de HOLD não repete "PGM anterior preservado"', () => {
    const text = joinNotice('Passagem não preparada; PGM anterior preservado.', 'arquivo não entregou quadro de vídeo no preroll; PGM anterior preservado')
    expect(text.match(/PGM anterior preservado/g)).toHaveLength(1)
    expect(text).toBe('Passagem não preparada; PGM anterior preservado. arquivo não entregou quadro de vídeo no preroll.')
  })
})
