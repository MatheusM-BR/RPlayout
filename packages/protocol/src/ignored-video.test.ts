import { describe, expect, it } from 'vitest'
import { hasVideoFileSuffix, isIgnoredVideo } from './media.js'

describe('quarentena somente de vídeo', () => {
  it('não considera falha de leitura como prova de vídeo, inclusive legado', () => {
    for (const path of ['C:\\Ação\\roteiro.pdf', '/media/foto.png', '/media/audio.wav', '/media/planilha.xlsx', '/media/desconhecido.bin']) {
      expect(isIgnoredVideo({ ignored: true, kind: 'VIDEO', path, probeError: 'não abriu' })).toBe(false)
    }
    expect(isIgnoredVideo({ ignored: true, kind: 'AUDIO', path: 'audio.mp4' })).toBe(false)
    expect(isIgnoredVideo({ ignored: true, kind: 'STILL', path: 'capa.mov' })).toBe(false)
  })
  it('mantém vídeos quebrados conhecidos e não restringe vídeo confirmado pela sonda', () => {
    for (const path of ['C:\\Prévia\\AÇÃO.MXF', '/media/vt.MOV', '/media/arquivo.m2ts']) {
      expect(hasVideoFileSuffix(path)).toBe(true)
      expect(isIgnoredVideo({ ignored: true, kind: 'VIDEO', path, probeError: 'codec ausente' })).toBe(true)
    }
    expect(isIgnoredVideo({ ignored: true, kind: 'VIDEO', path: '/media/video.formato-futuro', probeError: null })).toBe(true)
    expect(isIgnoredVideo({ ignored: false, kind: 'VIDEO', path: '/media/vt.mp4' })).toBe(false)
    expect(hasVideoFileSuffix('/mp4/sem-extensao')).toBe(false)
  })
})
