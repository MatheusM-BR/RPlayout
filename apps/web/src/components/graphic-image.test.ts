import { describe, expect, it } from 'vitest'
import { svgForImage } from './GraphicTemplatesEditor.js'

describe('PNG/JPG vira arte SVG (M8)', () => {
  it('imagem 1920×1080 ocupa a tela inteira com a imagem embutida', () => {
    const svg = svgForImage('data:image/png;base64,AAAA', 1920, 1080)
    expect(svg).toContain('viewBox="0 0 1920 1080"')
    expect(svg).toContain('x="0" y="0" width="1920" height="1080"')
    expect(svg).toContain('href="data:image/png;base64,AAAA"')
  })
  it('tarja menor fica centralizada e sem distorcer; maior é reduzida', () => {
    expect(svgForImage('data:image/png;base64,AA', 800, 200)).toContain('x="560" y="440" width="800" height="200"')
    expect(svgForImage('data:image/png;base64,AA', 3840, 2160)).toContain('width="1920" height="1080"')
  })
})
