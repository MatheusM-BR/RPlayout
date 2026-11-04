import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {describe, expect, it} from 'vitest'
import {HistogramReadback, histogramStats, type ReadbackGl} from './webgl2.js'
import {DEFAULT_SCOPE_CONFIG, ScopesWasm, type ScopeConfig} from './wasm.js'

/** Histograma em RGBA float (canal no R), como a textura `bins × 6` do WebGL2. */
function asTexture(hist: ArrayLike<number>, c: ScopeConfig): Float32Array {
  const data = new Float32Array(c.histBins * 6 * 4)
  for (let i = 0; i < c.histBins * 6; i++) data[i * 4] = hist[i]!
  return data
}

/**
 * GL falso: o `readPixels` com PBO ligado só é "executado" quando a cerca
 * passa (como numa GPU de verdade), e o `clientWaitSync` responde
 * TIMEOUT_EXPIRED nas primeiras `lag` consultas.
 */
function fakeGl(texture: Float32Array, lag: number) {
  const calls: string[] = []
  const waits: number[] = []
  let bound: {data?: Float32Array} | null = null
  let queued: {buffer: {data?: Float32Array}; snapshot: Float32Array} | null = null
  let polls = 0
  const gl = {
    PIXEL_PACK_BUFFER: 1, STREAM_READ: 2, FRAMEBUFFER: 3, READ_FRAMEBUFFER: 4, RGBA: 5, FLOAT: 6,
    SYNC_GPU_COMMANDS_COMPLETE: 7, ALREADY_SIGNALED: 8, CONDITION_SATISFIED: 9, WAIT_FAILED: 10,
    createBuffer: () => ({}),
    deleteBuffer: () => { calls.push('deleteBuffer') },
    bindBuffer: (_: number, buffer: {data?: Float32Array} | null) => { bound = buffer },
    bufferData: (_: number, bytes: number) => { bound!.data = new Float32Array(bytes / 4) },
    bindFramebuffer: () => {},
    readPixels: (...args: unknown[]) => {
      calls.push('readPixels')
      // Com PBO o último argumento é um deslocamento, nunca um array da CPU.
      expect(typeof args[6]).toBe('number')
      queued = {buffer: bound!, snapshot: texture.slice()}
    },
    fenceSync: () => { calls.push('fenceSync'); polls = 0; return {} },
    flush: () => { calls.push('flush') },
    clientWaitSync: (_: unknown, flags: number, timeout: number) => {
      waits.push(timeout); expect(flags).toBe(0)
      if (polls++ < lag) return 11 // TIMEOUT_EXPIRED
      if (queued) { queued.buffer.data!.set(queued.snapshot); queued = null }
      return 8
    },
    deleteSync: () => { calls.push('deleteSync') },
    getBufferSubData: (_: number, offset: number, out: Float32Array) => { calls.push('getBufferSubData'); out.set(bound!.data!.subarray(offset / 4, offset / 4 + out.length)) },
  }
  return {gl: gl as unknown as ReadbackGl, calls, waits}
}

describe('WebGL2: leitura assíncrona do histograma (PBO + fenceSync)', () => {
  it('nunca espera a GPU e dá exatamente as mesmas medições da leitura síncrona', async () => {
    const wasm = await ScopesWasm.load(readFileSync(join(__dirname, 'rplayout_scopes.wasm')))
    const width = 160, height = 90, rgba = new Uint8Array(width * height * 4)
    for (let i = 0; i < width * height; i++) { const x = i % width; rgba.set([x * 255 / (width - 1), (x * 3) & 255, 255 - x, 255], i * 4) }
    const c = DEFAULT_SCOPE_CONFIG
    const result = wasm.runRgba(rgba, width, height, c)
    const texture = asTexture(result.hist, c)
    // Referência: a conta da leitura síncrona antiga sobre o mesmo histograma.
    const expected = histogramStats(c, texture)
    const {gl, calls, waits} = fakeGl(texture, 3)
    const readback = new HistogramReadback()
    expect(readback.request(gl, {} as WebGLFramebuffer, c)).toBe(true)
    expect(readback.request(gl, {} as WebGLFramebuffer, c)).toBe(false) // uma pendente por vez
    expect(calls).toEqual(['readPixels', 'fenceSync', 'flush'])
    for (let i = 0; i < 3; i++) expect(readback.poll(gl)).toBeNull()
    const ready = readback.poll(gl)!
    expect(ready).not.toBeNull()
    expect(waits.every(timeout => timeout === 0)).toBe(true)
    expect(Array.from(ready.data)).toEqual(Array.from(texture))
    expect(histogramStats(ready.config, ready.data)).toEqual(expected)
    expect(readback.pending).toBe(false)
    expect(readback.notReady).toBe(3)
    // E as medições do histograma ficam dentro de uma faixa do WASM exato.
    const band = (c.levelMax - c.levelMin) / c.histBins
    expect(Math.abs(expected.lumaAvg - result.stats.lumaAvg)).toBeLessThanOrEqual(band)
    expect(expected.count).toBe(result.stats.count)
  })

  it('descarta a leitura pendente quando a configuração muda', () => {
    const c = DEFAULT_SCOPE_CONFIG
    const {gl, calls} = fakeGl(new Float32Array(c.histBins * 24), 100)
    const readback = new HistogramReadback()
    readback.request(gl, {} as WebGLFramebuffer, c)
    readback.cancel(gl)
    expect(readback.pending).toBe(false)
    expect(readback.poll(gl)).toBeNull()
    expect(calls.at(-1)).toBe('deleteSync')
    const other = {...c, histBins: 128}
    expect(readback.request(gl, {} as WebGLFramebuffer, other)).toBe(true)
    readback.dispose(gl)
    expect(calls).toContain('deleteBuffer')
  })
})
