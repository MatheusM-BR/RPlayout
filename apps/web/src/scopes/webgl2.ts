/**
 * Scopes ao vivo em WebGL2 (fallback quando não há WebGPU).
 *
 * Sem compute nem atômicos: cada amostra vira um ponto (`gl_VertexID` →
 * `texelFetch` do quadro) desenhado com blending aditivo numa textura float
 * que faz o papel do histograma de densidade. A conta por pixel é a mesma do
 * crate (`level_row`, `hist_bin`, `vector_cell`, `diamond_cells`). Como cada
 * amostra custa um ponto por scope, o padrão é amostrar 1 em cada 2 pixels em
 * cada eixo acima de 1280 px de largura (ver `defaultStride`).
 *
 * As medições numéricas saem do histograma (lido a 2 Hz, 6 KB): mínimo/máximo
 * com a resolução de uma faixa (0,46%) e frações abaixo de 0%/acima de 100%.
 * A leitura é assíncrona (`HistogramReadback`): `readPixels` para um PBO,
 * `fenceSync` e, nos quadros seguintes, `clientWaitSync(…, 0)` sem esperar;
 * só quando a cerca já passou os 6 KB são copiados com `getBufferSubData`.
 * Nada no quadro espera a GPU terminar (antes: `readPixels` síncrono, o
 * "GPU stall" do driver). O resultado é o mesmo histograma, um ou dois
 * quadros depois (a 2 Hz, invisível).
 */
import {drawSpecs, sampledArea, type LiveScopes, type LiveSource, type LiveTiming, type LiveView} from './live.js'
import {MATRIX, type FalseColorMode, type MatrixCode, type ScopeConfig, type ScopeStats} from './wasm.js'

const GLSL_COMMON = /* glsl */`#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D u_src;
uniform ivec4 u_roi;      // x0, y0, x1, y1
uniform ivec4 u_grid;     // cols, rows, channels, bins
uniform ivec4 u_sizes;    // vector, diamond, stride, sampled columns
uniform vec4 u_levels;    // min, max, vector scale, _
uniform vec4 u_coeff;     // kr, kb, kg, _
vec3 ycc_from_rgb(vec3 c) {
  float y = u_coeff.x * c.r + u_coeff.z * c.g + u_coeff.y * c.b;
  return vec3(y, (c.b - y) / (2.0 * (1.0 - u_coeff.y)), (c.r - y) / (2.0 * (1.0 - u_coeff.x)));
}
vec3 sample_rgb(out bool ok) {
  int id = gl_VertexID;
  int sx = id % u_sizes.w;
  int sy = id / u_sizes.w;
  ivec2 p = ivec2(u_roi.x + sx * u_sizes.z, u_roi.y + sy * u_sizes.z);
  ok = p.x < u_roi.z && p.y < u_roi.w;
  return texelFetch(u_src, p, 0).rgb;
}
int column_of() {
  int id = gl_VertexID;
  int sx = id % u_sizes.w;
  return (sx * u_sizes.z) * u_grid.x / (u_roi.z - u_roi.x);
}
// Centro da célula (col, row) numa textura cols×rows em clip space.
vec4 cell(int col, int row, int cols, int rows) {
  return vec4((float(col) + 0.5) / float(cols) * 2.0 - 1.0, (float(row) + 0.5) / float(rows) * 2.0 - 1.0, 0.0, 1.0);
}
const vec4 NOWHERE = vec4(2.0, 2.0, 2.0, 1.0);
`

/** Waveform: instância = canal (0..5). Linha da textura = canal·rows + linha. */
const VS_WAVE = GLSL_COMMON + /* glsl */`
float level_of(int ch, vec3 rgb, vec3 p) {
  if (ch == 0) return p.x * 100.0;
  if (ch == 1) return (p.y + 0.5) * 100.0;
  if (ch == 2) return (p.z + 0.5) * 100.0;
  if (ch == 3) return rgb.r * 100.0;
  if (ch == 4) return rgb.g * 100.0;
  return rgb.b * 100.0;
}
void main() {
  bool ok; vec3 rgb = sample_rgb(ok);
  int ch = gl_InstanceID;
  gl_PointSize = 1.0;
  if (!ok || (u_grid.z & (1 << ch)) == 0) { gl_Position = NOWHERE; return; }
  vec3 p = ycc_from_rgb(rgb);
  float lv = level_of(ch, rgb, p);
  float scale = float(u_grid.y - 1) / (u_levels.y - u_levels.x);
  int row = int(clamp(floor((u_levels.y - lv) * scale + 0.5), 0.0, float(u_grid.y - 1)));
  gl_Position = cell(column_of(), ch * u_grid.y + row, u_grid.x, u_grid.y * 6);
}`

const VS_HIST = GLSL_COMMON + /* glsl */`
void main() {
  bool ok; vec3 rgb = sample_rgb(ok);
  int ch = gl_InstanceID;
  gl_PointSize = 1.0;
  if (!ok) { gl_Position = NOWHERE; return; }
  vec3 p = ycc_from_rgb(rgb);
  float lv = ch == 0 ? p.x * 100.0 : ch == 1 ? (p.y + 0.5) * 100.0 : ch == 2 ? (p.z + 0.5) * 100.0 : ch == 3 ? rgb.r * 100.0 : ch == 4 ? rgb.g * 100.0 : rgb.b * 100.0;
  int bins = u_grid.w;
  int bin = int(clamp(floor((lv - u_levels.x) / (u_levels.y - u_levels.x) * float(bins)), 0.0, float(bins - 1)));
  gl_Position = cell(bin, ch, bins, 6);
}`

const VS_VECTOR = GLSL_COMMON + /* glsl */`
void main() {
  bool ok; vec3 rgb = sample_rgb(ok);
  gl_PointSize = 1.0;
  vec3 p = ycc_from_rgb(rgb);
  int vs = u_sizes.x;
  float half_ = float(vs - 1) * 0.5;
  float radius = half_ / u_levels.z;
  float vx = floor(half_ + p.y * 2.0 * radius + 0.5);
  float vy = floor(half_ - p.z * 2.0 * radius + 0.5);
  if (!ok || vx < 0.0 || vy < 0.0 || vx >= float(vs) || vy >= float(vs)) { gl_Position = NOWHERE; return; }
  gl_Position = cell(int(vx), int(vy), vs, vs);
}`

const VS_DIAMOND = GLSL_COMMON + /* glsl */`
void main() {
  bool ok; vec3 rgb = sample_rgb(ok);
  gl_PointSize = 1.0;
  if (!ok) { gl_Position = NOWHERE; return; }
  int ds = u_sizes.y;
  float last = float(ds - 1);
  float span = 2.5;
  int col; int row;
  if (gl_InstanceID == 0) {
    col = int(clamp(floor((rgb.b - rgb.g + 1.25) / span * last + 0.5), 0.0, last));
    row = int(clamp(floor((span - (rgb.b + rgb.g)) / span * last + 0.5), 0.0, last));
  } else {
    col = int(clamp(floor((rgb.r - rgb.g + 1.25) / span * last + 0.5), 0.0, last));
    row = ds + int(clamp(floor((rgb.r + rgb.g) / span * last + 0.5), 0.0, last));
  }
  gl_Position = cell(col, row, ds, ds * 2);
}`

const FS_ONE = /* glsl */`#version 300 es
precision highp float;
out vec4 color;
void main() { color = vec4(1.0, 0.0, 0.0, 1.0); }`

/** Exibição: mesma regra de brilho/cor de WGSL_DISPLAY. */
const VS_QUAD = /* glsl */`#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

const FS_DISPLAY = /* glsl */`#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D u_tex;
uniform vec4 u_rect;       // x, y (a partir do topo), w, h
uniform float u_canvas_h;
uniform ivec4 u_draw;      // kind, channel, cols, rows
uniform int u_offset_row;  // primeira linha da textura (canal × rows)
uniform vec4 u_misc;       // samples, gain, reference, _
uniform vec4 u_levels;
uniform vec3 u_color;
out vec4 outColor;
const vec3 CH[6] = vec3[6](vec3(0.55, 1.0, 0.68), vec3(0.5, 0.7, 1.0), vec3(1.0, 0.5, 0.56), vec3(1.0, 0.38, 0.38), vec3(0.38, 1.0, 0.52), vec3(0.45, 0.65, 1.0));
float intensity(float count, float gain) { return count > 0.0 ? min(1.0, 0.25 + 0.75 * (1.0 - exp(-count * gain))) : 0.0; }
vec3 tint(int channel, float percent, vec3 base) {
  float lo = -5.0; float hi = 105.0;
  bool chroma = channel == 1 || channel == 2;
  if (channel == 0) { lo = -1.0; hi = 103.0; }
  if (chroma) { lo = -0.05; hi = 100.05; }
  if (percent < lo || percent > hi) return vec3(1.0, 0.27, 0.23);
  if (!chroma && (percent < -0.05 || percent > 100.05)) return vec3(1.0, 0.75, 0.24);
  return base;
}
void main() {
  int w = int(u_rect.z); int h = int(u_rect.w);
  int px = int(floor(gl_FragCoord.x - u_rect.x));
  int py = int(floor((u_canvas_h - gl_FragCoord.y) - u_rect.y));
  if (px < 0 || py < 0 || px >= w || py >= h) discard;
  int kind = u_draw.x; int cols = u_draw.z; int rows = u_draw.w;
  bool reference = u_misc.z > 0.5;
  if (kind == 2) {
    int b0 = px * cols / w;
    int b1 = max(b0 + 1, (px + 1) * cols / w);
    int be = min(b1, b0 + 8);
    vec3 acc = vec3(0.0);
    int order[4] = int[4](3, 4, 5, 0);
    for (int k = 0; k < 4; k++) {
      int ch = order[k];
      float sum = 0.0;
      for (int b = b0; b < be; b++) sum += texelFetch(u_tex, ivec2(b, ch), 0).r;
      float avg = sum / float(be - b0);
      float height = avg > 0.0 ? log2(1.0 + avg) / log2(1.0 + max(1.0, u_misc.x)) : 0.0;
      int top = int(round(float(h) * (1.0 - height)));
      if (py >= top) {
        vec3 c = reference ? u_color : CH[ch];
        float a = reference ? 0.5 : (ch == 0 ? 0.55 : 0.35);
        if (py == top) a = 1.0;
        acc += c * a;
      }
    }
    if (acc == vec3(0.0)) discard;
    outColor = vec4(min(acc, vec3(1.0)), 1.0);
    return;
  }
  int c0 = px * cols / w; int c1 = max(c0 + 1, (px + 1) * cols / w);
  int r0 = py * rows / h; int r1 = max(r0 + 1, (py + 1) * rows / h);
  int ce = min(c1, c0 + 8); int re = min(r1, r0 + 8);
  float sum = 0.0;
  for (int r = r0; r < re; r++) for (int c = c0; c < ce; c++) sum += texelFetch(u_tex, ivec2(c, u_offset_row + r), 0).r;
  if (sum <= 0.0) discard;
  float a = intensity(sum / float((re - r0) * (ce - c0)), u_misc.y);
  vec3 color = u_color;
  if (kind == 0 && !reference) {
    int row = min(rows - 1, (r0 + r1 - 1) / 2);
    float percent = u_levels.y - float(row) * (u_levels.y - u_levels.x) / float(rows - 1);
    color = tint(u_draw.y, percent, color);
  }
  outColor = vec4(color * a, a);
}`

const FS_FALSE = /* glsl */`#version 300 es
precision highp float;
uniform highp sampler2D u_src;
uniform vec4 u_coeff;
uniform int u_mode;
uniform vec2 u_size;
out vec4 outColor;
void main() {
  vec2 uv = vec2(gl_FragCoord.x / u_size.x, 1.0 - gl_FragCoord.y / u_size.y);
  vec3 c = texture(u_src, uv).rgb;
  float y = u_coeff.x * c.r + u_coeff.z * c.g + u_coeff.y * c.b;
  float l = y * 100.0;
  if (u_mode == 1) {
    float lo = min(c.r, min(c.g, c.b)) * 100.0, hi = max(c.r, max(c.g, c.b)) * 100.0;
    if (l < -1.0 || l > 103.0) { outColor = vec4(1, 0, 0, 1); return; }
    if (lo < -5.0 || hi > 105.0) { outColor = vec4(1, 0, 1, 1); return; }
    if (lo < -0.05 || hi > 100.05) { outColor = vec4(1, 200.0 / 255.0, 0, 1); return; }
    float g = floor(clamp(y * 0.6 * 0.85, 0.0, 1.0) * 255.0 + 0.5) / 255.0;
    outColor = vec4(g, g, g, 1); return;
  }
  if (l < -1.0) outColor = vec4(148, 0, 211, 255) / 255.0;
  else if (l < 0.0) outColor = vec4(96, 32, 160, 255) / 255.0;
  else if (l < 2.5) outColor = vec4(0, 70, 255, 255) / 255.0;
  else if (l >= 38.0 && l < 44.0) outColor = vec4(40, 200, 64, 255) / 255.0;
  else if (l >= 52.0 && l < 58.0) outColor = vec4(255, 120, 170, 255) / 255.0;
  else if (l >= 97.0 && l < 100.0) outColor = vec4(255, 230, 0, 255) / 255.0;
  else if (l >= 100.0 && l < 103.0) outColor = vec4(255, 140, 0, 255) / 255.0;
  else if (l >= 103.0) outColor = vec4(1, 0, 0, 1);
  else { float g = floor(clamp(y * 0.85, 0.0, 1.0) * 255.0 + 0.5) / 255.0; outColor = vec4(g, g, g, 1); }
}`

type GL = WebGL2RenderingContext

/**
 * Medições a partir do histograma lido (RGBA float, `bins × 6`, canal no R).
 * Função pura: a mesma conta para a leitura assíncrona e para a síncrona
 * antiga, então o resultado é idêntico (teste em `webgl2.test.ts`).
 */
export function histogramStats(c: ScopeConfig, data: Float32Array): ScopeStats {
  const bins = (ch: number) => Array.from({length: c.histBins}, (_, b) => data[(ch * c.histBins + b) * 4]!)
  const level = (b: number) => c.levelMin + (b + 0.5) * (c.levelMax - c.levelMin) / c.histBins
  const y = bins(0)
  const count = y.reduce((a, v) => a + v, 0)
  const first = y.findIndex(v => v > 0), last = y.length - 1 - [...y].reverse().findIndex(v => v > 0)
  let below = 0, above = 0, sum = 0, r103 = 0
  y.forEach((v, b) => { const l = level(b); sum += v * l; if (l < -0.05) below += v; if (l > 100.05) above += v; if (l < -1 || l > 103) r103 += v })
  let rgbMin = Infinity, rgbMax = -Infinity
  for (const ch of [3, 4, 5]) { const h = bins(ch); const lo = h.findIndex(v => v > 0), hi = h.length - 1 - [...h].reverse().findIndex(v => v > 0); if (lo >= 0) { rgbMin = Math.min(rgbMin, level(lo)); rgbMax = Math.max(rgbMax, level(hi)) } }
  const lumaMin = first >= 0 ? level(first) : 0, lumaMax = first >= 0 ? level(last) : 0
  return {
    count, lumaMin, lumaMax, lumaAvg: count ? sum / count : 0, belowBlack: below, aboveWhite: above, lumaR103: r103,
    rgbMin: Number.isFinite(rgbMin) ? rgbMin : 0, rgbMax: Number.isFinite(rgbMax) ? rgbMax : 0,
    gamutR103: Number.NaN, gamutStrict: Number.NaN, chromaMax: Number.NaN, chromaIllegal: Number.NaN,
    lumaIllegal: count > 0 && (lumaMin < -1 || lumaMax > 103), gamutIllegal: false, chromaIllegalAny: false,
  }
}

/** Subconjunto do WebGL2 que a leitura assíncrona usa (permite teste sem GPU). */
export type ReadbackGl = Pick<GL,
  'createBuffer' | 'deleteBuffer' | 'bindBuffer' | 'bufferData' | 'bindFramebuffer' | 'readPixels' | 'fenceSync' | 'clientWaitSync'
  | 'deleteSync' | 'flush' | 'getBufferSubData' | 'PIXEL_PACK_BUFFER' | 'STREAM_READ' | 'FRAMEBUFFER' | 'READ_FRAMEBUFFER' | 'RGBA' | 'FLOAT'
  | 'SYNC_GPU_COMMANDS_COMPLETE' | 'ALREADY_SIGNALED' | 'CONDITION_SATISFIED' | 'WAIT_FAILED'>

/**
 * Leitura do histograma sem parar a GPU: `readPixels` com PBO ligado (a cópia
 * fica na fila da GPU e a chamada volta na hora), uma cerca, e uma consulta
 * `clientWaitSync(cerca, 0, 0)` por quadro, que nunca espera. Só uma leitura
 * pendente por vez; se a configuração muda, a pendente é descartada.
 */
export class HistogramReadback {
  private pbo: WebGLBuffer | null = null
  private size = 0
  private sync: WebGLSync | null = null
  private config: ScopeConfig | null = null
  /** Quantas consultas devolveram "ainda não" (bancada). */
  notReady = 0

  get pending(): boolean { return this.sync !== null }

  /** Encomenda a leitura do histograma de `fbo`. `false` se já há uma pendente. */
  request(gl: ReadbackGl, fbo: WebGLFramebuffer, c: ScopeConfig): boolean {
    if (this.sync) return false
    const bytes = c.histBins * 6 * 4 * 4
    if (!this.pbo || this.size !== bytes) {
      if (this.pbo) gl.deleteBuffer(this.pbo)
      this.pbo = gl.createBuffer()
      this.size = bytes
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo)
      gl.bufferData(gl.PIXEL_PACK_BUFFER, bytes, gl.STREAM_READ)
    } else gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo)
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fbo)
    gl.readPixels(0, 0, c.histBins, 6, gl.RGBA, gl.FLOAT, 0)
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
    this.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
    // Sem flush a cerca pode nunca chegar à GPU (e o clientWaitSync com
    // tempo zero nunca a veria passar).
    gl.flush()
    this.config = c
    return this.sync !== null
  }

  /** Sem esperar: devolve o histograma se a cerca já passou, senão `null`. */
  poll(gl: ReadbackGl): {config: ScopeConfig; data: Float32Array} | null {
    if (!this.sync || !this.pbo || !this.config) return null
    const status = gl.clientWaitSync(this.sync, 0, 0)
    if (status === gl.WAIT_FAILED) { this.cancel(gl); return null }
    if (status !== gl.ALREADY_SIGNALED && status !== gl.CONDITION_SATISFIED) { this.notReady++; return null }
    const data = new Float32Array(this.size / 4)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo)
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, data)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
    const config = this.config
    gl.deleteSync(this.sync); this.sync = null; this.config = null
    return {config, data}
  }

  cancel(gl: ReadbackGl) {
    if (this.sync) gl.deleteSync(this.sync)
    this.sync = null; this.config = null
  }

  dispose(gl: ReadbackGl) {
    this.cancel(gl)
    if (this.pbo) gl.deleteBuffer(this.pbo)
    this.pbo = null; this.size = 0
  }
}
interface Target {texture: WebGLTexture; fbo: WebGLFramebuffer; width: number; height: number}
interface Targets {wave: Target; hist: Target; vector: Target; diamond: Target; key: string}

function compile(gl: GL, vs: string, fs: string): WebGLProgram {
  const program = gl.createProgram()!
  for (const [type, source] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source); gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`GLSL: ${gl.getShaderInfoLog(shader)}`)
    gl.attachShader(program, shader)
  }
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`GLSL link: ${gl.getProgramInfoLog(program)}`)
  return program
}

function coeffs(matrix: MatrixCode): [number, number, number, number] {
  const [r, b] = matrix === MATRIX.bt2020 ? [0.2627, 0.0593] : [0.2126, 0.0722]
  return [r, b, 1 - r - b, 0]
}

/** Passo padrão do WebGL2: 1:1 até 1280 px de largura, 1 em 2 acima disso. */
export function defaultStride(width: number): number {
  return width > 1280 ? 2 : 1
}

export class WebGl2Scopes implements LiveScopes {
  readonly kind = 'webgl2' as const
  private readonly gl: GL
  private readonly programs: {wave: WebGLProgram; hist: WebGLProgram; vector: WebGLProgram; diamond: WebGLProgram; display: WebGLProgram}
  private readonly source: WebGLTexture
  private readonly floatFormat: number
  private readonly vao: WebGLVertexArrayObject
  private targets: Targets | null = null
  private reference: Targets | null = null
  private referenceSamples = 0
  private samples = 0
  private sampled = {w: 0, h: 0}
  private cpuMs = 0
  private gpuMs: number | null = null
  private timer: {ext: {TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number}; query: WebGLQuery | null} | null = null
  private lastStatsAt = 0
  private latestStats: ScopeStats | null = null
  private lastConfig: ScopeConfig | null = null
  private readonly readback = new HistogramReadback()
  private readMode: 'async' | 'sync' = 'async'
  private falseCanvas: HTMLCanvasElement | null = null
  private falseMode: FalseColorMode = 'exposure'
  private falseGl: {gl: GL; program: WebGLProgram; texture: WebGLTexture} | null = null
  private destroyed = false

  private constructor(private readonly canvas: HTMLCanvasElement, gl: GL) {
    this.gl = gl
    const floatBlend = gl.getExtension('EXT_float_blend')
    this.floatFormat = floatBlend ? gl.R32F : gl.R16F
    this.programs = {
      wave: compile(gl, VS_WAVE, FS_ONE), hist: compile(gl, VS_HIST, FS_ONE), vector: compile(gl, VS_VECTOR, FS_ONE),
      diamond: compile(gl, VS_DIAMOND, FS_ONE), display: compile(gl, VS_QUAD, FS_DISPLAY),
    }
    this.source = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.source)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    this.vao = gl.createVertexArray()!
    const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2') as {TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number} | null
    if (timer) this.timer = {ext: timer, query: null}
  }

  static create(canvas: HTMLCanvasElement): WebGl2Scopes | null {
    try {
      const gl = canvas.getContext('webgl2', {premultipliedAlpha: true, alpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'low-power'})
      if (!gl || !gl.getExtension('EXT_color_buffer_float')) return null
      return new WebGl2Scopes(canvas, gl)
    } catch (error) {
      console.warn('[scopes] WebGL2 recusado:', error)
      return null
    }
  }

  private target(width: number, height: number): Target {
    const gl = this.gl
    const texture = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texStorage2D(gl.TEXTURE_2D, 1, this.floatFormat, width, height)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    const fbo = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return {texture, fbo, width, height}
  }

  private allocate(c: ScopeConfig): Targets {
    return {
      wave: this.target(c.waveColumns, c.waveRows * 6), hist: this.target(c.histBins, 6),
      vector: this.target(c.vectorSize, c.vectorSize), diamond: this.target(c.diamondSize, c.diamondSize * 2),
      key: `${c.waveColumns}x${c.waveRows}:${c.histBins}:${c.vectorSize}:${c.diamondSize}`,
    }
  }

  private release(t: Targets | null) {
    if (!t) return
    for (const target of [t.wave, t.hist, t.vector, t.diamond]) { this.gl.deleteTexture(target.texture); this.gl.deleteFramebuffer(target.fbo) }
  }

  private ensure(c: ScopeConfig): Targets {
    const key = `${c.waveColumns}x${c.waveRows}:${c.histBins}:${c.vectorSize}:${c.diamondSize}`
    if (this.targets?.key === key) return this.targets
    this.readback.cancel(this.gl)
    this.release(this.targets); this.clearReference()
    this.targets = this.allocate(c)
    return this.targets
  }

  private uniforms(program: WebGLProgram, c: ScopeConfig, roi: [number, number, number, number], stride: number, columns: number, matrix: MatrixCode) {
    const gl = this.gl
    gl.useProgram(program)
    gl.uniform1i(gl.getUniformLocation(program, 'u_src'), 0)
    gl.uniform4i(gl.getUniformLocation(program, 'u_roi'), ...roi)
    gl.uniform4i(gl.getUniformLocation(program, 'u_grid'), c.waveColumns, c.waveRows, c.channels, c.histBins)
    gl.uniform4i(gl.getUniformLocation(program, 'u_sizes'), c.vectorSize, c.diamondSize, stride, columns)
    gl.uniform4f(gl.getUniformLocation(program, 'u_levels'), c.levelMin, c.levelMax, c.vectorScale, 0)
    gl.uniform4f(gl.getUniformLocation(program, 'u_coeff'), ...coeffs(matrix))
  }

  private accumulate(source: LiveSource, view: LiveView, t: Targets): boolean {
    const gl = this.gl
    const width = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth
    const height = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight
    if (width < 1 || height < 1) return false
    if (source instanceof HTMLVideoElement && source.readyState < 2) return false
    if (source instanceof HTMLImageElement && !source.complete) return false
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.source)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source) } catch { return false }
    const stride = Math.max(1, Math.floor(view.stride))
    const area = sampledArea(view.config, width, height, stride)
    this.samples = area.samples; this.sampled = {w: area.columns, h: area.rows}
    gl.bindVertexArray(this.vao)
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.blendEquation(gl.FUNC_ADD)
    gl.clearColor(0, 0, 0, 0)
    const pass = (program: WebGLProgram, target: Target, instances: number) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo)
      gl.viewport(0, 0, target.width, target.height)
      gl.clear(gl.COLOR_BUFFER_BIT)
      this.uniforms(program, view.config, area.roi, stride, area.columns, view.matrix)
      gl.drawArraysInstanced(gl.POINTS, 0, area.samples, instances)
    }
    pass(this.programs.wave, t.wave, 6)
    pass(this.programs.hist, t.hist, 6)
    pass(this.programs.vector, t.vector, 1)
    pass(this.programs.diamond, t.diamond, 2)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return true
  }

  private draw(view: LiveView, t: Targets, samples: number, reference: boolean) {
    const gl = this.gl, program = this.programs.display
    gl.useProgram(program)
    const loc = (name: string) => gl.getUniformLocation(program, name)
    gl.uniform1i(loc('u_tex'), 1)
    gl.uniform1f(loc('u_canvas_h'), view.height)
    gl.activeTexture(gl.TEXTURE1)
    for (const spec of drawSpecs(view.panels, view.config, samples, view.intensity, reference)) {
      const target = spec.kind === 0 ? t.wave : spec.kind === 1 ? t.vector : spec.kind === 2 ? t.hist : t.diamond
      gl.bindTexture(gl.TEXTURE_2D, target.texture)
      const [x, y, w, h] = spec.rect
      gl.enable(gl.SCISSOR_TEST)
      gl.scissor(x, view.height - y - h, w, h)
      gl.uniform4f(loc('u_rect'), x, y, w, h)
      gl.uniform4i(loc('u_draw'), spec.kind, spec.channel, spec.cols, spec.rows)
      gl.uniform1i(loc('u_offset_row'), spec.kind === 0 ? spec.channel * view.config.waveRows : 0)
      gl.uniform4f(loc('u_misc'), spec.samples, spec.gain, reference ? 1 : 0, 0)
      gl.uniform4f(loc('u_levels'), spec.levels[0], spec.levels[1], 0, 0)
      gl.uniform3f(loc('u_color'), ...spec.color)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    gl.disable(gl.SCISSOR_TEST)
    gl.activeTexture(gl.TEXTURE0)
  }

  render(source: LiveSource | null, view: LiveView): boolean {
    if (this.destroyed || this.gl.isContextLost()) return false
    const started = performance.now()
    const gl = this.gl
    if (this.canvas.width !== view.width) this.canvas.width = view.width
    if (this.canvas.height !== view.height) this.canvas.height = view.height
    const t = this.ensure(view.config)
    let accumulated = false
    const timing = this.timer && !this.timer.query
    if (timing) { this.timer!.query = gl.createQuery(); gl.beginQuery(this.timer!.ext.TIME_ELAPSED_EXT, this.timer!.query!) }
    if (!view.frozen && source) accumulated = this.accumulate(source, view, t)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, view.width, view.height)
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT)
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE)
    gl.bindVertexArray(this.vao)
    if (view.showReference && this.reference) this.draw(view, this.reference, this.referenceSamples, true)
    this.draw(view, t, this.samples, false)
    if (timing) gl.endQuery(this.timer!.ext.TIME_ELAPSED_EXT)
    this.pollTimer()
    if (accumulated && source) this.renderFalseColor(source, view.matrix)
    const now = performance.now()
    if (accumulated) this.lastConfig = view.config
    if (this.readMode === 'sync') {
      if (accumulated && now - this.lastStatsAt > 500) { this.lastStatsAt = now; this.latestStats = this.readStatsSync(view.config, t) }
    } else {
      // Primeiro colhe o que já ficou pronto (sem esperar); depois, a 2 Hz,
      // encomenda a próxima leitura do histograma deste quadro.
      this.pollStats()
      if (accumulated && now - this.lastStatsAt > 500 && this.readback.request(this.gl, t.hist.fbo, view.config)) this.lastStatsAt = now
    }
    this.cpuMs = performance.now() - started
    return accumulated || view.frozen
  }

  private pollTimer() {
    const timer = this.timer
    if (!timer?.query) return
    const gl = this.gl
    if (!gl.getQueryParameter(timer.query, gl.QUERY_RESULT_AVAILABLE)) return
    if (!gl.getParameter(timer.ext.GPU_DISJOINT_EXT)) this.gpuMs = gl.getQueryParameter(timer.query, gl.QUERY_RESULT) / 1e6
    gl.deleteQuery(timer.query); timer.query = null
  }

  /** Leitura síncrona antiga (só bancada/paridade): bloqueia até a GPU terminar. */
  private readStatsSync(c: ScopeConfig, t: Targets): ScopeStats {
    const gl = this.gl
    const data = new Float32Array(c.histBins * 6 * 4)
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.hist.fbo)
    gl.readPixels(0, 0, c.histBins, 6, gl.RGBA, gl.FLOAT, data)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return histogramStats(c, data)
  }

  /** Bancada: `sync` reproduz o caminho antigo (readPixels síncrono) para medir antes × depois. */
  debugSetReadback(mode: 'async' | 'sync') { this.readMode = mode }

  /** Bancada/testes: espera (sem bloquear a thread) a leitura pendente chegar. */
  async settleStats(timeoutMs = 5000): Promise<ScopeStats | null> {
    const until = performance.now() + timeoutMs
    while (this.readback.pending && performance.now() < until) {
      await new Promise(resolve => setTimeout(resolve, 4))
      this.pollStats()
    }
    return this.latestStats
  }

  /** Bancada: há leitura do histograma esperando a cerca. */
  debugReadPending(): boolean { return this.readback.pending }

  /** Bancada: medições do histograma atual pelo caminho síncrono (referência de paridade). */
  debugStatsSync(): ScopeStats | null {
    return this.targets && this.lastConfig ? this.readStatsSync(this.lastConfig, this.targets) : null
  }

  private pollStats() {
    const ready = this.readback.poll(this.gl)
    if (ready) this.latestStats = histogramStats(ready.config, ready.data)
  }

  private renderFalseColor(source: LiveSource, matrix: MatrixCode) {
    const canvas = this.falseCanvas
    if (!canvas) return
    if (!this.falseGl) {
      const gl = canvas.getContext('webgl2', {premultipliedAlpha: false, alpha: false, antialias: false})
      if (!gl) return
      const program = compile(gl, VS_QUAD, FS_FALSE)
      const texture = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      this.falseGl = {gl, program, texture}
    }
    const {gl, program, texture} = this.falseGl
    const box = canvas.getBoundingClientRect(), scale = Math.min(2, window.devicePixelRatio || 1)
    const w = Math.max(1, Math.round(box.width * scale)), h = Math.max(1, Math.round(box.height * scale))
    if (canvas.width !== w) canvas.width = w
    if (canvas.height !== h) canvas.height = h
    gl.viewport(0, 0, w, h)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source) } catch { return }
    gl.useProgram(program)
    gl.uniform1i(gl.getUniformLocation(program, 'u_src'), 0)
    gl.uniform4f(gl.getUniformLocation(program, 'u_coeff'), ...coeffs(matrix))
    gl.uniform1i(gl.getUniformLocation(program, 'u_mode'), this.falseMode === 'gamut' ? 1 : 0)
    gl.uniform2f(gl.getUniformLocation(program, 'u_size'), w, h)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  setFalseColor(canvas: HTMLCanvasElement | null, mode: FalseColorMode) {
    this.falseMode = mode
    if (canvas === this.falseCanvas) return
    this.falseCanvas = canvas
    this.falseGl = null
  }

  captureReference() {
    const live = this.targets
    if (!live) return
    if (!this.reference || this.reference.key !== live.key) {
      this.clearReference()
      this.reference = {wave: this.target(live.wave.width, live.wave.height), hist: this.target(live.hist.width, live.hist.height), vector: this.target(live.vector.width, live.vector.height), diamond: this.target(live.diamond.width, live.diamond.height), key: live.key}
    }
    const gl = this.gl
    for (const name of ['wave', 'hist', 'vector', 'diamond'] as const) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, live[name].fbo)
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.reference[name].fbo)
      gl.blitFramebuffer(0, 0, live[name].width, live[name].height, 0, 0, live[name].width, live[name].height, gl.COLOR_BUFFER_BIT, gl.NEAREST)
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null)
    this.referenceSamples = this.samples
  }

  clearReference() { this.release(this.reference); this.reference = null }
  hasReference() { return this.reference !== null }
  stats() { return this.latestStats }
  timing(): LiveTiming { return {gpuMs: this.gpuMs, cpuMs: this.cpuMs, sampledWidth: this.sampled.w, sampledHeight: this.sampled.h} }

  /** Lê os acumuladores (testes/bancada). */
  debugRead(): {wave: Float32Array; vector: Float32Array; hist: Float32Array; diamond: Float32Array} | null {
    const t = this.targets
    if (!t) return null
    const gl = this.gl
    const read = (target: Target) => {
      const data = new Float32Array(target.width * target.height * 4)
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo)
      gl.readPixels(0, 0, target.width, target.height, gl.RGBA, gl.FLOAT, data)
      // Linha 0 da textura = célula 0 (clip y = −1): mesma ordem do crate.
      return data.filter((_, i) => i % 4 === 0)
    }
    const out = {wave: read(t.wave), vector: read(t.vector), hist: read(t.hist), diamond: read(t.diamond)}
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return out
  }

  finish() { this.gl.finish() }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    this.release(this.targets); this.release(this.reference)
    const gl = this.gl
    this.readback.dispose(gl)
    for (const program of Object.values(this.programs)) gl.deleteProgram(program)
    gl.deleteTexture(this.source); gl.deleteVertexArray(this.vao)
  }
}

