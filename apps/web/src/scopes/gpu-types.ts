/**
 * Tipos mínimos do WebGPU que os scopes usam.
 *
 * O TypeScript do repositório (5.9) ainda não traz WebGPU no lib.dom, e
 * adicionar `@webgpu/types` mexeria no lockfile que outros agentes também
 * editam. Estas declarações cobrem só o subconjunto usado em webgpu.ts; se
 * um dia o lib.dom trouxer os tipos, este arquivo pode sumir.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export type GpuBuffer = {size: number; destroy(): void; mapAsync(mode: number): Promise<void>; getMappedRange(): ArrayBuffer; unmap(): void; mapState?: string}
export type GpuQuerySet = {destroy(): void}
export type GpuTexture = {createView(): unknown; destroy(): void}
export type GpuCanvasContext = {configure(options: Record<string, unknown>): void; unconfigure(): void; getCurrentTexture(): GpuTexture}
export type GpuPass = {
  setPipeline(p: unknown): void
  setBindGroup(index: number, group: unknown, offsets?: number[]): void
  dispatchWorkgroups(x: number, y?: number, z?: number): void
  draw(count: number): void
  setViewport(x: number, y: number, w: number, h: number, min: number, max: number): void
  setScissorRect(x: number, y: number, w: number, h: number): void
  end(): void
}
export type GpuEncoder = {
  beginComputePass(desc?: Record<string, unknown>): GpuPass
  beginRenderPass(desc: Record<string, unknown>): GpuPass
  clearBuffer(buffer: GpuBuffer): void
  copyBufferToBuffer(a: GpuBuffer, ao: number, b: GpuBuffer, bo: number, size: number): void
  resolveQuerySet(q: GpuQuerySet, first: number, count: number, dst: GpuBuffer, offset: number): void
  finish(): unknown
}
export type GpuDevice = {
  features: Set<string>
  limits: Record<string, number>
  queue: {submit(cmds: unknown[]): void; writeBuffer(b: GpuBuffer, offset: number, data: BufferSource): void; onSubmittedWorkDone(): Promise<void>}
  lost: Promise<{reason: string; message: string}>
  createBuffer(desc: {size: number; usage: number; mappedAtCreation?: boolean; label?: string}): GpuBuffer
  createShaderModule(desc: {code: string; label?: string}): {getCompilationInfo?(): Promise<{messages: Array<{type: string; message: string; lineNum: number}>}>}
  createComputePipeline(desc: Record<string, unknown>): any
  createRenderPipeline(desc: Record<string, unknown>): any
  createBindGroup(desc: Record<string, unknown>): unknown
  createSampler(desc?: Record<string, unknown>): unknown
  createQuerySet(desc: {type: string; count: number}): GpuQuerySet
  importExternalTexture(desc: {source: unknown; colorSpace?: string}): unknown
  createCommandEncoder(): GpuEncoder
  pushErrorScope(filter: string): void
  popErrorScope(): Promise<{message: string} | null>
  destroy(): void
}
export type GpuAdapter = {features: Set<string>; limits: Record<string, number>; info?: {vendor?: string; architecture?: string; description?: string}; requestDevice(desc?: Record<string, unknown>): Promise<GpuDevice>}
export type Gpu = {requestAdapter(options?: Record<string, unknown>): Promise<GpuAdapter | null>; getPreferredCanvasFormat(): string}

export const BufferUsage = {MAP_READ: 0x0001, MAP_WRITE: 0x0002, COPY_SRC: 0x0004, COPY_DST: 0x0008, INDEX: 0x0010, VERTEX: 0x0020, UNIFORM: 0x0040, STORAGE: 0x0080, INDIRECT: 0x0100, QUERY_RESOLVE: 0x0200} as const
export const MapMode = {READ: 0x0001, WRITE: 0x0002} as const

export function navigatorGpu(): Gpu | null {
  return typeof navigator !== 'undefined' && 'gpu' in navigator ? (navigator as unknown as {gpu: Gpu}).gpu : null
}
