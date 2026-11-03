/**
 * Gratículos e leitura por cursor, desenhados num canvas 2D por cima da
 * densidade (que vem da GPU ou da CPU). Só redesenha quando a geometria, a
 * unidade, o zoom ou o cursor mudam -- nunca por quadro de vídeo.
 */
import {DIAMOND_EXTENT, MATRIX, type MatrixCode, type ScopeChannel, type ScopeConfig, type ScopeStats} from './wasm.js'
import {diamondToXY, formatLevel, histLevelToX, levelTicks, levelToY, vectorGeometry, vectorToXY, xyToDiamond, xyToVector, yToLevel, type LevelUnit, type Panel} from './layout.js'

type Ctx = CanvasRenderingContext2D

const GRID = 'rgba(148, 163, 184, 0.22)'
const GRID_STRONG = 'rgba(203, 213, 225, 0.6)'
const LABEL = 'rgba(203, 213, 225, 0.85)'
const LIMIT = 'rgba(255, 90, 80, 0.8)'

export interface GraticuleOptions {
  unit: LevelUnit
  config: ScopeConfig
  matrix: MatrixCode
  /** Alvos do vectorscope: 75%, 100% ou ambos. */
  targets: '75' | '100' | 'both'
  skinLine: boolean
  scale: number
  /** Opacidade do gratículo (0..1). */
  graticule: number
}

const KR_KB: Record<number, [number, number]> = {[MATRIX.bt709]: [0.2126, 0.0722], [MATRIX.bt2020]: [0.2627, 0.0593]}

export interface TargetPoint {name: string; cb: number; cr: number}
/** Alvos Yl, Cy, G, Mg, R, B (mesma conta de `vector_targets` no crate). */
export function targetsFor(matrix: MatrixCode, level: number): TargetPoint[] {
  const [kr, kb] = KR_KB[matrix] ?? KR_KB[MATRIX.bt709]!, kg = 1 - kr - kb
  const bars: Array<[string, number, number, number]> = [['Yl', 1, 1, 0], ['Cy', 0, 1, 1], ['G', 0, 1, 0], ['Mg', 1, 0, 1], ['R', 1, 0, 0], ['B', 0, 0, 1]]
  return bars.map(([name, r, g, b]) => {
    const y = (kr * r + kg * g + kb * b) * level
    return {name, cb: (b * level - y) / (2 * (1 - kb)), cr: (r * level - y) / (2 * (1 - kr))}
  })
}

const TARGET_COLORS: Record<string, string> = {R: '#ff5a6e', Mg: '#f472ff', B: '#6aa8ff', Cy: '#4ff0ff', G: '#5dff8f', Yl: '#ffe14d'}
/** Linha de tom de pele dos vectorscopes de componente (~123° a partir de +Cb). */
export const SKIN_ANGLE_DEG = 123
/** Caixas em volta dos alvos: interna ±3°/±5%, externa ±10°/±20%. */
export const TARGET_BOX = {inner: {phase: 3, gain: 0.05}, outer: {phase: 10, gain: 0.2}} as const

const CHANNEL_LIMITS: Record<ScopeChannel, [number, number]> = {Y: [-1, 103], Cb: [0, 100], Cr: [0, 100], R: [-5, 105], G: [-5, 105], B: [-5, 105]}
export const CHANNEL_COLORS: Record<ScopeChannel, string> = {Y: '#e8f5ec', Cb: '#7fb2ff', Cr: '#ff7f8f', R: '#ff6b6b', G: '#5dff8f', B: '#7fb2ff'}

function font(ctx: Ctx, px: number, scale: number, bold = false) {
  ctx.font = `${bold ? 'bold ' : ''}${Math.round(px * scale)}px ui-monospace, "JetBrains Mono", monospace`
}

function line(ctx: Ctx, x0: number, y0: number, x1: number, y1: number) {
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke()
}

function drawWave(ctx: Ctx, panel: Panel, o: GraticuleOptions) {
  const {plot, frame} = panel, s = o.scale, channel = panel.channel ?? 'Y'
  const y = (p: number) => Math.round(levelToY(p, plot, o.config)) + 0.5
  // Faixas fora do nominal tingidas.
  const [low, high] = CHANNEL_LIMITS[channel]
  ctx.fillStyle = 'rgba(255, 59, 48, 0.06)'
  const top100 = Math.max(plot.y, Math.min(plot.y + plot.h, y(100))), bottom0 = Math.max(plot.y, Math.min(plot.y + plot.h, y(0)))
  ctx.fillRect(plot.x, plot.y, plot.w, top100 - plot.y)
  ctx.fillRect(plot.x, bottom0, plot.w, plot.y + plot.h - bottom0)
  ctx.lineWidth = 1
  for (const tick of levelTicks(o.config, o.unit, channel)) {
    const ty = y(tick.percent)
    if (ty < plot.y - 1 || ty > plot.y + plot.h + 1) continue
    ctx.strokeStyle = tick.strong ? GRID_STRONG : GRID
    ctx.setLineDash(tick.strong ? [] : [2 * s, 3 * s])
    line(ctx, plot.x, ty, plot.x + plot.w, ty)
    if (panel.firstInGroup !== false) {
      ctx.setLineDash([])
      ctx.fillStyle = tick.strong ? '#e2e8f0' : LABEL
      font(ctx, 10, s); ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
      ctx.fillText(tick.label, frame.x + Math.round(36 * s), ty)
    }
  }
  ctx.setLineDash([4 * s, 3 * s]); ctx.strokeStyle = LIMIT
  for (const limit of [low, high]) { const ly = y(limit); if (ly >= plot.y && ly <= plot.y + plot.h) line(ctx, plot.x, ly, plot.x + plot.w, ly) }
  ctx.setLineDash([])
  // Divisões verticais a cada 10% da largura.
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.09)'
  for (let step = 1; step < 10; step++) { const x = Math.round(plot.x + plot.w * step / 10) + 0.5; line(ctx, x, plot.y, x, plot.y + plot.h) }
  ctx.strokeStyle = GRID_STRONG; ctx.strokeRect(plot.x + 0.5, plot.y + 0.5, plot.w - 1, plot.h - 1)
  font(ctx, 10, s, true); ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.fillStyle = CHANNEL_COLORS[channel]
  ctx.fillText(channel === 'Y' ? "Y'" : channel === 'Cb' || channel === 'Cr' ? channel : `${channel}'`, plot.x + plot.w - 4 * s, plot.y + 3 * s)
  if (panel.firstInGroup !== false) {
    font(ctx, 9, s); ctx.textAlign = 'left'; ctx.fillStyle = LABEL; ctx.textBaseline = 'top'
    ctx.fillText(o.unit, frame.x + 2 * s, plot.y + 1 * s)
    const zoom = 118 / (o.config.levelMax - o.config.levelMin)
    if (zoom > 1.05) { ctx.fillStyle = '#ffd166'; ctx.fillText(`×${zoom.toFixed(zoom < 10 ? 1 : 0)}`, frame.x + 2 * s, plot.y + 12 * s) }
  }
}

function polarBox(ctx: Ctx, cx: number, cy: number, radius: number, cb: number, cr: number, box: {phase: number; gain: number}) {
  const angle = Math.atan2(cr, cb) * 180 / Math.PI, magnitude = Math.hypot(cb, cr) * 2
  const inner = radius * magnitude * (1 - box.gain), outer = radius * magnitude * (1 + box.gain)
  const start = -(angle + box.phase) * Math.PI / 180, end = -(angle - box.phase) * Math.PI / 180
  ctx.beginPath(); ctx.arc(cx, cy, inner, start, end); ctx.arc(cx, cy, outer, end, start, true); ctx.closePath(); ctx.stroke()
}

function drawVector(ctx: Ctx, panel: Panel, o: GraticuleOptions) {
  const {plot} = panel, s = o.scale
  const {cx, cy, radius} = vectorGeometry(plot, o.config)
  ctx.save()
  ctx.beginPath(); ctx.rect(plot.x, plot.y, plot.w, plot.h); ctx.clip()
  ctx.lineWidth = 1; ctx.strokeStyle = GRID
  line(ctx, cx - radius * 1.3, cy, cx + radius * 1.3, cy); line(ctx, cx, cy - radius * 1.3, cx, cy + radius * 1.3)
  ctx.strokeStyle = GRID_STRONG
  ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke()
  ctx.strokeStyle = GRID; ctx.setLineDash([2 * s, 3 * s])
  ctx.beginPath(); ctx.arc(cx, cy, radius * 0.75, 0, Math.PI * 2); ctx.stroke()
  ctx.setLineDash([])
  for (let degree = 0; degree < 360; degree += 10) {
    const a = -degree * Math.PI / 180, long = degree % 30 === 0
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * radius * (long ? 0.95 : 0.975), cy + Math.sin(a) * radius * (long ? 0.95 : 0.975)); ctx.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius); ctx.stroke()
  }
  if (o.skinLine) {
    const a = -SKIN_ANGLE_DEG * Math.PI / 180
    ctx.strokeStyle = 'rgba(255, 176, 64, 0.85)'; ctx.setLineDash([4 * s, 3 * s])
    line(ctx, cx, cy, cx + Math.cos(a) * radius * 1.2, cy + Math.sin(a) * radius * 1.2)
    ctx.setLineDash([])
    font(ctx, 9, s); ctx.fillStyle = 'rgba(255, 176, 64, 0.95)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText('pele', cx + Math.cos(a) * radius * 1.12 + 12 * s, cy + Math.sin(a) * radius * 1.12)
  }
  const t75 = targetsFor(o.matrix, 0.75), t100 = targetsFor(o.matrix, 1)
  t75.forEach((target, index) => {
    const color = TARGET_COLORS[target.name]!, full = t100[index]!
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, s)
    if (o.targets !== '100') {
      polarBox(ctx, cx, cy, radius, target.cb, target.cr, TARGET_BOX.inner)
      ctx.globalAlpha = 0.45; ctx.lineWidth = 1; ctx.setLineDash([2 * s, 2 * s])
      polarBox(ctx, cx, cy, radius, target.cb, target.cr, TARGET_BOX.outer)
      ctx.setLineDash([]); ctx.globalAlpha = 1
    }
    const p100 = vectorToXY(full.cb, full.cr, plot, o.config)
    if (o.targets !== '75') {
      ctx.lineWidth = Math.max(1, s)
      polarBox(ctx, cx, cy, radius, full.cb, full.cr, TARGET_BOX.inner)
    }
    const arm = 4 * s
    line(ctx, p100.x - arm, p100.y, p100.x + arm, p100.y); line(ctx, p100.x, p100.y - arm, p100.x, p100.y + arm)
    const label = vectorToXY(full.cb * 1.12, full.cr * 1.12, plot, o.config)
    font(ctx, 10, s, true); ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(target.name, label.x, label.y)
  })
  ctx.restore()
  font(ctx, 9, s); ctx.fillStyle = LABEL; ctx.textAlign = 'left'; ctx.textBaseline = 'top'
  ctx.fillText(o.matrix === MATRIX.bt2020 ? 'BT.2020' : 'BT.709', plot.x + 3 * s, plot.y + 3 * s)
  const zoom = 1.3 / o.config.vectorScale
  if (zoom > 1.05) { ctx.fillStyle = '#ffd166'; ctx.fillText(`×${zoom.toFixed(1)}`, plot.x + 3 * s, plot.y + 14 * s) }
}

function drawHist(ctx: Ctx, panel: Panel, o: GraticuleOptions) {
  const {plot, frame} = panel, s = o.scale
  ctx.lineWidth = 1
  for (const tick of levelTicks(o.config, o.unit)) {
    const x = Math.round(histLevelToX(tick.percent, plot, o.config)) + 0.5
    if (x < plot.x || x > plot.x + plot.w) continue
    ctx.strokeStyle = tick.strong ? GRID_STRONG : GRID; ctx.setLineDash(tick.strong ? [] : [2 * s, 3 * s])
    line(ctx, x, plot.y, x, plot.y + plot.h)
    ctx.setLineDash([]); font(ctx, 9, s); ctx.fillStyle = LABEL; ctx.textAlign = 'center'; ctx.textBaseline = 'top'
    ctx.fillText(tick.label, x, plot.y + plot.h + 3 * s)
  }
  ctx.strokeStyle = GRID_STRONG; ctx.strokeRect(plot.x + 0.5, plot.y + 0.5, plot.w - 1, plot.h - 1)
  font(ctx, 9, s); ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillStyle = LABEL
  ctx.fillText('log', frame.x + 2 * s, plot.y + 1 * s)
  ;(['Y', 'R', 'G', 'B'] as const).forEach((channel, i) => { ctx.fillStyle = CHANNEL_COLORS[channel]; ctx.fillText(channel === 'Y' ? "Y'" : `${channel}'`, frame.x + 2 * s, plot.y + (14 + i * 11) * s) })
}

function drawDiamond(ctx: Ctx, panel: Panel, o: GraticuleOptions) {
  const {plot} = panel, s = o.scale, size = o.config.diamondSize
  const outline = (upper: boolean, inflate: number) => {
    const pts: Array<[number, number]> = [[0, -inflate * 2], [1 + inflate, 1], [0, 2 + inflate * 2], [-1 - inflate, 1]]
    ctx.beginPath()
    pts.forEach(([d, sum], i) => { const p = diamondToXY(d, sum, upper, plot, size); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y) })
    ctx.closePath(); ctx.stroke()
  }
  ctx.lineWidth = Math.max(1, s)
  for (const upper of [true, false]) {
    ctx.strokeStyle = GRID_STRONG; outline(upper, 0)
    ctx.strokeStyle = LIMIT; ctx.setLineDash([3 * s, 3 * s]); ctx.lineWidth = 1; outline(upper, 0.05); ctx.setLineDash([])
  }
  ctx.strokeStyle = GRID
  const c = diamondToXY(0, 0, true, plot, size)
  line(ctx, plot.x, c.y, plot.x + plot.w, c.y)
  font(ctx, 9, s, true); ctx.textBaseline = 'middle'
  const up = diamondToXY(-DIAMOND_EXTENT + 0.1, 1.9, true, plot, size), down = diamondToXY(-DIAMOND_EXTENT + 0.1, 1.9, false, plot, size)
  ctx.textAlign = 'left'
  ctx.fillStyle = CHANNEL_COLORS.B; ctx.fillText("B'", up.x, up.y)
  ctx.fillStyle = CHANNEL_COLORS.G; ctx.fillText("G'", up.x, up.y + 12 * s)
  ctx.fillStyle = CHANNEL_COLORS.R; ctx.fillText("R'", down.x, down.y)
  ctx.fillStyle = CHANNEL_COLORS.G; ctx.fillText("G'", down.x, down.y - 12 * s)
}

/** Desenha os gratículos de todos os painéis. */
export function drawGraticules(ctx: Ctx, panels: Panel[], o: GraticuleOptions) {
  ctx.save()
  ctx.globalAlpha = Math.max(0.15, Math.min(1, o.graticule))
  for (const panel of panels) {
    if (panel.kind === 'wave') drawWave(ctx, panel, o)
    else if (panel.kind === 'vector') drawVector(ctx, panel, o)
    else if (panel.kind === 'hist') drawHist(ctx, panel, o)
    else drawDiamond(ctx, panel, o)
  }
  ctx.restore()
}

/** Leitura do ponto sob o cursor, em texto, para o painel atingido. */
export function cursorReadout(panel: Panel, x: number, y: number, o: Pick<GraticuleOptions, 'unit' | 'config' | 'matrix'>): string[] {
  if (panel.kind === 'wave') {
    const level = yToLevel(y, panel.plot, o.config), channel = panel.channel ?? 'Y'
    const position = (x - panel.plot.x) / panel.plot.w
    const mv = Math.round((channel === 'Cb' || channel === 'Cr' ? level - 50 : level) * 7)
    return [`${channel}: ${formatLevel(level, '%', channel)} · ${mv} mV`, `x ${(position * 100).toFixed(0)}% da largura`]
  }
  if (panel.kind === 'vector') {
    const {cb, cr} = xyToVector(x, y, panel.plot, o.config)
    const angle = ((Math.atan2(cr, cb) * 180 / Math.PI) + 360) % 360, magnitude = Math.hypot(cb, cr) * 2
    const near = [...targetsFor(o.matrix, 0.75).map(t => ({...t, level: 75})), ...targetsFor(o.matrix, 1).map(t => ({...t, level: 100}))]
      .map(t => ({t, d: Math.hypot(t.cb - cb, t.cr - cr)})).sort((a, b) => a.d - b.d)[0]!
    const tAngle = ((Math.atan2(near.t.cr, near.t.cb) * 180 / Math.PI) + 360) % 360, tMag = Math.hypot(near.t.cb, near.t.cr) * 2
    const phase = ((angle - tAngle + 540) % 360) - 180
    return [`Cb ${cb.toFixed(3)} · Cr ${cr.toFixed(3)}`, `${angle.toFixed(1)}° · ${(magnitude * 100).toFixed(1)}%`,
      `${near.t.name} ${near.t.level}%: ${phase >= 0 ? '+' : ''}${phase.toFixed(1)}° · ${((magnitude / tMag - 1) * 100).toFixed(1)}%`]
  }
  if (panel.kind === 'hist') {
    const level = o.config.levelMin + (x - panel.plot.x) / panel.plot.w * (o.config.levelMax - o.config.levelMin)
    return [`nível ${formatLevel(level, o.unit)}`]
  }
  const d = xyToDiamond(x, y, panel.plot, o.config.diamondSize)
  const [a, b] = d.upper ? ['B', 'G'] : ['R', 'G']
  const first = (d.sum + d.difference) / 2, second = (d.sum - d.difference) / 2
  return [`${a}' ${(first * 100).toFixed(1)}% · ${b}' ${(second * 100).toFixed(1)}%`]
}

/** Caixa de leitura com cruz no ponto do cursor. */
export function drawCursor(ctx: Ctx, panel: Panel, x: number, y: number, lines: string[], scale: number) {
  ctx.save()
  ctx.strokeStyle = 'rgba(255, 209, 102, 0.8)'; ctx.lineWidth = 1; ctx.setLineDash([3 * scale, 3 * scale])
  line(ctx, panel.plot.x, Math.round(y) + 0.5, panel.plot.x + panel.plot.w, Math.round(y) + 0.5)
  if (panel.kind !== 'wave') line(ctx, Math.round(x) + 0.5, panel.plot.y, Math.round(x) + 0.5, panel.plot.y + panel.plot.h)
  ctx.setLineDash([])
  font(ctx, 10, scale)
  const width = Math.max(...lines.map(l => ctx.measureText(l).width)) + 10 * scale, height = lines.length * 13 * scale + 6 * scale
  let bx = x + 10 * scale, by = y + 10 * scale
  if (bx + width > panel.plot.x + panel.plot.w) bx = x - width - 10 * scale
  if (by + height > panel.plot.y + panel.plot.h) by = y - height - 10 * scale
  ctx.fillStyle = 'rgba(5, 7, 14, 0.88)'; ctx.fillRect(bx, by, width, height)
  ctx.strokeStyle = 'rgba(255, 209, 102, 0.6)'; ctx.strokeRect(bx + 0.5, by + 0.5, width - 1, height - 1)
  ctx.fillStyle = '#ffd166'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'
  lines.forEach((text, i) => ctx.fillText(text, bx + 5 * scale, by + 3 * scale + i * 13 * scale))
  ctx.restore()
}

/** Resumo numérico (mesmo para qualquer backend). */
export function statsSummary(stats: ScopeStats): {belowFraction: number; aboveFraction: number; gamutFraction: number} {
  const n = Math.max(1, stats.count)
  return {belowFraction: stats.belowBlack / n, aboveFraction: stats.aboveWhite / n, gamutFraction: stats.gamutR103 / n}
}
