import {useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent} from 'react'
import wasmUrl from '../../scopes/rplayout_scopes.wasm?url'
import {accumulateRgbaJs} from '../../scopes/cpu-js.js'
import {paintDensities} from '../../scopes/cpu-render.js'
import {cursorReadout, drawCursor, drawGraticules} from '../../scopes/graticule.js'
import {SCOPE_MODES, accumulationConfig, formatLevel, hitPanel, scopeLayout, yToLevel, type LevelUnit, type Panel, type ParadeKind, type ScopeMode} from '../../scopes/layout.js'
import type {LiveScopes, LiveSource} from '../../scopes/live.js'
import {WebGpuScopes} from '../../scopes/webgpu.js'
import {WebGl2Scopes, defaultStride} from '../../scopes/webgl2.js'
import {LEVEL_MAX, LEVEL_MIN, MATRIX, SCOPE_CHANNELS, VECTOR_FULL_SCALE, copyScopeResult, sharedScopesWasm, type FalseColorMode, type MatrixCode, type ScopeChannel, type ScopeResult, type ScopeStats, type ScopesWasm} from '../../scopes/wasm.js'

/**
 * Painel de scopes de engenharia (QC e monitor de PGM).
 *
 * Duas fontes, com selo diferente:
 *  - EXATO: o `.ycc` do servidor (Y'CbCr do original), calculado pelo WASM do
 *    crate rplayout-scopes -- a mesma conta do `rplayout-probe`.
 *  - INDICATIVO: o quadro que o navegador decodificou (WHEP, proxy, JPEG),
 *    reconvertido para Y'CbCr BT.709. Ao vivo, em WebGPU na cadência cheia;
 *    sem WebGPU, WebGL2; sem GPU, WASM (ou JS) a 10 Hz numa amostra reduzida.
 */

export type ScopeBackendKind = 'webgpu' | 'webgl2' | 'wasm' | 'js'
export type BackendPreference = 'auto' | 'webgl2' | 'cpu'

export interface ScopeDeckProps {
  /** Quadro exato do servidor. Quando presente, tem precedência sobre o ao vivo. */
  exact?: {ycc: Uint8Array; label: string; rustStats?: Record<string, number> | null} | null
  /** Fonte do navegador (indicativa). */
  live?: {element: LiveSource | null; label: string; valid: boolean} | null
  /** Texto de estado do hospedeiro (carregando, erro...). */
  note?: string | null
  /** Onde guardar as preferências (ex.: 'qc', 'pgm'). */
  storageKey: string
  /** Canvas por cima da imagem onde desenhar a falsa cor (opcional). */
  falseColorCanvas?: HTMLCanvasElement | null
  onFalseColorChange?: (mode: FalseColorMode | null) => void
  /** Região de interesse (lupa) controlada pelo hospedeiro. */
  roi?: readonly [number, number, number, number] | null
  onRoiChange?: (roi: [number, number, number, number] | null) => void
  onRoiSelect?: (active: boolean) => void
  roiSelecting?: boolean
  matrix?: MatrixCode
  /** Versão compacta (sobreposta ao monitor): menos controles visíveis. */
  compact?: boolean
  className?: string
}

interface Prefs {
  mode: ScopeMode; unit: LevelUnit; channel: ScopeChannel; parade: ParadeKind; intensity: number
  targets: '75' | '100' | 'both'; skin: boolean; graticule: number; falseColor: FalseColorMode | null; backend: BackendPreference
}
const DEFAULT_PREFS: Prefs = {mode: 'COMBO', unit: '%', channel: 'Y', parade: 'RGB', intensity: 1, targets: 'both', skin: true, graticule: 0.9, falseColor: null, backend: 'auto'}

function loadPrefs(key: string): Prefs {
  try {
    const raw = window.localStorage.getItem(`rplayout.scopes.${key}`)
    return raw ? {...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>)} : DEFAULT_PREFS
  } catch { return DEFAULT_PREFS }
}
function savePrefs(key: string, prefs: Prefs) {
  try { window.localStorage.setItem(`rplayout.scopes.${key}`, JSON.stringify(prefs)) } catch { /* sem armazenamento: só não lembra */ }
}

const UNITS: LevelUnit[] = ['%', 'mV', 'IRE']
const CPU_SAMPLE = {width: 640, height: 360}
const area = (n: number, total: number) => { const f = total ? n / total : 0; return f > 0 && f < 0.001 ? '<0,1%' : `${(f * 100).toFixed(1).replace('.', ',')}%` }

/** Diferença tolerada entre a medição Rust (sonda) e a do WASM (mesmo arquivo). */
export function rustWasmAgree(rust: Record<string, number> | null | undefined, wasm: ScopeStats): boolean | null {
  if (!rust) return null
  const close = (a: number | undefined, b: number, tol: number) => a !== undefined && Math.abs(a - b) <= tol
  return close(rust.count, wasm.count, 0) && close(rust.lumaMin, wasm.lumaMin, 1e-3) && close(rust.lumaMax, wasm.lumaMax, 1e-3)
    && close(rust.gamutR103, wasm.gamutR103, 0) && close(rust.chromaIllegal, wasm.chromaIllegal, 0)
}

export function ScopeDeck({exact, live, note, storageKey, falseColorCanvas, onFalseColorChange, roi, onRoiChange, onRoiSelect, roiSelecting, matrix = MATRIX.bt709, compact, className}: ScopeDeckProps) {
  const [prefs, setPrefsState] = useState<Prefs>(() => loadPrefs(storageKey))
  const setPrefs = useCallback((patch: Partial<Prefs>) => setPrefsState(previous => { const next = {...previous, ...patch}; savePrefs(storageKey, next); return next }), [storageKey])
  const [levels, setLevels] = useState<{min: number; max: number}>({min: LEVEL_MIN, max: LEVEL_MAX})
  const [vectorScale, setVectorScale] = useState(VECTOR_FULL_SCALE)
  const [frozen, setFrozen] = useState(false)
  const [hasReference, setHasReference] = useState(false)
  const [size, setSize] = useState<{width: number; height: number; scale: number} | null>(null)
  const [cursor, setCursor] = useState<{x: number; y: number} | null>(null)
  const [backend, setBackend] = useState<ScopeBackendKind | null>(null)
  const [stats, setStats] = useState<ScopeStats | null>(null)
  const [timing, setTiming] = useState<string | null>(null)
  const [parity, setParity] = useState<boolean | null>(null)
  const [help, setHelp] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)
  const gpuCanvas = useRef<HTMLCanvasElement>(null)
  const glCanvas = useRef<HTMLCanvasElement>(null)
  const cpuCanvas = useRef<HTMLCanvasElement>(null)
  const overlay = useRef<HTMLCanvasElement>(null)
  const liveScopes = useRef<LiveScopes | null>(null)
  const wasm = useRef<ScopesWasm | null>(null)
  const lastResult = useRef<ScopeResult | null>(null)
  const reference = useRef<ScopeResult | null>(null)
  const frozenRef = useRef(frozen)
  frozenRef.current = frozen

  // Tamanho real do painel (pixels do dispositivo).
  useEffect(() => {
    const element = wrapper.current
    if (!element) return
    const update = () => {
      const box = element.getBoundingClientRect(), scale = Math.min(2, window.devicePixelRatio || 1)
      const next = {width: Math.max(32, Math.round(box.width * scale)), height: Math.max(32, Math.round(box.height * scale)), scale}
      setSize(previous => previous && previous.width === next.width && previous.height === next.height && previous.scale === next.scale ? previous : next)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const panels: Panel[] = useMemo(() => size ? scopeLayout(prefs.mode, size.width, size.height, {waveChannel: prefs.channel, parade: prefs.parade, scale: size.scale}) : [], [size, prefs.mode, prefs.channel, prefs.parade])
  const roiValue = useMemo(() => (roi ?? [0, 0, 1, 1]) as [number, number, number, number], [roi])
  const exactWidth = exact ? (exact.ycc[8]! | (exact.ycc[9]! << 8)) : 0
  const liveElement = live?.element ?? null
  // Sem DOM (renderização no servidor/testes) não há elemento para medir.
  const sourceWidth = exact ? exactWidth : !liveElement ? 1920 : 'videoWidth' in liveElement ? liveElement.videoWidth || 1920 : liveElement.naturalWidth || 1920
  const usingCpuLive = backend === 'wasm' || backend === 'js'
  const config = useMemo(() => accumulationConfig(panels, {levelMin: levels.min, levelMax: levels.max, vectorScale, roi: roiValue}, exact ? sourceWidth : usingCpuLive ? CPU_SAMPLE.width : sourceWidth),
    [panels, levels, vectorScale, roiValue, exact, sourceWidth, usingCpuLive])

  // WASM: sempre carregado (caminho exato e fallback de CPU).
  const [wasmReady, setWasmReady] = useState(false)
  useEffect(() => {
    let alive = true
    sharedScopesWasm(wasmUrl).then(instance => { if (alive) { wasm.current = instance; setWasmReady(true) } }).catch(error => console.warn('[scopes] WASM indisponível; usando JS:', error))
    return () => { alive = false }
  }, [])

  // Backend ao vivo: WebGPU → WebGL2 → CPU (WASM, ou JS se o WASM falhou).
  // Um canvas por API: um canvas que já deu contexto WebGPU não dá WebGL2.
  useEffect(() => {
    const gpu = gpuCanvas.current, gl = glCanvas.current
    if (!gpu || !gl) return
    let alive = true
    void (async () => {
      let instance: LiveScopes | null = null
      if (prefs.backend === 'auto') instance = await WebGpuScopes.create(gpu)
      if (!instance && prefs.backend !== 'cpu') instance = WebGl2Scopes.create(gl)
      if (!alive) { instance?.destroy(); return }
      liveScopes.current = instance
      setBackend(instance ? instance.kind : wasm.current ? 'wasm' : 'js')
    })()
    return () => { alive = false; liveScopes.current?.destroy(); liveScopes.current = null; setHasReference(false) }
  }, [prefs.backend])
  useEffect(() => { if (backend === 'js' && wasmReady) setBackend('wasm') }, [backend, wasmReady])

  // Falsa cor no canvas sobre a imagem.
  useEffect(() => {
    liveScopes.current?.setFalseColor(prefs.falseColor && !exact ? falseColorCanvas ?? null : null, prefs.falseColor ?? 'exposure')
    onFalseColorChange?.(prefs.falseColor)
  }, [prefs.falseColor, falseColorCanvas, backend, exact, onFalseColorChange])

  const view = useCallback(() => size ? {panels, config, width: size.width, height: size.height, intensity: prefs.intensity, matrix, frozen: frozenRef.current, showReference: hasReference, stride: backend === 'webgl2' ? defaultStride(sourceWidth) : 1} : null,
    [size, panels, config, prefs.intensity, matrix, hasReference, backend, sourceWidth])

  // --- Caminho EXATO (WASM sobre o .ycc) ------------------------------------
  const paintCpu = useCallback((result: ScopeResult | null) => {
    const canvas = cpuCanvas.current, ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || !size) return
    if (canvas.width !== size.width) canvas.width = size.width
    if (canvas.height !== size.height) canvas.height = size.height
    paintDensities(ctx, size.width, size.height, panels, result, {intensity: prefs.intensity, samples: result?.stats.count ?? 1, reference: hasReference ? reference.current : null})
  }, [size, panels, prefs.intensity, hasReference])

  useEffect(() => {
    if (!exact || !wasmReady || !wasm.current) return
    if (frozen && lastResult.current) { paintCpu(lastResult.current); return }
    const started = performance.now()
    try {
      const result = copyScopeResult(wasm.current.runYcc(exact.ycc, config))
      lastResult.current = result
      setStats(result.stats)
      setParity(rustWasmAgree(exact.rustStats, result.stats))
      paintCpu(result)
      setTiming(`WASM ${(performance.now() - started).toFixed(1)} ms`)
    } catch (error) {
      setStats(null); paintCpu(null)
      setTiming(error instanceof Error ? error.message : 'falha no WASM')
    }
  }, [exact, wasmReady, config, paintCpu, frozen])

  // --- Caminho INDICATIVO ao vivo -------------------------------------------
  const sampleCanvas = useRef<HTMLCanvasElement | null>(null)
  const lastCpuAt = useRef(0)
  const lastReport = useRef(0)
  const renderLive = useCallback((force = false) => {
    if (exact || document.hidden) return
    const v = view()
    if (!v) return
    const element = live?.valid ? liveElement : null
    const scopes = liveScopes.current
    if (scopes) {
      scopes.render(element, v)
    } else if (backend === 'wasm' || backend === 'js') {
      const now = performance.now()
      if (!force && now - lastCpuAt.current < 100) return
      lastCpuAt.current = now
      if (frozenRef.current) { paintCpu(lastResult.current); return }
      if (!element) return
      if (element instanceof HTMLVideoElement && (element.readyState < 2 || !element.videoWidth)) return
      if (element instanceof HTMLImageElement && (!element.complete || !element.naturalWidth)) return
      if (!sampleCanvas.current) { sampleCanvas.current = document.createElement('canvas'); sampleCanvas.current.width = CPU_SAMPLE.width; sampleCanvas.current.height = CPU_SAMPLE.height }
      const ctx = sampleCanvas.current.getContext('2d', {willReadFrequently: true})
      if (!ctx) return
      try {
        ctx.drawImage(element, 0, 0, CPU_SAMPLE.width, CPU_SAMPLE.height)
        const pixels = ctx.getImageData(0, 0, CPU_SAMPLE.width, CPU_SAMPLE.height).data
        const result = wasm.current ? copyScopeResult(wasm.current.runRgba(pixels, CPU_SAMPLE.width, CPU_SAMPLE.height, v.config, matrix)) : accumulateRgbaJs(pixels, CPU_SAMPLE.width, CPU_SAMPLE.height, v.config, matrix)
        lastResult.current = result
        paintCpu(result)
        setStats(result.stats)
        if (prefs.falseColor && falseColorCanvas && wasm.current) {
          const colors = wasm.current.falseColorRgba(pixels, CPU_SAMPLE.width, CPU_SAMPLE.height, prefs.falseColor, matrix)
          falseColorCanvas.width = CPU_SAMPLE.width; falseColorCanvas.height = CPU_SAMPLE.height
          falseColorCanvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(colors), CPU_SAMPLE.width, CPU_SAMPLE.height), 0, 0)
        }
        setTiming(`${backend === 'wasm' ? 'WASM' : 'JS'} ${(performance.now() - now).toFixed(1)} ms · ${CPU_SAMPLE.width}×${CPU_SAMPLE.height} · 10 Hz`)
      } catch { /* quadro de outra origem ou decoder sem quadro */ }
      return
    }
    const now = performance.now()
    if (scopes && now - lastReport.current > 1000) {
      lastReport.current = now
      const t = scopes.timing()
      setStats(scopes.stats())
      setTiming(`${scopes.kind === 'webgpu' ? 'WebGPU' : 'WebGL2'}${t.gpuMs !== null ? ` · GPU ${t.gpuMs.toFixed(2)} ms` : ''} · CPU ${t.cpuMs.toFixed(2)} ms · ${t.sampledWidth}×${t.sampledHeight}`)
    }
  }, [exact, view, live?.valid, liveElement, backend, paintCpu, matrix, prefs.falseColor, falseColorCanvas])
  const renderLiveRef = useRef(renderLive)
  renderLiveRef.current = renderLive

  // Cadência cheia: um render por quadro decodificado (requestVideoFrameCallback).
  useEffect(() => {
    if (exact || !liveElement) return
    let handle = 0, timer = 0, alive = true
    if (liveElement instanceof HTMLVideoElement && 'requestVideoFrameCallback' in liveElement) {
      const tick = () => { if (!alive) return; renderLiveRef.current(); handle = liveElement.requestVideoFrameCallback(tick) }
      handle = liveElement.requestVideoFrameCallback(tick)
      // Vídeo parado não gera quadros: redesenhe para mudanças de layout/zoom.
      timer = window.setInterval(() => { if (liveElement.paused) renderLiveRef.current(true) }, 250)
      return () => { alive = false; liveElement.cancelVideoFrameCallback(handle); window.clearInterval(timer) }
    }
    const onLoad = () => renderLiveRef.current(true)
    liveElement.addEventListener('load', onLoad)
    renderLiveRef.current(true)
    timer = window.setInterval(() => renderLiveRef.current(), 250)
    return () => { liveElement.removeEventListener('load', onLoad); window.clearInterval(timer) }
  }, [exact, liveElement])
  // Mudou layout, zoom, intensidade, congelamento: redesenha já.
  useEffect(() => { renderLiveRef.current(true) }, [view, frozen])

  // --- Gratículo e cursor ---------------------------------------------------
  useEffect(() => {
    const canvas = overlay.current, ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || !size) return
    if (canvas.width !== size.width) canvas.width = size.width
    if (canvas.height !== size.height) canvas.height = size.height
    ctx.clearRect(0, 0, size.width, size.height)
    const options = {unit: prefs.unit, config, matrix, targets: prefs.targets, skinLine: prefs.skin, scale: size.scale, graticule: prefs.graticule}
    drawGraticules(ctx, panels, options)
    if (cursor) {
      const panel = hitPanel(panels, cursor.x, cursor.y)
      if (panel) drawCursor(ctx, panel, cursor.x, cursor.y, cursorReadout(panel, cursor.x, cursor.y, options), size.scale)
    }
  }, [size, panels, config, prefs.unit, prefs.targets, prefs.skin, prefs.graticule, matrix, cursor])

  const toPixels = (event: {clientX: number; clientY: number}) => {
    const box = overlay.current!.getBoundingClientRect(), scale = size?.scale ?? 1
    return {x: (event.clientX - box.left) * scale, y: (event.clientY - box.top) * scale}
  }
  const onPointerMove = (event: ReactPointerEvent) => setCursor(toPixels(event))
  const onWheel = (event: ReactWheelEvent) => {
    const point = toPixels(event), panel = hitPanel(panels, point.x, point.y)
    if (!panel) return
    const factor = event.deltaY < 0 ? 1 / 1.25 : 1.25
    if (panel.kind === 'wave' || panel.kind === 'hist') {
      const anchor = panel.kind === 'wave' ? yToLevel(point.y, panel.plot, config) : config.levelMin + (point.x - panel.plot.x) / panel.plot.w * (config.levelMax - config.levelMin)
      const span = Math.max(4, Math.min(LEVEL_MAX - LEVEL_MIN, (levels.max - levels.min) * factor))
      let min = anchor - (anchor - levels.min) * span / (levels.max - levels.min)
      min = Math.max(LEVEL_MIN, Math.min(LEVEL_MAX - span, min))
      setLevels({min, max: min + span})
    } else if (panel.kind === 'vector') {
      setVectorScale(scale => Math.max(0.08, Math.min(VECTOR_FULL_SCALE, scale * factor)))
    }
  }
  const resetZoom = () => { setLevels({min: LEVEL_MIN, max: LEVEL_MAX}); setVectorScale(VECTOR_FULL_SCALE) }

  const captureReference = () => {
    if (liveScopes.current && !exact) { liveScopes.current.captureReference(); setHasReference(true) }
    else if (lastResult.current) { reference.current = copyScopeResult(lastResult.current); setHasReference(true) }
  }
  const clearReference = () => { liveScopes.current?.clearReference(); reference.current = null; setHasReference(false) }
  const cycle = <T,>(list: readonly T[], value: T): T => list[(list.indexOf(value) + 1) % list.length]!

  // Atalhos: só com o foco no painel de scopes (não disputam J/K/L, Espaço,
  // setas, i, n, Delete nem F-keys com o QC e o Master).
  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const key = event.key
    let handled = true
    const modeIndex = '1234567'.indexOf(key)
    if (modeIndex >= 0) setPrefs({mode: SCOPE_MODES[modeIndex]!.mode})
    else if (key === 'c') setPrefs({channel: cycle(SCOPE_CHANNELS, prefs.channel)})
    else if (key === 'C') setPrefs({parade: prefs.parade === 'RGB' ? 'YCbCr' : 'RGB'})
    else if (key === 'u' || key === 'U') setPrefs({unit: cycle(UNITS, prefs.unit)})
    else if (key === 'f' || key === 'F') setPrefs({falseColor: cycle([null, 'exposure', 'gamut'] as const, prefs.falseColor)})
    else if (key === 'z' || key === 'Z') setFrozen(value => !value)
    else if (key === 'x') captureReference()
    else if (key === 'X') clearReference()
    else if (key === 't' || key === 'T') setPrefs({targets: cycle(['both', '75', '100'] as const, prefs.targets)})
    else if (key === 's' || key === 'S') setPrefs({skin: !prefs.skin})
    else if (key === '[') setPrefs({intensity: Math.max(0.25, prefs.intensity / 1.25)})
    else if (key === ']') setPrefs({intensity: Math.min(8, prefs.intensity * 1.25)})
    else if (key === '0') resetZoom()
    else if ((key === 'a' || key === 'A') && onRoiSelect) onRoiSelect(!roiSelecting)
    else if (key === 'Escape' && (roi || roiSelecting)) { onRoiChange?.(null); onRoiSelect?.(false) }
    else if (key === '?' || key === 'h' || key === 'H') setHelp(value => !value)
    else handled = false
    if (handled) { event.preventDefault(); event.stopPropagation() }
  }

  const exactMode = Boolean(exact)
  const badge = exactMode ? {text: 'EXATO', className: 'border-status-ok/60 text-status-ok-bright bg-status-ok/10', title: 'Y\'CbCr do original (quadro do servidor), calculado pelo WASM do crate rplayout-scopes -- a mesma conta da sonda.'}
    : {text: 'INDICATIVO', className: 'border-armed-amber/60 text-armed-amber bg-armed-amber/10', title: 'Quadro decodificado pelo navegador (comprimido, reduzido, convertido para RGB), reconvertido para Y\'CbCr BT.709. Erro esperado em docs/SCOPES.md.'}
  const sourceLabel = exactMode ? exact!.label : live?.label ?? ''
  const backendLabel = exactMode ? 'WASM' : backend === 'webgpu' ? 'WebGPU' : backend === 'webgl2' ? 'WebGL2' : backend === 'wasm' ? 'WASM (CPU)' : backend === 'js' ? 'JS (CPU)' : '…'
  const btn = (active: boolean) => `px-1.5 py-0.5 cursor-pointer ${active ? 'bg-primary text-on-primary font-bold' : 'text-outline hover:text-on-surface'}`
  const unitFormat = (p: number) => formatLevel(p, prefs.unit)

  return <section aria-label="Scopes" tabIndex={0} onKeyDown={onKeyDown} data-scope-backend={backendLabel} data-scope-source={exactMode ? 'exact' : 'indicative'}
    className={`flex flex-col min-h-0 h-full gap-1 outline-none focus-visible:ring-1 focus-visible:ring-primary/60 rounded ${className ?? ''}`}>
    <header className="flex flex-wrap items-center justify-between gap-1 shrink-0 font-label-caps text-[11px]">
      <div className="flex items-center gap-1 min-w-0">
        <span className={`font-label-mono text-[10px] px-1.5 py-0.5 rounded border font-bold ${badge.className}`} title={badge.title}>{badge.text}</span>
        {exactMode && parity !== null && <span className={`font-label-mono text-[10px] ${parity ? 'text-status-ok-bright' : 'text-on-air-crimson font-bold'}`} title="Medição da sonda (Rust nativo) comparada com o WASM sobre o mesmo quadro.">{parity ? 'Rust=WASM' : 'Rust≠WASM'}</span>}
        <span className="font-label-mono text-[10px] text-outline truncate" title={sourceLabel}>{note ?? sourceLabel}</span>
      </div>
      <div className="flex items-center gap-1 flex-wrap">
        <span className="font-label-mono text-[10px] text-outline" title="Backend e custo medido por quadro">{backendLabel}{timing && !exactMode ? '' : ''}</span>
        <div role="group" aria-label="Scopes visíveis" className="flex rounded border border-border-subtle overflow-hidden">
          {SCOPE_MODES.filter(m => !compact || ['COMBO', 'WAVE', 'PARADE', 'VECTOR', 'QUAD'].includes(m.mode)).map((m, i) => <button key={m.mode} type="button" title={`${m.title} (${i + 1})`} aria-pressed={prefs.mode === m.mode} onClick={() => setPrefs({mode: m.mode})} className={btn(prefs.mode === m.mode)}>{m.label}</button>)}
        </div>
        <select aria-label="Canal do waveform (C)" value={prefs.channel} onChange={e => setPrefs({channel: e.target.value as ScopeChannel})} className="bg-surface-container-lowest border border-border-subtle rounded px-1 py-0.5 text-[11px]">
          {SCOPE_CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <button type="button" title="Parade R'G'B' ou Y'CbCr (Shift+C)" onClick={() => setPrefs({parade: prefs.parade === 'RGB' ? 'YCbCr' : 'RGB'})} className={`rounded border border-border-subtle ${btn(false)}`}>{prefs.parade === 'RGB' ? "R'G'B'" : "Y'CbCr"}</button>
        <div role="group" aria-label="Unidade (U)" className="flex rounded border border-border-subtle overflow-hidden">
          {UNITS.map(u => <button key={u} type="button" aria-pressed={prefs.unit === u} onClick={() => setPrefs({unit: u})} className={btn(prefs.unit === u)}>{u}</button>)}
        </div>
      </div>
    </header>
    {!compact && <div className="flex flex-wrap items-center gap-1 shrink-0 font-label-caps text-[11px]">
      <label className="flex items-center gap-1 text-outline" title="Intensidade ([ e ])">INT
        <input type="range" min={-2} max={3} step={0.1} value={Math.log2(prefs.intensity)} onChange={e => setPrefs({intensity: 2 ** Number(e.target.value)})} className="w-16"/>
      </label>
      <label className="flex items-center gap-1 text-outline" title="Brilho do gratículo">GRAT
        <input type="range" min={0.15} max={1} step={0.05} value={prefs.graticule} onChange={e => setPrefs({graticule: Number(e.target.value)})} className="w-12"/>
      </label>
      <button type="button" title="Alvos do vectorscope 75% / 100% (T)" onClick={() => setPrefs({targets: cycle(['both', '75', '100'] as const, prefs.targets)})} className={`rounded border border-border-subtle ${btn(false)}`}>ALVOS {prefs.targets === 'both' ? '75+100' : prefs.targets}</button>
      <button type="button" aria-pressed={prefs.skin} title="Linha de tom de pele (S)" onClick={() => setPrefs({skin: !prefs.skin})} className={`rounded border border-border-subtle ${btn(prefs.skin)}`}>PELE</button>
      <button type="button" title="Falsa cor sobre a imagem (F): exposição / gamut" onClick={() => setPrefs({falseColor: cycle([null, 'exposure', 'gamut'] as const, prefs.falseColor)})} className={`rounded border border-border-subtle ${btn(Boolean(prefs.falseColor))}`}>{prefs.falseColor === 'gamut' ? 'F.COR GAMUT' : prefs.falseColor ? 'F.COR EXPO' : 'F.COR'}</button>
      {onRoiSelect && <button type="button" aria-pressed={Boolean(roiSelecting || roi)} title="Lupa: arraste na imagem para medir só uma região (A; Esc limpa)" onClick={() => roi ? onRoiChange?.(null) : onRoiSelect(!roiSelecting)} className={`rounded border border-border-subtle ${btn(Boolean(roiSelecting || roi))}`}>{roi ? 'LUPA ✕' : 'LUPA'}</button>}
      <button type="button" aria-pressed={frozen} title="Congelar o scope (Z)" onClick={() => setFrozen(value => !value)} className={`rounded border border-border-subtle ${btn(frozen)}`}>{frozen ? 'CONGELADO' : 'CONGELAR'}</button>
      <button type="button" title="Guardar o quadro atual como referência (X); Shift+X limpa" onClick={() => hasReference ? clearReference() : captureReference()} className={`rounded border border-border-subtle ${btn(hasReference)}`}>{hasReference ? 'REF ✕' : 'REF'}</button>
      <button type="button" title="Zoom padrão (0). Roda do mouse sobre o scope dá zoom." onClick={resetZoom} className={`rounded border border-border-subtle ${btn(false)}`}>1:1</button>
      <select aria-label="Backend" title="Backend dos scopes ao vivo" value={prefs.backend} onChange={e => setPrefs({backend: e.target.value as BackendPreference})} className="bg-surface-container-lowest border border-border-subtle rounded px-1 py-0.5 text-[11px]">
        <option value="auto">AUTO</option><option value="webgl2">WebGL2</option><option value="cpu">CPU</option>
      </select>
      <button type="button" title="Atalhos (?)" onClick={() => setHelp(value => !value)} className={`rounded border border-border-subtle ${btn(help)}`}>?</button>
    </div>}
    <div ref={wrapper} className="relative flex-1 min-h-[160px] rounded border border-border-subtle/60 bg-[#05070E] overflow-hidden"
      onPointerMove={onPointerMove} onPointerLeave={() => setCursor(null)} onWheel={onWheel} onDoubleClick={resetZoom}>
      <canvas ref={gpuCanvas} aria-hidden="true" className={`absolute inset-0 w-full h-full ${exactMode || backend !== 'webgpu' ? 'invisible' : ''}`}/>
      <canvas ref={glCanvas} aria-hidden="true" className={`absolute inset-0 w-full h-full ${exactMode || backend !== 'webgl2' ? 'invisible' : ''}`}/>
      <canvas ref={cpuCanvas} aria-hidden="true" className={`absolute inset-0 w-full h-full ${exactMode || usingCpuLive ? '' : 'invisible'}`}/>
      <canvas ref={overlay} role="img" aria-label={`Scopes ${prefs.mode}`} className="absolute inset-0 w-full h-full"/>
      {frozen && <span className="absolute top-1 left-1/2 -translate-x-1/2 font-label-mono text-[10px] px-1 rounded bg-armed-amber text-black font-bold pointer-events-none">CONGELADO</span>}
      {hasReference && <span className="absolute bottom-1 right-1 font-label-mono text-[10px] px-1 rounded border border-armed-amber/60 text-armed-amber pointer-events-none">REF em âmbar</span>}
      {help && <div className="absolute inset-2 overflow-auto rounded bg-black/90 border border-border-subtle p-2 font-label-mono text-[11px] text-on-surface leading-5" onClick={() => setHelp(false)}>
        <p className="font-bold text-armed-amber">Atalhos (com o foco no painel de scopes)</p>
        <p>1–7 modo · c canal · Shift+C parade RGB/YCbCr · u unidade (%, mV, IRE)</p>
        <p>f falsa cor · z congelar · x referência · Shift+X limpa referência</p>
        <p>t alvos 75/100 · s linha de pele · [ ] intensidade · 0 zoom 1:1 · a lupa · Esc limpa a lupa</p>
        <p>Roda do mouse: zoom no waveform/histograma (níveis) e no vectorscope (ganho). Duplo clique: 1:1.</p>
        <p className="text-outline">J/K/L, Espaço, setas, i, n e Delete continuam do QC/Master.</p>
      </div>}
    </div>
    <dl aria-label="Medições dos scopes" className="shrink-0 grid grid-cols-2 xl:grid-cols-4 gap-x-3 gap-y-0.5 font-label-mono text-[11px]">
      <div className="flex justify-between gap-1"><dt className="text-outline">Y' mín/máx</dt><dd className="text-on-surface">{stats?.count ? `${unitFormat(stats.lumaMin)} / ${unitFormat(stats.lumaMax)}` : '—'}</dd></div>
      <div className="flex justify-between gap-1"><dt className="text-outline">&lt;0% · &gt;100%</dt><dd className={stats && (stats.belowBlack || stats.aboveWhite) ? 'text-armed-amber' : 'text-on-surface'}>{stats?.count ? `${area(stats.belowBlack, stats.count)} · ${area(stats.aboveWhite, stats.count)}` : '—'}</dd></div>
      <div className="flex justify-between gap-1" title="EBU R103: luma entre −1% e 103%."><dt className="text-outline">Luma (R103)</dt>
        <dd className={!stats?.count ? 'text-outline' : stats.lumaIllegal ? 'text-on-air-crimson font-bold' : 'text-status-ok-bright'}>{!stats?.count ? '—' : stats.lumaIllegal ? 'ILEGAL' : 'LEGAL'}{!exactMode && stats?.count ? '*' : ''}</dd></div>
      <div className="flex justify-between gap-1" title="Gamut R'G'B' (EBU R103: −5%..105%, até 1% da área) e croma fora de 16–240.">
        <dt className="text-outline">Gamut · croma</dt>
        <dd className={!stats?.count || Number.isNaN(stats.gamutR103) ? 'text-outline' : stats.gamutIllegal || stats.chromaIllegalAny ? 'text-on-air-crimson font-bold' : 'text-status-ok-bright'}>
          {!stats?.count || Number.isNaN(stats.gamutR103) ? '—' : `${stats.gamutIllegal ? 'FORA' : 'DENTRO'} ${area(stats.gamutR103, stats.count)}${stats.chromaIllegalAny ? ' · CROMA ILEGAL' : ''}`}</dd></div>
    </dl>
    {!compact && <p className="shrink-0 font-label-mono text-[10px] text-outline truncate" title={timing ?? ''}>{backendLabel}{timing ? ` · ${timing}` : ''}{!exactMode ? ' · * indicativo: o navegador recorta abaixo de 0% e acima de 100%' : ''}</p>}
  </section>
}
