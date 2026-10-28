import { confirmAction, notify } from '../domain/confirm.js'
import { useChannelMirror } from '../domain/use-channel-mirror.js'
import { MirrorStatus } from '../components/MirrorStatus.js'
import { deniedReason, useCan } from '../domain/permissions.js'
import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { wallClock, nowHms, parseHms, formatHms, anchorWall, anchorFramesFor, resolveWallInstant, type DayChoice } from '../domain/wall-clock.js'
import {itemDisplayTitle} from '../domain/item-title.js'
import type { Channel, ManagedLiveSource, Rundown, AssetMetadataReview } from '@rplayout/protocol'
import { durationIn, qcApproved } from '@rplayout/protocol'
import { clock, dur } from '../format.js'
import type { RundownView, ItemView, LibraryAsset, LibraryFolder, Categoria, Snapshot } from '../types.js'
import type { WorkspaceId } from '../components/WorkspaceShell.js'
import { BroadcastHeader } from '../components/broadcast/BroadcastHeader.js'
import { CanonicalProtocolSelector, type ProtocolResult } from '../components/broadcast/CanonicalProtocolSelector.js'
import { inputName } from '../components/broadcast/protocol-config.js'
import { api, type OperationalRevisionSummary, type OperationalSimulation } from '../api.js'
import {operationalReviewReady} from '../domain/operational-review.js'
import {BoundedLatestRead} from '../domain/bounded-latest-read.js'
import {publicationSnapshot} from '../domain/publication-snapshot.js'
import {OperationalRollbackDialog} from '../components/OperationalRollbackDialog.js'
import { canonicalLiveSourceRef, liveDefaultFrames, liveProtocolLabel } from '../liveSource.js'
import { collapsedRows, findRepeatRuns } from '../domain/repeat-runs.js'
import { ProtectedTimingZonesDialog } from '../components/ProtectedTimingZonesDialog.js'
import { editorialContext, editorialSelection } from '../domain/editorial-context.js'
import { SchedulePublicationPanel } from '../components/broadcast/SchedulePublicationPanel.js'
import {AssetMetadataEditor} from '../components/AssetMetadataEditor.js'
import {isCatalogMediaAsset} from '../domain/asset-metadata-review.js'
import {catalogIgnored,type IgnoredOverride} from '../domain/catalog-ignored.js'
import {applyBulkCategory,nextSelection} from '../domain/bulk-category.js'

interface Props {
  channel: Channel
  channels?: Channel[]
  view: RundownView
  folders?: LibraryFolder[]
  libraryLoaded?: boolean
  categorias?: Categoria[]
  onInsertAsset?: (
    assetId: string | null,
    atIndex?: number,
    liveConfig?: { sourceRef: string; title: string; durationOverride?: number },
  ) => void
  onPreviewAsset?: (asset: LibraryAsset) => void
  /** Abre uma fonte externa no PVW sem fingir que ela é um arquivo MAM. */
  onPreviewLiveSource?: (sourceRef: string, title: string) => void
  /** Arma um item da grade no Preview do canal ativo. */
  onCueItem?: (itemId: string) => void
  onNavigate: (workspace: WorkspaceId) => void
  onSelectChannel?: (channelId: string) => void
  /**
   * Aplica no Master o snapshot que acabou de ser persistido. Receber o
   * retorno da mutação evita a janela em que um refresh/WS antigo recoloca
   * a grade anterior após uma mudança de horário.
   */
  onPublishToMaster: (snapshot?: Snapshot) => void
  onOpenAutoFill: (
    rundownId?: string,
    onApplied?: (snapshot: any) => void,
    options?: {
      initialHours?: number
      initialMinutes?: number
      initialStart?: string
      initialEnd?: string
      autoPreview?: boolean
      editorialRevision?:number
    },
  ) => void
  sessionRole?: string
  authRequired?: boolean
  onAddItem?: (rundownId?: string, onApplied?: (snapshot: any) => void,revision?:number) => void
  onExportCsv?: () => void
  onOpenTrim?: (item: ItemView) => void
  onOpenAudio?: (item: ItemView) => void
  onRemoveItem?: (itemId: string, rundownId?: string, onRemoved?: () => void,revision?:number) => void
  onBulkRemoveItems?: (ids: string[], rundownId?: string, onRemoved?: () => void,revision?:number) => void
  onOpenSettings?: () => void
  onRemoveAsset?: (assetId:string)=>void
  onPruneAssets?: ()=>void
}

export function PlaylistScheduleView({
  channel,
  channels = [channel],
  view,
  folders = [],
  libraryLoaded = true,
  categorias = [],
  onInsertAsset,
  onPreviewAsset,
  onPreviewLiveSource,
  onCueItem,
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
  onBulkRemoveItems,
  onOpenSettings,
  onRemoveAsset,
  onPruneAssets,
}: Props) {
  const mirror = useChannelMirror(channel.id)
  const canPublish = useCan('PLAYLIST_PUBLISH')
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
  const dateLoadId = useRef(0)
  const editorialRequestKey = JSON.stringify([channel.id,selectedDate])
  const editorialRequestKeyRef = useRef(editorialRequestKey)
  editorialRequestKeyRef.current = editorialRequestKey
  const publicationSelection=useRef({key:editorialRequestKey})
  if(publicationSelection.current.key!==editorialRequestKey)publicationSelection.current={key:editorialRequestKey}
  const pendingEditorialCreation = useRef<{key:string;promise:Promise<RundownView>} | null>(null)
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
  /** Janela deslizável da timeline quando o zoom mostra menos de 24 horas. */
  const [timelineStartHour, setTimelineStartHour] = useState(0)
  const [publishedSuccess, setPublishedSuccess] = useState(false)
  const [operationalRevision, setOperationalRevision] = useState<number | null>(null)
  const [isPublishingOperational, setIsPublishingOperational] = useState(false)
  const [showOperationalReview, setShowOperationalReview] = useState(false)
  const [showProtectedZones, setShowProtectedZones] = useState(false)
  const [operationalSimulation, setOperationalSimulation] = useState<OperationalSimulation | null>(null)
  const [operationalRevisions, setOperationalRevisions] = useState<OperationalRevisionSummary[]>([])
  const [operationalReviewError, setOperationalReviewError] = useState<string | null>(null)
  const [isLoadingOperational, setIsLoadingOperational] = useState(false)
  const [operationalRefresh, setOperationalRefresh] = useState(0)
  const [rollbackReview,setRollbackReview]=useState<{inspection:OperationalSimulation & {sourceRevision:number};origin:{id:string;version:number;key:string;selection:{key:string}};revisionId:string}|null>(null)
  const comparisonReads=useRef(new BoundedLatestRead())
  const rollbackReads=useRef(new BoundedLatestRead())
  const editorialRefreshReads=useRef(new BoundedLatestRead())
  const operationalBusy=useRef(false)
  const rollbackInspecting=useRef(false)
  const operationalAlive=useRef(true)
  const [isRefreshingEditorial,setIsRefreshingEditorial]=useState(false)
  const [isInspectingRollback,setIsInspectingRollback]=useState(false)
  useEffect(()=>{operationalAlive.current=true;return()=>{operationalAlive.current=false;comparisonReads.current.cancel();rollbackReads.current.cancel();editorialRefreshReads.current.cancel()}},[])

  const rate = channel.rate

  // Modos da Barra Lateral Esquerda: 'mam' (Biblioteca) ou 'calendar' (Calendário)
  const [sidebarTab, setSidebarTab] = useState<'mam' | 'calendar'>('mam')
  const [mamSearch, setMamSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL')
  const [metadataOverrides,setMetadataOverrides]=useState<Map<string,AssetMetadataReview>>(new Map())
  const [metadataAssetId,setMetadataAssetId]=useState<string|null>(null)
  // Multi-selection of catalog files (Ctrl/Shift) to set one category at once.
  const [mamSelection,setMamSelection]=useState<Set<string>>(new Set())
  const mamAnchor=useRef<string|null>(null)
  const [bulkCategory,setBulkCategory]=useState('')
  const [bulkProgress,setBulkProgress]=useState<{done:number;total:number}|null>(null)
  const [ignoredOverrides, setIgnoredOverrides] = useState<Map<string, IgnoredOverride>>(new Map())
  const [mamContextMenu, setMamContextMenu] = useState<{ asset: LibraryAsset & {isLiveSource?:boolean}; x: number; y: number } | null>(null)
  const [liveSources, setLiveSources] = useState<ManagedLiveSource[]>([])

  useEffect(() => {
    let active = true
    void api.liveSources(channel.id)
      .then((sources) => { if (active) setLiveSources(sources.filter((source) => source.enabled)) })
      .catch(() => { if (active) setLiveSources([]) })
    return () => { active = false }
  }, [channel.id])

  // Fecha o menu de contexto do MAM ao clicar fora ou pressionar Escape
  useEffect(() => {
    if (!mamContextMenu) return
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest('[role="menu"]')) return
      setMamContextMenu(null)
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMamContextMenu(null)
      }
    }
    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [mamContextMenu])

  // Estado para Edição do Horário de Entrada (Anchor) e Duração Ao Vivo
  const [editingTimeItem, setEditingTimeItem] = useState<ItemView | null>(null)
  const [timeAnchorKind, setTimeAnchorKind] = useState<'FLOW' | 'FIXED'>('FLOW')
  const [timeInputHms, setTimeInputHms] = useState(() => nowHms(new Date(), 1))
  const [timeInputDay, setTimeInputDay] = useState<DayChoice>('today')
  const [durationInputMinutes, setDurationInputMinutes] = useState(30)
  const [isSavingTime, setIsSavingTime] = useState(false)

  // Diálogo para Novo Programa Ao Vivo
  const [showLiveProgramModal, setShowLiveProgramModal] = useState(false)
  const [liveProgramTitle, setLiveProgramTitle] = useState('')
  const [liveProgramNameEdited, setLiveProgramNameEdited] = useState(false)
  const [liveProgramInputValid, setLiveProgramInputValid] = useState(false)
  const [liveProgramTimeHms, setLiveProgramTimeHms] = useState(() => nowHms(new Date(), 1))
  const [liveProgramDay, setLiveProgramDay] = useState<DayChoice>('today')
  const [liveProgramStart, setLiveProgramStart] = useState<'NOW' | 'FIXED' | 'FLOW'>('FIXED')
  const [liveProgramPreset, setLiveProgramPreset] = useState(false)
  const [liveProgramDurationMin, setLiveProgramDurationMin] = useState(60)
  const [liveProgramSourceRef, setLiveProgramSourceRef] = useState('')
  const [liveSourceOption, setLiveSourceOption] = useState('decklink://0')
  const [isCreatingLive, setIsCreatingLive] = useState(false)
  const liveProgramTarget=useRef<{view:RundownView;key:string}|null>(null)
  const selectLiveProgramInput = useCallback((result: ProtocolResult) => {
    setLiveProgramSourceRef(result.targetUri)
    setLiveProgramInputValid(result.isHardwareValid)
    setLiveProgramTitle((current) => inputName(current, result.nameRecommendation, liveProgramNameEdited))
  }, [liveProgramNameEdited])
  // Ao vivo sempre entra com horário: o diálogo abre com a hora atual (próximo
  // minuto) e, vindo da biblioteca, já com a fonte escolhida.
  const openLiveProgram = async (preset?: { sourceRef: string; title: string; durationFrames?: number | null }) => {
    let target:RundownView
    try{target=await ensureEditorialView()}catch(error){setFeedbackMessage(error instanceof Error?error.message:'Não consegui abrir a grade.');return}
    liveProgramTarget.current={view:target,key:editorialRequestKey}
    setLiveProgramTitle(preset?.title ?? '')
    setLiveProgramNameEdited(Boolean(preset))
    setLiveProgramSourceRef(preset?.sourceRef ?? '')
    setLiveProgramInputValid(Boolean(preset))
    setLiveProgramPreset(Boolean(preset))
    setLiveProgramStart('FIXED')
    setLiveProgramDay('today')
    setLiveProgramTimeHms(nowHms(new Date(), 1))
    const fps = rate.num / rate.den || 50
    if (preset?.durationFrames && preset.durationFrames > 0) setLiveProgramDurationMin(Math.max(1, Math.round(preset.durationFrames / fps / 60)))
    setShowLiveProgramModal(true)
  }

  /** Horário escolhido -> âncora na base da grade. Horário que já passou
   * pergunta antes de ir para amanhã; nada é gravado sem resposta. */
  const anchorForChoice = async (hms: string, day: DayChoice, gradeDate: string | null | undefined): Promise<{ kind: 'FIXED'; at: number } | null> => {
    const seconds = parseHms(hms)
    if (seconds === null) throw new Error('Horário inválido. Use HH:MM:SS, de 00:00:00 a 23:59:59.')
    let instant = resolveWallInstant(seconds, day, gradeDate)
    if (instant.getTime() < Date.now() - 1000) {
      if (!(await confirmAction(`${formatHms(seconds)} de hoje já passou. Agendar para amanhã no mesmo horário?`))) return null
      instant = resolveWallInstant(seconds, 'tomorrow', gradeDate)
    }
    return { kind: 'FIXED', at: anchorFramesFor(instant, rate, gradeDate) }
  }

  const allMamAssets = useMemo<LibraryAsset[]>(() => {
    if (!folders || folders.length === 0) return []
    return folders.flatMap((f) => f.assets).map((asset) => {
      const own=metadataOverrides.get(asset.id)
      const metadata=own&&asset.qcRevision!==undefined&&asset.qcRevision<=own.revision?own:null
      return {...asset,...(metadata?{title:metadata.title,categoryId:metadata.categoryId}:{}),
        // Do not advance a QC proof using a metadata response. Technical data,
        // hash and approval still belong to the original library snapshot.
        ignored:catalogIgnored(asset,ignoredOverrides.get(asset.id))}
    })
  }, [folders, metadataOverrides, ignoredOverrides])

  // Fontes configuradas aparecem na mesma biblioteca, mas preservam a sua
  // natureza: ao clicar, vão ao PVW por sourceRef em vez de virar asset MAM.
  const allLibraryAssets = useMemo<Array<LibraryAsset & { isLiveSource?: boolean; sourceRef?: string }>>(() => [
    ...allMamAssets,
    ...liveSources.map((source) => ({
      id: source.id,
      title: source.name,
      kind: 'VIDEO' as const,
      path: canonicalLiveSourceRef(source),
      contentHash: source.id,
      fileName: source.name,
      durationFrames: liveDefaultFrames(rate),
      durationNs: null,
      probe: null,
      probeError: null,
      categoryId: 'Ao Vivo',
      defaultTrim: null,
      defaultAudio: null,
      loudnessFile: null,
      suggestedTrim: null,
      qcStatus: 'APPROVED' as const,
      qcNotes: null,
      qcCheckedAt: null,
      thumbnailUrl: '',
      createdAt: new Date().toISOString(),
      isLiveSource: true,
      sourceRef: canonicalLiveSourceRef(source),
    })),
  ], [allMamAssets, liveSources, rate.den, rate.num])

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
    let ignoredCount = 0
    for (const a of allMamAssets) {
      if (a.ignored) {
        ignoredCount++
      } else {
        const c = a.categoryId || 'Sem Categoria'
        counts.set(c, (counts.get(c) || 0) + 1)
      }
    }

    const list: Array<{ id: string; name: string; color: string; count: number }> = []
    // Categorias configuradas aparecem mesmo antes do primeiro arquivo.
    for (const cId of new Set([...catMap.keys(), ...counts.keys()])) {
      const count = counts.get(cId) ?? 0
      const catObj = catMap.get(cId)
      const color = catObj?.color || defaultColors[cId] || '#389BFF'
      list.push({ id: cId, name: cId, color, count })
    }

    if (ignoredCount > 0) {
      list.push({ id: 'IGNORED', name: 'IGNORADOS (QC)', color: '#EF4444', count: ignoredCount })
    }

    return list
  }, [categorias, allMamAssets])

  const openMetadata=(id:string)=>{setMetadataAssetId(id);setMamContextMenu(null)}

  const toggleMamIgnored = async (asset: LibraryAsset & {isLiveSource?:boolean}) => {
    if(!isCatalogMediaAsset(asset)){setMamContextMenu(null);return}
    const nextIgnored = !asset.ignored
    try {
      const result=await api.patchAsset(asset.id, { ignored: nextIgnored },asset.qcRevision)
      if(asset.qcRevision!==undefined)setIgnoredOverrides((previous) => new Map(previous).set(asset.id,{ignored:nextIgnored,reviewedRevision:asset.qcRevision!,contentHash:asset.contentHash}))
      setFeedbackMessage(result.refreshError??(
        nextIgnored
          ? `✓ Vídeo "${asset.title}" marcado como IGNORADO (oculto da grade ativa)`
          : `✓ Vídeo "${asset.title}" reativado no catálogo MAM`
      ))
    } catch(error) {
      setFeedbackMessage(error instanceof Error?error.message:'Não foi possível alterar o status de ignorado do ativo.')
    } finally {
      setMamContextMenu(null)
    }
  }

  const filteredMamAssets = useMemo(() => {
    return allLibraryAssets.filter((asset) => {
      if (selectedCategory === 'IGNORED') {
        if (!asset.ignored) return false
      } else {
        if (asset.ignored) return false
        if (selectedCategory !== 'ALL') {
          const cat = asset.categoryId || 'Sem Categoria'
          if (cat !== selectedCategory) return false
        }
      }
      if (mamSearch.trim()) {
        const q = mamSearch.toLowerCase()
        const titleMatch = (asset.title || '').toLowerCase().includes(q)
        const nameMatch = (asset.fileName || '').toLowerCase().includes(q)
        return titleMatch || nameMatch
      }
      return true
    })
  }, [allLibraryAssets, selectedCategory, mamSearch])

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
      const requestId=++dateLoadId.current
      if (dateIso === view.rundown.date && view.rundown.channelId===channel.id) {
        setDateRundownView(null)
        setIsLoadingDate(false)
        return
      }
      setIsLoadingDate(true)
      try {
        const res = await api.channelRundowns(channel.id, dateIso)
        if(requestId!==dateLoadId.current)return
        if (res.view) {
          setDateRundownView(res.view)
        } else {
          setDateRundownView(null)
        }
      } catch (err) {
        console.error('Falha ao carregar grade da data', dateIso, err)
        if(requestId===dateLoadId.current)setDateRundownView(null)
      } finally {
        if(requestId===dateLoadId.current)setIsLoadingDate(false)
      }
    },
    [channel.id, view.rundown.date, view.rundown.channelId],
  )

  useEffect(() => {
    void loadDateRundown(selectedDate)
  }, [selectedDate, loadDateRundown])

  // Identidade editorial é data + canal, nunca um fallback para o Master.
  const activeView = editorialContext(view,dateRundownView,selectedDate,channel.id)
  const isLoadedEditorial = activeView?.rundown.id === view.rundown.id
  useEffect(() => {
    setSelectedItemIds(new Set())
    lastClickedIndexRef.current = null
  }, [selectedDate, channel.id, activeView?.rundown.id])
  const ensureEditorialView = async (): Promise<RundownView> => {
    if(activeView)return activeView
    const key=editorialRequestKey
    let pending=pendingEditorialCreation.current
    if (!pending || pending.key!==key) {
      const promise=(async()=>{
        const existing=await api.channelRundowns(channel.id,selectedDate)
        if(editorialRequestKeyRef.current!==key)throw new Error('A data ou o canal mudou. Repita a ação na grade selecionada.')
        if(existing.view)return existing.view
        const created=await api.createChannelRundown(channel.id,{date:selectedDate})
        if(!created.view || created.view.rundown.date!==selectedDate || created.view.rundown.channelId!==channel.id)throw new Error('Não consegui abrir a grade da data selecionada.')
        return created.view
      })()
      pending={key,promise}
      pendingEditorialCreation.current=pending
      void promise.finally(()=>{if(pendingEditorialCreation.current?.promise===promise)pendingEditorialCreation.current=null}).catch(()=>{})
    }
    const createdView=await pending.promise
    if(editorialRequestKeyRef.current!==key)throw new Error('A data ou o canal mudou. Repita a ação na grade selecionada.')
    setDateRundownView(createdView)
    void refreshAvailableRundowns()
    return createdView
  }
  const ensureEditorialRundown=async()=> (await ensureEditorialView()).rundown.id
  const reviewRundownId = activeView?.rundown.id
  const editorialFingerprint = JSON.stringify([activeView?.editorialRevision,activeView?.items.map(entry => entry.item) ?? [],activeView?.rundown.protectedZones ?? []])
  const publicationReady=operationalReviewReady(operationalSimulation?.review,reviewRundownId,channel.id,activeView?.editorialRevision)
  const operationalContext=JSON.stringify([editorialRequestKey,reviewRundownId,editorialFingerprint])
  const operationalContextRef=useRef(operationalContext)
  operationalContextRef.current=operationalContext
  useEffect(()=>{
    rollbackReads.current.cancel();editorialRefreshReads.current.cancel()
    rollbackInspecting.current=false
    setIsInspectingRollback(false);setIsRefreshingEditorial(false)
    if(!operationalBusy.current)setRollbackReview(null)
  },[operationalContext])
  useEffect(() => {
    const reading=comparisonReads.current.start()!
    setOperationalSimulation(null)
    setOperationalRevisions([])
    setOperationalRevision(null)
    setOperationalReviewError(null)
    if (!reviewRundownId){setIsLoadingOperational(false);reading.finish();return}
    setIsLoadingOperational(true)
    void Promise.all([api.simulateOperationalPlaylist(reviewRundownId,reading.signal), api.operationalRevisions(reviewRundownId,reading.signal)])
      .then(([simulation, history]) => {
        if (!reading.isCurrent()||reading.signal.aborted) return
        setOperationalSimulation(simulation)
        setOperationalRevisions(history.revisions)
        setOperationalRevision(simulation.activeRevision)
      })
      .catch(error => {
        if(!reading.isCurrent())return
        const timedOut=reading.timedOut()
        setOperationalReviewError(timedOut?'A conferência demorou demais. Nenhuma publicação foi enviada. Use Atualizar e conferir para tentar novamente.':error instanceof Error?error.message:'Não foi possível comparar as revisões.')
        setIsLoadingOperational(false)
        comparisonReads.current.cancel() // Cancel sibling GET, never publication.
      })
      .finally(() => { if (reading.isCurrent()) setIsLoadingOperational(false);reading.finish() })
    return () => { comparisonReads.current.cancel() }
  }, [operationalContext, operationalRefresh])

  const openOperationalReview = () => { if(operationalBusy.current)return;setShowOperationalReview(true); setOperationalRefresh(value => value + 1) }
  const closeOperationalReview=()=>{
    if(operationalBusy.current)return
    rollbackReads.current.cancel();rollbackInspecting.current=false
    setIsInspectingRollback(false);setRollbackReview(null);setShowOperationalReview(false)
  }
  const refreshOperationalReview=async()=>{
    if(!reviewRundownId || operationalBusy.current || rollbackInspecting.current || isLoadingOperational)return
    const reading=editorialRefreshReads.current.start(false)
    if(!reading)return
    const origin={id:reviewRundownId,key:operationalContext}
    setOperationalSimulation(null);setIsRefreshingEditorial(true);setOperationalReviewError(null)
    try{
      const fresh=await api.rundown(origin.id,reading.signal)
      if(!reading.isCurrent()||reading.signal.aborted||operationalContextRef.current!==origin.key)return
      if(isLoadedEditorial)onPublishToMaster(fresh);else setDateRundownView(fresh.view)
      setOperationalRefresh(value=>value+1)
    }catch(error){if(reading.isCurrent())setOperationalReviewError(reading.timedOut()?'A leitura da grade demorou demais. Nenhuma publicação foi enviada; tente Atualizar e conferir novamente.':error instanceof Error?error.message:'Não foi possível atualizar a grade.')}
    finally{if(reading.isCurrent())setIsRefreshingEditorial(false);reading.finish()}
  }

  // Conjunto de datas que já possuem grade cadastrada
  const availableDatesSet = useMemo(() => {
    const s = new Set<string>()
    if(view.rundown.channelId===channel.id)s.add(view.rundown.date)
    for (const r of availableRundowns) {
      if (r.date) s.add(r.date)
    }
    return s
  }, [availableRundowns, view.rundown.date, view.rundown.channelId, channel.id])

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
      void notify(`Erro ao copiar grade: ${err.message}`)
    } finally {
      setIsLoadingDate(false)
    }
  }

  // Criar grade em branco para a data selecionada
  const handleCreateBlankGrid = async () => {
    if(isLoadingDate)return
    setIsLoadingDate(true)
    try {
      await ensureEditorialRundown()
      await refreshAvailableRundowns()
      setFeedbackMessage(`✓ Grade em branco criada para ${selectedDate}!`)
      setTimeout(() => setFeedbackMessage(null), 4000)
    } catch (err: any) {
      void notify(`Erro ao criar grade: ${err.message}`)
    } finally {
      setIsLoadingDate(false)
    }
  }

  // Publicar / Sincronizar com o Master
  const handlePublish = async () => {
    const target = activeView?.rundown
    if (!target || operationalBusy.current || rollbackInspecting.current || isRefreshingEditorial) return
    if(!showOperationalReview){openOperationalReview();return}
    if(!publicationReady || !operationalSimulation){setOperationalReviewError('A conferência não corresponde à grade exibida. Atualize a grade e revise a publicação novamente.');return}
    const reviewed=operationalSimulation.review
    const selection=publicationSelection.current
    const stillSelected=()=>operationalAlive.current&&publicationSelection.current===selection
    operationalBusy.current=true
    setIsPublishingOperational(true)
    setPublishedSuccess(false)
    try {
      // Freeze first. Loading another date is a separate, protected operation;
      // a rejected load cannot overwrite the program or show a stale snapshot.
      const published = await api.publishOperationalPlaylist(target.id,reviewed.editorialRevision,reviewed.token)
      if(!stillSelected())throw new Error(`Revisão ${published.revision} salva para ${target.date}, mas a seleção mudou. Não foi solicitado carregar outra grade no Master.`)
      setOperationalRevision(published.revision)
      setOperationalRefresh(value => value + 1)
      if(published.refreshError){setPublishedSuccess(false);setShowOperationalReview(false);setOperationalReviewError(published.refreshError);setFeedbackMessage(`Revisão ${published.revision} gravada. ${published.refreshError}`);return}
      const snapshot=await publicationSnapshot({revision:published.revision,rundownId:target.id,loadedRundownId:view.rundown.id,current:stillSelected,
        read:async()=>{
          const reading=editorialRefreshReads.current.start()!
          try{return await api.rundown(target.id,reading.signal)}
          catch(error){if(reading.timedOut())throw new Error('A leitura após publicação demorou demais');throw error}
          finally{reading.finish()}
        },
        // This is a mutation: it must not share a read cancellation signal.
        load:()=>api.loadChannelRundown(channel.id,target.id)})
      onPublishToMaster(snapshot)
      setPublishedSuccess(true)
      setShowOperationalReview(false)
      // Espelhos: o publicador vê na hora se os canais vinculados acompanharam.
      const mirrorNames=(published.mirrors??[]).map(result=>`${channels.find(entry=>entry.id===result.channelId)?.name??result.channelId}: ${result.ok?'atualizado':`pendente (${result.error})`}`)
      setFeedbackMessage(
        (published.conflicts.length > 0
          ? `Revisão operacional ${published.revision} publicada com ${published.conflicts.length} alerta(s) de timing.`
          : `Revisão operacional ${published.revision} publicada e sincronizada com o Master.`)
        + (mirrorNames.length ? ` Espelhos — ${mirrorNames.join(' · ')}.` : ''),
      )
      setTimeout(() => {
        setPublishedSuccess(false)
        setFeedbackMessage(null)
      }, 4000)
    } catch (err: any) {
      setPublishedSuccess(false)
      setOperationalReviewError(err.message)
      setFeedbackMessage(err.message)
    } finally {
      operationalBusy.current=false
      setIsPublishingOperational(false)
    }
  }

  const handleOperationalRollback = async (revision: OperationalRevisionSummary) => {
    if (!reviewRundownId || !activeView || operationalBusy.current || isRefreshingEditorial || isLoadingOperational || operationalReviewError) return
    const version=activeView.editorialRevision
    if(version===undefined){setOperationalReviewError('Atualize a grade antes de conferir o rollback.');return}
    const reading=rollbackReads.current.start(false)
    if(!reading)return
    const context=operationalContext
    const origin={id:reviewRundownId,version,key:editorialRequestKey,selection:publicationSelection.current}
    rollbackInspecting.current=true
    setIsInspectingRollback(true)
    setOperationalReviewError(null)
    try {
      const inspected=await api.reviewOperationalRollback(origin.id,revision.id,origin.version,reading.signal)
      if(!reading.isCurrent()||reading.signal.aborted||operationalContextRef.current!==context)return
      setRollbackReview({inspection:inspected,origin,revisionId:revision.id})
    } catch (error) {
      if(reading.isCurrent())setOperationalReviewError(reading.timedOut()?'A conferência de restauração demorou demais. Nenhuma revisão foi restaurada; atualize e confira novamente.':error instanceof Error ? error.message : 'Conferência de restauração indisponível.')
    } finally { if(reading.isCurrent()){rollbackInspecting.current=false;setIsInspectingRollback(false)}reading.finish() }
  }

  const applyOperationalRollback=async()=>{
    if(!rollbackReview || operationalBusy.current)return
    const {origin,inspection,revisionId}=rollbackReview
    if(publicationSelection.current!==origin.selection)throw new Error('A data ou o canal mudou. Feche e confira a grade selecionada novamente.')
    operationalBusy.current=true
    setIsPublishingOperational(true)
    try{
      const restored=await api.rollbackOperationalPlaylist(origin.id,revisionId,origin.version,inspection.review.token)
      setRollbackReview(null)
      if(!operationalAlive.current||publicationSelection.current!==origin.selection){setFeedbackMessage(`Restauração salva como revisão ${restored.revision} na grade original. A seleção atual não foi alterada.`);return}
      setOperationalRevision(restored.revision);setOperationalRefresh(value=>value+1)
      if(restored.refreshError||!restored.snapshotAvailable){setOperationalReviewError(restored.refreshError??'Rollback gravado; leitura da execução não confirmada.');setFeedbackMessage(`Rollback gravado como revisão ${restored.revision}. Confira o canal antes de outra decisão.`);return}
      if(origin.id===view.rundown.id&&restored.snapshotAvailable)onPublishToMaster(restored)
      setFeedbackMessage(`Revisão ${inspection.sourceRevision} restaurada como revisão ${restored.revision}. A grade editorial foi preservada.`)
    }finally{operationalBusy.current=false;setIsPublishingOperational(false)}
  }

  const handleAddItem = async () => {
    if (!onAddItem) return
    let target:RundownView
    try { target=await ensureEditorialView() } catch(error){setFeedbackMessage(error instanceof Error?error.message:'Não consegui abrir a data.');return}
    onAddItem(target.rundown.id, (snapshot) => {
      if (!isLoadedEditorial && snapshot?.view) {
        setDateRundownView(snapshot.view)
        void refreshAvailableRundowns()
      }
    },target.editorialRevision)
  }

  const handleOpenAutoFill = async (options?: {
    initialHours?: number
    initialMinutes?: number
    initialStart?: string
    initialEnd?: string
    autoPreview?: boolean
  }) => {
    if (!onOpenAutoFill) return
    let target:RundownView
    try{target=await ensureEditorialView()}catch(error){setFeedbackMessage(error instanceof Error?error.message:'Não consegui abrir a grade; nada foi inserido.');return}

    onOpenAutoFill(
      target.rundown.id,
      (snapshot) => {
        if (!isLoadedEditorial) {
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
      {...options,editorialRevision:target.editorialRevision},
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
    if (!onRemoveItem || !activeView || !editorialSelection(activeView,[itemId]).length) return
    const targetRundownId = activeView?.rundown.id
    onRemoveItem(itemId, targetRundownId, () => {
      if (!isLoadedEditorial) {
        void loadDateRundown(selectedDate)
        void refreshAvailableRundowns()
      }
    },activeView.editorialRevision)
    setSelectedItemIds((prev) => {
      const next = new Set(prev)
      next.delete(itemId)
      return next
    })
  }

  const handleBulkRemove = async () => {
    const ids = editorialSelection(activeView,selectedItemIds)
    if (!activeView || ids.length === 0 || isBulkDeleting) return
    const count = ids.length
    if (!(await confirmAction(`Deseja remover os ${count} itens selecionados da grade linear?`))) return
    setIsBulkDeleting(true)
    try {
      const targetRundownId = activeView.rundown.id
      if (onBulkRemoveItems) {
        onBulkRemoveItems(ids, targetRundownId, () => {
          if (!isLoadedEditorial) {
            void loadDateRundown(selectedDate)
            void refreshAvailableRundowns()
          }
        },activeView.editorialRevision)
      } else {
        await api.bulkDeleteItems(targetRundownId, ids,activeView.editorialRevision)
      }
      setSelectedItemIds(new Set())
      if (!isLoadedEditorial) {
        await loadDateRundown(selectedDate)
        await refreshAvailableRundowns()
      } else {
        onPublishToMaster()
      }
    } catch (err: any) {
      void notify(`Erro ao remover itens selecionados: ${err.message}`)
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
      // A seleção simples na grade ativa é também a ação operacional de CUE.
      // Antes a Playlist apenas coloria a linha; fontes ao vivo pareciam
      // selecionadas, mas nunca chegavam ao Preview. Em grades históricas não
      // se toca no transporte do canal atual.
      if (isLoadedEditorial) onCueItem?.(itemId)
    }
  }

  // Inserir item da Biblioteca MAM na Grade
  const handleInsertFromMam = async (asset: LibraryAsset & { isLiveSource?: boolean; sourceRef?: string }) => {
    try {
      const target=await ensureEditorialView(),rId=target.rundown.id
      if (asset.isLiveSource) {
        if (!asset.sourceRef) throw new Error('A fonte ao vivo não possui endereço configurado.')
        void rId
        await openLiveProgram({ sourceRef: asset.sourceRef, title: asset.title, durationFrames: asset.durationFrames })
        return
      }
      const accepted=await api.addItem(rId, {
          mediaId: asset.id,
          type: 'VT',
          title: asset.title,
          anchor: { kind: 'FLOW' },
        },target.editorialRevision)
      if(isLoadedEditorial)onPublishToMaster(accepted)
      else {
        await loadDateRundown(selectedDate)
        void refreshAvailableRundowns()
      }
      setFeedbackMessage(`✓ "${asset.title}" inserido na programação!`)
      setTimeout(() => setFeedbackMessage(null), 3000)
    } catch (err: any) {
      void notify(`Erro ao inserir item: ${err.message}`)
    }
  }

  // Agendar Programa Ao Vivo com Horário Marcado
  const handleCreateLiveProgram = async () => {
    setIsCreatingLive(true)
    try {
      const target=liveProgramTarget.current
      if(!target || target.key!==editorialRequestKeyRef.current)throw new Error('A data ou o canal mudou. Feche e reabra o formulário na grade selecionada; seus campos não foram gravados.')
      const rId=target.view.rundown.id
      const fps = rate.num / rate.den || 50
      const durationFrames = Math.round(liveProgramDurationMin * 60 * fps)
      const gradeDate = target.view.rundown.date
      const anchor = liveProgramStart === 'FLOW' ? { kind: 'FLOW' as const }
        : liveProgramStart === 'NOW' ? { kind: 'FIXED' as const, at: anchorFramesFor(new Date(), rate, gradeDate) }
        : await anchorForChoice(liveProgramTimeHms, liveProgramDay, gradeDate)
      if (!anchor) return

      const snapshot = await api.addItem(rId, {
        sourceRef: liveProgramSourceRef,
        type: 'LIVE',
        title: liveProgramTitle,
        anchor,
        durationOverride: durationFrames,
      },target.view.editorialRevision)

      if (isLoadedEditorial) {
        // Usa a grade que acabou de ser resolvida no servidor. Uma nova
        // leitura concorrente podia reexibir a ordem antiga e aparentar que
        // a transmissão ao vivo havia sido acrescentada ao fim da fila.
        onPublishToMaster(snapshot)
      } else {
        await loadDateRundown(selectedDate)
        void refreshAvailableRundowns()
      }

      setFeedbackMessage(`✓ Programa Ao Vivo "${liveProgramTitle}" ${anchor.kind === 'FIXED' ? `agendado para ${wallClock(anchor.at, rate, gradeDate)}` : 'inserido após o item anterior'}!`)
      setTimeout(() => setFeedbackMessage(null), 3500)
      setShowLiveProgramModal(false)
    } catch (err: any) {
      void notify(`Erro ao criar programa ao vivo: ${err.message}`)
    } finally {
      setIsCreatingLive(false)
    }
  }

  // Abrir Modal de Edição de Horário de Entrada
  const openEditScheduleTime = (item: ItemView) => {
    setEditingTimeItem(item)
    const currentAnchor = item.item.anchor
    const fps = rate.num / rate.den || 50

    // Horário de parede: âncora salva (convertida da base da grade) ou, para
    // quem ainda não tem horário fixo, a hora atual arredondada ao próximo minuto.
    const gradeDate = activeView?.rundown.date
    if (currentAnchor && currentAnchor.kind === 'FIXED') {
      setTimeAnchorKind('FIXED')
      const wall = anchorWall(currentAnchor.at, rate, gradeDate)
      if (wall.day === 'today' || wall.day === 'tomorrow') {
        setTimeInputHms(formatHms(wall.seconds)); setTimeInputDay(wall.day)
      } else {
        // Âncora antiga (dia que já passou): propõe o mesmo horário no próximo dia possível.
        setTimeInputHms(formatHms(wall.seconds)); setTimeInputDay(resolveWallInstant(wall.seconds, 'today', gradeDate).getTime() < Date.now() ? 'tomorrow' : 'today')
      }
    } else {
      setTimeAnchorKind('FLOW')
      setTimeInputHms(nowHms(new Date(), 1)); setTimeInputDay('today')
    }
    void fps

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
        const anchor = await anchorForChoice(timeInputHms, timeInputDay, activeView?.rundown.date)
        if (!anchor) return
        anchorPayload = anchor
      }

      const patchBody: Record<string, any> = {
        anchor: anchorPayload,
      }

      if (editingTimeItem.item.type === 'LIVE' || (editingTimeItem.item.eventType as string) === 'LIVE' || durationInputMinutes > 0) {
        patchBody.durationOverride = Math.round(durationInputMinutes * 60 * fps)
      }

      // PATCH já devolve a programação resolvida pelo scheduler. Aplicá-la
      // diretamente é essencial: esperar somente o WebSocket deixava a
      // timeline com o horário anterior até uma troca de página.
      const snapshot = await api.patchItem(editingTimeItem.item.id, patchBody,editingTimeItem.editorialRevision)
      setFeedbackMessage(`✓ Horário de "${editingTimeItem.asset?.title || editingTimeItem.item.title || 'Item'}" atualizado!`)
      setTimeout(() => setFeedbackMessage(null), 3500)
      setEditingTimeItem(null)

      if (isLoadedEditorial) {
        onPublishToMaster(snapshot)
      } else {
        // Para uma data fora do ar, o snapshot retornado é a fonte de
        // verdade desta grade; a releitura preserva a lista de dias somente
        // como confirmação de disponibilidade.
        setDateRundownView(snapshot.view)
        void refreshAvailableRundowns()
      }
    } catch (err: any) {
      void notify(`Erro ao salvar horário: ${err.message}`)
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

  // Grade em loop expandida: recolhe as repetições (1º ciclo + resumo).
  const [collapseRepeats, setCollapseRepeats] = useState(true)
  const repeatRuns = useMemo(() => findRepeatRuns(displayItems.map((entry) => `${entry.item.type}:${entry.item.sourceRef ?? entry.asset?.id ?? entry.item.title ?? entry.item.id}`)), [displayItems])
  const visibleRows = useMemo(() => collapseRepeats && repeatRuns.length ? collapsedRows(displayItems.length, repeatRuns) : displayItems.map((_, index) => ({ index })), [collapseRepeats, repeatRuns, displayItems])

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
      const element = e.target as HTMLElement | null
      const typing = element?.matches('input, select, textarea') || element?.isContentEditable
      if (typing) return

      if (e.key === 'Escape') {
        setSelectedItemIds(new Set())
      } else if (e.key === 'Delete' && selectedItemIds.size > 0) {
        e.preventDefault()
        void handleBulkRemove()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedItemIds, activeView?.rundown.id, selectedDate, todayDateIso])

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

  // Ao alterar o zoom, foca no playhead se for hoje, ou centraliza a janela
  useEffect(() => {
    if (zoomMode === '24h') {
      setTimelineStartHour(0)
      return
    }
    const maxStart = 24 - visibleHours
    if (isViewingToday) {
      const currentHour = now.getHours()
      // Centraliza a janela ao redor da hora atual
      const targetStart = Math.max(0, Math.min(maxStart, Math.floor(currentHour - visibleHours / 2)))
      setTimelineStartHour(targetStart)
    } else {
      setTimelineStartHour((prev) => Math.min(prev, maxStart))
    }
  }, [zoomMode, isViewingToday])

  const viewportStartHour = Math.min(timelineStartHour, Math.max(0, 24 - visibleHours))
  const playheadPercent = isViewingToday
    ? Math.min(100, Math.max(0, ((secondsSinceMidnight / 3600 - viewportStartHour) / visibleHours) * 100))
    : 0
  const timelineLabel = (offset: number) => `${String(Math.min(24, viewportStartHour + offset)).padStart(2, '0')}:00`
  const timelineMinuteLabel = (offsetMinutes: number) => {
    const minute = Math.min(24 * 60, viewportStartHour * 60 + offsetMinutes)
    return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
  }

  // Cálculo dinâmico da régua contínua e detecção de GAPs conforme o zoomMode
  const timelineData = useMemo(() => {
    const fps = rate.num / rate.den || 50
    const visibleFrames = visibleHours * 3600 * fps
    const viewportStartFrames = viewportStartHour * 3600 * fps
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

      const clippedStart = Math.max(start, viewportStartFrames)
      const clippedEnd = Math.min(end, viewportStartFrames + visibleFrames)
      const leftPct = Math.min(100, Math.max(0, ((clippedStart - viewportStartFrames) / visibleFrames) * 100))
      const widthPct = clippedEnd <= clippedStart ? 0 : Math.min(100 - leftPct, Math.max(0.18, ((clippedEnd - clippedStart) / visibleFrames) * 100))

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
        label: `${timelineLabel(0)}:00 - ${timelineLabel(visibleHours)}:00 (Grade Vazia)`,
      })
    } else {
      for (let i = 0; i < blocks.length - 1; i++) {
        const cur = blocks[i]!
        const next = blocks[i + 1]!
        if (next.start > cur.end + fps && cur.end < viewportStartFrames + visibleFrames && next.start > viewportStartFrames) {
          const gapStart = Math.max(cur.end, viewportStartFrames)
          const gapEnd = Math.min(next.start, viewportStartFrames + visibleFrames)
          const gapDur = gapEnd - gapStart
          const leftPct = Math.min(100, Math.max(0, ((gapStart - viewportStartFrames) / visibleFrames) * 100))
          const widthPct = Math.min(100 - leftPct, Math.max(0.2, (gapDur / visibleFrames) * 100))
          detectedGaps.push({
            start: gapStart,
            end: gapEnd,
            duration: gapDur,
            leftPct,
            widthPct,
            label: `${wallClock(gapStart, rate, activeView?.rundown.date)} - ${wallClock(gapEnd, rate, activeView?.rundown.date)}`,
          })
        }
      }
    }

    return { blocks, gaps: detectedGaps, totalFrames: totalDayFrames, visibleFrames }
  }, [displayItems, scheduleMap, rate, visibleHours, viewportStartHour])

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
      ? 'HOJE (GRADE EDITORIAL)'
      : selectedDate > todayDateIso
      ? 'FUTURO (PLANEJADO)'
      : 'DATA ANTERIOR (GRADE)'

  return (
    <div className="flex flex-col h-screen w-screen bg-surface-base text-on-surface select-none overflow-hidden font-sans">
      {metadataAssetId&&<AssetMetadataEditor key={metadataAssetId} assetId={metadataAssetId} categories={categorias.map(category=>category.id)} onCancel={()=>setMetadataAssetId(null)} onSaved={(result,message)=>{setMetadataOverrides(previous=>new Map(previous).set(result.assetId,result));setFeedbackMessage(message)}}/>}
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
      <main className="flex-1 flex flex-col min-h-0 bg-surface-base overflow-y-auto lg:overflow-hidden">
        <div className="shrink-0 px-3 pt-2 max-h-[45vh] overflow-y-auto"><SchedulePublicationPanel channelId={channel.id}/></div>
        {/* SUB-HEADER TÁTICO: Programação & Automação Linear */}
        <div className="bg-surface-container px-margin py-2 border-b border-border-subtle flex flex-wrap items-center justify-between gap-2 shadow-sm">
          <div className="flex flex-wrap items-center gap-space-sm">
            {mirror && <MirrorStatus channel={channel} mirror={mirror} channels={channels} onMessage={setFeedbackMessage} />}
            <div className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-accent-ice text-[18px]">splitscreen_left</span>
              <h1 className="font-headline-md text-headline-md text-on-surface uppercase tracking-wide">
                Programação &amp; Automação Linear
              </h1>
            </div>
            <div className="bg-surface-panel px-2.5 py-0.5 rounded border border-border-subtle text-[12px] font-mono flex items-center gap-1.5">
              <span className="text-outline">DATA ATIVA:</span>
              <strong className="text-primary font-bold">{selectedDateFormatted}</strong>
              <span className={`text-[11px] font-bold px-1.5 py-0.2 rounded ${
                selectedDate === todayDateIso ? 'bg-on-air-crimson text-white' : 'bg-surface-container text-accent-ice'
              }`}>
                {dateBadgeStatus}
              </span>
            </div>
            {/* Qual grade está no ar x qual está sendo editada: sem isto o operador
                editava 27/10 achando que mexia no que tocava (loop de 20/10). */}
            <div className={`px-2.5 py-0.5 rounded border text-[12px] font-mono flex items-center gap-1.5 ${isLoadedEditorial ? 'border-border-subtle bg-surface-panel' : 'border-armed-amber bg-armed-amber/10'}`} title={isLoadedEditorial ? 'Esta é a grade carregada no Master.' : 'Você edita outra grade; ela só vai ao ar depois de publicar/carregar no Master.'}>
              <span className="text-on-air-crimson font-bold">● NO AR:</span>
              <strong className="text-on-surface">{view.rundown.name}</strong>
              <span className="text-outline">{view.rundown.date ? view.rundown.date.split('-').reverse().slice(0, 2).join('/') : 'sem data'}{view.rundown.loop ? ' · loop' : ''}</span>
              {!isLoadedEditorial && <span className="text-armed-amber font-bold">· EDITANDO OUTRA GRADE</span>}
            </div>
          </div>
          <div className="flex items-center gap-space-md text-label-mono text-[11px]">
            <span className="text-outline">
              GRADE ATUAL: <strong className="text-on-surface font-bold">{displayItems.length} ITENS</strong>
            </span>
            {repeatRuns.length > 0 && <button type="button" onClick={() => setCollapseRepeats(value => !value)} className="px-2 py-0.5 rounded border border-accent-ice/40 text-accent-ice text-[11px]">
              {collapseRepeats ? 'Mostrar repetições' : 'Recolher repetições'}
            </button>}
            <span className="text-outline">•</span>
            <span className="text-outline">
              COBERTURA: <strong className="text-accent-ice-bright font-bold">{dur(totalDurationFrames, rate)}</strong>
            </span>
            <span className="text-outline">•</span>
            <span className="text-outline">
              LACUNAS: <strong className={timelineData.gaps.length > 0 ? 'text-armed-amber font-bold' : 'text-status-ok-bright font-bold'}>{timelineData.gaps.length}</strong>
            </span>
          </div>
        </div>

        {/* LAYOUT SPLIT-SCREEN 2 COLUNAS: 280px (~20%) + FLEX-1 (~80%) */}
        <div className="lg:flex-1 lg:min-h-0 p-margin flex flex-col lg:flex-row gap-gutter lg:overflow-hidden">
          {/* ========================================================
              COLUNA ESQUERDA (MAM LIBRARY & CALENDÁRIO)
              ======================================================== */}
          <aside className="w-full lg:w-[330px] xl:w-[360px] lg:flex-shrink-0 flex flex-col gap-space-sm h-[60vh] lg:h-auto overflow-hidden">
            {/* Seletor de Modo da Barra Lateral: [ 📁 BIBLIOTECA MAM ] [ 📅 CALENDÁRIO ] */}
            <div className="bg-surface-card rounded p-1 border border-border-subtle flex gap-1 shadow-sm shrink-0">
              <button
                type="button"
                onClick={() => setSidebarTab('mam')}
                className={`flex-1 py-1.5 px-2 rounded font-label-caps text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
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
                className={`flex-1 py-1.5 px-2 rounded font-label-caps text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
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
                    <span className="font-label-caps text-[11px] font-bold text-on-surface flex items-center gap-1">
                      <span className="material-symbols-outlined text-primary text-[15px]">perm_media</span>
                      ACERVO &amp; PROGRAMAÇÃO
                    </span>
                    <button
                      onClick={() => void openLiveProgram()}
                      className="px-2 py-0.5 rounded bg-on-air-crimson/20 hover:bg-on-air-crimson text-on-air-crimson hover:text-white font-label-caps text-[11px] font-bold border border-on-air-crimson/40 transition-colors flex items-center gap-1 cursor-pointer shadow-sm"
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
                      className={`px-2 py-0.5 rounded-full text-[11px] font-label-caps font-bold whitespace-nowrap transition-colors cursor-pointer border ${
                        selectedCategory === 'ALL'
                          ? 'bg-primary text-surface-base border-primary'
                          : 'bg-surface-base text-outline border-border-subtle hover:text-on-surface'
                      }`}
                    >
                      TODAS ({libraryLoaded ? allMamAssets.length : 'N/D'})
                    </button>
                    {availableCategoriesList.map((cat) => {
                      const isSel = selectedCategory === cat.id
                      return (
                        <button
                          key={cat.id}
                          onClick={() => setSelectedCategory(cat.id)}
                          className={`px-2 py-0.5 rounded-full text-[12px] font-label-mono whitespace-nowrap transition-colors cursor-pointer border flex items-center gap-1 ${
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

                {mamSelection.size>0&&(
                  <div role="region" aria-label="Categoria em lote" className="m-1 p-1.5 rounded border border-primary/50 bg-primary/10 flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="font-bold text-primary">{mamSelection.size} selecionado{mamSelection.size>1?'s':''}</span>
                    <input value={bulkCategory} onChange={event=>setBulkCategory(event.target.value)} list="bulk-category-options" maxLength={128} placeholder="Categoria (vazia remove)" disabled={bulkProgress!==null} className="flex-1 min-w-[120px] px-1.5 py-0.5 bg-surface-panel border border-border-subtle rounded"/>
                    <datalist id="bulk-category-options">{availableCategoriesList.filter(cat=>cat.id!=='ALL'&&cat.id!=='Sem Categoria').map(cat=><option key={cat.id} value={cat.id}/>)}</datalist>
                    <button type="button" disabled={bulkProgress!==null} className="px-2 py-0.5 rounded bg-primary text-surface-base font-bold disabled:opacity-50 cursor-pointer" onClick={()=>{
                      const ids=[...mamSelection]
                      setBulkProgress({done:0,total:ids.length})
                      void applyBulkCategory({assetMetadataReview:id=>api.assetMetadataReview(id),patchAssetMetadata:(id,body,review)=>api.patchAssetMetadata(id,body,review)},ids,bulkCategory,done=>setBulkProgress({done,total:ids.length}))
                        .then(result=>{
                          setMetadataOverrides(previous=>{const next=new Map(previous);for(const saved of result.saved)next.set(saved.assetId,saved);return next})
                          setFeedbackMessage(`Categoria gravada em ${result.saved.length} arquivo(s)`+(result.unchanged.length?`; ${result.unchanged.length} já estavam nela`:'')+(result.failed.length?`; ${result.failed.length} falharam (${result.failed[0]!.message})`:'')+'. Grade, PGM e PVW preservados.')
                          setMamSelection(new Set(result.failed.map(f=>f.id)))
                        })
                        .finally(()=>setBulkProgress(null))
                    }}>{bulkProgress?`Gravando ${bulkProgress.done}/${bulkProgress.total}…`:'Aplicar categoria'}</button>
                    <button type="button" disabled={bulkProgress!==null} className="px-2 py-0.5 rounded border border-border-subtle cursor-pointer" onClick={()=>{setMamSelection(new Set());mamAnchor.current=null}}>Limpar</button>
                    <span className="w-full text-outline text-[11px]">Clique seleciona · Ctrl+clique soma · Shift+clique seleciona intervalo</span>
                  </div>
                )}
                {/* Lista de Ativos do MAM Filtrados */}
                <div className="flex-1 divide-y divide-border-subtle/50 overflow-y-auto broadcast-scroll p-1 flex flex-col gap-1">
                  {filteredMamAssets.length === 0 ? (
                    <div className="p-6 text-center text-outline text-xs flex flex-col items-center justify-center gap-2">
                      <span className="material-symbols-outlined text-[28px] opacity-40">filter_alt_off</span>
                      <span>{libraryLoaded ? 'Nenhum ativo encontrado no MAM' : 'Acervo ainda não conferido; isso não confirma acervo vazio.'}</span>
                    </div>
                  ) : (
                    filteredMamAssets.map((asset) => {
                      const catName = asset.categoryId || 'Sem Categoria'
                      const catInfo = availableCategoriesList.find((c) => c.id === catName)
                      const catColor = catInfo?.color || '#389BFF'

                      return (
                        <div
                          key={`${asset.isLiveSource?'live':'asset'}:${asset.id}`}
                          onClick={(event) => {
                            if (asset.isLiveSource) { if (asset.sourceRef) onPreviewLiveSource?.(asset.sourceRef, asset.title); return }
                            const order=filteredMamAssets.filter(item=>!item.isLiveSource).map(item=>item.id)
                            setMamSelection(current=>nextSelection(current,order,asset.id,mamAnchor.current,{ctrl:event.ctrlKey||event.metaKey,shift:event.shiftKey}))
                            if(!event.shiftKey)mamAnchor.current=asset.id
                          }}
                          onDoubleClick={() => handleInsertFromMam(asset)}
                          onContextMenu={(event) => {
                            event.preventDefault()
                            setMamContextMenu({ asset, x: event.clientX, y: event.clientY })
                          }}
                          aria-selected={!asset.isLiveSource && mamSelection.has(asset.id)}
                          className={`bg-surface-panel/60 hover:bg-surface-panel px-2 h-7 rounded border transition-all cursor-pointer group flex items-center justify-between gap-1.5 ${
                            !asset.isLiveSource && mamSelection.has(asset.id) ? 'ring-1 ring-primary border-primary bg-primary/15 ' : ''}${
                            asset.ignored
                              ? 'border-error/40 opacity-60 bg-error/5'
                              : 'border-border-subtle/60 hover:border-primary/40'
                          }`}
                          title={asset.isLiveSource ? `${asset.title} • Clique para abrir no PVW; duplo clique para inserir na programação ativa` : `${asset.title} • Duplo clique para inserir na programação ativa`}
                        >
                          <div className="flex items-center gap-1.5 min-w-0 flex-1">
                            <span className="font-headline-sm text-[11px] font-medium text-on-surface truncate whitespace-nowrap group-hover:text-primary">
                              {asset.title}
                            </span>
                            {asset.isLiveSource && (
                              <span className="font-label-caps text-[11px] font-bold px-1 py-0.2 rounded border shrink-0 whitespace-nowrap text-accent-ice border-accent-ice/40 bg-accent-ice/10" title="Fonte ao vivo">{liveProtocolLabel((asset as any).sourceRef ?? asset.path)}</span>
                            )}
                            <span
                              className="font-label-caps text-[11px] font-bold px-1 py-0.2 rounded border shrink-0 whitespace-nowrap"
                              style={{
                                color: catColor,
                                borderColor: `${catColor}66`,
                                backgroundColor: `${catColor}15`,
                              }}
                            >
                              {catName}
                            </span>
                            {asset.ignored && (
                              <span className="font-label-caps text-[11px] font-bold px-1 py-0.2 rounded bg-error/20 text-error border border-error/40 shrink-0">
                                IGNORADO
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2 shrink-0 font-label-mono text-[12px] text-outline">
                            <span className="text-on-surface font-semibold tabular-nums">
                              {dur(durationIn(asset, rate), rate)}
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleInsertFromMam(asset)
                              }}
                              className="px-1.5 py-0.5 rounded bg-primary/20 hover:bg-primary text-primary hover:text-surface-base font-label-caps text-[11px] font-bold border border-primary/40 transition-colors flex items-center gap-0.5 cursor-pointer shadow-sm"
                              title="Inserir na grade do dia selecionado"
                            >
                              <span className="material-symbols-outlined text-[11px]">add</span>
                              <span>Inserir</span>
                            </button>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
                {mamContextMenu && (
                  <div className="fixed z-50 min-w-52 rounded border border-border-strong bg-surface-card p-1 shadow-xl text-body-sm" style={{ left: mamContextMenu.x, top: mamContextMenu.y }} role="menu">
                    {isCatalogMediaAsset(mamContextMenu.asset)?<>
                    <div className="px-2 py-1 text-[11px] font-label-caps text-outline">ACERVO COMPARTILHADO</div>
                    <button className="block w-full rounded px-2 py-1 text-left text-[11px] text-primary hover:bg-surface-panel cursor-pointer border-b border-border-subtle/50 pb-1.5 mb-1" onClick={()=>openMetadata(mamContextMenu.asset.id)}>Conferir título / categoria…</button>
                    {onRemoveAsset&&<button className="block w-full rounded px-2 py-1 text-left text-[11px] text-error hover:bg-surface-panel cursor-pointer" onClick={()=>{const id=mamContextMenu.asset.id;setMamContextMenu(null);onRemoveAsset(id)}}>Conferir remoção e vínculos…</button>}

                    <div className="px-2 py-1 text-[11px] font-label-caps text-outline">AÇÕES DE QC</div>
                    <button
                      className={`block w-full rounded px-2 py-1 text-left text-[11px] cursor-pointer font-medium ${
                        mamContextMenu.asset.ignored
                          ? 'text-status-ok hover:bg-status-ok/15'
                          : 'text-error hover:bg-error/15'
                      }`}
                      onClick={() => void toggleMamIgnored(mamContextMenu.asset)}
                    >
                      {mamContextMenu.asset.ignored ? '✓ Reativar Vídeo no MAM' : '🚫 Ignorar Vídeo (Ocultar)'}
                    </button>
                    </>:<>
                      <div className="px-2 py-1 text-[11px] font-label-caps text-outline">ENTRADA AO VIVO — NÃO É ARQUIVO DO ACERVO</div>
                      <button className="block w-full rounded px-2 py-1 text-left text-[11px] text-primary hover:bg-surface-panel cursor-pointer" onClick={()=>{setMamContextMenu(null);if(onOpenSettings)onOpenSettings();else onNavigate('settings')}}>Configurar entrada ao vivo…</button>
                    </>}
                  </div>
                )}

                {/* Rodapé da Biblioteca */}
                <div className="p-1.5 border-t border-border-subtle bg-surface-container-high font-label-mono text-[12px] text-outline flex items-center justify-between shrink-0">
                  <span className="whitespace-nowrap">{libraryLoaded ? `${filteredMamAssets.length} clipes` : 'Não conferido'}</span>
                  {onPruneAssets&&<button className="text-armed-amber cursor-pointer whitespace-nowrap" onClick={onPruneAssets} title="Conferir arquivos que podem ser removidos do acervo">Limpeza…</button>}
                  <span className="text-primary font-medium whitespace-nowrap" title="Duplo clique num clipe insere na grade">2× clique insere</span>
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
              <div className="bg-surface-panel/70 px-2 py-1 border-b border-border-subtle/50 flex items-center justify-between text-[12px] font-label-mono">
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
                  className="bg-surface-base border border-border-subtle rounded px-1 text-[12px] text-on-surface font-mono cursor-pointer"
                  title="Ir diretamente para uma data"
                />
              </div>

              {/* Matriz Mensal 7x5 com Alinhamento Real de Dias */}
              <div className="p-2 flex flex-col gap-1">
                <div className="grid grid-cols-7 text-center font-label-mono text-[12px] text-outline uppercase pb-1 border-b border-border-subtle/40">
                  <span>D</span><span>S</span><span>T</span><span>Q</span><span>Q</span><span>S</span><span>S</span>
                </div>

                <div className="grid grid-cols-7 gap-1 pt-1 text-center font-label-mono text-[12px]">
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
                            ? `Dia ${d} - HOJE (${hasRundown ? 'Grade Programada' : 'Sem Grade'})`
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
                <div className="mt-1 pt-1.5 border-t border-border-subtle/50 grid grid-cols-2 gap-1 text-[12px] font-label-mono text-outline">
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

              {visibleHours < 24 && (
                <label className="flex items-center gap-2 px-1 text-[12px] font-label-mono text-outline">
                  <span>JANELA {timelineLabel(0)}–{timelineLabel(visibleHours)}</span>
                  <input
                    aria-label="Deslizar janela da timeline"
                    className="flex-1 accent-primary"
                    type="range"
                    min="0"
                    max={24 - visibleHours}
                    step="1"
                    value={viewportStartHour}
                    onChange={(event) => setTimelineStartHour(Number(event.target.value))}
                  />
                  <span>{timelineLabel(0)}</span>
                </label>
              )}
            </div>

            {/* Resumo Tático do Dia Selecionado */}
            <div className="bg-surface-card rounded border border-border-subtle p-2.5 flex flex-col gap-2 shadow-md">
              <div className="flex items-center justify-between border-b border-border-subtle pb-1.5">
                <div className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-primary text-[16px]">fact_check</span>
                  <span className="font-label-caps text-[11px] text-on-surface font-bold">
                    RESUMO DO DIA ({selectedDateObj.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })})
                  </span>
                </div>
                <span className={`font-label-mono text-[12px] px-1 py-0.2 rounded font-bold ${
                  selectedDate === todayDateIso ? 'text-on-air-glow bg-on-air-crimson/20' : 'text-status-ok-bright bg-status-ok/15'
                }`}>
                  {dateBadgeStatus}
                </span>
              </div>

              {/* Indicador 1: Duração Total 24h */}
              <div className="bg-surface-panel p-1.5 rounded border border-border-subtle flex items-center justify-between">
                <span className="text-[11px] font-label-caps text-outline">TOTAL PREVISTO:</span>
                <span className="font-timecode-table text-[12px] text-on-surface font-bold">
                  {dur(totalDurationFrames, rate)}
                  {timelineData.gaps.length > 0 && (
                    <span className="text-armed-amber text-[11px] ml-1">
                      ({timelineData.gaps.length} gap)
                    </span>
                  )}
                </span>
              </div>

              {/* Não inferir cumprimento regulatório pela quantidade de itens. */}
              <div className="bg-surface-panel p-1.5 rounded border border-border-subtle flex flex-col gap-1">
                <div className="flex items-center justify-between text-[11px] font-label-caps">
                  <span className="text-outline">CONFERÊNCIA REGULATÓRIA:</span>
                  <span className="text-armed-amber font-bold font-label-mono">NÃO HOMOLOGADA</span>
                </div>
                <span className="text-[12px] font-label-mono text-outline">
                  Consulte a classificação da mídia e o relatório as-run. A quantidade de itens não comprova cota.
                </span>
              </div>

              {/* Indicador 3: Gaps Detectados */}
              {timelineData.gaps.length > 0 && (
                <div
                  onClick={() => handleOpenAutoFillForGap(timelineData.gaps[0])}
                  className="bg-armed-amber/15 border border-armed-amber/50 p-2 rounded flex items-center justify-between cursor-pointer hover:bg-armed-amber/25 transition-colors"
                  title="Abrir Auto-Fill para esta lacuna"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-armed-amber text-[16px]">warning</span>
                    <div className="flex flex-col">
                      <span className="font-label-caps text-[11px] text-armed-amber font-bold">GAPS DETECTADOS:</span>
                      <span className="font-label-mono text-[12px] text-on-surface font-bold">
                        {timelineData.gaps.length} GAP ({dur(timelineData.gaps[0]!.duration, rate)})
                      </span>
                    </div>
                  </div>
                  <span className="bg-armed-amber text-surface-base font-label-caps text-[11px] px-1 py-0.5 rounded font-bold">
                    RESOLVER
                  </span>
                </div>
              )}

              {/* Indicador 4: Comerciais & Breaks */}
              <div className="bg-surface-panel p-1.5 rounded border border-border-subtle flex items-center justify-between font-label-mono text-[12px]">
                <span className="text-outline">Comerciais na grade:</span>
                <span className="text-on-surface font-semibold">
                  {(() => {
                    const durations = displayItems.map((entry) => ({ entry, duration: Math.max(0, scheduleMap.get(entry.item.id)?.duration ?? entry.item.durationOverride ?? (entry.trim.out - entry.trim.in)) }))
                    const total = durations.reduce((sum, value) => sum + value.duration, 0)
                    const commercial = durations.filter(({ entry }) => /^(comerciais|commercials|break)$/i.test(entry.asset?.categoryId ?? '')).reduce((sum, value) => sum + value.duration, 0)
                    return total ? `${(commercial / total * 100).toFixed(1)}% da grade` : 'Sem duração calculada'
                  })()}
                </span>
              </div>
            </div>

            {/* Ações Rápidas do Dia */}
            <div className="bg-surface-card rounded border border-border-subtle p-2 flex flex-col gap-1.5">
              <button
                onClick={() => handleCopyGrid()}
                disabled={isLoadingDate}
                className="w-full flex items-center justify-center gap-1.5 bg-surface-panel hover:bg-surface-container text-on-surface border border-border-subtle py-1.5 rounded font-body-sm text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-50"
                title="Copiar a grade carregada ou selecionada para este dia"
              >
                <span className="material-symbols-outlined text-[15px] text-tertiary">content_copy</span>
                <span>Copiar Grade do Dia Anterior</span>
              </button>
              <button
                onClick={openOperationalReview}
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
          <section className="lg:flex-1 flex flex-col gap-space-sm min-w-0 min-h-[80vh] lg:min-h-0 overflow-hidden">
            {/* 1. TIMELINE CONTÍNUA DE 24 HORAS CONECTADA */}
            <div className="bg-surface-card rounded border border-border-subtle p-space-sm flex flex-col gap-1 shadow-md">
              <div className="flex flex-wrap items-center justify-between gap-1 border-b border-border-subtle/60 pb-1">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary text-[17px]">timeline</span>
                  <span className="font-label-caps text-[11px] text-on-surface font-bold tracking-wide">
                    TIMELINE CONTÍNUA 24H • DETECÇÃO DE GAPS &amp; PLAYHEAD AO VIVO
                  </span>
                  <span className="font-label-mono text-[12px] bg-surface-container px-2 py-0.5 rounded text-accent-ice font-bold border border-border-subtle">
                    {selectedDateFormatted}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {visibleHours < 24 && (
                    <div className="flex items-center gap-1.5 bg-surface-panel px-2 py-0.5 rounded border border-border-subtle font-label-mono text-[12px] text-outline">
                      <span className="text-[11px] font-bold text-accent-ice-bright">
                        {timelineLabel(0)} - {timelineLabel(visibleHours)}
                      </span>
                      <button
                        onClick={() => setTimelineStartHour((prev) => Math.max(0, prev - 1))}
                        disabled={viewportStartHour <= 0}
                        className="px-1 py-0.2 rounded hover:bg-surface-container text-on-surface disabled:opacity-30 cursor-pointer"
                        title="Recuar 1 hora"
                      >
                        ◀
                      </button>
                      <input
                        aria-label="Deslizar janela da timeline"
                        className="w-20 sm:w-28 accent-primary h-1.5 cursor-pointer"
                        type="range"
                        min="0"
                        max={24 - visibleHours}
                        step="1"
                        value={viewportStartHour}
                        onChange={(event) => setTimelineStartHour(Number(event.target.value))}
                      />
                      <button
                        onClick={() => setTimelineStartHour((prev) => Math.min(24 - visibleHours, prev + 1))}
                        disabled={viewportStartHour >= 24 - visibleHours}
                        className="px-1 py-0.2 rounded hover:bg-surface-container text-on-surface disabled:opacity-30 cursor-pointer"
                        title="Avançar 1 hora"
                      >
                        ▶
                      </button>
                    </div>
                  )}

                  <div className="bg-surface-panel rounded p-0.5 border border-border-subtle flex items-center gap-0.5 text-[12px] font-label-mono">
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
              <div className="relative h-4 w-full flex text-[12px] font-label-mono text-outline select-none px-1 border-b border-border-subtle/30">
                {[0, 1, 2, 3, 4, 5, 6].map((tick) => (
                  <span
                    key={tick}
                    className={`absolute ${tick === 3 ? 'font-bold text-accent-ice' : ''}`}
                    style={{ left: `${(tick / 6) * 100}%`, transform: tick === 6 ? 'translateX(-100%)' : undefined }}
                  >
                    {zoomMode === '1h'
                      ? timelineMinuteLabel(tick * 10)
                      : timelineLabel((visibleHours / 6) * tick)}
                  </span>
                ))}
              </div>

              {/* Trilho de Blocos 24h & Playhead Dinâmico */}
              <div className="relative h-9 w-full bg-[#050912] rounded border border-border-subtle/70 overflow-hidden flex items-center shadow-inner">
                {/* Blocos de Eventos Programados */}
                {timelineData.blocks.filter((block) => block.widthPct > 0).map((block) => (
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
                    title={`${itemDisplayTitle(block.item)} (${dur(block.duration, rate)})`}
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
                    <span className="text-[12px] font-label-mono truncate px-0.5 text-white/90 drop-shadow">
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
                    title={`LACUNA: ${gap.label} (${dur(gap.duration, rate)} sem programação). Clique para opções ou duplo clique para AutoFill imediato.`}
                    className="absolute top-0 bottom-0 bg-armed-amber/30 border-2 border-dashed border-armed-amber animate-pulse cursor-pointer hover:bg-armed-amber/50 z-10 flex items-center justify-center shadow-[0_0_10px_rgba(255,149,0,0.5)]"
                  >
                    <span className="text-[11px] font-label-caps text-armed-amber font-bold tracking-tighter uppercase px-0.5 bg-[#050912]/80 rounded">
                      LACUNA {dur(gap.duration, rate)}
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
                        <span className="font-label-caps text-[11px] text-armed-amber font-bold tracking-wide">
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
                    <div className="flex items-center justify-between text-[12px] font-label-mono text-outline">
                      <span>Horário: <strong className="text-on-surface">{selectedGap.label}</strong></span>
                      <span className="text-armed-amber font-bold">(-{dur(selectedGap.duration, rate)})</span>
                    </div>
                    <button
                      onClick={() => {
                        handleOpenAutoFillForGap(selectedGap)
                        setShowGapPopover(false)
                      }}
                      className="w-full bg-armed-amber hover:bg-armed-glow text-surface-base px-2 py-1.5 rounded font-label-caps text-[11px] font-bold flex items-center justify-center gap-1.5 shadow-[0_0_8px_#FF9500] transition-all cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[14px]">auto_fix_high</span>
                      ⚡ AUTOFILL INTELIGENTE (1-CLIQUE)
                    </button>
                  </div>
                )}
              </div>

              {/* Legenda de Cores da Linha do Tempo */}
              <div className="flex flex-wrap items-center justify-between gap-1 pt-1 border-t border-border-subtle/40 text-[12px] font-label-mono text-outline">
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
                <button type="button" disabled={!activeView} className="btn small" onClick={()=>setShowProtectedZones(true)}>ZONAS PROTEGIDAS ({activeView?.rundown.protectedZones?.length ?? 0})</button>
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
                        <span className="font-label-caps text-[11px] text-on-surface font-bold uppercase">
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
                        <span className="text-[11px] text-outline">Excel / LibreOffice</span>
                      </button>
                    </div>
                  )}
                </div>

                <button
                  onClick={() => handleOpenAutoFill()}
                  className="flex items-center gap-1 bg-surface-panel hover:bg-surface-container text-on-surface border border-border-subtle px-2 py-1 rounded font-body-sm text-[11px] transition-colors cursor-pointer"
                  title="Propor arquivos do acervo para preencher lacunas"
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
                  onClick={() => void openLiveProgram()}
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
                  onClick={openOperationalReview}
                  disabled={isPublishingOperational || !activeView?.rundown.id || (isLoadedEditorial && !canPublish)}
                  title={isLoadedEditorial && !canPublish ? deniedReason('publicar a grade') : undefined}
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
                      : isPublishingOperational
                      ? 'PUBLICANDO REVISÃO…'
                      : isLoadedEditorial
                      ? 'PUBLICAR REVISÃO'
                      : `CARREGAR ${selectedDate} NO MASTER`}
                  </span>
                </button>
                {operationalRevision !== null && (
                  <span className="font-label-mono text-[12px] text-status-ok-bright" title="Fotografia imutável da grade e do timing publicada para auditoria">
                    REV. {operationalRevision}
                  </span>
                )}
                <button onClick={openOperationalReview} className="px-2 py-1.5 rounded border border-border-subtle text-[11px] text-on-surface hover:bg-surface-panel" title="Comparar a grade editorial, consultar histórico e restaurar revisões">Revisões</button>
              </div>
            </div>

            {/* 3. GRADE DE EXIBIÇÃO COMPACTA 24H (TABELA OU CARD DE PLANEJAMENTO SE VAZIA) */}
            <div className="flex-1 bg-surface-card rounded border border-border-subtle shadow-md overflow-hidden flex flex-col min-h-[380px]">
              <div className="grid grid-cols-12 bg-surface-container-high px-3 py-1.5 font-label-caps text-[11px] text-outline uppercase tracking-wider border-b border-border-subtle items-center select-none sticky top-0 z-10">
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
                <div className="col-span-2">Horário previsto</div>
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
                          <span className="text-[11px] text-outline">Duplica a grade carregada no Master</span>
                        </div>
                      </button>

                      <button
                        onClick={handleCreateBlankGrid}
                        className="p-3 bg-surface-panel hover:bg-surface-container border border-border-subtle hover:border-accent-ice/50 rounded flex items-center gap-2.5 text-left transition-colors cursor-pointer group"
                      >
                        <span className="material-symbols-outlined text-accent-ice text-[22px] group-hover:scale-110 transition-transform">post_add</span>
                        <div className="flex flex-col">
                          <span className="font-bold text-xs text-on-surface">Criar Grade em Branco</span>
                          <span className="text-[11px] text-outline">Começar grade limpa do zero</span>
                        </div>
                      </button>

                      <button
                        onClick={handleAddItem}
                        className="p-3 bg-surface-panel hover:bg-surface-container border border-border-subtle hover:border-tertiary/50 rounded flex items-center gap-2.5 text-left transition-colors cursor-pointer group"
                      >
                        <span className="material-symbols-outlined text-tertiary text-[22px] group-hover:scale-110 transition-transform">upload_file</span>
                        <div className="flex flex-col">
                          <span className="font-bold text-xs text-on-surface">Importar M3U / BXF</span>
                          <span className="text-[11px] text-outline">Carregar playlist pronta de arquivo</span>
                        </div>
                      </button>

                      <button
                        onClick={() => handleOpenAutoFill()}
                        className="p-3 bg-surface-panel hover:bg-surface-container border border-border-subtle hover:border-armed-amber/50 rounded flex items-center gap-2.5 text-left transition-colors cursor-pointer group"
                      >
                        <span className="material-symbols-outlined text-armed-amber text-[22px] group-hover:scale-110 transition-transform">auto_fix_high</span>
                        <div className="flex flex-col">
                          <span className="font-bold text-xs text-on-surface">Auto-Fill EPG Linear</span>
                          <span className="text-[11px] text-outline">Preencher dia via catálogo MAM</span>
                        </div>
                      </button>
                    </div>
                  </div>
                ) : (
                  visibleRows.map((row) => {
                    if ('summary' in row) {
                      const last = displayItems[row.lastIndex]
                      const lastEnd = last ? scheduleMap.get(last.item.id)?.end : undefined
                      return (
                        <button key={`repeat-${row.summary.start}`} type="button" onClick={() => setCollapseRepeats(false)}
                          className="w-full px-3 py-1.5 text-left text-[12px] bg-accent-ice/10 hover:bg-accent-ice/20 border-y border-accent-ice/30 text-accent-ice font-label-mono">
                          ↻ Sequência de {row.summary.period} {row.summary.period === 1 ? 'item' : 'itens'} repete mais {row.summary.repeats - 1}× ({row.hidden} linhas){lastEnd != null ? ` até ${wallClock(lastEnd, rate, activeView?.rundown.date)}` : ''} · mostrar tudo
                        </button>
                      )
                    }
                    const idx = row.index
                    const item = displayItems[idx]!
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
                        className={`grid grid-cols-12 px-2.5 py-1 items-center text-[11px] transition-colors group cursor-pointer select-none leading-tight ${
                          isSelected
                            ? 'bg-primary-container/25 border-l-4 border-primary font-medium text-white shadow-inner'
                            : 'bg-surface-card hover:bg-surface-panel'
                        }`}
                      >
                        <div className="col-span-1 font-label-mono text-[12px] flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {}}
                            className="w-3 h-3 rounded border border-border-subtle bg-surface-base text-primary cursor-pointer pointer-events-none"
                          />
                          <span className="text-outline">{idx + 1}</span>
                        </div>
                        <div className="col-span-2 flex items-center gap-1 flex-wrap">
                          <span className="px-1 py-0.2 rounded font-label-caps text-[11px] bg-surface-container font-semibold text-primary">
                            {item.asset?.kind ?? item.item.type ?? 'VT'}
                          </span>
                          {item.asset?.categoryId && (() => {
                            const catName = item.asset.categoryId
                            const catInfo = availableCategoriesList.find((c) => c.id === catName)
                            const catColor = catInfo?.color || '#389BFF'
                            return (
                              <span
                                className="px-1 py-0.2 rounded font-label-caps text-[11px] font-bold border truncate max-w-[80px]"
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
                        <div className="col-span-2 font-label-mono text-[14px] tabular-nums text-on-surface">
                          {scheduleMap.get(item.item.id)?.start != null
                            ? wallClock(scheduleMap.get(item.item.id)!.start, rate, activeView?.rundown.date)
                            : '--:--:--:--'}
                        </div>
                        <div className="col-span-2 font-label-mono text-[14px] tabular-nums text-outline">
                          {dur(durationFrames, rate)}
                        </div>
                        <div className="col-span-4 font-body-sm text-[13px] truncate text-on-surface">
                          {item.asset?.title || item.item.title || item.item.id}
                        </div>
                        <div className="col-span-1 text-right">
                          <span title={item.asset?.probeError ?? item.asset?.qcNotes ?? (item.asset ? 'Estado de QC do arquivo' : 'O cadastro não comprova sinal da fonte')} className={`font-label-mono text-[12px] font-bold ${item.asset?.probeError || item.asset?.qcStatus === 'REJECTED' || item.asset?.ignored ? 'text-error' : qcApproved(item.asset?.qcStatus) ? 'text-status-ok-bright' : 'text-armed-amber'}`}>
                            {item.asset?.probeError || item.asset?.ignored ? 'INDISPONÍVEL' : !item.asset ? (item.item.type === 'LIVE' ? 'AO VIVO' : 'SEM ARQUIVO') : item.asset.qcStatus === 'APPROVED_WITH_NOTES' ? 'QC RESSALVA' : qcApproved(item.asset.qcStatus) ? 'QC OK' : item.asset.qcStatus === 'REJECTED' ? 'REJEITADO' : item.asset.qcStatus === 'BLOCKED' ? 'BLOQUEADO' : item.asset.qcStatus === 'ANALYSIS' ? 'EM ANÁLISE' : 'QC PEND.'}
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
                    <span className="font-label-caps text-[11px] text-accent-ice font-bold uppercase bg-accent-ice/20 px-2 py-0.5 rounded border border-accent-ice/30">
                      MULTISSELEÇÃO ATIVA
                    </span>
                    <span className="font-bold text-on-surface">
                      {selectedItemIds.size} itens selecionados
                    </span>
                    <span className="font-label-mono text-[12px] text-outline">
                      Duração somada: <strong className="text-primary">{dur(selectedTotalDurationFrames, rate)}</strong>
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSelectedItemIds(new Set())}
                      className="px-2.5 py-1 rounded bg-surface-panel hover:bg-surface-container border border-border-subtle text-outline hover:text-on-surface font-label-caps text-[11px] cursor-pointer transition-colors"
                    >
                      Desmarcar Todos (Esc)
                    </button>

                    <button
                      disabled={isBulkDeleting}
                      onClick={handleBulkRemove}
                      className="px-2.5 py-1 rounded bg-error-container/30 hover:bg-error-container text-on-error-container font-label-caps text-[11px] flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-50"
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
                      <span className="font-label-caps text-[11px] text-primary font-bold uppercase bg-primary/20 px-2 py-0.5 rounded border border-primary/30">
                        ITEM SELECIONADO
                      </span>
                      <span className="font-bold text-on-surface truncate max-w-sm">
                        {selectedItem.asset?.title || selectedItem.item.title || selectedItem.item.id}
                      </span>
                      <span className="font-label-mono text-[12px] text-outline">
                        {dur(durationFrames, rate)}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {selectedItem.asset && (
                        <div className="flex items-center gap-1 bg-surface-panel px-2 py-1 rounded border border-border-subtle">
                          <span className="material-symbols-outlined text-[14px] text-primary">label</span>
                          <span className="text-[11px] text-outline font-label-caps font-semibold">Categoria:</span>
                          <button onClick={()=>openMetadata(selectedItem.asset!.id)} className="bg-transparent text-on-surface text-[12px] font-label-mono font-bold outline-none cursor-pointer">Conferir / editar…</button>
                        </div>
                      )}

                      <button
                        onClick={() => openEditScheduleTime(selectedItem)}
                        className="px-2.5 py-1 rounded bg-surface-panel hover:bg-surface-container border border-border-subtle text-primary hover:text-white font-label-caps text-[11px] flex items-center gap-1 cursor-pointer transition-colors"
                        title="Configurar entrada fixa (HH:MM:SS) ou fluxo sequencial e duração"
                      >
                        <span className="material-symbols-outlined text-[14px]">schedule</span>
                        Horário de Entrada
                      </button>
                      {onOpenTrim && (
                        <button
                          onClick={() => onOpenTrim(selectedItem)}
                          className="px-2.5 py-1 rounded bg-surface-panel hover:bg-surface-container border border-border-subtle text-outline hover:text-on-surface font-label-caps text-[11px] flex items-center gap-1 cursor-pointer transition-colors"
                        >
                          <span className="material-symbols-outlined text-[14px]">content_cut</span>
                          Editar Trim
                        </button>
                      )}
                      {onOpenAudio && (
                        <button
                          onClick={() => onOpenAudio(selectedItem)}
                          className="px-2.5 py-1 rounded bg-surface-panel hover:bg-surface-container border border-border-subtle text-outline hover:text-on-surface font-label-caps text-[11px] flex items-center gap-1 cursor-pointer transition-colors"
                        >
                          <span className="material-symbols-outlined text-[14px]">volume_up</span>
                          Áudio
                        </button>
                      )}
                      {onRemoveItem && (
                        <button
                          onClick={() => handleRemoveItem(selectedItem.item.id)}
                          className="px-2.5 py-1 rounded bg-error-container/30 hover:bg-error-container text-on-error-container font-label-caps text-[11px] flex items-center gap-1 cursor-pointer transition-colors"
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

      {showOperationalReview && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <section role="dialog" aria-modal="true" aria-labelledby="operational-review-title" className="bg-surface-card border border-border-subtle rounded-lg shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
            <header className="p-4 border-b border-border-subtle flex shrink-0 items-center justify-between">
              <h2 id="operational-review-title" className="font-bold text-on-surface">Publicação e revisões operacionais</h2>
              <button aria-label="Fechar revisões" disabled={isPublishingOperational} onClick={closeOperationalReview} className="px-3 py-1 text-outline">✕</button>
            </header>
            <div className="p-4 min-h-0 overflow-auto space-y-4 text-sm text-on-surface">
              <p>A edição da grade não muda a execução publicada. Confira as diferenças antes de criar uma revisão. Outra data só pode ser carregada com o PGM parado.</p>
              {isLoadingOperational && <p role="status">Calculando timing e comparando versões…</p>}
              {isRefreshingEditorial && <p role="status">Atualizando a grade para nova conferência…</p>}
              {isInspectingRollback && <p role="status">Conferindo a revisão para restauração…</p>}
              {operationalReviewError && <p role="alert" className="text-error bg-error-container/20 p-3 rounded">{operationalReviewError}</p>}
              {operationalSimulation && <>
                <p>{operationalSimulation.activeRevision === null ? 'Ainda não há revisão publicada.' : `Revisão publicada: ${operationalSimulation.activeRevision}.`} {operationalSimulation.differences.added.length} inclusão(ões), {operationalSimulation.differences.removed.length} remoção(ões), {operationalSimulation.differences.changed.length} alteração(ões).</p>
                <ul className="max-h-48 overflow-auto space-y-1 text-xs">
                  {operationalSimulation.differences.added.map(id => <li key={`add-${id}`} className="text-status-ok-bright">+ {operationalSimulation.simulated.items.find(item => item.id === id)?.title ?? id}</li>)}
                  {operationalSimulation.differences.removed.map(id => <li key={`remove-${id}`} className="text-error">− Item removido: {id}</li>)}
                  {operationalSimulation.differences.changed.map(change => <li key={change.itemId}>{operationalSimulation.simulated.items.find(item => item.id === change.itemId)?.title ?? change.itemId}: {change.fields.join(', ')}</li>)}
                  {operationalSimulation.differences.graphicsChanged?.map(id => <li key={`graphics-${id}`}>{operationalSimulation.simulated.items.find(item => item.id === id)?.title ?? id}: grafismo/deixa alterado — só passa à execução após publicar.</li>)}
                  {operationalSimulation.differences.timingPolicyChanged && <li className="text-armed-amber">Zonas protegidas alteradas — só passam à execução após publicar.</li>}
                </ul>
                <p className={operationalSimulation.simulated.schedule.conflicts.length ? 'text-armed-amber' : 'text-status-ok-bright'}>{operationalSimulation.simulated.schedule.conflicts.length} conflito(s) de timing na simulação. A publicação não elimina esses conflitos.</p>
                <ul className="space-y-1 text-xs text-armed-amber">{operationalSimulation.simulated.schedule.conflicts.map((conflict, index) => <li key={index}>{conflict.message}</li>)}</ul>
              </>}
              <h3 className="font-bold">Histórico preservado</h3>
              <div className="flex flex-col gap-2">
                {!isLoadingOperational && !operationalReviewError && operationalSimulation && !operationalRevisions.length && <p className="text-outline">Nenhuma publicação registrada nesta conferência.</p>}
                {operationalRevisions.map(revision => <div key={revision.id} className="flex items-center justify-between gap-3 p-2 border border-border-subtle rounded">
                  <div><strong>Rev. {revision.revision}{revision.active ? ' · Publicada' : ''}</strong><p className="text-xs text-outline">{new Date(revision.publishedAt).toLocaleString('pt-BR')} · {revision.publishedBy ?? 'Operação local'}</p></div>
                  {!revision.active && <button disabled={isPublishingOperational || isInspectingRollback || isRefreshingEditorial || isLoadingOperational || Boolean(operationalReviewError)} onClick={() => void handleOperationalRollback(revision)} className="px-3 py-1 rounded border border-armed-amber text-armed-amber disabled:opacity-40">Restaurar</button>}
                </div>)}
              </div>
            </div>
            <footer className="p-4 border-t border-border-subtle flex shrink-0 justify-end gap-3">
              <button disabled={isPublishingOperational || isInspectingRollback || isRefreshingEditorial || isLoadingOperational} onClick={() => void refreshOperationalReview()} className="px-3 py-2 border border-border-subtle rounded text-on-surface">Atualizar e conferir</button>
              <button disabled={isPublishingOperational || isInspectingRollback || isRefreshingEditorial || isLoadingOperational || !publicationReady || Boolean(operationalReviewError)} onClick={() => void handlePublish()} className="px-3 py-2 bg-primary text-surface-base rounded font-bold disabled:opacity-40">{isPublishingOperational ? 'Publicando…' : 'Publicar e sincronizar Master'}</button>
            </footer>
          </section>
        </div>
      )}

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
                <span className="text-[11px] font-label-caps text-outline uppercase">Item Selecionado</span>
                <span className="font-semibold text-on-surface truncate text-xs bg-surface-panel p-2 rounded border border-border-subtle">
                  {editingTimeItem.asset?.title || editingTimeItem.item.title || editingTimeItem.item.id}
                </span>
              </div>

              {/* Modo de Entrada: FLOW vs FIXED */}
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-label-caps text-outline uppercase">Modo de Agendamento</span>
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
                    <span className="text-[11px] opacity-80">Entra após item anterior</span>
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
                    <span className="font-bold text-xs">Horário fixo</span>
                    <span className="text-[11px] opacity-80">Entra pontualmente no horário</span>
                  </button>
                </div>
              </div>

              {timeAnchorKind === 'FIXED' && (
                <div className="flex flex-col gap-1.5 p-3 rounded bg-armed-amber/10 border border-armed-amber/30">
                  <label className="text-[11px] font-label-caps text-armed-amber font-bold uppercase flex items-center gap-1">
                    <span className="material-symbols-outlined text-[13px]">alarm</span>
                    Horário de Início (HH:MM:SS)
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={timeInputHms}
                      onChange={(e) => setTimeInputHms(e.target.value)}
                      placeholder="HH:MM:SS"
                      aria-invalid={parseHms(timeInputHms) === null}
                      className={`flex-1 bg-surface-base border rounded px-2.5 py-1.5 font-label-mono text-sm text-on-surface focus:outline-none focus:border-armed-amber ${parseHms(timeInputHms) === null ? 'border-error' : 'border-border-subtle'}`}
                    />
                    <button type="button" onClick={() => { setTimeInputHms(nowHms(new Date(), 1)); setTimeInputDay('today') }}
                      className="px-2 py-1 rounded border border-border-subtle bg-surface-panel text-[11px] text-outline hover:text-on-surface cursor-pointer">Agora</button>
                  </div>
                  <div className="flex gap-1.5" role="group" aria-label="Dia">
                    {(['today','tomorrow'] as const).map((d) => (
                      <button key={d} type="button" onClick={() => setTimeInputDay(d)}
                        className={`flex-1 px-2 py-1 rounded border text-[11px] cursor-pointer ${timeInputDay === d ? 'border-armed-amber bg-armed-amber/15 text-armed-amber' : 'border-border-subtle bg-surface-panel text-outline hover:text-on-surface'}`}>
                        {d === 'today' ? 'Hoje' : 'Amanhã'}
                      </button>
                    ))}
                  </div>
                  {parseHms(timeInputHms) === null && <span className="text-[11px] text-error">Use HH:MM:SS, de 00:00:00 a 23:59:59.</span>}
                  <span className="text-[11px] text-outline">
                    A exibição aguardará pontualmente este horário para disparar o VT/Evento.
                  </span>
                </div>
              )}

              {/* Duração Estimada / Override (Minutos) */}
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-label-caps text-outline uppercase flex items-center justify-between">
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
      {rollbackReview&&<OperationalRollbackDialog inspection={rollbackReview.inspection} onClose={()=>{if(!operationalBusy.current)setRollbackReview(null)}} onApply={applyOperationalRollback}/>}
      {showProtectedZones && activeView && <ProtectedTimingZonesDialog key={activeView.rundown.id} rundown={activeView.rundown} rate={rate} editorialRevision={activeView.editorialRevision} onClose={()=>setShowProtectedZones(false)} onSaved={snapshot=>{if (isLoadedEditorial) onPublishToMaster(snapshot); else setDateRundownView(snapshot.view); setOperationalRefresh(value=>value+1);setShowProtectedZones(false)}} />}
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
              {liveProgramPreset
                ? <div className="text-[12px] text-outline">Fonte: <span className="font-label-mono text-on-surface">{liveProgramSourceRef}</span></div>
                : <CanonicalProtocolSelector mode="INPUT" defaultKind="NDI" onChange={selectLiveProgramInput} />}
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-label-caps text-outline uppercase font-semibold">Início</label>
                <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Início do ao vivo">
                  {([['NOW','Agora','Entra já no ar'],['FIXED','Horário fixo','Entra no horário marcado'],['FLOW','Após o anterior','Segue a fila']] as const).map(([mode,label,hint]) => (
                    <button key={mode} type="button" onClick={() => setLiveProgramStart(mode)}
                      className={`p-2 rounded border text-left flex flex-col gap-0.5 cursor-pointer ${liveProgramStart === mode ? 'border-error bg-error/10 text-on-surface' : 'border-border-subtle bg-surface-panel text-outline hover:text-on-surface'}`}>
                      <span className="font-bold text-xs">{label}</span><span className="text-[11px] opacity-80">{hint}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-label-caps text-outline uppercase font-semibold">
                  Título do Programa / Evento
                </label>
                <input
                  type="text"
                  value={liveProgramTitle}
                  onChange={(e) => { setLiveProgramTitle(e.target.value); setLiveProgramNameEdited(Boolean(e.target.value.trim())) }}
                  placeholder="Nome da entrada selecionada acima"
                  className="w-full bg-surface-base border border-border-subtle rounded px-2.5 py-1.5 text-xs text-on-surface focus:outline-none focus:border-primary"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-label-caps text-outline uppercase font-semibold">
                    Horário de Início (HH:MM:SS)
                  </label>
                  <input
                    type="text"
                    value={liveProgramStart === 'NOW' ? nowHms() : liveProgramTimeHms}
                    disabled={liveProgramStart !== 'FIXED'}
                    onChange={(e) => setLiveProgramTimeHms(e.target.value)}
                    placeholder="HH:MM:SS"
                    aria-invalid={liveProgramStart === 'FIXED' && parseHms(liveProgramTimeHms) === null}
                    className={`w-full bg-surface-base border rounded px-2.5 py-1.5 font-label-mono text-xs text-on-surface focus:outline-none focus:border-primary disabled:opacity-50 ${liveProgramStart === 'FIXED' && parseHms(liveProgramTimeHms) === null ? 'border-error' : 'border-border-subtle'}`}
                  />
                  {liveProgramStart === 'FIXED' && <>
                  <div className="flex gap-1.5" role="group" aria-label="Dia">
                    {(['today','tomorrow'] as const).map((d) => (
                      <button key={d} type="button" onClick={() => setLiveProgramDay(d)}
                        className={`flex-1 px-2 py-1 rounded border text-[11px] cursor-pointer ${liveProgramDay === d ? 'border-armed-amber bg-armed-amber/15 text-armed-amber' : 'border-border-subtle bg-surface-panel text-outline hover:text-on-surface'}`}>
                        {d === 'today' ? 'Hoje' : 'Amanhã'}
                      </button>
                    ))}
                  </div></>}
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-label-caps text-outline uppercase font-semibold">
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
                disabled={isCreatingLive || !liveProgramInputValid || !liveProgramTitle.trim() || !liveProgramSourceRef.trim() || (liveProgramStart === 'FIXED' && parseHms(liveProgramTimeHms) === null)}
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
