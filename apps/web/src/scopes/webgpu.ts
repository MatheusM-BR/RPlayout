/**
 * Scopes ao vivo em WebGPU.
 *
 * Por quadro (requestVideoFrameCallback): `importExternalTexture` do
 * `<video>` → um dispatch de compute que acumula waveform (6 canais),
 * vectorscope, histograma, diamante e medições com `atomicAdd` → um render
 * pass que desenha as densidades direto dos storage buffers. Nada volta para
 * a CPU no caminho do desenho; só 64 bytes de medição (4 Hz) e o tempo de GPU
 * (1 Hz) são lidos de forma assíncrona.
 *
 * Histograma e medições são somados primeiro em memória de workgroup e
 * despejados uma vez por workgroup, o que tira a contenção dos atômicos
 * globais justamente onde ela seria pior (todos os pixels no mesmo contador).
 */
import {BufferUsage, MapMode, navigatorGpu, type GpuBuffer, type GpuCanvasContext, type GpuDevice, type GpuQuerySet} from './gpu-types.js'
import {WGSL_ACCUMULATE, WGSL_DISPLAY, WGSL_FALSE_COLOR} from './shaders.js'
import {drawSpecs, sampledArea, statsFromGpu, type LiveScopes, type LiveSource, type LiveTiming, type LiveView} from './live.js'
import {MATRIX, type FalseColorMode, type MatrixCode, type ScopeConfig, type ScopeStats} from './wasm.js'

const DRAW_STRIDE = 256 // alinhamento mínimo de offset dinâmico de uniform
const MAX_DRAWS = 16

interface Accumulators {wave: GpuBuffer; vect: GpuBuffer; hist: GpuBuffer; diam: GpuBuffer; stats: GpuBuffer; sizes: [number, number, number, number]}

function kr(matrix: MatrixCode): [number, number, number] {
  const [r, b] = matrix === MATRIX.bt2020 ? [0.2627, 0.0593] : [0.2126, 0.0722]
  return [r, b, 1 - r - b]
}

let devicePromise: Promise<GpuDevice | null> | null = null
/** Um device por página: QC e monitor de PGM dividem o mesmo. */
export function sharedGpuDevice(): Promise<GpuDevice | null> {
  if (devicePromise) return devicePromise
  devicePromise = (async () => {
    const gpu = navigatorGpu()
    if (!gpu) return null
    const adapter = await gpu.requestAdapter({powerPreference: 'low-power'})
    if (!adapter) return null
    const features = adapter.features.has('timestamp-query') ? ['timestamp-query'] : []
    const device = await adapter.requestDevice({requiredFeatures: features})
    void device.lost.then(() => { devicePromise = null })
    return device
  })().catch(() => { devicePromise = null; return null })
  return devicePromise
}

export class WebGpuScopes implements LiveScopes {
  readonly kind = 'webgpu' as const
  private context: GpuCanvasContext
  private format: string
  private accumulate: ReturnType<GpuDevice['createComputePipeline']>
  private display: ReturnType<GpuDevice['createRenderPipeline']> | null
  private params: GpuBuffer
  private draws: GpuBuffer
  private live: Accumulators | null = null
  private reference: Accumulators | null = null
  private referenceSamples = 0
  private statsInit = new Uint32Array(16)
  private statsRead: GpuBuffer
  private statsPending = false
  private lastStatsAt = 0
  private latestStats: ScopeStats | null = null
  private query: GpuQuerySet | null = null
  private queryResolve: GpuBuffer | null = null
  private queryRead: GpuBuffer | null = null
  private queryPending = false
  private lastQueryAt = 0
  private gpuMs: number | null = null
  private cpuMs = 0
  private sampled = {w: 0, h: 0}
  private samples = 0
  private falseCanvas: HTMLCanvasElement | null = null
  private falseContext: GpuCanvasContext | null = null
  private falseMode: FalseColorMode = 'exposure'
  private falsePipeline: ReturnType<GpuDevice['createRenderPipeline']> | null = null
  private falseParams: GpuBuffer
  private sampler: unknown
  private destroyed = false

  private constructor(private readonly device: GpuDevice, private readonly canvas: HTMLCanvasElement) {
    const gpu = navigatorGpu()!
    this.format = gpu.getPreferredCanvasFormat()
    this.context = canvas.getContext('webgpu') as unknown as GpuCanvasContext
    this.context.configure({device, format: this.format, alphaMode: 'premultiplied'})
    this.accumulate = device.createComputePipeline({layout: 'auto', compute: {module: device.createShaderModule({code: WGSL_ACCUMULATE, label: 'scopes-accumulate'}), entryPoint: 'accumulate'}})
    this.display = null
    this.buildDynamicDisplay()
    this.params = device.createBuffer({size: 80, usage: BufferUsage.UNIFORM | BufferUsage.COPY_DST, label: 'scopes-params'})
    this.draws = device.createBuffer({size: DRAW_STRIDE * MAX_DRAWS * 2, usage: BufferUsage.UNIFORM | BufferUsage.COPY_DST, label: 'scopes-draws'})
    this.statsRead = device.createBuffer({size: 64, usage: BufferUsage.MAP_READ | BufferUsage.COPY_DST})
    this.falseParams = device.createBuffer({size: 32, usage: BufferUsage.UNIFORM | BufferUsage.COPY_DST})
    this.sampler = device.createSampler({magFilter: 'linear', minFilter: 'linear'})
    this.statsInit[1] = 0xffffffff; this.statsInit[6] = 0xffffffff
    if (device.features.has('timestamp-query')) {
      this.query = device.createQuerySet({type: 'timestamp', count: 2})
      this.queryResolve = device.createBuffer({size: 16, usage: BufferUsage.QUERY_RESOLVE | BufferUsage.COPY_SRC})
      this.queryRead = device.createBuffer({size: 16, usage: BufferUsage.MAP_READ | BufferUsage.COPY_DST})
    }
  }

  /** Cria o backend ou devolve null se não houver WebGPU utilizável. */
  static async create(canvas: HTMLCanvasElement): Promise<WebGpuScopes | null> {
    const device = await sharedGpuDevice()
    if (!device) return null
    device.pushErrorScope('validation')
    let scopes: WebGpuScopes | null = null
    try { scopes = new WebGpuScopes(device, canvas) } catch { scopes = null }
    const error = await device.popErrorScope()
    if (error || !scopes) { if (error) console.warn('[scopes] WebGPU recusado:', error.message); return null }
    return scopes
  }

  private allocate(config: ScopeConfig): Accumulators {
    const sizes: [number, number, number, number] = [config.waveColumns * config.waveRows * 6, config.vectorSize ** 2, config.histBins * 6, config.diamondSize ** 2 * 2]
    const usage = BufferUsage.STORAGE | BufferUsage.COPY_DST | BufferUsage.COPY_SRC
    const make = (count: number, label: string) => this.device.createBuffer({size: Math.max(16, count * 4), usage, label})
    return {wave: make(sizes[0], 'wave'), vect: make(sizes[1], 'vect'), hist: make(sizes[2], 'hist'), diam: make(sizes[3], 'diam'), stats: make(16, 'stats'), sizes}
  }

  private release(a: Accumulators | null) {
    if (!a) return
    a.wave.destroy(); a.vect.destroy(); a.hist.destroy(); a.diam.destroy(); a.stats.destroy()
  }

  private ensure(config: ScopeConfig): Accumulators {
    const sizes = [config.waveColumns * config.waveRows * 6, config.vectorSize ** 2, config.histBins * 6, config.diamondSize ** 2 * 2]
    if (this.live && this.live.sizes.every((v, i) => v === sizes[i])) return this.live
    if (this.live) this.bindCache.delete(this.live)
    this.release(this.live)
    this.clearReference()
    this.live = this.allocate(config)
    return this.live
  }

  private writeParams(config: ScopeConfig, roi: [number, number, number, number], stride: number, frameWidth: number, matrix: MatrixCode) {
    const data = new ArrayBuffer(80), u = new Uint32Array(data), f = new Float32Array(data)
    u.set(roi, 0)
    u.set([config.waveColumns, config.waveRows, config.channels, config.histBins], 4)
    u.set([config.vectorSize, config.diamondSize, stride, frameWidth], 8)
    f.set([config.levelMin, config.levelMax, config.vectorScale, 0], 12)
    const [r, b, g] = kr(matrix)
    f.set([r, b, g, 0], 16)
    this.device.queue.writeBuffer(this.params, 0, data)
  }

  private writeDraws(view: LiveView, slot: number, samples: number, reference: boolean): number {
    const specs = drawSpecs(view.panels, view.config, samples, view.intensity, reference).slice(0, MAX_DRAWS)
    const data = new ArrayBuffer(DRAW_STRIDE * specs.length)
    specs.forEach((spec, i) => {
      const f = new Float32Array(data, i * DRAW_STRIDE, 24), u = new Uint32Array(data, i * DRAW_STRIDE, 24)
      f.set(spec.rect, 0)
      u.set([spec.kind, spec.channel, spec.cols, spec.rows, spec.offset], 4)
      f[9] = spec.samples; f[10] = spec.gain; u[11] = spec.reference ? 1 : 0
      f.set([spec.levels[0], spec.levels[1], 0, 0], 12)
      f.set([...spec.color, 1], 16)
    })
    if (specs.length) this.device.queue.writeBuffer(this.draws, slot * MAX_DRAWS * DRAW_STRIDE, data)
    return specs.length
  }

  private importSource(source: LiveSource): {texture: unknown; width: number; height: number; close?: () => void} | null {
    if (source instanceof HTMLVideoElement) {
      if (source.readyState < 2 || source.videoWidth < 1 || source.videoHeight < 1) return null
      return {texture: this.device.importExternalTexture({source}), width: source.videoWidth, height: source.videoHeight}
    }
    if (!source.complete || source.naturalWidth < 1 || typeof VideoFrame === 'undefined') return null
    const frame = new VideoFrame(source, {timestamp: 0})
    return {texture: this.device.importExternalTexture({source: frame}), width: frame.displayWidth, height: frame.displayHeight, close: () => frame.close()}
  }

  render(source: LiveSource | null, view: LiveView): boolean {
    if (this.destroyed) return false
    const started = performance.now()
    if (this.canvas.width !== view.width) this.canvas.width = view.width
    if (this.canvas.height !== view.height) this.canvas.height = view.height
    const accumulators = this.ensure(view.config)
    const encoder = this.device.createCommandEncoder()
    let imported: ReturnType<WebGpuScopes['importSource']> = null
    let accumulated = false
    if (!view.frozen && source) {
      try { imported = this.importSource(source) } catch { imported = null }
      if (imported) {
        const stride = Math.max(1, Math.floor(view.stride))
        const area = sampledArea(view.config, imported.width, imported.height, stride)
        this.sampled = {w: area.columns, h: area.rows}
        this.samples = area.samples
        this.writeParams(view.config, area.roi, stride, imported.width, view.matrix)
        this.device.queue.writeBuffer(accumulators.stats, 0, this.statsInit)
        encoder.clearBuffer(accumulators.wave); encoder.clearBuffer(accumulators.vect); encoder.clearBuffer(accumulators.hist); encoder.clearBuffer(accumulators.diam)
        const bind = this.device.createBindGroup({layout: this.accumulate.getBindGroupLayout(0), entries: [
          {binding: 0, resource: {buffer: this.params}}, {binding: 1, resource: imported.texture},
          {binding: 2, resource: {buffer: accumulators.wave}}, {binding: 3, resource: {buffer: accumulators.vect}},
          {binding: 4, resource: {buffer: accumulators.hist}}, {binding: 5, resource: {buffer: accumulators.diam}},
          {binding: 6, resource: {buffer: accumulators.stats}},
        ]})
        const timestamps = this.query ? {querySet: this.query, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1} : undefined
        const pass = encoder.beginComputePass(timestamps ? {timestampWrites: timestamps} : {})
        pass.setPipeline(this.accumulate)
        pass.setBindGroup(0, bind)
        pass.dispatchWorkgroups(Math.ceil(area.columns / 16), Math.ceil(area.rows / 16))
        pass.end()
        accumulated = true
        if (this.falseContext && this.falsePipeline) this.encodeFalseColor(encoder, imported.texture, view.matrix)
      }
    }
    const liveCount = this.writeDraws(view, 0, this.samples, false)
    const referenceCount = view.showReference && this.reference ? this.writeDraws(view, 1, this.referenceSamples, true) : 0
    const target = this.context.getCurrentTexture().createView()
    const pass = encoder.beginRenderPass({colorAttachments: [{view: target, clearValue: {r: 0, g: 0, b: 0, a: 0}, loadOp: 'clear', storeOp: 'store'}]})
    pass.setPipeline(this.display!)
    const rects = drawSpecs(view.panels, view.config, 1, 1, false).map(spec => spec.rect)
    const draw = (bind: unknown, count: number, slot: number) => {
      for (let i = 0; i < count; i++) {
        const [x, y, w, h] = rects[i]!
        const cx = Math.max(0, Math.min(view.width - 1, x)), cy = Math.max(0, Math.min(view.height - 1, y))
        const cw = Math.max(1, Math.min(view.width - cx, w)), ch = Math.max(1, Math.min(view.height - cy, h))
        pass.setScissorRect(cx, cy, cw, ch)
        pass.setBindGroup(0, bind, [(slot * MAX_DRAWS + i) * DRAW_STRIDE])
        pass.draw(3)
      }
    }
    if (referenceCount && this.reference) draw(this.bindDisplayDynamic(this.reference), referenceCount, 1)
    draw(this.bindDisplayDynamic(accumulators), liveCount, 0)
    pass.end()
    const now = performance.now()
    const readStats = accumulated && !this.statsPending && now - this.lastStatsAt > 250
    if (readStats) encoder.copyBufferToBuffer(accumulators.stats, 0, this.statsRead, 0, 64)
    const readTime = accumulated && this.query && this.queryResolve && this.queryRead && !this.queryPending && now - this.lastQueryAt > 1000
    if (readTime) {
      encoder.resolveQuerySet(this.query!, 0, 2, this.queryResolve!, 0)
      encoder.copyBufferToBuffer(this.queryResolve!, 0, this.queryRead!, 0, 16)
    }
    this.device.queue.submit([encoder.finish()])
    imported?.close?.()
    if (readStats) {
      this.statsPending = true; this.lastStatsAt = now
      this.statsRead.mapAsync(MapMode.READ).then(() => {
        this.latestStats = statsFromGpu(new Uint32Array(this.statsRead.getMappedRange().slice(0)))
        this.statsRead.unmap()
      }).catch(() => {}).finally(() => { this.statsPending = false })
    }
    if (readTime) {
      this.queryPending = true; this.lastQueryAt = now
      this.queryRead!.mapAsync(MapMode.READ).then(() => {
        const t = new BigUint64Array(this.queryRead!.getMappedRange().slice(0))
        const ns = Number(t[1]! - t[0]!)
        if (ns > 0 && ns < 1e9) this.gpuMs = ns / 1e6
        this.queryRead!.unmap()
      }).catch(() => {}).finally(() => { this.queryPending = false })
    }
    this.cpuMs = performance.now() - started
    return accumulated || view.frozen
  }

  private bindDisplayDynamic(a: Accumulators) {
    // Layout explícito com offset dinâmico: criado uma vez e reaproveitado.
    return this.bindCache.get(a) ?? this.cacheBind(a)
  }
  private bindCache = new Map<Accumulators, unknown>()
  private dynamicLayout: unknown = null
  private cacheBind(a: Accumulators) {
    if (!this.dynamicLayout) this.buildDynamicDisplay()
    const group = this.device.createBindGroup({layout: this.dynamicLayout, entries: [
      {binding: 0, resource: {buffer: this.draws, size: 96}},
      {binding: 1, resource: {buffer: a.wave}}, {binding: 2, resource: {buffer: a.vect}},
      {binding: 3, resource: {buffer: a.hist}}, {binding: 4, resource: {buffer: a.diam}},
    ]})
    this.bindCache.set(a, group)
    return group
  }
  private buildDynamicDisplay() {
    const device = this.device as unknown as {createBindGroupLayout(d: unknown): unknown; createPipelineLayout(d: unknown): unknown}
    const FRAGMENT = 2
    this.dynamicLayout = device.createBindGroupLayout({entries: [
      {binding: 0, visibility: FRAGMENT, buffer: {type: 'uniform', hasDynamicOffset: true, minBindingSize: 96}},
      ...[1, 2, 3, 4].map(binding => ({binding, visibility: FRAGMENT, buffer: {type: 'read-only-storage'}})),
    ]})
    const module = this.device.createShaderModule({code: WGSL_DISPLAY, label: 'scopes-display'})
    const additive = {color: {srcFactor: 'one', dstFactor: 'one', operation: 'add'}, alpha: {srcFactor: 'one', dstFactor: 'one', operation: 'add'}}
    this.display = this.device.createRenderPipeline({layout: device.createPipelineLayout({bindGroupLayouts: [this.dynamicLayout]}), vertex: {module, entryPoint: 'vs'}, fragment: {module, entryPoint: 'fs', targets: [{format: this.format, blend: additive}]}, primitive: {topology: 'triangle-list'}})
  }

  private encodeFalseColor(encoder: ReturnType<GpuDevice['createCommandEncoder']>, texture: unknown, matrix: MatrixCode) {
    const canvas = this.falseCanvas!, context = this.falseContext!
    const box = canvas.getBoundingClientRect(), scale = Math.min(2, window.devicePixelRatio || 1)
    const w = Math.max(1, Math.round(box.width * scale)), h = Math.max(1, Math.round(box.height * scale))
    if (canvas.width !== w) canvas.width = w
    if (canvas.height !== h) canvas.height = h
    const [r, b, g] = kr(matrix)
    const data = new ArrayBuffer(32)
    new Float32Array(data, 0, 4).set([r, b, g, 0]); new Uint32Array(data, 16, 4).set([this.falseMode === 'gamut' ? 1 : 0, 0, 0, 0])
    this.device.queue.writeBuffer(this.falseParams, 0, data)
    const bind = this.device.createBindGroup({layout: this.falsePipeline.getBindGroupLayout(0), entries: [
      {binding: 0, resource: {buffer: this.falseParams}}, {binding: 1, resource: texture}, {binding: 2, resource: this.sampler},
    ]})
    const pass = encoder.beginRenderPass({colorAttachments: [{view: context.getCurrentTexture().createView(), clearValue: {r: 0, g: 0, b: 0, a: 0}, loadOp: 'clear', storeOp: 'store'}]})
    pass.setPipeline(this.falsePipeline); pass.setBindGroup(0, bind); pass.draw(3); pass.end()
  }

  setFalseColor(canvas: HTMLCanvasElement | null, mode: FalseColorMode) {
    this.falseMode = mode
    if (canvas === this.falseCanvas) return
    this.falseContext?.unconfigure()
    this.falseCanvas = canvas
    this.falseContext = null
    if (!canvas) return
    this.falseContext = canvas.getContext('webgpu') as unknown as GpuCanvasContext
    this.falseContext.configure({device: this.device, format: this.format, alphaMode: 'opaque'})
    if (!this.falsePipeline) {
      const module = this.device.createShaderModule({code: WGSL_FALSE_COLOR, label: 'scopes-false-color'})
      this.falsePipeline = this.device.createRenderPipeline({layout: 'auto', vertex: {module, entryPoint: 'vs'}, fragment: {module, entryPoint: 'fs', targets: [{format: this.format}]}, primitive: {topology: 'triangle-list'}})
    }
  }

  /**
   * Lê os acumuladores (só testes e bancada de desempenho: no uso normal
   * nada volta da GPU além das medições de 64 bytes).
   */
  async debugRead(): Promise<{wave: Uint32Array; vector: Uint32Array; hist: Uint32Array; diamond: Uint32Array; stats: ScopeStats} | null> {
    const live = this.live
    if (!live) return null
    const read = async (buffer: GpuBuffer) => {
      const staging = this.device.createBuffer({size: buffer.size, usage: BufferUsage.MAP_READ | BufferUsage.COPY_DST})
      const encoder = this.device.createCommandEncoder()
      encoder.copyBufferToBuffer(buffer, 0, staging, 0, buffer.size)
      this.device.queue.submit([encoder.finish()])
      await staging.mapAsync(MapMode.READ)
      const out = new Uint32Array(staging.getMappedRange().slice(0))
      staging.unmap(); staging.destroy()
      return out
    }
    const [wave, vector, hist, diamond, stats] = await Promise.all([read(live.wave), read(live.vect), read(live.hist), read(live.diam), read(live.stats)])
    return {wave, vector, hist, diamond, stats: statsFromGpu(stats)}
  }

  /** Espera a GPU terminar o que foi enviado (bancada de desempenho). */
  idle(): Promise<void> { return this.device.queue.onSubmittedWorkDone() }

  captureReference() {
    if (!this.live) return
    if (!this.reference || this.reference.sizes.some((v, i) => v !== this.live!.sizes[i])) {
      this.clearReference()
      const usage = BufferUsage.STORAGE | BufferUsage.COPY_DST | BufferUsage.COPY_SRC
      const make = (bytes: number) => this.device.createBuffer({size: bytes, usage, label: 'scopes-reference'})
      this.reference = {wave: make(this.live.wave.size), vect: make(this.live.vect.size), hist: make(this.live.hist.size), diam: make(this.live.diam.size), stats: make(64), sizes: [...this.live.sizes] as [number, number, number, number]}
    }
    const encoder = this.device.createCommandEncoder()
    for (const key of ['wave', 'vect', 'hist', 'diam', 'stats'] as const) encoder.copyBufferToBuffer(this.live[key], 0, this.reference[key], 0, this.live[key].size)
    this.device.queue.submit([encoder.finish()])
    this.referenceSamples = this.samples
  }

  clearReference() {
    if (this.reference) { this.bindCache.delete(this.reference); this.release(this.reference) }
    this.reference = null
  }
  hasReference() { return this.reference !== null }
  stats() { return this.latestStats }
  timing(): LiveTiming { return {gpuMs: this.gpuMs, cpuMs: this.cpuMs, sampledWidth: this.sampled.w, sampledHeight: this.sampled.h} }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    this.release(this.live); this.release(this.reference)
    this.params.destroy(); this.draws.destroy(); this.statsRead.destroy(); this.falseParams.destroy()
    this.query?.destroy(); this.queryResolve?.destroy(); this.queryRead?.destroy()
    try { this.context.unconfigure() } catch { /* canvas já removido */ }
    try { this.falseContext?.unconfigure() } catch { /* idem */ }
  }
}
