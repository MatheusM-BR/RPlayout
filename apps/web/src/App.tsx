import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { anchorTarget, durationIn, isStill } from '@rplayout/protocol'
import type { AudioLevel, Channel, EditScope, Fit, Trim, ScheduleEventType, TimingFlags } from '@rplayout/protocol'
import { api } from './api.js'
import { clock, dur } from './format.js'
import type {
  HistoryState,
  ItemView,
  LibraryAsset,
  LibraryFolder,
  Live,
  ScanStatus,
  Monitors as MonitorFeeds,
  RundownView,
  Snapshot,
  Categoria,
} from './types.js'
import { AddItemDialog, type NewItem } from './components/AddItemDialog.js'
import { StillDialog } from './components/StillDialog.js'
import { AudioDialog } from './components/AudioDialog.js'
import { Distribution } from './components/Distribution.js'
import { Explorer } from './components/Explorer.js'
import { AsRunPanel } from './components/AsRunPanel.js'
import { Problemas, type Problema } from './components/Problemas.js'
import { AutoFillDialog } from './components/AutoFillDialog.js'
import { ChannelDialog } from './components/ChannelDialog.js'
import { SettingsDialog } from './components/SettingsDialog.js'
import { GraphicsPanel } from './components/GraphicsPanel.js'
import { ItemGraphicsDialog } from './components/ItemGraphicsDialog.js'
import { Monitors } from './components/Monitors.js'
import { Rundown } from './components/Rundown.js'
import { TrimDialog } from './components/TrimDialog.js'
import { PlaylistsDialog } from './components/PlaylistsDialog.js'
import { Login } from './components/Login.js'
import { AuditPanel } from './components/AuditPanel.js'
import { UsersPanel } from './components/UsersPanel.js'
import { DocumentationPanel } from './components/DocumentationPanel.js'
import { WorkspaceShell, type WorkspaceId } from './components/WorkspaceShell.js'
import { QualityControlPanel } from './components/QualityControlPanel.js'
import { MasterControlView } from './views/MasterControlView.js'
import { PlaylistScheduleView } from './views/PlaylistScheduleView.js'
import { QualityControlView } from './views/QualityControlView.js'
import { EngineeringDistributionView } from './views/EngineeringDistributionView.js'
import { AiredView } from './views/AiredView.js'
import { BroadcastHeader } from './components/broadcast/BroadcastHeader.js'
import { DocsView } from './views/DocsView.js'
import { SettingsView } from './views/SettingsView.js'
import { SessionAlertsDialog } from './components/broadcast/SessionAlertsDialog.js'

type Dialog =
  | { kind: 'trim'; view: ItemView }
  | { kind: 'playlists' }
  | { kind: 'still'; view: ItemView }
  | { kind: 'audio'; view: ItemView }
  | { kind: 'add'; assetId?: string; rundownId?: string; onApplied?: (snapshot: Snapshot) => void }
  | { kind: 'distribution' }
  | { kind: 'alerts' }
  | { kind: 'graphics' }
  | { kind: 'itemGraphics'; view: ItemView }
  | { kind: 'asrun' }
  | {
      kind: 'autofill'
      rundownId?: string
      onApplied?: (snapshot: Snapshot) => void
      initialHours?: number
      initialMinutes?: number
      initialStart?: string
      initialEnd?: string
      autoPreview?: boolean
    }
  | { kind: 'channel' }
  | { kind: 'settings' }
  | { kind: 'users' }
  | { kind: 'docs' }
  | { kind: 'audit' }
  | null

export function App() {
  // A interface de playout publicada é um app operacional. Impede que o
  // navegador roube F1 para a ajuda e que o menu nativo apareça sobre a tela;
  // os menus de contexto do próprio Playout chamam preventDefault e continuam
  // disponíveis nos itens da grade e do acervo.
  useEffect(() => {
    const bloquearAjuda = (event: KeyboardEvent): void => {
      if (event.key === 'F1') {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    const bloquearMenuNativo = (event: MouseEvent): void => {
      event.preventDefault()
    }
    window.addEventListener('keydown', bloquearAjuda, true)
    window.addEventListener('contextmenu', bloquearMenuNativo)
    return () => {
      window.removeEventListener('keydown', bloquearAjuda, true)
      window.removeEventListener('contextmenu', bloquearMenuNativo)
    }
  }, [])

  const [view, setView] = useState<RundownView | null>(null)
  const [live, setLive] = useState<Live | null>(null)
  const [folders, setFolders] = useState<LibraryFolder[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [dialog, setDialog] = useState<Dialog>(null)
  /** Uma lista .m3u está sendo arrastada por cima da janela. */
  const [listaSobrevoando, setListaSobrevoando] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryState>({
    canUndo: false,
    canRedo: false,
    undoLabel: null,
    redoLabel: null,
  })
  /** Onde buscar a imagem dos monitores. Nulo enquanto não há servidor de mídia. */
  const [monitors, setMonitors] = useState<MonitorFeeds | null>(null)
  /** Situação da varredura do acervo. */
  const [scan, setScan] = useState<ScanStatus | null>(null)
  /** Canais existentes e a grade de cada um, para a troca de canal. */
  const [channels, setChannels] = useState<Channel[]>([])
  const [rundownOf, setRundownOf] = useState<Record<string, string>>({})
  /** Nome do canal sendo criado, ou nulo quando ninguém está criando. */
  const [newChannel, setNewChannel] = useState<string | null>(null)
  /** Enquanto a primeira consulta não voltou, não dá para dizer que não há canal. */
  const [loading, setLoading] = useState(true)
  const [initializationFailed, setInitializationFailed] = useState(false)
  const [sessionRole, setSessionRole] = useState<string | null>(null)
  const [authRequired, setAuthRequired] = useState(false)
  const [authenticated, setAuthenticated] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  /** Tudo que deu errado nesta sessão, venha de onde vier. */
  const [problemas, setProblemas] = useState<Problema[]>([])
  const proximoProblema = useRef(1)
  /** O que já foi anotado, para não repetir a cada releitura. */
  const vistos = useRef(new Set<string>())
  /** Linhas marcadas para agrupar. Marcar não é armar: o PGM não muda. */
  const [marked, setMarked] = useState<Set<string>>(new Set())
  const [followOnAir, setFollowOnAir] = useState(false)
  const lastClicked = useRef<string | null>(null)
  /**
   * Canal que a tela está mostrando.
   *
   * Numa `ref` porque o ouvinte do WebSocket é montado uma vez e precisa
   * enxergar a troca de canal sem ser remontado -- reconectar a cada troca
   * perderia eventos justamente no instante em que o operador está olhando.
   */
  const channelRef = useRef<string | null>(null)
  const toastTimer = useRef<number | null>(null)

  const [currentWorkspace, setCurrentWorkspace] = useState<WorkspaceId>(() => {
    const requested = new URLSearchParams(window.location.search).get('workspace')
    const known: WorkspaceId[] = [
      'master',
      'playlist',
      'users',
      'monitor',
      'aired',
      'audit',
      'qc',
      'docs',
      'settings',
    ]
    return known.includes(requested as WorkspaceId) ? (requested as WorkspaceId) : 'master'
  })

  const navigateWorkspace = (target: WorkspaceId): void => {
    setCurrentWorkspace(target)
    const url = new URL(window.location.href)
    if (target === 'master') {
      url.searchParams.delete('workspace')
    } else {
      url.searchParams.set('workspace', target)
    }
    window.history.pushState({}, '', url.toString())
  }

  useEffect(() => {
    const onPopState = () => {
      const requested = new URLSearchParams(window.location.search).get('workspace')
      const known: WorkspaceId[] = [
        'master',
        'playlist',
        'users',
        'monitor',
        'aired',
        'audit',
        'qc',
        'docs',
        'settings',
      ]
      setCurrentWorkspace(known.includes(requested as WorkspaceId) ? (requested as WorkspaceId) : 'master')
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('follow-lock', followOnAir)
    if (!followOnAir) return () => document.documentElement.classList.remove('follow-lock')
    const stopPageKeys = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) event.preventDefault()
    }
    window.addEventListener('keydown', stopPageKeys, { capture: true })
    return () => {
      document.documentElement.classList.remove('follow-lock')
      window.removeEventListener('keydown', stopPageKeys, { capture: true })
    }
  }, [followOnAir])

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
    setHistory(snapshot.history)
    setMonitors(snapshot.monitors)
  }, [])

  /**
   * Registra um problema no sino do canto.
   *
   * Erro que aparece por três segundos e some não existe para quem estava
   * olhando o monitor -- e num playout, o operador está olhando o monitor.
   */
  const anotar = useCallback((origem: Problema['origem'], texto: string) => {
    // O mesmo problema não vira cem linhas: a lista do acervo é relida a cada
    // varredura, e sem isto cada leitura repetiria os arquivos quebrados
    // inteiros. Guardar o que já foi anotado é o que mantém a lista legível.
    const chave = `${origem}:${texto}`
    if (vistos.current.has(chave)) return
    vistos.current.add(chave)

    setProblemas((atuais) => {
      const novo: Problema = {
        id: proximoProblema.current++,
        quando: new Date().toLocaleTimeString('pt-BR'),
        origem,
        texto,
      }
      return [novo, ...atuais].slice(0, 200)
    })
  }, [])

  const guard = useCallback(
    async (action: () => Promise<void>) => {
      try {
        await action()
        setError(null)
      } catch (failure) {
        const texto = failure instanceof Error ? failure.message : 'Falha inesperada.'
        setError(texto)
        anotar('SERVIDOR', texto)
      }
    },
    [anotar],
  )

  const refreshLibrary = useCallback(async () => {
    const [library, status, cats] = await Promise.all([
      api.library(),
      api.scanStatus(),
      api.categories(),
    ])
    setFolders(library.folders)
    setScan(status)
    setCategorias(cats.categories)
    return status
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const [state, session] = await Promise.all([api.state(), api.session(), refreshLibrary()])
        setSessionRole(session.label)
        setAuthRequired(session.required)
        setAuthenticated(session.authenticated)
        setChannels(state.channels)
        // Uma grade por canal: a primeira de cada um é a que a troca abre.
        const first: Record<string, string> = {}
        for (const rundown of state.rundowns) first[rundown.channelId] ??= rundown.id
        setRundownOf(first)

        const start = state.rundowns[0]
        if (start) absorb(await api.rundown(start.id))
      } catch (failure) {
        setInitializationFailed(true)
        setError(failure instanceof Error ? failure.message : 'Servidor fora do ar.')
      } finally {
        setLoading(false)
      }
    })()
  }, [absorb, refreshLibrary])

  const login = useCallback(async (username: string, password: string) => {
    const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) })
    const body = await response.json() as { error?: string; label?: string }
    if (!response.ok) { setAuthError(body.error ?? 'Não foi possível entrar.'); return }
    setAuthError(null); setAuthenticated(true); setSessionRole(body.label ?? 'Administrador')
  }, [])

  /**
   * Dispara a varredura e acompanha até acabar.
   *
   * Ler um acervo inteiro leva minutos -- medir loudness custa decodificar o
   * áudio de cada arquivo --, então quem informa o andamento é a consulta, não
   * a resposta do disparo.
   */
  const startScan = useCallback(async (measure: boolean) => {
    try {
      setScan(await api.scan(measure))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não consegui ler a pasta.')
      return
    }

  }, [])

  // Acompanha também varreduras iniciadas pelo servidor ou por outro operador.
  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    let wasRunning = false
    const poll = async (): Promise<void> => {
      try {
        const status = await refreshLibrary()
        if (cancelled) return
        if (wasRunning && !status.running) say(status.error ??
          `Acervo lido: ${status.added} novos, ${status.updated} atualizados, ${status.failed} sem abrir.`)
        wasRunning = status.running
      } catch (failure) {
        if (!cancelled) anotar('SERVIDOR', failure instanceof Error ? failure.message : 'Falha ao atualizar acervo.')
      } finally {
        if (!cancelled) timer = window.setTimeout(() => void poll(), wasRunning ? 1500 : 10_000)
      }
    }
    timer = window.setTimeout(() => void poll(), 1500)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [refreshLibrary, say, anotar])

  // O painel de distribuição tem endereço próprio: dá para deixar aberto numa
  // segunda tela ou mandar o link para quem cuida da entrega.
  useEffect(() => {
    const sync = (): void => {
      if (window.location.hash === '#distribuicao') setDialog({ kind: 'distribution' })
    }
    sync()
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  // Erro de JavaScript na própria tela também é problema do operador: sem
  // isto ele só existiria no console do navegador, que ninguém abre no ar.
  useEffect(() => {
    const naTela = (evento: ErrorEvent): void => anotar('TELA', evento.message)
    const promessa = (evento: PromiseRejectionEvent): void =>
      anotar('TELA', String(evento.reason))
    window.addEventListener('error', naTela)
    window.addEventListener('unhandledrejection', promessa)
    return () => {
      window.removeEventListener('error', naTela)
      window.removeEventListener('unhandledrejection', promessa)
    }
  }, [anotar])

  // Saída que caiu vem no estado ao vivo; entra no sino uma vez por motivo.
  useEffect(() => {
    for (const alerta of live?.alerts ?? []) anotar('SAÍDA', alerta.message)
  }, [live?.alerts, anotar])

  // Arquivo que não abriu é problema de acervo, e o motivo é acionável.
  useEffect(() => {
    for (const asset of assets) {
      if (asset.probeError) anotar('ARQUIVO', `${asset.title}: ${asset.probeError}`)
    }
  }, [assets, anotar])

  useEffect(() => {
    let socket: WebSocket
    let closed = false
    let retry: number | undefined
    const connect = (): void => {
    socket = new WebSocket(`${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`)
    socket.addEventListener('message', (event: MessageEvent<string>) => {
      const payload = JSON.parse(event.data) as
        | { type: 'view'; channelId: string; view: RundownView | null }
        | ({ type: 'live'; channelId: string } & Live)
        | { type: 'library' }

      if (payload.type === 'library') {
        void refreshLibrary().catch((failure: Error) => anotar('SERVIDOR', failure.message))
        return
      }

      // O servidor transmite todos os canais; a tela mostra um. Sem este
      // filtro, dois canais no ar fazem a interface piscar entre os dois.
      if (payload.channelId !== channelRef.current) return

      if (payload.type === 'view') {
        if (payload.view) setView(payload.view)
      } else {
        setLive({
          transport: payload.transport,
          graphic: payload.graphic,
          alerts: payload.alerts,
          now: payload.now,
          meters: payload.meters,
        })
      }
    })
    socket.addEventListener('close', () => {
      if (!closed) retry = window.setTimeout(connect, 2000)
    })
    }
    connect()
    return () => { closed = true; window.clearTimeout(retry); socket.close() }
  }, [refreshLibrary, anotar])

  channelRef.current = view?.channel.id ?? null

  const rate = view?.channel.rate ?? { num: 30000, den: 1001 }

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
        seekable: !selected.item.sourceRef,
      }
    }
    if (target?.kind === 'ASSET' && view) {
      const asset = assets.find((candidate) => candidate.id === target.id)
      if (asset) {
        return {
          title: asset.title,
          duration: durationIn(asset, view.channel.rate),
          fromExplorer: true,
          seekable: true,
        }
      }
    }
    return null
  }, [target, selected, schedule, assets, view])

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

  const nextScheduledItem = useMemo(() => {
    if (!view) return null
    const index = view.items.findIndex((item) => item.item.id === onAirId)
    return view.items.slice(Math.max(0, index + 1)).find((item) => schedule.get(item.item.id)?.state !== 'DROPPED') ?? null
  }, [view, onAirId, schedule])

  const command = useCallback(
    (action: 'take' | 'cue' | 'stop' | 'park' | 'seek', body?: { itemId?: string; assetId?: string; sourceRef?: string; sourceTitle?: string; bus?: 'pgm' | 'pvw'; frames?: number }) =>
      guard(async () => {
        if (!view) return
        absorb(await api.transport(view.channel.id, action, body))
      }),
    [view, guard, absorb],
  )

  const undo = useCallback(
    (direction: 'undo' | 'redo') =>
      guard(async () => {
        if (!view) return
        const result =
          direction === 'undo' ? await api.undo(view.rundown.id) : await api.redo(view.rundown.id)
        absorb(result)
        say(`${direction === 'undo' ? 'Desfeito' : 'Refeito'}: ${result.label}.`)
      }),
    [view, guard, absorb, say],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const element = event.target as HTMLElement | null
      const typing = element?.matches('input, select, textarea') || element?.isContentEditable

      // Preserve edição nativa e comandos dos controles focados.
      if (event.defaultPrevented || event.isComposing) return

      if (event.key === 'Escape') {
        setDialog(null)
        return
      }
      if (typing || dialog) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        void undo(event.shiftKey ? 'redo' : 'undo')
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        void undo('redo')
        return
      }
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return

      if (event.code === 'Space') {
        event.preventDefault()
        const targetItemId = selectedId ?? live?.transport.preparedItemId ?? undefined
        void command('take', targetItemId ? { itemId: targetItemId } : undefined)
        return
      }

      if (element?.closest('button, a, [role="button"]')) return
      // Delete tira da grade. Backspace não: num teclado de notebook ele fica
      // ao lado do Enter e a chance de errar não vale a comodidade.
      if (event.key === 'Delete') {
        event.preventDefault()
        if (marked.size > 0) {
          removerItensEmLote(Array.from(marked))
          setMarked(new Set())
        } else if (selectedId) {
          removerItem(selectedId)
        }
      }
      if (event.key === 'i' && selected?.asset) {
        setDialog({ kind: isStill(selected.asset) ? 'still' : 'trim', view: selected })
      }
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
  }, [dialog, selected, selectedId, command, view, undo])

  const move = (id: string, toIndex: number): void => {
    void guard(async () => {
      absorb(await api.moveItem(id, toIndex))
    })
  }

  const group = (): void => {
    if (!view || marked.size < 2) return
    void guard(async () => {
      absorb(await api.group(view.rundown.id, [...marked]))
      setMarked(new Set())
      say('Bloco criado. Os itens passam a andar juntos.')
    })
  }

  /**
   * Tira o item da grade.
   *
   * O que está no ar não sai: apagar a linha não tira a imagem da tela, e a
   * grade passaria a mentir sobre o que está acontecendo. Parar primeiro é uma
   * decisão consciente; apagar por engano no meio de um VT não é.
   *
   * O resto sai na hora, sem perguntar -- porque desfazer existe e é um Ctrl+Z.
   * Caixa de confirmação em ferramenta de todo dia vira clique automático, e aí
   * não protege ninguém.
   */
  const removerItem = (id: string, targetRundownId?: string, onRemoved?: (id: string) => void): void => {
    if (id === onAirId) {
      say('O item no ar não sai da grade. Pare antes.')
      return
    }
    const alvo = view?.items.find((entry) => entry.item.id === id)
    const targetId = targetRundownId ?? view?.rundown.id
    // Atualização otimista imediata na interface
    if (view && targetId === view.rundown.id) {
      setView({ ...view, items: view.items.filter((entry) => entry.item.id !== id) })
    }
    void guard(async () => {
      const snapshot = await api.removeItem(id)
      if (!targetRundownId || targetRundownId === view?.rundown.id) {
        absorb(snapshot)
      }
      onRemoved?.(id)
      say(`"${alvo?.item.title ?? 'Item'}" saiu da grade — Ctrl+Z traz de volta.`)
    })
  }

  const removerItensEmLote = (ids: string[], targetRundownId?: string, onRemoved?: () => void): void => {
    if (!view || ids.length === 0) return
    const targetId = targetRundownId ?? view.rundown.id
    const onAir = live?.transport.onAir?.itemId
    const validIds = ids.filter((id) => id !== onAir)
    if (validIds.length === 0) {
      say('O item no ar não sai da grade. Pare antes.')
      return
    }
    // Atualização otimista imediata na interface
    if (targetId === view.rundown.id) {
      setView({ ...view, items: view.items.filter((entry) => !validIds.includes(entry.item.id)) })
    }
    void guard(async () => {
      const snapshot = await api.bulkDeleteItems(targetId, validIds)
      if (targetId === view.rundown.id) {
        absorb(snapshot)
      }
      onRemoved?.()
      say(`${validIds.length} item(ns) removido(s) da grade — Ctrl+Z traz de volta.`)
    })
  }

  const ungroup = (blockId: string): void => {
    void guard(async () => {
      absorb(await api.ungroup(blockId))
      say('Bloco desfeito.')
    })
  }

  /** Clique simples arma; shift marca faixa; ctrl marca item a item. */
  const select = (id: string, modifier: 'none' | 'range' | 'toggle'): void => {
    const items = view?.items ?? []

    if (modifier === 'none') {
      setMarked(new Set())
      lastClicked.current = id
      void command('cue', { itemId: id })
      return
    }

    setMarked((current) => {
      const next = new Set(current)
      if (modifier === 'toggle') {
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      }

      const from = items.findIndex((entry) => entry.item.id === (lastClicked.current ?? id))
      const to = items.findIndex((entry) => entry.item.id === id)
      if (from < 0 || to < 0) return next
      for (let index = Math.min(from, to); index <= Math.max(from, to); index++) {
        const entry = items[index]
        if (entry) next.add(entry.item.id)
      }
      return next
    })
    lastClicked.current = id
  }

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

  const addItem = (
    request: NewItem,
    targetRundownId?: string,
    onApplied?: (snapshot: Snapshot) => void,
  ): void => {
    if (!view) return
    const targetId = targetRundownId ?? view.rundown.id
    setDialog(null)
    void guard(async () => {
      const snapshot = await api.addItem(targetId, request)
      if (targetId === view.rundown.id) {
        absorb(snapshot)
      }
      onApplied?.(snapshot)
      const at = anchorTarget(request.anchor)
      say(
        at === null
          ? 'Item inserido no fim da grade.'
          : `Item inserido em ${clock(at, view.channel.rate)}; a grade foi remanejada.`,
      )
    })
  }

  /** Cria um canal e abre a grade dele. Serve à barra e à tela de primeira vez. */
  const createChannel = (): void => {
    const name = (newChannel ?? '').trim()
    if (name === '') return
    setNewChannel(null)
    void guard(async () => {
      const created = await api.addChannel(name)
      const state = await api.state()
      setChannels(state.channels)
      const map: Record<string, string> = {}
      for (const rundown of state.rundowns) map[rundown.channelId] ??= rundown.id
      setRundownOf(map)
      absorb(await api.rundown(created.rundownId))
      say(`${name} criado, com grade vazia.`)
    })
  }

  /**
   * A cor de cada categoria, para a grade e o explorador pintarem a linha.
   *
   * Cor é o que faz o operador achar o bloco comercial no meio de uma grade de
   * cem linhas sem ler nome nenhum.
   */
  const coresDeCategoria = useMemo(
    () => new Map(categorias.map((categoria) => [categoria.id, categoria.color])),
    [categorias],
  )

  /** Categorias que já existem no acervo, para o explorador oferecer. */
  const categories = useMemo(
    () =>
      [...new Set(assets.map((asset) => asset.categoryId).filter((id): id is string => !!id))].sort(),
    [assets],
  )

  /** Arquivo largado na grade: entra na posição em que caiu. */
  const inserirEm = (assetId: string, atIndex: number): void => {
    if (!view) return
    const asset = assets.find((candidate) => candidate.id === assetId)
    void guard(async () => {
      absorb(
        await api.addItem(view.rundown.id, {
          mediaId: assetId,
          type: 'VT',
          title: asset?.title,
          anchor: { kind: 'FLOW' },
          atIndex,
        }),
      )
      say(`${asset?.title ?? 'Arquivo'} inserido na posição ${atIndex + 1}.`)
    })
  }

  const inserirNoFim = (assetId: string): void => {
    if (!view) return
    const asset = assets.find((candidate) => candidate.id === assetId)
    void guard(async () => {
      absorb(
        await api.addItem(view.rundown.id, {
          mediaId: assetId,
          type: 'VT',
          title: asset?.title,
          anchor: { kind: 'FLOW' },
        }),
      )
      say(`${asset?.title ?? 'Arquivo'} no fim da grade.`)
    })
  }

  const removerDoAcervo = (assetId: string): void => {
    const asset = assets.find((candidate) => candidate.id === assetId)
    void guard(async () => {
      const resultado = await api.removeAsset(assetId)
      if (resultado.conflito) {
        // Arquivo em uso não sai calado: a grade que aponta para ele perderia a
        // referência, e quem decide isso é o operador.
        const quantos = resultado.items ?? 0
        if (!window.confirm(`${resultado.conflito}\n\nTirar mesmo assim remove ${quantos} item(ns) da grade.`)) {
          return
        }
        await api.removeAsset(assetId, true)
      }
      await refreshLibrary()
      absorb(await api.rundown(view!.rundown.id))
      say(`${asset?.title ?? 'Arquivo'} saiu do acervo. O arquivo em disco não foi tocado.`)
    })
  }

  const categorizar = (assetId: string, categoryId: string | null): void => {
    void guard(async () => {
      await api.patchAsset(assetId, { categoryId })
      await refreshLibrary()
      say(categoryId ? `Categoria: ${categoryId}.` : 'Categoria removida.')
    })
  }

  const limparQuebrados = (): void => {
    void guard(async () => {
      const resultado = await api.pruneAssets()
      await refreshLibrary()
      if (view) absorb(await api.rundown(view.rundown.id))
      say(
        `${resultado.removed} arquivo(s) que não abriram saíram do acervo` +
          (resultado.removedItems > 0 ? `, e ${resultado.removedItems} item(ns) da grade.` : '.'),
      )
    })
  }

  const setTrack = (id: string, audioTrack: number): void => {
    void guard(async () => {
      absorb(await api.patchItem(id, { audioTrack }))
      say(`Item passa a tocar a ${audioTrack + 1}ª trilha de áudio.`)
    })
  }

  const setFit = (id: string, fit: Fit): void => {
    void guard(async () => {
      absorb(await api.patchItem(id, { fit }))
      say(
        fit === 'CROP'
          ? 'Item enche a tela; a sobra da proporção é cortada.'
          : 'Item entra inteiro, com barra preta na sobra.',
      )
    })
  }

  const saveNotes = (id: string, notes: string): void => {
    void guard(async () => {
      absorb(await api.patchItem(id, { notes: notes.trim() === '' ? null : notes }))
    })
  }

  const aceitarDoAcervo = (assetId: string): void => {
    void guard(async () => {
      await api.patchAsset(assetId, { ignored: false })
      await refreshLibrary()
      say('Arquivo aceito no acervo ativo.')
    })
  }

  const ignorarNoAcervo = (assetId: string): void => {
    void guard(async () => {
      await api.patchAsset(assetId, { ignored: true })
      await refreshLibrary()
      say('Arquivo movido para os ignorados.')
    })
  }

  const trocarCanal = (channelId: string): void => {
    const rundownId = rundownOf[channelId]
    if (!rundownId || channelId === view?.channel.id) return
    void guard(async () => absorb(await api.rundown(rundownId)))
  }

  const exportCsv = (): void => {
    if (!view) return
    const a = document.createElement('a')
    a.href = `/api/rundowns/${view.rundown.id}/export.csv`
    a.download = `grade-${view.channel.name.toLowerCase().replace(/\s+/g, '-')}.csv`
    a.click()
  }

  const inserirItemNaGrade = (
    assetId: string | null,
    atIndex?: number,
    liveConfig?: { sourceRef: string; title: string; durationOverride?: number },
    options?: {
      eventType?: ScheduleEventType
      timingFlags?: TimingFlags
    },
  ): void => {
    if (!view) return
    void guard(async () => {
      const isHardTime = options?.eventType === 'HARD_TIME'
      const isFixed = options?.eventType === 'FIXED'
      const itemAnchor = isHardTime
        ? { kind: 'HARD_TIME' as const, at: 0 }
        : isFixed
          ? { kind: 'FIXED' as const, at: 0 }
          : { kind: 'FLOW' as const }

      if (liveConfig) {
        absorb(
          await api.addItem(view.rundown.id, {
            sourceRef: liveConfig.sourceRef,
            type: 'LIVE',
            title: liveConfig.title,
            durationOverride: liveConfig.durationOverride,
            anchor: itemAnchor,
            eventType: options?.eventType,
            timingFlags: options?.timingFlags,
            trimmable: options?.timingFlags?.trimmable,
            optional: options?.timingFlags?.optional,
            protected: options?.timingFlags?.protected,
            atIndex,
          }),
        )
        say(`Fonte ao vivo "${liveConfig.title}" inserida na grade.`)
      } else if (assetId) {
        const asset = assets.find((candidate) => candidate.id === assetId)
        absorb(
          await api.addItem(view.rundown.id, {
            mediaId: assetId,
            type: options?.eventType === 'FILLER' ? 'FILLER' : 'VT',
            title: asset?.title,
            anchor: itemAnchor,
            eventType: options?.eventType,
            timingFlags: options?.timingFlags,
            trimmable: options?.timingFlags?.trimmable,
            optional: options?.timingFlags?.optional,
            protected: options?.timingFlags?.protected,
            atIndex,
          }),
        )
        say(`"${asset?.title ?? 'Arquivo'}" inserido na grade.`)
      }
    })
  }

  if (authRequired && !authenticated) return <Login onLogin={login} error={authError} />

  // Instalação nova: banco sem canal nenhum. Antes disto a tela ficava em
  // "carregando" para sempre, que é a pior primeira impressão possível --
  // parece defeito e é só falta de canal.
  if (!view && channels.length === 0 && !loading && !initializationFailed) {
    return (
      <div className="app">
        <div className="firstrun">
          <h1>
            RPlayout<span>.</span>
          </h1>
          <p>
            Nenhum canal ainda. Um canal é o que tem grade, saídas e monitores — sem ele não há
            o que operar.
          </p>
          <div className="row">
            <input
              type="text"
              autoFocus
              placeholder="nome do canal"
              value={newChannel ?? ''}
              onChange={(event) => setNewChannel(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && createChannel()}
            />
            <button className="btn take" onClick={createChannel}>
              criar canal
            </button>
          </div>
          <p className="hint">
            O canal nasce no padrão broadcast 1080i59.94 (ou 1080p59.94), com uma grade vazia. Depois aponte
            <code>RPLAYOUT_MEDIA</code> para a sua pasta de vídeos e use <b>LER PASTA</b>: o
            acervo é lido do disco, com duração, loudness e miniatura de cada arquivo.
          </p>
          {error && <p className="hint bad">{error}</p>}
        </div>
      </div>
    )
  }

  if (!view || !live) {
    return (
      <div className="app">
        <div className="firstrun" role={error ? 'alert' : 'status'}>
          <h1>RPlayout<span>.</span></h1>
          <p>{error ? 'Não foi possível carregar o Playout.' : 'Carregando a grade…'}</p>
          {error && <>
            <p className="hint bad">{error}</p>
            <button className="btn" onClick={() => window.location.reload()}>Tentar novamente</button>
          </>}
        </div>
      </div>
    )
  }

  return (
    <div className="w-screen h-screen bg-surface-base text-on-surface select-none overflow-hidden font-sans">
      {currentWorkspace === 'master' && (
        <MasterControlView
          channel={view.channel}
          channels={channels}
          view={view}
          live={live}
          folders={folders}
          scan={scan}
          categorias={categorias}
          monitors={monitors}
          followOnAir={followOnAir}
          onToggleFollowOnAir={() => setFollowOnAir((value) => !value)}
          onTake={(itemId?: string) => void command('take', itemId ? { itemId } : {})}
          onStop={() => void command('stop')}
          onCue={(itemId?: string) => void command('cue', { itemId })}
          onSeek={(bus: 'pvw' | 'pgm', frames: number) =>
            void command('seek', {
              bus,
              frames,
              itemId: bus === 'pgm' ? onAirId ?? undefined : selectedId ?? undefined,
            })
          }
          onStartScan={(measure: boolean) => void startScan(measure)}
          onAddItem={() => setDialog({ kind: 'add' })}
          onAutoFill={() => setDialog({ kind: 'autofill' })}
          onExportCsv={exportCsv}
          onOpenTrim={(item: ItemView) =>
            setDialog({
              kind: item.asset && isStill(item.asset) ? 'still' : 'trim',
              view: item,
            })
          }
          onOpenAudio={(item: ItemView) => setDialog({ kind: 'audio', view: item })}
          onOpenGraphics={(item: ItemView) => setDialog({ kind: 'itemGraphics', view: item })}
          onOpenStill={(item: ItemView) => setDialog({ kind: 'still', view: item })}
          onRemoveItem={(itemId: string) => removerItem(itemId)}
          onBulkRemoveItems={(ids: string[]) => removerItensEmLote(ids)}
          onMoveItem={(itemId: string, toIndex: number) => move(itemId, toIndex)}
          onOpenAlerts={() => setDialog({ kind: 'alerts' })}
          onOpenSettings={() => navigateWorkspace('settings')}
          problemasCount={problemas.length}
          sessionRole={sessionRole ?? 'Operador Master'}
          authRequired={authRequired}
          onNavigate={navigateWorkspace}
          onSelectChannel={trocarCanal}
          onPreviewAsset={(asset: LibraryAsset) => void command('cue', { assetId: asset.id })}
          onPreviewLiveSource={(sourceRef: string, title: string) => void command('cue', { sourceRef, sourceTitle: title })}
          onInsertAsset={inserirItemNaGrade}
          onOpenConflicts={() => setDialog({ kind: 'distribution' })}
        />
      )}

      {currentWorkspace === 'playlist' && (
        <PlaylistScheduleView
          channel={view.channel}
          channels={channels}
          view={view}
          folders={folders}
          categorias={categorias}
          onInsertAsset={inserirItemNaGrade}
          onPreviewAsset={(asset: LibraryAsset) => void command('cue', { assetId: asset.id })}
          onPreviewLiveSource={(sourceRef: string, title: string) => void command('cue', { sourceRef, sourceTitle: title })}
          onCueItem={(itemId: string) => void command('cue', { itemId })}
          onNavigate={navigateWorkspace}
          onSelectChannel={trocarCanal}
          onPublishToMaster={(snapshot?: Snapshot) => {
            void guard(async () => {
              // A edição de horário retorna um snapshot já recalculado. Não
              // buscar outro imediatamente impede que uma resposta anterior
              // da grade vença a atualização acabada de salvar.
              absorb(snapshot ?? await api.rundown(view.rundown.id))
              say('Programação sincronizada com o Master com sucesso!')
            })
          }}
          onOpenAutoFill={(
            rundownId?: string,
            onApplied?: (snapshot: Snapshot) => void,
            options?: {
              initialHours?: number
              initialMinutes?: number
              initialStart?: string
              initialEnd?: string
              autoPreview?: boolean
            },
          ) =>
            setDialog({
              kind: 'autofill',
              rundownId,
              onApplied,
              initialHours: options?.initialHours,
              initialMinutes: options?.initialMinutes,
              initialStart: options?.initialStart,
              initialEnd: options?.initialEnd,
              autoPreview: options?.autoPreview,
            })
          }
          sessionRole={sessionRole ?? 'Operador Master'}
          authRequired={authRequired}
          onAddItem={(rundownId?: string, onApplied?: (snapshot: Snapshot) => void) =>
            setDialog({ kind: 'add', rundownId, onApplied })
          }
          onExportCsv={exportCsv}
          onOpenTrim={(item: ItemView) =>
            setDialog({
              kind: item.asset && isStill(item.asset) ? 'still' : 'trim',
              view: item,
            })
          }
          onOpenAudio={(item: ItemView) => setDialog({ kind: 'audio', view: item })}
          onRemoveItem={(itemId: string, rundownId?: string, onRemoved?: (id: string) => void) =>
            removerItem(itemId, rundownId, onRemoved)
          }
          onBulkRemoveItems={(ids: string[], rundownId?: string, onRemoved?: () => void) =>
            removerItensEmLote(ids, rundownId, onRemoved)
          }
          onOpenSettings={() => navigateWorkspace('settings')}
        />
      )}

      {currentWorkspace === 'qc' && (
        <QualityControlView
          channel={view.channel}
          channels={channels}
          folders={folders}
          scan={scan}
          onAccept={aceitarDoAcervo}
          onIgnore={ignorarNoAcervo}
          onScan={(measure: boolean) => void startScan(measure)}
          onNavigate={navigateWorkspace}
          onSelectChannel={trocarCanal}
          onOpenSettings={() => navigateWorkspace('settings')}
          sessionRole={sessionRole ?? 'Operador Master'}
          authRequired={authRequired}
          monitors={monitors}
          onPreviewLiveSource={(sourceRef: string, title: string) => void command('cue', { sourceRef, sourceTitle: title })}
        />
      )}

      {currentWorkspace === 'monitor' && (
        <EngineeringDistributionView
          channel={view.channel}
          channels={channels}
          onNavigate={navigateWorkspace}
          onSelectChannel={trocarCanal}
          onMessage={say}
          sessionRole={sessionRole ?? 'Operador Master'}
          authRequired={authRequired}
          onOpenSettings={() => navigateWorkspace('settings')}
          live={live}
          monitors={monitors}
        />
      )}

      {currentWorkspace === 'aired' && (
        <AiredView
          channel={view.channel}
          channels={channels}
          onNavigate={navigateWorkspace}
          onSelectChannel={trocarCanal}
          sessionRole={sessionRole ?? 'Operador Master'}
          authRequired={authRequired}
          onOpenSettings={() => navigateWorkspace('settings')}
        />
      )}

      {currentWorkspace === 'docs' && (
        <DocsView
          channel={view.channel}
          channels={channels}
          onNavigate={navigateWorkspace}
          onSelectChannel={trocarCanal}
          sessionRole={sessionRole ?? 'Operador Master'}
          authRequired={authRequired}
          onOpenSettings={() => navigateWorkspace('settings')}
        />
      )}

      {currentWorkspace === 'settings' && (
        <SettingsView
          channel={view.channel}
          channels={channels}
          onNavigate={navigateWorkspace}
          onSelectChannel={trocarCanal}
          sessionRole={sessionRole ?? 'Operador Master'}
          authRequired={authRequired}
          onMessage={say}
          onChanged={() => {
            void guard(async () => {
              const state = await api.state()
              setChannels(state.channels)
              const map: Record<string, string> = {}
              for (const rundown of state.rundowns) map[rundown.channelId] ??= rundown.id
              setRundownOf(map)
              const alvo = map[view.channel.id] ?? state.rundowns[0]?.id
              if (alvo) absorb(await api.rundown(alvo))
            })
          }}
          onOpenFormat={(channelId: string) => {
            if (channelId === view.channel.id) {
              setDialog({ kind: 'channel' })
              return
            }
            const rundownId = rundownOf[channelId]
            if (!rundownId) {
              say('Esse canal ainda não tem grade para abrir.')
              return
            }
            void guard(async () => {
              absorb(await api.rundown(rundownId))
              setDialog({ kind: 'channel' })
            })
          }}
          onOpenDistribution={() => setDialog({ kind: 'distribution' })}
          onOpenGraphics={() => setDialog({ kind: 'graphics' })}
          onOpenAudit={() => setDialog({ kind: 'audit' })}
        />
      )}

      {currentWorkspace === 'users' && (
        <div className="flex flex-col h-screen w-screen bg-surface-base text-on-surface overflow-hidden">
          <BroadcastHeader
            activeWorkspace="settings"
            channel={view.channel}
            channels={channels}
            onSelectChannel={trocarCanal}
            onNavigate={navigateWorkspace}
            sessionRole={sessionRole ?? 'Operador Master'}
            authRequired={authRequired}
            onOpenSettings={() => navigateWorkspace('settings')}
          />
          <main className="flex-1 overflow-y-auto p-gutter broadcast-scroll bg-surface-base">
            <div className="max-w-7xl mx-auto flex flex-col gap-gutter">
              {/* Header da Seção */}
              <div className="flex items-center justify-between border-b border-border-subtle pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                    <span className="material-symbols-outlined text-[24px]">group</span>
                  </div>
                  <div>
                    <h1 className="font-headline-lg text-headline-lg font-bold text-on-surface uppercase tracking-wide">
                      Usuários e Controle de Acesso
                    </h1>
                    <p className="font-body-sm text-body-sm text-outline">
                      Controle quem opera o canal, programa a grade de 24h e administra o sistema.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`font-label-caps text-xs px-3 py-1 rounded font-bold ${
                    authRequired
                      ? 'bg-status-ok/20 text-status-ok-bright border border-status-ok/40'
                      : 'bg-primary/20 text-primary border border-primary/40'
                  }`}>
                    {authRequired ? 'LOGIN AUTENTICADO ATIVO' : 'MODO LOCAL DESENVOLVIMENTO'}
                  </span>
                  <button
                    onClick={() => navigateWorkspace('master')}
                    className="px-3 py-1.5 rounded-lg bg-surface-panel hover:bg-surface-container border border-border-subtle text-on-surface font-label-caps text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[16px]">play_circle</span>
                    <span>Voltar ao Master</span>
                  </button>
                </div>
              </div>

              {!authRequired && (
                <div className="bg-amber-500/10 border border-amber-500/30 text-amber-200 px-4 py-3 rounded-lg flex items-center gap-3">
                  <span className="material-symbols-outlined text-amber-400 text-[20px]">warning</span>
                  <div className="font-body-sm text-xs">
                    <strong>Este servidor está operando em modo local sem senha.</strong>
                    <span className="ml-1 opacity-80">
                      Configure as variáveis de ambiente RPLAYOUT_ADMIN_USER e RPLAYOUT_ADMIN_PASSWORD para exigir login RBAC.
                    </span>
                  </div>
                </div>
              )}

              <UsersPanel onMessage={say} />
            </div>
          </main>
        </div>
      )}

      {currentWorkspace === 'audit' && (
        <div className="flex flex-col h-screen w-screen bg-surface-base text-on-surface overflow-hidden">
          <BroadcastHeader
            activeWorkspace="settings"
            channel={view.channel}
            channels={channels}
            onSelectChannel={trocarCanal}
            onNavigate={navigateWorkspace}
            sessionRole={sessionRole ?? 'Operador Master'}
            authRequired={authRequired}
            onOpenSettings={() => navigateWorkspace('settings')}
          />
          <main className="flex-1 overflow-hidden p-gutter bg-surface-base">
            <div className="max-w-7xl mx-auto h-full flex flex-col gap-gutter">
              <div className="flex items-center justify-between border-b border-border-subtle pb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                    <span className="material-symbols-outlined text-[24px]">policy</span>
                  </div>
                  <div>
                    <h1 className="font-headline-lg text-headline-lg font-bold text-on-surface uppercase tracking-wide">
                      Trilha de Auditoria & Segurança
                    </h1>
                    <p className="font-body-sm text-body-sm text-outline">
                      Auditoria de comandos operacionais, disparos TAKE e ações do sistema.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => navigateWorkspace('master')}
                  className="px-3 py-1.5 rounded-lg bg-surface-panel hover:bg-surface-container border border-border-subtle text-on-surface font-label-caps text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[16px]">play_circle</span>
                  <span>Voltar ao Master</span>
                </button>
              </div>
              <div className="flex-1 min-h-0">
                <AuditPanel onClose={() => navigateWorkspace('master')} isModal={false} />
              </div>
            </div>
          </main>
        </div>
      )}

      {dialog?.kind === 'playlists' && (
        <PlaylistsDialog
          rundownId={view.rundown.id}
          onCancel={() => setDialog(null)}
          onLoaded={(snapshot, message) => {
            absorb(snapshot)
            setDialog(null)
            say(message)
          }}
          onMessage={say}
        />
      )}
      {dialog?.kind === 'trim' && (
        <TrimDialog
          view={dialog.view}
          rate={rate}
          onCancel={() => setDialog(null)}
          onApply={applyTrim}
        />
      )}
      {dialog?.kind === 'still' && (
        <StillDialog
          view={dialog.view}
          rate={rate}
          onCancel={() => setDialog(null)}
          onApply={(frames) => {
            const id = dialog.view.item.id
            setDialog(null)
            void guard(async () => {
              absorb(await api.patchItem(id, { durationOverride: frames }))
              say('Tempo da imagem parada atualizado; a grade foi remanejada.')
            })
          }}
        />
      )}
      {dialog?.kind === 'audio' && (
        <AudioDialog
          // A linha vem da grade viva, não da cópia de quando o diálogo abriu:
          // trocar de trilha aplica na hora e o seletor tem de acompanhar.
          view={view.items.find((item) => item.item.id === dialog.view.item.id) ?? dialog.view}
          channel={view.channel}
          onCancel={() => setDialog(null)}
          onApply={applyAudio}
          onSetTrack={(index) => setTrack(dialog.view.item.id, index)}
        />
      )}
      {dialog?.kind === 'add' && (
        <AddItemDialog
          assets={assets}
          initialAssetId={dialog.assetId}
          rate={rate}
          suggestedAt={view.schedule.endsAt}
          onCancel={() => setDialog(null)}
          onAdd={(req) => addItem(req, dialog.rundownId, dialog.onApplied)}
        />
      )}

      {dialog?.kind === 'itemGraphics' && (
        <ItemGraphicsDialog
          view={dialog.view}
          channelId={view.channel.id}
          onClose={() => setDialog(null)}
          onMessage={say}
        />
      )}
      {dialog?.kind === 'settings' && (
        <SettingsDialog
          channel={view.channel}
          channels={channels}
          onClose={() => setDialog(null)}
          onMessage={say}
          onChanged={() => {
            void guard(async () => {
              const state = await api.state()
              setChannels(state.channels)
              const map: Record<string, string> = {}
              for (const rundown of state.rundowns) map[rundown.channelId] ??= rundown.id
              setRundownOf(map)
              const alvo = map[view.channel.id] ?? state.rundowns[0]?.id
              if (alvo) absorb(await api.rundown(alvo))
            })
          }}
          // Editar um canal que não está em foco troca o foco antes: a tela
          // de canal mexe no canal em foco, e abrir ela apontando para outro
          // faria a edição cair no canal errado.
          onOpenFormat={(channelId) => {
            if (channelId === view.channel.id) {
              setDialog({ kind: 'channel' })
              return
            }
            const rundownId = rundownOf[channelId]
            if (!rundownId) {
              say('Esse canal ainda não tem grade para abrir.')
              return
            }
            void guard(async () => {
              absorb(await api.rundown(rundownId))
              setDialog({ kind: 'channel' })
            })
          }}
          onOpenDistribution={() => setDialog({ kind: 'distribution' })}
          onOpenGraphics={() => setDialog({ kind: 'graphics' })}
          onOpenAudit={() => setDialog({ kind: 'audit' })}
        />
      )}
      {dialog?.kind === 'channel' && (
        <ChannelDialog
          channel={view.channel}
          onCancel={() => setDialog(null)}
          onSaved={(message) => {
            setDialog(null)
            say(message)
            void guard(async () => absorb(await api.rundown(view.rundown.id)))
          }}
        />
      )}
      {dialog?.kind === 'autofill' && (
        <AutoFillDialog
          rundownId={dialog.rundownId ?? view.rundown.id}
          channelId={view.channel.id}
          categories={[
            ...new Set(assets.map((asset) => asset.categoryId).filter((id): id is string => !!id)),
          ].sort()}
          rate={rate}
          initialHours={dialog.initialHours}
          initialMinutes={dialog.initialMinutes}
          initialStart={dialog.initialStart}
          initialEnd={dialog.initialEnd}
          autoPreview={dialog.autoPreview}
          onCancel={() => setDialog(null)}
          onApplied={(snapshot, message) => {
            if (!dialog.rundownId || dialog.rundownId === view.rundown.id) {
              absorb(snapshot)
            }
            dialog.onApplied?.(snapshot)
            setDialog(null)
            say(message)
          }}
          onMessage={say}
        />
      )}
      {dialog?.kind === 'asrun' && (
        <AsRunPanel channelId={view.channel.id} rate={rate} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'audit' && <AuditPanel onClose={() => setDialog(null)} />}
      {dialog?.kind === 'users' && <div className="backdrop" onClick={() => setDialog(null)}><div className="dialog users-dialog" onClick={(event) => event.stopPropagation()}><header><h2>Gerenciador de usuários</h2><div className="sub">acesso, papéis e permissões da operação</div></header><div className="body"><UsersPanel onMessage={say} /></div><footer><button className="btn" onClick={() => setDialog(null)}>fechar</button></footer></div></div>}
      {dialog?.kind === 'docs' && <DocumentationPanel onClose={() => setDialog(null)} />}
      {dialog?.kind === 'graphics' && (
        <GraphicsPanel
          channelId={view.channel.id}
          slateTemplateId={view.channel.slateTemplateId}
          onAir={live?.graphic ?? null}
          onClose={() => setDialog(null)}
          onMessage={say}
        />
      )}
      {dialog?.kind === 'alerts' && (
        <SessionAlertsDialog
          open={true}
          problemas={problemas}
          onLimpar={() => setProblemas([])}
          onClose={() => setDialog(null)}
          onOpenSettings={() => {
            setDialog(null)
            navigateWorkspace('settings')
          }}
          onOpenEngineering={() => {
            setDialog(null)
            navigateWorkspace('monitor')
          }}
        />
      )}
      {dialog?.kind === 'distribution' && (
        <Distribution
          channelId={view.channel.id}
          onClose={() => {
            if (window.location.hash === '#distribuicao') window.location.hash = ''
            setDialog(null)
          }}
          onMessage={say}
        />
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}
