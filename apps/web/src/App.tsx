import { focusOwnsKey } from './domain/key-guards'
import { useEscape } from './domain/use-escape.js'
import { ConfirmHost } from './components/ConfirmHost.js'
import { confirmOpen } from './domain/confirm.js'
import { ShortcutsDialog } from './components/ShortcutsDialog.js'
import { useStoredChoice } from './domain/stored-choice.js'
﻿import { setSessionAccessRole } from './domain/permissions.js'
import { liveDefaultFrames } from './liveSource.js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { setAirState } from './domain/air-state.js'
import { wallClock, setCurrentGradeDate, anchorFramesFor } from './domain/wall-clock.js'
import type { ReactNode } from 'react'
import { anchorTarget, durationIn, isStill } from '@rplayout/protocol'
import type { AudioLevel, Channel, EditScope, Fit, Trim, ScheduleEventType, TimingFlags } from '@rplayout/protocol'
import { api } from './api.js'
import {ScanCommandDialog} from './components/ScanCommandDialog.js'
import { liveSnapshot } from './domain/live-snapshot.js'
import { loadSessionOperation } from './domain/session-load.js'
import {JoinedRead} from './domain/joined-read.js'
import { clientContext, ContextCommandQueue, SupersededContextError } from './domain/client-context.js'
import { commitSnapshot } from './domain/snapshot-commit.js'
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
import { MasterControlView, liveOutsideGrade } from './views/MasterControlView.js'
import { liveOnlyInsertion } from './domain/live-take-publication.js'
import {UnavailableChannelReturns} from './components/broadcast/UnavailableChannelReturns.js'
import { PlaylistScheduleView } from './views/PlaylistScheduleView.js'
import { QualityControlView } from './views/QualityControlView.js'
import { EngineeringDistributionView } from './views/EngineeringDistributionView.js'
import { AiredView } from './views/AiredView.js'
import { BroadcastHeader } from './components/broadcast/BroadcastHeader.js'
import { DocsView } from './views/DocsView.js'
import { SettingsView } from './views/SettingsView.js'
import { SessionAlertsDialog } from './components/broadcast/SessionAlertsDialog.js'
import {AssetRemovalDialog} from './components/AssetRemovalDialog.js'
import {EscalationInbox} from './components/EscalationInbox.js'

type Dialog =
  | {kind:'asset-removal';assetId:string|null}
  | { kind: 'trim'; view: ItemView }
  | { kind: 'playlists';revision?:number }
  | { kind: 'still'; view: ItemView }
  | { kind: 'audio'; view: ItemView; channel:Channel }
  | { kind: 'add'; assetId?: string; rundownId?: string; onApplied?: (snapshot: Snapshot) => void; revision?:number }
  | { kind: 'distribution'; initialTab?: 'saude' }
  | { kind: 'alerts' }
  | { kind: 'graphics' }
  | { kind: 'itemGraphics'; view: ItemView;channelId:string }
  | { kind: 'asrun' }
  | {
      kind: 'autofill'
      rundownId?: string
      revision?:number
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
        if (!event.repeat) window.dispatchEvent(new Event('rplayout:shortcuts'))
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
  const [libraryLoaded,setLibraryLoaded]=useState(false),[libraryError,setLibraryError]=useState<string|null>(null)
  const libraryReads=useRef(new JoinedRead<ScanStatus>())
  const [dialog, setDialog] = useState<Dialog>(null)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  useEffect(() => {
    const toggle = () => setShortcutsOpen(open => !open)
    window.addEventListener('rplayout:shortcuts', toggle)
    return () => window.removeEventListener('rplayout:shortcuts', toggle)
  }, [])
  // Painel bloqueado: nenhuma tecla ou clique de operação nesta estação até
  // desbloquear no aviso do topo. Para transmissões longas e mesa compartilhada.
  const [panelLock, setPanelLock] = useStoredChoice('rplayout:panel-lock', ['on', 'off'] as const, 'off')
  useEffect(() => {
    document.documentElement.dataset.panelLock = panelLock
  }, [panelLock])
  const addingItem=useRef(false)
  const [isAddingItem,setIsAddingItem]=useState(false)
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
  const [scanRequest,setScanRequest]=useState<boolean|null>(null)
  useEscape(scanRequest!==null,()=>setScanRequest(null))
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
  const [sessionRefresh, setSessionRefresh] = useState(0)
  /** Tudo que deu errado nesta sessão, venha de onde vier. */
  const [problemas, setProblemas] = useState<Problema[]>([])
  const proximoProblema = useRef(1)
  /** O que já foi anotado, para não repetir a cada releitura. */
  const vistos = useRef(new Set<string>())
  // CUE e TAKE são comandos ordenados do switcher, não requisições soltas.
  // Sem esta fila um TAKE podia alcançar o servidor antes do CUE clicado.
  const transportQueue = useRef(new ContextCommandQueue(clientContext))
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
  const clearSessionOperation = useCallback(() => {
    clientContext.nextSession()
    libraryReads.current.cancel()
    setFolders([]);setCategorias([]);setScan(null);setLibraryLoaded(false);setLibraryError(null)
    channelRef.current = null
    setView(null); setExecutionView(null); setLive(null); setMonitors(null)
    setChannels([]); setRundownOf({}); setDialog(null); setMarked(new Set())
    setScanRequest(null)
    setProblemas([]); vistos.current.clear()
  }, [])

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

  const [executionView, setExecutionView] = useState<RundownView | null>(null)
  const absorb = useCallback((snapshot: Snapshot) => {
    commitSnapshot(clientContext,snapshot,channelRef.current,value=>{
      if(value.view){
        if(channelRef.current!==value.view.channel.id){
          libraryReads.current.cancel();setFolders([]);setCategorias([]);setScan(null);setLibraryLoaded(false);setLibraryError(null)
          setMarked(new Set());setDialog(null);setError(null)
        }
        channelRef.current=value.view.channel.id;setView(value.view)
      }
      setExecutionView(executionFromSnapshot(value))
      setLive(value.live);setHistory(value.history);setMonitors(value.monitors)
    })
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
      const ticket = clientContext.capture()
      try {
        await action()
        if (clientContext.current(ticket)) setError(null)
      } catch (failure) {
        if (!clientContext.current(ticket) || failure instanceof SupersededContextError) return
        const texto = failure instanceof Error ? failure.message : 'Falha inesperada.'
        setError(texto)
        anotar('SERVIDOR', texto)
      }
    },
    [anotar],
  )

  const refreshLibrary = useCallback(async () => {
    const ticket=clientContext.capture(),channelId=channelRef.current
    try{
      return await libraryReads.current.run(JSON.stringify([ticket.session,ticket.view,channelId]),
        signal=>Promise.all([api.library(channelId??undefined,signal),api.scanStatus(signal),api.categories(signal)]),
        ([library,status,cats])=>{
          if(!clientContext.current(ticket)||channelRef.current!==channelId)throw new SupersededContextError()
          setFolders(library.folders);setScan(status);setCategorias(cats.categories);setLibraryLoaded(true);setLibraryError(null)
          return status
        },'A consulta do acervo demorou demais. Dados anteriores preservados; a grade carregada não foi interrompida.')
    }catch(cause){
      if(clientContext.current(ticket)&&channelRef.current===channelId&&!(cause instanceof SupersededContextError))setLibraryError(cause instanceof Error?cause.message:'Acervo não consultado.')
      throw cause
    }
  }, [])

  useEffect(() => {
    let active = true
    const controller=new AbortController()
    void loadSessionOperation({
      service:api, refreshLibrary, active:()=>active,signal:controller.signal,
      onSession:session=>{
        setSessionRole(session.label)
        setSessionAccessRole(session.role)
        setAuthRequired(session.required)
        setAuthenticated(session.authenticated)
      },
      onState:state=>{
        setInitializationFailed(false)
        setChannels(state.channels)
        // Uma grade por canal: a primeira de cada um é a que a troca abre.
        const first: Record<string, string> = {}
        for (const rundown of state.rundowns) first[rundown.channelId] ??= rundown.id
        setRundownOf(first)

      },
      onSnapshot:absorb,
      onEmpty:()=>{channelRef.current=null;setView(null);setExecutionView(null);setLive(null);setMonitors(null)},
      onError:failure=>{
        if (failure instanceof SupersededContextError) return
        setInitializationFailed(true)
        setError(failure instanceof Error ? failure.message : 'Servidor fora do ar.')
      },
      onLibraryError:failure=>{if(!(failure instanceof SupersededContextError))anotar('SERVIDOR',failure instanceof Error?failure.message:'Acervo não consultado; grade preservada.')},
      onDone:()=>setLoading(false),
    })
    return () => { active = false;controller.abort();libraryReads.current.cancel() }
  }, [absorb, refreshLibrary, sessionRefresh, clearSessionOperation,anotar])

  useEffect(() => {
    const ended = () => { clearSessionOperation(); setAuthRequired(true); setAuthenticated(false); setAuthError('A sessão encerrou. Entre novamente para continuar.'); setSessionRefresh(value=>value+1) }
    window.addEventListener('rplayout-session-ended', ended)
    return () => window.removeEventListener('rplayout-session-ended', ended)
  }, [clearSessionOperation])

  const login = useCallback(async (username: string, password: string) => {
    clearSessionOperation()
    const ticket = clientContext.capture()
    const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) })
    const body = await response.json() as { error?: string; label?: string }
    if (!clientContext.sessionCurrent(ticket)) return
    if (!response.ok) { setAuthError(body.error ?? 'Não foi possível entrar.'); return }
    setAuthError(null); setAuthenticated(true); setSessionRole(body.label ?? 'Operador')
    setLoading(true); setSessionRefresh(value => value + 1)
  }, [clearSessionOperation])

  /**
   * Dispara a varredura e acompanha até acabar.
   *
   * Ler um acervo inteiro leva minutos -- medir loudness custa decodificar o
   * áudio de cada arquivo --, então quem informa o andamento é a consulta, não
   * a resposta do disparo.
   */
  const startScan = useCallback(async (measure: boolean) => {
    setScanRequest(measure)
  }, [])

  // Acompanha também varreduras iniciadas pelo servidor ou por outro operador.
  useEffect(() => {
    if (authRequired && !authenticated) return
    let cancelled = false
    let timer: number | undefined
    let wasRunning = false
    const poll = async (): Promise<void> => {
      try {
        const status = await refreshLibrary()
        if (cancelled) return
        const occupied=status.globalBusy??status.running
        if (wasRunning && !occupied) say('Scanner não está mais ocupado. Confira o resultado do lote; disponibilidade não significa aprovação da mídia.')
        wasRunning = occupied
      } catch (failure) {
        if (!cancelled&&!(failure instanceof SupersededContextError)) anotar('SERVIDOR', failure instanceof Error ? failure.message : 'Falha ao atualizar acervo.')
      } finally {
        if (!cancelled) timer = window.setTimeout(() => void poll(), wasRunning ? 1500 : 10_000)
      }
    }
    timer = window.setTimeout(() => void poll(), 1500)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [refreshLibrary, say, anotar, authRequired, authenticated])

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
    if (authRequired && !authenticated) return
    let socket: WebSocket
    const ticket = clientContext.capture()
    let closed = false
    let retry: number | undefined
    const connect = (): void => {
    socket = new WebSocket(`${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`)
    socket.addEventListener('message', (event: MessageEvent<string>) => {
      if (closed || !clientContext.sessionCurrent(ticket)) return
      const payload = JSON.parse(event.data) as
        | { type: 'view'; channelId: string; view: RundownView | null; executionView?: RundownView | null }
        | ({ type: 'live'; channelId: string } & Live)
        | { type: 'library' }

      if (payload.type === 'library') {
        void refreshLibrary().catch((failure: Error) => {if(!(failure instanceof SupersededContextError))anotar('SERVIDOR', failure.message)})
        return
      }

      // O servidor transmite todos os canais; a tela mostra um. Sem este
      // filtro, dois canais no ar fazem a interface piscar entre os dois.
      if (payload.channelId !== channelRef.current) return

      if (payload.type === 'view') {
        if (payload.view) setView(payload.view)
        setExecutionView(executionFromSnapshot(payload))
      } else {
        setLive(liveSnapshot(payload))
      }
    })
    socket.addEventListener('close', event => {
      if (closed || !clientContext.sessionCurrent(ticket)) return
      if (event.code === 4401) { window.dispatchEvent(new Event('rplayout-session-ended')); return }
      if (!closed) retry = window.setTimeout(connect, 2000)
    })
    }
    connect()
    return () => { closed = true; window.clearTimeout(retry); socket.close() }
  }, [refreshLibrary, anotar, authRequired, authenticated, sessionRefresh])

  useEffect(() => {
    if (!view?.channel.id || (authRequired && !authenticated)) return
    void refreshLibrary().catch((failure: Error) => {if(!(failure instanceof SupersededContextError))anotar('SERVIDOR', failure.message)})
  }, [view?.channel.id, authRequired, authenticated, refreshLibrary, anotar])

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

  // Base dos horários de parede para telas sem data própria (régua, transporte).
  setCurrentGradeDate((executionView ?? view)?.rundown.date)
  useEffect(() => { setAirState(live ? Boolean(live.transport.playing && live.transport.onAir) : null) }, [live])
  const onAirItem = (executionView ?? view)?.items.find((item) => item.item.id === onAirId) ?? null
  // A grade que o operador vê e comanda no Master é a que está no ar
  // (executionView); a do dia (view) só quando nada foi carregado. Teclado e
  // TAKE de ao vivo usam a mesma, senão as setas armavam itens de outra grade.
  const operatingView = executionView ?? view
  const selected = operatingView?.items.find((item) => item.item.id === selectedId) ?? view?.items.find((item) => item.item.id === selectedId) ?? null

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

  const [transportRefusal, setTransportRefusal] = useState<{ action: string; message: string; at: number } | null>(null)
  useEffect(() => {
    if (!transportRefusal) return
    const timer = window.setTimeout(() => setTransportRefusal(null), 20_000)
    return () => window.clearTimeout(timer)
  }, [transportRefusal])
  const enqueueTransportCommand = useCallback((action: () => Promise<void>): Promise<void> => {
    return transportQueue.current.enqueue(action)
  }, [])

  // Proteção contra TAKE duplo (toque duplo no Espaço ou no botão): com o
  // próximo item já armado, o segundo TAKE pularia uma peça no ar. Ignora um
  // TAKE enquanto o anterior não voltou ou nos 700 ms seguintes.
  const lastTake = useRef<{ at: number; inFlight: boolean }>({ at: 0, inFlight: false })
  const takeAllowed = useCallback((): boolean => {
    const now = Date.now()
    if (lastTake.current.inFlight || now - lastTake.current.at < 700) {
      say('TAKE duplo ignorado: o anterior ainda está sendo confirmado.')
      return false
    }
    lastTake.current = { at: now, inFlight: true }
    return true
  }, [say])
  const takeDone = useCallback(() => { lastTake.current = { at: Date.now(), inFlight: false } }, [])

  // Título da aba com o estado do PGM: com vários canais/janelas abertos, o
  // operador vê na barra de abas qual está no ar sem trazer a janela à frente.
  const onAirTitle = live?.transport.onAir ? (live.transport.playing ? '● NO AR' : 'Ⅱ PAUSADO') : '■ PARADO'
  useEffect(() => {
    document.title = view ? `${onAirTitle} · ${view.channel.name} — RPlayout` : 'RPlayout'
  }, [onAirTitle, view?.channel.name])

  const command = useCallback(
    (action: 'take' | 'cue' | 'stop' | 'park' | 'seek', body?: { itemId?: string; assetId?: string; sourceRef?: string; sourceTitle?: string; bus?: 'pgm' | 'pvw'; frames?: number }) =>
      action === 'take' && !takeAllowed() ? Promise.resolve() :
      enqueueTransportCommand(() => guard(async () => {
        if (!view || view.channel.id !== channelRef.current) return
        try {
          absorb(await api.transport(view.channel.id, action, body))
          setTransportRefusal(null)
        } catch (failure) {
          // Recusa do comando aparece junto dos botões de transporte, não só
          // num aviso genérico que a próxima atualização ao vivo apaga.
          setTransportRefusal({ action, message: failure instanceof Error ? failure.message : 'Comando recusado.', at: Date.now() })
          throw failure
        }
      })).finally(() => { if (action === 'take') takeDone() }),
    [view, guard, absorb, enqueueTransportCommand, takeAllowed, takeDone],
  )

  // A live opened in PVW from the library is not a grade line, and the server
  // only puts grade lines on air (as-run, recovery). TAKE then inserts it right
  // after the item on air and takes it, instead of refusing the operator.
  const takeLiveFromPreview = useCallback(
    (sourceRef: string, title: string) =>
      !takeAllowed() ? Promise.resolve() :
      enqueueTransportCommand(async () => {
        if (!view || view.channel.id !== channelRef.current) return
        // Errors here are shown and logged explicitly: the generic guard drops
        // failures when a live WebSocket update changes the screen context,
        // which happens every few hundred ms on a running channel.
        try {
          // Insere na grade que está no ar; a do dia pode ser outra.
          const onAirGrade = executionView && executionView.rundown.id !== view.rundown.id
            ? (await api.rundown(executionView.rundown.id)).view ?? null
            : view
          if (!onAirGrade) throw new Error('A grade no ar não pôde ser lida; nada foi inserido nem levado ao ar.')
          const rundownId = onAirGrade.rundown.id, channelId = view.channel.id
          const onAirId = live?.transport.onAir?.itemId
          const index = onAirGrade.items.findIndex((entry) => entry.item.id === onAirId)
          const existing = new Set(onAirGrade.items.map((entry) => entry.item.id))
          const inserted = await api.addItem(rundownId, {
            sourceRef, type: 'LIVE', title,
            durationOverride: liveDefaultFrames(view.channel.rate),
            anchor: { kind: 'FLOW' },
            atIndex: index >= 0 ? index + 1 : undefined,
          }, onAirGrade.editorialRevision)
          const pick = (items: readonly { item: { id: string; sourceRef?: string | null; type: string } }[] | undefined) =>
            items?.find((entry) => !existing.has(entry.item.id) && entry.item.sourceRef === sourceRef)
            ?? items?.find((entry) => !existing.has(entry.item.id) && entry.item.type === 'LIVE')
          const added = pick(inserted.view?.items) ?? pick((await api.rundown(rundownId)).view?.items)
          if (!added) throw new Error('A entrada não foi confirmada na grade; nada foi publicado nem levado ao ar.')
          // What goes on air is the PUBLISHED plan. Publish only this insertion.
          const simulation = await api.simulateOperationalPlaylist(rundownId)
          if (simulation.activeRevision !== null) {
            if (!liveOnlyInsertion(simulation.differences, added.item.id)) throw new Error(`"${title}" foi inserida na grade, mas há outras alterações pendentes de publicação. Revise e publique em PROGRAMAÇÃO e faça o TAKE de novo; o PGM não foi alterado.`)
            await api.publishOperationalPlaylist(rundownId, simulation.review.editorialRevision, simulation.review.token)
          }
          const taken = await api.transport(channelId, 'take')
          try { absorb(taken) } catch { /* the WebSocket brings the same state */ }
          say(`Entrada "${title}" inserida na grade após o item no ar, publicada e levada ao PGM.`)
        } catch (failure) {
          const texto = failure instanceof Error ? failure.message : 'TAKE do ao vivo não confirmado.'
          console.error('[RPlayout] TAKE de ao vivo fora da grade:', texto)
          setError(texto); anotar('SERVIDOR', texto)
        }
      }).finally(takeDone),
    [view, executionView, live, absorb, enqueueTransportCommand, say, anotar, takeAllowed, takeDone],
  )

  const undo = useCallback(
    (direction: 'undo' | 'redo') =>
      guard(async () => {
        if (!view) return
        const result =
          direction === 'undo' ? await api.undo(view.rundown.id,view.editorialRevision) : await api.redo(view.rundown.id,view.editorialRevision)
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
      if (typing || dialog || shortcutsOpen || panelLock === 'on' || confirmOpen()) return
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
        // Espaço é sempre o TAKE: o foco do operador está no vídeo, não no botão.
        // Se um botão ficou com o foco, ele solta (blur) e a tecla não o aciona.
        event.preventDefault()
        if (element?.closest('button, a, select, [role="button"]')) (element as HTMLElement).blur()
        // O TAKE vai para o vídeo em foco (linha selecionada). Sem seleção, vale o
        // que está armado no PVW, como antes.
        const previewItemId = live?.transport.previewFrame?.itemId ?? live?.transport.preparedItemId ?? null
        if (selectedId && selectedId !== previewItemId) {
          void command('take', { itemId: selectedId })
          return
        }
        const preview = live?.transport.preview
        if (preview) {
          const outside = operatingView ? liveOutsideGrade(preview, operatingView.items.map((entry) => entry.item.sourceRef).filter((ref): ref is string => Boolean(ref))) : null
          if (outside) void takeLiveFromPreview(outside.source, outside.title)
          else void command('take')
          return
        }
        const targetItemId = selectedId ?? live?.transport.preparedItemId ?? undefined
        void command('take', targetItemId ? { itemId: targetItemId } : undefined)
        return
      }

      // F2 = CUE: abre no PVW o item selecionado ou, sem seleção, o próximo.
      if (event.key === 'F2') {
        event.preventDefault()
        const targetItemId = selectedId ?? live?.transport.preparedItemId ?? undefined
        if (targetItemId) void command('cue', { itemId: targetItemId })
        return
      }

      if (focusOwnsKey(element)) return
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
      if (event.key === 'n' && selected?.asset && view) setDialog({ kind: 'audio', view: selected,channel:view.channel })

      // Setas andam pela grade armando linha a linha, sem tirar a mão do teclado.
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const items = operatingView?.items ?? []
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
  }, [dialog, selected, selectedId, command, view, operatingView, undo, live, takeLiveFromPreview, shortcutsOpen, panelLock])

  const move = (id: string, toIndex: number,revision?:number): void => {
    void guard(async () => {
      absorb(await api.moveItem(id, toIndex,revision ?? view?.editorialRevision))
    })
  }

  const group = (): void => {
    if (!view || marked.size < 2) return
    void guard(async () => {
      absorb(await api.group(view.rundown.id, [...marked],view.editorialRevision))
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
  const removerItem = (id: string, targetRundownId?: string, onRemoved?: (id: string) => void,revision?:number): void => {
    if (id === onAirId) {
      say('O item no ar não sai da grade. Pare antes.')
      return
    }
    const alvo = view?.items.find((entry) => entry.item.id === id)
    const targetId = targetRundownId ?? view?.rundown.id
    void guard(async () => {
      const snapshot = await api.removeItem(id,revision ?? (targetId===view?.rundown.id?view?.editorialRevision:undefined))
      if (!targetRundownId || targetRundownId === view?.rundown.id) {
        absorb(snapshot)
      }
      onRemoved?.(id)
      say(`"${alvo?.item.title ?? 'Item'}" saiu da grade — Ctrl+Z traz de volta.`)
    })
  }

  const removerItensEmLote = (ids: string[], targetRundownId?: string, onRemoved?: () => void,revision?:number): void => {
    if (!view || ids.length === 0) return
    const targetId = targetRundownId ?? view.rundown.id
    const onAir = live?.transport.onAir?.itemId
    const validIds = ids.filter((id) => id !== onAir)
    if (validIds.length === 0) {
      say('O item no ar não sai da grade. Pare antes.')
      return
    }
    void guard(async () => {
      const snapshot = await api.bulkDeleteItems(targetId, validIds,revision ?? (targetId===view.rundown.id?view.editorialRevision:undefined))
      if (targetId === view.rundown.id) {
        absorb(snapshot)
      }
      onRemoved?.()
      say(`${validIds.length} item(ns) removido(s) da grade — Ctrl+Z traz de volta.`)
    })
  }

  const ungroup = (blockId: string): void => {
    void guard(async () => {
      absorb(await api.ungroup(blockId,view?.editorialRevision))
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

  const applyTrim = async(trim: Trim, scope: EditScope,scopeReviewToken?:string): Promise<void> => {
    const item = dialog?.kind === 'trim' ? dialog.view : null
    if (!item)throw new Error('Esta edição não está mais aberta.')
    const result = await api.setTrim(item.item.id, trim, scope,item.editorialRevision,scopeReviewToken)
    absorb(result)
    setDialog(current=>current?.kind==='trim' && current.view===item?null:current)
    say(result.result.message)
  }

  const applyAudio = async(audio: AudioLevel, scope: EditScope,audioTrack:number,scopeReviewToken?:string): Promise<void> => {
    const item = dialog?.kind === 'audio' ? dialog.view : null
    if (!item)throw new Error('Esta edição não está mais aberta.')
    const result = await api.setAudio(item.item.id, audio, scope,item.editorialRevision,audioTrack,scopeReviewToken)
    absorb(result)
    setDialog(current=>current?.kind==='audio' && current.view===item?null:current)
    say(result.result.message)
  }

  const addItem = (
    request: NewItem,
    targetRundownId?: string,
    onApplied?: (snapshot: Snapshot) => void,
    revision?:number,
  ): void => {
    if (!view || addingItem.current) return
    addingItem.current=true
    setIsAddingItem(true)
    const targetId = targetRundownId ?? view.rundown.id
    void guard(async () => {
      const snapshot = await api.addItem(targetId, request,revision)
      setDialog(null)
      if (targetId === view.rundown.id) {
        absorb(snapshot)
      }
      onApplied?.(snapshot)
      const at = anchorTarget(request.anchor)
      say(
        at === null
          ? 'Item inserido no fim da grade.'
          : `Item inserido em ${wallClock(at, view.channel.rate, view.rundown.date)}; a grade foi remanejada.`,
      )
    }).finally(()=>{addingItem.current=false;setIsAddingItem(false)})
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
        },view.editorialRevision),
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
        },view.editorialRevision),
      )
      say(`${asset?.title ?? 'Arquivo'} no fim da grade.`)
    })
  }

  const removerDoAcervo = (assetId: string): void => {
    setDialog({kind:'asset-removal',assetId})
  }

  const limparQuebrados = (): void => {
    setDialog({kind:'asset-removal',assetId:null})
  }

  const setTrack = (id: string, audioTrack: number): void => {
    void guard(async () => {
      absorb(await api.patchItem(id, { audioTrack },view?.items.find(entry=>entry.item.id===id)?.editorialRevision))
      say(`Item passa a tocar a ${audioTrack + 1}ª trilha de áudio.`)
    })
  }

  const setFit = (id: string, fit: Fit): void => {
    void guard(async () => {
      absorb(await api.patchItem(id, { fit },view?.items.find(entry=>entry.item.id===id)?.editorialRevision))
      say(
        fit === 'CROP'
          ? 'Item enche a tela; a sobra da proporção é cortada.'
          : 'Item entra inteiro, com barra preta na sobra.',
      )
    })
  }

  const saveNotes = (id: string, notes: string,revision?:number): void => {
    void guard(async () => {
      absorb(await api.patchItem(id, { notes: notes.trim() === '' ? null : notes },revision))
    })
  }

  const aceitarDoAcervo = async (assetId: string,review:import('@rplayout/protocol').QcReview): Promise<void> => {
    try {
      const asset = folders.flatMap(folder => folder.assets).find(asset => asset.id === assetId)
      if (!view || !asset) throw new Error('Selecione um canal e uma versão de mídia antes de aprovar.')
      const result=await api.qcDecision(assetId, { channelId: view.channel.id, contentHash: review.contentHash, status: 'APPROVED' },review)
      await refreshLibrary()
      say(result.refreshError??'Arquivo aceito neste canal para a versão conferida.')
    } catch (error) {
      say(error instanceof Error ? error.message : 'Falha ao aprovar o arquivo.')
      throw error
    }
  }

  const ignorarNoAcervo = async (assetId: string,review:import('@rplayout/protocol').QcReview): Promise<void> => {
    try {
      if(review.assetId!==assetId || review.channelId!==view?.channel.id)throw new Error('A conferência pertence a outro arquivo/canal; nenhuma rejeição foi enviada.')
      const result=await api.patchAsset(assetId, { qcStatus: 'REJECTED' },review.assetRevision)
      await refreshLibrary()
      say(result.refreshError??'Arquivo movido para os ignorados em todos os canais.')
    } catch (error) {
      say(error instanceof Error ? error.message : 'Falha ao rejeitar o arquivo.')
      throw error
    }
  }

  const trocarCanal = (channelId: string): void => {
    const rundownId = rundownOf[channelId]
    if (!rundownId || channelId === view?.channel.id) return
    clientContext.nextView(); channelRef.current = null
    setLive(null);setMonitors(null)
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
      // Horário fixo começa na hora atual (próximo minuto), na base da grade.
      // Antes era 0 = meia-noite do dia da grade: numa grade em loop, dias atrás.
      const startAt = Math.max(0, anchorFramesFor(new Date(Math.ceil(Date.now() / 60000) * 60000), view.channel.rate, view.rundown.date))
      const itemAnchor = isHardTime
        ? { kind: 'HARD_TIME' as const, at: startAt }
        : isFixed
          ? { kind: 'FIXED' as const, at: startAt }
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
          },view.editorialRevision),
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
          },view.editorialRevision),
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
    if (currentWorkspace === 'aired') return <div className="w-screen h-screen"><AiredView channels={[]} onNavigate={navigateWorkspace} sessionRole={sessionRole ?? 'Operador'} authRequired={authRequired} /></div>
    if (currentWorkspace === 'audit') return <div className="w-screen h-screen"><AuditPanel isModal={false} onClose={()=>navigateWorkspace('master')} /></div>
    return (
      <div className="app">
        <div className="firstrun">
          <h1>
            RPlayout<span>.</span>
          </h1>
          <p>
            Nenhum canal ativo disponível para esta conta. Verifique as permissões ou consulte
            o histórico dos canais arquivados. Sem canal ativo autorizado, não há operação de PGM.
          </p>
          <div className="row"><button type="button" className="btn" onClick={()=>navigateWorkspace('aired')}>Consultar histórico</button><button type="button" className="btn" onClick={()=>navigateWorkspace('audit')}>Auditoria</button></div>
          {['Supervisor','Gestor','Administrador'].includes(sessionRole ?? '') && <div className="row">
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
          </div>}
          {['Supervisor','Gestor','Administrador'].includes(sessionRole ?? '') && <p className="hint">
            O canal nasce no padrão broadcast 1080i59.94 (ou 1080p59.94), com uma grade vazia. Depois aponte
            <code>RPLAYOUT_MEDIA</code> para a sua pasta de vídeos e use <b>LER PASTA</b>: o
            acervo é lido do disco, com duração, loudness e miniatura de cada arquivo.
          </p>}
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
          {!loading && <UnavailableChannelReturns channels={channels}/>}
        </div>
      </div>
    )
  }

  return (
    <div className="w-screen h-screen bg-surface-base text-on-surface select-none overflow-hidden font-sans">
      {(!libraryLoaded||libraryError)&&<aside role={libraryError?'alert':'status'} aria-label="Estado da consulta do acervo" className="fixed bottom-3 right-3 z-[60] max-w-md rounded border border-armed-amber bg-surface-panel p-3 text-xs shadow-lg">
        <p>{libraryError??'Acervo ainda não conferido; isso não é confirmação de acervo vazio.'}</p>
        <button className="mt-2 rounded border px-2 py-1" onClick={()=>void refreshLibrary().catch(cause=>{if(!(cause instanceof SupersededContextError))anotar('SERVIDOR',cause instanceof Error?cause.message:'Acervo não consultado.')})}>Reconsultar acervo</button>
      </aside>}
      {scanRequest!==null&&<div role="dialog" aria-modal="true" aria-label="Varredura do acervo" className="fixed inset-0 z-[1000] bg-black/70 flex items-center justify-center"><ScanCommandDialog measure={scanRequest} onClose={()=>setScanRequest(null)} onRegistered={()=>{}}/></div>}
      <ConfirmHost />
      <EscalationInbox />
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
      {panelLock === 'on' && <>
        <div aria-hidden="true" className="fixed inset-0 z-[110] cursor-not-allowed bg-black/10" />
        <div role="alert" className="fixed left-1/2 bottom-4 z-[111] flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-3 rounded-lg border border-armed-amber bg-surface-panel px-4 py-2 shadow-2xl">
          <span className="material-symbols-outlined text-armed-amber">lock</span>
          <span className="font-label-caps text-[12px] font-bold text-armed-amber">PAINEL BLOQUEADO</span>
          <span className="hidden sm:inline text-[12px] text-on-surface-variant">Cliques e teclas de operação desativados nesta estação. O canal segue no ar.</span>
          <button type="button" className="btn small primary" onClick={() => setPanelLock('off')}>DESBLOQUEAR</button>
        </div>
      </>}
      {currentWorkspace === 'master' && (
        <MasterControlView
          onLockPanel={() => setPanelLock('on')}
          libraryLoaded={libraryLoaded}
          channel={view.channel}
          channels={channels}
          view={executionView ?? view}
          live={live}
          folders={folders}
          scan={scan}
          categorias={categorias}
          monitors={monitors}
          followOnAir={followOnAir}
          onToggleFollowOnAir={() => setFollowOnAir((value) => !value)}
          onTake={(itemId?: string) => void command('take', itemId ? { itemId } : {})}
          onTakeLive={(sourceRef: string, title: string) => void takeLiveFromPreview(sourceRef, title)}
          onStop={() => void command('stop')}
          onCue={(itemId?: string) => void command('cue', { itemId })}
          onClearCue={() => void command('cue', {})}
          transportRefusal={transportRefusal}
          onDismissTransportRefusal={() => setTransportRefusal(null)}
          onSeek={(bus: 'pvw' | 'pgm', frames: number) =>
            void command('seek', {
              bus,
              frames,
              itemId: bus === 'pgm' ? onAirId ?? undefined : selectedId ?? undefined,
            })
          }
          onStartScan={(measure: boolean) => void startScan(measure)}
          onAddItem={() => setDialog({ kind: 'add',revision:view.editorialRevision })}
          onAutoFill={() => setDialog({ kind: 'autofill',revision:view.editorialRevision })}
          onExportCsv={exportCsv}
          onOpenTrim={(item: ItemView) =>
            setDialog({
              kind: item.asset && isStill(item.asset) ? 'still' : 'trim',
              view: item,
            })
          }
          onOpenAudio={(item: ItemView) => setDialog({ kind: 'audio', view: item,channel:view.channel })}
          onOpenGraphics={(item: ItemView) => setDialog({ kind: 'itemGraphics', view: item,channelId:view.channel.id })}
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
        />
      )}

      {currentWorkspace === 'playlist' && (
        <PlaylistScheduleView
          libraryLoaded={libraryLoaded}
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
              say('Dados da grade atualizados. A publicação operacional é uma ação separada.')
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
              editorialRevision?:number
            },
          ) =>
            setDialog({
              kind: 'autofill',
              rundownId,
              revision:options?.editorialRevision,
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
          onAddItem={(rundownId?: string, onApplied?: (snapshot: Snapshot) => void,revision?:number) =>
            setDialog({ kind: 'add', rundownId, onApplied,revision })
          }
          onExportCsv={exportCsv}
          onOpenTrim={(item: ItemView) =>
            setDialog({
              kind: item.asset && isStill(item.asset) ? 'still' : 'trim',
              view: item,
            })
          }
          onOpenAudio={(item: ItemView) => setDialog({ kind: 'audio', view: item,channel:view.channel })}
          onRemoveItem={(itemId: string, rundownId?: string, onRemoved?: (id: string) => void,revision?:number) =>
            removerItem(itemId, rundownId, onRemoved,revision)
          }
          onBulkRemoveItems={(ids: string[], rundownId?: string, onRemoved?: () => void,revision?:number) =>
            removerItensEmLote(ids, rundownId, onRemoved,revision)
          }
          onOpenSettings={() => navigateWorkspace('settings')}
          onRemoveAsset={removerDoAcervo}
          onPruneAssets={limparQuebrados}
        />
      )}

      {currentWorkspace === 'qc' && (
        <QualityControlView
          libraryLoaded={libraryLoaded}
          isLiveOnAir={Boolean(live?.transport.playing && live?.transport.onAir)}
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
          signals={live?.transport.liveSources ?? []}
          transportMode={live?.transport.mode}
          previewTarget={live?.transport.preview}
          onMediaChanged={() => void refreshLibrary().catch(cause=>{if(!(cause instanceof SupersededContextError))anotar('SERVIDOR',cause instanceof Error?cause.message:'Acervo não consultado.')})}
        />
      )}

      {currentWorkspace === 'monitor' && (
        <EngineeringDistributionView
          channel={view.channel}
          onOpenHealth={() => setDialog({ kind: 'distribution', initialTab: 'saude' })}
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
          live={live}
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
              else { clientContext.nextView();channelRef.current=null;setView(null);setExecutionView(null);setLive(null);setMonitors(null) }
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
                <div className="bg-armed-amber/10 border border-armed-amber/30 text-armed-amber px-4 py-3 rounded-lg flex items-center gap-3">
                  <span className="material-symbols-outlined text-armed-amber text-[20px]">warning</span>
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
          revision={dialog.revision}
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
      {dialog?.kind==='asset-removal'&&<AssetRemovalDialog key={dialog.assetId??'@prune'} assetId={dialog.assetId} onCancel={()=>setDialog(null)} onApplied={message=>{say(message);void guard(async()=>{await refreshLibrary()})}}/>}
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
            void guard(async () => {
              absorb(await api.patchItem(id, { durationOverride: frames },dialog.view.editorialRevision))
              setDialog(null)
              say('Tempo da imagem parada atualizado; a grade foi remanejada.')
            })
          }}
        />
      )}
      {dialog?.kind === 'audio' && (
        <AudioDialog
          view={dialog.view}
          channel={dialog.channel}
          onCancel={() => setDialog(null)}
          onApply={applyAudio}
        />
      )}
      {dialog?.kind === 'add' && (
        <AddItemDialog
          channelId={view.channel.id}
          assets={assets}
          initialAssetId={dialog.assetId}
          rate={rate}
          suggestedAt={view.schedule.endsAt}
          gradeDate={view.rundown.date}
          error={error}
          pending={isAddingItem}
          onCancel={() => setDialog(null)}
          onAdd={(req) => addItem(req, dialog.rundownId, dialog.onApplied,dialog.revision)}
        />
      )}

      {dialog?.kind === 'itemGraphics' && (
        <ItemGraphicsDialog
          view={dialog.view}
          channelId={dialog.channelId}
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
              else { clientContext.nextView();channelRef.current=null;setView(null);setExecutionView(null);setLive(null);setMonitors(null) }
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
          revision={dialog.revision}
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
          key={view.channel.id}
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
          initialTab={dialog.initialTab}
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
import {executionFromSnapshot} from './domain/execution-snapshot.js'
