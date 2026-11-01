import {useRef, useState, type PointerEvent as ReactPointerEvent} from 'react'

/**
 * Lupa dos scopes: arrastar sobre a imagem escolhe a região medida.
 *
 * Fica por cima da imagem (absolute inset-0). `aspect` é a proporção do
 * quadro: com `object-contain` a imagem não ocupa a caixa toda e a seleção é
 * convertida para coordenadas do quadro, não da caixa.
 */
export function RoiSelector({roi, selecting, aspect, onChange, onDone}: {
  roi: readonly [number, number, number, number] | null
  selecting: boolean
  aspect: number
  onChange: (roi: [number, number, number, number] | null) => void
  onDone: () => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{x0: number; y0: number; x1: number; y1: number} | null>(null)
  const content = () => {
    const r = box.current!.getBoundingClientRect()
    const boxAspect = r.width / Math.max(1, r.height)
    const w = boxAspect > aspect ? r.height * aspect : r.width
    const h = boxAspect > aspect ? r.height : r.width / aspect
    return {left: r.left + (r.width - w) / 2, top: r.top + (r.height - h) / 2, w, h, boxLeft: r.left, boxTop: r.top, boxW: r.width, boxH: r.height}
  }
  const norm = (event: ReactPointerEvent) => {
    const c = content()
    return {x: Math.max(0, Math.min(1, (event.clientX - c.left) / c.w)), y: Math.max(0, Math.min(1, (event.clientY - c.top) / c.h))}
  }
  const shown = drag ? [Math.min(drag.x0, drag.x1), Math.min(drag.y0, drag.y1), Math.max(drag.x0, drag.x1), Math.max(drag.y0, drag.y1)] as const : roi
  let style: React.CSSProperties | undefined
  if (shown && box.current) {
    const c = content()
    style = {left: c.left - c.boxLeft + shown[0] * c.w, top: c.top - c.boxTop + shown[1] * c.h, width: (shown[2] - shown[0]) * c.w, height: (shown[3] - shown[1]) * c.h}
  }
  if (!selecting && !roi) return null
  return <div ref={box} className={`absolute inset-0 z-20 ${selecting ? 'cursor-crosshair' : 'pointer-events-none'}`}
    aria-label={selecting ? 'Arraste para escolher a região dos scopes' : undefined}
    onClick={event => { if (selecting) event.stopPropagation() }}
    onPointerDown={event => { if (!selecting) return; event.currentTarget.setPointerCapture(event.pointerId); const p = norm(event); setDrag({x0: p.x, y0: p.y, x1: p.x, y1: p.y}) }}
    onPointerMove={event => { if (!drag) return; const p = norm(event); setDrag({...drag, x1: p.x, y1: p.y}) }}
    onPointerUp={() => {
      if (!drag) return
      const r: [number, number, number, number] = [Math.min(drag.x0, drag.x1), Math.min(drag.y0, drag.y1), Math.max(drag.x0, drag.x1), Math.max(drag.y0, drag.y1)]
      setDrag(null)
      onChange(r[2] - r[0] > 0.01 && r[3] - r[1] > 0.01 ? r : null)
      onDone()
    }}>
    {selecting && !drag && <span className="absolute top-1 left-1 font-label-mono text-[10px] px-1 rounded bg-black/70 text-armed-amber">LUPA: arraste a região · Esc cancela</span>}
    {style && <div className="absolute border-2 border-armed-amber/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" style={style}>
      <span className="absolute -top-4 left-0 font-label-mono text-[10px] text-armed-amber">LUPA</span>
    </div>}
  </div>
}
