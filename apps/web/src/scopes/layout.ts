/**
 * Geometria dos scopes: onde cada painel fica no canvas e como um valor
 * (nível, Cb/Cr, R'G'B') vira pixel -- e o caminho inverso, para a leitura
 * por cursor.
 *
 * As fórmulas espelham as células do crate (`level_row`, `vector_cell`,
 * `diamond_cells`): o centro de uma célula `i` de `n` células ocupa
 * `(i + 0,5)/n` do painel. Assim o gratículo cai exatamente sobre a densidade,
 * em qualquer backend (WebGPU, WebGL2, WASM ou JS).
 */
import {DIAMOND_EXTENT, SCOPE_CHANNELS, type ScopeChannel, type ScopeConfig} from './wasm.js'

export type ScopeMode = 'COMBO' | 'WAVE' | 'PARADE' | 'VECTOR' | 'HIST' | 'DIAMOND' | 'QUAD'
export const SCOPE_MODES: ReadonlyArray<{mode: ScopeMode; label: string; title: string}> = [
  {mode: 'COMBO', label: 'WFM+VEC', title: 'Waveform, vectorscope e parade'},
  {mode: 'QUAD', label: '4×', title: 'Waveform, vectorscope, histograma e diamante'},
  {mode: 'WAVE', label: 'WFM', title: 'Waveform do canal escolhido'},
  {mode: 'PARADE', label: 'PARADE', title: 'Parade R\'G\'B\' ou Y\'CbCr'},
  {mode: 'VECTOR', label: 'VEC', title: 'Vectorscope'},
  {mode: 'HIST', label: 'HIST', title: 'Histograma'},
  {mode: 'DIAMOND', label: 'DIAM', title: 'Diamante de gamut (Tektronix)'},
]

export type LevelUnit = '%' | 'mV' | 'IRE'
export type ParadeKind = 'RGB' | 'YCbCr'

export interface Rect {x: number; y: number; w: number; h: number}
export type PanelKind = 'wave' | 'vector' | 'hist' | 'diamond'

export interface Panel {
  kind: PanelKind
  /** Canal do waveform (painéis `wave`). */
  channel?: ScopeChannel
  /** Faixa com rótulos (o parade desenha a escala só uma vez). */
  frame: Rect
  /** Área da densidade. */
  plot: Rect
  /** Painéis do mesmo parade compartilham `group` e só o primeiro tem escala. */
  group?: string
  firstInGroup?: boolean
  title: string
}

export interface LayoutOptions {
  waveChannel: ScopeChannel
  parade: ParadeKind
  scale: number
}

const inset = (r: Rect, left: number, top: number, right: number, bottom: number): Rect =>
  ({x: r.x + left, y: r.y + top, w: Math.max(8, r.w - left - right), h: Math.max(8, r.h - top - bottom)})

function wavePanels(frame: Rect, channels: ScopeChannel[], scale: number, title: string, group?: string): Panel[] {
  const plot = inset(frame, Math.round(40 * scale), Math.round(6 * scale), Math.round(6 * scale), Math.round(6 * scale))
  const gap = channels.length > 1 ? Math.round(3 * scale) : 0
  const width = (plot.w - gap * (channels.length - 1)) / channels.length
  return channels.map((channel, index) => ({
    kind: 'wave' as const, channel, frame, group, firstInGroup: index === 0, title,
    plot: {x: Math.round(plot.x + index * (width + gap)), y: plot.y, w: Math.max(4, Math.floor(width)), h: plot.h},
  }))
}

function squarePanel(kind: 'vector', frame: Rect, scale: number, title: string): Panel {
  const pad = Math.round(14 * scale)
  const side = Math.max(16, Math.floor(Math.min(frame.w, frame.h) - 2 * pad))
  return {kind, frame, title, plot: {x: Math.round(frame.x + (frame.w - side) / 2), y: Math.round(frame.y + (frame.h - side) / 2), w: side, h: side}}
}

function diamondPanel(frame: Rect, scale: number): Panel {
  const pad = Math.round(12 * scale)
  const width = Math.max(16, Math.floor(Math.min(frame.w - 2 * pad, (frame.h - 2 * pad) / 2)))
  return {kind: 'diamond', frame, title: 'DIAMANTE', plot: {x: Math.round(frame.x + (frame.w - width) / 2), y: Math.round(frame.y + (frame.h - 2 * width) / 2), w: width, h: width * 2}}
}

function histPanel(frame: Rect, scale: number): Panel {
  return {kind: 'hist', frame, title: 'HISTOGRAMA', plot: inset(frame, Math.round(40 * scale), Math.round(6 * scale), Math.round(6 * scale), Math.round(16 * scale))}
}

export function paradeChannels(kind: ParadeKind): ScopeChannel[] {
  return kind === 'RGB' ? ['R', 'G', 'B'] : ['Y', 'Cb', 'Cr']
}

/** Painéis de um modo num canvas `width`×`height` (pixels do dispositivo). */
export function scopeLayout(mode: ScopeMode, width: number, height: number, options: LayoutOptions): Panel[] {
  const s = options.scale, gap = Math.round(4 * s)
  const all: Rect = {x: 0, y: 0, w: width, h: height}
  const parade = (frame: Rect) => wavePanels(frame, paradeChannels(options.parade), s, `PARADE ${options.parade === 'RGB' ? "R'G'B'" : "Y'CbCr"}`, 'parade')
  const wave = (frame: Rect) => wavePanels(frame, [options.waveChannel], s, `WAVEFORM ${options.waveChannel}'`)
  switch (mode) {
    case 'WAVE': return wave(all)
    case 'PARADE': return parade(all)
    case 'VECTOR': return [squarePanel('vector', all, s, 'VECTORSCOPE')]
    case 'HIST': return [histPanel(all, s)]
    case 'DIAMOND': return [diamondPanel(all, s)]
    case 'QUAD': {
      const w = Math.floor((width - gap) / 2), h = Math.floor((height - gap) / 2)
      return [
        ...wave({x: 0, y: 0, w, h}),
        squarePanel('vector', {x: w + gap, y: 0, w: width - w - gap, h}, s, 'VECTORSCOPE'),
        histPanel({x: 0, y: h + gap, w, h: height - h - gap}, s),
        diamondPanel({x: w + gap, y: h + gap, w: width - w - gap, h: height - h - gap}, s),
      ]
    }
    case 'COMBO':
    default: {
      const top = Math.floor((height - gap) * 0.54)
      const bottom = height - top - gap
      const left = Math.min(bottom + Math.round(28 * s), Math.floor(width * 0.42))
      return [
        ...wave({x: 0, y: 0, w: width, h: top}),
        squarePanel('vector', {x: 0, y: top + gap, w: left, h: bottom}, s, 'VECTORSCOPE'),
        ...parade({x: left + gap, y: top + gap, w: width - left - gap, h: bottom}),
      ]
    }
  }
}

/** Canais que o modo precisa acumular (máscara de bits do crate). */
export function channelMask(panels: Panel[]): number {
  let mask = 1 // Y sempre: o histograma e as medições usam.
  for (const panel of panels) if (panel.channel) mask |= 1 << SCOPE_CHANNELS.indexOf(panel.channel)
  if (panels.some(panel => panel.kind === 'hist')) mask |= 8 | 16 | 32
  return mask
}

/**
 * Resolução de acumulação para estes painéis: uma coluna/linha por pixel do
 * maior painel, nunca mais colunas do que a ROI tem de pixels (senão sobram
 * colunas vazias) e com tetos que mantêm o buffer pequeno.
 */
export function accumulationConfig(panels: Panel[], base: Pick<ScopeConfig, 'levelMin' | 'levelMax' | 'vectorScale' | 'roi'>, sourceWidth: number): ScopeConfig {
  const waves = panels.filter(p => p.kind === 'wave')
  const roiWidth = Math.max(16, Math.floor(sourceWidth * (base.roi[2] - base.roi[0])))
  const columns = Math.max(16, Math.min(1024, roiWidth, Math.max(16, ...waves.map(p => Math.round(p.plot.w)))))
  const rows = Math.max(64, Math.min(1024, Math.max(64, ...waves.map(p => Math.round(p.plot.h)))))
  const vector = panels.find(p => p.kind === 'vector'), diamond = panels.find(p => p.kind === 'diamond')
  return {
    waveColumns: columns, waveRows: rows, channels: channelMask(panels), levelMin: base.levelMin, levelMax: base.levelMax,
    vectorSize: Math.max(64, Math.min(512, Math.round(vector?.plot.w ?? 256))), vectorScale: base.vectorScale,
    histBins: 256, diamondSize: Math.max(64, Math.min(512, Math.round(diamond?.plot.w ?? 128))), roi: base.roi,
  }
}

// --- Mapeamentos valor ↔ pixel (iguais às células do crate) ----------------

/** Y do pixel para um nível em %, alinhado ao centro da linha do crate. */
export function levelToY(percent: number, plot: Rect, config: Pick<ScopeConfig, 'levelMin' | 'levelMax' | 'waveRows'>): number {
  const {levelMin: min, levelMax: max, waveRows: rows} = config
  const row = (max - percent) * (rows - 1) / (max - min)
  return plot.y + (row + 0.5) / rows * plot.h
}

export function yToLevel(y: number, plot: Rect, config: Pick<ScopeConfig, 'levelMin' | 'levelMax' | 'waveRows'>): number {
  const {levelMin: min, levelMax: max, waveRows: rows} = config
  const row = (y - plot.y) / plot.h * rows - 0.5
  return max - row * (max - min) / (rows - 1)
}

/** Centro do vectorscope e raio (em pixels) da magnitude 1 (|C| = 0,5). */
export function vectorGeometry(plot: Rect, config: Pick<ScopeConfig, 'vectorSize' | 'vectorScale'>): {cx: number; cy: number; radius: number} {
  const size = config.vectorSize, half = (size - 1) / 2
  const cell = plot.w / size
  return {cx: plot.x + (half + 0.5) * cell, cy: plot.y + (half + 0.5) * cell, radius: half / config.vectorScale * cell}
}

export function vectorToXY(cb: number, cr: number, plot: Rect, config: Pick<ScopeConfig, 'vectorSize' | 'vectorScale'>): {x: number; y: number} {
  const {cx, cy, radius} = vectorGeometry(plot, config)
  return {x: cx + cb * 2 * radius, y: cy - cr * 2 * radius}
}

export function xyToVector(x: number, y: number, plot: Rect, config: Pick<ScopeConfig, 'vectorSize' | 'vectorScale'>): {cb: number; cr: number} {
  const {cx, cy, radius} = vectorGeometry(plot, config)
  return {cb: (x - cx) / (2 * radius), cr: -(y - cy) / (2 * radius)}
}

/** Diamante: ponto do pixel para (diferença, soma) na metade de cima ou de baixo. */
export function diamondToXY(difference: number, sum: number, upper: boolean, plot: Rect, size: number): {x: number; y: number} {
  const last = size - 1, span = 2 * DIAMOND_EXTENT, cell = plot.w / size
  const col = (difference + DIAMOND_EXTENT) / span * last
  const row = upper ? (span - sum) / span * last : size + sum / span * last
  return {x: plot.x + (col + 0.5) * cell, y: plot.y + (row + 0.5) * cell}
}

export function xyToDiamond(x: number, y: number, plot: Rect, size: number): {upper: boolean; difference: number; sum: number} {
  const last = size - 1, span = 2 * DIAMOND_EXTENT, cell = plot.w / size
  const col = (x - plot.x) / cell - 0.5, row = (y - plot.y) / cell - 0.5
  const difference = col / last * span - DIAMOND_EXTENT
  const upper = row < size - 0.5
  const sum = upper ? span - row / last * span : (row - size) / last * span
  return {upper, difference, sum}
}

/** X do pixel para um nível no histograma (faixa = a do waveform). */
export function histLevelToX(percent: number, plot: Rect, config: Pick<ScopeConfig, 'levelMin' | 'levelMax'>): number {
  return plot.x + (percent - config.levelMin) / (config.levelMax - config.levelMin) * plot.w
}

export function hitPanel(panels: Panel[], x: number, y: number): Panel | null {
  return panels.find(p => x >= p.plot.x && x < p.plot.x + p.plot.w && y >= p.plot.y && y < p.plot.y + p.plot.h) ?? null
}

// --- Unidades -----------------------------------------------------------------

/** Nível em % (0 = preto, 100 = branco) na unidade pedida. Cb/Cr: 50% é o zero. */
export function formatLevel(percent: number, unit: LevelUnit, channel: ScopeChannel = 'Y'): string {
  const chroma = channel === 'Cb' || channel === 'Cr'
  const value = chroma ? percent - 50 : percent
  if (unit === 'mV') return `${Math.round(value * 7)} mV`
  const text = value.toFixed(1).replace('.', ',')
  return unit === 'IRE' && !chroma ? `${text} IRE` : `${text}%`
}

/** Marcas da escala vertical: valor em % e rótulo. */
export function levelTicks(config: Pick<ScopeConfig, 'levelMin' | 'levelMax'>, unit: LevelUnit, channel: ScopeChannel = 'Y'): Array<{percent: number; label: string; strong: boolean}> {
  const chroma = channel === 'Cb' || channel === 'Cr'
  const span = config.levelMax - config.levelMin
  const step = span > 60 ? 10 : span > 25 ? 5 : span > 10 ? 2 : 1
  const ticks: Array<{percent: number; label: string; strong: boolean}> = []
  const start = Math.ceil(config.levelMin / step) * step
  for (let percent = start; percent <= config.levelMax + 1e-9; percent += step) {
    const value = chroma ? percent - 50 : percent
    if (!chroma && (percent < 0 || percent > 100) && percent % 10 !== 0 && step >= 10) continue
    const label = unit === 'mV' ? String(Math.round(value * 7)) : String(Math.round(value * 10) / 10).replace('.', ',')
    ticks.push({percent, label, strong: chroma ? value === 0 || Math.abs(value) === 50 : percent === 0 || percent === 100})
  }
  return ticks
}
