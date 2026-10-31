import { describe, expect, it } from 'vitest'
import { titleFrom } from './ingest.js'

describe('título a partir do nome do arquivo (B2)', () => {
  it('mantém o ponto decimal e troca separadores por espaço', () => {
    expect(titleFrom('/acervo/Barras 1kHz 1080p29.97.mp4')).toBe('Barras 1kHz 1080p29.97')
    expect(titleFrom('/acervo/leilao_nelore.final..mov')).toBe('leilao nelore final')
    expect(titleFrom('C:/acervo/VT.Movimento_20s.mp4')).toBe('VT Movimento 20s')
  })
})
