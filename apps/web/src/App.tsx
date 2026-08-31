import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { anchorTarget } from '@rplayout/protocol'
import type { AudioLevel, Anchor, EditScope, Trim } from '@rplayout/protocol'
import { api } from './api.js'
import { clock, dur } from './format.js'
import type { ItemView, LibraryAsset, LibraryFolder, Live, RundownView, Snapshot } from './types.js'
import { AddItemDialog } from './components/AddItemDialog.js'
import { AudioDialog } from './components/AudioDialog.js'
import { Explorer } from './components/Explorer.js'
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
  const [folders, setFolders] = useState<LibraryFolder[]>([])
  const [dialog, setDialog] = useState<Dialog>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const toastTimer = useRef<number | null>(null)

  const assets = useMemo<LibraryAsset[]>(
    () => folders.flatMap((folder) => folder.assets),
    [folders],
  )

  const say = useCallback((message: string) => {
    setToast(message)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 3600)
  }, [])

  const absorb = useCallback((snapshot: Snapshot) => {
    if (snapshot.view) setView(snapshot.view)
    setLive(snapshot.live)
  }, [])

  const guard = useCallback(async (action: () => Promise<void>) => {
    try {
      await action()
      setError(null)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Falha inesperada.')
    }
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const [state, library] = await Promise.all([api.state(), api.library()])
        setFolders(library.folders)
        const first = state.rundowns[0]
        if (first) absorb(await api.rundown(first.id))
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : 'Servidor fora do ar.')
      }
    })()
  }, [absorb])

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

  const target = live?.transport.preview ?? null
  const selectedId = target?.kind === 'ITEM' ? target.id : null
  const openAssetId = target?.kind === 'ASSET' ? target.id : null
  const onAirId = live?.transport.onAir?.itemId ?? null

  const onAirItem = view?.items.find((item) => item.item.id === onAirId) ?? null
  const selected = view?.items.find((item) => item.item.id === selectedId) ?? null

  const remainingOnAir = useMemo(() => {
    if (!live?.transport.onAir || !onAirId) return 0
    const scheduled = schedule.get(onAirId)
    return Math.max(0, (scheduled?.duration ?? 0) - live.transport.onAir.elapsed)
  }, [live, onAirId, schedule])

  /** O que a interface desenha no monitor de preview, venha de onde vier. */
  const previewCard = useMemo(() => {
    if (target?.kind === 'ITEM' && selected) {
      return {
        title: selected.item.title,
        duration: schedule.get(selected.item.id)?.duration ?? 0,
        fromExplorer: false,
      }
    }
    if (target?.kind === 'ASSET') {
      const asset = assets.find((candidate) => candidate.id === target.id)
      if (asset) {
        return { title: asset.title, duration: asset.durationFrames, fromExplorer: true }
      }
    }
    return null
  }, [target, selected, schedule, assets])

  /**
   * Próximo item com hora marcada. É a informação que o operador realmente
   * precisa no alto da tela: quanto falta para o compromisso seguinte.
   */
  const commitment = useMemo(() => {
    if (!view || !live) return null
    for (const item of view.items) {
      if (item.item.anchor.kind === 'FLOW') continue
      const scheduled = schedule.get(item.item.id)
      if (!scheduled || scheduled.state === 'DROPPED') continue
      if (scheduled.start <= live.now) continue
      return { title: item.item.title, at: scheduled.start, left: scheduled.start - live.now }
    }
    return null
  }, [view, live, schedule])

  const totalDuration = useMemo(
    () =>
      (view?.schedule.items ?? [])
        .filter((item) => item.state !== 'DROPPED')
        .reduce((sum, item) => sum + item.duration, 0),
    [view],
  )

  const command = useCallback(
    (action: 'take' | 'cue' | 'stop' | 'park', body?: { itemId?: string; assetId?: string }) =>
      guard(async () => {
        if (!view) return
        absorb(await api.transport(view.channel.id, action, body))
      }),
    [view, guard, absorb],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const element = event.target as HTMLElement | null
      const typing = element?.tagName === 'INPUT' || element?.tagName === 'SELECT'

      if (event.key === 'Escape') {
        setDialog(null)
        return
      }
      if (typing || dialog) return

      if (event.code === 'Space') {
        event.preventDefault()
        if (selectedId) void command('take', { itemId: selectedId })
      }
      if (event.key === 'i' && selected?.asset) setDialog({ kind: 'trim', view: selected })
      if (event.key === 'n' && selected?.asset) setDialog({ kind: 'audio', view: selected })

      // Setas andam pela grade armando linha a linha, sem tirar a mão do teclado.
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const items = view?.items ?? []
        if (items.length === 0) return
        const current = items.findIndex((item) => item.item.id === selectedId)
        const step = event.key === 'ArrowDown' ? 1 : -1
        const nextIndex = current < 0 ? 0 : Math.min(items.length - 1, Math.max(0, current + step))
        const nextItem = items[nextIndex]
        if (nextItem) void command('cue', { itemId: nextItem.item.id })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dialog, selected, selectedId, command, view])

  const applyTrim = (trim: Trim, scope: EditScope): void => {
    const item = dialog?.kind === 'trim' ? dialog.view : null
    if (!item) return
    setDialog(null)
    void guard(async () => {
      const result = await api.setTrim(item.item.id, trim, scope)
      absorb(result)
      say(result.result.message)
    })
  }

  const applyAudio = (audio: AudioLevel, scope: EditScope): void => {
    const item = dialog?.kind === 'audio' ? dialog.view : null
    if (!item) return
    setDialog(null)
    void guard(async () => {
      const result = await api.setAudio(item.item.id, audio, scope)
      absorb(result)
      say(result.result.message)
    })
  }

  const addItem = (mediaId: string, anchor: Anchor, title: string): void => {
    if (!view) return
    setDialog(null)
    void guard(async () => {
      absorb(await api.addItem(view.rundown.id, { mediaId, type: 'VT', title, anchor }))
      const at = anchorTarget(anchor)
      say(
        at === null
          ? 'Item inserido no fim da grade.'
          : `Item inserido em ${clock(at, view.channel.rate)}; a grade foi remanejada.`,
      )
    })
  }

  const saveNotes = (id: string, notes: string): void => {
    void guard(async () => {
      absorb(await api.patchItem(id, { notes: notes.trim() === '' ? null : notes }))
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
  const near = commitment !== null && commitment.left <= 60 * (rate.num / rate.den)

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          RPlayout<span>.</span>
        </div>
        <div className={`tally${onAirId ? ' live' : ''}`}>
          <span className="dot" />
          {onAirId ? 'NO AR' : 'FORA DO AR'}
        </div>
        {live.transport.standby && <div className="standby">ARMADO</div>}
        <div className="meta">
          <b>{view.channel.name}</b>
        </div>

        {commitment && (
          <div className={`commitment${near ? ' near' : ''}`}>
            <div>
              <div className="lbl">entra às {clock(commitment.at, rate)}</div>
              <div className="who">{commitment.title}</div>
            </div>
            <div className="cd">{dur(commitment.left, rate)}</div>
          </div>
        )}

        <div className="spacer" />
        <div className="bigclock">{clock(live.now, rate)}</div>
      </header>

      <div className="main">
        <aside className="pane">
          <div className="pane-title">
            arquivos<span className="count">{assets.length}</span>
          </div>
          <Explorer
            folders={folders}
            rate={rate}
            openAssetId={openAssetId}
            onPreview={(assetId) => void command('cue', { assetId })}
            onInsert={(assetId) => setDialog({ kind: 'add', assetId })}
          />
        </aside>

        <section className="pane" style={{ background: 'var(--bg)' }}>
          <div className="pane-title">
            {view.rundown.name}
            <span className="count">
              {view.items.length} itens · {dur(totalDuration, rate)}
              {view.rundown.loop && ' · em loop'}
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
              onSelect={(id) => void command('cue', { itemId: id })}
              onOpenTrim={(item) => setDialog({ kind: 'trim', view: item })}
              onOpenAudio={(item) => setDialog({ kind: 'audio', view: item })}
              onNotes={saveNotes}
            />
          </div>
        </section>

        <aside className="pane">
          <Monitors
            channel={view.channel}
            live={live}
            onAirItem={onAirItem}
            onAirRemaining={remainingOnAir}
            preview={previewCard}
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
                    onClick={() => void command('cue', { itemId: conflict.itemId })}
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
        <button
          className="btn take"
          disabled={!selectedId}
          onClick={() => selectedId && void command('take', { itemId: selectedId })}
        >
          take<kbd>espaço</kbd>
        </button>
        <button className="btn stop" disabled={!onAirId} onClick={() => void command('stop')}>
          parar
        </button>
        <button className="btn" onClick={() => void command('park')} title="Arma o primeiro item, parado, pronto para entrar">
          armar no topo
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
        {error && (
          <div className="meta" style={{ color: 'var(--onair)' }}>
            {error}
          </div>
        )}
        <div className="meta">
          {previewCard ? (
            <>
              {previewCard.fromExplorer ? 'no preview: ' : 'armado: '}
              <b>{previewCard.title}</b>
            </>
          ) : (
            'nada armado — clique numa linha ou num arquivo'
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
