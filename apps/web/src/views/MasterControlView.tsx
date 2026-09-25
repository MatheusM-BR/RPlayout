import { useState, useMemo, useEffect, useRef } from 'react'
import type { Channel, ScheduleEventType, TimingFlags } from '@rplayout/protocol'
import { clock, dur, formatStandardRate } from '../format.js'
import type {
  Categoria,
  ItemView,
  LibraryAsset,
  LibraryFolder,
  Live,
  MediaRoot,
  Monitors as MonitorFeeds,
  RundownView,
  ScanStatus,
} from '../types.js'
import type { WorkspaceId } from '../components/WorkspaceShell.js'
import { api } from '../api.js'
import { Whep } from '../components/Whep.js'
import { BroadcastHeader } from '../components/broadcast/BroadcastHeader.js'
import { BroadcastMonitor } from '../components/broadcast/BroadcastMonitor.js'
import { ContinuityCacheBadge } from '../components/broadcast/ContinuityCacheBadge.js'
import { PgmProbeBanner } from '../components/broadcast/PgmProbeBanner.js'
import { DynamicCgSecondaryBar, type DynamicCgState } from '../components/broadcast/DynamicCgSecondaryBar.js'
import { MultiTrackTimeline } from '../components/broadcast/MultiTrackTimeline.js'
import { ConflictDrawer } from '../components/broadcast/ConflictDrawer.js'
import { CanonicalProtocolSelector } from '../components/broadcast/CanonicalProtocolSelector.js'

interface Props {
  channel: Channel
  channels: Channel[]
  view: RundownView
  live: Live
  folders: LibraryFolder[]
  scan: ScanStatus | null
  categorias: Categoria[]
  monitors: MonitorFeeds | null
  followOnAir: boolean
  onToggleFollowOnAir: () => void
  onTake: (itemId?: string) => void
  onStop: () => void
  onCue: (itemId: string) => void
  onSeek: (bus: 'pgm' | 'pvw', frames: number) => void
  onStartScan: (measure: boolean) => void
  onAddItem: () => void
  onAutoFill: () => void
  onExportCsv: () => void
  onOpenTrim: (item: ItemView) => void
  onOpenAudio: (item: ItemView) => void
  onOpenGraphics: (item: ItemView) => void
  onOpenStill: (item: ItemView) => void
  onRemoveItem: (itemId: string) => void
  onMoveItem: (itemId: string, toIndex: number) => void
  onOpenAlerts: () => void
  onOpenSettings: () => void
  problemasCount: number
  sessionRole: string
  authRequired: boolean
  onNavigate: (workspace: WorkspaceId) => void
  onSelectChannel: (channelId: string) => void
  onPreviewAsset: (asset: LibraryAsset) => void
  onInsertAsset: (
    assetId: string | null,
    atIndex?: number,
    liveConfig?: { sourceRef: string; title: string; durationOverride?: number },
    options?: {
      eventType?: ScheduleEventType
      timingFlags?: TimingFlags
    },
  ) => void
  onOpenConflicts?: () => void
  onOpenLiveInput?: () => void
}

export interface CustomLiveSource {
  id: string
  title: string
  sourceRef: string
  family: 'SDI' | 'NDI' | 'SRT' | 'WEBRTC'
  durationFrames: number
}

const getItemDuration = (item: ItemView | null | undefined): number => {
  if (!item) return 0
  if (item.trim) return Math.max(0, item.trim.out - item.trim.in)
  return item.item?.durationOverride ?? item.asset?.durationFrames ?? 0
}

export function MasterControlView({
  channel,
  channels,
  view,
  live,
  folders,
  scan,
  categorias,
  monitors,
  followOnAir,
  onToggleFollowOnAir,
  onTake,
  onStop,
  onCue,
  onSeek,
  onStartScan,
  onAddItem,
  onAutoFill,
  onExportCsv,
  onOpenTrim,
  onOpenAudio,
  onOpenGraphics,
  onOpenStill,
  onRemoveItem,
  onMoveItem,
  onOpenAlerts,
  onOpenSettings,
  problemasCount,
  sessionRole,
  authRequired,
  onNavigate,
  onSelectChannel,
  onPreviewAsset,
  onInsertAsset,
  onOpenConflicts,
  onOpenLiveInput,
}: Props) {
  // MAM filter & search states
  const [mamSearch, setMamSearch] = useState('')
  const [selectedTag, setSelectedTag] = useState<'TODOS' | 'VT' | 'JORNAL' | 'AO VIVO'>('TODOS')
  const [transitionMode, setTransitionMode] = useState<'CUT' | 'MIX' | 'WIPE'>('CUT')

  // Drag & drop dropzone target
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  // Modais de Ingestão e Adição de Linha
  const [liveInputModalOpen, setLiveInputModalOpen] = useState(false)
  const [addLineModalOpen, setAddLineModalOpen] = useState(false)
  const [folderModalOpen, setFolderModalOpen] = useState(false)

  // Fase E: Alternância entre Grade Linear e Timeline Visual Multicamada 24H
  const [viewMode, setViewMode] = useState<'LINEAR' | 'TIMELINE'>('LINEAR')

  // Fase E: Gaveta lateral interativa de Conflitos e Gaps (Conflict Drawer)
  const [isConflictDrawerOpen, setIsConflictDrawerOpen] = useState(false)

  // Fase D: Estado ao vivo do CG Dinâmico e Marcadores SCTE-35 no PGM
  const DEFAULT_CG_STATE: DynamicCgState = {
    layer0Logo: true,
    layer1Clock: true,
    layer2Ticker: false,
    layer3LowerThird: false,
    tickerText: 'URGENTE: Congresso aprova novo marco regulatório das telecomunicações em Brasília',
    breakingNewsActive: false,
    lowerThirdTitle: 'RODRIGO SILVEIRA',
    lowerThirdSubtitle: 'Correspondente Internacional • Genebra',
    lowerThirdActive: false,
    lowerThirdTimeRemaining: 0,
    scte35Active: false,
    scte35Phase: 'IDLE',
    scte35TimeRemaining: 0,
    scte35EventId: 55102,
  }
  const [activeCgState, setActiveCgState] = useState<DynamicCgState>(DEFAULT_CG_STATE)

  // Multiseleção na playlist (Ctrl / Shift)
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set())
  const lastClickedIndexRef = useRef<number | null>(null)

  // Gerenciamento de Pastas do Acervo MAM
  const [mamRoots, setMamRoots] = useState<MediaRoot[]>([])
  const [newFolderPath, setNewFolderPath] = useState('')
  const [newFolderLabel, setNewFolderLabel] = useState('')
  const [isFolderLoading, setIsFolderLoading] = useState(false)
  const [folderActionMsg, setFolderActionMsg] = useState<string | null>(null)

  const loadMamRoots = async () => {
    try {
      const res = await api.mediaRoots()
      setMamRoots(res.roots)
    } catch (err) {
      console.error('Falha ao carregar pastas:', err)
    }
  }

  useEffect(() => {
    if (folderModalOpen) void loadMamRoots()
  }, [folderModalOpen])

  const handlePickFolder = async () => {
    setIsFolderLoading(true)
    setFolderActionMsg('Abrindo seletor de pastas...')
    try {
      const picked = await api.pickMediaRoot()
      if (picked) {
        setFolderActionMsg(`Pasta "${picked.root.label}" adicionada ao acervo!`)
        await loadMamRoots()
        onStartScan(false)
      } else {
        setFolderActionMsg('Seleção de pasta cancelada pelo operador.')
      }
    } catch (err: any) {
      setFolderActionMsg(`Erro: ${err.message}`)
    } finally {
      setIsFolderLoading(false)
    }
  }

  const handleAddFolderManual = async () => {
    const path = newFolderPath.trim()
    if (!path) return
    setIsFolderLoading(true)
    setFolderActionMsg('Cadastrando pasta...')
    try {
      const label = newFolderLabel.trim() || undefined
      const res = await api.addMediaRoot(path, label)
      setFolderActionMsg(`Pasta "${res.root.label}" cadastrada com sucesso!`)
      setNewFolderPath('')
      setNewFolderLabel('')
      await loadMamRoots()
      onStartScan(false)
    } catch (err: any) {
      setFolderActionMsg(`Erro: ${err.message}`)
    } finally {
      setIsFolderLoading(false)
    }
  }

  const handleRemoveFolder = async (root: MediaRoot) => {
    if (!window.confirm(`Remover pasta "${root.label}" do acervo? Os arquivos já na grade continuam.`)) return
    setIsFolderLoading(true)
    try {
      await api.removeMediaRoot(root.id)
      setFolderActionMsg(`Pasta "${root.label}" removida.`)
      await loadMamRoots()
    } catch (err: any) {
      setFolderActionMsg(`Erro: ${err.message}`)
    } finally {
      setIsFolderLoading(false)
    }
  }

  // Fontes externas persistidas na biblioteca MAM
  const [customSources, setCustomSources] = useState<CustomLiveSource[]>(() => {
    try {
      const stored = localStorage.getItem('rplayout_custom_live_sources')
      if (stored) return JSON.parse(stored)
    } catch {}
    return [
      {
        id: 'live-decklink-1',
        title: 'DeckLink 8K Pro (Entrada SDI 1)',
        sourceRef: 'sdi:0',
        family: 'SDI',
        durationFrames: 45000,
      },
      {
        id: 'live-decklink-2',
        title: 'DeckLink 8K Pro (Entrada SDI 2)',
        sourceRef: 'sdi:1',
        family: 'SDI',
        durationFrames: 45000,
      },
      {
        id: 'live-ndi-1',
        title: 'NDI Studio (Master Câmera 1)',
        sourceRef: 'ndi:ESTUDIO-A-MASTER',
        family: 'NDI',
        durationFrames: 45000,
      },
      {
        id: 'live-srt-1',
        title: 'SRT Ingest (Link Externo)',
        sourceRef: 'srt://127.0.0.1:9000?mode=listener',
        family: 'SRT',
        durationFrames: 45000,
      },
    ]
  })

  const saveCustomSource = (source: CustomLiveSource) => {
    setCustomSources((prev) => {
      const next = [...prev.filter((s) => s.id !== source.id), source]
      try {
        localStorage.setItem('rplayout_custom_live_sources', JSON.stringify(next))
      } catch {}
      return next
    })
  }

  // Estados locais dos modais de Ingestão e Linha
  const [newLiveTitle, setNewLiveTitle] = useState('DeckLink SDI 1 - Estúdio A')
  const [newLiveFamily, setNewLiveFamily] = useState<'SDI' | 'NDI' | 'SRT' | 'WEBRTC'>('SDI')
  const [newLiveRef, setNewLiveRef] = useState('sdi:0')
  const [newLiveDurationMin, setNewLiveDurationMin] = useState(15)

  const [addLineTab, setAddLineTab] = useState<'library' | 'live'>('library')
  const [addLineSearch, setAddLineSearch] = useState('')
  const [addLineSelectedAssetId, setAddLineSelectedAssetId] = useState<string>('')
  const [addLineTargetMode, setAddLineTargetMode] = useState<'end' | 'index'>('end')
  const [addLineTargetIndex, setAddLineTargetIndex] = useState<number>(1)
  const [addLineSaveToLibrary, setAddLineSaveToLibrary] = useState(true)

  // Fase A: Tipos de Eventos e Timing Flags no Modal de Linha (Adicionar / Editar)
  const [editingItemView, setEditingItemView] = useState<ItemView | null>(null)
  const [lineEventType, setLineEventType] = useState<ScheduleEventType>('SEQUENTIAL')
  const [lineTrimmable, setLineTrimmable] = useState(false)
  const [lineOptional, setLineOptional] = useState(false)
  const [lineProtected, setLineProtected] = useState(false)
  const [isSavingLineConfig, setIsSavingLineConfig] = useState(false)

  const handleOpenAddLine = () => {
    setEditingItemView(null)
    setLineEventType('SEQUENTIAL')
    setLineTrimmable(false)
    setLineOptional(false)
    setLineProtected(false)
    setAddLineModalOpen(true)
  }

  const handleOpenEditLine = (item: ItemView) => {
    setEditingItemView(item)
    const inferredType: ScheduleEventType =
      item.item.eventType ??
      (item.item.anchor?.kind === 'HARD_TIME'
        ? 'HARD_TIME'
        : item.item.anchor?.kind === 'FIXED'
          ? 'FIXED'
          : item.item.type === 'LIVE' || item.item.sourceRef
            ? 'LIVE'
            : item.item.type === 'FILLER'
              ? 'FILLER'
              : 'SEQUENTIAL')

    const trimmable = Boolean(item.item.timingFlags?.trimmable ?? item.item.trimmable)
    const optional = Boolean(item.item.timingFlags?.optional ?? item.item.optional)
    const isProt = Boolean(item.item.timingFlags?.protected ?? item.item.protected)

    setLineEventType(inferredType)
    setLineTrimmable(trimmable)
    setLineOptional(optional)
    setLineProtected(isProt)
    setAddLineModalOpen(true)
  }

  const handleSaveEditedLine = async () => {
    if (!editingItemView) return
    setIsSavingLineConfig(true)
    try {
      await api.patchItem(editingItemView.item.id, {
        eventType: lineEventType,
        timingFlags: {
          trimmable: lineTrimmable,
          optional: lineOptional,
          protected: lineProtected,
        },
      })
      setAddLineModalOpen(false)
      setEditingItemView(null)
    } catch (err) {
      console.error('Falha ao atualizar parâmetros de automação da linha:', err)
    } finally {
      setIsSavingLineConfig(false)
    }
  }

  // Trava de segurança PGM e Operador
  const [isLocked, setIsLocked] = useState(true)

  // 24/7 Safety: Dois passos para Stop/Abort (previne acidentes operacionais)
  const [abortArmed, setAbortArmed] = useState(false)
  const [abortCountdown, setAbortCountdown] = useState(3)
  const abortTimerRef = useRef<number | null>(null)

  const handleArmAbort = () => {
    if (abortArmed) {
      if (abortTimerRef.current) window.clearInterval(abortTimerRef.current)
      setAbortArmed(false)
      setAbortCountdown(3)
      onStop()
      return
    }

    setAbortArmed(true)
    setAbortCountdown(3)
    if (abortTimerRef.current) window.clearInterval(abortTimerRef.current)

    abortTimerRef.current = window.setInterval(() => {
      setAbortCountdown((prev) => {
        if (prev <= 1) {
          if (abortTimerRef.current) window.clearInterval(abortTimerRef.current)
          setAbortArmed(false)
          return 3
        }
        return prev - 1
      })
    }, 1000)
  }

  useEffect(() => {
    return () => {
      if (abortTimerRef.current) window.clearInterval(abortTimerRef.current)
    }
  }, [])

  // Item no ar e próximo item preparado
  const onAirIndex = useMemo(() => {
    if (!live.transport.onAir) return -1
    return view.items.findIndex((item) => item.item.id === live.transport.onAir?.itemId)
  }, [view.items, live.transport.onAir])

  const onAirItem: ItemView | null = (onAirIndex >= 0 ? view.items[onAirIndex] : null) ?? null

  const armedItem: ItemView | null = useMemo(() => {
    if (live.transport.preparedItemId) {
      return view.items.find((item) => item.item.id === live.transport.preparedItemId) ?? null
    }
    if (onAirIndex >= 0 && onAirIndex + 1 < view.items.length) {
      return view.items[onAirIndex + 1] ?? null
    }
    return view.items[0] ?? null
  }, [live.transport.preparedItemId, onAirIndex, view.items])

  const cuedIndex = useMemo(() => {
    if (!armedItem) return -1
    return view.items.findIndex((item) => item.item.id === armedItem.item.id)
  }, [armedItem, view.items])

  // Seleção direta de preview (via MAM ou grade)
  const [selectedPreviewAsset, setSelectedPreviewAsset] = useState<LibraryAsset | null>(null)

  // Monitoramento de áudio mutuamente exclusivo (PGM ou PVW, nunca os dois juntos)
  const [activeAudioBus, setActiveAudioBus] = useState<'pgm' | 'pvw' | null>(null)

  const activePreviewAsset = selectedPreviewAsset ?? armedItem?.asset ?? null
  const activePreviewDuration = selectedPreviewAsset
    ? selectedPreviewAsset.durationFrames
    : armedItem
    ? getItemDuration(armedItem)
    : 0

  const handleRowClick = (e: React.MouseEvent, item: ItemView, index: number) => {
    const itemId = item.item.id
    if (e.ctrlKey || e.metaKey) {
      setSelectedItemIds((prev) => {
        const next = new Set(prev)
        if (next.has(itemId)) next.delete(itemId)
        else next.add(itemId)
        return next
      })
      lastClickedIndexRef.current = index
    } else if (e.shiftKey && lastClickedIndexRef.current !== null) {
      const start = Math.min(lastClickedIndexRef.current, index)
      const end = Math.max(lastClickedIndexRef.current, index)
      const rangeIds = view.items.slice(start, end + 1).map((it) => it.item.id)
      setSelectedItemIds(new Set(rangeIds))
    } else {
      setSelectedItemIds(new Set([itemId]))
      lastClickedIndexRef.current = index
      setSelectedPreviewAsset(null)
      onCue(item.item.id)
    }
  }

  const handleBulkDelete = () => {
    if (selectedItemIds.size === 0) return
    if (!window.confirm(`Deseja remover os ${selectedItemIds.size} itens selecionados da grade?`)) return
    for (const id of selectedItemIds) {
      onRemoveItem(id)
    }
    setSelectedItemIds(new Set())
  }

  const handleMamPreview = (asset: LibraryAsset) => {
    setSelectedPreviewAsset(asset)
    onPreviewAsset(asset)
  }

  const handleTake = () => {
    if (selectedPreviewAsset) {
      const matching = view.items.find((i) => i.item.mediaId === selectedPreviewAsset.id)
      if (matching) {
        onTake(matching.item.id)
      } else {
        onInsertAsset(selectedPreviewAsset.id)
        onTake()
      }
      setSelectedPreviewAsset(null)
    } else {
      onTake(armedItem?.item.id)
    }
  }

  // Mapa de horários resolvidos
  const scheduleMap = useMemo(() => {
    return new Map(view.schedule?.items?.map((it) => [it.id, it]) ?? [])
  }, [view.schedule])

  // Cálculo de temporizações e quadros
  const rate = channel.rate
  const fps = rate.num / rate.den
  const onAirDurationFrames = getItemDuration(onAirItem)
  const elapsedFrames = live?.transport?.onAir?.elapsed ?? 0
  const remainingFrames = Math.max(0, onAirDurationFrames - elapsedFrames)
  const progressPercent =
    onAirDurationFrames > 0 ? Math.min(100, Math.round((elapsedFrames / onAirDurationFrames) * 100)) : 0

  // Scroll automático para o item no ar se o bloqueio followOnAir estiver habilitado
  const gridContainerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!followOnAir || onAirIndex < 0 || !gridContainerRef.current) return
    const rowHeight = 48
    const targetScroll = Math.max(0, (onAirIndex - 2) * rowHeight)
    gridContainerRef.current.scrollTo({
      top: targetScroll,
      behavior: 'smooth',
    })
  }, [followOnAir, onAirIndex])

  // Mídias do MAM combinadas com fontes externas / ao vivo (oculta arquivos ignorados pelo QC)
  const allAssets = useMemo<LibraryAsset[]>(() => {
    return folders.flatMap((f) => f.assets).filter((a) => !a.ignored)
  }, [folders])

  const allAssetsWithLive = useMemo(() => {
    const liveAsAssets: Array<LibraryAsset & { isLiveSource?: boolean; sourceRef?: string; family?: string }> = customSources.map((cs) => ({
      id: cs.id,
      title: cs.title,
      kind: 'VIDEO' as const,
      path: cs.sourceRef,
      contentHash: cs.id,
      fileName: cs.title,
      durationFrames: cs.durationFrames,
      durationNs: null,
      probe: null,
      probeError: null,
      categoryId: null,
      defaultTrim: null,
      defaultAudio: null,
      loudnessFile: null,
      suggestedTrim: null,
      thumbnailUrl: '',
      createdAt: new Date().toISOString(),
      isLiveSource: true,
      sourceRef: cs.sourceRef,
      family: cs.family,
    }))
    return [...allAssets, ...liveAsAssets]
  }, [allAssets, customSources])

  const filteredAssets = useMemo(() => {
    return allAssetsWithLive.filter((asset) => {
      const matchesSearch =
        mamSearch.trim() === '' ||
        asset.title.toLowerCase().includes(mamSearch.toLowerCase()) ||
        asset.path.toLowerCase().includes(mamSearch.toLowerCase())

      if (!matchesSearch) return false
      const isLive = 'isLiveSource' in asset && asset.isLiveSource
      if (selectedTag === 'TODOS') return true
      if (selectedTag === 'VT') return !isLive && asset.kind === 'VIDEO'
      if (selectedTag === 'JORNAL')
        return asset.title.toLowerCase().includes('jornal') || asset.path.toLowerCase().includes('jornal')
      if (selectedTag === 'AO VIVO')
        return isLive || asset.title.toLowerCase().includes('live') || asset.path.toLowerCase().includes('ao vivo')
      return true
    })
  }, [allAssetsWithLive, mamSearch, selectedTag])

  // Drag and drop do MAM para a grade
  const handleDragStart = (e: React.DragEvent, asset: any) => {
    e.dataTransfer.setData('text/plain', asset.id)
    e.dataTransfer.setData('application/rplayout-asset', JSON.stringify(asset))
    e.dataTransfer.effectAllowed = 'copy'
  }

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    const raw = e.dataTransfer.getData('application/rplayout-asset')
    if (raw) {
      try {
        const parsed = JSON.parse(raw)
        if (parsed.isLiveSource) {
          onInsertAsset(
            null,
            targetIndex,
            {
              sourceRef: parsed.sourceRef,
              title: parsed.title,
              durationOverride: parsed.durationFrames,
            },
            {
              eventType: 'LIVE',
              timingFlags: { trimmable: false, optional: false, protected: false },
            },
          )
          return
        }
        onInsertAsset(parsed.id, targetIndex, undefined, {
          eventType: 'SEQUENTIAL',
          timingFlags: { trimmable: false, optional: false, protected: false },
        })
        return
      } catch {}
    }
    const assetId = e.dataTransfer.getData('text/plain')
    if (assetId) {
      const liveSrc = customSources.find((s) => s.id === assetId)
      if (liveSrc) {
        onInsertAsset(
          null,
          targetIndex,
          {
            sourceRef: liveSrc.sourceRef,
            title: liveSrc.title,
            durationOverride: liveSrc.durationFrames,
          },
          {
            eventType: 'LIVE',
            timingFlags: { trimmable: false, optional: false, protected: false },
          },
        )
      } else {
        onInsertAsset(assetId, targetIndex, undefined, {
          eventType: 'SEQUENTIAL',
          timingFlags: { trimmable: false, optional: false, protected: false },
        })
      }
    }
  }

  // Audio meter telemetry
  const meter = live?.meters?.program ?? {
    peakDbfs: [-23.8, -24.1],
    momentaryLufs: -24.0,
    shortTermLufs: -24.0,
    integratedLufs: -24.0,
    rangeLu: 0,
    truePeakDbtp: -1.2,
    gainReductionDb: 0,
    correlation: 0.88,
  }

  const peak0 = meter.peakDbfs?.[0] ?? -60
  const peak1 = meter.peakDbfs?.[1] ?? -60
  const leftPeakPercent = Math.min(100, Math.max(0, ((peak0 + 60) / 60) * 100))
  const rightPeakPercent = Math.min(100, Math.max(0, ((peak1 + 60) / 60) * 100))

  return (
    <div className="bg-surface-base text-on-surface antialiased select-none h-screen flex flex-col font-body-md text-body-md overflow-hidden">
      {/* 1. HEADER PADRONIZADO RPLAYOUT (STITCH EXACT) */}
      <BroadcastHeader
        activeWorkspace="master"
        channel={channel}
        channels={channels}
        onSelectChannel={onSelectChannel}
        onNavigate={onNavigate}
        sessionRole={sessionRole}
        authRequired={authRequired}
        problemasCount={problemasCount}
        isLiveOnAir={Boolean(live?.transport?.playing && live?.transport?.onAir)}
        onOpenAlerts={onOpenAlerts}
        onOpenSettings={onOpenSettings}
        onOpenLiveInput={onOpenLiveInput}
      />

      <main className="w-full bg-surface-base flex-1 min-h-0 flex flex-col overflow-y-auto broadcast-scroll">
        {/* 1.1 WATCHDOG & SONDA DE PGM / SLATE DE EMERGÊNCIA (FASE C) */}
        <div className="w-full px-margin pt-2 pb-1 shrink-0">
          <PgmProbeBanner />
        </div>

        {/* 2. TOP OPERATIONAL STRIP (Compact Switcher & Monitors for Variante 2 - 4 Colunas) */}
        <section className="w-full bg-surface-card px-margin py-space-sm border-b border-border-subtle shrink-0">
          <div className="max-w-full mx-auto grid grid-cols-1 xl:grid-cols-12 gap-space-md items-stretch">
            {/* COLUNA 1: CARD NO AR [PGM] */}
            <div className="xl:col-span-3 flex flex-col gap-space-md justify-between">
              <div className="bg-surface-panel/80 border border-border-subtle p-space-md rounded-xl flex flex-col justify-between shadow-md relative overflow-hidden backdrop-blur-sm h-full">
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between flex-wrap gap-1.5 pb-1 border-b border-border-subtle/50">
                    <div className="flex items-center gap-1.5">
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-on-air-crimson/20 border border-on-air-crimson/40 text-on-air-crimson font-label-caps text-[9px] font-bold tracking-wider">
                        <span className="w-1.5 h-1.5 rounded-full bg-on-air-crimson animate-pulse"></span> NO AR
                      </span>
                      <span className="font-label-mono text-[10px] text-outline">
                        {formatStandardRate(channel.rate, channel.scan, channel.height)} • {onAirItem?.asset?.kind === 'VIDEO' ? 'ProRes HQ' : onAirItem?.asset?.kind ?? 'ProRes HQ'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-start justify-between gap-2 pt-0.5">
                    <h3 className="font-headline-md text-[17px] text-on-surface font-semibold tracking-wide leading-tight truncate" title={onAirItem?.asset?.title || onAirItem?.item.id || 'Nenhum item em reprodução'}>
                      {onAirItem?.asset?.title || onAirItem?.item.id || 'Nenhum item em reprodução'}
                    </h3>
                  </div>
                </div>
                <div className="my-1 text-center">
                  <div className="font-label-caps text-label-caps text-outline uppercase tracking-wider mb-0.5">TEMPO RESTANTE</div>
                  <div className="font-timecode-display text-[26px] text-on-air-crimson font-bold tabular-nums leading-none tracking-wider drop-shadow-[0_0_8px_rgba(255,59,48,0.45)]" id="onair-countdown">
                    {onAirItem ? dur(remainingFrames, rate) : '00:00:00:00'}
                  </div>
                  <div className="font-label-mono text-label-mono text-outline mt-1">
                    TC {onAirItem ? dur(elapsedFrames, rate) : '00:00:00:00'}
                  </div>
                </div>
                <div>
                  <div className="w-full bg-surface-container-lowest h-2 rounded-full overflow-hidden flex">
                    <div
                      className="bg-on-air-crimson h-full rounded-full transition-all duration-300"
                      style={{ width: `${progressPercent}%` }}
                    ></div>
                  </div>
                  <div className="flex justify-between items-center mt-1 font-label-mono text-label-mono text-outline">
                    <span>Progresso do Bloco</span>
                    <span className="text-on-surface font-medium tabular-nums">{progressPercent}%</span>
                  </div>
                </div>
              </div>
            </div>

            {/* COLUNA 2: MONITOR PGM */}
            <div className="xl:col-span-3 flex flex-col h-full">
              <BroadcastMonitor
                bus="pgm"
                className="w-full h-full"
                title="PGM • Monitor Principal"
                badgeText="NO AR"
                webrtcPath={monitors?.program ?? null}
                port={monitors?.port ?? 8889}
                asset={onAirItem?.asset ?? null}
                rate={channel.rate}
                scan={channel.scan}
                height={channel.height}
                positionFrames={elapsedFrames}
                durationFrames={onAirDurationFrames}
                isPlaying={live.transport.playing}
                isAudioMonitored={activeAudioBus === 'pgm'}
                onToggleAudioMonitor={() => setActiveAudioBus((prev) => (prev === 'pgm' ? null : 'pgm'))}
                onSeek={(frames) => onSeek('pgm', frames)}
                cgState={activeCgState}
              />
            </div>

            {/* COLUNA 3: MONITOR PVW */}
            <div className="xl:col-span-3 flex flex-col h-full">
              <BroadcastMonitor
                bus="pvw"
                className="w-full h-full"
                title="PVW • Próximo Evento"
                badgeText={selectedPreviewAsset ? 'MAM CUED' : 'CUED'}
                webrtcPath={monitors?.preview ?? null}
                port={monitors?.port ?? 8889}
                asset={activePreviewAsset}
                rate={channel.rate}
                scan={channel.scan}
                height={channel.height}
                positionFrames={live.transport.previewPosition?.frames ?? 0}
                durationFrames={activePreviewDuration}
                autoRemainingFrames={remainingFrames}
                isPlaying={false}
                isAudioMonitored={activeAudioBus === 'pvw'}
                onToggleAudioMonitor={() => setActiveAudioBus((prev) => (prev === 'pvw' ? null : 'pvw'))}
                onSeek={(frames) => onSeek('pvw', frames)}
                onWatching={(bus, watching) => {
                  void api.setWatching(channel.id, (bus as 'pvw') || 'pvw', watching)
                }}
              />
            </div>

            {/* COLUNA 4: PAINEL TÁTICO + CARD PRÓXIMO [PVW] */}
            <div className="xl:col-span-3 flex flex-col gap-space-md justify-between">
              {/* Card Superior: Painel Tático */}
              <div className="bg-surface-panel/90 border border-border-strong p-space-md rounded-xl flex flex-col justify-between shadow-lg relative overflow-hidden backdrop-blur-md">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="font-label-caps text-[9px] text-outline uppercase">Transição</span>
                    <div className="inline-flex rounded-lg bg-surface-container-lowest p-0.5 border border-border-subtle">
                      {(['CUT', 'MIX', 'WIPE'] as const).map((mode) => (
                        <button
                          key={mode}
                          onClick={() => setTransitionMode(mode)}
                          className={`px-1.5 py-0.5 rounded font-label-mono text-[9px] transition-colors cursor-pointer ${
                            transitionMode === mode
                              ? 'bg-primary-container text-on-primary-container font-semibold'
                              : 'text-on-surface-variant hover:text-on-surface'
                          }`}
                        >
                          {mode}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => setIsLocked(!isLocked)}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-container border border-border-subtle hover:bg-surface-container-high transition-colors cursor-pointer"
                    id="lock-toggle"
                  >
                    <span className={`material-symbols-outlined text-[13px] ${isLocked ? 'text-status-ok' : 'text-armed-amber'}`}>
                      {isLocked ? 'lock' : 'lock_open'}
                    </span>
                    <span className={`font-label-caps text-[9px] font-semibold ${isLocked ? 'text-status-ok' : 'text-armed-amber'}`}>
                      {isLocked ? 'TRAVADO' : 'PGM LIVRE'}
                    </span>
                  </button>
                </div>

                <div className="grid grid-cols-12 gap-1.5 items-center my-1 text-center">
                  <button
                    onClick={handleTake}
                    className="col-span-6 h-12 bg-on-air-crimson hover:bg-on-air-glow active:scale-[0.98] text-surface-base rounded-lg font-headline-lg text-[18px] uppercase font-bold tracking-wider flex items-center justify-center gap-1 shadow transition-all cursor-pointer"
                    id="btn-take"
                    title="Executar transição imediata para o próximo evento preparado (Espaço)"
                  >
                    <span className="material-symbols-outlined text-[18px]">play_arrow</span>
                    <span>TAKE</span>
                    <span className="bg-surface-base/20 px-1 py-0.2 rounded font-label-mono text-[8px] text-surface-base font-semibold">ESPAÇO</span>
                  </button>

                  <button
                    onClick={() => armedItem && onCue(armedItem.item.id)}
                    className="col-span-4 h-12 bg-armed-amber hover:bg-armed-glow active:scale-[0.98] text-surface-base rounded-lg font-headline-md text-[14px] uppercase font-bold tracking-wide flex flex-col items-center justify-center shadow transition-all cursor-pointer"
                    title="Armar próximo evento no PVW (F11)"
                  >
                    <div className="flex items-center gap-0.5">
                      <span className="material-symbols-outlined text-[14px]">skip_next</span>
                      <span>CUE</span>
                    </div>
                    <span className="font-label-mono text-[8px] text-surface-base/80 font-medium">F11</span>
                  </button>

                  <button
                    onClick={handleArmAbort}
                    className={`col-span-2 h-12 rounded-lg border border-border-subtle flex flex-col items-center justify-center transition-all cursor-pointer ${
                      abortArmed
                        ? 'bg-on-air-crimson text-white animate-pulse border-on-air-glow'
                        : 'bg-surface-container hover:bg-error-container text-outline hover:text-on-error-container'
                    }`}
                    title={abortArmed ? 'CLIQUE PARA CONFIRMAR PARADA IMEDIATA' : 'Parada de emergência com trava de segurança (ABORT)'}
                  >
                    <span className="material-symbols-outlined text-[15px]">stop</span>
                    <span className="font-label-mono text-[7px] uppercase font-bold">
                      {abortArmed ? `${abortCountdown}s` : 'ABORT'}
                    </span>
                  </button>
                </div>

                <div className="flex items-center justify-between font-label-mono text-[9px] text-outline pt-0.5 border-t border-border-subtle/40">
                  <span className="inline-flex items-center gap-1 text-on-surface-variant">
                    <span className="w-1.5 h-1.5 rounded-full bg-status-ok"></span> GENLOCK OK
                  </span>
                  <span>LATÊNCIA: 0.8ms</span>
                </div>
              </div>

              {/* Card Inferior: PRÓXIMO [PVW] */}
              <div className="bg-surface-panel/80 border border-border-subtle p-space-md rounded-xl flex flex-col justify-between shadow-md relative overflow-hidden">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-space-sm">
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-armed-amber/20 border border-armed-amber/40 text-armed-amber font-label-caps text-label-caps font-bold tracking-wider">
                      PRÓXIMO [PVW]
                    </span>
                    <span className="font-label-mono text-label-mono text-armed-amber bg-surface-container px-1.5 py-0.5 rounded">
                      {activePreviewAsset?.kind ?? 'COMERCIAL'}
                    </span>
                  </div>
                  <span className="font-label-mono text-label-mono text-status-ok-bright">AUTO-ARM</span>
                </div>

                <div className="my-space-xs">
                  <h3 className="font-headline-md text-[17px] text-on-surface font-semibold truncate tracking-wide" title={activePreviewAsset?.title || armedItem?.item.id || 'Nenhum item armado'}>
                    {activePreviewAsset?.title || armedItem?.item.id || 'Nenhum item armado'}
                  </h3>
                  <div className="flex items-baseline justify-between mt-1">
                    <div className="flex items-baseline gap-2">
                      <span className="font-label-caps text-label-caps text-outline uppercase tracking-wider">Duração</span>
                      <span className="font-timecode-display text-[24px] text-armed-amber font-bold tabular-nums leading-none tracking-wider">
                        {dur(activePreviewDuration, rate)}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="font-label-mono text-label-mono text-outline block">PREVISÃO</span>
                      <span className="font-timecode-table text-timecode-table text-on-surface font-semibold tabular-nums">
                        {armedItem && scheduleMap.get(armedItem.item.id)?.start != null
                          ? clock(scheduleMap.get(armedItem.item.id)!.start, rate)
                          : onAirItem && scheduleMap.get(onAirItem.item.id)?.end != null
                          ? clock(scheduleMap.get(onAirItem.item.id)!.end, rate)
                          : '--:--:--:--'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between text-on-surface-variant font-label-mono text-label-mono pt-1.5 border-t border-border-subtle/50">
                  <span className="text-outline">
                    {activePreviewAsset?.path?.endsWith('.mp4') ? 'H.264 • 25 Mbps' : 'ProRes • 1080p50'}
                  </span>
                  <span className="text-armed-amber font-semibold">
                    DISPARO EM {dur(remainingFrames, rate)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>
 
        {/* 2.1 PAINEL TÁTICO DE CG DINÂMICO (4 CAMADAS) & SCTE-35 CUE OUT (FASE D) */}
        <div className="w-full px-margin pt-2 pb-1 shrink-0">
          <DynamicCgSecondaryBar
            channelId={channel.id}
            onCgStateChange={setActiveCgState}
          />
        </div>
 
        {/* 3. MAIN LOWER SECTION: BIBLIOTECA MAM (ESQUERDA) & MONUMENTAL RUNDOWN (DIREITA) */}
        <section className="w-full px-margin py-space-sm flex-1 flex flex-col min-h-[520px]">
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-gutter items-stretch flex-1">
            {/* LEFT PANEL: BIBLIOTECA MAM (xl:col-span-3) */}
            <div className="xl:col-span-3 bg-surface-card border border-border-subtle p-space-lg rounded-xl flex flex-col gap-space-md shadow-sm h-full">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary text-[20px]">folder</span>
                  <span className="font-headline-md text-headline-md uppercase text-on-surface tracking-wide font-semibold">
                    Biblioteca MAM
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setFolderModalOpen(true)}
                    className="px-2 py-0.5 rounded bg-primary/15 hover:bg-primary/30 text-primary border border-primary/40 font-label-caps text-[9px] font-bold flex items-center gap-1 cursor-pointer transition-colors"
                    title="Adicionar pastas locais ou em rede ao acervo MAM"
                  >
                    <span className="material-symbols-outlined text-[13px]">create_new_folder</span>
                    + Pastas
                  </button>
                  <button
                    onClick={() => setLiveInputModalOpen(true)}
                    className="px-2 py-0.5 rounded bg-accent-ice/15 hover:bg-accent-ice/30 text-accent-ice-bright border border-accent-ice/40 font-label-caps text-[9px] font-bold flex items-center gap-1 cursor-pointer transition-colors"
                    title="Adicionar fonte externa (DeckLink SDI, NDI, WebRTC, SRT) à biblioteca"
                  >
                    <span className="material-symbols-outlined text-[13px]">settings_input_antenna</span>
                    + Ao Vivo
                  </button>
                  <span className="font-label-mono text-label-mono text-outline">
                    {allAssetsWithLive.length} ITENS
                  </span>
                </div>
              </div>

              {/* Barra de Busca MAM */}
              <div className="relative">
                <span className="material-symbols-outlined absolute left-2.5 top-2.5 text-outline text-[16px]">
                  search
                </span>
                <input
                  value={mamSearch}
                  onChange={(e) => setMamSearch(e.target.value)}
                  className="w-full bg-surface-container-lowest text-on-surface font-body-sm text-body-sm pl-8 pr-space-md py-2 rounded-lg border border-border-subtle placeholder-outline focus:outline-none focus:border-primary transition-colors"
                  placeholder="Buscar clipes ou matérias..."
                  type="text"
                />
              </div>

              {/* Filtros em Pílulas */}
              <div className="flex gap-1.5 pb-1">
                {(['TODOS', 'VT', 'JORNAL', 'AO VIVO'] as const).map((tag) => (
                  <button
                    key={tag}
                    onClick={() => setSelectedTag(tag)}
                    className={`px-2.5 py-1 rounded-full font-label-caps text-label-caps transition-colors cursor-pointer ${
                      selectedTag === tag
                        ? 'bg-primary-container text-on-primary-container font-semibold'
                        : 'bg-surface-panel hover:bg-surface-container text-on-surface-variant'
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>

              {/* Lista de Clipes com Drag & Drop */}
              <div className="flex flex-col gap-2 max-h-[460px] overflow-y-auto pr-1.5 flex-1 broadcast-scroll">
                {filteredAssets.length === 0 ? (
                  <div className="p-4 text-center text-outline font-body-sm">
                    Nenhuma mídia encontrada no filtro.
                  </div>
                ) : (
                  filteredAssets.map((asset) => {
                    const isLive = 'isLiveSource' in asset && (asset as any).isLiveSource
                    return (
                      <div
                        key={asset.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, asset)}
                        onClick={() => handleMamPreview(asset)}
                        className={`p-2.5 rounded-lg border cursor-grab active:cursor-grabbing flex items-center gap-3 transition-colors group relative ${
                          selectedPreviewAsset?.id === asset.id
                            ? 'bg-armed-amber/15 border-armed-amber/50 shadow-sm'
                            : isLive
                            ? 'bg-accent-ice/5 hover:bg-accent-ice/10 border-accent-ice/30'
                            : 'bg-surface-panel hover:bg-surface-container border-border-subtle'
                        }`}
                        title={
                          isLive
                            ? 'Fonte Externa Ao Vivo: Arraste para a grade ou clique + para adicionar'
                            : 'Clique para carregar e rodar preview no PVW'
                        }
                      >
                        <div className="w-14 h-10 bg-surface-container-lowest rounded overflow-hidden relative flex-shrink-0 flex items-center justify-center">
                          <span
                            className={`material-symbols-outlined text-[22px] ${
                              isLive ? 'text-accent-ice' : 'text-outline'
                            }`}
                          >
                            {isLive ? 'settings_input_antenna' : 'movie'}
                          </span>
                          <span className="absolute bottom-0.5 right-0.5 font-label-mono text-[9px] bg-surface-base/80 px-1 rounded">
                            {dur(asset.durationFrames, rate)}
                          </span>
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="font-body-sm text-body-sm font-medium text-on-surface truncate" title={asset.title}>
                            {asset.title}
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-outline font-label-mono text-label-mono">
                            {isLive ? (
                              <span className="text-accent-ice font-bold bg-accent-ice/15 px-1 py-0.2 rounded border border-accent-ice/30 text-[9px]">
                                AO VIVO • {((asset as any).family ?? 'LIVE')}
                              </span>
                            ) : (
                              <>
                                <span>{asset.kind}</span>
                                <span>•</span>
                                <span className={asset.probeError ? 'text-armed-amber font-semibold' : 'text-status-ok font-semibold'}>
                                  {asset.probeError ? 'REVISAR' : 'QC OK'}
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Ações Rápidas do Clip (Inserir na Grade) */}
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              if (isLive) {
                                onInsertAsset(null, undefined, {
                                  sourceRef: (asset as any).sourceRef,
                                  title: asset.title,
                                  durationOverride: asset.durationFrames,
                                })
                              } else {
                                onInsertAsset(asset.id)
                              }
                            }}
                            className="p-1 rounded bg-primary-container/20 hover:bg-primary-container text-primary hover:text-white border border-primary/30 cursor-pointer"
                            title="Adicionar à grade"
                          >
                            <span className="material-symbols-outlined text-[15px]">add</span>
                          </button>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>

            {/* RIGHT WIDE AREA: MONUMENTAL RUNDOWN & AUDIO EBU WIDGET (xl:col-span-9) */}
            <div className="xl:col-span-9 flex flex-col gap-space-md min-w-0">
              <div className="bg-surface-card border border-border-subtle p-space-lg rounded-xl flex flex-col gap-space-md shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3 pb-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                      <span className="font-headline-md text-headline-md uppercase text-on-surface font-semibold tracking-wide">
                        Grade de Exibição
                      </span>
                    </div>

                    {/* SELETOR DE VISUALIZAÇÃO: GRADE LINEAR vs TIMELINE MULTICAMADA 24H (FASE E) */}
                    <div className="flex items-center bg-surface-base p-1 rounded-lg border border-border-subtle">
                      <button
                        onClick={() => setViewMode('LINEAR')}
                        className={`px-3 py-1 rounded font-label-caps text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                          viewMode === 'LINEAR'
                            ? 'bg-surface-panel text-accent-ice border border-accent-ice/50 shadow-sm'
                            : 'text-outline hover:text-on-surface hover:bg-surface-container'
                        }`}
                        title="Visualização em Lista Tabular Monumental"
                      >
                        <span className="material-symbols-outlined text-[16px]">table_rows</span>
                        GRADE LINEAR
                      </button>
                      <button
                        onClick={() => setViewMode('TIMELINE')}
                        className={`px-3 py-1 rounded font-label-caps text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                          viewMode === 'TIMELINE'
                            ? 'bg-accent-ice text-white shadow-sm ring-1 ring-accent-ice/80'
                            : 'text-outline hover:text-on-surface hover:bg-surface-container'
                        }`}
                        title="Visualização Contínua em 4 Pistas (NTP, CG, SCTE, R128)"
                      >
                        <span className="material-symbols-outlined text-[16px]">view_timeline</span>
                        TIMELINE MULTICAMADA (24H)
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Botão de Trava de Rolagem no PGM (Scroll Lock) */}
                    <button
                      onClick={onToggleFollowOnAir}
                      className={`px-3 py-1.5 rounded-lg border font-body-sm text-body-sm flex items-center gap-1.5 transition-all cursor-pointer ${
                        followOnAir
                          ? 'bg-on-air-crimson/20 border-on-air-crimson text-on-air-crimson font-bold shadow-sm ring-1 ring-on-air-crimson/50'
                          : 'bg-surface-panel hover:bg-surface-container border-border-subtle text-outline hover:text-on-surface'
                      }`}
                      title={
                        followOnAir
                          ? 'Rolagem travada no item NO AR. Clique para liberar rolagem manual.'
                          : 'Rolagem livre. Clique para travar automaticamente no item NO AR.'
                      }
                    >
                      <span className="material-symbols-outlined text-[16px]">
                        {followOnAir ? 'lock' : 'lock_open'}
                      </span>
                      <span>{followOnAir ? 'TRAVADO NO AR' : 'ROLAGEM LIVRE'}</span>
                    </button>

                    <button
                      onClick={handleOpenAddLine}
                      className="px-3 py-1.5 rounded-lg bg-surface-panel hover:bg-surface-container border border-border-subtle text-on-surface font-body-sm text-body-sm flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[16px]">add</span> Linha
                    </button>
                    <button
                      onClick={onAutoFill}
                      className="px-3 py-1.5 rounded-lg bg-surface-panel hover:bg-surface-container border border-border-subtle text-on-surface font-body-sm text-body-sm flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[16px]">sync</span> EPG / Autofill
                    </button>
                    <button
                      onClick={() => {
                        onOpenConflicts?.()
                        setIsConflictDrawerOpen(true)
                      }}
                      className="px-3 py-1.5 rounded-lg bg-surface-panel hover:bg-surface-container border border-border-subtle text-armed-amber font-body-sm text-body-sm flex items-center gap-1.5 transition-colors cursor-pointer"
                      title="Verificar Conflitos da Grade (Conflict Drawer)"
                    >
                      <span className="material-symbols-outlined text-[16px]">rule</span> Conflitos
                    </button>
                    <button
                      onClick={onExportCsv}
                      className="px-3 py-1.5 rounded-lg bg-surface-panel hover:bg-surface-container border border-border-subtle text-on-surface font-body-sm text-body-sm flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[16px]">file_download</span> Exportar
                    </button>
                  </div>
                </div>

                {/* Visualização Condicional: TIMELINE MULTICAMADA vs GRADE LINEAR MONUMENTAL */}
                {viewMode === 'TIMELINE' ? (
                  <MultiTrackTimeline
                    channel={channel}
                    items={view.items}
                    onAirIndex={onAirIndex}
                    cuedIndex={cuedIndex}
                    elapsedFrames={elapsedFrames}
                    remainingFrames={remainingFrames}
                    onSelectItem={(index) => {
                      const target = view.items[index]
                      if (target) onCue(target.item.id)
                    }}
                    onAutoFill={onAutoFill}
                    rundownId={view.rundown?.id}
                  />
                ) : (
                  <>
                    {/* Monumental Rundown Table */}
                    <div
                      ref={gridContainerRef}
                  onDragOver={(e) => {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'copy'
                  }}
                  onWheel={
                    followOnAir
                      ? (e) => {
                          e.preventDefault()
                          e.stopPropagation()
                        }
                      : undefined
                  }
                  className={`w-full max-h-[380px] rounded-lg border border-border-subtle broadcast-scroll relative ${
                    followOnAir ? 'overflow-y-hidden select-none' : 'overflow-y-auto'
                  }`}
                >
                  <table
                    onDragOver={(e) => {
                      e.preventDefault()
                      e.dataTransfer.dropEffect = 'copy'
                    }}
                    className="w-full text-left font-body-sm text-body-sm border-collapse"
                  >
                    <thead className="bg-surface-panel/95 backdrop-blur-md sticky top-0 z-20 text-outline font-label-caps text-label-caps uppercase border-b border-border-subtle">
                      <tr className="h-11">
                        <th className="px-4 w-12 text-center font-timecode-table">#</th>
                        <th className="px-4 w-32 font-timecode-table">STATUS</th>
                        <th className="px-4 w-36 font-timecode-table">INÍCIO</th>
                        <th className="px-4 w-36 font-timecode-table">DURAÇÃO</th>
                        <th className="px-4 font-timecode-table">TÍTULO DO EVENTO</th>
                        <th className="px-4 w-32 text-right font-timecode-table">TIPO</th>
                        <th className="px-4 w-28 text-right font-timecode-table">AÇÕES</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-subtle/30 font-timecode-table text-timecode-table text-[14px]">
                      {view.items.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="text-center py-12 text-outline font-label-mono text-sm">
                            Grade vazia. Adicione itens pela Biblioteca MAM ou pelo botão "+ Linha".
                          </td>
                        </tr>
                      ) : (
                        view.items.map((item, index) => {
                          const isItemOnAir = index === onAirIndex
                          const isItemCued =
                            item.item.id === live.transport.preparedItemId ||
                            (selectedPreviewAsset === null && armedItem?.item.id === item.item.id)
                          const isAired = onAirIndex >= 0 && index < onAirIndex
                          const durationFrames = getItemDuration(item)
                          const isSelected = selectedItemIds.has(item.item.id)

                          const eventType: ScheduleEventType =
                            item.item.eventType ??
                            (item.item.anchor?.kind === 'HARD_TIME'
                              ? 'HARD_TIME'
                              : item.item.anchor?.kind === 'FIXED'
                                ? 'FIXED'
                                : item.item.type === 'LIVE' || item.item.sourceRef
                                  ? 'LIVE'
                                  : item.item.type === 'FILLER'
                                    ? 'FILLER'
                                    : 'SEQUENTIAL')

                          const trimmable = Boolean(item.item.timingFlags?.trimmable ?? item.item.trimmable)
                          const optional = Boolean(item.item.timingFlags?.optional ?? item.item.optional)
                          const isProtected = Boolean(item.item.timingFlags?.protected ?? item.item.protected)

                          let rowClass = 'hover:bg-surface-panel transition-colors border-b border-border-subtle/40 bg-surface-card h-12'
                          if (isSelected) {
                            rowClass = 'bg-primary-container/25 border-b border-primary/50 ring-1 ring-primary/60 text-white h-12'
                          } else if (isItemOnAir) {
                            rowClass = 'bg-on-air-crimson/10 border-b border-on-air-crimson/30 h-14'
                          } else if (isItemCued) {
                            rowClass = 'bg-armed-amber/15 border-b border-armed-amber/40 h-14 shadow-sm'
                          } else if (isAired) {
                            rowClass = 'opacity-50 hover:opacity-80 transition-opacity border-b border-border-subtle/40 bg-surface-card h-12'
                          }

                          if (dragOverIndex === index) {
                            rowClass += ' border-t-4 border-primary ring-2 ring-primary bg-primary/20 shadow-md'
                          }

                          return (
                            <tr
                              key={item.item.id}
                              onDragOver={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                e.dataTransfer.dropEffect = 'copy'
                                if (dragOverIndex !== index) setDragOverIndex(index)
                              }}
                              onDragLeave={() => {
                                if (dragOverIndex === index) setDragOverIndex(null)
                              }}
                              onDrop={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                handleDrop(e, index)
                                setDragOverIndex(null)
                              }}
                              onClick={(e) => handleRowClick(e, item, index)}
                              className={`${rowClass} group cursor-pointer`}
                              title="Clique para armar (CUE) no PVW • Ctrl/Shift para multiseleção"
                            >
                              <td className={`py-3 px-4 text-center font-label-mono text-label-mono ${
                                isItemOnAir ? 'text-on-air-crimson font-bold text-[14px]' : isItemCued ? 'text-armed-amber font-bold text-[14px]' : 'text-outline'
                              }`}>
                                {index + 1}
                              </td>

                              <td className="py-3 px-4">
                                {isItemOnAir ? (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-on-air-crimson text-surface-base font-label-caps text-label-caps font-bold">
                                    <span className="w-1.5 h-1.5 rounded-full bg-surface-base animate-ping"></span> NO AR
                                  </span>
                                ) : isItemCued ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-armed-amber text-surface-base font-label-caps text-label-caps font-bold">
                                    CUED
                                  </span>
                                ) : isAired ? (
                                  <span className="px-2.5 py-1 rounded font-label-caps text-label-caps text-outline bg-surface-container">
                                    EXIBIDO
                                  </span>
                                ) : (
                                  <span className="px-2.5 py-1 rounded font-label-caps text-label-caps text-status-ok-bright bg-surface-container font-semibold">
                                    PRONTO
                                  </span>
                                )}
                              </td>

                              <td className={`py-3 px-4 tabular-nums text-[14px] ${
                                isItemOnAir ? 'text-on-surface font-bold' : isItemCued ? 'text-armed-amber font-bold' : 'text-on-surface-variant'
                              }`}>
                                {scheduleMap.get(item.item.id)?.start != null
                                  ? clock(scheduleMap.get(item.item.id)!.start, rate)
                                  : '--:--:--:--'}
                              </td>

                              <td className={`py-3 px-4 tabular-nums text-[14px] ${
                                isItemOnAir ? 'text-on-air-crimson font-bold' : isItemCued ? 'text-on-surface' : 'text-on-surface-variant'
                              }`}>
                                {dur(durationFrames, rate)}
                              </td>

                              <td className="py-2.5 px-4 font-body-sm text-body-sm">
                                <div className="flex items-center gap-2 min-w-0">
                                  {/* Badges de Tipo de Evento (Fase A) */}
                                  {eventType === 'HARD_TIME' && (
                                    <span
                                      title="Ponto de Sincronismo Obrigatório de Rede (Hard Sync frame-accurate no frame zero)"
                                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-950/80 border border-rose-600/70 text-rose-300 text-[10px] font-label-caps tracking-wider font-bold shrink-0 shadow-xs"
                                    >
                                      <span className="material-symbols-outlined text-[13px] text-rose-400">schedule</span>
                                      HARD SYNC
                                    </span>
                                  )}
                                  {eventType === 'FIXED' && (
                                    <span
                                      title="Horário Fixo Ancorado no Relógio da Emissora"
                                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-950/60 border border-amber-600/50 text-amber-300 text-[10px] font-label-caps tracking-wider font-bold shrink-0"
                                    >
                                      <span className="material-symbols-outlined text-[13px] text-amber-400">lock_clock</span>
                                      FIXO
                                    </span>
                                  )}
                                  {eventType === 'LIVE' && (
                                    <span
                                      title="Entrada de Sinal Ao Vivo Externa / Estúdio"
                                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-accent-ice/20 border border-accent-ice/50 text-accent-ice-bright text-[10px] font-label-caps tracking-wider font-bold shrink-0"
                                    >
                                      <span className="material-symbols-outlined text-[13px] text-accent-ice-bright animate-pulse">sensors</span>
                                      AO VIVO
                                    </span>
                                  )}
                                  {eventType === 'FILLER' && (
                                    <span
                                      title="Item Elástico de Preenchimento (Gap Fill / Elastic)"
                                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-950/60 border border-purple-500/50 text-purple-300 text-[10px] font-label-caps tracking-wider font-bold shrink-0"
                                    >
                                      <span className="material-symbols-outlined text-[13px] text-purple-400">auto_awesome</span>
                                      FILLER
                                    </span>
                                  )}

                                  {/* Título textual com truncamento */}
                                  <span
                                    className={`truncate text-[13px] flex-1 min-w-0 ${
                                      isItemOnAir
                                        ? 'text-on-surface font-bold'
                                        : isItemCued
                                          ? 'text-on-surface font-semibold'
                                          : 'text-on-surface font-medium'
                                    }`}
                                    title={item.asset?.title || item.item.title || item.item.id}
                                  >
                                    {item.asset?.title || item.item.title || item.item.id}
                                  </span>

                                  {/* Micro-tags de Timing Flags (Fase A) */}
                                  {(isProtected || trimmable || optional) && (
                                    <div className="flex items-center gap-1 shrink-0 ml-1">
                                      {isProtected && (
                                        <span
                                          title="Material Comercial ou Editorial Protegido: Bloqueado contra corte e descarte automático"
                                          className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded bg-emerald-950/70 border border-emerald-500/50 text-emerald-300 font-label-mono text-[9px] font-bold"
                                        >
                                          <span className="material-symbols-outlined text-[11px] text-emerald-400">shield</span>
                                          PROT
                                        </span>
                                      )}
                                      {trimmable && (
                                        <span
                                          title="Trimmable: Pode ter cauda reduzida para absorver atrasos e salvar a grade"
                                          className="px-1 py-0.2 rounded bg-surface-container border border-border-subtle text-outline font-label-mono text-[9px] font-medium tracking-tight"
                                        >
                                          [TRIM]
                                        </span>
                                      )}
                                      {optional && (
                                        <span
                                          title="Opcional: Pode ser descartado da grade em caso de emergência temporal"
                                          className="px-1 py-0.2 rounded bg-surface-container border border-border-subtle text-outline font-label-mono text-[9px] font-medium tracking-tight"
                                        >
                                          [OPT]
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </td>

                              <td className="py-2.5 px-4 text-right">
                                <div className="flex flex-col items-end justify-center leading-tight">
                                  <span className={`font-label-caps text-label-caps font-bold ${
                                    item.item.sourceRef
                                      ? 'text-accent-ice'
                                      : item.asset?.kind === 'VIDEO'
                                      ? 'text-primary'
                                      : 'text-armed-amber'
                                  }`}>
                                    {item.item.sourceRef ? 'AO VIVO' : item.asset?.kind ?? item.item.type ?? 'VT'}
                                  </span>
                                  {eventType !== 'SEQUENTIAL' ? (
                                    <span className={`text-[10px] font-label-mono font-medium ${
                                      eventType === 'HARD_TIME'
                                        ? 'text-rose-400'
                                        : eventType === 'FIXED'
                                          ? 'text-amber-400'
                                          : eventType === 'LIVE'
                                            ? 'text-accent-ice-bright'
                                            : 'text-purple-400'
                                    }`}>
                                      {eventType === 'HARD_TIME' ? 'HARD SYNC' : eventType}
                                    </span>
                                  ) : (
                                    <span className="text-[10px] font-label-mono text-outline/60">
                                      SEQ
                                    </span>
                                  )}
                                </div>
                              </td>

                              <td className="py-2.5 px-4 text-right">
                                <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleOpenEditLine(item)
                                    }}
                                    className="p-1 rounded hover:bg-surface-container text-outline hover:text-on-surface"
                                    title="Editar Disciplina Temporal & Flags (Fase A)"
                                  >
                                    <span className="material-symbols-outlined text-[15px]">tune</span>
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      onOpenTrim(item)
                                    }}
                                    className="p-1 rounded hover:bg-surface-container text-outline hover:text-on-surface"
                                    title="Ajustar Trim (IN / OUT)"
                                  >
                                    <span className="material-symbols-outlined text-[15px]">content_cut</span>
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      onOpenAudio(item)
                                    }}
                                    className="p-1 rounded hover:bg-surface-container text-outline hover:text-on-surface"
                                    title="Ajustar Canais de Áudio"
                                  >
                                    <span className="material-symbols-outlined text-[15px]">volume_up</span>
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      onOpenGraphics(item)
                                    }}
                                    className="p-1 rounded hover:bg-surface-container text-outline hover:text-on-surface"
                                    title="GCs e Vinhetas"
                                  >
                                    <span className="material-symbols-outlined text-[15px]">layers</span>
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      onRemoveItem(item.item.id)
                                    }}
                                    className="p-1 rounded hover:bg-error-container text-outline hover:text-on-error-container"
                                    title="Remover linha"
                                  >
                                    <span className="material-symbols-outlined text-[15px]">delete</span>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )
                        })
                      )}

                      {/* Dropzone no fim da grade */}
                      <tr
                        onDragOver={(e) => {
                          e.preventDefault()
                          e.dataTransfer.dropEffect = 'copy'
                          if (dragOverIndex !== view.items.length) setDragOverIndex(view.items.length)
                        }}
                        onDragLeave={() => {
                          if (dragOverIndex === view.items.length) setDragOverIndex(null)
                        }}
                        onDrop={(e) => {
                          e.preventDefault()
                          handleDrop(e, view.items.length)
                          setDragOverIndex(null)
                        }}
                        className={`h-11 border-2 border-dashed transition-all cursor-pointer ${
                          dragOverIndex === view.items.length
                            ? 'border-primary bg-primary/25 text-primary font-bold shadow-inner'
                            : 'border-border-subtle/30 text-outline/60 hover:border-border-subtle bg-surface-base/30'
                        }`}
                      >
                        <td colSpan={7} className="text-center font-label-caps text-xs py-2">
                          {dragOverIndex === view.items.length
                            ? '⬇ Solte aqui para inserir no fim da grade'
                            : '+ Arraste clipes do MAM ou fontes externas para anexar à grade'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center justify-between font-label-mono text-label-mono text-outline pt-1">
                  <span>{view.items.length} EVENTOS PROGRAMADOS • MODO MONUMENTAL ATIVO</span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-status-ok"></span> AUTOMAÇÃO ATIVA
                  </span>
                </div>
              </>
            )}
          </div>

              {/* Integrated Horizontal Bottom Bar Widget: Audio EBU R128 Loudness Bar */}
              <div className="bg-surface-card border border-border-subtle px-space-lg py-space-sm rounded-xl flex items-center justify-between gap-space-lg shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-accent-ice text-[18px]">equalizer</span>
                    <span className="font-label-caps text-label-caps uppercase text-on-surface font-bold">
                      Áudio EBU R128
                    </span>
                  </div>
                  <span className="font-headline-md text-[18px] text-status-ok-bright font-bold tabular-nums">
                    {meter.integratedLufs.toFixed(1)} LUFS
                  </span>
                </div>

                <div className="flex-1 max-w-xl flex items-center gap-space-md">
                  <div className="flex-1 flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-label-mono text-[9px] text-outline w-3">L</span>
                      <div className="h-2 flex-1 bg-surface-container-lowest rounded-full overflow-hidden flex border border-border-subtle/40">
                        <div
                          className="bg-status-ok h-full rounded-full transition-all duration-150"
                          style={{ width: `${leftPeakPercent}%` }}
                        ></div>
                      </div>
                      <span className="font-label-mono text-[9px] text-on-surface tabular-nums w-8">
                        {meter.peakDbfs[0]?.toFixed(1) ?? '-23.8'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-label-mono text-[9px] text-outline w-3">R</span>
                      <div className="h-2 flex-1 bg-surface-container-lowest rounded-full overflow-hidden flex border border-border-subtle/40">
                        <div
                          className="bg-status-ok h-full rounded-full transition-all duration-150"
                          style={{ width: `${rightPeakPercent}%` }}
                        ></div>
                      </div>
                      <span className="font-label-mono text-[9px] text-on-surface tabular-nums w-8">
                        {meter.peakDbfs[1]?.toFixed(1) ?? '-24.1'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-space-md font-label-mono text-label-mono text-outline">
                  <span>FASE: {meter.correlation >= 0 ? `+${meter.correlation.toFixed(2)}` : meter.correlation.toFixed(2)}</span>
                  <span className="text-status-ok flex items-center gap-1 font-semibold">
                    <span className="w-1.5 h-1.5 rounded-full bg-status-ok"></span> EM FASE
                  </span>
                  <div className="h-4 w-px bg-border-subtle"></div>
                  {/* Badge de Cobertura do Cache de Continuidade (Fase C: 48h AIR-GAP) */}
                  <ContinuityCacheBadge />
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* MODAL 1: Ingestão de Entrada Externa / DeckLink na Biblioteca MAM */}
      {liveInputModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4"
          onClick={() => setLiveInputModalOpen(false)}
        >
          <div
            className="bg-surface-card border border-border-subtle rounded-xl max-w-lg w-full p-6 shadow-2xl flex flex-col gap-4 text-on-surface animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border-subtle pb-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-accent-ice text-[24px]">settings_input_antenna</span>
                <div>
                  <h3 className="font-headline-md text-headline-md font-bold uppercase tracking-wide">
                    Cadastrar Fonte Ao Vivo no MAM
                  </h3>
                  <p className="font-label-mono text-label-mono text-outline">
                    Entrada SDI DeckLink, Stream NDI, SRT ou WebRTC
                  </p>
                </div>
              </div>
              <button
                onClick={() => setLiveInputModalOpen(false)}
                className="p-1 rounded hover:bg-surface-container text-outline hover:text-on-surface cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="flex flex-col gap-3">
              <div>
                <label className="font-label-caps text-label-caps text-outline block mb-1">
                  NOME / IDENTIFICADOR DA FONTE
                </label>
                <input
                  type="text"
                  value={newLiveTitle}
                  onChange={(e) => setNewLiveTitle(e.target.value)}
                  className="w-full bg-surface-panel border border-border-subtle rounded-lg px-3 py-2 text-on-surface font-body-sm focus:border-primary focus:outline-none"
                  placeholder="ex: DeckLink SDI 1 - Switcher Estúdio"
                />
              </div>

              <div>
                <label className="font-label-caps text-label-caps text-outline block mb-1">
                  DURAÇÃO ESTIMADA (MINUTOS)
                </label>
                <input
                  type="number"
                  min={1}
                  max={720}
                  value={newLiveDurationMin}
                  onChange={(e) => setNewLiveDurationMin(Math.max(1, Number(e.target.value) || 1))}
                  className="w-full bg-surface-panel border border-border-subtle rounded-lg px-3 py-2 text-on-surface font-body-sm focus:border-primary focus:outline-none"
                />
              </div>

              {/* Seletor Modular de Protocolos Canônicos (NDI, SDI, SRT, RTMP) */}
              <CanonicalProtocolSelector
                mode="INPUT"
                defaultKind="SDI"
                initialUri={newLiveRef}
                onChange={(res) => {
                  setNewLiveRef(res.targetUri)
                  setNewLiveFamily(res.kind as any)
                  if (!newLiveTitle || newLiveTitle.startsWith('DeckLink') || newLiveTitle.startsWith('NDI') || newLiveTitle.startsWith('SRT')) {
                    if (res.nameRecommendation) setNewLiveTitle(res.nameRecommendation)
                  }
                }}
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-border-subtle">
              <button
                onClick={() => setLiveInputModalOpen(false)}
                className="px-4 py-2 rounded-lg bg-surface-panel hover:bg-surface-container border border-border-subtle text-outline hover:text-on-surface font-body-sm cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  if (!newLiveTitle.trim() || !newLiveRef.trim()) return
                  const fpsVal = rate.num / rate.den
                  const durFrames = Math.round(newLiveDurationMin * 60 * fpsVal)
                  const newSource: CustomLiveSource = {
                    id: `live-${Date.now()}`,
                    title: newLiveTitle.trim(),
                    sourceRef: newLiveRef.trim(),
                    family: newLiveFamily,
                    durationFrames: durFrames,
                  }
                  saveCustomSource(newSource)
                  setLiveInputModalOpen(false)
                }}
                className="px-4 py-2 rounded-lg bg-primary hover:bg-accent-ice text-surface-base font-body-sm font-bold shadow transition-all cursor-pointer"
              >
                Salvar na Biblioteca MAM
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Adicionar ou Editar Linha na Grade (Fase A) */}
      {addLineModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4"
          onClick={() => {
            setAddLineModalOpen(false)
            setEditingItemView(null)
          }}
        >
          <div
            className="bg-surface-card border border-border-subtle rounded-xl max-w-xl w-full p-6 shadow-2xl flex flex-col gap-4 text-on-surface animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto broadcast-scroll"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-border-subtle pb-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[24px]">
                  {editingItemView ? 'tune' : 'playlist_add'}
                </span>
                <div>
                  <h3 className="font-headline-md text-headline-md font-bold uppercase tracking-wide">
                    {editingItemView ? 'Configurações de Automação do Item (Fase A)' : 'Adicionar Linha na Grade'}
                  </h3>
                  <p className="font-label-mono text-label-mono text-outline">
                    {editingItemView
                      ? `Linha #${view.items.findIndex((i) => i.item.id === editingItemView.item.id) + 1} • Disciplina Temporal & Políticas de Compensação`
                      : 'Passo 1: Selecione a Mídia • Passo 2: Defina Disciplina & Posição'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setAddLineModalOpen(false)
                  setEditingItemView(null)
                }}
                className="p-1 rounded hover:bg-surface-container text-outline hover:text-on-surface cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {/* MODO EDIÇÃO: Exibe cabeçalho informativo do item já presente na grade */}
            {editingItemView ? (
              <div className="bg-surface-panel p-3 rounded-lg border border-border-subtle flex items-center justify-between">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className={`material-symbols-outlined text-[22px] ${
                    editingItemView.item.sourceRef ? 'text-accent-ice' : 'text-primary'
                  }`}>
                    {editingItemView.item.sourceRef ? 'settings_input_antenna' : 'movie'}
                  </span>
                  <div className="truncate">
                    <div className="font-body-sm text-body-sm font-bold text-on-surface truncate">
                      {editingItemView.asset?.title || editingItemView.item.title || editingItemView.item.id}
                    </div>
                    <div className="text-[11px] font-label-mono text-outline">
                      ID: {editingItemView.item.id.slice(0, 12)}... • Tipo Base: {editingItemView.item.type}
                    </div>
                  </div>
                </div>
                <span className="text-[13px] font-timecode-table font-bold text-on-surface shrink-0 ml-2">
                  {dur(getItemDuration(editingItemView), rate)}
                </span>
              </div>
            ) : (
              /* MODO ADIÇÃO: Abas de Escolha: Biblioteca MAM vs Nova Fonte Externa */
              <>
                <div className="flex gap-2 border-b border-border-subtle pb-2">
                  <button
                    onClick={() => setAddLineTab('library')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-label-caps text-label-caps cursor-pointer transition-colors ${
                      addLineTab === 'library'
                        ? 'bg-primary-container text-on-primary-container font-bold'
                        : 'bg-surface-panel text-outline hover:text-on-surface'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[16px]">folder</span>
                    1. Mídias da Biblioteca MAM ({allAssetsWithLive.length})
                  </button>
                  <button
                    onClick={() => setAddLineTab('live')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-label-caps text-label-caps cursor-pointer transition-colors ${
                      addLineTab === 'live'
                        ? 'bg-accent-ice/20 border border-accent-ice text-accent-ice-bright font-bold'
                        : 'bg-surface-panel text-outline hover:text-on-surface'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[16px]">settings_input_antenna</span>
                    2. Nova Entrada Ao Vivo (DeckLink/NDI)
                  </button>
                </div>

                {addLineTab === 'library' ? (
                  <div className="flex flex-col gap-3">
                    <div className="relative">
                      <span className="material-symbols-outlined absolute left-2.5 top-2.5 text-outline text-[16px]">
                        search
                      </span>
                      <input
                        type="text"
                        value={addLineSearch}
                        onChange={(e) => setAddLineSearch(e.target.value)}
                        placeholder="Filtrar por nome ou caminho..."
                        className="w-full bg-surface-panel border border-border-subtle rounded-lg pl-8 pr-3 py-2 text-on-surface font-body-sm focus:border-primary focus:outline-none"
                      />
                    </div>

                    <div className="max-h-44 overflow-y-auto border border-border-subtle rounded-lg divide-y divide-border-subtle/50 broadcast-scroll bg-surface-base/50">
                      {allAssetsWithLive
                        .filter(
                          (a) =>
                            addLineSearch.trim() === '' ||
                            a.title.toLowerCase().includes(addLineSearch.toLowerCase()) ||
                            a.path.toLowerCase().includes(addLineSearch.toLowerCase()),
                        )
                        .map((asset) => {
                          const isSelected = addLineSelectedAssetId === asset.id
                          const isLive = 'isLiveSource' in asset && (asset as any).isLiveSource
                          return (
                            <div
                              key={asset.id}
                              onClick={() => {
                                setAddLineSelectedAssetId(asset.id)
                                if (isLive) setLineEventType('LIVE')
                              }}
                              className={`p-2 flex items-center justify-between cursor-pointer transition-colors ${
                                isSelected
                                  ? 'bg-primary-container/20 border-l-4 border-primary font-semibold'
                                  : 'hover:bg-surface-panel'
                              }`}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span
                                  className={`material-symbols-outlined text-[18px] ${
                                    isLive ? 'text-accent-ice' : 'text-outline'
                                  }`}
                                >
                                  {isLive ? 'settings_input_antenna' : 'movie'}
                                </span>
                                <span className="font-body-sm text-body-sm text-on-surface truncate max-w-sm">
                                  {asset.title}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 font-label-mono text-label-mono text-outline">
                                {isLive && (
                                  <span className="text-accent-ice font-bold text-[9px] bg-accent-ice/15 px-1 py-0.2 rounded">
                                    AO VIVO
                                  </span>
                                )}
                                <span>{dur(asset.durationFrames, rate)}</span>
                              </div>
                            </div>
                          )
                        })}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    <div>
                      <label className="font-label-caps text-label-caps text-outline block mb-1">
                        NOME DA ENTRADA AO VIVO
                      </label>
                      <input
                        type="text"
                        value={newLiveTitle}
                        onChange={(e) => setNewLiveTitle(e.target.value)}
                        className="w-full bg-surface-panel border border-border-subtle rounded-lg px-3 py-2 text-on-surface font-body-sm focus:border-primary focus:outline-none"
                        placeholder="ex: DeckLink SDI 1 - Estúdio A"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="font-label-caps text-label-caps text-outline block mb-1">
                          TIPO DE SINAL
                        </label>
                        <select
                          value={newLiveFamily}
                          onChange={(e) => {
                            const fam = e.target.value as any
                            setNewLiveFamily(fam)
                            if (fam === 'SDI') setNewLiveRef('sdi:0')
                            else if (fam === 'NDI') setNewLiveRef('ndi:ESTUDIO-A-MASTER')
                            else if (fam === 'SRT') setNewLiveRef('srt://127.0.0.1:9000?mode=listener')
                            else setNewLiveRef('http://localhost:8889/live_cam')
                          }}
                          className="w-full bg-surface-panel border border-border-subtle rounded-lg px-3 py-2 text-on-surface font-body-sm focus:border-primary focus:outline-none cursor-pointer"
                        >
                          <option value="SDI">DeckLink SDI / HDMI</option>
                          <option value="NDI">NDI 5.6 (Rede IP)</option>
                          <option value="SRT">SRT / RTMP Stream</option>
                          <option value="WEBRTC">WebRTC Ingest</option>
                        </select>
                      </div>

                      <div>
                        <label className="font-label-caps text-label-caps text-outline block mb-1">
                          DURAÇÃO ESTIMADA (MIN)
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={720}
                          value={newLiveDurationMin}
                          onChange={(e) => setNewLiveDurationMin(Math.max(1, Number(e.target.value) || 1))}
                          className="w-full bg-surface-panel border border-border-subtle rounded-lg px-3 py-2 text-on-surface font-body-sm focus:border-primary focus:outline-none"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="font-label-caps text-label-caps text-outline block mb-1">
                        REFERÊNCIA / ENDEREÇO DA FONTE
                      </label>
                      <input
                        type="text"
                        value={newLiveRef}
                        onChange={(e) => setNewLiveRef(e.target.value)}
                        className="w-full bg-surface-panel border border-border-subtle rounded-lg px-3 py-2 text-on-surface font-mono text-[13px] focus:border-primary focus:outline-none"
                      />
                    </div>

                    <label className="flex items-center gap-2 cursor-pointer pt-1">
                      <input
                        type="checkbox"
                        checked={addLineSaveToLibrary}
                        onChange={(e) => setAddLineSaveToLibrary(e.target.checked)}
                        className="rounded border-border-subtle text-primary focus:ring-primary"
                      />
                      <span className="font-body-sm text-body-sm text-on-surface">
                        Salvar também na Biblioteca MAM para reutilização futura
                      </span>
                    </label>
                  </div>
                )}

                {/* Posição de Inserção na Grade */}
                <div className="bg-surface-panel p-3 rounded-lg border border-border-subtle flex flex-col gap-2">
                  <span className="font-label-caps text-label-caps text-outline font-bold">
                    POSIÇÃO NA GRADE DE EXIBIÇÃO:
                  </span>
                  <div className="flex items-center gap-4 text-body-sm">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="targetPos"
                        checked={addLineTargetMode === 'end'}
                        onChange={() => setAddLineTargetMode('end')}
                      />
                      <span>No fim da grade (Posição #{view.items.length + 1})</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="targetPos"
                        checked={addLineTargetMode === 'index'}
                        onChange={() => setAddLineTargetMode('index')}
                      />
                      <span>Posição #:</span>
                      <input
                        type="number"
                        min={1}
                        max={view.items.length + 1}
                        value={addLineTargetIndex}
                        disabled={addLineTargetMode !== 'index'}
                        onChange={(e) => setAddLineTargetIndex(Math.max(1, Number(e.target.value) || 1))}
                        className="w-16 bg-surface-card border border-border-subtle rounded px-2 py-0.5 text-center disabled:opacity-50"
                      />
                    </label>
                  </div>
                </div>
              </>
            )}

            {/* SEÇÃO FASE A: Disciplina Temporal & Políticas de Compensação */}
            <div className="bg-surface-panel p-3.5 rounded-lg border border-border-subtle flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-accent-ice-bright">schedule</span>
                  <span className="font-label-caps text-label-caps text-on-surface font-bold uppercase tracking-wider">
                    Disciplina Temporal &amp; Políticas de Compensação (Fase A)
                  </span>
                </div>
                <span className="text-[10px] font-label-mono text-outline">FRAME-ACCURATE ENGINE</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Tipo de Evento (ScheduleEventType) */}
                <div>
                  <label className="font-label-caps text-label-caps text-outline block mb-1">
                    TIPO DE COMPORTAMENTO TEMPORAL
                  </label>
                  <select
                    value={lineEventType}
                    onChange={(e) => setLineEventType(e.target.value as ScheduleEventType)}
                    className="w-full bg-surface-card border border-border-subtle rounded-lg px-3 py-2 text-on-surface font-body-sm focus:border-primary focus:outline-none cursor-pointer"
                  >
                    <option value="SEQUENTIAL">SEQUENTIAL — Padrão Auto-Follow contínuo</option>
                    <option value="FIXED">FIXED — Início ancorado em horário fixo</option>
                    <option value="HARD_TIME">HARD_TIME — Sincronismo rígido de rede (Hard Sync)</option>
                    <option value="LIVE">LIVE — Entrada de sinal ao vivo com drift</option>
                    <option value="FILLER">FILLER — Item elástico / preenchimento de gaps</option>
                  </select>
                  <p className="text-[11px] text-outline mt-1 font-body-sm leading-tight">
                    {lineEventType === 'SEQUENTIAL' && 'Disparo sequencial imediato. Absorve fila normal sem ancoragem fixa.'}
                    {lineEventType === 'FIXED' && 'Ancorado no relógio da emissora. Aguarda ou avisa desvio até o timestamp exato.'}
                    {lineEventType === 'HARD_TIME' && 'Ponto inegociável de rede. Disparo mandatório no frame 00:00:00:00.'}
                    {lineEventType === 'LIVE' && 'Feed ao vivo externo com duração estimada e ajuste elástico da fila.'}
                    {lineEventType === 'FILLER' && 'Absorve folgas ou sobras de tempo da grade expandindo ou encolhendo.'}
                  </p>
                </div>

                {/* Timing Flags */}
                <div>
                  <label className="font-label-caps text-label-caps text-outline block mb-1">
                    POLÍTICAS DE COMPENSAÇÃO (FLAGS)
                  </label>
                  <div className="flex flex-col gap-1.5 bg-surface-card/60 p-2 rounded-lg border border-border-subtle/50">
                    <label className="flex items-center gap-2 cursor-pointer text-body-sm hover:text-on-surface text-on-surface-variant transition-colors">
                      <input
                        type="checkbox"
                        checked={lineProtected}
                        onChange={(e) => {
                          const val = e.target.checked
                          setLineProtected(val)
                          if (val) setLineTrimmable(false)
                        }}
                        className="rounded border-border-subtle text-emerald-500 focus:ring-emerald-500"
                      />
                      <span className="flex items-center gap-1 font-semibold text-emerald-400">
                        <span className="material-symbols-outlined text-[14px]">shield</span>
                        PROTECTED
                      </span>
                      <span className="text-[11px] text-outline ml-auto">Não corta nem descarta</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer text-body-sm hover:text-on-surface text-on-surface-variant transition-colors">
                      <input
                        type="checkbox"
                        checked={lineTrimmable}
                        disabled={lineProtected}
                        onChange={(e) => setLineTrimmable(e.target.checked)}
                        className="rounded border-border-subtle text-primary focus:ring-primary disabled:opacity-50"
                      />
                      <span className={`font-mono text-[11px] ${lineProtected ? 'opacity-50' : 'text-primary'}`}>
                        [TRIM] TRIMMABLE
                      </span>
                      <span className="text-[11px] text-outline ml-auto">Permite corte de cauda</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer text-body-sm hover:text-on-surface text-on-surface-variant transition-colors">
                      <input
                        type="checkbox"
                        checked={lineOptional}
                        disabled={lineProtected}
                        onChange={(e) => setLineOptional(e.target.checked)}
                        className="rounded border-border-subtle text-primary focus:ring-primary disabled:opacity-50"
                      />
                      <span className={`font-mono text-[11px] ${lineProtected ? 'opacity-50' : 'text-primary'}`}>
                        [OPT] OPTIONAL
                      </span>
                      <span className="text-[11px] text-outline ml-auto">Descartável em emergência</span>
                    </label>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Actions Footer */}
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-border-subtle">
              <button
                onClick={() => {
                  setAddLineModalOpen(false)
                  setEditingItemView(null)
                }}
                className="px-4 py-2 rounded-lg bg-surface-panel hover:bg-surface-container border border-border-subtle text-outline hover:text-on-surface font-body-sm cursor-pointer"
              >
                Cancelar
              </button>

              {editingItemView ? (
                <button
                  disabled={isSavingLineConfig}
                  onClick={handleSaveEditedLine}
                  className="px-4 py-2 rounded-lg bg-primary hover:bg-accent-ice text-surface-base font-body-sm font-bold shadow transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-60"
                >
                  <span className="material-symbols-outlined text-[18px]">save</span>
                  {isSavingLineConfig ? 'Salvando...' : 'Salvar Alterações'}
                </button>
              ) : (
                <button
                  onClick={() => {
                    const targetIdx = addLineTargetMode === 'index' ? addLineTargetIndex - 1 : undefined
                    const options = {
                      eventType: lineEventType,
                      timingFlags: {
                        trimmable: lineTrimmable,
                        optional: lineOptional,
                        protected: lineProtected,
                      },
                    }

                    if (addLineTab === 'library') {
                      if (!addLineSelectedAssetId) return
                      const chosen = allAssetsWithLive.find((a) => a.id === addLineSelectedAssetId)
                      if (chosen && 'isLiveSource' in chosen && (chosen as any).isLiveSource) {
                        onInsertAsset(
                          null,
                          targetIdx,
                          {
                            sourceRef: (chosen as any).sourceRef,
                            title: chosen.title,
                            durationOverride: chosen.durationFrames,
                          },
                          options,
                        )
                      } else {
                        onInsertAsset(addLineSelectedAssetId, targetIdx, undefined, options)
                      }
                    } else {
                      if (!newLiveTitle.trim() || !newLiveRef.trim()) return
                      const fpsVal = rate.num / rate.den
                      const durFrames = Math.round(newLiveDurationMin * 60 * fpsVal)
                      if (addLineSaveToLibrary) {
                        saveCustomSource({
                          id: `live-${Date.now()}`,
                          title: newLiveTitle.trim(),
                          sourceRef: newLiveRef.trim(),
                          family: newLiveFamily,
                          durationFrames: durFrames,
                        })
                      }
                      onInsertAsset(
                        null,
                        targetIdx,
                        {
                          sourceRef: newLiveRef.trim(),
                          title: newLiveTitle.trim(),
                          durationOverride: durFrames,
                        },
                        {
                          ...options,
                          eventType: 'LIVE',
                        },
                      )
                    }
                    setAddLineModalOpen(false)
                  }}
                  className="px-4 py-2 rounded-lg bg-primary hover:bg-accent-ice text-surface-base font-body-sm font-bold shadow transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-[18px]">add_circle</span>
                  Adicionar à Biblioteca &amp; Inserir na Grade
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {/* MODAL 3: Gerenciamento de Pastas do Acervo MAM */}
      {folderModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4"
          onClick={() => setFolderModalOpen(false)}
        >
          <div
            className="bg-surface-card border border-border-subtle rounded-xl max-w-xl w-full p-6 shadow-2xl flex flex-col gap-4 text-on-surface animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border-subtle pb-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[24px]">folder_managed</span>
                <div>
                  <h3 className="font-headline-md text-headline-md font-bold uppercase tracking-wide">
                    Gerenciador de Pastas do MAM
                  </h3>
                  <p className="font-label-mono text-label-mono text-outline">
                    Pastas locais, discos e compartilhamentos de rede (NAS/SAN)
                  </p>
                </div>
              </div>
              <button
                onClick={() => setFolderModalOpen(false)}
                className="p-1 rounded hover:bg-surface-container text-outline hover:text-on-surface cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {folderActionMsg && (
              <div className="px-3 py-2 rounded bg-primary/10 border border-primary/30 text-primary font-body-sm text-xs flex items-center gap-2">
                <span className="material-symbols-outlined text-[16px]">info</span>
                <span>{folderActionMsg}</span>
              </div>
            )}

            {/* Ação 1: Seletor Nativo do Windows */}
            <div className="bg-surface-panel p-3.5 rounded-lg border border-border-subtle flex items-center justify-between gap-3">
              <div>
                <span className="font-headline-sm text-sm font-semibold text-on-surface block">
                  Escolher Pasta no Sistema
                </span>
                <span className="font-label-mono text-[11px] text-outline">
                  Abre o explorador de arquivos do Windows para selecionar a pasta desejada.
                </span>
              </div>
              <button
                onClick={handlePickFolder}
                disabled={isFolderLoading}
                className="px-3.5 py-2 rounded-lg bg-primary hover:bg-primary-fixed text-surface-base font-label-caps text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shrink-0 disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[16px]">folder_open</span>
                <span>Escolher Pasta...</span>
              </button>
            </div>

            {/* Ação 2: Adição Manual por Caminho */}
            <div className="bg-surface-panel p-3.5 rounded-lg border border-border-subtle flex flex-col gap-2.5">
              <span className="font-label-caps text-[10px] text-outline font-bold uppercase tracking-wider">
                Ou Digitar Caminho Local / Rede
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="sm:col-span-2">
                  <input
                    type="text"
                    list="folder-suggestions"
                    placeholder="ex: C:\IA\RPlayout\midia ou \\NAS\Playout"
                    value={newFolderPath}
                    onChange={(e) => setNewFolderPath(e.target.value)}
                    className="w-full bg-surface-base border border-border-subtle rounded px-2.5 py-1.5 text-xs text-on-surface font-label-mono focus:border-primary focus:outline-none"
                  />
                  <datalist id="folder-suggestions">
                    <option value="C:\IA\RPlayout\midia" label="Pasta de Mídia Padrão" />
                    <option value="C:\Midia" />
                    <option value="D:\Midia" />
                    <option value="D:\Videos" />
                    <option value="E:\Videos" />
                  </datalist>
                </div>
                <div>
                  <input
                    type="text"
                    placeholder="Rótulo (opcional)"
                    value={newFolderLabel}
                    onChange={(e) => setNewFolderLabel(e.target.value)}
                    className="w-full bg-surface-base border border-border-subtle rounded px-2.5 py-1.5 text-xs text-on-surface focus:border-primary focus:outline-none"
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  onClick={handleAddFolderManual}
                  disabled={isFolderLoading || !newFolderPath.trim()}
                  className="px-3 py-1.5 rounded bg-surface-container hover:bg-surface-container-high border border-border-subtle text-on-surface font-label-caps text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-[14px]">add</span>
                  <span>Adicionar Pasta</span>
                </button>
              </div>
            </div>

            {/* Lista de Pastas Atualmente Monitoradas */}
            <div className="flex flex-col gap-1.5">
              <span className="font-label-caps text-[10px] text-outline font-bold uppercase tracking-wider">
                Pastas Cadastradas ({mamRoots.length})
              </span>
              <div className="max-h-40 overflow-y-auto broadcast-scroll flex flex-col gap-1.5 border border-border-subtle/50 rounded-lg p-1.5 bg-surface-base">
                {mamRoots.length === 0 ? (
                  <span className="text-center py-4 text-outline font-label-mono text-xs">
                    Carregando pastas monitoradas...
                  </span>
                ) : (
                  mamRoots.map((root) => (
                    <div
                      key={root.id}
                      className="flex items-center justify-between p-2 rounded bg-surface-panel border border-border-subtle/60 text-xs"
                    >
                      <div className="flex flex-col min-w-0 pr-2">
                        <span className="font-semibold text-on-surface truncate">{root.label}</span>
                        <span className="font-label-mono text-[10px] text-outline truncate" title={root.path}>
                          {root.path}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {root.present ? (
                          <span className="px-1.5 py-0.5 rounded font-label-caps text-[9px] bg-status-ok/15 text-status-ok-bright font-bold border border-status-ok/30">
                            ONLINE
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded font-label-caps text-[9px] bg-on-air-crimson/15 text-on-air-crimson font-bold border border-on-air-crimson/30">
                            FORA DO AR
                          </span>
                        )}
                        <button
                          onClick={() => handleRemoveFolder(root)}
                          disabled={isFolderLoading || mamRoots.length <= 1}
                          className="p-1 rounded hover:bg-surface-container text-outline hover:text-on-air-crimson cursor-pointer disabled:opacity-30"
                          title={mamRoots.length <= 1 ? 'O sistema precisa de pelo menos uma pasta' : 'Remover do acervo'}
                        >
                          <span className="material-symbols-outlined text-[15px]">delete</span>
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Rodapé da Modal */}
            <div className="flex items-center justify-between pt-2 border-t border-border-subtle">
              <button
                onClick={() => {
                  onStartScan(false)
                  setFolderActionMsg('Varredura do acervo iniciada!')
                }}
                className="px-3 py-1.5 rounded bg-surface-panel hover:bg-surface-container border border-border-subtle text-accent-ice-bright font-label-caps text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                <span className="material-symbols-outlined text-[15px]">sync</span>
                <span>Revarrer Acervo Agora</span>
              </button>

              <button
                onClick={() => setFolderModalOpen(false)}
                className="px-4 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface font-body-sm text-xs cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 8. CONFLICT & GAP RESOLUTION DRAWER (FASE E) */}
      <ConflictDrawer
        open={isConflictDrawerOpen}
        onClose={() => setIsConflictDrawerOpen(false)}
        items={view.items}
        rate={channel.rate}
        onAutoFill={onAutoFill}
      />
    </div>
  )
}
