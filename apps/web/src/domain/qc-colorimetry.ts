/**
 * Matemática dos scopes do QC (ITU-R BT.709, SMPTE RP 219, EBU R103).
 *
 * Convenções -- todas normalizadas, independentes do tamanho do canvas:
 *  - Y' em fração da excursão nominal: 0 = preto (código 16), 1 = branco
 *    (código 235). Valores fora de 0..1 existem e são o motivo de o scope
 *    existir: código 0 → −7,31% e código 255 → +109,13%.
 *  - Cb/Cr em −0,5..+0,5 (códigos 16..240 com 128 no centro).
 *  - Vectorscope: magnitude 1 = |Cb,Cr| de 0,5 (a excursão máxima de um eixo);
 *    ângulo medido a partir de +Cb, anti-horário (Cr para cima).
 *
 * Nada aqui decora ângulos: alvos e posições saem da matriz BT.709.
 */

export const BT709 = {kr: 0.2126, kb: 0.0722, kg: 1 - 0.2126 - 0.0722} as const

/** Amostras para os scopes. `y`, `cb`, `cr` normalizados como acima. */
export interface QcScopeSample {
  width: number
  height: number
  y: Float32Array
  cb: Float32Array
  cr: Float32Array
  /**
   * `ycbcr-original`: códigos Y'CbCr do original, sem conversão (exato, vê
   * sub-black/super-white). `rgb-browser`: RGB que o navegador decodificou
   * para exibir -- já recortado em 0..255, então níveis ilegais NÃO aparecem.
   */
  source: 'ycbcr-original' | 'rgb-browser'
}

export interface Ycbcr {y: number; cb: number; cr: number}
export interface Rgb {r: number; g: number; b: number}

/** R'G'B' normalizado (0..1 legal) → Y'CbCr normalizado, matriz BT.709. */
export function ycbcrFromRgb({r, g, b}: Rgb): Ycbcr {
  const y = BT709.kr * r + BT709.kg * g + BT709.kb * b
  return {y, cb: (b - y) / (2 * (1 - BT709.kb)), cr: (r - y) / (2 * (1 - BT709.kr))}
}

/** Y'CbCr normalizado → R'G'B' normalizado, sem recortar (gamut RGB real). */
export function rgbFromYcbcr({y, cb, cr}: Ycbcr): Rgb {
  const r = y + 2 * (1 - BT709.kr) * cr
  const b = y + 2 * (1 - BT709.kb) * cb
  return {r, g: (y - BT709.kr * r - BT709.kb * b) / BT709.kg, b}
}

/** Códigos de 8 bits em faixa limitada (Y 16–235, C 16–240) → normalizado. */
export function ycbcrFromCodes(y: number, cb: number, cr: number): Ycbcr {
  return {y: (y - 16) / 219, cb: (cb - 128) / 224, cr: (cr - 128) / 224}
}

/** Normalizado → códigos de 8 bits em faixa limitada, como um codificador. */
export function codesFromYcbcr({y, cb, cr}: Ycbcr): [number, number, number] {
  const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)))
  return [clamp(16 + 219 * y), clamp(128 + 224 * cb), clamp(128 + 224 * cr)]
}

/** Nível em % da excursão nominal (0% = preto, 100% = branco, SMPTE RP 219). */
export const levelPercent = (normalized: number): number => normalized * 100
/** 0% = 0 mV, 100% = 700 mV (SMPTE RP 219 / ST 274 analógico equivalente). */
export const percentToMillivolts = (percent: number): number => percent * 7

/** Faixa vertical do waveform/parade: inclui −7,3% (código 0) e 109,1% (255). */
export const WAVEFORM_RANGE = {min: -8, max: 110} as const

/** EBU R103: luma −1%..103%; R'G'B' −5%..105% com até 1% da área tolerada. */
export const EBU_R103 = {lumaMin: -1, lumaMax: 103, rgbMin: -5, rgbMax: 105, areaTolerance: 0.01} as const

export type BarName = 'Yl' | 'Cy' | 'G' | 'Mg' | 'R' | 'B'
const BAR_RGB: Record<BarName, Rgb> = {
  Yl: {r: 1, g: 1, b: 0}, Cy: {r: 0, g: 1, b: 1}, G: {r: 0, g: 1, b: 0},
  Mg: {r: 1, g: 0, b: 1}, R: {r: 1, g: 0, b: 0}, B: {r: 0, g: 0, b: 1},
}
export const BAR_ORDER: readonly BarName[] = ['Yl', 'Cy', 'G', 'Mg', 'R', 'B']

export interface VectorPolar {angleDeg: number; magnitude: number}
/** Posição polar de um par Cb/Cr: ângulo a partir de +Cb, magnitude 1 = 0,5. */
export function vectorPolar(cb: number, cr: number): VectorPolar {
  const angle = Math.atan2(cr, cb) * 180 / Math.PI
  return {angleDeg: (angle + 360) % 360, magnitude: Math.hypot(cb, cr) / 0.5}
}

export interface VectorTarget extends VectorPolar {name: BarName; level: number; cb: number; cr: number}
/** Alvo de cada barra primária/secundária no nível pedido (0,75 ou 1,0). */
export function vectorTargets(level: number): VectorTarget[] {
  return BAR_ORDER.map(name => {
    const rgb = BAR_RGB[name]
    const {cb, cr} = ycbcrFromRgb({r: rgb.r * level, g: rgb.g * level, b: rgb.b * level})
    return {name, level, cb, cr, ...vectorPolar(cb, cr)}
  })
}

/** Caixas de tolerância desenhadas em volta dos alvos de 75%. */
export const TARGET_TOLERANCE = {inner: {phaseDeg: 3, gain: 0.05}, outer: {phaseDeg: 10, gain: 0.2}} as const

export function angleDifference(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180)
}
export function inTargetBox(cb: number, cr: number, target: VectorPolar, tolerance: {phaseDeg: number; gain: number} = TARGET_TOLERANCE.inner): boolean {
  const point = vectorPolar(cb, cr)
  return angleDifference(point.angleDeg, target.angleDeg) <= tolerance.phaseDeg && Math.abs(point.magnitude / target.magnitude - 1) <= tolerance.gain
}

/** Linha de tom de pele: convenção dos vectorscopes de componente (~123°). */
export const SKIN_TONE_ANGLE_DEG = 123

/** Amostras a partir de códigos Y'CbCr de 8 bits (faixa limitada), plano a plano. */
export function sampleFromCodes(width: number, height: number, y: ArrayLike<number>, cb: ArrayLike<number>, cr: ArrayLike<number>): QcScopeSample {
  const count = width * height
  const sample: QcScopeSample = {width, height, y: new Float32Array(count), cb: new Float32Array(count), cr: new Float32Array(count), source: 'ycbcr-original'}
  for (let index = 0; index < count; index++) {
    sample.y[index] = ((y[index] ?? 16) - 16) / 219
    sample.cb[index] = ((cb[index] ?? 128) - 128) / 224
    sample.cr[index] = ((cr[index] ?? 128) - 128) / 224
  }
  return sample
}

/**
 * Amostras a partir do RGBA de um canvas (vídeo decodificado pelo navegador).
 * O navegador já expandiu a faixa e recortou em 0..255: o que era sub-black ou
 * super-white chega como 0% ou 100%. Use só como aproximação.
 */
export function sampleFromRgba(rgba: ArrayLike<number>, width: number, height: number): QcScopeSample {
  const count = width * height
  const sample: QcScopeSample = {width, height, y: new Float32Array(count), cb: new Float32Array(count), cr: new Float32Array(count), source: 'rgb-browser'}
  for (let index = 0; index < count; index++) {
    const value = ycbcrFromRgb({r: (rgba[index * 4] ?? 0) / 255, g: (rgba[index * 4 + 1] ?? 0) / 255, b: (rgba[index * 4 + 2] ?? 0) / 255})
    sample.y[index] = value.y; sample.cb[index] = value.cb; sample.cr[index] = value.cr
  }
  return sample
}

/** Lê o `.ycc` do servidor: cabeçalho de 16 bytes + planos Y, Cb, Cr 4:4:4. */
export function parseYcc(buffer: ArrayBuffer): QcScopeSample {
  const bytes = new Uint8Array(buffer)
  if (bytes.length < 16 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'RPYC') throw new Error('Amostra Y\'CbCr inválida.')
  if (bytes[4] !== 1 || bytes[5] !== 1 || bytes[6] !== 0 || bytes[7] !== 8) throw new Error('Amostra Y\'CbCr em formato não suportado (esperado BT.709, faixa limitada, 8 bits).')
  const width = bytes[8]! | (bytes[9]! << 8), height = bytes[10]! | (bytes[11]! << 8), count = width * height
  if (!width || !height || bytes.length < 16 + count * 3) throw new Error('Amostra Y\'CbCr truncada.')
  return sampleFromCodes(width, height, bytes.subarray(16, 16 + count), bytes.subarray(16 + count, 16 + 2 * count), bytes.subarray(16 + 2 * count, 16 + 3 * count))
}

export interface QcScopeStats {
  source: QcScopeSample['source']
  lumaMin: number; lumaMax: number; lumaAvg: number
  /** Fração da área abaixo de 0% / acima de 100%. */
  belowBlack: number; aboveWhite: number
  /** Fora de EBU R103 (−1%..103%). Nulo quando a amostra não permite medir. */
  lumaIllegal: boolean | null
  rgbMin: number; rgbMax: number
  /** Fração da área com R', G' ou B' fora de −5%..105%. */
  gamutArea: number
  /** Mais de 1% da área fora do gamut RGB (EBU R103). Nulo sem amostra crua. */
  gamutIllegal: boolean | null
  chromaMax: number
}

/** Mede a amostra: níveis de luma e gamut R'G'B' de verdade (não |Cb,Cr|). */
export function analyzeScopeSample(sample: QcScopeSample): QcScopeStats {
  let lumaMin = Infinity, lumaMax = -Infinity, sum = 0, below = 0, above = 0, rgbMin = Infinity, rgbMax = -Infinity, outside = 0, chroma = 0
  const count = sample.width * sample.height
  for (let index = 0; index < count; index++) {
    const y = sample.y[index]!, cb = sample.cb[index]!, cr = sample.cr[index]!
    const percent = y * 100
    if (percent < lumaMin) lumaMin = percent
    if (percent > lumaMax) lumaMax = percent
    sum += percent
    if (percent < -0.05) below++
    if (percent > 100.05) above++
    const {r, g, b} = rgbFromYcbcr({y, cb, cr})
    const low = Math.min(r, g, b) * 100, high = Math.max(r, g, b) * 100
    if (low < rgbMin) rgbMin = low
    if (high > rgbMax) rgbMax = high
    if (low < EBU_R103.rgbMin || high > EBU_R103.rgbMax) outside++
    const magnitude = Math.hypot(cb, cr) / 0.5
    if (magnitude > chroma) chroma = magnitude
  }
  const raw = sample.source === 'ycbcr-original'
  const safe = (value: number) => Number.isFinite(value) ? value : 0
  return {
    source: sample.source,
    lumaMin: safe(lumaMin), lumaMax: safe(lumaMax), lumaAvg: count ? sum / count : 0,
    belowBlack: count ? below / count : 0, aboveWhite: count ? above / count : 0,
    lumaIllegal: raw ? lumaMin < EBU_R103.lumaMin || lumaMax > EBU_R103.lumaMax : null,
    rgbMin: safe(rgbMin), rgbMax: safe(rgbMax), gamutArea: count ? outside / count : 0,
    gamutIllegal: raw ? outside / Math.max(1, count) > EBU_R103.areaTolerance : null,
    chromaMax: chroma,
  }
}

/** Linha (0 = topo) de um nível em % numa grade de `rows` linhas. */
export function levelRow(percent: number, rows: number, range: {min: number; max: number} = WAVEFORM_RANGE): number {
  return Math.round((range.max - percent) / (range.max - range.min) * (rows - 1))
}

/**
 * Densidade do waveform de luma: `columns` colunas (uma por posição
 * horizontal) × `rows` linhas de nível. Cada amostra cai numa célula; nada é
 * recortado em 0..100%. Amostras fora da faixa visível vão para a borda.
 */
export function waveformDensity(sample: QcScopeSample, columns: number, rows: number, plane: 'y' | 'r' | 'g' | 'b' = 'y', range: {min: number; max: number} = WAVEFORM_RANGE): Uint32Array {
  const density = new Uint32Array(columns * rows)
  const {width, height} = sample
  const scale = (rows - 1) / (range.max - range.min)
  for (let row = 0; row < height; row++) {
    for (let x = 0; x < width; x++) {
      const index = row * width + x
      let value: number
      if (plane === 'y') value = sample.y[index]!
      else {
        const rgb = rgbFromYcbcr({y: sample.y[index]!, cb: sample.cb[index]!, cr: sample.cr[index]!})
        value = plane === 'r' ? rgb.r : plane === 'g' ? rgb.g : rgb.b
      }
      const level = Math.max(0, Math.min(rows - 1, Math.round((range.max - value * 100) * scale)))
      const column = Math.min(columns - 1, Math.floor(x * columns / width))
      density[level * columns + column]!++
    }
  }
  return density
}

/** Escala do vectorscope: magnitude máxima visível (o magenta 100% fica em 1,19). */
export const VECTOR_FULL_SCALE = 1.3

/** Densidade do vectorscope numa grade quadrada `size`×`size`. */
export function vectorDensity(sample: QcScopeSample, size: number): Uint32Array {
  const density = new Uint32Array(size * size)
  const half = (size - 1) / 2, radius = half / VECTOR_FULL_SCALE
  const count = sample.width * sample.height
  for (let index = 0; index < count; index++) {
    const {x, y} = vectorCanvasPoint(sample.cb[index]!, sample.cr[index]!, half, half, radius)
    const column = Math.round(x), row = Math.round(y)
    if (column < 0 || row < 0 || column >= size || row >= size) continue
    density[row * size + column]!++
  }
  return density
}

/** Ponto do canvas para Cb/Cr: Cb para a direita, Cr para cima. */
export function vectorCanvasPoint(cb: number, cr: number, cx: number, cy: number, radius: number): {x: number; y: number} {
  return {x: cx + cb / 0.5 * radius, y: cy - cr / 0.5 * radius}
}
