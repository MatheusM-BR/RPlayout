import { useCallback, useEffect, useState } from 'react'
import { OVERLAY_SLOTS, overlayAnimationOf, type GraphicTemplate } from '@rplayout/protocol'
import { api, type OverlaySlotState } from '../../api.js'

/** Overlays 1–8, como no vMix: cada slot tem uma arte (título GT importado ou
 * SVG), campos e ENTRA/SAI. O 1 fica atrás, o 8 na frente. */
interface Props { channelId: string }
interface Draft { templateId: string; values: Record<string, string> }

export function OverlaysPanel({ channelId }: Props) {
  const [open, setOpen] = useState(false)
  const [templates, setTemplates] = useState<GraphicTemplate[]>([])
  const [slots, setSlots] = useState<OverlaySlotState[]>([])
  const [drafts, setDrafts] = useState<Record<number, Draft>>({})
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const [list, state] = await Promise.all([api.graphics(channelId), api.overlays(channelId)])
      setTemplates(list.templates)
      setSlots(state.slots)
      setDrafts(current => {
        const next = { ...current }
        for (const slot of state.slots) if (!next[slot.slot]) next[slot.slot] = { templateId: slot.templateId, values: slot.values }
        return next
      })
      setError('')
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível ler os overlays.') }
  }, [channelId])
  useEffect(() => { if (open) void load() }, [open, load])

  const command = async (slot: number, action: 'IN' | 'OUT' | 'CUT' | 'OFF') => {
    const draft = drafts[slot]
    if ((action === 'IN' || action === 'CUT') && !draft?.templateId) { setError(`Overlay ${slot}: escolha a arte.`); return }
    setBusy(slot)
    try {
      const result = await api.overlayCommand(channelId, slot, action === 'IN' || action === 'CUT' ? { action, templateId: draft!.templateId, values: draft!.values } : { action })
      setSlots(result.slots)
      setError('')
    } catch (failure) { setError(failure instanceof Error ? failure.message : `Overlay ${slot} não confirmado.`) }
    finally { setBusy(null) }
  }

  const onAirCount = slots.filter(slot => slot.onAir).length
  return (
    <section className="bg-surface-card border border-border-subtle rounded-xl" aria-label="Overlays 1 a 8">
      <button type="button" className="w-full flex items-center justify-between px-4 py-2 text-left" onClick={() => setOpen(value => !value)} aria-expanded={open}>
        <span className="font-headline-md uppercase tracking-wide text-[14px] font-semibold">Overlays 1–8 · títulos GT</span>
        <span className="font-mono text-[12px] text-outline">{onAirCount ? `${onAirCount} no ar` : 'nenhum no ar'} {open ? '▴' : '▾'}</span>
      </button>
      {open && <div className="px-4 pb-4 grid gap-3">
        {error && <p role="alert" className="text-[12px] text-on-air-crimson">{error}</p>}
        <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
          {Array.from({ length: OVERLAY_SLOTS }, (_, index) => index + 1).map(slot => {
            const state = slots.find(entry => entry.slot === slot)
            const draft = drafts[slot] ?? { templateId: '', values: {} }
            const template = templates.find(entry => entry.id === draft.templateId)
            const animated = template ? overlayAnimationOf(template.svg) !== null : false
            const setDraft = (next: Partial<Draft>) => setDrafts(current => ({ ...current, [slot]: { ...draft, ...next } }))
            return (
              <div key={slot} className={`rounded-lg border p-3 grid gap-2 ${state?.onAir ? 'border-on-air-crimson bg-on-air-crimson/10' : 'border-border-subtle'}`}>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[13px] font-semibold">OVERLAY {slot}</span>
                  <span className={`font-mono text-[11px] ${state?.onAir ? 'text-on-air-crimson' : 'text-outline'}`}>{state?.onAir ? '● NO AR' : 'livre'}</span>
                </div>
                <select className="text-[12px] bg-surface-container border border-border-subtle rounded px-2 py-1" value={draft.templateId} disabled={busy === slot}
                  aria-label={`Arte do overlay ${slot}`}
                  onChange={event => { const next = templates.find(entry => entry.id === event.target.value); setDraft({ templateId: event.target.value, values: Object.fromEntries((next?.fields ?? []).map(field => [field.key, draft.values[field.key] ?? field.defaultValue])) }) }}>
                  <option value="">— escolha a arte —</option>
                  {templates.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
                </select>
                {template && <span className="text-[11px] text-outline">{animated ? 'Animação do título GT' : 'Entra e sai com fade'}</span>}
                {template?.fields.map(field => (
                  <label key={field.key} className="grid gap-1 text-[11px] text-outline">{field.label}
                    <input className="text-[13px] text-on-surface bg-surface-container border border-border-subtle rounded px-2 py-1" value={draft.values[field.key] ?? field.defaultValue}
                      onChange={event => setDraft({ values: { ...draft.values, [field.key]: event.target.value } })} />
                  </label>
                ))}
                <div className="flex gap-2">
                  <button type="button" className="btn primary flex-1" disabled={busy !== null || !draft.templateId} onClick={() => void command(slot, 'IN')}>ENTRA</button>
                  <button type="button" className="btn flex-1" disabled={busy !== null || !state?.onAir} onClick={() => void command(slot, 'OUT')}>SAI</button>
                  <button type="button" className="btn" title="Entra sem animação" disabled={busy !== null || !draft.templateId} onClick={() => void command(slot, 'CUT')}>CORTE</button>
                  <button type="button" className="btn" title="Tira sem animação" disabled={busy !== null || !state?.onAir} onClick={() => void command(slot, 'OFF')}>✕</button>
                </div>
              </div>
            )
          })}
        </div>
        <p className="text-[11px] text-outline">Importe títulos do vMix (.gtzip) em Configurações › grafismo › Gerenciar artes. Overlays ficam em memória: reiniciar o servidor esvazia os slots.</p>
      </div>}
    </section>
  )
}
