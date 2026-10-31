import {useEffect, useRef, useState} from 'react'
import type {QcScopeSample, QcScopeStats} from '../../domain/qc-colorimetry.js'
import {drawParade, drawVectorscope, drawWaveform, type LevelUnit} from '../../domain/qc-scope-draw.js'

export type QcScopeMode = 'COMBO' | 'WAVEFORM' | 'VECTORSCOPE' | 'PARADE'

/** Canvas que acompanha o tamanho do contêiner (pixels reais × devicePixelRatio). */
function ScopeCanvas({label, draw, deps}: {label: string; draw: (ctx: CanvasRenderingContext2D, width: number, height: number, scale: number) => void; deps: unknown[]}) {
  const wrapper = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState<{width: number; height: number; scale: number} | null>(null)
  useEffect(() => {
    const element = wrapper.current
    if (!element) return
    const update = () => {
      const box = element.getBoundingClientRect(), scale = Math.min(2, window.devicePixelRatio || 1)
      const next = {width: Math.max(1, Math.round(box.width * scale)), height: Math.max(1, Math.round(box.height * scale)), scale}
      setSize(previous => previous && previous.width === next.width && previous.height === next.height && previous.scale === next.scale ? previous : next)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const element = canvas.current, context = element?.getContext('2d')
    if (!element || !context || !size) return
    if (element.width !== size.width) element.width = size.width
    if (element.height !== size.height) element.height = size.height
    draw(context, size.width, size.height, size.scale)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, ...deps])
  return <div ref={wrapper} className="relative min-h-0 min-w-0 h-full w-full overflow-hidden rounded border border-border-subtle/60 bg-[#05070E]">
    <canvas ref={canvas} role="img" aria-label={label} className="absolute inset-0 w-full h-full"/>
    <span className="absolute top-1 right-1.5 font-label-caps text-[10px] text-outline pointer-events-none">{label}</span>
  </div>
}

const pct = (value: number, unit: LevelUnit) => unit === 'mV' ? `${Math.round(value * 7)} mV` : `${value.toFixed(1)}%`
const area = (fraction: number) => fraction > 0 && fraction < 0.001 ? '<0,1%' : `${(fraction * 100).toFixed(1).replace('.', ',')}%`

interface Props {
  sample: QcScopeSample | null
  stats: QcScopeStats | null
  /** Estado da amostra mostrado no cabeçalho (fonte, quadro, carregando…). */
  status: string
  statusTone: 'exact' | 'approx' | 'idle'
  mode: QcScopeMode
  onModeChange: (mode: QcScopeMode) => void
  unit: LevelUnit
  onUnitChange: (unit: LevelUnit) => void
  costLabel?: string | null
}

/** Waveform, vectorscope e parade; medição numérica embaixo. */
export function QcScopePanel({sample, stats, status, statusTone, mode, onModeChange, unit, onUnitChange, costLabel}: Props) {
  const waveform = <ScopeCanvas label={`WAVEFORM Y' · ${unit}`} deps={[sample, unit]} draw={(ctx, w, h, s) => drawWaveform(ctx, w, h, sample, unit, s)}/>
  const vector = <ScopeCanvas label="VECTORSCOPE BT.709" deps={[sample]} draw={(ctx, w, h, s) => drawVectorscope(ctx, w, h, sample, s)}/>
  const parade = <ScopeCanvas label="PARADE R'G'B'" deps={[sample, unit]} draw={(ctx, w, h, s) => drawParade(ctx, w, h, sample, unit, s)}/>
  const raw = stats?.source === 'ycbcr-original'
  return <section aria-label="Scopes" className="flex flex-col min-h-0 h-full gap-1.5">
    <div className="flex flex-wrap items-center justify-between gap-1.5 shrink-0">
      <span className={`font-label-mono text-[11px] px-1.5 py-0.5 rounded border truncate max-w-full ${statusTone === 'exact' ? 'border-status-ok/50 text-status-ok-bright bg-status-ok/10' : statusTone === 'approx' ? 'border-armed-amber/50 text-armed-amber bg-armed-amber/10' : 'border-border-subtle text-outline'}`} title={status}>{status}</span>
      <div className="flex items-center gap-1 font-label-caps text-[11px]">
        {costLabel && <span className="font-label-mono text-[10px] text-outline mr-1" title="Custo local do desenho dos scopes no navegador.">{costLabel}</span>}
        <div role="group" aria-label="Unidade do waveform" className="flex rounded border border-border-subtle overflow-hidden">
          {(['%', 'mV'] as const).map(value => <button key={value} type="button" aria-pressed={unit === value} onClick={() => onUnitChange(value)}
            className={`px-1.5 py-0.5 cursor-pointer ${unit === value ? 'bg-primary text-on-primary font-bold' : 'text-outline hover:text-on-surface'}`}>{value}</button>)}
        </div>
        <div role="group" aria-label="Scopes visíveis" className="flex rounded border border-border-subtle overflow-hidden">
          {([['COMBO', 'WFM+VEC'], ['WAVEFORM', 'WFM'], ['VECTORSCOPE', 'VEC'], ['PARADE', 'RGB']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => onModeChange(value)}
            className={`px-1.5 py-0.5 cursor-pointer ${mode === value ? 'bg-primary text-on-primary font-bold' : 'text-outline hover:text-on-surface'}`}>{label}</button>)}
        </div>
      </div>
    </div>
    <div className="flex-1 min-h-0">
      {mode === 'COMBO' && <div className="grid h-full min-h-[300px] gap-1.5" style={{gridTemplateRows: 'minmax(0,1.15fr) minmax(0,1fr)', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.5fr)'}}>
        <div className="col-span-2 min-h-0">{waveform}</div>
        <div className="min-h-0">{vector}</div>
        <div className="min-h-0">{parade}</div>
      </div>}
      {mode === 'WAVEFORM' && <div className="h-full min-h-[260px]">{waveform}</div>}
      {mode === 'VECTORSCOPE' && <div className="h-full min-h-[260px]">{vector}</div>}
      {mode === 'PARADE' && <div className="h-full min-h-[260px]">{parade}</div>}
    </div>
    <dl aria-label="Medições dos scopes" className="shrink-0 grid grid-cols-2 xl:grid-cols-4 gap-x-3 gap-y-0.5 font-label-mono text-[11px]">
      <div className="flex justify-between gap-1"><dt className="text-outline">Y' mín/máx</dt><dd className="text-on-surface">{stats ? `${pct(stats.lumaMin, unit)} / ${pct(stats.lumaMax, unit)}` : '—'}</dd></div>
      <div className="flex justify-between gap-1"><dt className="text-outline">&lt;0% · &gt;100%</dt><dd className={stats && (stats.belowBlack || stats.aboveWhite) ? 'text-armed-amber' : 'text-on-surface'}>{stats ? `${area(stats.belowBlack)} · ${area(stats.aboveWhite)}` : '—'}</dd></div>
      <div className="flex justify-between gap-1" title="EBU R103: luma entre −1% e 103%."><dt className="text-outline">Luma (R103)</dt>
        <dd className={!stats ? 'text-outline' : stats.lumaIllegal === null ? 'text-outline' : stats.lumaIllegal ? 'text-on-air-crimson font-bold' : 'text-status-ok-bright'}>{!stats ? '—' : stats.lumaIllegal === null ? 'N/D (recortado)' : stats.lumaIllegal ? 'ILEGAL' : 'LEGAL'}</dd></div>
      <div className="flex justify-between gap-1" title="Gamut R'G'B' real (EBU R103): componentes entre −5% e 105%, até 1% da área.">
        <dt className="text-outline">Gamut RGB</dt>
        <dd className={!stats ? 'text-outline' : stats.gamutIllegal === null ? 'text-outline' : stats.gamutIllegal ? 'text-on-air-crimson font-bold' : 'text-status-ok-bright'}>{!stats ? '—' : stats.gamutIllegal === null ? 'N/D (recortado)' : `${stats.gamutIllegal ? 'FORA' : 'DENTRO'} · ${area(stats.gamutArea)}`}</dd></div>
    </dl>
    {stats && !raw && <p className="shrink-0 text-[11px] text-armed-amber leading-snug">Amostra RGB decodificada pelo navegador: abaixo de 0% e acima de 100% chegam recortados. Pause em “Ver em qualidade” para medir o Y'CbCr do original.</p>}
  </section>
}
