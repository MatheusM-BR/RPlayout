import { describe, expect, it } from 'vitest'
import { dedupeNotice } from './notice-text.js'
describe('B11: mensagens de inserção sem frase duplicada', () => {
  it('remove a repetição de "PGM anterior preservado"', () => {
    expect(dedupeNotice('TAKE recusado: sem sinal em 10 s; PGM anterior preservado; PGM anterior preservado')).toBe('TAKE recusado: sem sinal em 10 s; PGM anterior preservado.')
    expect(dedupeNotice('Passagem não preparada; PGM anterior preservado. arquivo não entregou quadro; PGM anterior preservado')).toBe('Passagem não preparada; PGM anterior preservado. arquivo não entregou quadro;'.replace(/;$/, '.'))
  })
  it('texto sem repetição fica igual', () => {
    expect(dedupeNotice('Inserido como próximo na revisão operacional; PGM/CUE preservados.')).toBe('Inserido como próximo na revisão operacional; PGM/CUE preservados.')
    expect(dedupeNotice(null)).toBe('')
  })
})
