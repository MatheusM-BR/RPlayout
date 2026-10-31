/**
 * Bancada dos scopes ao vivo (não entra no bundle da interface).
 *
 * `scripts/bench-scopes.mjs` empacota este arquivo com esbuild, abre num
 * Chromium/Edge e chama `window.scopesBench.run()`. Mede:
 *  - paridade WebGPU/WebGL2 × WASM sobre o mesmo quadro RGB do navegador;
 *  - erro do caminho INDICATIVO (RGB do navegador reconvertido) contra o
 *    quadro exato (Y'CbCr decodificado pelo ffmpeg, via WASM), barra a barra;
 *  - ms por quadro em 1080p de cada backend (WebGPU, WebGL2, WASM, JS).
 */
import {accumulateRgbaJs} from '../cpu-js.js'
import {scopeLayout, accumulationConfig} from '../layout.js'
import type {LiveView} from '../live.js'
import {WebGpuScopes} from '../webgpu.js'
import {WebGl2Scopes} from '../webgl2.js'
import {CH_ALL, DEFAULT_SCOPE_CONFIG, MATRIX, ScopesWasm, type ScopeConfig, type ScopeResult, type ScopeStats} from '../wasm.js'

interface Media {name: string; video: string; ycc?: string; bars?: number}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length ? sorted[Math.floor(sorted.length / 2)]! : NaN
}

async function loadVideo(url: string, at: number): Promise<HTMLVideoElement> {
  const video = document.createElement('video')
  video.muted = true; video.playsInline = true; video.crossOrigin = 'anonymous'; video.preload = 'auto'
  video.src = url
  document.body.appendChild(video)
  await new Promise<void>((resolve, reject) => { video.onloadeddata = () => resolve(); video.onerror = () => reject(new Error(`vídeo ${url}: ${video.error?.message}`)) })
  video.currentTime = at
  await new Promise<void>(resolve => { video.onseeked = () => resolve() })
  await new Promise<void>(resolve => { if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(() => resolve()); else resolve() })
  return video
}

function rgbaOf(source: HTMLVideoElement, width: number, height: number): Uint8ClampedArray {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
  const ctx = canvas.getContext('2d', {willReadFrequently: true})!
  ctx.drawImage(source, 0, 0, width, height)
  return ctx.getImageData(0, 0, width, height).data
}

/** Centróide (Cb, Cr) e Y' médio de uma densidade de vectorscope/estatística. */
function centroid(result: {vector: ArrayLike<number>; config: ScopeConfig}): {cb: number; cr: number} {
  const size = result.config.vectorSize, half = (size - 1) / 2, radius = half / result.config.vectorScale
  let sx = 0, sy = 0, n = 0
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const v = result.vector[y * size + x]!; sx += v * x; sy += v * y; n += v }
  return {cb: (sx / n - half) / (2 * radius), cr: -(sy / n - half) / (2 * radius)}
}

function polar(cb: number, cr: number) { return {angle: (Math.atan2(cr, cb) * 180 / Math.PI + 360) % 360, magnitude: Math.hypot(cb, cr) * 2} }

function histDistance(a: ArrayLike<number>, b: ArrayLike<number>, bins: number, channel: number): number {
  let diff = 0, total = 0
  for (let i = channel * bins; i < (channel + 1) * bins; i++) { diff += Math.abs(a[i]! - b[i]!); total += b[i]! }
  return total ? diff / (2 * total) : 0
}

function compareStats(gpu: ScopeStats, cpu: ScopeStats) {
  return {lumaMin: gpu.lumaMin - cpu.lumaMin, lumaMax: gpu.lumaMax - cpu.lumaMax, lumaAvg: gpu.lumaAvg - cpu.lumaAvg, count: gpu.count - cpu.count, gamutR103: gpu.gamutR103 - cpu.gamutR103}
}

async function barErrors(wasm: ScopesWasm, video: HTMLVideoElement, yccUrl: string, bars: number, gpu: WebGpuScopes | null, canvas: HTMLCanvasElement) {
  const ycc = new Uint8Array(await (await fetch(yccUrl)).arrayBuffer())
  const width = video.videoWidth, height = video.videoHeight
  const rgba = rgbaOf(video, width, height)
  const rows: Array<Record<string, number | string>> = []
  for (let bar = 0; bar < bars; bar++) {
    const roi: [number, number, number, number] = [(bar + 0.25) / bars, 0.3, (bar + 0.75) / bars, 0.7]
    const config: ScopeConfig = {...DEFAULT_SCOPE_CONFIG, vectorSize: 1024, roi}
    const exact = wasm.runYcc(ycc, config)
    const exactLuma = exact.stats.lumaAvg, exactC = centroid(exact)
    const browser = wasm.runRgba(rgba, width, height, config)
    const browserC = centroid(browser)
    const e = polar(exactC.cb, exactC.cr), b = polar(browserC.cb, browserC.cr)
    const row: Record<string, number | string> = {
      bar, exactY: +exactLuma.toFixed(2), canvasDY: +(browser.stats.lumaAvg - exactLuma).toFixed(2),
      canvasDPhase: e.magnitude > 0.05 ? +(((b.angle - e.angle + 540) % 360) - 180).toFixed(2) : '—',
      canvasDGain: e.magnitude > 0.05 ? +((b.magnitude / e.magnitude - 1) * 100).toFixed(2) : '—',
    }
    if (gpu) {
      const panels = scopeLayout('VECTOR', 300, 300, {waveChannel: 'Y', parade: 'RGB', scale: 1})
      gpu.render(video, {panels, config: {...config, channels: CH_ALL}, width: 300, height: 300, intensity: 1, matrix: MATRIX.bt709, frozen: false, showReference: false, stride: 1})
      const read = await gpu.debugRead()
      if (read) {
        const g = polar(...Object.values(centroid({vector: read.vector, config})) as [number, number])
        row.gpuDY = +(read.stats.lumaAvg - exactLuma).toFixed(2)
        row.gpuDPhase = e.magnitude > 0.05 ? +(((g.angle - e.angle + 540) % 360) - 180).toFixed(2) : '—'
        row.gpuDGain = e.magnitude > 0.05 ? +((g.magnitude / e.magnitude - 1) * 100).toFixed(2) : '—'
      }
    }
    rows.push(row)
  }
  void canvas
  return rows
}

async function timeBackends(wasm: ScopesWasm, video: HTMLVideoElement, iterations: number) {
  const out: Record<string, unknown> = {}
  const width = 960, height = 540, scale = 1
  const panels = scopeLayout('QUAD', width, height, {waveChannel: 'Y', parade: 'RGB', scale})
  const config = accumulationConfig(panels, {levelMin: -8, levelMax: 110, vectorScale: 1.3, roi: [0, 0, 1, 1]}, video.videoWidth)
  const view = (stride: number): LiveView => ({panels, config, width, height, intensity: 1, matrix: MATRIX.bt709, frozen: false, showReference: false, stride})
  const canvasGpu = document.createElement('canvas'); document.body.appendChild(canvasGpu)
  const gpu = await WebGpuScopes.create(canvasGpu)
  if (gpu) {
    for (let i = 0; i < 5; i++) { gpu.render(video, view(1)); await gpu.idle() }
    const cpu: number[] = [], total: number[] = [], gpuMs: number[] = []
    for (let i = 0; i < iterations; i++) {
      const t0 = performance.now(); gpu.render(video, view(1)); const t1 = performance.now(); await gpu.idle(); const t2 = performance.now()
      cpu.push(t1 - t0); total.push(t2 - t0)
      const g = gpu.timing().gpuMs; if (g !== null) gpuMs.push(g)
      if (i % 10 === 9) await new Promise(r => setTimeout(r, 1100))
    }
    out.webgpu = {cpuMs: median(cpu), submitToIdleMs: median(total), gpuComputeMs: gpuMs.length ? median(gpuMs) : null, sampled: `${gpu.timing().sampledWidth}x${gpu.timing().sampledHeight}`}
    gpu.destroy()
  } else out.webgpu = 'indisponível'
  const canvasGl = document.createElement('canvas'); document.body.appendChild(canvasGl)
  const gl = WebGl2Scopes.create(canvasGl)
  if (gl) {
    for (const stride of [1, 2]) {
      for (let i = 0; i < 3; i++) { gl.render(video, view(stride)); gl.finish() }
      const cpu: number[] = [], total: number[] = []
      for (let i = 0; i < Math.max(5, iterations / 3); i++) {
        const t0 = performance.now(); gl.render(video, view(stride)); const t1 = performance.now(); gl.finish(); const t2 = performance.now()
        cpu.push(t1 - t0); total.push(t2 - t0)
      }
      out[`webgl2_stride${stride}`] = {cpuMs: median(cpu), withFinishMs: median(total), gpuMs: gl.timing().gpuMs, sampled: `${gl.timing().sampledWidth}x${gl.timing().sampledHeight}`}
    }
    gl.destroy()
  } else out.webgl2 = 'indisponível'
  for (const [label, w, h] of [['wasm_1080p', 1920, 1080], ['wasm_640x360', 640, 360]] as const) {
    const times: number[] = [], acc: number[] = []
    for (let i = 0; i < Math.max(5, iterations / 4); i++) {
      const t0 = performance.now(); const rgba = rgbaOf(video, w, h); const t1 = performance.now(); wasm.runRgba(rgba, w, h, config); const t2 = performance.now()
      times.push(t2 - t0); acc.push(t2 - t1)
    }
    out[label] = {totalMs: median(times), accumulateMs: median(acc)}
  }
  for (const [label, w, h] of [['js_1080p', 1920, 1080], ['js_640x360', 640, 360]] as const) {
    const times: number[] = []
    for (let i = 0; i < 5; i++) { const t0 = performance.now(); const rgba = rgbaOf(video, w, h); accumulateRgbaJs(rgba, w, h, config); times.push(performance.now() - t0) }
    out[label] = {totalMs: median(times)}
  }
  return out
}

async function parity(wasm: ScopesWasm, video: HTMLVideoElement) {
  const width = video.videoWidth, height = video.videoHeight
  const rgba = rgbaOf(video, width, height)
  const config: ScopeConfig = {...DEFAULT_SCOPE_CONFIG, channels: CH_ALL}
  const cpu = wasm.runRgba(rgba, width, height, config)
  const panels = scopeLayout('QUAD', 960, 540, {waveChannel: 'Y', parade: 'RGB', scale: 1})
  const view: LiveView = {panels, config, width: 960, height: 540, intensity: 1, matrix: MATRIX.bt709, frozen: false, showReference: false, stride: 1}
  const out: Record<string, unknown> = {}
  const gpuCanvas = document.createElement('canvas'); document.body.appendChild(gpuCanvas)
  const gpu = await WebGpuScopes.create(gpuCanvas)
  if (gpu) {
    gpu.render(video, view)
    const read = await gpu.debugRead()
    if (read) out.webgpu = {
      histL1: ['Y', 'Cb', 'Cr', 'R', 'G', 'B'].map((_, ch) => +histDistance(read.hist, cpu.hist, config.histBins, ch).toFixed(5)),
      waveL1: +histDistance(read.wave, cpu.wave, config.waveColumns * config.waveRows * 6, 0).toFixed(5),
      vectorL1: +histDistance(read.vector, cpu.vector, config.vectorSize ** 2, 0).toFixed(5),
      diamondL1: +histDistance(read.diamond, cpu.diamond, config.diamondSize ** 2 * 2, 0).toFixed(5),
      stats: compareStats(read.stats, cpu.stats),
    }
    gpu.destroy()
  }
  const glCanvas = document.createElement('canvas'); document.body.appendChild(glCanvas)
  const gl = WebGl2Scopes.create(glCanvas)
  if (gl) {
    gl.render(video, view)
    const read = gl.debugRead()
    if (read) out.webgl2 = {
      histL1: ['Y', 'Cb', 'Cr', 'R', 'G', 'B'].map((_, ch) => +histDistance(read.hist, cpu.hist, config.histBins, ch).toFixed(5)),
      waveL1: +histDistance(read.wave, cpu.wave, config.waveColumns * config.waveRows * 6, 0).toFixed(5),
      vectorL1: +histDistance(read.vector, cpu.vector, config.vectorSize ** 2, 0).toFixed(5),
      diamondL1: +histDistance(read.diamond, cpu.diamond, config.diamondSize ** 2 * 2, 0).toFixed(5),
      stats: gl.stats() ? compareStats(gl.stats()!, cpu.stats) : null,
    }
    gl.destroy()
  }
  return out
}

async function run(media: Media[], iterations = 30) {
  const wasm = await ScopesWasm.load('/rplayout_scopes.wasm')
  const results: Record<string, unknown> = {userAgent: navigator.userAgent}
  const adapter = await (navigator as unknown as {gpu?: {requestAdapter(): Promise<{info?: Record<string, string>} | null>}}).gpu?.requestAdapter()
  results.adapter = adapter?.info ? {vendor: adapter.info.vendor, architecture: adapter.info.architecture, description: adapter.info.description} : null
  const glInfo = document.createElement('canvas').getContext('webgl2')
  const debug = glInfo?.getExtension('WEBGL_debug_renderer_info')
  results.webglRenderer = glInfo && debug ? glInfo.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null
  for (const item of media) {
    console.warn(`[bench] ${item.name}`)
    const video = await loadVideo(item.video, 0.5)
    const entry: Record<string, unknown> = {size: `${video.videoWidth}x${video.videoHeight}`}
    entry.parity = await parity(wasm, video)
    console.warn(`[bench] ${item.name} paridade ok`)
    if (item.ycc && item.bars) {
      const canvas = document.createElement('canvas')
      const gpu = await WebGpuScopes.create(canvas)
      entry.bars = await barErrors(wasm, video, item.ycc, item.bars, gpu, canvas)
      gpu?.destroy()
    }
    if (item.name.includes('perf')) entry.timing = await timeBackends(wasm, video, iterations)
    results[item.name] = entry
    video.remove()
  }
  return results
}

/** Resultado exato do WASM (para checar o caminho do servidor). */
export type BenchExact = ScopeResult
;(window as unknown as {scopesBench: unknown}).scopesBench = {run}
