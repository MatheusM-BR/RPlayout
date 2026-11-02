import { useCallback, useEffect, useState } from 'react'
import { api, type CutMark } from '../api.js'
import { useCan } from '../domain/permissions.js'
import { confirmAction } from '../domain/confirm.js'

const clock = (ms: number) => {
  const total = Math.max(0, ms) / 1000, m = Math.floor(total / 60), s = total - m * 60
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`
}
/** "mm:ss" ou "mm:ss.d" ou segundos. */
export function parseClock(text: string): number | null {
  const value = text.trim().replace(',', '.')
  const match = /^(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(value)
  if (!match) return null
  return Math.round(((Number(match[1] ?? 0) * 60) + Number(match[2])) * 1000)
}
const KIND: Record<CutMark['kind'], { label: string; tone: string; hint: string }> = {
  HEAD: { label: 'INÍCIO', tone: 'border-status-ok/50 text-status-ok', hint: 'O VT pode entrar mais adiante no conteúdo.' },
  TAIL: { label: 'FIM', tone: 'border-status-ok/50 text-status-ok', hint: 'O VT pode sair mais cedo.' },
  MIDDLE: { label: 'MEIO · AGUARDA MOTOR', tone: 'border-outline text-outline', hint: 'Guardado. O motor ainda não pula trecho do meio; não entra no alinhamento.' },
}

/** Trechos deste VT que podem ser cortados para alinhar horário (vários por
 * versão do arquivo). Marca com o tempo atual do player ou digitando. */
export function CutMarksPanel({ assetId, contentHash, durationMs, channelId, currentTimeSec, onSeek }: {
  assetId: string; contentHash: string; durationMs: number; channelId: string; currentTimeSec: number; onSeek: (seconds: number) => void
}) {
  const canMark = useCan('PLAYLIST_EDIT')
  const [marks, setMarks] = useState<CutMark[]>([])
  const [from, setFrom] = useState(''), [to, setTo] = useState(''), [label, setLabel] = useState('')
  const [message, setMessage] = useState<string | null>(null), [busy, setBusy] = useState(false)
  const load = useCallback(() => { void api.cutMarks(assetId).then(result => setMarks(result.marks.filter(mark => mark.contentHash === contentHash))).catch(error => setMessage(error instanceof Error ? error.message : String(error))) }, [assetId, contentHash])
  useEffect(() => { setMarks([]); setFrom(''); setTo(''); setLabel(''); setMessage(null); load() }, [load])
  const nowText = clock(currentTimeSec * 1000)
  const save = async () => {
    const fromMs = parseClock(from), toMs = parseClock(to)
    if (fromMs === null || toMs === null) { setMessage('Informe início e fim do trecho (mm:ss).'); return }
    setBusy(true)
    try {
      const { mark } = await api.addCutMark(assetId, { channelId, contentHash, fromMs, toMs: Math.min(toMs, durationMs), label: label.trim() || null })
      setFrom(''); setTo(''); setLabel('')
      setMessage(`Trecho marcado (${KIND[mark.kind].label}): ganha ${(mark.savesMs / 1000).toFixed(1)} s no alinhamento.${mark.kind === 'MIDDLE' ? ' Trecho do meio fica guardado até o motor suportar.' : ''}`)
      load()
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) } finally { setBusy(false) }
  }
  const remove = async (mark: CutMark) => {
    if (!(await confirmAction({ message: `Remover a marcação ${clock(mark.fromMs)} – ${clock(mark.toMs)}?`, confirmLabel: 'REMOVER' }))) return
    try { await api.removeCutMark(assetId, mark.id, channelId); load() } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
  }
  const field = 'w-24 rounded border border-border-subtle bg-surface-container px-2 py-1 font-label-mono text-[12px] text-on-surface'
  return (
    <section className="rounded-lg border border-border-subtle bg-surface-panel p-3 text-[12px]" aria-label="Trechos que podem ser cortados">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="font-label-caps text-[12px] font-bold text-on-surface">TRECHOS QUE PODEM SER CORTADOS</h4>
        <span className="text-[11px] text-outline">Usados no ALINHAR do Master para acertar horário</span>
      </div>
      {marks.length === 0 ? <p className="text-outline">Nenhuma marcação nesta versão do arquivo.</p> : (
        <ul className="mb-2 grid gap-1">
          {marks.map(mark => (
            <li key={mark.id} className="flex flex-wrap items-center gap-2 rounded border border-border-subtle px-2 py-1" title={KIND[mark.kind].hint}>
              <span className={`rounded border px-1 font-label-caps text-[10px] font-bold ${KIND[mark.kind].tone}`}>{KIND[mark.kind].label}</span>
              <button type="button" className="font-label-mono text-primary hover:underline" onClick={() => onSeek(mark.fromMs / 1000)} title="Ir para o início do trecho">{clock(mark.fromMs)}</button>
              <span className="text-outline">–</span>
              <button type="button" className="font-label-mono text-primary hover:underline" onClick={() => onSeek(mark.toMs / 1000)} title="Ir para o fim do trecho">{clock(mark.toMs)}</button>
              <span className="text-on-surface-variant">ganha {(mark.savesMs / 1000).toFixed(1)} s</span>
              {mark.label && <span className="truncate text-outline">· {mark.label}</span>}
              {canMark && <button type="button" className="btn small ml-auto" onClick={() => void remove(mark)}>REMOVER</button>}
            </li>
          ))}
        </ul>
      )}
      {canMark && (
        <div className="grid gap-2">
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-0.5 text-[11px] text-outline">Início
              <input className={field} value={from} placeholder="mm:ss" onChange={event => setFrom(event.target.value)} aria-label="Início do trecho" />
            </label>
            <div className="flex gap-1">
              <button type="button" className="btn small" onClick={() => setFrom(nowText)} title="Usa o tempo atual do player">AGORA</button>
              <button type="button" className="btn small" onClick={() => setFrom('00:00.0')} title="Trecho a partir do começo do VT">DO COMEÇO</button>
            </div>
            <label className="grid gap-0.5 text-[11px] text-outline">Fim
              <input className={field} value={to} placeholder="mm:ss" onChange={event => setTo(event.target.value)} aria-label="Fim do trecho" />
            </label>
            <div className="flex gap-1">
              <button type="button" className="btn small" onClick={() => setTo(nowText)}>AGORA</button>
              <button type="button" className="btn small" onClick={() => setTo(clock(durationMs))} title="Trecho até o fim do VT">ATÉ O FIM</button>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid flex-1 gap-0.5 text-[11px] text-outline">Observação (opcional)
              <input className="rounded border border-border-subtle bg-surface-container px-2 py-1 text-[12px] text-on-surface" value={label} maxLength={80} placeholder="ex.: depois do lance final" onChange={event => setLabel(event.target.value)} />
            </label>
            <button type="button" className="btn small primary" disabled={busy || !from || !to} onClick={() => void save()}>MARCAR TRECHO</button>
          </div>
          <p className="text-[11px] text-outline">Início e fim encostados nas pontas do VT funcionam já no alinhamento. Trecho no meio fica guardado até o motor suportar corte no meio.</p>
        </div>
      )}
      {message && <p role="status" className="mt-2 text-[12px] text-armed-amber">{message}</p>}
    </section>
  )
}
