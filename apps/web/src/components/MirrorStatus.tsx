import { useEffect, useState } from 'react'
import { api, type ChannelMirror } from '../api.js'
import type { Channel } from '@rplayout/protocol'
import { announceMirrorChange } from '../domain/use-channel-mirror.js'
import { useCan } from '../domain/permissions.js'
import { localDateTime } from '../format.js'

/** Selo do espelho com trava. Travado: o canal só põe no ar a grade espelhada.
 * Quem opera o transporte pode destravar numa emergência (motivo obrigatório,
 * vai para a auditoria) e travar de novo. */
export function MirrorStatus({ channel, mirror, channels, compact = false, onMessage }: {
  channel: Channel; mirror: ChannelMirror; channels: Channel[]; compact?: boolean; onMessage?: (text: string) => void
}) {
  const canOperate = useCan('TRANSPORT')
  const [asking, setAsking] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  useEffect(() => { if (!note) return; const timer = window.setTimeout(() => setNote(null), 8000); return () => window.clearTimeout(timer) }, [note])
  const tell = (text: string) => { setNote(text); onMessage?.(text) }
  const sourceName = channels.find(entry => entry.id === mirror.sourceChannelId)?.name ?? 'outro canal'
  const unlocked = Boolean(mirror.unlockedAt)
  const state = [unlocked ? 'DESTRAVADO' : 'TRAVADO', mirror.lastSyncError ? 'PENDENTE' : mirror.lastSyncAt ? '' : 'AGUARDANDO 1ª PUBLICAÇÃO'].filter(Boolean).join(' · ')
  const tone = mirror.lastSyncError || unlocked ? 'border-armed-amber/60 bg-armed-amber/10 text-armed-amber' : 'border-accent-ice/50 bg-accent-ice/10 text-accent-ice-bright'
  const title = [
    `Espelho de ${sourceName}: este canal roda o que a origem publicar.`,
    unlocked ? `Destravado por ${mirror.unlockedBy ?? '—'} em ${localDateTime(mirror.unlockedAt!)}: ${mirror.unlockReason ?? ''}. Outras grades podem ir ao ar.` : 'Travado: só a grade espelhada vai ao ar.',
    mirror.lastSyncError ? `Pendente: ${mirror.lastSyncError}` : '',
  ].filter(Boolean).join(' ')

  const run = async (work: () => Promise<string>) => {
    setBusy(true)
    try { tell(await work()); announceMirrorChange(); setAsking(false); setReason('') }
    catch (error) { tell(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }

  return (
    <span className="inline-flex flex-wrap max-w-full items-center gap-1.5 min-w-0">
      <span className={`min-w-0 truncate whitespace-nowrap px-1.5 py-0.5 rounded border font-label-caps text-[11px] font-bold ${compact ? "max-w-[14rem]" : ""} ${tone}`} title={title}>
        <span aria-hidden="true" className="material-symbols-outlined align-[-3px] mr-0.5 text-[14px]">{unlocked ? 'lock_open' : 'lock'}</span>ESPELHO ← {sourceName.toUpperCase()}{compact ? '' : ` · ${state}`}
      </span>
      {canOperate && !asking && (unlocked
        ? <button type="button" className="btn small shrink-0" disabled={busy} onClick={() => void run(async () => { const result = await api.lockChannelMirror(channel.id); return result.onMirror ? 'Canal travado de novo no espelho.' : 'Canal travado. A grade no ar não é a espelhada: carregue a grade "Espelho de …" quando for seguro trocar.' })}>TRAVAR</button>
        : <button type="button" className="btn small shrink-0" disabled={busy} title="Emergência: permite pôr outra grade no ar neste canal" onClick={() => setAsking(true)}>DESTRAVAR</button>)}
      {asking && <form className="inline-flex items-center gap-1 shrink-0" onSubmit={event => { event.preventDefault(); void run(async () => { await api.unlockChannelMirror(channel.id, reason); return `Canal destravado. Motivo registrado na auditoria. Trave de novo quando voltar ao espelho de ${sourceName}.` }) }}>
        <input autoFocus aria-label="Motivo do destrave" placeholder="Motivo (vai para a auditoria)" value={reason} maxLength={300} onChange={event => setReason(event.target.value)} className="w-56 rounded border border-armed-amber/60 bg-surface-container px-2 py-0.5 text-[12px] text-on-surface" onKeyDown={event => { if (event.key === 'Escape') { setAsking(false); setReason('') } }} />
        <button type="submit" className="btn small shrink-0" disabled={busy || reason.trim().length < 3}>CONFIRMAR</button>
        <button type="button" className="btn small shrink-0" onClick={() => { setAsking(false); setReason('') }}>CANCELAR</button>
      </form>}
      {note && !onMessage && <span role="status" className="basis-full text-[11px] leading-snug text-armed-amber">{note}</span>}
    </span>
  )
}
