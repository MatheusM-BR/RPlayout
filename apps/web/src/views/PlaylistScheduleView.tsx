import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import type { Channel, Rundown } from '@rplayout/protocol'
import { clock, dur } from '../format.js'
import type { RundownView, ItemView, LibraryAsset, LibraryFolder, Categoria } from '../types.js'
import type { WorkspaceId } from '../components/WorkspaceShell.js'
import { BroadcastHeader } from '../components/broadcast/BroadcastHeader.js'
import { CanonicalProtocolSelector } from '../components/broadcast/CanonicalProtocolSelector.js'
import { api } from '../api.js'

interface Props {
  channel: Channel
  channels?: Channel[]
  view: RundownView
  folders?: LibraryFolder[]
  categorias?: Categoria[]
  onInsertAsset?: (
    assetId: string | null,
    atIndex?: number,
    liveConfig?: { sourceRef: string; title: string; durationOverride?: number },
  ) => void
  onPreviewAsset?: (asset: LibraryAsset) => void
  onNavigate: (workspace: WorkspaceId) => void
  onSelectChannel?: (channelId: string) => void
  onPublishToMaster: () => void
  onOpenAutoFill: (
    rundownId?: string,
    onApplied?: (snapshot: any) => void,
    options?: {
      initialHours?: number
      initialMinutes?: number
      initialStart?: string
      initialEnd?: string
      autoPreview?: boolean
    },
  ) => void
  sessionRole?: string
  authRequired?: boolean
  onAddItem?: (rundownId?: string, onApplied?: (snapshot: any) => void) => void
  onExportCsv?: () => void
  onOpenTrim?: (item: ItemView) => void
  onOpenAudio?: (item: ItemView) => void
  onRemoveItem?: (itemId: string, rundownId?: string, onRemoved?: () => void) => void
  onOpenSettings?: () => void
}

export function PlaylistScheduleView({
  channel,
  channels = [channel],
  view,
  folders = [],
  categorias = [],
  onInsertAsset,
  onPreviewAsset,
  onNavigate,
  onSelectChannel = () => {},
  onPublishToMaster,
  onOpenAutoFill,
  sessionRole = 'Operador Master',
  authRequired = false,
  onAddItem,
  onExportCsv,
  onOpenTrim,
  onOpenAudio,
  onRemoveItem,
  onOpenSettings,
}: Props) {
  const now = new Date()
  const todayDateIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  // Relógio ao vivo NTP do sistema
  const [currentLiveClock, setCurrentLiveClock] = useState(() => {
    const d = new Date()
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
  })

  useEffect(() => {
    const timer = setInterval(() => {
      const d = new Date()
      setCurrentLiveClock(
        `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`,
      )
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  // Gerenciamento de Datas & Navegação entre Dias
  const [selectedDate, setSelectedDate] = useState(todayDateIso)
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1))
  const [availableRundowns, setAvailableRundowns] = useState<Rundown[]>([])
  const [dateRundownView, setDateRundownView] = useState<RundownView | null>(null)
  const [isLoadingDate, setIsLoadingDate] = useState(false)
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null)

  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set())
  const lastClickedIndexRef = useRef<number | null>(null)
  const [isBulkDeleting, setIsBulkDeleting] = useState(false)

  // Compatibilidade com item único selecionado
  const selectedItemId = selectedItemIds.size === 1 ? Array.from(selectedItemIds)[0]! : null
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [showGapPopover, setShowGapPopover] = useState(false)
  const [selectedGap, setSelectedGap] = useState<{
    start: number
    end: number
    duration: number
    label: string
  } | null>(null)
  const [zoomMode, setZoomMode] = useState<'24h' | '12h' | '6h' | '1h'>('24h')
  const [diffCount, setDiffCount] = useState(1)
  const [publishedSuccess, setPublishedSuccess] = useState(false)

  const rate = channel.rate

  // Modos da Barra Lateral Esquerda: 'mam' (Biblioteca) ou 'calendar' (Calendário)
  const [sidebarTab, setSidebarTab] = useState<'mam' | 'calendar'>('mam')
  const [mamSearch, setMamSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL')

  // Estado para Edição do Horário de Entrada (Anchor) e Duração Ao Vivo
  const [editingTimeItem, setEditingTimeItem] = useState<ItemView | null>(null)
  const [timeAnchorKind, setTimeAnchorKind] = useState<'FLOW' | 'FIXED'>('FLOW')
  const [timeInputHms, setTimeInputHms] = useState('12:00:00')
  const [durationInputMinutes, setDurationInputMinutes] = useState(30)
  const [isSavingTime, setIsSavingTime] = useState(false)

  // Diálogo para Novo Programa Ao Vivo
  const [showLiveProgramModal, setShowLiveProgramModal] = useState(false)
  const [liveProgramTitle, setLiveProgramTitle] = useState('Transmissão Externa - Ao Vivo')
  const [liveProgramTimeHms, setLiveProgramTimeHms] = useState('20:00:00')
  const [liveProgramDurationMin, setLiveProgramDurationMin] = useState(60)
  const [liveProgramSourceRef, setLiveProgramSourceRef] = useState('decklink://0')
  const [liveSourceOption, setLiveSourceOption] = useState('decklink://0')
  const [isCreatingLive, setIsCreatingLive] = useState(false)

  const allMamAssets = useMemo<LibraryAsset[]>(() => {
    if (!folders || folders.length === 0) return []
    return folders.flatMap((f) => f.assets)
  }, [folders])

  const availableCategoriesList = useMemo(() => {
    const defaultColors: Record<string, string> = {
      Jornalismo: '#10B981',
      Notícias: '#10B981',
      'Ao Vivo': '#EF4444',
      LIVE: '#EF4444',
      Entretenimento: '#8B5CF6',
      Filmes: '#3B82F6',
      Séries: '#06B6D4',
      Comerciais: '#F59E0B',
      Comercial: '#F59E0B',
      Esportes: '#F97316',
      Documentários: '#14B8A6',
      Institucional: '#64748B',
    }

    const catMap = new Map<string, Categoria>()
    for (const cat of categorias) {
      catMap.set(cat.id, cat)
    }

    const counts = new Map<string, number>()
    for (const a of allMamAssets) {
      const c = a.categoryId || 'Sem Categoria'
      counts.set(c, (counts.get(c) || 0) + 1)
    }

    const list: Array<{ id: string; name: string; color: string; count: number }> = []
    for (const [cId, count] of counts.entries()) {
      const catObj = catMap.get(cId)
      const color = catObj?.color || defaultColors[cId] || '#389BFF'
      list.push({ id: cId, name: cId, color, count })
    }

    return list
  }, [categorias, allMamAssets])

  const filteredMamAssets = useMemo(() => {
    return allMamAssets.filter((asset) => {
      if (selectedCategory !== 'ALL') {
        const cat = asset.categoryId || 'Sem Categoria'
        if (cat !== selectedCategory) return false
      }
      if (mamSearch.trim()) {
        const q = mamSearch.toLowerCase()
        const titleMatch = (asset.title || '').toLowerCase().includes(q)
        const nameMatch = (asset.fileName || '').toLowerCase().includes(q)
        return titleMatch || nameMatch
      }
      return true
    })
  }, [allMamAssets, selectedCategory, mamSearch])

  // Carrega a lista de todos os rundowns existentes no canal
  const refreshAvailableRundowns = useCallback(async () => {
    try {
      const res = await api.channelRundowns(channel.id)
      if (res.rundowns) {
        setAvailableRundowns(res.rundowns)
      }
    } catch (err) {
      console.error('Failed to load channel rundowns:', err)
    }
  }, [channel.id])

  useEffect(() => {
    void refreshAvailableRundowns()
  }, [refreshAvailableRundowns])

  // Carrega os itens específicos da data selecionada
  const loadDateRundown = useCallback(
    async (dateIso: string) => {
      if (dateIso === todayDateIso) {
        setDateRundownView(null)
        return
      }
      setIsLoadingDate(true)
      try {
        const res = await api.channelRundowns(channel.id, dateIso)
        if (res.view) {
          setDateRundownView(res.view)
        } else {
          setDateRundownView(null)
        }
      } catch (err) {
        console.error('Falha ao carregar grade da data', dateIso, err)
        setDateRundownView(null)
      } finally {
        setIsLoadingDate(false)
      }
    },
    [channel.id, todayDateIso],
  )

  useEffect(() => {
    void loadDateRundown(selectedDate)
  }, [selectedDate, loadDateRundown])

  // View ativa no momento: usa a do dia carregada ou o fallback de hoje
  const activeView: RundownView | null = selectedDate === todayDateIso ? view : dateRundownView

  // Conjunto de datas que já possuem grade cadastrada
  const availableDatesSet = useMemo(() => {
    const s = new Set<string>()
    s.add(todayDateIso)
    for (const r of availableRundowns) {
      if (r.date) s.add(r.date)
    }
    return s
  }, [availableRundowns, todayDateIso])

  // Navegação de dias
  const shiftSelectedDate = (days: number) => {
    const cur = new Date(`${selectedDate}T12:00:00`)
    cur.setDate(cur.getDate() + days)
    const nextIso = cur.toISOString().slice(0, 10)
    setSelectedDate(nextIso)
    setCalendarMonth(new Date(cur.getFullYear(), cur.getMonth(), 1))
  }

  const shiftCalendarMonth = (months: number) => {
    setCalendarMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + months, 1))
  }

  // Copiar grade existente para a data selecionada
  const handleCopyGrid = async (sourceRundownId?: string) => {
    const srcId = sourceRundownId ?? activeView?.rundown.id ?? view.rundown.id
    setIsLoadingDate(true)
    try {
      const res = await api.createChannelRundown(channel.id, {
        date: selectedDate,
        copyFromRundownId: srcId,
      })
      setDateRundownView(res.view)
      await refreshAvailableRundowns()
      setFeedbackMessage(`✓ Grade copiada com sucesso para ${selectedDate}!`)
      setTimeout(() => setFeedbackMessage(null), 4000)
    } catch (err: any) {
      alert(`Erro ao copiar grade: ${err.message}`)
    } finally {
      setIsLoadingDate(false)
    }
  }

  // Criar grade em branco para a data selecionada
  const handleCreateBlankGrid = async () => {
    setIsLoadingDate(true)
    try {
      const res = await api.createChannelRundown(channel.id, {
        date: selectedDate,
      })
      setDateRundownView(res.view)
      await refreshAvailableRundowns()
      setFeedbackMessage(`✓ Grade em branco criada para ${selectedDate}!`)
      setTimeout(() => setFeedbackMessage(null), 4000)
    } catch (err: any) {
      alert(`Erro ao criar grade: ${err.message}`)
    } finally {
      setIsLoadingDate(false)
    }
  }

  // Publicar / Sincronizar com o Master
  const handlePublish = async () => {
    if (selectedDate === todayDateIso) {
      onPublishToMaster()
      setDiffCount(0)
      setPublishedSuccess(true)
      setTimeout(() => setPublishedSuccess(false), 4000)
    } else if (activeView?.rundown.id) {
      try {
        await api.loadChannelRundown(channel.id, activeView.rundown.id)
        onPublishToMaster()
        setDiffCount(0)
        setPublishedSuccess(true)
        setFeedbackMessage(`✓ Grade de ${selectedDate} carregada no Master Playout!`)
        setTimeout(() => {
          setPublishedSuccess(false)
          setFeedbackMessage(null)
        }, 4000)
      } catch (err: any) {
        alert(`Erro ao carregar no Master: ${err.message}`)
      }
    }
  }

  const handleAddItem = () => {
    if (!onAddItem) return
    const targetRundownId = activeView?.rundown.id
    onAddItem(targetRundownId, (snapshot) => {
      if (selectedDate !== todayDateIso && snapshot?.view) {
        setDateRundownView(snapshot.view)
        void refreshAvailableRundowns()
      }
    })
  }

  const handleOpenAutoFill = async (options?: {
    initialHours?: number
    initialMinutes?: number
    initialStart?: string
    initialEnd?: string
    autoPreview?: boolean
  }) => {
    if (!onOpenAutoFill) return
    let targetRundownId = activeView?.rundown?.id

    if (!targetRundownId && selectedDate !== todayDateIso) {
      setIsLoadingDate(true)
      try {
        const created = await api.createChannelRundown(channel.id, {
          date: selectedDate,
        })
        setDateRundownView(created.view)
        targetRundownId = created.view?.rundown?.id
        await refreshAvailableRundowns()
      } catch (err) {
        console.error('Falha ao instanciar grade da data para autofill', err)
      } finally {
        setIsLoadingDate(false)
      }
    }

    if (!targetRundownId) {
      targetRundownId = view.rundown.id
    }

    onOpenAutoFill(
      targetRundownId,
      (snapshot) => {
        if (selectedDate !== todayDateIso) {
          if (snapshot?.view) {
            setDateRundownView(snapshot.view)
          }
          void loadDateRundown(selectedDate)
          void refreshAvailableRundowns()
        } else {
          // Hoje: recarrega a grade ativa e sincroniza com o master
          if (snapshot?.view) {
            setDateRundownView(snapshot.view)
          }
          onPublishToMaster?.()
          void loadDateRundown(todayDateIso)
        }
      },
      options,
    )
  }

  const handleOpenAutoFillForGap = (gap?: {
    start: number
    end: number
    duration: number
    label: string
  } | null) => {
    if (!gap) {
      handleOpenAutoFill()
      return
    }
    const fps = rate.num / rate.den || 50
    const durationSeconds = Math.round(gap.duration / fps)
    const totalMinutes = Math.max(1, Math.ceil(durationSeconds / 60))
    const initialHours = Math.floor(totalMinutes / 60)
    const initialMinutes = totalMinutes % 60

    const startSec = gap.start / fps
    const startMin = Math.floor(startSec / 60)
    const startH = Math.floor(startMin / 60) % 24
    const startM = startMin % 60
    const initialStart = `${String(startH).padStart(2, '0')}:${String(startM).padStart(2, '0')}`

    const endSec = gap.end / fps
    const endMin = Math.floor(endSec / 60)
    const endH = Math.floor(endMin / 60) % 24
    const endM = endMin % 60
    const initialEnd = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`

    handleOpenAutoFill({
      initialHours,
      initialMinutes,
      initialStart,
      initialEnd,
      autoPreview: true,
    })
  }

  const handleRemoveItem = (itemId: string) => {
    if (!onRemoveItem) return
    const targetRundownId = activeView?.rundown.id
    onRemoveItem(itemId, targetRundownId, () => {
      if (selectedDate !== todayDateIso) {
        void loadDateRundown(selectedDate)
        void refreshAvailableRundowns()
      }
    })
    setSelectedItemIds((prev) => {
      const next = new Set(prev)
      next.delete(itemId)
      return next
    })
  }

  const handleBulkRemove = async () => {
    if (selectedItemIds.size === 0) return
    const count = selectedItemIds.size
    if (!window.confirm(`Deseja remover os ${count} itens selecionados da grade linear?`)) return
    setIsBulkDeleting(true)
    try {
      const ids = Array.from(selectedItemIds)
      for (const id of ids) {
        await api.removeItem(id)
      }
      setSelectedItemIds(new Set())
      if (selectedDate !== todayDateIso) {
        await loadDateRundown(selectedDate)
        await refreshAvailableRundowns()
      } else {
        onPublishToMaster()
      }
    } catch (err: any) {
      alert(`Erro ao remover itens selecionados: ${err.message}`)
    } finally {
      setIsBulkDeleting(false)
    }
  }

  const handleRowClick = (e: React.MouseEvent, item: ItemView, index: number) => {
    const itemId = item.item.id
    if (e.ctrlKey || e.metaKey) {
      // Multiseleção com Ctrl / Cmd
      setSelectedItemIds((prev) => {
        const next = new Set(prev)
        if (next.has(itemId)) {
          next.delete(itemId)
        } else {
          next.add(itemId)
        }
        return next
      })
      lastClickedIndexRef.current = index
    } else if (e.shiftKey && lastClickedIndexRef.current !== null) {
      // Multiseleção contínua com Shift
      const start = Math.min(lastClickedIndexRef.current, index)
      const end = Math.max(lastClickedIndexRef.current, index)
      const rangeIds = displayItems.slice(start, end + 1).map((it) => it.item.id)
      setSelectedItemIds(new Set(rangeIds))
    } else {
      // Seleção simples
      setSelectedItemIds((prev) => {
        if (prev.size === 1 && prev.has(itemId)) {
          return new Set()
        }
        return new Set([itemId])
      })
      lastClickedIndexRef.current = index
    }
  }

  // Inserir item da Biblioteca MAM na Grade
  const handleInsertFromMam = async (asset: LibraryAsset) => {
    const rId = activeView?.rundown.id ?? view.rundown.id
    try {
      if (selectedDate === todayDateIso && onInsertAsset) {
        onInsertAsset(asset.id)
      } else {
        await api.addItem(rId, {
          mediaId: asset.id,
          type: 'VT',
          title: asset.title,
          anchor: { kind: 'FLOW' },
        })
        await loadDateRundown(selectedDate)
        void refreshAvailableRundowns()
      }
      setFeedbackMessage(`✓ "${asset.title}" inserido na programação!`)
      setTimeout(() => setFeedbackMessage(null), 3000)
    } catch (err: any) {
      alert(`Erro ao inserir item: ${err.message}`)
    }
  }

  // Agendar Programa Ao Vivo com Horário Marcado
  const handleCreateLiveProgram = async () => {
    const rId = activeView?.rundown.id ?? view.rundown.id
    setIsCreatingLive(true)
    try {
      const parts = liveProgramTimeHms.split(':').map((p) => Number(p) || 0)
      const h = parts[0] ?? 0
      const m = parts[1] ?? 0
      const s = parts[2] ?? 0
      const totalSeconds = h * 3600 + m * 60 + s
      const fps = rate.num / rate.den || 50
      const atFrames = Math.round(totalSeconds * fps)
      const durationFrames = Math.round(liveProgramDurationMin * 60 * fps)

      await api.addItem(rId, {
        sourceRef: liveProgramSourceRef,
        type: 'LIVE',
        title: liveProgramTitle,
        anchor: { kind: 'FIXED', at: atFrames },
        durationOverride: durationFrames,
      })

      if (selectedDate === todayDateIso) {
        onPublishToMaster()
      } else {
        await loadDateRundown(selectedDate)
        void refreshAvailableRundowns()
      }

      setFeedbackMessage(`✓ Programa Ao Vivo "${liveProgramTitle}" agendado para ${liveProgramTimeHms}!`)
      setTimeout(() => setFeedbackMessage(null), 3500)
      setShowLiveProgramModal(false)
    } catch (err: any) {
      alert(`Erro ao criar programa ao vivo: ${err.message}`)
    } finally {
      setIsCreatingLive(false)
    }
  }

  // Abrir Modal de Edição de Horário de Entrada
  const openEditScheduleTime = (item: ItemView) => {
    setEditingTimeItem(item)
    const currentAnchor = item.item.anchor
    const fps = rate.num / rate.den || 50

    if (currentAnchor && currentAnchor.kind === 'FIXED') {
      setTimeAnchorKind('FIXED')
      const sec = Math.round(currentAnchor.at / fps)
      const h = Math.floor(sec / 3600) % 24
      const m = Math.floor((sec % 3600) / 60)
      const s = sec % 60
      setTimeInputHms(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`)
    } else {
      setTimeAnchorKind('FLOW')
      const sched = scheduleMap.get(item.item.id)
      if (sched?.start != null) {
        const sec = Math.round(sched.start / fps)
        const h = Math.floor(sec / 3600) % 24
        const m = Math.floor((sec % 3600) / 60)
        const s = sec % 60
        setTimeInputHms(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`)
      } else {
        setTimeInputHms('12:00:00')
      }
    }

    const durFrames = item.trim
      ? Math.max(0, item.trim.out - item.trim.in)
      : item.item.durationOverride ?? item.asset?.durationFrames ?? 0
    const durMin = Math.round((durFrames / fps) / 60)
    setDurationInputMinutes(durMin > 0 ? durMin : 30)
  }

  // Salvar Horário de Entrada e Duração
  const handleSaveScheduleTime = async () => {
    if (!editingTimeItem) return
    setIsSavingTime(true)
    try {
      const fps = rate.num / rate.den || 50
      let anchorPayload: any = { kind: 'FLOW' }

      if (timeAnchorKind === 'FIXED') {
        const parts = timeInputHms.split(':').map((p) => Number(p) || 0)
        const h = parts[0] ?? 0
        const m = parts[1] ?? 0
        const s = parts[2] ?? 0
        const totalSeconds = h * 3600 + m * 60 + s
        const atFrames = Math.round(totalSeconds * fps)
        anchorPayload = { kind: 'FIXED', at: atFrames }
      }

      const patchBody: Record<string, any> = {
        anchor: anchorPayload,
      }

      if (editingTimeItem.item.type === 'LIVE' || (editingTimeItem.item.eventType as string) === 'LIVE' || durationInputMinutes > 0) {
        patchBody.durationOverride = Math.round(durationInputMinutes * 60 * fps)
      }

      await api.patchItem(editingTimeItem.item.id, patchBody)
      setFeedbackMessage(`✓ Horário de "${editingTimeItem.asset?.title || editingTimeItem.item.title || 'Item'}" atualizado!`)
      setTimeout(() => setFeedbackMessage(null), 3500)
      setEditingTimeItem(null)

      if (selectedDate === todayDateIso) {
        onPublishToMaster()
      } else {
        await loadDateRundown(selectedDate)
        void refreshAvailableRundowns()
      }
    } catch (err: any) {
      alert(`Erro ao salvar horário: ${err.message}`)
    } finally {
      setIsSavingTime(false)
    }
  }

  // Itens em exibição
  const displayItems = useMemo(() => {
    return activeView?.items ?? []
  }, [activeView])

  const scheduleMap = useMemo(() => {
    return new Map(activeView?.schedule?.items?.map((it) => [it.id, it]) ?? [])
  }, [activeView])

  const selectedItemsList = useMemo(() => {
    return displayItems.filter((it) => selectedItemIds.has(it.item.id))
  }, [displayItems, selectedItemIds])

  const selectedTotalDurationFrames = useMemo(() => {
    return selectedItemsList.reduce((acc, it) => {
      const durFrames = it.trim
        ? Math.max(0, it.trim.out - it.trim.in)
        : it.item?.durationOverride ?? it.asset?.durationFrames ?? 0
      return acc + durFrames
    }, 0)
  }, [selectedItemsList])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedItemIds(new Set())
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Playhead só faz sentido em tempo real no dia de hoje
  const isViewingToday = selectedDate === todayDateIso
  const secondsSinceMidnight = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()

  const zoomHoursMap: Record<'24h' | '12h' | '6h' | '1h', number> = {
    '24h': 24,
    '12h': 12,
    '6h': 6,
    '1h': 1,
  }
  const visibleHours = zoomHoursMap[zoomMode] || 24
  const playheadPercent = isViewingToday ? Math.min(100, Math.max(0, (secondsSinceMidnight / (visibleHours * 3600)) * 100)) : 0

  // Cálculo dinâmico da régua contínua e detecção de GAPs conforme o zoomMode
  const timelineData = useMemo(() => {
    const fps = rate.num / rate.den || 50
    const visibleFrames = visibleHours * 3600 * fps
    const totalDayFrames = 24 * 3600 * fps

    let runningFrame = 0
    const blocks = displayItems.map((item) => {
      const sched = scheduleMap.get(item.item.id)
      const duration =
        sched?.duration ??
        (item.trim
          ? Math.max(0, item.trim.out - item.trim.in)
          : item.item.durationOverride ?? item.asset?.durationFrames ?? Math.round(1500 * (fps / 25)))
      const start = sched?.start ?? runningFrame
      const end = sched?.end ?? start + duration
      runningFrame = end

      const isLive = item.item.type === 'LIVE' || Boolean(item.item.sourceRef)
      const isCom =
        (item.item.type as string) === 'COMMERCIAL' ||
        (item.item.type as string) === 'BREAK' ||
        Boolean(item.asset?.categoryId?.toLowerCase().includes('com'))

      const leftPct = Math.min(100, Math.max(0, (start / visibleFrames) * 100))
      const widthPct = Math.min(100 - leftPct, Math.max(0.18, (duration / visibleFrames) * 100))

      return {
        item,
        start,
        end,
        duration,
        leftPct,
        widthPct,
        isLive,
        isCom,
      }
    })

    const detectedGaps: Array<{
      start: number
      end: number
      duration: number
      leftPct: number
      widthPct: number
      label: string
    }> = []

    if (blocks.length === 0) {
      detectedGaps.push({
        start: 0,
        end: visibleFrames,
        duration: visibleFrames,
        leftPct: 0,
        widthPct: 100,
        label: `00:00:00 - ${String(visibleHours).padStart(2, '0')}:00:00 (Grade Vazia)`,
      })
    } else {
      for (let i = 0; i < blocks.length - 1; i++) {
        const cur = blocks[i]!
        const next = blocks[i + 1]!
        if (next.start > cur.end + fps && cur.end < visibleFrames) {
          const gapDur = Math.min(next.start, visibleFrames) - cur.end
          const leftPct = Math.min(100, Math.max(0, (cur.end / visibleFrames) * 100))
          const widthPct = Math.min(100 - leftPct, Math.max(0.2, (gapDur / visibleFrames) * 100))
          detectedGaps.push({
            start: cur.end,
            end: next.start,
            duration: gapDur,
            leftPct,
            widthPct,
            label: `${clock(cur.end, rate)} - ${clock(next.start, rate)}`,
          })
        }
      }
    }

    return { blocks, gaps: detectedGaps, totalFrames: totalDayFrames, visibleFrames }
  }, [displayItems, scheduleMap, rate, visibleHours])

  // Total de tempo previsto e gap total
  const totalDurationFrames = displayItems.reduce((acc, it) => {
    const durFrames = it.trim
      ? Math.max(0, it.trim.out - it.trim.in)
      : it.item?.durationOverride ?? it.asset?.durationFrames ?? 0
    return acc + durFrames
  }, 0)

  // Calendar metrics
  const calYear = calendarMonth.getFullYear()
  const calMonth = calendarMonth.getMonth()
  const currentMonthName = calendarMonth.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).toUpperCase()
  const daysInCalMonth = new Date(calYear, calMonth + 1, 0).getDate()
  const firstDayOfWeek = new Date(calYear, calMonth, 1).getDay()

  // Formatação amigável do dia selecionado
  const selectedDateObj = new Date(`${selectedDate}T12:00:00`)
  const selectedDateFormatted = selectedDateObj.toLocaleDateString('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).toUpperCase()

  const dateBadgeStatus =
    selectedDate === todayDateIso
      ? 'NO AR (HOJE)'
      : selectedDate > todayDateIso
      ? 'FUTURO (PLANEJADO)'
      : 'PASSADO (AS-RUN)'

  return (
    <div className="flex flex-col h-screen w-screen bg-surface-base text-on-surface select-none overflow-hidden font-sans">
      {/* 1. CABEÇALHO GLOBAL BROADCAST (STITCH COMPACT 48px) */}
      <BroadcastHeader
        activeWorkspace="playlist"
        channel={channel}
        channels={channels}
        sessionRole={sessionRole}
        authRequired={authRequired}
        onNavigate={onNavigate}
        onSelectChannel={onSelectChannel}
        onOpenSettings={onOpenSettings}
      />

      {/* FEEDBACK BANNER FLUTUANTE SE HOUVER MENSAGEM */}
      {feedbackMessage && (
        <div className="bg-status-ok text-surface-base px-4 py-1.5 text-center font-bold text-xs shadow-lg animate-pulse flex items-center justify-center gap-2 z-50">
          <span className="material-symbols-outlined text-[16px]">check_circle</span>
          <span>{feedbackMessage}</span>
        </div>
      )}

      {/* 2. ÁREA OPERACIONAL PRINCIPAL (FLEX-1) */}
      <main className="flex-1 flex flex-col min-h-0 bg-surface-base overflow-hidden">
        {/* SUB-HEADER TÁTICO: Programação & Automação Linear */}
        <div className="bg-surface-container px-margin py-2 border-b border-border-subtle flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-space-sm">
            <div className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-accent-ice text-[18px]">splitscreen_left</span>
              <h1 className="font-headline-md text-headline-md text-on-surface uppercase tracking-wide">
                Programação &amp; Automação Linear
              </h1>
            </div>
            <div className="bg-surface-panel px-2.5 py-0.5 rounded border border-border-subtle text-[11px] font-mono flex items-center gap-1.5">
              <span className="text-outline">DATA ATIVA:</span>
              <strong className="text-primary font-bold">{selectedDateFormatted}</strong>
              <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded ${
                selectedDate === todayDateIso ? 'bg-on-air-crimson text-white' : 'bg-surface-container text-accent-ice'
              }`}>
                {dateBadgeStatus}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-space-md text-label-mono text-[10px]">
            <span className="text-outline">
              SINCRONISMO MASTER: <strong className="text-status-ok-bright font-bold">LOCKED (0.8ms)</strong>
            </span>
            <span className="text-outline">•</span>
            <span className="text-outline">
              MATRIZ BXF: <strong className="text-accent-ice-bright font-bold">SYNC ATIVO</strong>
            </span>
            <span className="text-outline">•</span>
            <span className="text-outline">
              REDUNDÂNCIA: <strong className="text-status-ok-bright font-bold">HOT-STANDBY OK</strong>
            </span>
          </div>
        </div>

        {/* LAYOUT SPLIT-SCREEN 2 COLUNAS: 280px (~20%) + FLEX-1 (~80%) */}
        <div className="flex-1 p-margin flex flex-col lg:flex-row gap-gutter overflow-hidden">
          {/* ========================================================
              COLUNA ESQUERDA (MAM LIBRARY & CALENDÁRIO)
              ======================================================== */}
          <aside className="w-full lg:w-[330px] xl:w-[360px] lg:flex-shrink-0 flex flex-col gap-space-sm overflow-hidden">
            {/* Seletor de Modo da Barra Lateral: [ 📁 BIBLIOTECA MAM ] [ 📅 CALENDÁRIO ] */}
            <div className="bg-surface-card rounded p-1 border border-border-subtle flex gap-1 shadow-sm shrink-0">
              <button
                type="button"
                onClick={() => setSidebarTab('mam')}
                className={`flex-1 py-1.5 px-2 rounded font-label-caps text-[10px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  sidebarTab === 'mam'
                    ? 'bg-primary text-surface-base shadow-sm'
                    : 'text-outline hover:text-on-surface hover:bg-surface-panel'
                }`}
              >
                <span className="material-symbols-outlined text-[15px]">video_library</span>
                <span>BIBLIOTECA MAM</span>
              </button>
              <button
                type="button"
                onClick={() => setSidebarTab('calendar')}
                className={`flex-1 py-1.5 px-2 rounded font-label-caps text-[10px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  sidebarTab === 'calendar'
                    ? 'bg-primary text-surface-base shadow-sm'
                    : 'text-outline hover:text-on-surface hover:bg-surface-panel'
                }`}
              >
                <span className="material-symbols-outlined text-[15px]">calendar_month</span>
                <span>CALENDÁRIO</span>
              </button>
            </div>

            {/* TAB 1: BIBLIOTECA MAM (MÓDULO DE PROGRAMAÇÃO E AGENDAMENTO) */}
            {sidebarTab === 'mam' && (
              <div className="flex-1 bg-surface-card rounded border border-border-subtle shadow-md overflow-hidden flex flex-col min-h-[460px]">
                {/* Cabeçalho MAM & Busca */}
                <div className="p-2 border-b border-border-subtle flex flex-col gap-1.5 bg-surface-container-high shrink-0">
                  <div className="flex items-center justify-between">
                    <span className="font-label-caps text-[10.5px] font-bold text-on-surface flex items-center gap-1">
                      <span className="material-symbols-outlined text-primary text-[15px]">perm_media</span>
                      ACERVO &amp; PROGRAMAÇÃO
                    </span>
                    <button
                      onClick={() => setShowLiveProgramModal(true)}
                      className="px-2 py-0.5 rounded bg-on-air-crimson/20 hover:bg-on-air-crimson text-on-air-crimson hover:text-white font-label-caps text-[9px] font-bold border border-on-air-crimson/40 transition-colors flex items-center gap-1 cursor-pointer shadow-sm"
                      title="Agendar programa ao vivo com horário cravado"
                    >
                      <span className="material-symbols-outlined text-[13px]">live_tv</span>
                      <span>+ AO VIVO</span>
                    </button>
                  </div>

                  {/* Campo de Busca Rápida */}
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-outline text-[15px] pointer-events-none">
                      search
                    </span>
                    <input
                      type="text"
                      value={mamSearch}
                      onChange={(e) => setMamSearch(e.target.value)}
                      placeholder="Buscar por título ou ID no MAM..."
                      className="w-full bg-surface-base border border-border-subtle focus:border-primary text-on-surface text-[11px] font-body-sm pl-7 pr-7 py-1 rounded focus:outline-none"
                    />
                    {mamSearch && (
                      <button
                        onClick={() => setMamSearch('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-outline hover:text-on-surface text-[12px] cursor-pointer"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  {/* Chips de Categorias com Cores Oficiais Broadcast */}
                  <div className="flex items-center gap-1 overflow-x-auto py-0.5 broadcast-scrollbar">
                    <button
                      onClick={() => setSelectedCategory('ALL')}
                      className={`px-2 py-0.5 rounded-full text-[9px] font-label-caps font-bold whitespace-nowrap transition-colors cursor-pointer border ${
                        selectedCategory === 'ALL'
                          ? 'bg-primary text-surface-base border-primary'
                          : 'bg-surface-base text-outline border-border-subtle hover:text-on-surface'
                      }`}
                    >
                      TODAS ({allMamAssets.length})
                    </button>
                    {availableCategoriesList.map((cat) => {
                      const isSel = selectedCategory === cat.id
                      return (
                        <button
                          key={cat.id}
                          onClick={() => setSelectedCategory(cat.id)}
                          className={`px-2 py-0.5 rounded-full text-[9px] font-label-mono whitespace-nowrap transition-colors cursor-pointer border flex items-center gap-1 ${
                            isSel
                              ? 'text-surface-base font-bold shadow-sm'
                              : 'bg-surface-base text-outline border-border-subtle hover:text-on-surface'
                          }`}
                          style={{
                            backgroundColor: isSel ? cat.color : undefined,
                            borderColor: isSel ? cat.color : undefined,
                          }}
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full"
                            style={{ backgroundColor: isSel ? '#ffffff' : cat.color }}
                          ></span>
                          <span>{cat.name}</span>
                          <span className="opacity-70">({cat.count})</span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Lista de Ativos do MAM Filtrados */}
                <div className="flex-1 divide-y divide-border-subtle/50 overflow-y-auto broadcast-scroll p-1 flex flex-col gap-1">
                  {filteredMamAssets.length === 0 ? (
                    <div className="p-6 text-center text-outline text-xs flex flex-col items-center justify-center gap-2">
                      <span className="material-symbols-outlined text-[28px] opacity-40">filter_alt_off</span>
                      <span>Nenhum ativo encontrado no MAM</span>
                    </div>
                  ) : (
                    filteredMamAssets.map((asset) => {
                      const catName = asset.categoryId || 'Sem Categoria'
                      const catInfo = availableCategoriesList.find((c) => c.id === catName)
                      const catColor = catInfo?.color || '#389BFF'

                      return (
                        <div
                          key={asset.id}
                          onDoubleClick={() => handleInsertFromMam(asset)}
                          className="bg-surface-panel/60 hover:bg-surface-panel p-2 rounded border border-border-subtle/60 hover:border-primary/40 flex flex-col gap-1 transition-all cursor-pointer group"
                          title="Duplo clique para inserir na programação ativa"
                        >
                          <div className="flex items-start justify-between gap-1.5">
                            <span className="font-headline-sm text-[11.5px] font-semibold text-on-surface truncate group-hover:text-primary">
                              {asset.title}
                            </span>
                            <span
                              className="font-label-caps text-[8px] font-bold px-1.5 py-0.2 rounded border shrink-0"
                              style={{
                                color: catColor,
                                borderColor: `${catColor}66`,
                                backgroundColor: `${catColor}15`,
                              }}
                            >
                              {catName}
                            </span>
                          </div>

                          <div className="flex items-center justify-between text-[9.5px] font-label-mono text-outline">
                            <div className="flex items-center gap-1.5">
                              <span className="text-on-surface font-semibold">
                                {dur(asset.durationFrames, rate)}
                              </span>
                              <span>•</span>
                              <span>{asset.kind || 'VT'}</span>
                            </div>

                            <div className="flex items-center gap-1">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleInsertFromMam(asset)
                                }}
                                className="px-2 py-0.5 rounded bg-primary/20 hover:bg-primary text-primary hover:text-surface-base font-label-caps text-[9px] font-bold border border-primary/40 transition-colors flex items-center gap-0.5 cursor-pointer shadow-sm"
                                title="Inserir na grade do dia selecionado"
                              >
                                <span className="material-symbols-outlined text-[12px]">add</span>
                                <span>Inserir</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>

                {/* Rodapé da Biblioteca */}
                <div className="p-1.5 border-t border-border-subtle bg-surface-container-high font-label-mono text-[9px] text-outline flex items-center justify-between shrink-0">
                  <span>{filteredMamAssets.length} clipes listados</span>
                  <span className="text-primary font-medium">Duplo clique insere</span>
                </div>
              </div>
            )}

            {/* TAB 2: CALENDÁRIO */}
            {sidebarTab === 'calendar' && (
              <>
            {/* Mini-Calendário Mensal Tático Interativo */}
            <div className="bg-surface-card rounded border border-border-subtle shadow-md overflow-hidden flex flex-col">
              {/* Cabeçalho do Mês com Controles de Navegação */}
              <div className="bg-surface-container-high px-2.5 py-1.5 border-b border-border-subtle flex items-center justify-between">
                <button
                  onClick={() => shiftCalendarMonth(-1)}
                  className="hover:bg-surface-panel p-1 rounded text-outline hover:text-on-surface cursor-pointer"
                  title="Mês Anterior"
                >
                  <span className="material-symbols-outlined text-[14px]">chevron_left</span>
                </button>
                <div className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-accent-ice text-[15px]">calendar_month</span>
                  <span className="font-label-caps text-[11px] text-on-surface font-bold tracking-wide">
                    {currentMonthName}
                  </span>
                </div>
                <button
                  onClick={() => shiftCalendarMonth(1)}
                  className="hover:bg-surface-panel p-1 rounded text-outline hover:text-on-surface cursor-pointer"
                  title="Próximo Mês"
                >
                  <span className="material-symbols-outlined text-[14px]">chevron_right</span>
                </button>
              </div>

              {/* Barra Rápida: [← Ontem] [Hoje] [Amanhã →] + Date Picker */}
              <div className="bg-surface-panel/70 px-2 py-1 border-b border-border-subtle/50 flex items-center justify-between text-[9px] font-label-mono">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => shiftSelectedDate(-1)}
                    className="px-1.5 py-0.5 rounded bg-surface-container hover:bg-surface-panel text-outline hover:text-on-surface cursor-pointer"
                    title="Dia Anterior"
                  >
                    ◄ Ontem
                  </button>
                  <button
                    onClick={() => {
                      setSelectedDate(todayDateIso)
                      setCalendarMonth(new Date(now.getFullYear(), now.getMonth(), 1))
                    }}
                    className={`px-1.5 py-0.5 rounded font-bold cursor-pointer ${
                      selectedDate === todayDateIso
                        ? 'bg-primary text-surface-base'
                        : 'bg-surface-container hover:bg-surface-panel text-primary'
                    }`}
                  >
                    Hoje
                  </button>
                  <button
                    onClick={() => shiftSelectedDate(1)}
                    className="px-1.5 py-0.5 rounded bg-surface-container hover:bg-surface-panel text-outline hover:text-on-surface cursor-pointer"
                    title="Próximo Dia"
                  >
                    Amanhã ►
                  </button>
                </div>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => {
                    if (e.target.value) {
                      setSelectedDate(e.target.value)
                      const d = new Date(`${e.target.value}T12:00:00`)
                      setCalendarMonth(new Date(d.getFullYear(), d.getMonth(), 1))
                    }
                  }}
                  className="bg-surface-base border border-border-subtle rounded px-1 text-[9px] text-on-surface font-mono cursor-pointer"
                  title="Ir diretamente para uma data"
                />
              </div>

              {/* Matriz Mensal 7x5 com Alinhamento Real de Dias */}
              <div className="p-2 flex flex-col gap-1">
                <div className="grid grid-cols-7 text-center font-label-mono text-[8px] text-outline uppercase pb-1 border-b border-border-subtle/40">
                  <span>D</span><span>S</span><span>T</span><span>Q</span><span>Q</span><span>S</span><span>S</span>
                </div>

                <div className="grid grid-cols-7 gap-1 pt-1 text-center font-label-mono text-[9px]">
                  {/* Células vazias do offset do início do mês */}
                  {Array.from({ length: firstDayOfWeek }).map((_, i) => (
                    <div key={`pad-${i}`} className="py-1"></div>
                  ))}

                  {/* Dias do mês */}
                  {Array.from({ length: daysInCalMonth }, (_, i) => i + 1).map((d) => {
                    const dIso = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
                    const isToday = dIso === todayDateIso
                    const isSelected = dIso === selectedDate
                    const isPast = dIso < todayDateIso
                    const hasRundown = availableDatesSet.has(dIso)

                    let btnClass = 'bg-surface-container/60 hover:bg-surface-panel text-outline/80 border border-border-subtle/40'
                    if (isSelected) {
                      btnClass = 'bg-primary text-surface-base font-bold ring-2 ring-primary-fixed shadow-md'
                    } else if (isToday) {
                      btnClass = 'bg-primary/20 text-primary font-bold border border-primary/50'
                    } else if (hasRundown) {
                      btnClass = 'bg-status-ok/15 hover:bg-status-ok/25 text-on-surface border border-status-ok/40'
                    } else if (isPast) {
                      btnClass = 'bg-surface-container/30 hover:bg-surface-panel text-outline/50'
                    }

                    return (
                      <button
                        key={d}
                        onClick={() => setSelectedDate(dIso)}
                        className={`py-1 rounded flex flex-col items-center leading-none transition-all cursor-pointer ${btnClass}`}
                        title={
                          isToday
                            ? `Dia ${d} - HOJE (No Ar)`
                            : hasRundown
                            ? `Dia ${d} - Grade Programada`
                            : `Dia ${d} - Sem Grade Carregada`
                        }
                      >
                        <span>{String(d).padStart(2, '0')}</span>
                        <span
                          className={`w-1 h-1 rounded-full mt-0.5 ${
                            isToday
                              ? 'bg-status-ok-bright animate-ping'
                              : hasRundown
                              ? 'bg-status-ok-bright'
                              : 'bg-outline/20'
                          }`}
                        ></span>
                      </button>
                    )
                  })}
                </div>

                {/* Legendas Rápidas */}
                <div className="mt-1 pt-1.5 border-t border-border-subtle/50 grid grid-cols-2 gap-1 text-[8px] font-label-mono text-outline">
                  <div className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-status-ok-bright"></span> Grade Pronta
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary"></span> Dia Selecionado
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-armed-amber"></span> Alerta GAP
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-outline/30"></span> A Planejar
                  </div>
                </div>
              </div>
            </div>

            {/* Resumo Tático do Dia Selecionado */}
            <div className="bg-surface-card rounded border border-border-subtle p-2.5 flex flex-col gap-2 shadow-md">
              <div className="flex items-center justify-between border-b border-border-subtle pb-1.5">
                <div className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-primary text-[16px]">fact_check</span>
                  <span className="font-label-caps text-[10px] text-on-surface font-bold">
                    RESUMO DO DIA ({selectedDateObj.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })})
                  </span>
                </div>
                <span className={`font-label-mono text-[9px] px-1 py-0.2 rounded font-bold ${
                  selectedDate === todayDateIso ? 'text-on-air-glow bg-on-air-crimson/20' : 'text-status-ok-bright bg-status-ok/15'
                }`}>
                  {dateBadgeStatus}
                </span>
              </div>

              {/* Indicador 1: Duração Total 24h */}
              <div className="bg-surface-panel p-1.5 rounded border border-border-subtle flex items-center justify-between">
                <span className="text-[9px] font-label-caps text-outline">TOTAL PREVISTO:</span>
                <span className="font-timecode-table text-[11px] text-on-surface font-bold">
                  {dur(totalDurationFrames, rate)}
                  {timelineData.gaps.length > 0 && (
                    <span className="text-armed-amber text-[9px] ml-1">
                      ({timelineData.gaps.length} gap)
                    </span>
                  )}
                </span>
              </div>

              {/* Indicador 2: Cota Ancine */}
              <div className="bg-surface-panel p-1.5 rounded border border-border-subtle flex flex-col gap-1">
                <div className="flex items-center justify-between text-[9px] font-label-caps">
                  <span className="text-outline">COTA ANCINE NACIONAL:</span>
                  <span className="text-status-ok-bright font-bold font-label-mono">
                    {displayItems.length > 0 ? '3h 45m / 3h 30m' : '0h 00m / 3h 30m'}
                  </span>
                </div>
                <div className="w-full bg-surface-base h-1 rounded overflow-hidden">
                  <div className="bg-status-ok h-full" style={{ width: displayItems.length > 0 ? '100%' : '0%' }}></div>
                </div>
                <span className="text-[8px] font-label-mono text-status-ok-bright">
                  {displayItems.length > 0 ? '✓ Meta regulatória cumprida (+15 min)' : 'Pendente de preenchimento'}
                </span>
              </div>

              {/* Indicador 3: Gaps Detectados */}
              {timelineData.gaps.length > 0 && (
                <div
                  onClick={() => handleOpenAutoFillForGap(timelineData.gaps[0])}
                  className="bg-armed-amber/15 border border-armed-amber/50 p-2 rounded flex items-center justify-between cursor-pointer hover:bg-armed-amber/25 transition-colors"
                  title="Clique para abrir Autofill inteligente de gaps"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-armed-amber text-[16px]">warning</span>
                    <div className="flex flex-col">
                      <span className="font-label-caps text-[9px] text-armed-amber font-bold">GAPS DETECTADOS:</span>
                      <span className="font-label-mono text-[10px] text-on-surface font-bold">
                        {timelineData.gaps.length} GAP ({dur(timelineData.gaps[0]!.duration, rate)})
                      </span>
                    </div>
                  </div>
                  <span className="bg-armed-amber text-surface-base font-label-caps text-[8px] px-1 py-0.5 rounded font-bold">
                    RESOLVER
                  </span>
                </div>
              )}

              {/* Indicador 4: Comerciais & Breaks */}
              <div className="bg-surface-panel p-1.5 rounded border border-border-subtle flex items-center justify-between font-label-mono text-[9px]">
                <span className="text-outline">Comerciais 24h:</span>
                <span className="text-on-surface font-semibold">
                  {displayItems.length > 0 ? '18.4% (Max 25%)' : '0%'} <span className="text-status-ok-bright">✓</span>
                </span>
              </div>
            </div>

            {/* Ações Rápidas do Dia */}
            <div className="bg-surface-card rounded border border-border-subtle p-2 flex flex-col gap-1.5">
              <button
                onClick={() => handleCopyGrid()}
                disabled={isLoadingDate}
                className="w-full flex items-center justify-center gap-1.5 bg-surface-panel hover:bg-surface-container text-on-surface border border-border-subtle py-1.5 rounded font-body-sm text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-50"
                title="Copiar programação ativa para este dia"
              >
                <span className="material-symbols-outlined text-[15px] text-tertiary">content_copy</span>
                <span>Copiar Grade do Dia Anterior</span>
              </button>
              <button
                onClick={handlePublish}
                className="w-full flex items-center justify-center gap-1.5 bg-surface-panel hover:bg-surface-container text-on-surface border border-border-subtle py-1.5 rounded font-body-sm text-[11px] font-medium transition-colors cursor-pointer"
                title="Publicar ou carregar grade no Master Playout"
              >
                <span className="material-symbols-outlined text-[15px] text-primary">publish</span>
                <span>Publicar no Master Playout</span>
              </button>
            </div>
          </>
        )}
      </aside>

          {/* ========================================================
              COLUNA DIREITA (~80%): TIMELINE 24H CONTÍNUA + GRADE DE EXIBIÇÃO
              ======================================================== */}
          <section className="flex-1 flex flex-col gap-space-sm min-w-0 overflow-hidden">
            {/* 1. TIMELINE CONTÍNUA DE 24 HORAS CONECTADA */}
            <div className="bg-surface-card rounded border border-border-subtle p-space-sm flex flex-col gap-1 shadow-md">
              <div className="flex flex-wrap items-center justify-between gap-1 border-b border-border-subtle/60 pb-1">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary text-[17px]">timeline</span>
                  <span className="font-label-caps text-[11px] text-on-surface font-bold tracking-wide">
                    TIMELINE CONTÍNUA 24H • DETECÇÃO DE GAPS &amp; PLAYHEAD AO VIVO
                  </span>
                  <span className="font-label-mono text-[9px] bg-surface-container px-2 py-0.5 rounded text-accent-ice font-bold border border-border-subtle">
                    {selectedDateFormatted}
                  </span>
                </div>

                <div className="flex items-center gap-1">
                  <div className="bg-surface-panel rounded p-0.5 border border-border-subtle flex items-center gap-0.5 text-[9px] font-label-mono">
                    <span className="text-outline px-1">ZOOM:</span>
                    {(['24h', '12h', '6h', '1h'] as const).map((z) => (
                      <button
                        key={z}
                        onClick={() => setZoomMode(z)}
                        className={`px-1.5 py-0.2 rounded font-bold transition-colors cursor-pointer ${
                          zoomMode === z
                            ? 'bg-primary text-surface-base shadow-sm'
                            : 'text-outline hover:text-on-surface'
                        }`}
                      >
                        {z}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Régua de Horas Dinâmica conforme o zoomMode */}
              <div className="relative h-4 w-full flex text-[8px] font-label-mono text-outline select-none px-1 border-b border-border-subtle/30">
                {zoomMode === '24h' && (
                  <>
                    <span className="absolute left-0">00:00</span>
                    <span className="absolute left-[12.5%]">03:00</span>
                    <span className="absolute left-[25%]">06:00</span>
                    <span className="absolute left-[37.5%]">09:00</span>
                    <span className="absolute left-[50%] font-bold text-accent-ice">12:00</span>
                    <span className="absolute left-[62.5%]">15:00</span>
                    <span className="absolute left-[75%]">18:00</span>
                    <span className="absolute left-[87.5%]">21:00</span>
                    <span className="absolute right-0">24:00</span>
                  </>
                )}
                {zoomMode === '12h' && (
                  <>
                    <span className="absolute left-0">00:00</span>
                    <span className="absolute left-[16.6%]">02:00</span>
                    <span className="absolute left-[33.3%]">04:00</span>
                    <span className="absolute left-[50%] font-bold text-accent-ice">06:00</span>
                    <span className="absolute left-[66.6%]">08:00</span>
                    <span className="absolute left-[83.3%]">10:00</span>
                    <span className="absolute right-0">12:00</span>
                  </>
                )}
                {zoomMode === '6h' && (
                  <>
                    <span className="absolute left-0">00:00</span>
                    <span className="absolute left-[16.6%]">01:00</span>
                    <span className="absolute left-[33.3%]">02:00</span>
                    <span className="absolute left-[50%] font-bold text-accent-ice">03:00</span>
                    <span className="absolute left-[66.6%]">04:00</span>
                    <span className="absolute left-[83.3%]">05:00</span>
                    <span className="absolute right-0">06:00</span>
                  </>
                )}
                {zoomMode === '1h' && (
                  <>
                    <span className="absolute left-0">00:00</span>
                    <span className="absolute left-[16.6%]">00:10</span>
                    <span className="absolute left-[33.3%]">00:20</span>
                    <span className="absolute left-[50%] font-bold text-accent-ice">00:30</span>
                    <span className="absolute left-[66.6%]">00:40</span>
                    <span className="absolute left-[83.3%]">00:50</span>
                    <span className="absolute right-0">01:00</span>
                  </>
                )}
              </div>

              {/* Trilho de Blocos 24h & Playhead Dinâmico */}
              <div className="relative h-9 w-full bg-[#050912] rounded border border-border-subtle/70 overflow-hidden flex items-center shadow-inner">
                {/* Blocos de Eventos Programados */}
                {timelineData.blocks.map((block) => (
                  <div
                    key={block.item.item.id}
                    onClick={() => {
                      setSelectedItemIds(new Set([block.item.item.id]))
                      const el = document.getElementById(`row-${block.item.item.id}`)
                      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    }}
                    style={{
                      left: `${block.leftPct}%`,
                      width: `${block.widthPct}%`,
                    }}
                    title={`${block.item.asset?.title || block.item.item.id} (${dur(block.duration, rate)})`}
                    className={`absolute top-1 bottom-1 rounded-sm border cursor-pointer transition-all flex items-center justify-center overflow-hidden ${
                      selectedItemId === block.item.item.id
                        ? 'ring-2 ring-primary-fixed border-primary-fixed z-20 brightness-125'
                        : block.isLive
                        ? 'bg-on-air-crimson/90 border-on-air-glow hover:brightness-110'
                        : block.isCom
                        ? 'bg-tertiary/70 border-tertiary hover:brightness-110'
                        : 'bg-primary/50 border-primary/70 hover:brightness-110'
                    }`}
                  >
                    <span className="text-[7.5px] font-label-mono truncate px-0.5 text-white/90 drop-shadow">
                      {block.item.asset?.title?.slice(0, 15) || block.item.item.type}
                    </span>
                  </div>
                ))}

                {/* Blocos de Alerta de GAP */}
                {timelineData.gaps.map((gap, gIdx) => (
                  <div
                    key={`gap-${gIdx}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedGap(gap)
                      setShowGapPopover(true)
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      handleOpenAutoFillForGap(gap)
                    }}
                    style={{
                      left: `${gap.leftPct}%`,
                      width: `${gap.widthPct}%`,
                    }}
                    title={`ALERTA DE GAP: ${gap.label} (-${dur(gap.duration, rate)}). Clique para opções ou duplo clique para AutoFill imediato.`}
                    className="absolute top-0 bottom-0 bg-armed-amber/30 border-2 border-dashed border-armed-amber animate-pulse cursor-pointer hover:bg-armed-amber/50 z-10 flex items-center justify-center shadow-[0_0_10px_rgba(255,149,0,0.5)]"
                  >
                    <span className="text-[8px] font-label-caps text-armed-amber font-bold tracking-tighter uppercase px-0.5 bg-[#050912]/80 rounded">
                      ⚠️ GAP -{dur(gap.duration, rate)}
                    </span>
                  </div>
                ))}

                {/* Playhead em Tempo Real NTP (ativo no dia de hoje) */}
                {isViewingToday && (
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-status-ok-bright shadow-[0_0_8px_#00FF66] z-30 pointer-events-none flex flex-col items-center justify-between"
                    style={{ left: `${playheadPercent.toFixed(2)}%` }}
                  >
                    <div className="w-2 h-2 bg-status-ok-bright rounded-full -mt-0.5 shadow-sm"></div>
                    <div className="w-2 h-2 bg-status-ok-bright rounded-full -mb-0.5 shadow-sm"></div>
                  </div>
                )}

                {/* Popover Interativo de Ação Rápida de GAP */}
                {showGapPopover && selectedGap && (
                  <div className="absolute top-10 left-1/2 -translate-x-1/2 bg-surface-card border-2 border-armed-amber rounded shadow-2xl p-2.5 z-40 w-72 flex flex-col gap-1.5 animate-fadeIn">
                    <div className="flex items-center justify-between border-b border-border-subtle pb-1">
                      <div className="flex items-center gap-1">
                        <span className="material-symbols-outlined text-armed-amber text-[15px] animate-pulse">warning</span>
                        <span className="font-label-caps text-[9.5px] text-armed-amber font-bold tracking-wide">
                          GAP CRÍTICO DETECTADO
                        </span>
                      </div>
                      <button
                        onClick={() => setShowGapPopover(false)}
                        className="text-outline hover:text-on-surface font-bold text-xs cursor-pointer"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="flex items-center justify-between text-[8.5px] font-label-mono text-outline">
                      <span>Horário: <strong className="text-on-surface">{selectedGap.label}</strong></span>
                      <span className="text-armed-amber font-bold">(-{dur(selectedGap.duration, rate)})</span>
                    </div>
                    <button
                      onClick={() => {
                        handleOpenAutoFillForGap(selectedGap)
                        setShowGapPopover(false)
                      }}
                      className="w-full bg-armed-amber hover:bg-armed-glow text-surface-base px-2 py-1.5 rounded font-label-caps text-[10px] font-bold flex items-center justify-center gap-1.5 shadow-[0_0_8px_#FF9500] transition-all cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[14px]">auto_fix_high</span>
                      ⚡ AUTOFILL INTELIGENTE (1-CLIQUE)
                    </button>
                  </div>
                )}
              </div>

              {/* Legenda de Cores da Linha do Tempo */}
              <div className="flex flex-wrap items-center justify-between gap-1 pt-1 border-t border-border-subtle/40 text-[8px] font-label-mono text-outline">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded bg-on-air-crimson inline-block"></span>
                    <strong className="text-on-surface">🔴 Ao Vivo</strong>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded bg-primary/40 border border-primary inline-block"></span>
                    <span className="text-on-surface">🔷 Gravado</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded bg-tertiary inline-block"></span>
                    <span className="text-on-surface">🟧 Breaks</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded bg-armed-amber inline-block animate-pulse"></span>
                    <strong className="text-armed-amber">⚠️ GAP</strong>
                  </span>
                  {isViewingToday && (
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded bg-status-ok-bright inline-block"></span>
                      <strong className="text-status-ok-bright">📍 Playhead ({currentLiveClock})</strong>
                    </span>
                  )}
                </div>
                <div className="text-on-surface-variant">
                  Eventos no Dia: <span className="text-status-ok-bright font-bold">{displayItems.length} Itens</span>
                </div>
              </div>
            </div>

            {/* 2. BARRA DE AÇÕES (INTERCÂMBIO & PUBLICAR NO MASTER) */}
            <div className="bg-surface-card rounded border border-border-subtle px-2.5 py-1.5 flex flex-wrap items-center justify-between gap-2 shadow-sm">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  onClick={handleAddItem}
                  className="flex items-center gap-1 bg-surface-panel hover:bg-surface-container text-on-surface border border-border-subtle hover:border-border-strong px-2 py-1 rounded font-body-sm text-[11px] transition-colors cursor-pointer"
                  title="Importar grade no padrão broadcast BXF ou M3U8"
                >
                  <span className="material-symbols-outlined text-[15px] text-accent-ice">cloud_download</span>
                  <span>Importar BXF / M3U</span>
                </button>

                {/* Dropdown de Exportação */}
                <div className="relative inline-block z-30">
                  <button
                    onClick={() => setShowExportMenu(!showExportMenu)}
                    className="flex items-center gap-1.5 bg-accent-ice/15 hover:bg-accent-ice/25 text-accent-ice-bright border border-accent-ice/40 px-2 py-1 rounded font-body-sm text-[11px] font-semibold transition-colors shadow-sm cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[15px] text-accent-ice-bright">file_download</span>
                    <span>Exportar Grade</span>
                    <span className="material-symbols-outlined text-[14px] text-accent-ice-bright">arrow_drop_down</span>
                  </button>

                  {showExportMenu && (
                    <div className="absolute top-full left-0 mt-1 w-72 bg-surface-card border-2 border-accent-ice/40 rounded shadow-2xl p-2 z-50 flex flex-col gap-1.5 text-left select-none">
                      <div className="flex items-center justify-between border-b border-border-subtle pb-1">
                        <span className="font-label-caps text-[9px] text-on-surface font-bold uppercase">
                          EXPORTAR GRADE • ${selectedDate}
                        </span>
                        <button onClick={() => setShowExportMenu(false)} className="text-outline hover:text-on-surface font-bold text-xs cursor-pointer">✕</button>
                      </div>
                      <button
                        onClick={() => {
                          if (onExportCsv) onExportCsv()
                          setShowExportMenu(false)
                        }}
                        className="p-1.5 rounded hover:bg-surface-panel flex items-center justify-between text-body-sm cursor-pointer text-left"
                      >
                        <span className="font-bold text-on-surface text-[11px]">Planilha CSV Oficial</span>
                        <span className="text-[9px] text-outline">Excel / LibreOffice</span>
                      </button>
                    </div>
                  )}
                </div>

                <button
                  onClick={() => handleOpenAutoFill()}
                  className="flex items-center gap-1 bg-surface-panel hover:bg-surface-container text-on-surface border border-border-subtle px-2 py-1 rounded font-body-sm text-[11px] transition-colors cursor-pointer"
                  title="Preenchimento automático inteligente de buracos na grade"
                >
                  <span className="material-symbols-outlined text-[15px] text-armed-amber">auto_fix_high</span>
                  <span>Auto-Fill Gaps</span>
                </button>

                <button
                  onClick={handleAddItem}
                  className="flex items-center gap-1 bg-surface-panel hover:bg-surface-container text-on-surface border border-border-subtle px-2 py-1 rounded font-body-sm text-[11px] transition-colors cursor-pointer"
                  title="Inserir novo evento na programação"
                >
                  <span className="material-symbols-outlined text-[15px] text-primary">add_circle</span>
                  <span>+ Evento</span>
                </button>

                <button
                  onClick={() => setShowLiveProgramModal(true)}
                  className="flex items-center gap-1 bg-surface-panel hover:bg-surface-container text-on-surface border border-border-subtle hover:border-error/50 px-2 py-1 rounded font-body-sm text-[11px] transition-colors cursor-pointer"
                  title="Agendar transmissão ao vivo com horário marcado"
                >
                  <span className="material-symbols-outlined text-[15px] text-error">live_tv</span>
                  <span>+ Ao Vivo</span>
                </button>
              </div>

              {/* Botão de Publicação no Master Playout */}
              <div className="flex items-center gap-2">
                <button
                  onClick={handlePublish}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded font-label-caps text-[11px] font-bold shadow-md transition-all cursor-pointer ${
                    publishedSuccess
                      ? 'bg-status-ok text-surface-base shadow-[0_0_12px_#00FF66]'
                      : 'bg-primary hover:bg-primary-fixed text-surface-base shadow-[0_0_10px_rgba(208,188,255,0.4)]'
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">
                    {publishedSuccess ? 'check_circle' : 'publish'}
                  </span>
                  <span>
                    {publishedSuccess
                      ? 'PUBLICADO NO MASTER!'
                      : selectedDate === todayDateIso
                      ? 'SINCRONIZAR MASTER'
                      : `CARREGAR ${selectedDate} NO MASTER`}
                  </span>
                </button>
              </div>
            </div>

            {/* 3. GRADE DE EXIBIÇÃO COMPACTA 24H (TABELA OU CARD DE PLANEJAMENTO SE VAZIA) */}
            <div className="flex-1 bg-surface-card rounded border border-border-subtle shadow-md overflow-hidden flex flex-col min-h-[380px]">
              <div className="grid grid-cols-12 bg-surface-container-high px-3 py-1.5 font-label-caps text-[9px] text-outline uppercase tracking-wider border-b border-border-subtle items-center select-none sticky top-0 z-10">
                <div className="col-span-1 flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    title="Selecionar todos os itens (Ctrl+A)"
                    checked={displayItems.length > 0 && selectedItemIds.size === displayItems.length}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedItemIds(new Set(displayItems.map((it) => it.item.id)))
                      } else {
                        setSelectedItemIds(new Set())
                      }
                    }}
                    className="w-3.5 h-3.5 rounded border border-border-subtle bg-surface-base text-primary cursor-pointer"
                  />
                  <span>#</span>
                </div>
                <div className="col-span-2">Regra / Tipo</div>
                <div className="col-span-2">Horário NTP</div>
                <div className="col-span-2">Duração</div>
                <div className="col-span-4">MAM ID &amp; Título da Mídia</div>
                <div className="col-span-1 text-right">Status / QC</div>
              </div>

              <div className="flex-1 divide-y divide-border-subtle/50 overflow-y-auto broadcast-scroll">
                {isLoadingDate ? (
                  <div className="p-12 text-center flex flex-col items-center justify-center gap-2 text-outline">
                    <span className="material-symbols-outlined text-[32px] text-primary animate-spin">sync</span>
                    <span className="font-label-caps text-xs">Carregando programação de {selectedDate}...</span>
                  </div>
                ) : displayItems.length === 0 ? (
                  <div className="p-8 flex flex-col items-center justify-center gap-4 text-center">
                    <div className="w-12 h-12 rounded-full bg-surface-panel border border-border-subtle flex items-center justify-center">
                      <span className="material-symbols-outlined text-[28px] text-accent-ice">calendar_month</span>
                    </div>
                    <div className="flex flex-col gap-1 max-w-md">
                      <h3 className="font-headline-sm text-sm font-bold text-on-surface uppercase">
                        Nenhuma Grade Cadastrada para {selectedDateFormatted}
                      </h3>
                      <p className="text-outline text-xs">
                        Este dia ainda não possui eventos programados. Escolha uma das opções abaixo para iniciar a grade linear desta data:
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg pt-2">
                      <button
                        onClick={() => handleCopyGrid()}
                        className="p-3 bg-surface-panel hover:bg-surface-container border border-border-subtle hover:border-primary/50 rounded flex items-center gap-2.5 text-left transition-colors cursor-pointer group"
                      >
                        <span className="material-symbols-outlined text-primary text-[22px] group-hover:scale-110 transition-transform">content_copy</span>
                        <div className="flex flex-col">
                          <span className="font-bold text-xs text-on-surface">Copiar Grade Anterior</span>
                          <span className="text-[10px] text-outline">Duplica todos os eventos de hoje</span>
                        </div>
                      </button>

                      <button
                        onClick={handleCreateBlankGrid}
                        className="p-3 bg-surface-panel hover:bg-surface-container border border-border-subtle hover:border-accent-ice/50 rounded flex items-center gap-2.5 text-left transition-colors cursor-pointer group"
                      >
                        <span className="material-symbols-outlined text-accent-ice text-[22px] group-hover:scale-110 transition-transform">post_add</span>
                        <div className="flex flex-col">
                          <span className="font-bold text-xs text-on-surface">Criar Grade em Branco</span>
                          <span className="text-[10px] text-outline">Começar grade limpa do zero</span>
                        </div>
                      </button>

                      <button
                        onClick={handleAddItem}
                        className="p-3 bg-surface-panel hover:bg-surface-container border border-border-subtle hover:border-tertiary/50 rounded flex items-center gap-2.5 text-left transition-colors cursor-pointer group"
                      >
                        <span className="material-symbols-outlined text-tertiary text-[22px] group-hover:scale-110 transition-transform">upload_file</span>
                        <div className="flex flex-col">
                          <span className="font-bold text-xs text-on-surface">Importar M3U / BXF</span>
                          <span className="text-[10px] text-outline">Carregar playlist pronta de arquivo</span>
                        </div>
                      </button>

                      <button
                        onClick={() => handleOpenAutoFill()}
                        className="p-3 bg-surface-panel hover:bg-surface-container border border-border-subtle hover:border-armed-amber/50 rounded flex items-center gap-2.5 text-left transition-colors cursor-pointer group"
                      >
                        <span className="material-symbols-outlined text-armed-amber text-[22px] group-hover:scale-110 transition-transform">auto_fix_high</span>
                        <div className="flex flex-col">
                          <span className="font-bold text-xs text-on-surface">Auto-Fill EPG Linear</span>
                          <span className="text-[10px] text-outline">Preencher dia via catálogo MAM</span>
                        </div>
                      </button>
                    </div>
                  </div>
                ) : (
                  displayItems.map((item, idx) => {
                    const isSelected = selectedItemIds.has(item.item.id)
                    const durationFrames = item.trim
                      ? Math.max(0, item.trim.out - item.trim.in)
                      : item.item?.durationOverride ?? item.asset?.durationFrames ?? 0

                    return (
                      <div
                        key={item.item.id}
                        id={`row-${item.item.id}`}
                        onClick={(e) => handleRowClick(e, item, idx)}
                        onDoubleClick={() => openEditScheduleTime(item)}
                        className={`grid grid-cols-12 px-3 py-1.5 items-center text-body-sm font-body-sm transition-colors group cursor-pointer select-none ${
                          isSelected
                            ? 'bg-primary-container/25 border-l-4 border-primary font-medium text-white shadow-inner'
                            : 'bg-surface-card hover:bg-surface-panel'
                        }`}
                      >
                        <div className="col-span-1 font-label-mono text-[11px] flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {}}
                            className="w-3.5 h-3.5 rounded border border-border-subtle bg-surface-base text-primary cursor-pointer pointer-events-none"
                          />
                          <span className="text-outline">{idx + 1}</span>
                        </div>
                        <div className="col-span-2 flex items-center gap-1.5 flex-wrap">
                          <span className="px-1.5 py-0.5 rounded font-label-caps text-[8.5px] bg-surface-container font-semibold text-primary">
                            {item.asset?.kind ?? item.item.type ?? 'VT'}
                          </span>
                          {item.asset?.categoryId && (() => {
                            const catName = item.asset.categoryId
                            const catInfo = availableCategoriesList.find((c) => c.id === catName)
                            const catColor = catInfo?.color || '#389BFF'
                            return (
                              <span
                                className="px-1.5 py-0.2 rounded font-label-caps text-[8px] font-bold border"
                                style={{
                                  color: catColor,
                                  borderColor: `${catColor}66`,
                                  backgroundColor: `${catColor}18`,
                                }}
                                title={`Categoria: ${catName}`}
                              >
                                {catName}
                              </span>
                            )
                          })()}
                        </div>
                        <div className="col-span-2 font-label-mono text-[11px] tabular-nums text-on-surface">
                          {scheduleMap.get(item.item.id)?.start != null
                            ? clock(scheduleMap.get(item.item.id)!.start, rate)
                            : '--:--:--:--'}
                        </div>
                        <div className="col-span-2 font-label-mono text-[11px] tabular-nums text-outline">
                          {dur(durationFrames, rate)}
                        </div>
                        <div className="col-span-4 font-body-sm text-body-sm truncate text-on-surface">
                          {item.asset?.title || item.item.title || item.item.id}
                        </div>
                        <div className="col-span-1 text-right">
                          <span className="font-label-mono text-[9px] text-status-ok-bright font-bold">
                            QC OK
                          </span>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              {/* Barra de Ações: Multisseleção OU Item Único Selecionado */}
              {selectedItemIds.size > 1 ? (
                <div className="p-2.5 bg-surface-container-high border-t border-border-subtle flex flex-wrap items-center justify-between gap-3 text-body-sm select-none">
                  <div className="flex items-center gap-2.5">
                    <span className="font-label-caps text-[9px] text-accent-ice font-bold uppercase bg-accent-ice/20 px-2 py-0.5 rounded border border-accent-ice/30">
                      MULTISSELEÇÃO ATIVA
                    </span>
                    <span className="font-bold text-on-surface">
                      {selectedItemIds.size} itens selecionados
                    </span>
                    <span className="font-label-mono text-[11px] text-outline">
                      Duração somada: <strong className="text-primary">{dur(selectedTotalDurationFrames, rate)}</strong>
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSelectedItemIds(new Set())}
                      className="px-2.5 py-1 rounded bg-surface-panel hover:bg-surface-container border border-border-subtle text-outline hover:text-on-surface font-label-caps text-[10px] cursor-pointer transition-colors"
                    >
                      Desmarcar Todos (Esc)
                    </button>

                    <button
                      disabled={isBulkDeleting}
                      onClick={handleBulkRemove}
                      className="px-2.5 py-1 rounded bg-error-container/30 hover:bg-error-container text-on-error-container font-label-caps text-[10px] flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-[14px]">delete</span>
                      {isBulkDeleting ? 'Removendo...' : `Remover ${selectedItemIds.size} Itens`}
                    </button>
                  </div>
                </div>
              ) : (() => {
                const selectedItem = displayItems.find((it) => it.item.id === selectedItemId) ?? null
                if (!selectedItem) return null
                const durationFrames = selectedItem.trim
                  ? Math.max(0, selectedItem.trim.out - selectedItem.trim.in)
                  : selectedItem.item?.durationOverride ?? selectedItem.asset?.durationFrames ?? 0

                return (
                  <div className="p-2.5 bg-surface-container-high border-t border-border-subtle flex flex-wrap items-center justify-between gap-3 text-body-sm select-none">
                    <div className="flex items-center gap-2.5">
                      <span className="font-label-caps text-[9px] text-primary font-bold uppercase bg-primary/20 px-2 py-0.5 rounded border border-primary/30">
                        ITEM SELECIONADO
                      </span>
                      <span className="font-bold text-on-surface truncate max-w-sm">
                        {selectedItem.asset?.title || selectedItem.item.title || selectedItem.item.id}
                      </span>
                      <span className="font-label-mono text-[11px] text-outline">
                        {dur(durationFrames, rate)}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {selectedItem.asset && (
                        <div className="flex items-center gap-1 bg-surface-panel px-2 py-1 rounded border border-border-subtle">
                          <span className="material-symbols-outlined text-[14px] text-primary">label</span>
                          <span className="text-[9.5px] text-outline font-label-caps font-semibold">Categoria:</span>
                          <select
                            value={selectedItem.asset.categoryId || ''}
                            onChange={async (e) => {
                              const newCat = e.target.value || null
                              try {
                                await api.patchAsset(selectedItem.asset!.id, { categoryId: newCat })
                                await loadDateRundown(selectedDate)
                                setFeedbackMessage(`✓ Categoria atualizada para "${newCat || 'Sem Categoria'}"`)
                                setTimeout(() => setFeedbackMessage(null), 3000)
                              } catch (err: any) {
                                alert(`Erro ao alterar categoria: ${err.message}`)
                              }
                            }}
                            className="bg-transparent text-on-surface text-[10px] font-label-mono font-bold outline-none cursor-pointer"
                          >
                            <option value="" className="bg-surface-card text-on-surface">Sem Categoria</option>
                            {availableCategoriesList.map((c) => (
                              <option key={c.id} value={c.id} className="bg-surface-card text-on-surface">
                                {c.id}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      <button
                        onClick={() => openEditScheduleTime(selectedItem)}
                        className="px-2.5 py-1 rounded bg-surface-panel hover:bg-surface-container border border-border-subtle text-primary hover:text-white font-label-caps text-[10px] flex items-center gap-1 cursor-pointer transition-colors"
                        title="Configurar entrada fixa (HH:MM:SS) ou fluxo sequencial e duração"
                      >
                        <span className="material-symbols-outlined text-[14px]">schedule</span>
                        Horário de Entrada
                      </button>
                      {onOpenTrim && (
                        <button
                          onClick={() => onOpenTrim(selectedItem)}
                          className="px-2.5 py-1 rounded bg-surface-panel hover:bg-surface-container border border-border-subtle text-outline hover:text-on-surface font-label-caps text-[10px] flex items-center gap-1 cursor-pointer transition-colors"
                        >
                          <span className="material-symbols-outlined text-[14px]">content_cut</span>
                          Editar Trim
                        </button>
                      )}
                      {onOpenAudio && (
                        <button
                          onClick={() => onOpenAudio(selectedItem)}
                          className="px-2.5 py-1 rounded bg-surface-panel hover:bg-surface-container border border-border-subtle text-outline hover:text-on-surface font-label-caps text-[10px] flex items-center gap-1 cursor-pointer transition-colors"
                        >
                          <span className="material-symbols-outlined text-[14px]">volume_up</span>
                          Áudio
                        </button>
                      )}
                      {onRemoveItem && (
                        <button
                          onClick={() => handleRemoveItem(selectedItem.item.id)}
                          className="px-2.5 py-1 rounded bg-error-container/30 hover:bg-error-container text-on-error-container font-label-caps text-[10px] flex items-center gap-1 cursor-pointer transition-colors"
                        >
                          <span className="material-symbols-outlined text-[14px]">delete</span>
                          Remover
                        </button>
                      )}
                    </div>
                  </div>
                )
              })()}
            </div>
          </section>
        </div>
      </main>

      {/* MODAL: AJUSTAR HORÁRIO DE ENTRADA & DURAÇÃO */}
      {editingTimeItem && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-surface-card border border-border-subtle rounded-lg shadow-2xl max-w-md w-full overflow-hidden flex flex-col">
            <div className="px-4 py-3 bg-surface-container-high border-b border-border-subtle flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[20px]">schedule</span>
                <h3 className="font-headline-sm text-sm font-bold text-on-surface">
                  Horário de Entrada &amp; Duração
                </h3>
              </div>
              <button
                onClick={() => setEditingTimeItem(null)}
                className="text-outline hover:text-on-surface font-bold text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-4 flex flex-col gap-4 text-body-sm">
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-label-caps text-outline uppercase">Item Selecionado</span>
                <span className="font-semibold text-on-surface truncate text-xs bg-surface-panel p-2 rounded border border-border-subtle">
                  {editingTimeItem.asset?.title || editingTimeItem.item.title || editingTimeItem.item.id}
                </span>
              </div>

              {/* Modo de Entrada: FLOW vs FIXED */}
              <div className="flex flex-col gap-1.5">
                <span className="text-[10px] font-label-caps text-outline uppercase">Modo de Agendamento</span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setTimeAnchorKind('FLOW')}
                    className={`p-2.5 rounded border text-left flex flex-col gap-0.5 cursor-pointer transition-colors ${
                      timeAnchorKind === 'FLOW'
                        ? 'border-primary bg-primary/15 text-primary'
                        : 'border-border-subtle bg-surface-panel text-outline hover:text-on-surface'
                    }`}
                  >
                    <span className="font-bold text-xs">Sequencial (FLOW)</span>
                    <span className="text-[9.5px] opacity-80">Entra após item anterior</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setTimeAnchorKind('FIXED')}
                    className={`p-2.5 rounded border text-left flex flex-col gap-0.5 cursor-pointer transition-colors ${
                      timeAnchorKind === 'FIXED'
                        ? 'border-armed-amber bg-armed-amber/15 text-armed-amber'
                        : 'border-border-subtle bg-surface-panel text-outline hover:text-on-surface'
                    }`}
                  >
                    <span className="font-bold text-xs">Horário Fixo (NTP)</span>
                    <span className="text-[9.5px] opacity-80">Entra pontualmente no horário</span>
                  </button>
                </div>
              </div>

              {timeAnchorKind === 'FIXED' && (
                <div className="flex flex-col gap-1.5 p-3 rounded bg-armed-amber/10 border border-armed-amber/30">
                  <label className="text-[10px] font-label-caps text-armed-amber font-bold uppercase flex items-center gap-1">
                    <span className="material-symbols-outlined text-[13px]">alarm</span>
                    Horário de Início (HH:MM:SS)
                  </label>
                  <input
                    type="text"
                    value={timeInputHms}
                    onChange={(e) => setTimeInputHms(e.target.value)}
                    placeholder="12:00:00"
                    pattern="^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$"
                    className="w-full bg-surface-base border border-border-subtle rounded px-2.5 py-1.5 font-label-mono text-sm text-on-surface focus:outline-none focus:border-armed-amber"
                  />
                  <span className="text-[9.5px] text-outline">
                    A exibição aguardará pontualmente este horário para disparar o VT/Evento.
                  </span>
                </div>
              )}

              {/* Duração Estimada / Override (Minutos) */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-label-caps text-outline uppercase flex items-center justify-between">
                  <span>Duração Estimada / Override</span>
                  <span className="text-primary font-mono">{durationInputMinutes} min</span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    value={durationInputMinutes}
                    onChange={(e) => setDurationInputMinutes(Math.max(1, Number(e.target.value) || 1))}
                    className="w-24 bg-surface-base border border-border-subtle rounded px-2.5 py-1.5 font-label-mono text-xs text-on-surface focus:outline-none focus:border-primary"
                  />
                  <span className="text-xs text-outline">minutos ({Math.floor(durationInputMinutes / 60)}h {durationInputMinutes % 60}m)</span>
                </div>
              </div>
            </div>

            <div className="px-4 py-3 bg-surface-container-high border-t border-border-subtle flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingTimeItem(null)}
                className="px-3 py-1.5 rounded bg-surface-panel hover:bg-surface-container text-outline hover:text-on-surface font-label-caps text-[11px] cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isSavingTime}
                onClick={handleSaveScheduleTime}
                className="px-3 py-1.5 rounded bg-primary hover:bg-primary-fixed text-surface-base font-label-caps text-[11px] font-bold flex items-center gap-1.5 cursor-pointer shadow-md disabled:opacity-50"
              >
                {isSavingTime ? (
                  <>
                    <span className="material-symbols-outlined text-[14px] animate-spin">sync</span>
                    Salvando...
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-[14px]">save</span>
                    Salvar Horário
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: NOVO PROGRAMA AO VIVO COM ENTRADA MARCADA */}
      {showLiveProgramModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-surface-card border border-border-subtle rounded-lg shadow-2xl max-w-lg w-full overflow-hidden flex flex-col">
            <div className="px-4 py-3 bg-surface-container-high border-b border-border-subtle flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-error text-[20px]">live_tv</span>
                <h3 className="font-headline-sm text-sm font-bold text-on-surface">
                  Agendar Programa Ao Vivo
                </h3>
              </div>
              <button
                onClick={() => setShowLiveProgramModal(false)}
                className="text-outline hover:text-on-surface font-bold text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-4 flex flex-col gap-3.5 text-body-sm max-h-[80vh] overflow-y-auto broadcast-scroll">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-label-caps text-outline uppercase font-semibold">
                  Título do Programa / Evento
                </label>
                <input
                  type="text"
                  value={liveProgramTitle}
                  onChange={(e) => setLiveProgramTitle(e.target.value)}
                  placeholder="Ex: Jornal da Noite - Ao Vivo"
                  className="w-full bg-surface-base border border-border-subtle rounded px-2.5 py-1.5 text-xs text-on-surface focus:outline-none focus:border-primary"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-label-caps text-outline uppercase font-semibold">
                    Horário de Início (HH:MM:SS)
                  </label>
                  <input
                    type="text"
                    value={liveProgramTimeHms}
                    onChange={(e) => setLiveProgramTimeHms(e.target.value)}
                    placeholder="20:00:00"
                    pattern="^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$"
                    className="w-full bg-surface-base border border-border-subtle rounded px-2.5 py-1.5 font-label-mono text-xs text-on-surface focus:outline-none focus:border-primary"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-label-caps text-outline uppercase font-semibold">
                    Duração Estimada (minutos)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    value={liveProgramDurationMin}
                    onChange={(e) => setLiveProgramDurationMin(Math.max(1, Number(e.target.value) || 1))}
                    className="w-full bg-surface-base border border-border-subtle rounded px-2.5 py-1.5 font-label-mono text-xs text-on-surface focus:outline-none focus:border-primary"
                  />
                </div>
              </div>

              {/* Seletor Modular de Protocolos Canônicos (NDI, SDI, SRT, RTMP) */}
              <CanonicalProtocolSelector
                mode="INPUT"
                defaultKind="SDI"
                initialUri={liveProgramSourceRef}
                onChange={(res) => {
                  setLiveProgramSourceRef(res.targetUri)
                  if (!liveProgramTitle || liveProgramTitle === 'Transmissão Externa - Ao Vivo') {
                    if (res.nameRecommendation) setLiveProgramTitle(res.nameRecommendation)
                  }
                }}
              />
            </div>

            <div className="px-4 py-3 bg-surface-container-high border-t border-border-subtle flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowLiveProgramModal(false)}
                className="px-3 py-1.5 rounded bg-surface-panel hover:bg-surface-container text-outline hover:text-on-surface font-label-caps text-[11px] cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isCreatingLive || !liveProgramTitle.trim() || !liveProgramSourceRef.trim()}
                onClick={handleCreateLiveProgram}
                className="px-3 py-1.5 rounded bg-error hover:bg-error/90 text-white font-label-caps text-[11px] font-bold flex items-center gap-1.5 cursor-pointer shadow-md disabled:opacity-50"
              >
                {isCreatingLive ? (
                  <>
                    <span className="material-symbols-outlined text-[14px] animate-spin">sync</span>
                    Agendando...
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-[14px]">add_circle</span>
                    Agendar Ao Vivo
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
