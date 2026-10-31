import {describe, expect, it} from 'vitest'
import {analyzeScopeSample, inTargetBox, levelRow, parseYcc, sampleFromCodes, sampleFromRgba, vectorPolar, vectorTargets, waveformDensity, TARGET_TOLERANCE, BAR_ORDER, type BarName} from './qc-colorimetry.js'

// Codificador de referência escrito à parte (BT.709, 8 bits, faixa limitada),
// para o teste não depender da matriz que ele está conferindo.
function encode709(r: number, g: number, b: number): [number, number, number] {
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const cb = (b - y) / 1.8556, cr = (r - y) / 1.5748
  return [Math.round(16 + 219 * y), Math.round(128 + 224 * cb), Math.round(128 + 224 * cr)]
}

const BARS: Array<[BarName | 'W' | 'K', [number, number, number]]> = [
  ['W', [1, 1, 1]], ['Yl', [1, 1, 0]], ['Cy', [0, 1, 1]], ['G', [0, 1, 0]],
  ['Mg', [1, 0, 1]], ['R', [1, 0, 0]], ['B', [0, 0, 1]], ['K', [0, 0, 0]],
]

/** Quadro sintético de barras SMPTE RP 219 (faixa superior) no nível pedido. */
function barsFrame(level: number, width = 960, height = 54) {
  const y = new Uint8Array(width * height), cb = new Uint8Array(width * height), cr = new Uint8Array(width * height)
  const barWidth = width / BARS.length
  for (let row = 0; row < height; row++) for (let x = 0; x < width; x++) {
    const [, rgb] = BARS[Math.floor(x / barWidth)]!
    const codes = encode709(rgb[0] * level, rgb[1] * level, rgb[2] * level)
    y[row * width + x] = codes[0]; cb[row * width + x] = codes[1]; cr[row * width + x] = codes[2]
  }
  return {sample: sampleFromCodes(width, height, y, cb, cr), barWidth, width}
}

/** Rampa de luma 0..255 (inclui sub-black e super-white), croma neutro. */
function rampFrame(width = 1024, height = 8) {
  const y = new Uint8Array(width * height), c = new Uint8Array(width * height).fill(128)
  for (let row = 0; row < height; row++) for (let x = 0; x < width; x++) y[row * width + x] = Math.floor(x * 256 / width)
  return sampleFromCodes(width, height, y, c, c)
}

describe('vectorscope BT.709: alvos calculados pela matriz', () => {
  it('ângulos e raios dos alvos de 75% são os do BT.709, não os do NTSC', () => {
    const expected: Record<BarName, [number, number]> = {R: [102.9, 0.77], Mg: [49.7, 0.89], B: [354.8, 0.75], Cy: [282.9, 0.77], G: [229.7, 0.89], Yl: [174.8, 0.75]}
    for (const target of vectorTargets(0.75)) {
      expect(target.angleDeg, target.name).toBeCloseTo(expected[target.name][0], 1)
      expect(target.magnitude, target.name).toBeCloseTo(expected[target.name][1], 2)
    }
    // 100% fica a 4/3 do raio de 75% e no mesmo ângulo.
    const t100 = vectorTargets(1), t75 = vectorTargets(0.75)
    t100.forEach((target, index) => {
      expect(target.angleDeg).toBeCloseTo(t75[index]!.angleDeg, 6)
      expect(target.magnitude / t75[index]!.magnitude).toBeCloseTo(4 / 3, 6)
    })
  })

  for (const level of [0.75, 1]) it(`barras RP 219 ${level * 100}% caem dentro das caixas (±${TARGET_TOLERANCE.inner.phaseDeg}°, ±${TARGET_TOLERANCE.inner.gain * 100}%)`, () => {
    const {sample, barWidth, width} = barsFrame(level)
    const targets = vectorTargets(level)
    for (const name of BAR_ORDER) {
      const bar = BARS.findIndex(([label]) => label === name)
      const x = Math.floor((bar + 0.5) * barWidth), index = 10 * width + x
      const target = targets.find(candidate => candidate.name === name)!
      expect(inTargetBox(sample.cb[index]!, sample.cr[index]!, target), `${name} em ${vectorPolar(sample.cb[index]!, sample.cr[index]!).angleDeg.toFixed(1)}°`).toBe(true)
    }
  })

  it('o mesmo vale para RGB full-range decodificado com BT.709 (vídeo no navegador)', () => {
    const width = 8, rgba = new Uint8ClampedArray(width * 4)
    BARS.forEach(([, rgb], index) => { rgba.set([rgb[0] * 191.25, rgb[1] * 191.25, rgb[2] * 191.25, 255].map(Math.round), index * 4) })
    const sample = sampleFromRgba(rgba, width, 1)
    for (const target of vectorTargets(0.75)) {
      const index = BARS.findIndex(([label]) => label === target.name)
      expect(inTargetBox(sample.cb[index]!, sample.cr[index]!, target), target.name).toBe(true)
    }
    expect(sample.source).toBe('rgb-browser')
  })
})

describe('waveform: níveis em % de SMPTE RP 219', () => {
  it('rampa 0..255: 16 → 0%, 235 → 100%, 0 → −7,3% e 255 → +109,1%, acusada como ilegal', () => {
    const ramp = rampFrame()
    const level = (code: number) => ramp.y[code * 4]! * 100
    expect(level(16)).toBeCloseTo(0, 6)
    expect(level(235)).toBeCloseTo(100, 6)
    const stats = analyzeScopeSample(ramp)
    expect(stats.lumaMin).toBeCloseTo(-7.31, 2)
    expect(stats.lumaMax).toBeCloseTo(109.13, 2)
    expect(stats.lumaIllegal).toBe(true)
    expect(stats.belowBlack).toBeGreaterThan(0.05)
    expect(stats.aboveWhite).toBeGreaterThan(0.07)
  })

  it('densidade do waveform: amostras abaixo de 0% e acima de 100% ficam visíveis em linhas próprias', () => {
    const rows = 591, columns = 512, density = waveformDensity(rampFrame(), columns, rows)
    const rowOf = (percent: number) => levelRow(percent, rows)
    const hits = (row: number) => { let sum = 0; for (let column = 0; column < columns; column++) sum += density[row * columns + column]!; return sum }
    expect(hits(rowOf(0))).toBeGreaterThan(0)
    expect(hits(rowOf(100))).toBeGreaterThan(0)
    expect(hits(rowOf(-7.31))).toBeGreaterThan(0)
    expect(hits(rowOf(109.13))).toBeGreaterThan(0)
    expect(rowOf(110)).toBe(0)
    expect(rowOf(-8)).toBe(rows - 1)
    // A rampa sobe da esquerda para a direita: primeira coluna embaixo, última em cima.
    const columnPeak = (column: number) => { for (let row = 0; row < rows; row++) if (density[row * columns + column]) return row; return -1 }
    expect(columnPeak(0)).toBe(rowOf(-7.31))
    expect(columnPeak(columns - 1)).toBe(rowOf(109.13))
  })

  it('barras 100% legais: preto 0%, branco 100%, gamut R\'G\'B\' dentro (não acusadas)', () => {
    const stats = analyzeScopeSample(barsFrame(1).sample)
    expect(stats.lumaMin).toBeCloseTo(0, 6)
    expect(stats.lumaMax).toBeCloseTo(100, 6)
    expect(stats.lumaIllegal).toBe(false)
    expect(stats.gamutIllegal).toBe(false)
    expect(stats.rgbMin).toBeGreaterThan(-1)
    expect(stats.rgbMax).toBeLessThan(101)
    // A magnitude Cb/Cr do magenta passa de 1, e isso NÃO é ilegal.
    expect(stats.chromaMax).toBeGreaterThan(1.1)
  })

  it('barras 75%: branco a 75%, nada ilegal', () => {
    const stats = analyzeScopeSample(barsFrame(0.75).sample)
    expect(stats.lumaMax).toBeCloseTo(75, 0)
    expect(stats.lumaIllegal).toBe(false)
    expect(stats.gamutIllegal).toBe(false)
  })

  it('croma fora do gamut RGB é acusado mesmo com luma legal', () => {
    const count = 100, y = new Uint8Array(count).fill(126), cb = new Uint8Array(count).fill(240), cr = new Uint8Array(count).fill(240)
    const stats = analyzeScopeSample(sampleFromCodes(count, 1, y, cb, cr))
    expect(stats.lumaIllegal).toBe(false)
    expect(stats.gamutIllegal).toBe(true)
  })

  it('amostra decodificada pelo navegador não finge medir ilegalidade', () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255])
    const stats = analyzeScopeSample(sampleFromRgba(rgba, 2, 1))
    expect(stats.lumaIllegal).toBeNull()
    expect(stats.gamutIllegal).toBeNull()
  })
})

describe('arquivo .ycc do servidor', () => {
  it('lê o cabeçalho BT.709 faixa limitada e os planos 4:4:4', () => {
    const width = 4, height = 2, body = new Uint8Array(16 + width * height * 3)
    body.set([82, 80, 89, 67, 1, 1, 0, 8, width, 0, height, 0])
    body.fill(235, 16, 16 + 8); body.fill(128, 24)
    const sample = parseYcc(body.buffer)
    expect(sample.width).toBe(4); expect(sample.height).toBe(2)
    expect(sample.y[0]! * 100).toBeCloseTo(100, 6)
    expect(sample.source).toBe('ycbcr-original')
  })
  it('recusa formato desconhecido em vez de medir errado', () => {
    const body = new Uint8Array(40); body.set([82, 80, 89, 67, 1, 2, 0, 8, 1, 0, 1, 0])
    expect(() => parseYcc(body.buffer)).toThrow(/BT.709/)
  })
})
