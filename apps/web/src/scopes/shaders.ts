/**
 * Shaders dos scopes ao vivo.
 *
 * A conta por pixel é transcrita de `apps/engine/scopes/src/lib.rs` na mesma
 * ordem de operações (`level_row`, `hist_bin`, `vector_cell`,
 * `diamond_cells`, `Stats::add`, `false_color`). O teste
 * `live-parity` (Playwright, WebGPU por software) compara o resultado com o
 * WASM sobre o mesmo quadro.
 */

/** Funções comuns (WGSL). */
const WGSL_COMMON = /* wgsl */`
struct Params {
  roi: vec4u,     // x0, y0, x1, y1 (pixels)
  grid: vec4u,    // wave_cols, wave_rows, channels, hist_bins
  sizes: vec4u,   // vector_size, diamond_size, stride, frame_width
  levels: vec4f,  // level_min, level_max, vector_scale, _
  coeff: vec4f,   // kr, kb, kg, _
}

fn ycc_from_rgb(c: vec3f, k: vec4f) -> vec3f {
  let y = k.x * c.r + k.z * c.g + k.y * c.b;
  return vec3f(y, (c.b - y) / (2.0 * (1.0 - k.y)), (c.r - y) / (2.0 * (1.0 - k.x)));
}

// Faixas de exposição (EXPOSURE_BANDS no crate).
fn false_color_exposure(p: vec3f) -> vec4f {
  let l = p.x * 100.0;
  if (l < -1.0) { return vec4f(148.0, 0.0, 211.0, 255.0) / 255.0; }
  if (l < 0.0) { return vec4f(96.0, 32.0, 160.0, 255.0) / 255.0; }
  if (l < 2.5) { return vec4f(0.0, 70.0, 255.0, 255.0) / 255.0; }
  if (l >= 38.0 && l < 44.0) { return vec4f(40.0, 200.0, 64.0, 255.0) / 255.0; }
  if (l >= 52.0 && l < 58.0) { return vec4f(255.0, 120.0, 170.0, 255.0) / 255.0; }
  if (l >= 97.0 && l < 100.0) { return vec4f(255.0, 230.0, 0.0, 255.0) / 255.0; }
  if (l >= 100.0 && l < 103.0) { return vec4f(255.0, 140.0, 0.0, 255.0) / 255.0; }
  if (l >= 103.0) { return vec4f(1.0, 0.0, 0.0, 1.0); }
  let g = floor(clamp(p.x * 0.85, 0.0, 1.0) * 255.0 + 0.5) / 255.0;
  return vec4f(g, g, g, 1.0);
}

fn false_color_gamut(p: vec3f, c: vec3f) -> vec4f {
  let l = p.x * 100.0;
  let lo = min(c.r, min(c.g, c.b)) * 100.0;
  let hi = max(c.r, max(c.g, c.b)) * 100.0;
  if (l < -1.0 || l > 103.0) { return vec4f(1.0, 0.0, 0.0, 1.0); }
  if (lo < -5.0 || hi > 105.0) { return vec4f(1.0, 0.0, 1.0, 1.0); }
  if (lo < -0.05 || hi > 100.05) { return vec4f(1.0, 200.0 / 255.0, 0.0, 1.0); }
  let g = floor(clamp(p.x * 0.6 * 0.85, 0.0, 1.0) * 255.0 + 0.5) / 255.0;
  return vec4f(g, g, g, 1.0);
}
`

/** Acumulação (compute) sobre a textura externa do `<video>`. */
export const WGSL_ACCUMULATE = WGSL_COMMON + /* wgsl */`
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var src: texture_external;
@group(0) @binding(2) var<storage, read_write> wave: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> vect: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> hist: array<atomic<u32>>;
@group(0) @binding(5) var<storage, read_write> diam: array<atomic<u32>>;
@group(0) @binding(6) var<storage, read_write> stats: array<atomic<u32>>;

const HIST_LOCAL: u32 = 1536u; // 6 canais × 256 faixas
var<workgroup> lhist: array<atomic<u32>, 1536>;
var<workgroup> lstat: array<atomic<u32>, 16>;

// f32 → u32 com a mesma ordem (para atomicMin/atomicMax).
fn key(v: f32) -> u32 {
  let b = bitcast<u32>(v);
  return select(b | 0x80000000u, ~b, (b & 0x80000000u) != 0u);
}

fn level_row(p: f32) -> u32 {
  let rows = P.grid.y;
  let scale = f32(rows - 1u) / (P.levels.y - P.levels.x);
  let r = floor((P.levels.y - p) * scale + 0.5);
  return u32(clamp(r, 0.0, f32(rows - 1u)));
}

fn hist_bin(p: f32) -> u32 {
  let bins = P.grid.w;
  let b = floor((p - P.levels.x) / (P.levels.y - P.levels.x) * f32(bins));
  return u32(clamp(b, 0.0, f32(bins - 1u)));
}

@compute @workgroup_size(16, 16)
fn accumulate(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) li: u32) {
  let local_hist = P.grid.w * 6u <= HIST_LOCAL;
  for (var i = li; i < HIST_LOCAL; i += 256u) { atomicStore(&lhist[i], 0u); }
  if (li < 16u) {
    let init = select(0u, 0xffffffffu, li == 1u || li == 6u);
    atomicStore(&lstat[li], init);
  }
  workgroupBarrier();

  let stride = max(P.sizes.z, 1u);
  let x = P.roi.x + gid.x * stride;
  let y = P.roi.y + gid.y * stride;
  if (x < P.roi.z && y < P.roi.w) {
    let rgb = textureLoad(src, vec2u(x, y)).rgb;
    let p = ycc_from_rgb(rgb, P.coeff);
    let roi_w = P.roi.z - P.roi.x;
    let column = (gid.x * stride) * P.grid.x / roi_w;
    let plane = P.grid.x * P.grid.y;
    var levels = array<f32, 6>(p.x * 100.0, (p.y + 0.5) * 100.0, (p.z + 0.5) * 100.0, rgb.r * 100.0, rgb.g * 100.0, rgb.b * 100.0);
    for (var ch = 0u; ch < 6u; ch++) {
      if ((P.grid.z & (1u << ch)) == 0u) { continue; }
      let row = level_row(levels[ch]);
      atomicAdd(&wave[ch * plane + row * P.grid.x + column], 1u);
      let bin = ch * P.grid.w + hist_bin(levels[ch]);
      if (local_hist) { atomicAdd(&lhist[bin], 1u); } else { atomicAdd(&hist[bin], 1u); }
    }
    // Vectorscope.
    let vs = P.sizes.x;
    let half = f32(vs - 1u) * 0.5;
    let radius = half / P.levels.z;
    let vx = floor(half + p.y * 2.0 * radius + 0.5);
    let vy = floor(half - p.z * 2.0 * radius + 0.5);
    if (vx >= 0.0 && vy >= 0.0 && vx < f32(vs) && vy < f32(vs)) {
      atomicAdd(&vect[u32(vy) * vs + u32(vx)], 1u);
    }
    // Diamante (Tektronix).
    let ds = P.sizes.y;
    let last = f32(ds - 1u);
    let span = 2.0 * 1.25;
    let upper_col = u32(clamp(floor((rgb.b - rgb.g + 1.25) / span * last + 0.5), 0.0, last));
    let lower_col = u32(clamp(floor((rgb.r - rgb.g + 1.25) / span * last + 0.5), 0.0, last));
    let upper_row = u32(clamp(floor((span - (rgb.b + rgb.g)) / span * last + 0.5), 0.0, last));
    let lower_row = ds + u32(clamp(floor((rgb.r + rgb.g) / span * last + 0.5), 0.0, last));
    atomicAdd(&diam[upper_row * ds + upper_col], 1u);
    atomicAdd(&diam[lower_row * ds + lower_col], 1u);
    // Medições (Stats::add).
    let luma = p.x * 100.0;
    let lo = min(rgb.r, min(rgb.g, rgb.b)) * 100.0;
    let hi = max(rgb.r, max(rgb.g, rgb.b)) * 100.0;
    let mag = sqrt(p.y * p.y + p.z * p.z) * 2.0;
    atomicAdd(&lstat[0], 1u);
    atomicMin(&lstat[1], key(luma));
    atomicMax(&lstat[2], key(luma));
    atomicAdd(&lstat[3], u32(clamp(floor((luma + 8.0) * 8.0 + 0.5), 0.0, 1000.0)));
    if (luma < -0.05) { atomicAdd(&lstat[4], 1u); }
    if (luma > 100.05) { atomicAdd(&lstat[5], 1u); }
    atomicMin(&lstat[6], key(lo));
    atomicMax(&lstat[7], key(hi));
    if (lo < -5.0 || hi > 105.0) { atomicAdd(&lstat[8], 1u); }
    if (lo < -0.05 || hi > 100.05) { atomicAdd(&lstat[9], 1u); }
    atomicMax(&lstat[10], key(mag));
    if (abs(p.y) > 0.5005 || abs(p.z) > 0.5005) { atomicAdd(&lstat[11], 1u); }
    if (luma < -1.0 || luma > 103.0) { atomicAdd(&lstat[12], 1u); }
  }
  workgroupBarrier();

  if (local_hist) {
    for (var i = li; i < P.grid.w * 6u; i += 256u) {
      let v = atomicLoad(&lhist[i]);
      if (v > 0u) { atomicAdd(&hist[i], v); }
    }
  }
  if (li == 0u) {
    let n = atomicLoad(&lstat[0]);
    if (n > 0u) {
      atomicAdd(&stats[0], n);
      atomicMin(&stats[1], atomicLoad(&lstat[1]));
      atomicMax(&stats[2], atomicLoad(&lstat[2]));
      atomicAdd(&stats[3], atomicLoad(&lstat[3]));
      atomicAdd(&stats[4], atomicLoad(&lstat[4]));
      atomicAdd(&stats[5], atomicLoad(&lstat[5]));
      atomicMin(&stats[6], atomicLoad(&lstat[6]));
      atomicMax(&stats[7], atomicLoad(&lstat[7]));
      atomicAdd(&stats[8], atomicLoad(&lstat[8]));
      atomicAdd(&stats[9], atomicLoad(&lstat[9]));
      atomicMax(&stats[10], atomicLoad(&lstat[10]));
      atomicAdd(&stats[11], atomicLoad(&lstat[11]));
      atomicAdd(&stats[12], atomicLoad(&lstat[12]));
    }
  }
}
`

/**
 * Mesma acumulação lendo uma textura comum (cópia do quadro com
 * `copyExternalImageToTexture`). Usada para `<img>` e quando a textura
 * externa não existe ou falha (o SwiftShader do CI derruba o processo da GPU
 * com texture_external; em GPU real o caminho padrão é o externo, sem cópia).
 */
export const WGSL_ACCUMULATE_COPY = WGSL_ACCUMULATE
  .replace('var src: texture_external;', 'var src: texture_2d<f32>;')
  .replace('textureLoad(src, vec2u(x, y)).rgb', 'textureLoad(src, vec2u(x, y), 0).rgb')

/** Exibição das densidades: um triângulo por painel, viewport = área do painel. */
export const WGSL_DISPLAY = /* wgsl */`
struct Draw {
  rect: vec4f,      // x, y, w, h (pixels do canvas, inteiros)
  kind: u32,        // 0 waveform, 1 vector, 2 histograma, 3 diamante
  channel: u32,
  cols: u32,
  rows: u32,
  offset: u32,
  samples: f32,
  gain: f32,
  reference: u32,
  levels: vec4f,    // level_min, level_max, _, _
  color: vec4f,
}
@group(0) @binding(0) var<uniform> D: Draw;
@group(0) @binding(1) var<storage, read> wave: array<u32>;
@group(0) @binding(2) var<storage, read> vect: array<u32>;
@group(0) @binding(3) var<storage, read> hist: array<u32>;
@group(0) @binding(4) var<storage, read> diam: array<u32>;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

fn intensity(count: f32, gain: f32) -> f32 {
  return select(0.0, min(1.0, 0.25 + 0.75 * (1.0 - exp(-count * gain))), count > 0.0);
}

fn tint(channel: u32, percent: f32, base: vec3f) -> vec3f {
  var lo = -5.0; var hi = 105.0;
  if (channel == 0u) { lo = -1.0; hi = 103.0; }
  let chroma = channel == 1u || channel == 2u;
  if (chroma) { lo = -0.05; hi = 100.05; }
  if (percent < lo || percent > hi) { return vec3f(1.0, 0.27, 0.23); }
  if (!chroma && (percent < -0.05 || percent > 100.05)) { return vec3f(1.0, 0.75, 0.24); }
  return base;
}

fn cell(kind: u32, index: u32) -> u32 {
  if (kind == 0u) { return wave[index]; }
  if (kind == 1u) { return vect[index]; }
  return diam[index];
}

var<private> CH_COLORS: array<vec3f, 6> = array<vec3f, 6>(vec3f(0.55, 1.0, 0.68), vec3f(0.5, 0.7, 1.0), vec3f(1.0, 0.5, 0.56), vec3f(1.0, 0.38, 0.38), vec3f(0.38, 1.0, 0.52), vec3f(0.45, 0.65, 1.0));

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let w = u32(D.rect.z);
  let h = u32(D.rect.w);
  let px = u32(floor(pos.x - D.rect.x));
  let py = u32(floor(pos.y - D.rect.y));
  if (px >= w || py >= h) { discard; }
  if (D.kind == 2u) {
    // Histograma (escala log), Y por cima de R, G, B.
    let b0 = px * D.cols / w;
    let b1 = max(b0 + 1u, (px + 1u) * D.cols / w);
    var out = vec3f(0.0);
    var order = array<u32, 4>(3u, 4u, 5u, 0u);
    for (var k = 0u; k < 4u; k++) {
      let ch = order[k];
      var sum = 0u;
      for (var b = b0; b < min(b1, b0 + 8u); b++) { sum += hist[ch * D.cols + b]; }
      let avg = f32(sum) / f32(min(b1, b0 + 8u) - b0);
      let height = select(0.0, log2(1.0 + avg) / log2(1.0 + max(1.0, D.samples)), avg > 0.0);
      let top = u32(round(f32(h) * (1.0 - height)));
      if (py >= top) {
        var color = select(CH_COLORS[ch], D.color.rgb, D.reference == 1u);
        var alpha = select(select(0.35, 0.55, ch == 0u), 0.5, D.reference == 1u);
        if (py == top) { alpha = 1.0; }
        out += color * alpha;
      }
    }
    if (all(out == vec3f(0.0))) { discard; }
    return vec4f(min(out, vec3f(1.0)), 1.0);
  }
  let c0 = px * D.cols / w;
  let c1 = max(c0 + 1u, (px + 1u) * D.cols / w);
  let r0 = py * D.rows / h;
  let r1 = max(r0 + 1u, (py + 1u) * D.rows / h);
  let ce = min(c1, c0 + 8u);
  let re = min(r1, r0 + 8u);
  var sum = 0u;
  for (var r = r0; r < re; r++) {
    for (var c = c0; c < ce; c++) { sum += cell(D.kind, D.offset + r * D.cols + c); }
  }
  if (sum == 0u) { discard; }
  let n = f32((re - r0) * (ce - c0));
  let a = intensity(f32(sum) / n, D.gain);
  var color = D.color.rgb;
  if (D.kind == 0u && D.reference == 0u) {
    let row = min(D.rows - 1u, (r0 + r1 - 1u) / 2u);
    let percent = D.levels.y - f32(row) * (D.levels.y - D.levels.x) / f32(D.rows - 1u);
    color = tint(D.channel, percent, color);
  }
  return vec4f(color * a, a);
}
`

/** Falsa cor sobre o vídeo. */
export const WGSL_FALSE_COLOR = WGSL_COMMON + /* wgsl */`
struct FalseParams { coeff: vec4f, mode: vec4u }
@group(0) @binding(0) var<uniform> F: FalseParams;
@group(0) @binding(1) var src: texture_external;
@group(0) @binding(2) var samp: sampler;

struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
@vertex
fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var o: VOut;
  o.pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2f(p.x, 1.0 - p.y);
  return o;
}
@fragment
fn fs(v: VOut) -> @location(0) vec4f {
  let rgb = textureSampleBaseClampToEdge(src, samp, v.uv).rgb;
  let p = ycc_from_rgb(rgb, F.coeff);
  if (F.mode.x == 1u) { return false_color_gamut(p, rgb); }
  return false_color_exposure(p);
}
`

/** Falsa cor lendo a cópia do quadro (imagens, ou sem textura externa). */
export const WGSL_FALSE_COLOR_COPY = WGSL_FALSE_COLOR
  .replace('var src: texture_external;', 'var src: texture_2d<f32>;')
  .replace('textureSampleBaseClampToEdge(src, samp, v.uv)', 'textureSampleLevel(src, samp, v.uv, 0.0)')
