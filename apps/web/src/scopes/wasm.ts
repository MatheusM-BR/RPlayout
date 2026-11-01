/**
 * Carregador do `rplayout_scopes.wasm` (apps/engine/scopes compilado para
 * wasm32-unknown-unknown, sem wasm-bindgen).
 *
 * É a MESMA matemática que o `rplayout-probe` roda no servidor: o QC exato
 * (quadro `.ycc` do original) é calculado aqui, não em TypeScript. O contrato
 * é o de `apps/engine/scopes/src/ffi.rs`:
 *  - entradas escritas num buffer alocado com `rs_alloc` (reaproveitado);
 *  - resultados lidos por views sobre `memory.buffer` logo após cada chamada
 *    (a memória pode crescer e trocar o ArrayBuffer -- por isso as views são
 *    recriadas a cada leitura e o resultado é "emprestado" até a próxima).
 */

export const SCOPES_ABI = 1

/** Canais na ordem dos buffers do crate. */
export const SCOPE_CHANNELS = ['Y', 'Cb', 'Cr', 'R', 'G', 'B'] as const
export type ScopeChannel = typeof SCOPE_CHANNELS[number]
export const CHANNEL_BIT: Record<ScopeChannel, number> = {Y: 1, Cb: 2, Cr: 4, R: 8, G: 16, B: 32}
export const CH_ALL = 63

export const LEVEL_MIN = -8
export const LEVEL_MAX = 110
export const VECTOR_FULL_SCALE = 1.3
export const DIAMOND_EXTENT = 1.25

/** Matriz pelo código H.273 (o mesmo byte do cabeçalho `.ycc`). */
export const MATRIX = {bt709: 1, bt2020: 9} as const
export type MatrixCode = typeof MATRIX[keyof typeof MATRIX]

export interface ScopeConfig {
  waveColumns: number
  waveRows: number
  /** Máscara de canais (`CHANNEL_BIT`). */
  channels: number
  levelMin: number
  levelMax: number
  vectorSize: number
  vectorScale: number
  histBins: number
  diamondSize: number
  /** ROI normalizada (x0, y0, x1, y1). */
  roi: readonly [number, number, number, number]
}

export const DEFAULT_SCOPE_CONFIG: ScopeConfig = {
  waveColumns: 480, waveRows: 256, channels: CH_ALL, levelMin: LEVEL_MIN, levelMax: LEVEL_MAX,
  vectorSize: 256, vectorScale: VECTOR_FULL_SCALE, histBins: 256, diamondSize: 128, roi: [0, 0, 1, 1],
}

/** Layout de `Stats::to_array` (16 × f64). */
export interface ScopeStats {
  count: number
  lumaMin: number; lumaMax: number; lumaAvg: number
  belowBlack: number; aboveWhite: number; lumaR103: number
  rgbMin: number; rgbMax: number
  gamutR103: number; gamutStrict: number
  chromaMax: number; chromaIllegal: number
  lumaIllegal: boolean; gamutIllegal: boolean; chromaIllegalAny: boolean
}

export function statsFromArray(a: ArrayLike<number>): ScopeStats {
  return {
    count: a[0]!, lumaMin: a[1]!, lumaMax: a[2]!, lumaAvg: a[3]!, belowBlack: a[4]!, aboveWhite: a[5]!, lumaR103: a[6]!,
    rgbMin: a[7]!, rgbMax: a[8]!, gamutR103: a[9]!, gamutStrict: a[10]!, chromaMax: a[11]!, chromaIllegal: a[12]!,
    lumaIllegal: a[13] === 1, gamutIllegal: a[14] === 1, chromaIllegalAny: a[15] === 1,
  }
}

/** Densidades de um quadro. As arrays podem ser views emprestadas (ver `copy`). */
export interface ScopeResult {
  config: ScopeConfig
  wave: Uint32Array
  vector: Uint32Array
  hist: Uint32Array
  diamond: Uint32Array
  stats: ScopeStats
  frameWidth: number
  frameHeight: number
}

export function copyScopeResult(result: ScopeResult): ScopeResult {
  return {...result, wave: result.wave.slice(), vector: result.vector.slice(), hist: result.hist.slice(), diamond: result.diamond.slice(), stats: {...result.stats}}
}

interface Exports {
  memory: WebAssembly.Memory
  rs_abi_version(): number
  rs_alloc(len: number): number
  rs_free(ptr: number, len: number): void
  rs_scopes_new(): number
  rs_scopes_free(ptr: number): void
  rs_scopes_configure(ptr: number, wc: number, wr: number, ch: number, lmin: number, lmax: number, vs: number, vscale: number, hb: number, ds: number, x0: number, y0: number, x1: number, y1: number): number
  rs_scopes_run_ycc(ptr: number, bytes: number, len: number): number
  rs_scopes_run_rgba(ptr: number, rgba: number, width: number, height: number, matrix: number): number
  rs_scopes_wave(ptr: number): number
  rs_scopes_vector(ptr: number): number
  rs_scopes_hist(ptr: number): number
  rs_scopes_diamond(ptr: number): number
  rs_scopes_stats(ptr: number): number
  rs_scopes_frame_size(ptr: number): number
  rs_false_color_ycc(bytes: number, len: number, mode: number, out: number, outLen: number): number
  rs_false_color_rgba(rgba: number, width: number, height: number, matrix: number, mode: number, out: number): number
}

export type FalseColorMode = 'exposure' | 'gamut'
const FALSE_COLOR_CODE: Record<FalseColorMode, number> = {exposure: 0, gamut: 1}

export class ScopesWasm {
  private readonly scopes: number
  private input = {ptr: 0, len: 0}
  private output = {ptr: 0, len: 0}
  private config: ScopeConfig | null = null

  private constructor(private readonly exports: Exports) {
    this.scopes = exports.rs_scopes_new()
  }

  /** Instancia a partir dos bytes do `.wasm` (vitest/node) ou de uma URL (navegador). */
  static async load(source: BufferSource | string | URL): Promise<ScopesWasm> {
    let instance: WebAssembly.Instance
    if (typeof source === 'string' || source instanceof URL) {
      const response = await fetch(source)
      if (!response.ok) throw new Error(`scopes WASM: HTTP ${response.status}`)
      instance = (await WebAssembly.instantiate(await response.arrayBuffer(), {})).instance
    } else {
      instance = (await WebAssembly.instantiate(source, {})).instance
    }
    const exports = instance.exports as unknown as Exports
    if (exports.rs_abi_version() !== SCOPES_ABI) throw new Error(`scopes WASM com ABI ${exports.rs_abi_version()}, esperado ${SCOPES_ABI}`)
    return new ScopesWasm(exports)
  }

  private ensure(slot: {ptr: number; len: number}, len: number): number {
    if (slot.len < len) {
      if (slot.ptr) this.exports.rs_free(slot.ptr, slot.len)
      slot.ptr = this.exports.rs_alloc(len)
      slot.len = len
    }
    return slot.ptr
  }

  private configure(config: ScopeConfig) {
    const c = config
    if (this.config && sameConfig(this.config, c)) return
    this.exports.rs_scopes_configure(this.scopes, c.waveColumns, c.waveRows, c.channels, c.levelMin, c.levelMax, c.vectorSize, c.vectorScale, c.histBins, c.diamondSize, c.roi[0], c.roi[1], c.roi[2], c.roi[3])
    this.config = {...c, roi: [...c.roi] as [number, number, number, number]}
  }

  private write(bytes: Uint8Array | Uint8ClampedArray): number {
    const ptr = this.ensure(this.input, bytes.length)
    new Uint8Array(this.exports.memory.buffer, ptr, bytes.length).set(bytes)
    return ptr
  }

  private collect(config: ScopeConfig): ScopeResult {
    const e = this.exports, buffer = e.memory.buffer
    // O crate sanitiza a config; leia os tamanhos dela, não os pedidos.
    const c = sanitize(config)
    const plane = c.waveColumns * c.waveRows
    const size = e.rs_scopes_frame_size(this.scopes)
    return {
      config: c,
      wave: new Uint32Array(buffer, e.rs_scopes_wave(this.scopes), plane * 6),
      vector: new Uint32Array(buffer, e.rs_scopes_vector(this.scopes), c.vectorSize * c.vectorSize),
      hist: new Uint32Array(buffer, e.rs_scopes_hist(this.scopes), c.histBins * 6),
      diamond: new Uint32Array(buffer, e.rs_scopes_diamond(this.scopes), c.diamondSize * c.diamondSize * 2),
      stats: statsFromArray(new Float64Array(buffer, e.rs_scopes_stats(this.scopes), 16)),
      frameWidth: size & 0xffff,
      frameHeight: size >>> 16,
    }
  }

  /** Quadro `.ycc` do servidor (cabeçalho + planos): o caminho EXATO. */
  runYcc(ycc: Uint8Array, config: ScopeConfig = DEFAULT_SCOPE_CONFIG): ScopeResult {
    this.configure(config)
    const ptr = this.write(ycc)
    const code = this.exports.rs_scopes_run_ycc(this.scopes, ptr, ycc.length)
    if (code !== 0) throw new Error(code === -3 ? 'Amostra Y\'CbCr inválida ou em formato não suportado.' : `scopes WASM falhou (${code})`)
    return this.collect(config)
  }

  /** RGBA do navegador (faixa cheia), reconvertido pela matriz: INDICATIVO. */
  runRgba(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number, config: ScopeConfig = DEFAULT_SCOPE_CONFIG, matrix: MatrixCode = MATRIX.bt709): ScopeResult {
    this.configure(config)
    const ptr = this.write(rgba)
    const code = this.exports.rs_scopes_run_rgba(this.scopes, ptr, width, height, matrix)
    if (code !== 0) throw new Error(`scopes WASM falhou (${code})`)
    return this.collect(config)
  }

  /** Falsa cor (RGBA) de um `.ycc`. Devolve uma cópia. */
  falseColorYcc(ycc: Uint8Array, mode: FalseColorMode): {width: number; height: number; rgba: Uint8ClampedArray} {
    const width = ycc[8]! | (ycc[9]! << 8), height = ycc[10]! | (ycc[11]! << 8), len = width * height * 4
    const input = this.write(ycc)
    const out = this.ensure(this.output, len)
    const code = this.exports.rs_false_color_ycc(input, ycc.length, FALSE_COLOR_CODE[mode], out, len)
    if (code !== 0) throw new Error(`falsa cor falhou (${code})`)
    return {width, height, rgba: new Uint8ClampedArray(this.exports.memory.buffer, out, len).slice()}
  }

  falseColorRgba(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number, mode: FalseColorMode, matrix: MatrixCode = MATRIX.bt709): Uint8ClampedArray {
    const len = width * height * 4
    const input = this.write(rgba)
    const out = this.ensure(this.output, len)
    const code = this.exports.rs_false_color_rgba(input, width, height, matrix, FALSE_COLOR_CODE[mode], out)
    if (code !== 0) throw new Error(`falsa cor falhou (${code})`)
    return new Uint8ClampedArray(this.exports.memory.buffer, out, len).slice()
  }
}

function sameConfig(a: ScopeConfig, b: ScopeConfig): boolean {
  return a.waveColumns === b.waveColumns && a.waveRows === b.waveRows && a.channels === b.channels && a.levelMin === b.levelMin && a.levelMax === b.levelMax
    && a.vectorSize === b.vectorSize && a.vectorScale === b.vectorScale && a.histBins === b.histBins && a.diamondSize === b.diamondSize
    && a.roi.every((v, i) => v === b.roi[i])
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const f32 = Math.fround

/** Espelho de `Config::sanitized` (os tamanhos dos buffers dependem dele). */
export function sanitize(config: ScopeConfig): ScopeConfig {
  const c = {...config}
  c.waveColumns = clamp(c.waveColumns >>> 0, 16, 4096)
  c.waveRows = clamp(c.waveRows >>> 0, 16, 2048)
  c.vectorSize = clamp(c.vectorSize >>> 0, 32, 1024)
  c.histBins = clamp(c.histBins >>> 0, 16, 4096)
  c.diamondSize = clamp(c.diamondSize >>> 0, 32, 1024)
  c.channels &= CH_ALL
  if (!(f32(c.levelMax) - f32(c.levelMin) > 0.5) || !Number.isFinite(c.levelMin) || !Number.isFinite(c.levelMax)) { c.levelMin = LEVEL_MIN; c.levelMax = LEVEL_MAX }
  if (!(c.vectorScale > 0.01) || !Number.isFinite(c.vectorScale)) c.vectorScale = VECTOR_FULL_SCALE
  let roi = c.roi.map(v => Number.isFinite(v) ? clamp(v, 0, 1) : 0) as [number, number, number, number]
  if (roi[2] <= roi[0] || roi[3] <= roi[1]) roi = [0, 0, 1, 1]
  c.roi = roi
  return c
}

/**
 * Confere o cabeçalho de um `.ycc` antes de entregá-lo ao WASM (que também
 * recusa, mas aqui a mensagem é para o operador). Devolve as dimensões.
 */
export function checkYccHeader(buffer: ArrayBuffer): {width: number; height: number; matrix: number; range: number} {
  const bytes = new Uint8Array(buffer)
  if (bytes.length < 16 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'RPYC') throw new Error('Amostra Y\'CbCr inválida.')
  if (bytes[4] !== 1 || bytes[7] !== 8 || (bytes[5] !== MATRIX.bt709 && bytes[5] !== MATRIX.bt2020) || bytes[6]! > 1) throw new Error('Amostra Y\'CbCr em formato não suportado.')
  const width = bytes[8]! | (bytes[9]! << 8), height = bytes[10]! | (bytes[11]! << 8)
  if (!width || !height || bytes.length < 16 + width * height * 3) throw new Error('Amostra Y\'CbCr truncada.')
  return {width, height, matrix: bytes[5]!, range: bytes[6]!}
}

let shared: Promise<ScopesWasm> | null = null
/** Instância compartilhada da interface (carregada sob demanda, uma vez). */
export function sharedScopesWasm(url: string | URL): Promise<ScopesWasm> {
  if (!shared) shared = ScopesWasm.load(url).catch(error => { shared = null; throw error })
  return shared
}
