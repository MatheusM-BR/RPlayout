import { describe, expect, it } from 'vitest'
import { formatVideoFormat, monitorSize, suggestedBitrateKbps } from './channel.js'
import { RATE } from './rate.js'

describe('nome do formato de vídeo', () => {
  it('progressivo leva a cadência de quadros', () => {
    expect(formatVideoFormat({ height: 1080, rate: RATE['50'], scan: 'PROGRESSIVE' })).toBe(
      '1080p50',
    )
    expect(formatVideoFormat({ height: 720, rate: RATE['25'], scan: 'PROGRESSIVE' })).toBe(
      '720p25',
    )
  })

  /**
   * A armadilha: em entrelaçado o número é a cadência de campos, o dobro da de
   * quadros. Um canal que guarda 30000/1001 se chama 1080i5994, não 1080i2997.
   */
  it('entrelaçado leva a cadência de campos, o dobro da de quadros', () => {
    expect(formatVideoFormat({ height: 1080, rate: RATE['29.97'], scan: 'INTERLACED' })).toBe(
      '1080i5994',
    )
    expect(formatVideoFormat({ height: 576, rate: RATE['25'], scan: 'INTERLACED' })).toBe(
      '576i50',
    )
  })

  it('NTSC fracionário sai sem vírgula, como o mercado escreve', () => {
    expect(formatVideoFormat({ height: 1080, rate: RATE['59.94'], scan: 'PROGRESSIVE' })).toBe(
      '1080p5994',
    )
    expect(formatVideoFormat({ height: 1080, rate: RATE['29.97'], scan: 'PROGRESSIVE' })).toBe(
      '1080p2997',
    )
  })
})

describe('suggestedBitrateKbps', () => {
  /**
   * O ponto do cálculo: o mesmo quadro em cadência dobrada custa o dobro.
   * Um número fixo -- que era o que havia -- mente exatamente aqui.
   */
  it('dobra quando a cadência dobra', () => {
    const p25 = suggestedBitrateKbps(1920, 1080, { num: 25, den: 1 })
    const p50 = suggestedBitrateKbps(1920, 1080, { num: 50, den: 1 })
    // Não é o dobro exato porque o resultado é arredondado para múltiplo de
    // 250 -- e é esse arredondamento que faz o número ser digitável. A folga
    // de um degrau é o preço, e é invisível na imagem.
    expect(Math.abs(p50 - p25 * 2)).toBeLessThanOrEqual(250)
    expect(p50).toBeGreaterThan(p25 * 1.9)
  })

  it('cai com a resolução', () => {
    const cheio = suggestedBitrateKbps(1920, 1080, { num: 30, den: 1 })
    const metade = suggestedBitrateKbps(960, 540, { num: 30, den: 1 })
    expect(metade).toBeLessThan(cheio)
  })

  /** 1080p50 pedia 4 Mbps antes: é a metade do que precisa. */
  it('dá ao 1080p50 um número de gente grande', () => {
    expect(suggestedBitrateKbps(1920, 1080, { num: 50, den: 1 })).toBeGreaterThan(7_000)
  })

  it('respeita piso e teto', () => {
    expect(suggestedBitrateKbps(64, 64, { num: 25, den: 1 })).toBe(2_000)
    expect(suggestedBitrateKbps(7680, 4320, { num: 60, den: 1 })).toBe(25_000)
  })

  /** Número redondo é o que alguém digita quando vai ajustar na mão. */
  it('sai em múltiplo de 250', () => {
    for (const [w, h, n] of [
      [1920, 1080, 30],
      [1280, 720, 60],
      [720, 480, 30],
    ] as const) {
      expect(suggestedBitrateKbps(w, h, { num: n, den: 1 }) % 250).toBe(0)
    }
  })
})

describe('monitorSize', () => {
  /** 1080p vira 480p mantendo o 16:9: monitor esticado engana enquadramento. */
  it('reduz 1080p para 480p sem deformar', () => {
    expect(monitorSize(1920, 1080)).toEqual([854, 480])
  })

  it('mantém a proporção 4:3', () => {
    expect(monitorSize(1440, 1080)).toEqual([640, 480])
  })

  /** O que já é pequeno não é ampliado: monitor não inventa resolução. */
  it('não amplia o que já cabe', () => {
    expect(monitorSize(640, 360)).toEqual([640, 360])
  })

  it('sai sempre em números pares', () => {
    for (const [w, h] of [
      [1920, 1080],
      [1280, 720],
      [1001, 563],
      [4096, 2160],
    ] as const) {
      const [largura, altura] = monitorSize(w, h)
      expect(largura % 2).toBe(0)
      expect(altura % 2).toBe(0)
    }
  })
})
