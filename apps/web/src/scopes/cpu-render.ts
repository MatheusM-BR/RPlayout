/**
 * Desenho das densidades na CPU (quadro exato do WASM e fallback sem GPU).
 *
 * A regra de brilho e as cores são as mesmas dos shaders (webgpu.ts e
 * webgl2.ts): `displayGain`, `intensity`, `LEVEL_TINT` e `histHeight`. Quem
 * olha um scope não deve perceber em qual backend ele foi desenhado.
 */
import {SCOPE_CHANNELS, type ScopeChannel, type ScopeResult} from './wasm.js'
import type {Panel} from './layout.js'

/** Cor base (0..1) de cada canal no waveform/histograma. */
export const DENSITY_COLOR: Record<ScopeChannel, [number, number, number]> = {
  Y: [0.55, 1, 0.68], Cb: [0.5, 0.7, 1], Cr: [1, 0.5, 0.56], R: [1, 0.38, 0.38], G: [0.38, 1, 0.52], B: [0.45, 0.65, 1],
}
export const VECTOR_COLOR: [number, number, number] = [0.55, 1, 0.68]
export const DIAMOND_COLOR: [number, number, number] = [0.55, 1, 0.68]
/** Referência congelada: âmbar, para comparar com o quadro corrente. */
export const REFERENCE_COLOR: [number, number, number] = [1, 0.66, 0.1]

/** Fração típica de células acesas: normaliza o brilho pelo número de amostras. */
const OCCUPANCY = {wave: 0.3, vector: 0.05, diamond: 0.05} as const

/** Ganho de exibição: `intensity` do usuário × células por amostra × ocupação típica. */
export function displayGain(kind: keyof typeof OCCUPANCY, cells: number, samples: number, userIntensity: number): number {
  return userIntensity * OCCUPANCY[kind] * cells / Math.max(1, samples)
}

/** Brilho de uma célula: qualquer amostra aparece (defeito de 1 pixel), cheio satura. */
export function intensity(count: number, gain: number): number {
  return count > 0 ? Math.min(1, 0.25 + 0.75 * (1 - Math.exp(-count * gain))) : 0
}

/** Altura (0..1) de uma barra do histograma em escala log, relativa ao total. */
export function histHeight(count: number, samples: number): number {
  return count > 0 ? Math.log2(1 + count) / Math.log2(1 + Math.max(1, samples)) : 0
}

/**
 * Tinta por nível: fora do limite R103 vermelho, entre nominal e R103 âmbar.
 * Limites por canal (Y −1..103, R'G'B' −5..105, Cb/Cr 0..100 = ±0,5).
 */
export function levelTint(channel: ScopeChannel, percent: number, base: [number, number, number]): [number, number, number] {
  const [low, high] = channel === 'Y' ? [-1, 103] : channel === 'Cb' || channel === 'Cr' ? [-0.05, 100.05] : [-5, 105]
  if (percent < low || percent > high) return [1, 0.27, 0.23]
  if (channel !== 'Cb' && channel !== 'Cr' && (percent < -0.05 || percent > 100.05)) return [1, 0.75, 0.24]
  return base
}

export interface DensityOptions {
  /** Ganho do usuário (1 = padrão). */
  intensity: number
  /** Amostras acumuladas (para normalizar o brilho e o histograma). */
  samples: number
  reference?: ScopeResult | null
  referenceSamples?: number
}

/** Soma das células cobertas por um pixel de saída (eixo de `n` células em `size` pixels). */
function span(pixel: number, size: number, cells: number): [number, number] {
  const start = Math.floor(pixel * cells / size)
  return [start, Math.max(start + 1, Math.floor((pixel + 1) * cells / size))]
}

function add(image: ImageData, x: number, y: number, color: [number, number, number], alpha: number) {
  if (alpha <= 0 || x < 0 || y < 0 || x >= image.width || y >= image.height) return
  const i = (y * image.width + x) * 4, d = image.data
  d[i] = Math.min(255, d[i]! + color[0] * alpha * 255)
  d[i + 1] = Math.min(255, d[i + 1]! + color[1] * alpha * 255)
  d[i + 2] = Math.min(255, d[i + 2]! + color[2] * alpha * 255)
  d[i + 3] = 255
}

type Grid = {data: Uint32Array; offset: number; columns: number; rows: number}

function paintGrid(image: ImageData, panel: Panel, grid: Grid, gain: number, color: (row: number) => [number, number, number]) {
  const {plot} = panel
  const w = Math.round(plot.w), h = Math.round(plot.h), x0 = Math.round(plot.x), y0 = Math.round(plot.y)
  for (let py = 0; py < h; py++) {
    const [r0, r1] = span(py, h, grid.rows)
    for (let px = 0; px < w; px++) {
      const [c0, c1] = span(px, w, grid.columns)
      let sum = 0
      for (let r = r0; r < r1 && r < grid.rows; r++) for (let c = c0; c < c1 && c < grid.columns; c++) sum += grid.data[grid.offset + r * grid.columns + c]!
      if (!sum) continue
      const n = (r1 - r0) * (c1 - c0)
      add(image, x0 + px, y0 + py, color(Math.min(grid.rows - 1, Math.floor((r0 + r1 - 1) / 2))), intensity(sum / n, gain))
    }
  }
}

function paintResult(image: ImageData, panels: Panel[], result: ScopeResult, samples: number, userIntensity: number, reference: boolean) {
  const c = result.config
  const plane = c.waveColumns * c.waveRows
  for (const panel of panels) {
    if (panel.kind === 'wave') {
      const channel = panel.channel ?? 'Y', index = SCOPE_CHANNELS.indexOf(channel)
      const gain = displayGain('wave', plane, samples, userIntensity)
      const base = reference ? REFERENCE_COLOR : DENSITY_COLOR[channel]
      paintGrid(image, panel, {data: result.wave, offset: index * plane, columns: c.waveColumns, rows: c.waveRows}, gain,
        row => reference ? base : levelTint(channel, c.levelMax - row * (c.levelMax - c.levelMin) / (c.waveRows - 1), base))
    } else if (panel.kind === 'vector') {
      const gain = displayGain('vector', c.vectorSize * c.vectorSize, samples, userIntensity)
      paintGrid(image, panel, {data: result.vector, offset: 0, columns: c.vectorSize, rows: c.vectorSize}, gain, () => reference ? REFERENCE_COLOR : VECTOR_COLOR)
    } else if (panel.kind === 'diamond') {
      const gain = displayGain('diamond', c.diamondSize * c.diamondSize, samples, userIntensity)
      paintGrid(image, panel, {data: result.diamond, offset: 0, columns: c.diamondSize, rows: c.diamondSize * 2}, gain, () => reference ? REFERENCE_COLOR : DIAMOND_COLOR)
    } else {
      const {plot} = panel, w = Math.round(plot.w), h = Math.round(plot.h), x0 = Math.round(plot.x), y0 = Math.round(plot.y)
      const channels: ScopeChannel[] = ['R', 'G', 'B', 'Y']
      for (const channel of channels) {
        const offset = SCOPE_CHANNELS.indexOf(channel) * c.histBins
        const color = reference ? REFERENCE_COLOR : DENSITY_COLOR[channel]
        const alpha = reference ? 0.5 : channel === 'Y' ? 0.55 : 0.35
        for (let px = 0; px < w; px++) {
          const [b0, b1] = span(px, w, c.histBins)
          let sum = 0
          for (let b = b0; b < b1 && b < c.histBins; b++) sum += result.hist[offset + b]!
          const top = Math.round(h * (1 - histHeight(sum / (b1 - b0), samples)))
          for (let py = top; py < h; py++) add(image, x0 + px, y0 + py, color, py === top ? 1 : alpha)
        }
      }
    }
  }
}

/** Pinta as densidades (e a referência, se houver) num canvas 2D inteiro. */
export function paintDensities(ctx: CanvasRenderingContext2D, width: number, height: number, panels: Panel[], result: ScopeResult | null, options: DensityOptions) {
  const image = ctx.createImageData(width, height)
  if (options.reference) paintResult(image, panels, options.reference, options.referenceSamples ?? options.reference.stats.count, options.intensity * 0.8, true)
  if (result) paintResult(image, panels, result, options.samples, options.intensity, false)
  ctx.putImageData(image, 0, 0)
}
