import { useEffect, useMemo, useState } from 'react'
import { framesToMs, msToFrames, qcApproved, resolveTrim, type Channel, type Rate } from '@rplayout/protocol'
import { api, type AlignmentAction, type CutMark } from '../api.js'
import type { Categoria, LibraryAsset, RundownView } from '../types.js'
import { ALIGN_TOLERANCE_MS, cutProposal, fillProposals, focusStatus, type FocusStatus } from '../domain/alignment.js'
import { countdownText } from '../domain/broadcast-cues.js'
import { gradeInstant } from '../domain/wall-clock.js'
import { parseHms } from '../domain/wall-clock.js'
import { useEscape } from '../domain/use-escape.js'

const hms = (ms: number) => new Date(ms).toLocaleTimeString('pt-BR')
/** Duração (arredonda); countdownText é para contagem (arredonda para cima). */
const durationText = (ms: number) => countdownText(Math.round(ms / 1000) * 1000)

export interface FocusChoice { itemId: string; targetHms: string | null }
const KEY = (channelId: string) => `rplayout:focus:${channelId}`

/** Item em foco da estação (por canal). Só conveniência local: sem
 * armazenamento, vale até recarregar a tela. */
export function useFocusItem(channelId: string): [FocusChoice | null, (value: FocusChoice | null) => void] {
  const read = (): FocusChoice | null => { try { const raw = window.localStorage.getItem(KEY(channelId)); return raw ? JSON.parse(raw) as FocusChoice : null } catch { return null } }
  const [focus, setFocusState] = useState<FocusChoice | null>(read)
  useEffect(() => { setFocusState(read()) }, [channelId]) // eslint-disable-line react-hooks/exhaustive-deps
  const setFocus = (value: FocusChoice | null) => {
    setFocusState(value)
    try { if (value) window.localStorage.setItem(KEY(channelId), JSON.stringify(value)); else window.localStorage.removeItem(KEY(channelId)) } catch { /* só nesta tela */ }
  }
  return [focus, setFocus]
}

/** Estado do foco calculado da grade no ar. */
export function computeFocus(view: RundownView, focus: FocusChoice | null, nowMs: number): (FocusStatus & { itemId: string }) | null {
  if (!focus) return null
  const rate = view.channel.rate, date = view.rundown.date
  const toMs = (frames: number) => gradeInstant(frames, rate, date).getTime()
  const scheduled = new Map((view.schedule?.items ?? []).map(row => [row.id, row]))
  const rows = view.items.flatMap(entry => {
    const row = scheduled.get(entry.item.id)
    if (!row) return []
    const dropped = row.state === 'DROPPED'
    const frameMs = (frames: number) => framesToMs(frames, rate)
    return [{ id: entry.item.id, title: entry.item.title, startMs: toMs(row.start), endMs: toMs(row.end), dropped, anchor: entry.item.anchor as { kind: string; at?: number }, autoAdjustMs: dropped ? frameMs(row.plannedDuration) : frameMs(row.plannedDuration - row.duration) }]
  })
  const item = view.items.find(entry => entry.item.id === focus.itemId)?.item
  if (!item) return null
  const anchor = item.anchor as { kind: string; at?: number }
  const anchorMs = (anchor.kind === 'FIXED' || anchor.kind === 'HARD_TIME') && typeof anchor.at === 'number' ? toMs(anchor.at) : null
  let operatorTargetMs: number | null = null
  if (focus.targetHms) {
    const seconds = parseHms(focus.targetHms)
    if (seconds !== null) { const base = new Date(nowMs); base.setHours(0, 0, 0, 0); operatorTargetMs = base.getTime() + seconds * 1000; if (operatorTargetMs < nowMs - 12 * 3_600_000) operatorTargetMs += 86_400_000 }
  }
  const status = focusStatus({ focusItemId: focus.itemId, rows, anchorMs, operatorTargetMs, nowMs })
  return status ? { ...status, itemId: focus.itemId } : null
}


/** Cartão do foco: quando o item entra e se a grade chega no horário. */
export function FocusCard({ status, targetHms, onTarget, onClear, onAlign, onAir }: {
  status: FocusStatus & { itemId: string }; targetHms: string | null; onTarget: (hms: string | null) => void; onClear: () => void; onAlign: () => void; onAir: boolean
}) {
  const [draft, setDraft] = useState(targetHms ?? '')
  useEffect(() => setDraft(targetHms ?? ''), [targetHms, status.itemId])
  const soon = status.leftMs <= 60_000
  const tone = status.mode === 'CUT' ? 'border-on-air-crimson/60 bg-on-air-crimson/10' : status.mode === 'FILL' ? 'border-armed-amber/60 bg-armed-amber/10' : 'border-primary/50 bg-primary/10'
  return (
    <div role="status" className={`mt-1 rounded border px-1.5 py-1 text-left text-[11px] leading-snug ${tone}`}>
      <div className="flex items-baseline justify-between gap-2 font-label-caps font-bold">
        <span className="text-primary">FOCO · ENTRA {hms(status.startMs)}</span>
        <span className={`font-timecode-display text-[13px] tabular-nums ${soon ? 'text-armed-amber' : 'text-on-surface'}`}>{onAir ? 'NO AR' : countdownText(Math.max(0, status.leftMs))}</span>
      </div>
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-on-surface-variant" title={status.title}>{status.title}</span>
        <button type="button" className="text-outline hover:text-on-surface" onClick={onClear} title="Tirar o foco" aria-label="Tirar o foco">×</button>
      </div>
      {status.fixed
        ? <div className="text-outline">Horário marcado {status.targetMs !== null ? hms(status.targetMs) : '—'}</div>
        : <form className="flex items-center gap-1" onSubmit={event => { event.preventDefault(); onTarget(draft.trim() ? draft.trim() : null) }}>
            <label className="text-outline" htmlFor={`focus-target-${status.itemId}`}>Alvo</label>
            <input id={`focus-target-${status.itemId}`} value={draft} onChange={event => setDraft(event.target.value)} placeholder="hh:mm:ss" className="w-20 rounded border border-border-subtle bg-surface-container px-1 py-0 font-label-mono text-[11px] text-on-surface" />
            <button type="submit" className="btn small">OK</button>
          </form>}
      {status.autoCutMs > ALIGN_TOLERANCE_MS && !onAir && <div className="font-bold text-on-air-crimson" title="Sem alinhar, o agendador pula itens opcionais e corta o VT anterior no meio para bater o horário.">AGENDADOR CORTA {durationText(status.autoCutMs)} SOZINHO</div>}
      {status.mode && status.diffMs !== null && <div className="mt-0.5 flex items-center justify-between gap-2">
        <span className={`font-bold ${status.mode === 'CUT' ? 'text-on-air-crimson' : status.mode === 'FILL' ? 'text-armed-amber' : 'text-status-ok'}`}>
          {status.mode === 'OK' ? 'NO HORÁRIO' : status.mode === 'FILL' ? `SOBRAM ${countdownText(status.diffMs)} · PREENCHER` : `FALTAM ${countdownText(-status.diffMs)} · CORTAR`}
        </span>
        {status.mode !== 'OK' && !onAir && <button type="button" className="btn small primary" onClick={onAlign}>ALINHAR</button>}
      </div>}
    </div>
  )
}

/** Painel ALINHAR: propostas calculadas para preencher a sobra com VTs
 * aprovados ou recuperar o atraso com opcionais e cortes do QC. Aplica no
 * plano no ar numa revisão só, conferida pelo servidor. */
export function AlignmentDialog({ channel, view, status, onAirItemId, library, categories, onClose, onApplied }: {
  channel: Channel; view: RundownView; status: FocusStatus & { itemId: string }; onAirItemId: string | null
  library: readonly LibraryAsset[]; categories: readonly Categoria[]; onClose: () => void; onApplied: (message: string) => void
}) {
  const rate: Rate = channel.rate
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  const [category, setCategory] = useState(''), [search, setSearch] = useState('')
  const [chosen, setChosen] = useState<string[]>([])
  const [marks, setMarks] = useState<CutMark[]>([])
  useEscape(!busy, onClose)
  const fill = status.mode === 'FILL', needMs = Math.abs(status.diffMs ?? 0)

  // Itens entre o que está no ar e o foco: onde dá para retirar/cortar.
  const between = useMemo(() => {
    const index = view.items.findIndex(entry => entry.item.id === status.itemId)
    const start = onAirItemId ? view.items.findIndex(entry => entry.item.id === onAirItemId) + 1 : 0
    return index > start ? view.items.slice(start, index) : []
  }, [view.items, status.itemId, onAirItemId])
  useEffect(() => {
    if (fill) return
    const ids = [...new Set(between.map(entry => entry.item.mediaId).filter((id): id is string => Boolean(id)))]
    if (!ids.length) return
    void api.cutMarksFor(ids).then(result => setMarks(result.marks)).catch(cause => setError(cause instanceof Error ? cause.message : String(cause)))
  }, [fill, between])

  // Preencher: VTs aprovados neste canal, com a duração que de fato entra (corte padrão).
  const candidates = useMemo(() => [...new Map(library.map(asset => [asset.id, asset])).values()].flatMap(asset => {
    if (asset.kind !== 'VIDEO' || asset.ignored || asset.probeError || !qcApproved(asset.qcStatus)) return []
    if (category && asset.categoryId !== category) return []
    try { const trim = resolveTrim(null, asset, rate).value; const durationMs = framesToMs(trim.out - trim.in, rate); return durationMs > 0 ? [{ key: asset.id, title: asset.title, durationMs }] : [] } catch { return [] }
  }), [library, category, rate])
  const proposals = useMemo(() => fill ? fillProposals(needMs, candidates) : [], [fill, needMs, candidates])

  // Cortar: opcionais (sai inteiro) e marcações de início/fim do QC.
  const cutOptions = useMemo(() => {
    if (fill) return []
    const options: Array<{ key: string; title: string; savesMs: number; action: AlignmentAction | null; note?: string }> = []
    const scheduled = new Map((view.schedule?.items ?? []).map(row => [row.id, row]))
    for (const entry of between) {
      const item = entry.item, row = scheduled.get(item.id)
      const locked = item.locked || item.protected || item.timingFlags?.protected
      const optional = Boolean(item.timingFlags?.optional ?? item.optional)
      const anchored = item.anchor.kind === 'FIXED' || item.anchor.kind === 'HARD_TIME'
      if (optional && !locked && !anchored && row) options.push({ key: `drop:${item.id}`, title: `Retirar "${item.title}"`, savesMs: framesToMs(row.duration, rate), action: { kind: 'DROP', itemId: item.id } })
      if (locked || !item.mediaId || item.type === 'LIVE' || item.sourceRef) continue
      for (const mark of marks.filter(entry2 => entry2.assetId === item.mediaId && entry2.contentHash === entry.asset?.contentHash)) {
        const label = `${mark.kind === 'TAIL' ? 'Sair mais cedo' : mark.kind === 'HEAD' ? 'Entrar mais adiante' : 'Trecho do meio'} em "${item.title}"${mark.label ? ` (${mark.label})` : ''}`
        if (mark.kind === 'MIDDLE') { options.push({ key: `cut:${item.id}:${mark.id}`, title: label, savesMs: mark.savesMs, action: null, note: 'aguarda motor' }); continue }
        const trim = entry.trim
        const next = mark.kind === 'TAIL' ? Math.min(trim.out, msToFrames(mark.fromMs, rate)) - trim.in : trim.out - Math.max(trim.in, msToFrames(mark.toMs, rate))
        const savesMs = framesToMs((trim.out - trim.in) - next, rate)
        if (savesMs > 0 && next > 0) options.push({ key: `cut:${item.id}:${mark.id}`, title: label, savesMs, action: { kind: 'CUT', itemId: item.id, markId: mark.id } })
      }
    }
    return options
  }, [fill, between, marks, view.schedule, rate])
  const applicableCuts = cutOptions.filter(option => option.action)
  const suggestedCut = useMemo(() => fill ? null : cutProposal(needMs, applicableCuts), [fill, needMs, applicableCuts])

  // Seleção inicial: a melhor proposta.
  useEffect(() => {
    if (fill) setChosen(proposals[0]?.keys ?? [])
    else {
      // Um corte por item: se a proposta usar dois no mesmo VT, fica o maior.
      const keys = suggestedCut?.keys ?? [], seen = new Set<string>(), unique: string[] = []
      for (const key of [...keys].sort((a, b) => (applicableCuts.find(o => o.key === b)?.savesMs ?? 0) - (applicableCuts.find(o => o.key === a)?.savesMs ?? 0))) { const item = key.split(':')[1]!; if (!seen.has(item)) { seen.add(item); unique.push(key) } }
      setChosen(unique)
    }
  }, [fill, proposals, suggestedCut]) // eslint-disable-line react-hooks/exhaustive-deps

  const chosenMs = fill
    ? chosen.reduce((sum, key) => sum + (candidates.find(entry => entry.key === key)?.durationMs ?? 0), 0)
    : chosen.reduce((sum, key) => sum + (applicableCuts.find(entry => entry.key === key)?.savesMs ?? 0), 0)
  const restMs = needMs - chosenMs
  const toggleCut = (key: string) => setChosen(current => {
    if (current.includes(key)) return current.filter(entry => entry !== key)
    const item = key.split(':')[1]
    return [...current.filter(entry => entry.split(':')[1] !== item), key]
  })
  const actions = (): AlignmentAction[] => fill
    ? chosen.map(mediaId => ({ kind: 'INSERT', mediaId }))
    : chosen.flatMap(key => { const action = applicableCuts.find(entry => entry.key === key)?.action; return action ? [action] : [] })

  const apply = async () => {
    const list = actions()
    if (!list.length) { setError('Escolha pelo menos um ajuste.'); return }
    setBusy(true); setError(null)
    try {
      const input = { focusItemId: status.itemId, actions: list }
      const review = await api.alignmentReview(channel.id, input)
      const result = await api.applyAlignment(channel.id, input, crypto.randomUUID(), review.reviewToken)
      const moved = review.arrivalDeltaFrames ? framesToMs(review.arrivalDeltaFrames, rate) : 0
      onApplied(`Alinhado no ar (revisão ${result.revision}): a grade chega ${moved >= 0 ? '+' : '−'}${countdownText(Math.abs(moved))} ${moved >= 0 ? 'mais tarde' : 'mais cedo'} ao item em foco.${result.refreshError ? ` ${result.refreshError}` : ''}`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) }
  }

  const visible = candidates.filter(entry => !search.trim() || entry.title.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 60)
  return (
    <div role="dialog" aria-modal="true" aria-label="Alinhar horário" className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4" onClick={() => { if (!busy) onClose() }}>
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-border-strong bg-surface-panel shadow-2xl" onClick={event => event.stopPropagation()}>
        <header className="border-b border-border-subtle p-4">
          <h2 className="font-headline-md text-[16px] font-bold uppercase tracking-wide text-on-surface">Alinhar até “{status.title}”</h2>
          <p className="mt-1 text-[13px] text-on-surface-variant">
            {status.targetMs !== null && <>Horário {new Date(status.targetMs).toLocaleTimeString('pt-BR')} · </>}
            {fill ? <span className="font-bold text-armed-amber">sobram {countdownText(needMs)}: preencher com VTs</span> : <span className="font-bold text-on-air-crimson">faltam {countdownText(needMs)}: recuperar tempo</span>}
          </p>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 text-[13px]">
          {fill ? <>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <select aria-label="Categoria dos VTs" value={category} onChange={event => setCategory(event.target.value)} className="rounded border border-border-subtle bg-surface-container px-2 py-1 text-[12px] text-on-surface">
                <option value="">Todas as categorias</option>
                {categories.map(entry => <option key={entry.id} value={entry.id}>{entry.id}</option>)}
              </select>
              <span className="text-[12px] text-outline">{candidates.length} VTs aprovados neste canal</span>
            </div>
            <h3 className="mb-1 font-label-caps text-[11px] font-bold text-outline">PROPOSTAS CALCULADAS</h3>
            {proposals.length === 0 ? <p className="text-outline">Nenhuma combinação cabe na sobra. Escolha manualmente abaixo ou mude a categoria.</p> : (
              <div className="mb-3 grid gap-1">
                {proposals.map((proposal, index) => (
                  <button type="button" key={index} onClick={() => setChosen(proposal.keys)} className={`rounded border px-2 py-1 text-left ${chosen.join() === proposal.keys.join() ? 'border-primary bg-primary/15' : 'border-border-subtle hover:bg-surface-container'}`}>
                    <span className="font-bold text-on-surface">{proposal.keys.map(key => candidates.find(entry => entry.key === key)?.title).join(' + ')}</span>
                    <span className="ml-2 text-outline">{durationText(proposal.totalMs)} · sobra {durationText(proposal.restMs)}</span>
                  </button>
                ))}
              </div>
            )}
            <h3 className="mb-1 font-label-caps text-[11px] font-bold text-outline">ESCOLHA MANUAL</h3>
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar VT…" aria-label="Buscar VT" className="mb-1 w-full rounded border border-border-subtle bg-surface-container px-2 py-1 text-[12px] text-on-surface" />
            <ul className="grid max-h-48 gap-0.5 overflow-y-auto">
              {visible.map(entry => (
                <li key={entry.key}><label className="flex cursor-pointer items-center gap-2 rounded px-1 hover:bg-surface-container">
                  <input type="checkbox" checked={chosen.includes(entry.key)} onChange={() => setChosen(current => current.includes(entry.key) ? current.filter(key => key !== entry.key) : [...current, entry.key])} />
                  <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                  <span className="font-label-mono text-outline">{durationText(entry.durationMs)}</span>
                </label></li>
              ))}
            </ul>
          </> : <>
            <h3 className="mb-1 font-label-caps text-[11px] font-bold text-outline">O QUE PODE SAIR OU ENCURTAR ANTES DO FOCO</h3>
            {cutOptions.length === 0 ? <p className="text-outline">Nada a recuperar: entre o ar e o foco não há itens opcionais nem VTs com trecho marcado no QC. Marque trechos no QC ou ajuste a grade.</p> : (
              <ul className="grid gap-0.5">
                {cutOptions.map(option => (
                  <li key={option.key}><label className={`flex items-center gap-2 rounded px-1 ${option.action ? 'cursor-pointer hover:bg-surface-container' : 'opacity-50'}`}>
                    <input type="checkbox" disabled={!option.action} checked={chosen.includes(option.key)} onChange={() => toggleCut(option.key)} />
                    <span className="min-w-0 flex-1 truncate">{option.title}</span>
                    <span className="font-label-mono text-outline">{option.note ?? `−${durationText(option.savesMs)}`}</span>
                  </label></li>
                ))}
              </ul>
            )}
            {suggestedCut && !suggestedCut.reaches && <p className="mt-2 text-armed-amber">Mesmo com tudo, recupera só {countdownText(suggestedCut.savedMs)}. O item vai entrar atrasado.</p>}
          </>}
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle p-4">
          <span className={`text-[13px] font-bold ${Math.abs(restMs) <= ALIGN_TOLERANCE_MS ? 'text-status-ok' : 'text-armed-amber'}`}>
            {fill ? `Escolhido ${durationText(chosenMs)} · ${restMs >= 0 ? `sobra ${durationText(restMs)}` : `passa ${durationText(-restMs)}`}` : `Recupera ${durationText(chosenMs)} · ${restMs > 0 ? `ainda faltam ${durationText(restMs)}` : `sobra ${durationText(-restMs)}`}`}
          </span>
          <div className="flex gap-2">
            <button type="button" className="btn" disabled={busy} onClick={onClose}>CANCELAR</button>
            <button type="button" className="btn primary" disabled={busy || !chosen.length || (fill && restMs < -ALIGN_TOLERANCE_MS)} onClick={() => void apply()}>{busy ? 'APLICANDO…' : 'APLICAR NO AR'}</button>
          </div>
          {error && <p role="alert" className="w-full text-[12px] text-on-air-crimson">{error}</p>}
          <p className="w-full text-[11px] text-outline">Vale no plano que está no ar, numa revisão nova conferida pelo servidor. A grade editável não muda; os VTs inseridos entram como opcionais.</p>
        </footer>
      </div>
    </div>
  )
}
