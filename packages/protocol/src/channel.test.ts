import { describe, expect, it } from 'vitest'
import { formatVideoFormat } from './channel.js'
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
