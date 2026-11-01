/**
 * Último recurso: a acumulação do crate transcrita em TypeScript, para quando
 * nem GPU nem o WASM estão disponíveis (ex.: o `.wasm` não carregou). Usa
 * `Math.fround` para repetir a aritmética `f32` do Rust; o teste
 * `cpu-js.test.ts` cobra o mesmo resultado do WASM no caminho RGBA.
 */
import {CH_ALL, DIAMOND_EXTENT, MATRIX, sanitize, type MatrixCode, type ScopeConfig, type ScopeResult, type ScopeStats} from './wasm.js'

const f = Math.fround

export function accumulateRgbaJs(rgba: ArrayLike<number>, width: number, height: number, requested: ScopeConfig, matrix: MatrixCode = MATRIX.bt709): ScopeResult {
  const c = sanitize(requested)
  const [krRaw, kbRaw] = matrix === MATRIX.bt2020 ? [0.2627, 0.0593] : [0.2126, 0.0722]
  const kr = f(krRaw), kb = f(kbRaw), kg = f(f(f(1) - kr) - kb)
  const crToR = f(2 * f(1 - kr)), cbToB = f(2 * f(1 - kb))
  const plane = c.waveColumns * c.waveRows
  const wave = new Uint32Array(plane * 6), vector = new Uint32Array(c.vectorSize ** 2), hist = new Uint32Array(c.histBins * 6), diamond = new Uint32Array(c.diamondSize ** 2 * 2)
  const x0 = Math.min(width - 1, Math.floor(f(f(c.roi[0]) * width))), y0 = Math.min(height - 1, Math.floor(f(f(c.roi[1]) * height)))
  const x1 = Math.max(x0 + 1, Math.min(width, Math.ceil(f(f(c.roi[2]) * width)))), y1 = Math.max(y0 + 1, Math.min(height, Math.ceil(f(f(c.roi[3]) * height))))
  const lmin = f(c.levelMin), lmax = f(c.levelMax)
  const rowScale = f((c.waveRows - 1) / f(lmax - lmin))
  const half = f((c.vectorSize - 1) * 0.5), radius = f(half / f(c.vectorScale))
  const last = c.diamondSize - 1, span = f(2 * DIAMOND_EXTENT)
  let count = 0, lumaMin = Infinity, lumaMax = -Infinity, lumaSum = 0, below = 0, above = 0, r103 = 0, rgbMin = Infinity, rgbMax = -Infinity, gamut = 0, strict = 0, chromaMax = 0, chromaIllegal = 0
  const levels = new Float32Array(6)
  // Mesmas constantes f32 do crate: 100 + LEVEL_EPSILON e 0,5 + CHROMA_EPSILON somados em f32.
  const eps = f(0.05), whiteLimit = f(f(100) + eps), chromaLimit = f(f(0.5) + f(0.0005))
  for (let row = y0; row < y1; row++) {
    for (let x = x0; x < x1; x++) {
      const i = (row * width + x) * 4
      const r = f(rgba[i]! / 255), g = f(rgba[i + 1]! / 255), b = f(rgba[i + 2]! / 255)
      const y = f(f(f(kr * r) + f(kg * g)) + f(kb * b))
      const cb = f(f(b - y) / cbToB), cr = f(f(r - y) / crToR)
      const column = Math.floor((x - x0) * c.waveColumns / (x1 - x0))
      levels[0] = f(y * 100); levels[1] = f(f(cb + 0.5) * 100); levels[2] = f(f(cr + 0.5) * 100)
      levels[3] = f(r * 100); levels[4] = f(g * 100); levels[5] = f(b * 100)
      for (let ch = 0; ch < 6; ch++) {
        if (!(c.channels & (1 << ch))) continue
        const level = levels[ch]!
        const waveRow = Math.min(c.waveRows - 1, Math.max(0, Math.floor(f(f(f(lmax - level) * rowScale) + 0.5))))
        wave[ch * plane + waveRow * c.waveColumns + column]!++
        const bin = Math.min(c.histBins - 1, Math.max(0, Math.floor(f(f(f(level - lmin) / f(lmax - lmin)) * c.histBins))))
        hist[ch * c.histBins + bin]!++
      }
      const vx = Math.floor(f(f(half + f(f(cb * 2) * radius)) + 0.5)), vy = Math.floor(f(f(half - f(f(cr * 2) * radius)) + 0.5))
      if (vx >= 0 && vy >= 0 && vx < c.vectorSize && vy < c.vectorSize) vector[vy * c.vectorSize + vx]!++
      const col = (d: number) => Math.min(last, Math.max(0, Math.floor(f(f(f(f(d + DIAMOND_EXTENT) / span) * last) + 0.5))))
      const upperRow = Math.min(last, Math.max(0, Math.floor(f(f(f(f(span - f(b + g)) / span) * last) + 0.5))))
      const lowerRow = c.diamondSize + Math.min(last, Math.max(0, Math.floor(f(f(f(f(r + g) / span) * last) + 0.5))))
      diamond[upperRow * c.diamondSize + col(f(b - g))]!++
      diamond[lowerRow * c.diamondSize + col(f(r - g))]!++
      const luma = f(y * 100)
      count++
      if (luma < lumaMin) lumaMin = luma
      if (luma > lumaMax) lumaMax = luma
      lumaSum += luma
      if (luma < -eps) below++
      if (luma > whiteLimit) above++
      if (luma < -1 || luma > 103) r103++
      const lo = f(Math.min(r, g, b) * 100), hi = f(Math.max(r, g, b) * 100)
      if (lo < rgbMin) rgbMin = lo
      if (hi > rgbMax) rgbMax = hi
      if (lo < -5 || hi > 105) gamut++
      if (lo < -eps || hi > whiteLimit) strict++
      const magnitude = f(f(Math.sqrt(f(f(cb * cb) + f(cr * cr)))) * 2)
      if (magnitude > chromaMax) chromaMax = magnitude
      if (Math.abs(cb) > chromaLimit || Math.abs(cr) > chromaLimit) chromaIllegal++
    }
  }
  const finite = (v: number) => Number.isFinite(v) ? v : 0
  const stats: ScopeStats = {
    count, lumaMin: finite(lumaMin), lumaMax: finite(lumaMax), lumaAvg: count ? lumaSum / count : 0, belowBlack: below, aboveWhite: above, lumaR103: r103,
    rgbMin: finite(rgbMin), rgbMax: finite(rgbMax), gamutR103: gamut, gamutStrict: strict, chromaMax, chromaIllegal,
    lumaIllegal: count > 0 && (lumaMin < -1 || lumaMax > 103), gamutIllegal: count > 0 && gamut / count > 0.01, chromaIllegalAny: chromaIllegal > 0,
  }
  return {config: {...c, channels: c.channels & CH_ALL}, wave, vector, hist, diamond, stats, frameWidth: width, frameHeight: height}
}
