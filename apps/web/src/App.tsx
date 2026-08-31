import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { anchorTarget } from '@rplayout/protocol'
import type { AudioLevel, Anchor, EditScope, MediaAsset, Trim } from '@rplayout/protocol'
import { api } from './api.js'
import { clock, dur, lufs } from './format.js'
import type { ItemView, Live, RundownView, Snapshot } from './types.js'
import { AddItemDialog } from './components/AddItemDialog.js'
import { AudioDialog } from './components/AudioDialog.js'
import { Monitors } from './components/Monitors.js'
import { Rundown } from './components/Rundown.js'
import { TrimDialog } from './components/TrimDialog.js'

type Dialog =
  | { kind: 'trim'; view: ItemView }
  | { kind: 'audio'; view: ItemView }
  | { kind: 'add'; assetId?: string }
  | null

export function App() {
  const [view, setView] = useState<RundownView | null>(null)
  const [live, setLive] = useState<Live | null>(null)
  const [assets, setAssets] = useState<MediaAsset[]>([])
  const [dialog, setDialog] = useState<Dialog>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const toastTimer = useRef<number | null>(null)

  const say = useCallback((message: string) => {
    setToast(message)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 3600)
  }, [])

  const absorb = useCallback((snapshot: Snapshot) => {
    if (snapshot.view) setView(snapshot.view)
    setLive(snapshot.live)
  }, [])

  const guard = useCallback(
    async (action: () => Promise<void>) => {
      try {
        await action()
        setError(null)
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : 'Falha inesperada.')
      }
    },
    [],
  )

  // Carga inicial: primeira grade do primeiro canal.
  useEffect(() => {
    void (async () => {
      try {
        const [state, catalogue] = await Promise.all([api.state(), api.assets()])
        setAssets(catalogue.assets)
        const first = state.rundowns[0]
        if (first) absorb(await api.rundown(first.id))
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : 'Servidor fora do ar.')
      }
    })()
  }, [absorb])

  // Estado ao vivo. A grade chega inteira quando muda de forma; o resto é o
  // relógio, o transporte e os medidores.
  useEffect(() => {
    const socket = new WebSocket(`ws://${window.location.host}/ws`)
    socket.addEventListener('message', (event: MessageEvent<string>) => {
      const payload = JSON.parse(event.data) as
        | { type: 'view'; view: RundownView | null }
        | ({ type: 'live' } & Live)
      if (payload.type === 'view') {
        if (payload.view) setView(payload.view)
      } else {
        setLive({ transport: payload.transport, now: payload.now, meters: payload.meters })
      }
    })
    return () => socket.close()
  }, [])

  const schedule = useMemo(
    () => new Map((view?.schedule.items ?? []).map((item) => [item.id, item])),
    [view],
  )

  const errorIds = useMemo(
    () =>
      new Set(
        (view?.schedule.conflicts ?? [])
          .filter((conflict) => conflict.severity === 'ERROR')
          .map((conflict) => conflict.itemId),
      ),
    [view],
  )

  // Selecionar uma linha é armar o preview: quem manda é o estado do canal, não
  // um destaque só de tela. Assim o medidor de preview mostra o que está armado.
  const selectedId = live?.transport.previewItemId ?? null
  const onAirId = live?.transport.onAir?.itemId ?? null
  const onAirItem = view?.items.find((item) => item.item.id === onAirId) ?? null
  const selected = view?.items.find((item) => item.item.id === selectedId) ?? null

  const remainingOnAir = useMemo(() => {
    if (!live?.transport.onAir || !onAirId) return 0
    const scheduled = schedule.get(onAirId)
    return Math.max(0, (scheduled?.duration ?? 0) - live.transport.onAir.elapsed)
  }, [live, onAirId, schedule])

  const cue = useCallback(
    (itemId: string | null) =>
      guard(async () => {
        if (!view) return
        absorb(await api.transport(view.channel.id, 'cue', itemId))
      }),
    [view, guard, absorb],
  )

  const take = useCallback(
    (itemId: string | null) =>
      guard(async () => {
        if (!view || !itemId) return
        absorb(await api.transport(view.channel.id, 'take', itemId))
      }),
    [view, guard, absorb],
  )

  const stop = useCallback(
    () =>
      guard(async () => {
        if (!view) return
        absorb(await api.transport(view.channel.id, 'stop'))
      }),
    [view, guard, absorb],
  )

  // Atalhos de estúdio. Espaço só vale fora dos campos de texto.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'SELECT'

      if (event.key === 'Escape') {
        setDialog(null)
        return
      }
      if (typing || dialog) return

      if (event.code === 'Space') {
        event.preventDefault()
        void take(selectedId)
      }
      if (event.key === 'i' && selected?.asset) setDialog({ kind: 'trim', view: selected })
      if (event.key === 'n' && selected?.asset) setDialog({ kind: 'audio', view: selected })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dialog, selected, selectedId, take])

  const applyTrim = (trim: Trim, scope: EditScope): void => {
    const target = dialog?.kind === 'trim' ? dialog.view : null
    if (!target) return
    setDialog(null)
    void guard(async () => {
      const result = await api.setTrim(target.item.id, trim, scope)
      absorb(result)
      say(result.result.message)
    })
  }

  const applyAudio = (audio: AudioLevel, scope: EditScope): void => {
    const target = dialog?.kind === 'audio' ? dialog.view : null
    if (!target) return
    setDialog(null)
    void guard(async () => {
      const result = await api.setAudio(target.item.id, audio, scope)
      absorb(result)
      say(result.result.message)
    })
  }

  const addItem = (mediaId: string, anchor: Anchor, title: string): void => {
    if (!view) return
    setDialog(null)
    void guard(async () => {
      absorb(await api.addItem(view.rundown.id, { mediaId, type: 'VT', title, anchor }))
      const target = anchorTarget(anchor)
      say(
        target === null
          ? 'Item inserido no fim da grade.'
          : `Item inserido em ${clock(target, view.channel.rate)}; a grade foi remanejada.`,
      )
    })
  }

  if (!view || !live) {
    return (
      <div className="app">
        <div className="empty" style={{ padding: 32 }}>
          {error ?? 'Carregando a grade…'}
        </div>
      </div>
    )
  }

  const rate = view.channel.rate
  const drift = live.transport.onAir
    ? live.transport.onAir.startedAt - (schedule.get(live.transport.onAir.itemId)?.start ?? 0)
    : 0

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          RPlayout<span>.</span>
        </div>
        <div className={`tally${onAirId ? ' live' : ''}`}>
          <span className="dot" />
          {onAirId ? 'NO AR' : 'PARADO'}
        </div>
        <div className="meta">
          <b>{view.channel.name}</b> · {view.channel.width}×{view.channel.height} ·{' '}
          {Math.round(rate.num / rate.den)}p
        </div>
        <div className="meta">
          alvo <b>{view.channel.targetLufs} LUFS</b> · teto <b>{view.channel.ceilingDbtp} dBTP</b>
        </div>
        <div className="meta">
          clock <b>{view.channel.programSdiDeviceId ? 'DECKLINK' : 'SISTEMA'}</b>
        </div>
        <div className="meta">
          drift{' '}
          <b style={{ color: Math.abs(drift) > rate.num ? 'var(--next)' : 'var(--ok)' }}>
            {drift === 0 ? '00:00' : `${drift > 0 ? '+' : '−'}${dur(Math.abs(drift), rate)}`}
          </b>
        </div>
        <div className="spacer" />
        <div className="bigclock">{clock(live.now, rate)}</div>
      </header>

      <div className="main">
        <aside className="pane">
          <div className="pane-title">
            acervo<span className="count">{assets.length}</span>
          </div>
          <div className="pane-body">
            {assets.map((asset) => (
              <div
                key={asset.id}
                className="asset"
                onClick={() => setDialog({ kind: 'add', assetId: asset.id })}
                title="Inserir na grade"
              >
                <div className="name">{asset.title}</div>
                <div className="dur">{dur(asset.durationFrames, rate)}</div>
                <div className="sub">
                  {asset.loudnessFile
                    ? `${lufs(asset.loudnessFile.integratedLufs)} LUFS · pico ${asset.loudnessFile.truePeakDbtp.toFixed(1)}`
                    : 'sem medição'}
                  {asset.defaultTrim ? ' · corte padrão' : ''}
                  {asset.defaultAudio ? ' · nível padrão' : ''}
                </div>
              </div>
            ))}
          </div>
        </aside>

        <section className="pane" style={{ background: 'var(--bg)' }}>
          <div className="pane-title">
            {view.rundown.name}
            <span className="count">
              termina {clock(view.schedule.endsAt, rate)}
            </span>
          </div>
          <div className="pane-body">
            <Rundown
              items={view.items}
              schedule={schedule}
              rate={rate}
              selectedId={selectedId}
              onAirId={onAirId}
              remainingOnAir={remainingOnAir}
              errorIds={errorIds}
              onSelect={(id) => void cue(id)}
              onOpenTrim={(target) => setDialog({ kind: 'trim', view: target })}
              onOpenAudio={(target) => setDialog({ kind: 'audio', view: target })}
            />
          </div>
        </section>

        <aside className="pane">
          <Monitors
            channel={view.channel}
            live={live}
            onAirItem={onAirItem}
            onAirRemaining={remainingOnAir}
            previewItem={selected}
          />
          <div className="pane-title">
            conflitos
            <span className="count">{view.schedule.conflicts.length}</span>
          </div>
          <div className="pane-body">
            {view.schedule.conflicts.length === 0 ? (
              <div className="empty">A grade fecha. Nenhuma âncora em risco.</div>
            ) : (
              view.schedule.conflicts.map((conflict, index) => {
                const owner = view.items.find((item) => item.item.id === conflict.itemId)
                const fix = view.schedule.suggestions.find(
                  (suggestion) => suggestion.itemId === conflict.itemId,
                )
                return (
                  <div
                    key={index}
                    className={`conflict${conflict.severity === 'ERROR' ? ' err' : ''}`}
                    onClick={() => void cue(conflict.itemId)}
                  >
                    <div className="who">{owner?.item.title ?? conflict.itemId}</div>
                    <div>{conflict.message}</div>
                    {fix && <div className="fix">→ {fix.message}</div>}
                  </div>
                )
              })
            )}
          </div>
        </aside>
      </div>

      <footer className="transport">
        <button className="btn take" disabled={!selectedId} onClick={() => void take(selectedId)}>
          take<kbd>espaço</kbd>
        </button>
        <button className="btn stop" disabled={!onAirId} onClick={() => void stop()}>
          parar
        </button>
        <button
          className="btn"
          disabled={!selected?.asset}
          onClick={() => selected && setDialog({ kind: 'trim', view: selected })}
        >
          in/out<kbd>i</kbd>
        </button>
        <button
          className="btn"
          disabled={!selected?.asset}
          onClick={() => selected && setDialog({ kind: 'audio', view: selected })}
        >
          nível<kbd>n</kbd>
        </button>
        <button className="btn" onClick={() => setDialog({ kind: 'add' })}>
          inserir item
        </button>
        <div className="spacer" />
        {error && <div className="meta" style={{ color: 'var(--onair)' }}>{error}</div>}
        <div className="meta">
          {selected ? (
            <>
              armado: <b>{selected.item.title}</b>
            </>
          ) : (
            'nada armado — clique numa linha'
          )}
        </div>
      </footer>

      {dialog?.kind === 'trim' && (
        <TrimDialog
          view={dialog.view}
          rate={rate}
          onCancel={() => setDialog(null)}
          onApply={applyTrim}
        />
      )}
      {dialog?.kind === 'audio' && (
        <AudioDialog
          view={dialog.view}
          channel={view.channel}
          onCancel={() => setDialog(null)}
          onApply={applyAudio}
        />
      )}
      {dialog?.kind === 'add' && (
        <AddItemDialog
          assets={assets}
          initialAssetId={dialog.assetId}
          rate={rate}
          suggestedAt={view.schedule.endsAt}
          onCancel={() => setDialog(null)}
          onAdd={addItem}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
