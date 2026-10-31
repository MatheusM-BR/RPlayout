/**
 * Contrato comum dos scopes ao vivo (WebGPU e WebGL2) e a lista de desenhos
 * por painel, que os dois backends consomem igual.
 */
import {DENSITY_COLOR, DIAMOND_COLOR, REFERENCE_COLOR, VECTOR_COLOR, displayGain} from './cpu-render.js'
import {SCOPE_CHANNELS, type MatrixCode, type ScopeConfig, type ScopeStats, type FalseColorMode} from './wasm.js'
import type {Panel} from './layout.js'

export type LiveSource = HTMLVideoElement | HTMLImageElement

export interface LiveView {
  panels: Panel[]
  config: ScopeConfig
  /** Tamanho do canvas de densidade (pixels do dispositivo). */
  width: number
  height: number
  intensity: number
  matrix: MatrixCode
  /** Congelado: não acumula, só redesenha o que já está nos buffers. */
  frozen: boolean
  showReference: boolean
  /** Passo de amostragem (1 = todos os pixels). */
  stride: number
}

export interface LiveTiming {
  /** Tempo de GPU por quadro (timestamp-query), quando o navegador expõe. */
  gpuMs: number | null
  /** Tempo de CPU gasto para codificar/enviar o quadro. */
  cpuMs: number
  /** Resolução efetivamente amostrada. */
  sampledWidth: number
  sampledHeight: number
}

export interface LiveScopes {
  readonly kind: 'webgpu' | 'webgl2'
  /** Acumula (se não congelado) e desenha. `false` se o quadro não estava pronto. */
  render(source: LiveSource | null, view: LiveView): boolean
  /** Copia o acumulado atual para a referência (comparação em âmbar). */
  captureReference(): void
  clearReference(): void
  hasReference(): boolean
  /** Última medição (lida de forma assíncrona e esparsa, nunca por quadro). */
  stats(): ScopeStats | null
  timing(): LiveTiming
  /** Falsa cor do mesmo quadro num canvas por cima do vídeo (ou null para desligar). */
  setFalseColor(canvas: HTMLCanvasElement | null, mode: FalseColorMode): void
  destroy(): void
}

export const KIND_CODE = {wave: 0, vector: 1, hist: 2, diamond: 3} as const

export interface DrawSpec {
  rect: [number, number, number, number]
  kind: number
  channel: number
  cols: number
  rows: number
  offset: number
  samples: number
  gain: number
  reference: boolean
  levels: [number, number]
  color: [number, number, number]
}

/** Um desenho por painel (densidade de cada scope, ou da referência). */
export function drawSpecs(panels: Panel[], config: ScopeConfig, samples: number, intensity: number, reference: boolean): DrawSpec[] {
  const plane = config.waveColumns * config.waveRows
  return panels.map(panel => {
    const rect: [number, number, number, number] = [Math.round(panel.plot.x), Math.round(panel.plot.y), Math.max(1, Math.round(panel.plot.w)), Math.max(1, Math.round(panel.plot.h))]
    const base = {rect, samples, reference, levels: [config.levelMin, config.levelMax] as [number, number]}
    const userIntensity = reference ? intensity * 0.8 : intensity
    if (panel.kind === 'wave') {
      const channel = SCOPE_CHANNELS.indexOf(panel.channel ?? 'Y')
      return {...base, kind: KIND_CODE.wave, channel, cols: config.waveColumns, rows: config.waveRows, offset: channel * plane,
        gain: displayGain('wave', plane, samples, userIntensity), color: reference ? REFERENCE_COLOR : DENSITY_COLOR[panel.channel ?? 'Y']}
    }
    if (panel.kind === 'vector') return {...base, kind: KIND_CODE.vector, channel: 0, cols: config.vectorSize, rows: config.vectorSize, offset: 0,
      gain: displayGain('vector', config.vectorSize ** 2, samples, userIntensity), color: reference ? REFERENCE_COLOR : VECTOR_COLOR}
    if (panel.kind === 'diamond') return {...base, kind: KIND_CODE.diamond, channel: 0, cols: config.diamondSize, rows: config.diamondSize * 2, offset: 0,
      gain: displayGain('diamond', config.diamondSize ** 2, samples, userIntensity), color: reference ? REFERENCE_COLOR : DIAMOND_COLOR}
    return {...base, kind: KIND_CODE.hist, channel: 0, cols: config.histBins, rows: 1, offset: 0, gain: 0, color: REFERENCE_COLOR}
  })
}

/** Pixels da ROI e quantos serão amostrados com o passo dado. */
export function sampledArea(config: ScopeConfig, width: number, height: number, stride: number): {roi: [number, number, number, number]; columns: number; rows: number; samples: number} {
  const x0 = Math.min(width - 1, Math.floor(config.roi[0] * width)), y0 = Math.min(height - 1, Math.floor(config.roi[1] * height))
  const x1 = Math.max(x0 + 1, Math.min(width, Math.ceil(config.roi[2] * width))), y1 = Math.max(y0 + 1, Math.min(height, Math.ceil(config.roi[3] * height)))
  const columns = Math.ceil((x1 - x0) / stride), rows = Math.ceil((y1 - y0) / stride)
  return {roi: [x0, y0, x1, y1], columns, rows, samples: columns * rows}
}

/** Estatísticas do layout de 16 u32 da GPU (chaves ordenáveis de f32). */
export function statsFromGpu(words: Uint32Array): ScopeStats {
  const fromKey = (key: number) => {
    const bits = (key & 0x80000000) ? (key & 0x7fffffff) : (~key >>> 0)
    const view = new DataView(new ArrayBuffer(4)); view.setUint32(0, bits >>> 0, true)
    return view.getFloat32(0, true)
  }
  const count = words[0]!
  const finite = (v: number) => Number.isFinite(v) ? v : 0
  const lumaMin = count ? finite(fromKey(words[1]!)) : 0, lumaMax = count ? finite(fromKey(words[2]!)) : 0
  const gamutR103 = words[8]!, chromaIllegal = words[11]!
  return {
    count, lumaMin, lumaMax, lumaAvg: count ? words[3]! / count / 8 - 8 : 0,
    belowBlack: words[4]!, aboveWhite: words[5]!, lumaR103: words[12]!,
    rgbMin: count ? finite(fromKey(words[6]!)) : 0, rgbMax: count ? finite(fromKey(words[7]!)) : 0,
    gamutR103, gamutStrict: words[9]!, chromaMax: count ? finite(fromKey(words[10]!)) : 0, chromaIllegal,
    lumaIllegal: count > 0 && (lumaMin < -1 || lumaMax > 103), gamutIllegal: count > 0 && gamutR103 / count > 0.01, chromaIllegalAny: chromaIllegal > 0,
  }
}
