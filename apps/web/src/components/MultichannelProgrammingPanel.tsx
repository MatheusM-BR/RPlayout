import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Channel, Rundown } from '@rplayout/protocol'
import { api, type ChannelMirror } from '../api.js'
import { localDateTime } from '../format.js'

const sameRate = (a: Channel, b: Channel) => a.rate.num * b.rate.den === b.rate.num * a.rate.den

/** Programação multicanal do canal em foco: espelho vinculado (este canal roda
 * o que outro publicar) e cópia independente de uma grade de outro canal.
 * Só Supervisor/Administrador com acesso aos dois canais (o servidor confere). */
export function MultichannelProgrammingPanel({ channel, channels, onMessage, onChanged }: { channel: Channel; channels: Channel[]; onMessage: (text: string) => void; onChanged: () => void }) {
  const [state, setState] = useState<{ mirror: ChannelMirror | null; mirrorsFrom: ChannelMirror[]; canShare: boolean } | null>(null)
  const [rundowns, setRundowns] = useState<Rundown[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [mirrorSource, setMirrorSource] = useState('')
  const [copySource, setCopySource] = useState('')
  const [copyDate, setCopyDate] = useState('')
  const others = useMemo(() => channels.filter(entry => entry.id !== channel.id), [channels, channel.id])
  const compatible = others.filter(entry => sameRate(entry, channel))
  const nameOf = (id: string) => channels.find(entry => entry.id === id)?.name ?? id

  const load = useCallback(async () => {
    try {
      const [programming, snapshot] = await Promise.all([api.channelProgramming(channel.id), api.state()])
      setState(programming); setRundowns(snapshot.rundowns.filter(entry => entry.channelId !== channel.id)); setError(null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível ler a programação multicanal.') }
  }, [channel.id])
  useEffect(() => { setState(null); setMirrorSource(''); setCopySource(''); void load() }, [load])

  const run = async (work: () => Promise<string>) => {
    if (busy) return
    setBusy(true)
    try { onMessage(await work()); onChanged(); await load() }
    catch (cause) { onMessage(cause instanceof Error ? cause.message : 'Operação recusada.') }
    finally { setBusy(false) }
  }
  const mirror = state?.mirror ?? null
  const copyCandidates = rundowns.filter(entry => compatible.some(item => item.id === entry.channelId))

  return (
    <section className="bg-surface-card border border-border-subtle rounded-xl p-space-lg grid gap-4" aria-label="Programação multicanal">
      <div>
        <h3 className="font-headline-md text-[15px] font-bold flex items-center gap-2"><span className="material-symbols-outlined text-primary text-[20px]">hub</span>Programação multicanal // {channel.name}</h3>
        <p className="text-[12px] text-outline">Cada canal é independente. Supervisor ou Administrador com acesso aos dois canais pode espelhar ou copiar a programação. Só entre canais com a mesma cadência.</p>
      </div>
      {error && <p role="alert" className="text-[12px] text-on-air-crimson">{error}</p>}
      {!state && !error && <p className="text-[12px] text-outline">Consultando…</p>}
      {state && !state.canShare && <p className="text-[12px] text-armed-amber">Seu papel não permite copiar ou espelhar programação entre canais.</p>}

      {state && <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border-subtle bg-surface-panel p-3 grid gap-2 content-start">
          <h4 className="font-label-caps text-[12px] font-bold">ESPELHO VINCULADO</h4>
          {mirror ? <>
            <p className="text-[13px]">Este canal roda o que <strong>{nameOf(mirror.sourceChannelId)}</strong> publicar. A grade espelhada não é editada aqui.</p>
            <p className="text-[12px] text-outline">Ligado por {mirror.createdBy ?? '—'} em {localDateTime(mirror.createdAt)} · última sincronização {mirror.lastSyncAt ? localDateTime(mirror.lastSyncAt) : 'ainda não houve'}</p>
            {mirror.unlockedAt ? <p className="text-[12px] text-armed-amber">Destravado por {mirror.unlockedBy ?? '—'} em {localDateTime(mirror.unlockedAt)}: {mirror.unlockReason}. Outras grades podem ir ao ar até alguém travar de novo (Playlist ou Master).</p> : <p className="text-[12px] text-outline">Travado: só a grade espelhada vai ao ar. Em emergência o operador destrava na Playlist ou no Master, com motivo registrado.</p>}
            {mirror.lastSyncError && <p role="alert" className="text-[12px] text-armed-amber">Pendente: {mirror.lastSyncError}</p>}
            <p className="text-[12px] text-outline">Para colocar no ar, carregue a grade "Espelho de …" na Playlist deste canal; depois ela se atualiza a cada publicação da origem.</p>
            <button type="button" className="btn small justify-self-start" disabled={busy || !state.canShare} onClick={() => { if (window.confirm(`Desligar o espelho de ${nameOf(mirror.sourceChannelId)}? A grade espelhada vira uma cópia comum, editável.`)) void run(async () => { await api.setChannelMirror(channel.id, null); return 'Espelho desligado. A grade espelhada ficou como cópia editável.' }) }}>Desligar espelho</button>
          </> : <>
            <p className="text-[12px] text-outline">Vínculo contínuo: tudo que a origem publicar entra neste canal. A grade espelhada fica travada aqui, só a origem edita.</p>
            <label className="grid gap-1 text-[12px] text-outline">Canal de origem
              <select className="rounded border border-border-subtle bg-surface-container px-2 py-1.5 text-[13px] text-on-surface" value={mirrorSource} onChange={event => setMirrorSource(event.target.value)} disabled={!state.canShare || busy}>
                <option value="">— escolha —</option>
                {compatible.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
              </select>
            </label>
            {others.length > compatible.length && <p className="text-[11px] text-outline">{others.length - compatible.length} canal(is) com cadência diferente não aparecem.</p>}
            {state.mirrorsFrom.length > 0 && <p className="text-[12px] text-outline">Este canal é origem de: {state.mirrorsFrom.map(row => nameOf(row.targetChannelId)).join(', ')}. Um canal espelhado não pode ser origem de outro.</p>}
            <button type="button" className="btn small primary justify-self-start" disabled={busy || !state.canShare || !mirrorSource} onClick={() => { if (window.confirm(`Ligar espelho: ${channel.name} passará a rodar a programação publicada em ${nameOf(mirrorSource)}. Continuar?`)) void run(async () => { const result = await api.setChannelMirror(channel.id, mirrorSource); return result.initial ? (result.initial.ok ? `Espelho ligado e sincronizado (${result.initial.items ?? 0} itens). Carregue a grade espelhada na Playlist para pôr no ar.` : `Espelho ligado; primeira sincronização pendente: ${result.initial.error}`) : 'Espelho ligado. A grade chega na próxima publicação da origem.' }) }}>Ligar espelho</button>
          </>}
        </div>

        <div className="rounded-lg border border-border-subtle bg-surface-panel p-3 grid gap-2 content-start">
          <h4 className="font-label-caps text-[12px] font-bold">COPIAR GRADE DE OUTRO CANAL</h4>
          <p className="text-[12px] text-outline">Cópia independente: depois cada canal segue sozinho. Grafismos exclusivos do outro canal não vêm junto.</p>
          <label className="grid gap-1 text-[12px] text-outline">Grade de origem
            <select className="rounded border border-border-subtle bg-surface-container px-2 py-1.5 text-[13px] text-on-surface" value={copySource} onChange={event => setCopySource(event.target.value)} disabled={!state.canShare || busy || Boolean(mirror)}>
              <option value="">— escolha —</option>
              {copyCandidates.map(entry => <option key={entry.id} value={entry.id}>{nameOf(entry.channelId)} · {entry.name} · {entry.date.split('-').reverse().join('/')}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-[12px] text-outline">Data no destino (opcional)
            <input type="date" className="rounded border border-border-subtle bg-surface-container px-2 py-1.5 text-[13px] text-on-surface w-48" value={copyDate} onChange={event => setCopyDate(event.target.value)} disabled={!state.canShare || busy || Boolean(mirror)} />
          </label>
          {mirror && <p className="text-[12px] text-outline">Desligue o espelho para copiar grades para este canal.</p>}
          <button type="button" className="btn small primary justify-self-start" disabled={busy || !state.canShare || !copySource || Boolean(mirror)} onClick={() => void run(async () => { const report = await api.copyRundownToChannel(channel.id, { copyFromRundownId: copySource, ...(copyDate ? { date: copyDate } : {}) }); setCopySource(''); return `Grade copiada: ${report.items} itens.${report.skippedGraphics ? ` ${report.skippedGraphics} grafismo(s) exclusivo(s) do outro canal ficaram de fora.` : ''}${report.unboundLive ? ` ${report.unboundLive} live(s) sem fonte equivalente cadastrada neste canal.` : ''} Publique na Playlist deste canal.` })}>Copiar para {channel.name}</button>
        </div>
      </div>}
    </section>
  )
}
