import { useEffect, useRef, useState } from 'react'
import { api } from '../../api.js'
import type { PgmProbeAutoAction } from '@rplayout/protocol'

type Status = Awaited<ReturnType<typeof api.pgmProbeStatus>>
export function ContingencyLoopPanel({ channelId, status, onChanged, defaultOpen = false }: { channelId: string; status: Status; onChanged: () => Promise<void>; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const [configuration, setConfiguration] = useState<Awaited<ReturnType<typeof api.contingencyLoop>> | null>(null)
  const [revisionId, setRevisionId] = useState('')
  const [failure, setFailure] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [reload, setReload] = useState(0)
  const currentChannel = useRef(channelId)
  currentChannel.current = channelId
  useEffect(() => { setOpen(false); setConfiguration(null); setRevisionId(''); setFailure(null); setPending(false) }, [channelId])
  useEffect(() => {
    if (!open) return
    let active = true
    void api.contingencyLoop(channelId).then(next => {
      if (!active) return
      setConfiguration(next); setRevisionId(next.loopRevisionId ?? ''); setFailure(null)
    }).catch(error => { if (active) setFailure(error instanceof Error ? error.message : String(error)) })
    return () => { active = false }
  }, [channelId, open, reload])
  const execute = async (action: 'CONFIGURE' | 'ENTER' | 'RETURN') => {
    if (action === 'ENTER' && !window.confirm('Acionar a playlist de contingência? O arquivo aprovado será preparado e cortará o PGM somente após confirmação do engine. A posição do item anterior será preservada; o retorno é manual.')) return
    if (action === 'RETURN' && !window.confirm('Retornar ao VT na posição preservada? A mídia e a publicação serão conferidas antes do corte. Desligue a intervenção automática para evitar novo disparo.')) return
    setPending(true); setFailure(null)
    try { await api.setContingencyLoop(channelId, action, action === 'CONFIGURE' ? revisionId || null : undefined); if (currentChannel.current !== channelId) return; setReload(value => value + 1); await onChanged() }
    catch (error) { if (currentChannel.current === channelId) setFailure(error instanceof Error ? error.message : String(error)) }
    finally { if (currentChannel.current === channelId) setPending(false) }
  }
  const policy = async (action: PgmProbeAutoAction) => {
    setPending(true); setFailure(null)
    try { await api.setPgmProbePolicy(channelId, false, action); if (currentChannel.current === channelId) await onChanged() }
    catch (error) { if (currentChannel.current === channelId) setFailure(error instanceof Error ? error.message : String(error)) }
    finally { if (currentChannel.current === channelId) setPending(false) }
  }
  const active = status.contingency?.active === true
  return <div className="rounded border border-border-subtle bg-surface-panel">
    <button type="button" className="flex w-full items-center justify-between px-3 py-2 text-[11px] font-label-caps" onClick={() => setOpen(value => !value)} aria-expanded={open}>
      <span>{active ? 'LOOP DE CONTINGÊNCIA NO PGM' : 'CONFIGURAR CONTINGÊNCIA E RETORNO'}</span><span>{open ? '−' : '+'}</span>
    </button>
    {open && <div className="space-y-3 border-t border-border-subtle px-3 py-3 text-[11px]">
      <p className="text-outline">Selecione uma revisão publicada com loop, avanço automático e apenas vídeos aprovados com cópia local verificada. Salvar a configuração não altera PGM ou CUE. Comandos externos não são repetidos na reserva.</p>
      <label className="block space-y-1">Playlist publicada para reserva
        <select aria-label="Playlist publicada para contingência" className="block w-full rounded border border-border-subtle bg-surface-card p-2" value={revisionId} disabled={pending || status.automaticActionsEnabled || Boolean(status.contingency)} onChange={event => setRevisionId(event.target.value)}>
          <option value="">Nenhuma configurada</option>
          {configuration?.loopRevisionId && !configuration.options.some(option => option.revisionId === configuration.loopRevisionId) && <option value={configuration.loopRevisionId}>Revisão substituída — selecione novamente</option>}
          {configuration?.options.map(option => <option key={option.revisionId} value={option.revisionId}>{option.name} · {option.date} · revisão {option.revision}</option>)}
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="rounded border border-border-subtle px-3 py-2 disabled:opacity-40" disabled={pending || !configuration || status.automaticActionsEnabled || Boolean(status.contingency)} onClick={() => void execute('CONFIGURE')}>VERIFICAR E SALVAR RESERVA</button>
        <button type="button" className="rounded border border-armed-amber px-3 py-2 text-armed-amber disabled:opacity-40" disabled={pending || !configuration?.nativeEngine || !configuration.loopRevisionId || configuration.loopRevisionId !== revisionId || active} onClick={() => void execute('ENTER')}>ACIONAR LOOP NO PGM</button>
        <button type="button" className="rounded border border-status-ok px-3 py-2 text-status-ok disabled:opacity-40" disabled={pending || !active || status.automaticActionsEnabled} onClick={() => void execute('RETURN')}>RETORNAR AO VT PRESERVADO</button>
      </div>
      <label className="block space-y-1">Ação automática da sonda
        <select aria-label="Ação automática da sonda PGM" className="block w-full rounded border border-border-subtle bg-surface-card p-2" value={status.thresholds.defaultAutoAction} disabled={pending || status.automaticActionsEnabled} onChange={event => void policy(event.target.value as PgmProbeAutoAction)}>
          <option value="SLATE_INJECTED">Slate opaco configurado</option><option value="CONTINGENCY_LOOP">Playlist de contingência verificada</option><option value="FAILOVER_HOST_B" disabled>Outro host — configuração/homologação pendente</option>
        </select>
      </label>
      {status.automaticActionsEnabled && <p className="text-armed-amber">Desligue AUTO antes de mudar a configuração ou retornar ao VT.</p>}
      {configuration && !configuration.nativeEngine && <p className="text-armed-amber">Canal simulado: configuração editorial disponível, sem acionamento real de PGM.</p>}
      {active && <p>Retorno preservado: {status.contingency?.itemId ? `${status.contingency.itemId} · último cursor reportado: ${status.contingency.elapsed} frames` : 'Sem item anterior; saída exige CUE/TAKE explícito.'}</p>}
      {failure && <p role="alert" className="text-armed-amber">{failure}</p>}
      {pending && <p role="status">Verificando mídia e confirmação do engine…</p>}
    </div>}
  </div>
}
