import {EBU_R103, SKIN_TONE_ANGLE_DEG, TARGET_TOLERANCE, VECTOR_FULL_SCALE, WAVEFORM_RANGE, percentToMillivolts, vectorDensity, vectorTargets, waveformDensity, type QcScopeSample} from './qc-colorimetry.js'

/**
 * Desenho dos scopes em canvas. A matemática fica em qc-colorimetry (testada);
 * aqui só se converte densidade em brilho e se desenha o gratículo.
 */

type Ctx = CanvasRenderingContext2D
export type LevelUnit = '%' | 'mV'

const BACKGROUND = '#05070e'
const GRID = 'rgba(148, 163, 184, 0.22)'
const GRID_STRONG = 'rgba(203, 213, 225, 0.55)'
const LABEL = 'rgba(203, 213, 225, 0.85)'

/** Brilho de uma célula: qualquer amostra aparece (defeito de 1 pixel), cheio satura. */
function intensity(count: number, gain: number): number {
  return count ? Math.min(1, 0.28 + 0.72 * (1 - Math.exp(-count * gain))) : 0
}

function paintDensity(ctx: Ctx, density: Uint32Array, columns: number, rows: number, x: number, y: number, width: number, height: number, gain: number, color: (row: number) => [number, number, number]) {
  if (typeof document === 'undefined') return
  const image = new ImageData(columns, rows)
  for (let row = 0; row < rows; row++) {
    const [r, g, b] = color(row)
    for (let column = 0; column < columns; column++) {
      const value = intensity(density[row * columns + column]!, gain)
      if (!value) continue
      const offset = (row * columns + column) * 4
      image.data[offset] = r; image.data[offset + 1] = g; image.data[offset + 2] = b; image.data[offset + 3] = Math.round(value * 255)
    }
  }
  const buffer = document.createElement('canvas')
  buffer.width = columns; buffer.height = rows
  buffer.getContext('2d')!.putImageData(image, 0, 0)
  ctx.save()
  ctx.imageSmoothingEnabled = false
  ctx.globalCompositeOperation = 'lighter'
  ctx.drawImage(buffer, x, y, width, height)
  ctx.restore()
}

export interface WaveformLayout {left: number; top: number; width: number; height: number}
export function waveformLayout(width: number, height: number, scale: number): WaveformLayout {
  const left = Math.round(38 * scale), top = Math.round(6 * scale)
  return {left, top, width: Math.max(10, width - left - Math.round(6 * scale)), height: Math.max(10, height - top - Math.round(6 * scale))}
}

function levelY(percent: number, layout: WaveformLayout): number {
  return layout.top + (WAVEFORM_RANGE.max - percent) / (WAVEFORM_RANGE.max - WAVEFORM_RANGE.min) * layout.height
}

function drawLevelGraticule(ctx: Ctx, layout: WaveformLayout, unit: LevelUnit, scale: number, limits: {low: number; high: number}, panels = 1) {
  const right = layout.left + layout.width
  ctx.save()
  ctx.font = `${Math.round(10 * scale)}px ui-monospace, monospace`
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
  // Faixas ilegais tingidas: o que cai aqui está fora da faixa nominal.
  ctx.fillStyle = 'rgba(255, 59, 48, 0.07)'
  ctx.fillRect(layout.left, layout.top, layout.width, levelY(100, layout) - layout.top)
  ctx.fillRect(layout.left, levelY(0, layout), layout.width, layout.top + layout.height - levelY(0, layout))
  for (let percent = 0; percent <= 100; percent += 10) {
    const y = Math.round(levelY(percent, layout)) + 0.5
    const strong = percent === 0 || percent === 100
    ctx.strokeStyle = strong ? GRID_STRONG : GRID
    ctx.lineWidth = strong ? Math.max(1, scale) : 1
    ctx.setLineDash(strong || percent === 50 ? [] : [2 * scale, 3 * scale])
    ctx.beginPath(); ctx.moveTo(layout.left, y); ctx.lineTo(right, y); ctx.stroke()
    ctx.fillStyle = strong ? '#e2e8f0' : LABEL
    ctx.fillText(unit === 'mV' ? String(Math.round(percentToMillivolts(percent))) : String(percent), layout.left - 4 * scale, y)
  }
  // Limites EBU R103 (tracejado vermelho).
  ctx.setLineDash([4 * scale, 3 * scale]); ctx.strokeStyle = 'rgba(255, 90, 80, 0.75)'; ctx.lineWidth = 1
  for (const percent of [limits.low, limits.high]) {
    const y = Math.round(levelY(percent, layout)) + 0.5
    ctx.beginPath(); ctx.moveTo(layout.left, y); ctx.lineTo(right, y); ctx.stroke()
  }
  ctx.setLineDash([])
  ctx.fillStyle = 'rgba(255, 120, 110, 0.9)'
  ctx.textAlign = 'left'
  ctx.fillText(unit === 'mV' ? `${Math.round(percentToMillivolts(limits.high))} mV` : `${limits.high}%`, layout.left + 3 * scale, levelY(limits.high, layout) - 6 * scale)
  ctx.fillText(unit === 'mV' ? `${Math.round(percentToMillivolts(limits.low))} mV` : `${limits.low}%`, layout.left + 3 * scale, levelY(limits.low, layout) + 7 * scale)
  ctx.textAlign = 'right'; ctx.fillStyle = LABEL
  ctx.fillText(unit === 'mV' ? 'mV' : '%', layout.left - 4 * scale, layout.top + 5 * scale)
  // Divisões verticais (10% da largura) e separação dos painéis do parade.
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.10)'
  for (let step = 1; step < 10 * panels; step++) {
    const x = Math.round(layout.left + layout.width * step / (10 * panels)) + 0.5
    ctx.beginPath(); ctx.moveTo(x, layout.top); ctx.lineTo(x, layout.top + layout.height); ctx.stroke()
  }
  if (panels > 1) {
    ctx.strokeStyle = GRID_STRONG
    for (let panel = 1; panel < panels; panel++) {
      const x = Math.round(layout.left + layout.width * panel / panels) + 0.5
      ctx.beginPath(); ctx.moveTo(x, layout.top); ctx.lineTo(x, layout.top + layout.height); ctx.stroke()
    }
  }
  ctx.restore()
}

function levelColor(rows: number, base: [number, number, number], low: number, high: number): (row: number) => [number, number, number] {
  return row => {
    const percent = WAVEFORM_RANGE.max - row / (rows - 1) * (WAVEFORM_RANGE.max - WAVEFORM_RANGE.min)
    if (percent < low || percent > high) return [255, 70, 60]
    if (percent < -0.05 || percent > 100.05) return [255, 190, 60]
    return base
  }
}

/** Waveform de luma Y' em % (ou mV), faixa −8..110% com 0/100 destacados. */
export function drawWaveform(ctx: Ctx, width: number, height: number, sample: QcScopeSample | null, unit: LevelUnit, scale = 1) {
  ctx.fillStyle = BACKGROUND; ctx.fillRect(0, 0, width, height)
  const layout = waveformLayout(width, height, scale)
  if (sample) {
    const columns = Math.max(1, Math.min(Math.round(layout.width), sample.width)), rows = Math.max(2, Math.round(layout.height))
    const density = waveformDensity(sample, columns, rows, 'y')
    paintDensity(ctx, density, columns, rows, layout.left, layout.top, layout.width, layout.height, 24 / sample.height, levelColor(rows, [130, 255, 170], EBU_R103.lumaMin, EBU_R103.lumaMax))
  }
  drawLevelGraticule(ctx, layout, unit, scale, {low: EBU_R103.lumaMin, high: EBU_R103.lumaMax})
}

/** Parade R'G'B' (calculado de Y'CbCr pela matriz BT.709, sem recorte). */
export function drawParade(ctx: Ctx, width: number, height: number, sample: QcScopeSample | null, unit: LevelUnit, scale = 1) {
  ctx.fillStyle = BACKGROUND; ctx.fillRect(0, 0, width, height)
  const layout = waveformLayout(width, height, scale)
  const panel = layout.width / 3
  if (sample) {
    const columns = Math.max(1, Math.min(Math.round(panel), sample.width)), rows = Math.max(2, Math.round(layout.height))
    const colors: Array<['r' | 'g' | 'b', [number, number, number]]> = [['r', [255, 90, 90]], ['g', [90, 255, 130]], ['b', [100, 160, 255]]]
    colors.forEach(([plane, color], index) => {
      const density = waveformDensity(sample, columns, rows, plane)
      paintDensity(ctx, density, columns, rows, layout.left + index * panel, layout.top, panel, layout.height, 24 / sample.height, levelColor(rows, color, EBU_R103.rgbMin, EBU_R103.rgbMax))
    })
  }
  drawLevelGraticule(ctx, layout, unit, scale, {low: EBU_R103.rgbMin, high: EBU_R103.rgbMax}, 3)
  ctx.save()
  ctx.font = `bold ${Math.round(10 * scale)}px ui-monospace, monospace`
  ctx.textAlign = 'right'; ctx.textBaseline = 'top'
  ;[['R\'', '#ff6b6b'], ['G\'', '#5dff8f'], ['B\'', '#7fb2ff']].forEach(([label, color], index) => {
    ctx.fillStyle = color!
    ctx.fillText(label!, layout.left + (index + 1) * panel - 4 * scale, layout.top + 2 * scale)
  })
  ctx.restore()
}

const TARGET_COLORS: Record<string, string> = {R: '#ff5a6e', Mg: '#f472ff', B: '#6aa8ff', Cy: '#4ff0ff', G: '#5dff8f', Yl: '#ffe14d'}

function polarBox(ctx: Ctx, cx: number, cy: number, radius: number, angleDeg: number, magnitude: number, tolerance: {phaseDeg: number; gain: number}) {
  const inner = radius * magnitude * (1 - tolerance.gain), outer = radius * magnitude * (1 + tolerance.gain)
  // Canvas mede ângulo no sentido horário (y para baixo): inverter o sinal.
  const start = -(angleDeg + tolerance.phaseDeg) * Math.PI / 180, end = -(angleDeg - tolerance.phaseDeg) * Math.PI / 180
  ctx.beginPath()
  ctx.arc(cx, cy, inner, start, end)
  ctx.arc(cx, cy, outer, end, start, true)
  ctx.closePath()
  ctx.stroke()
}

/** Vectorscope Cb/Cr BT.709 com alvos de 75% e 100% calculados pela matriz. */
export function drawVectorscope(ctx: Ctx, width: number, height: number, sample: QcScopeSample | null, scale = 1) {
  ctx.fillStyle = BACKGROUND; ctx.fillRect(0, 0, width, height)
  const size = Math.max(10, Math.floor(Math.min(width, height)))
  const left = Math.floor((width - size) / 2), top = Math.floor((height - size) / 2)
  const half = (size - 1) / 2, cx = left + half, cy = top + half, radius = half / VECTOR_FULL_SCALE
  if (sample) {
    // Célula de ~2 px: um vetor parado (barras) aparece como ponto visível.
    const grid = Math.max(16, Math.min(Math.floor(size / (2 * scale)) * 1, 400))
    const density = vectorDensity(sample, grid)
    paintDensity(ctx, density, grid, grid, left, top, size, size, 400 / (sample.width * sample.height) * grid / 4, () => [140, 255, 175])
  }
  ctx.save()
  ctx.lineWidth = 1
  // Eixos Cb (horizontal) e Cr (vertical) e anel de magnitude 1 (|C| = 0,5).
  ctx.strokeStyle = GRID
  ctx.beginPath(); ctx.moveTo(cx - radius * 1.25, cy); ctx.lineTo(cx + radius * 1.25, cy); ctx.moveTo(cx, cy - radius * 1.25); ctx.lineTo(cx, cy + radius * 1.25); ctx.stroke()
  ctx.strokeStyle = GRID_STRONG
  ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke()
  for (let degree = 0; degree < 360; degree += 10) {
    const angle = -degree * Math.PI / 180, long = degree % 30 === 0
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(angle) * radius * (long ? 0.95 : 0.975), cy + Math.sin(angle) * radius * (long ? 0.95 : 0.975))
    ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius)
    ctx.stroke()
  }
  // Linha de tom de pele.
  const skin = -SKIN_TONE_ANGLE_DEG * Math.PI / 180
  ctx.strokeStyle = 'rgba(255, 176, 64, 0.8)'; ctx.setLineDash([4 * scale, 3 * scale])
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(skin) * radius * 1.15, cy + Math.sin(skin) * radius * 1.15); ctx.stroke()
  ctx.setLineDash([])
  ctx.font = `${Math.round(9 * scale)}px ui-monospace, monospace`
  ctx.fillStyle = 'rgba(255, 176, 64, 0.9)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText('pele', cx + Math.cos(skin) * radius * 1.22, cy + Math.sin(skin) * radius * 1.22)
  // Alvos: caixa interna (±3°/±5%) e externa (±10°/±20%) em 75%; mira em 100%.
  const t75 = vectorTargets(0.75), t100 = vectorTargets(1)
  ctx.font = `bold ${Math.round(10 * scale)}px ui-monospace, monospace`
  t75.forEach((target, index) => {
    const color = TARGET_COLORS[target.name]!
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, scale)
    polarBox(ctx, cx, cy, radius, target.angleDeg, target.magnitude, TARGET_TOLERANCE.inner)
    ctx.globalAlpha = 0.45; ctx.lineWidth = 1; ctx.setLineDash([2 * scale, 2 * scale])
    polarBox(ctx, cx, cy, radius, target.angleDeg, target.magnitude, TARGET_TOLERANCE.outer)
    ctx.setLineDash([]); ctx.globalAlpha = 1
    const full = t100[index]!, angle = -full.angleDeg * Math.PI / 180
    const x = cx + Math.cos(angle) * radius * full.magnitude, y = cy + Math.sin(angle) * radius * full.magnitude
    const arm = 4 * scale
    ctx.beginPath(); ctx.moveTo(x - arm, y); ctx.lineTo(x + arm, y); ctx.moveTo(x, y - arm); ctx.lineTo(x, y + arm); ctx.stroke()
    ctx.fillStyle = color
    ctx.fillText(target.name, cx + Math.cos(angle) * radius * (full.magnitude + 0.1), cy + Math.sin(angle) * radius * (full.magnitude + 0.1))
  })
  ctx.fillStyle = LABEL; ctx.font = `${Math.round(9 * scale)}px ui-monospace, monospace`; ctx.textAlign = 'left'
  ctx.fillText('Cb', cx + radius * 1.12, cy - 7 * scale)
  ctx.fillText('Cr', cx + 4 * scale, cy - radius * 1.2)
  ctx.restore()
}
