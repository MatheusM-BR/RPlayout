import { masterDeleteAllowed } from '../domain/key-guards'
import { loudnessTone, loudnessToneClass } from '../domain/loudness-tone.js'
import { confirmAction, notify } from '../domain/confirm.js'
import { useChannelMirror } from '../domain/use-channel-mirror.js'
import { finalCount, gradeEndWarning, mmss, nextFixedCommitment, countdownText } from '../domain/broadcast-cues.js'
import { beep, enableAlarmSound } from '../domain/alarm-sound.js'
import { MirrorStatus } from '../components/MirrorStatus.js'
import { deniedReason, useCan } from '../domain/permissions.js'
import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { wallClock, localDateKey, gradeInstant } from '../domain/wall-clock.js'
import {itemDisplayTitle} from '../domain/item-title.js'
import type { Channel, ManagedLiveSource, PreviewTarget, ScheduleEventType, TimingFlags,LiveSourceReview,RootCatalogReview,RootAddReview } from '@rplayout/protocol'
import { qcApproved,programDurationFrames,durationIn } from '@rplayout/protocol'
import { clock, dur, formatStandardRate } from '../format.js'
import {PreviewFrameStatus} from '../components/broadcast/PreviewFrameStatus.js'
import type {
  Categoria,
  ItemView,
  LibraryAsset,
  LibraryFolder,
  Live,
  MediaRoot,
  ServerFolderBrowser,
  Monitors as MonitorFeeds,
  RundownView,
  ScanStatus,
} from '../types.js'
import type { WorkspaceId } from '../components/WorkspaceShell.js'
import { api } from '../api.js'
import {commandRequestId} from '../domain/request-id.js'
import { canonicalLiveSourceRef, liveDefaultFrames, liveProtocolLabel, sameLiveSource } from '../liveSource.js'
import { LiveReplacementControl } from '../components/LiveReplacementControl.js'
import { Whep } from '../components/Whep.js'
import { BroadcastHeader } from '../components/broadcast/BroadcastHeader.js'
import { BroadcastMonitor } from '../components/broadcast/BroadcastMonitor.js'
import { PgmProbeBanner } from '../components/broadcast/PgmProbeBanner.js'
import { InterruptedItemsBanner } from '../components/broadcast/InterruptedItemsBanner.js'
import { MasterToolsPanel } from '../components/broadcast/MasterToolsPanel.js'
import { useStoredChoice } from '../domain/stored-choice.js'
import { useEscape } from '../domain/use-escape.js'
import { AlignmentDialog, FocusCard, computeFocus, useFocusItem } from '../components/FocusAlignment.js'
import { MultiTrackTimeline } from '../components/broadcast/MultiTrackTimeline.js'
import { ConflictDrawer } from '../components/broadcast/ConflictDrawer.js'
import { CanonicalProtocolSelector } from '../components/broadcast/CanonicalProtocolSelector.js'
import type { ProtocolResult } from '../components/broadcast/CanonicalProtocolSelector.js'
import { inputName } from '../components/broadcast/protocol-config.js'

interface Props {
  channel: Channel
  channels: Channel[]
  view: RundownView
  live: Live
  folders: LibraryFolder[]
  libraryLoaded?: boolean
  scan: ScanStatus | null
  categorias: Categoria[]
  monitors: MonitorFeeds | null
  followOnAir: boolean
  onToggleFollowOnAir: () => void
  onTake: (itemId?: string) => void
  /** TAKE of a live open only in PVW: insert after the item on air, then TAKE. */
  onTakeLive?: (sourceRef: string, title: string) => void
  onStop: () => void
  onCue: (itemId: string) => void
  /** Último comando de transporte recusado pelo servidor/engine (mensagem perto dos botões). */
  transportRefusal?: { action: string; message: string; at: number } | null
  onDismissTransportRefusal?: () => void
  onClearCue: () => void
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
  onBulkRemoveItems?: (ids: string[]) => void
  onMoveItem: (itemId: string, toIndex: number) => void
  onOpenAlerts: () => void
  onOpenSettings: () => void
  problemasCount: number
  sessionRole: string
  authRequired: boolean
  onNavigate: (workspace: WorkspaceId) => void
  onSelectChannel: (channelId: string) => void
  onPreviewAsset: (asset: LibraryAsset) => void
  /** Abre uma entrada de rede no PVW sem inventá-la como arquivo MAM. */
  onPreviewLiveSource: (sourceRef: string, title: string) => void
  onInsertAsset: (
    assetId: string | null,
    atIndex?: number,
    liveConfig?: { sourceRef: string; title: string; durationOverride?: number },
    options?: {
      eventType?: ScheduleEventType
      timingFlags?: TimingFlags
    },
  ) => void
  onOpenLiveInput?: () => void
  /** Bloqueia cliques e teclas de operação nesta estação. */
  onLockPanel?: () => void
}

export interface CustomLiveSource {
  id: string
  title: string
  sourceRef: string
  family: 'SDI' | 'NDI' | 'SRT' | 'RTMP' | 'OMT' | 'WEBRTC'
  durationFrames: number
}

const getItemDuration = (item: ItemView | null | undefined): number => {
  if (!item) return 0
  if (item.trim) return Math.max(0, item.trim.out - item.trim.in)
  return item.item?.durationOverride ?? item.asset?.durationFrames ?? 0
}

/** Library rows carry the probed length in ns; `durationFrames` is a legacy
 * field (0 for every probed file), so the MAM list showed 00:00 for all. */
export function libraryFrames(asset:{durationNs?:number|null;durationFrames:number},rate:{num:number;den:number}):number{
  return durationIn({durationNs:asset.durationNs??null,durationFrames:asset.durationFrames},rate)
}

/** U4: a mesma origem cadastrada por vários protocolos (ex.: saída do vMix em
 * OMT, NDI e SRT) vira uma linha com um selo por entrada. */
export function groupLiveVariants<T extends { id: string; title: string }>(assets: readonly T[]): Array<{ asset: T; variants: T[] }> {
  const groups: Array<{ asset: T; variants: T[] }> = []
  const byTitle = new Map<string, { asset: T; variants: T[] }>()
  for (const asset of assets) {
    const live = 'isLiveSource' in asset && Boolean((asset as { isLiveSource?: boolean }).isLiveSource)
    if (!live) { groups.push({ asset, variants: [asset] }); continue }
    const key = asset.title.trim().toLowerCase()
    const group = byTitle.get(key)
    if (group) group.variants.push(asset)
    else { const created = { asset, variants: [asset] }; byTitle.set(key, created); groups.push(created) }
  }
  return groups
}

/** Why TAKE is unavailable, shown next to the button instead of a silent no-op. */
export function takeBlockedReason(publicationRequired:boolean,preview:unknown,gradeSourceRefs?:readonly string[]):string|null{
  if(publicationRequired)return 'TAKE bloqueado: publique a grade revisada em PLAYLIST.'
  if(!preview)return 'TAKE indisponível: nada armado no PVW. Clique num item da grade (CUE) primeiro.'
  // The server only puts on air what is in the grade (as-run, recovery).
  // A live opened from the library is preview-only until inserted.
  const source=(preview as {kind?:string;source?:string}).kind==='SOURCE'?(preview as {source?:string}).source:undefined
  if(source&&gradeSourceRefs&&!gradeSourceRefs.includes(source))return 'TAKE indisponível: esta entrada ao vivo está só no PVW e não está na grade. Insira-a na grade (Inserir na Biblioteca) e faça CUE na linha dela.'
  return null
}
/** Live in PVW that is not a grade line: TAKE inserts it after the item on air. */
export function liveOutsideGrade(preview:unknown,gradeSourceRefs:readonly string[]):{source:string;title:string}|null{
  const value=preview as {kind?:string;source?:string;title?:string}|null
  if(value?.kind!=='SOURCE'||!value.source||gradeSourceRefs.includes(value.source))return null
  return {source:value.source,title:value.title||value.source}
}

export function MasterControlView({
  channel,
  channels,
  view,
  live,
  folders,
  libraryLoaded = true,
  scan,
  categorias,
  monitors,
  followOnAir,
  onToggleFollowOnAir,
  onTake,
  onTakeLive,
  onStop,
  onCue,
  transportRefusal = null,
  onDismissTransportRefusal,
  onClearCue,
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
  onBulkRemoveItems,
  onMoveItem,
  onOpenAlerts,
  onOpenSettings,
  problemasCount,
  sessionRole,
  authRequired,
  onNavigate,
  onSelectChannel,
  onPreviewAsset,
  onPreviewLiveSource,
  onInsertAsset,
  onOpenLiveInput,
  onLockPanel,
}: Props) {
  const publicationRequired=Boolean(view.rundown.publicationRequired)
  // MAM filter & search states
  const [mamSearch, setMamSearch] = useState('')
  const [selectedTag, setSelectedTag] = useState<'TODOS' | 'VT' | 'AO VIVO'>('TODOS')
  const [transitionMode, setTransitionMode] = useState<'CUT' | 'MIX' | 'WIPE'>('CUT')
  const [adjustingLive, setAdjustingLive] = useState(false)
  const liveAdjustmentLock=useRef(false)
  const canStop = useCan('CHANNEL_STOP')
  const mirror = useChannelMirror(channel.id)
  const [liveAdjustOpen, setLiveAdjustOpen] = useState(false)
  const [pendingLiveAdjustment,setPendingLiveAdjustment]=useState<{channelId:string;body:Parameters<typeof api.adjustLiveDuration>[1]}|null>(null)
  const submitLiveAdjustment=async(operation:{channelId:string;body:Parameters<typeof api.adjustLiveDuration>[1]})=>{
    try{
      const result=await api.adjustLiveDuration(operation.channelId,operation.body)
      setPendingLiveAdjustment(null)
      setLiveTimingMessage(result.refreshError??`Duração ajustada; revisão ${result.revision}${result.deduplicated?' (solicitação já aplicada)':''}. Conflitos recalculados.`)
    }catch(error){setLiveTimingMessage(`${error instanceof Error?error.message:'Resposta não confirmada.'} Reenvie a mesma solicitação para conferir, sem aplicar o ajuste duas vezes.`)}
    finally{liveAdjustmentLock.current=false;setAdjustingLive(false)}
  }
  const [liveTimingMessage, setLiveTimingMessage] = useState<string | null>(null)

  // Drag & drop dropzone target
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  // Modais de Ingestão e Adição de Linha
  const [liveInputModalOpen, setLiveInputModalOpen] = useState(false)
  const [addLineModalOpen, setAddLineModalOpen] = useState(false)
  const [folderModalOpen, setFolderModalOpen] = useState(false)

  // Fase E: Alternância entre Grade Linear e Timeline Visual Multicamada 24H
  const viewMode = 'LINEAR' as 'LINEAR' | 'TIMELINE'

  // Fase E: Gaveta lateral interativa de Conflitos e Gaps (Conflict Drawer)
  const [isConflictDrawerOpen, setIsConflictDrawerOpen] = useState(false)

  // Multiseleção na playlist (Ctrl / Shift)
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set())
  const lastClickedIndexRef = useRef<number | null>(null)

  // Gerenciamento de Pastas do Acervo MAM
  const [mamRoots, setMamRoots] = useState<MediaRoot[]>([])
  const [serverBrowser, setServerBrowser] = useState<ServerFolderBrowser | null>(null)
  const [newFolderPath, setNewFolderPath] = useState('')
  const [newFolderLabel, setNewFolderLabel] = useState('')
  const [isFolderLoading, setIsFolderLoading] = useState(false)
  const [folderActionMsg, setFolderActionMsg] = useState<string | null>(null)
  const [folderReview,setFolderReview]=useState<RootCatalogReview|null>(null),[folderAddReview,setFolderAddReview]=useState<RootAddReview|null>(null)
  const folderPending=useRef(false),folderEpoch=useRef(0),folderLive=useRef(true)
  useEffect(()=>{folderLive.current=true;return()=>{folderLive.current=false;++folderEpoch.current}},[])
  const folderCurrent=(run:number)=>folderLive.current&&folderEpoch.current===run

  const loadMamRoots = async () => {
    const run=folderEpoch.current
    try {
      const res = await api.rootCatalogReview()
      if(folderCurrent(run)){setMamRoots(res.roots);setFolderReview(res)}
    } catch (err) {
      if(folderCurrent(run)){setFolderReview(null);setFolderActionMsg('Lista indisponível; não é confirmação de lista vazia. '+String(err))}
    }
  }

  useEffect(() => {
    ++folderEpoch.current;setFolderReview(null);setFolderAddReview(null);folderPending.current=false;setIsFolderLoading(false)
    if (!folderModalOpen) return
    void loadMamRoots()
    void browseServerFolders()
  }, [folderModalOpen])

  const browseServerFolders = async (path?: string) => {
    if(folderPending.current)return
    folderPending.current=true;const run=folderEpoch.current
    setIsFolderLoading(true)
    setFolderActionMsg('Lendo pastas no servidor...')
    try {
      const browser = await api.browseMediaRoot(path)
      if(!folderCurrent(run))return
      setServerBrowser(browser)
      setFolderAddReview(null)
      setNewFolderPath(browser.path)
      setFolderActionMsg('Escolha uma pasta neste painel. A navegação ocorre no servidor do playout.')
    } catch (err: any) {
      if(folderCurrent(run))setFolderActionMsg(`Erro: ${err.message}`)
    } finally {
      if(folderCurrent(run)){folderPending.current=false;setIsFolderLoading(false)}
    }
  }

  const handleAddFolderManual = async () => {
    const path = newFolderPath.trim()
    if (!path||!folderAddReview||folderPending.current) return
    folderPending.current=true;const run=folderEpoch.current
    setIsFolderLoading(true)
    setFolderActionMsg('Cadastrando pasta...')
    try {
      const label = newFolderLabel.trim() || undefined
      const res = await api.addMediaRoot(path, label,folderAddReview)
      if(!folderCurrent(run))return
      setFolderActionMsg(res.scanBatchId?`Pasta "${res.root.label}" cadastrada. Pedido ${res.scanBatchId}: ${res.scanState}. ${res.scanError??'Registro não significa leitura concluída.'}`:`Pasta "${res.root.label}" cadastrada. ${res.scanError??'Sonda indisponível; procure quando estiver disponível.'}`)
      setFolderAddReview(null);setFolderReview(res.review);setMamRoots(res.review.roots)
      setNewFolderPath('')
      setNewFolderLabel('')
    } catch (err: any) {
      if(folderCurrent(run)){setFolderActionMsg(`Erro: ${err.message}. Campos preservados; confira novamente.`);setFolderAddReview(null);setFolderReview(null)}
    } finally {
      if(folderCurrent(run)){folderPending.current=false;setIsFolderLoading(false)}
    }
  }

  const conferFolderAdd = async () => {
    if(folderPending.current)return
    folderPending.current=true;setIsFolderLoading(true);const run=folderEpoch.current
    try{const review=await api.rootAddReview(newFolderPath);if(folderCurrent(run)){setFolderAddReview(review);setFolderReview(review);setMamRoots(review.roots);setFolderActionMsg('Pasta e lista conferidas. Confirme o cadastro; qualquer alteração posterior será recusada.')}}
    catch(cause){if(folderCurrent(run)){setFolderAddReview(null);setFolderActionMsg(String(cause))}}
    finally{if(folderCurrent(run)){folderPending.current=false;setIsFolderLoading(false)}}
  }

  const handleRemoveFolder = async (root: MediaRoot) => {
    if(!folderReview||folderPending.current)return
    if (!(await confirmAction(`Remover pasta "${root.label}" do acervo? Os arquivos já na grade continuam.`))) return
    setIsFolderLoading(true)
    folderPending.current=true;const run=folderEpoch.current
    try {
      const result=await api.removeMediaRoot(root.id,folderReview)
      if(!folderCurrent(run))return
      setFolderReview(result.review);setMamRoots(result.review.roots);setFolderAddReview(null)
      setFolderActionMsg(`Pasta "${root.label}" removida.`)
    } catch (err: any) {
      if(folderCurrent(run)){setFolderActionMsg(`Erro: ${err.message}. Reabra a conferência.`);setFolderReview(null);setFolderAddReview(null)}
    } finally {
      if(folderCurrent(run)){folderPending.current=false;setIsFolderLoading(false)}
    }
  }

  // O MAM só mostra entradas efetivamente cadastradas para o canal. Não há
  // fontes demonstrativas nem cache local que possa divergir das Configurações.
  const [customSources, setCustomSources] = useState<CustomLiveSource[]>([])
  const [sourceListReview,setSourceListReview]=useState<LiveSourceReview|null>(null)
  const [sourceFormReview,setSourceFormReview]=useState<LiveSourceReview|null>(null)
  const [sourceSaveBusy,setSourceSaveBusy]=useState(false)
  const [sourceSaveMessage,setSourceSaveMessage]=useState<string|null>(null)
  const [sourceNeedsReopen,setSourceNeedsReopen]=useState(false)
  const sourcePending=useRef(false),sourceGeneration=useRef(0),sourceChannel=useRef(channel.id),sourceMounted=useRef(true)
  sourceChannel.current=channel.id
  useEffect(()=>{sourceMounted.current=true;return()=>{sourceMounted.current=false;sourceGeneration.current++}},[])
  const loadLiveSources = async () => {
    const run=++sourceGeneration.current,id=channel.id
    const review = await api.liveSourceReview(id)
    if(!sourceMounted.current||sourceChannel.current!==id||run!==sourceGeneration.current)return
    setSourceListReview(review)
    const sources=review.sources
    const defaultDuration = liveDefaultFrames(rate)
    setCustomSources(sources.filter((source) => source.enabled).map((source: ManagedLiveSource) => ({
      id: source.id,
      title: source.name,
      sourceRef: canonicalLiveSourceRef(source),
      family: source.kind,
      durationFrames: defaultDuration,
    })))
    return review
  }
  useEffect(() => {
    setCustomSources([]);setSourceListReview(null);setSourceFormReview(null)
    void loadLiveSources().catch(() => {if(sourceMounted.current&&sourceChannel.current===channel.id)setCustomSources([])})
  }, [channel.id])

  const saveCustomSource = async (source: Omit<CustomLiveSource, 'id'>) => {
    if(sourcePending.current||sourceNeedsReopen)throw new Error('Confira novamente a lista antes de salvar.')
    sourcePending.current=true;setSourceSaveBusy(true)
    const id=channel.id
    try{
    const created = await api.createLiveSource({
      channelId: channel.id,
      name: source.title,
      kind: source.family === 'WEBRTC' ? 'RTMP' : source.family,
      targetUrl: source.sourceRef,
    },sourceFormReview)
    if(!sourceMounted.current||sourceChannel.current!==id)return
    setSourceSaveMessage(created.refreshError??'Cadastro gravado; não houve CUE ou TAKE automático.')
    setSourceFormReview(null);setSourceNeedsReopen(true)
    setCustomSources((previous) => [...previous, { ...source, id: created.id, sourceRef: canonicalLiveSourceRef(created) }])
    // Refresh only the list; never replace the proof attached to another draft.
    await loadLiveSources().catch(()=>setSourceSaveMessage('Cadastro gravado; falha ao atualizar a lista. Reabra antes de repetir.'))
    }catch(error){
      if(sourceMounted.current&&sourceChannel.current===id){setSourceNeedsReopen(true);setSourceSaveMessage(error instanceof Error?error.message:'Cadastro não confirmado. Rascunho preservado.')}
      throw error
    }finally{sourcePending.current=false;if(sourceMounted.current&&sourceChannel.current===id)setSourceSaveBusy(false)}
  }

  // Estados locais dos modais de Ingestão e Linha
  const [newLiveTitle, setNewLiveTitle] = useState('')
  const [newLiveNameEdited, setNewLiveNameEdited] = useState(false)
  const [newLiveValid, setNewLiveValid] = useState(false)
  const [newLiveFamily, setNewLiveFamily] = useState<CustomLiveSource['family']>('NDI')
  const [newLiveRef, setNewLiveRef] = useState('')
  const [newLiveDurationMin, setNewLiveDurationMin] = useState(15)
  const selectNewLiveInput = useCallback((result: ProtocolResult) => {
    setNewLiveRef(result.targetUri)
    setNewLiveFamily(result.kind as CustomLiveSource['family'])
    setNewLiveValid(result.isHardwareValid)
    setNewLiveTitle((current) => inputName(current, result.nameRecommendation, newLiveNameEdited))
  }, [newLiveNameEdited])
  const resetLiveInput = () => {
    setNewLiveTitle(''); setNewLiveNameEdited(false); setNewLiveRef(''); setNewLiveValid(false)
    setNewLiveFamily('NDI')
    setSourceFormReview(sourceListReview);setSourceNeedsReopen(false);setSourceSaveMessage(null)
  }
  const reopenSourceList=async()=>{
    if(sourcePending.current||!(await confirmAction('Descartar o rascunho de entrada e conferir novamente a lista?')))return
    resetLiveInput();setSourceFormReview(null);setSourceNeedsReopen(true)
    try{
      const next=await loadLiveSources()
      if(next){setSourceFormReview(next);setSourceNeedsReopen(false);setSourceSaveMessage('Lista conferida. Selecione a entrada novamente; não houve CUE/TAKE.')}
    }catch{setSourceSaveMessage('Falha ao consultar as entradas. Nenhuma ação enviada.')}
  }

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
  const [lineConfigError,setLineConfigError]=useState<string|null>(null)

  const handleOpenAddLine = () => {
    resetLiveInput()
    setEditingItemView(null)
    setLineEventType('SEQUENTIAL')
    setLineTrimmable(false)
    setLineOptional(false)
    setLineProtected(false)
    setAddLineModalOpen(true)
  }

  const handleOpenEditLine = (item: ItemView) => {
    setEditingItemView(item)
    setLineConfigError(null)
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
    setLineConfigError(null)
    setIsSavingLineConfig(true)
    try {
      await api.patchItem(editingItemView.item.id, {
        eventType: lineEventType,
        timingFlags: {
          trimmable: lineTrimmable,
          optional: lineOptional,
          protected: lineProtected,
        },
      },editingItemView.editorialRevision)
      setAddLineModalOpen(false)
      setEditingItemView(null)
    } catch (err) {
      setLineConfigError(err instanceof Error?err.message:'Não foi possível salvar a edição. Seus campos continuam neste formulário.')
    } finally {
      setIsSavingLineConfig(false)
    }
  }

  // Trava de segurança PGM e Operador

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

  // Esc desarma o ABORT sem parar o canal.
  useEffect(() => {
    if (!abortArmed) return
    const onEsc = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (abortTimerRef.current) window.clearInterval(abortTimerRef.current)
      setAbortArmed(false)
      setAbortCountdown(3)
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [abortArmed])

  // Item no ar e próximo item preparado. "Próximo" é pré-roll automático;
  // CUE é a escolha explícita do operador para o PVW.
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

  const cueItem = useMemo(() => {
    const preview = live.transport.preview as PreviewTarget | null
    return preview?.kind === 'ITEM'
      ? view.items.find((item) => item.item.id === preview.id) ?? null
      : null
  }, [live.transport.preview, view.items])

  const cuedIndex = useMemo(() => {
    if (!cueItem) return -1
    return view.items.findIndex((item) => item.item.id === cueItem.item.id)
  }, [cueItem, view.items])

  // Biblioteca recolhível ao lado da grade (U1); a escolha fica nesta estação.
  const [mamPanel, setMamPanel] = useStoredChoice<'open' | 'closed'>('rplayout.master.mam', ['open', 'closed'], typeof window !== 'undefined' && window.innerWidth < 1536 ? 'closed' : 'open')
  const mamOpen = mamPanel === 'open'

  // Seleção direta de preview (via MAM ou grade)
  const [selectedPreviewAsset, setSelectedPreviewAsset] = useState<LibraryAsset | null>(null)

  // Monitoramento de áudio mutuamente exclusivo (PGM ou PVW, nunca os dois juntos)
  const [activeAudioBus, setActiveAudioBus] = useState<'pgm' | 'pvw' | null>(null)

  const confirmedPreview = live.transport.preview as PreviewTarget | null
  const activePreviewAsset = confirmedPreview?.kind === 'ASSET'
    ? (selectedPreviewAsset?.id === confirmedPreview.id ? selectedPreviewAsset : folders.flatMap((folder) => folder.assets).find((asset) => asset.id === confirmedPreview.id) ?? null)
    : cueItem?.asset ?? null
  /**
   * Uma fonte direta não tem asset MAM nem item preparado. O motor, porém,
   * está efetivamente com ela no PVW. Nunca derive o nome do cartão somente
   * da grade, pois isso fazia o Master dizer "Nenhum item armado" enquanto o
   * monitor já mostrava a fonte ao vivo.
   */
  const transportPreview = live.transport.preview as PreviewTarget | null
  const directPreview = transportPreview?.kind === 'SOURCE' ? transportPreview : null
  const previewTitle = activePreviewAsset?.title ?? cueItem?.item.title ?? armedItem?.item.title ?? directPreview?.title ?? directPreview?.source ?? 'Nenhum item armado'
  // "Encontrada na rede" não significa "com sinal". O selo vem apenas do
  // engine depois de CUE/TAKE e evita que o operador confunda descoberta com
  // quadro utilizável.
  const previewSourceRef = directPreview?.source ?? cueItem?.item.sourceRef ?? null
  const previewSignal = previewSourceRef
    ? live.transport.liveSources.find((signal) => sameLiveSource(signal.source, previewSourceRef)) ?? null
    : null
  const previewSignalState = previewSignal?.busStates?.pvw ?? previewSignal?.state
  const previewSignalLabel: Record<NonNullable<typeof previewSignal>['state'], string> = {
    IDLE: 'NÃO SINTONIZADA',
    CUEING: 'ABRINDO SINAL',
    PVW_READY: 'SINAL NO PVW',
    TAKE_PENDING: 'AGUARDANDO TAKE',
    ON_PGM: 'SINAL NO PGM',
    LOST: 'SINAL PERDIDO',
    FAILED: 'FALHA NA FONTE',
  }
  const previewKind = activePreviewAsset?.kind ?? (cueItem?.item.type === 'LIVE' || directPreview ? 'AO VIVO' : armedItem?.asset?.kind ?? 'COMERCIAL')
  const activePreviewDuration = selectedPreviewAsset
    ? libraryFrames(selectedPreviewAsset, channel.rate)
    : cueItem
    ? getItemDuration(cueItem)
    : 0
  // Cartão PRÓXIMO: sem CUE, mostra o item que o automático vai preparar
  // (antes ficava "Duração 00:00" e "Formato N/D" com o próximo já conhecido).
  const nextCardItem = selectedPreviewAsset ? null : cueItem ?? (directPreview ? null : armedItem)
  const nextCardAsset = activePreviewAsset ?? nextCardItem?.asset ?? null
  const nextCardDuration = activePreviewDuration || (nextCardItem ? getItemDuration(nextCardItem) : 0)
  const nextCardFormat = nextCardAsset?.probe?.height && nextCardAsset.probe.rate
    ? formatStandardRate(nextCardAsset.probe.rate, nextCardAsset.probe.interlaceMode === 'interleaved' ? 'INTERLACED' : 'PROGRESSIVE', nextCardAsset.probe.height)
    : nextCardItem?.item.type === 'LIVE' || directPreview
    ? 'FORMATO: CONFERIDO NO CUE'
    : nextCardAsset ? 'FORMATO: ARQUIVO SEM ANÁLISE' : 'FORMATO: —'

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
      if(!publicationRequired)onCue(item.item.id)
    }
  }

  const handleBulkDelete = async () => {
    if (selectedItemIds.size === 0) return
    const ids = Array.from(selectedItemIds)
    if (!(await confirmAction(`Deseja remover os ${ids.length} itens selecionados da grade?`))) return
    if (onBulkRemoveItems) {
      onBulkRemoveItems(ids)
    } else {
      for (const id of ids) {
        onRemoveItem(id)
      }
    }
    setSelectedItemIds(new Set())
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const element = e.target as HTMLElement | null
      const typing = element?.matches('input, select, textarea') || element?.isContentEditable
      if (typing) return
      const dialogOpen = Boolean(document.querySelector('[role="dialog"], [aria-modal="true"]'))
      const panelLocked = document.documentElement.dataset.panelLock === 'on'

      if (e.key === 'Delete' && selectedItemIds.size > 0 && masterDeleteAllowed(e, element, panelLocked, dialogOpen)) {
        e.preventDefault()
        handleBulkDelete()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedItemIds, onBulkRemoveItems, onRemoveItem])

  const handleMamPreview = (asset: LibraryAsset) => {
    if ('isLiveSource' in asset && asset.isLiveSource) {
      setSelectedPreviewAsset(null)
      onPreviewLiveSource((asset as LibraryAsset & { sourceRef?: string }).sourceRef ?? asset.path, asset.title)
      return
    }
    setSelectedPreviewAsset(asset)
    onPreviewAsset(asset)
  }

  // Latência medida de verdade: clique no TAKE até o servidor confirmar outro
  // item no ar (o que o operador espera). Não é latência da saída/codec.
  const takeClickRef = useRef<{ at: number; from: string | null } | null>(null)
  const [lastTake, setLastTake] = useState<{ ms: number; at: Date } | null>(null)
  const onAirKey = live.transport.onAir ? `${live.transport.onAir.itemId}:${live.transport.onAir.startedAt}` : null
  useEffect(() => {
    const click = takeClickRef.current
    if (!click || onAirKey === click.from) return
    const ms = performance.now() - click.at
    takeClickRef.current = null
    if (ms < 15_000) setLastTake({ ms: Math.round(ms), at: new Date() })
  }, [onAirKey])

  // TAKE pelo Espaço (tratado no App) também conta para a medição.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const element = event.target as HTMLElement | null
      if (event.code !== 'Space' || event.repeat || element?.matches('input, select, textarea') || element?.isContentEditable) return
      if (live.transport.preview && !publicationRequired) takeClickRef.current = { at: performance.now(), from: onAirKey }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [live.transport.preview, publicationRequired, onAirKey])

  const handleTake = () => {
    if (publicationRequired || !live.transport.preview) return
    takeClickRef.current = { at: performance.now(), from: onAirKey }
    const outside = onTakeLive ? liveOutsideGrade(live.transport.preview, view.items.map((entry) => entry.item.sourceRef).filter((ref): ref is string => Boolean(ref))) : null
    if (outside) onTakeLive!(outside.source, outside.title)
    else onTake()
  }

  // Mapa de horários resolvidos
  const scheduleMap = useMemo(() => {
    return new Map(view.schedule?.items?.map((it) => [it.id, it]) ?? [])
  }, [view.schedule])
  const nextCardSchedule = nextCardItem ? scheduleMap.get(nextCardItem.item.id) : undefined
  const nextCardFrames = nextCardDuration || (nextCardSchedule?.start != null && nextCardSchedule.end != null ? Math.max(0, nextCardSchedule.end - nextCardSchedule.start) : 0)

  // Cálculo de temporizações e quadros
  const rate = channel.rate
  const fps = rate.num / rate.den
  const onAirDurationFrames = programDurationFrames(live.transport.onAir,getItemDuration(onAirItem))
  const elapsedFrames = live?.transport?.onAir?.elapsed ?? 0
  const remainingFrames = Math.max(0, onAirDurationFrames - elapsedFrames)
  // Passou da duração prevista (live com saída manual, duração estimada curta):
  // contar para cima em âmbar em vez de ficar parado em 00:00.
  const overrunFrames = onAirItem && onAirDurationFrames > 0 ? Math.max(0, elapsedFrames - onAirDurationFrames) : 0
  // Contagem final (convenção de master control): âmbar nos últimos 10 s e
  // piscando nos últimos 5 s do item no ar (itens de 30 s ou mais).
  const finalCountState = onAirItem ? finalCount(remainingFrames, fps, Boolean(live?.transport.playing), overrunFrames, onAirDurationFrames) : null
  // Fim da grade sem loop: aviso nos últimos 15 min (depois disso o canal só
  // segue se houver próxima grade publicada com passagem automática).
  const gradeEndMs = !view.rundown.loop && view.schedule && Number.isFinite(view.schedule.endsAt) ? gradeInstant(view.schedule.endsAt, rate, view.rundown.date).getTime() : null
  // Relógio de 1 s para as contagens de parede andarem mesmo com o PGM parado.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => { const timer = window.setInterval(() => setNowMs(Date.now()), 1000); return () => window.clearInterval(timer) }, [])
  const gradeEnd = onAirItem ? gradeEndWarning(gradeEndMs, nowMs) : null
  // Próximo compromisso de horário (leilão com hora marcada, rede): quando
  // entra e se a grade resolvida vai bater o horário.
  const nextFixed = useMemo(() => nextFixedCommitment(
    view.items.map(entry => ({ id: entry.item.id, title: entry.item.title, anchor: entry.item.anchor as { kind: string; at?: number } })),
    scheduleMap,
    frames => gradeInstant(frames, rate, view.rundown.date).getTime(),
    nowMs,
  ), [view.items, scheduleMap, rate, view.rundown.date, nowMs])
  const nextFixedLate = nextFixed && (!nextFixed.hit || nextFixed.deviationMs >= 1000)
  // Foco de contagem: item escolhido com o botão direito; mostra quando entra
  // e se a grade chega no horário, com ALINHAR para preencher ou cortar.
  const [focus, setFocus] = useFocusItem(channel.id)
  const focusState = useMemo(() => computeFocus(view, focus, nowMs), [view, focus, nowMs])
  const focusOnAir = Boolean(focusState && live?.transport.onAir?.itemId === focusState.itemId)
  const [alignOpen, setAlignOpen] = useState(false)
  const [rowMenu, setRowMenu] = useState<{ x: number; y: number; itemId: string; title: string } | null>(null)
  useEscape(Boolean(rowMenu), () => setRowMenu(null))
  useEffect(() => {
    if (!rowMenu) return
    const close = () => setRowMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    return () => { window.removeEventListener('click', close); window.removeEventListener('scroll', close, true) }
  }, [rowMenu])
  // ALINHAR sem nada a calcular: explica em vez de abrir o painel.
  useEffect(() => {
    if (!alignOpen || !focusState || focusState.mode === 'FILL' || focusState.mode === 'CUT') return
    setAlignOpen(false)
    void notify(focusState.mode === 'OK' ? 'A grade já chega no horário deste item.' : 'Este item não tem horário marcado. Informe um alvo (hh:mm:ss) no cartão FOCO para calcular o alinhamento.', 'Alinhar')
  }, [alignOpen, focusState])
  // Foco some quando o item sai da grade ou já passou pelo ar.
  useEffect(() => {
    if (!focus) return
    const index = view.items.findIndex(entry => entry.item.id === focus.itemId)
    if (index < 0 || (onAirIndex >= 0 && index < onAirIndex)) setFocus(null)
  }, [focus, view.items, onAirIndex]) // eslint-disable-line react-hooks/exhaustive-deps
  const focusWhole = focusState && !focusOnAir ? Math.ceil(focusState.leftMs / 1000) : null
  // Esc fecha os modais do Master com a mesma regra do clique fora.
  useEscape(liveInputModalOpen, () => { if (!sourcePending.current) setLiveInputModalOpen(false) })
  useEscape(addLineModalOpen, () => { setAddLineModalOpen(false); setEditingItemView(null) })
  useEscape(folderModalOpen, () => setFolderModalOpen(false))
  const [soundChoice, setSoundChoice] = useStoredChoice('rplayout:master-sound', ['on', 'off'] as const, 'off')
  const [soundReady, setSoundReady] = useState(false)
  const soundOn = soundChoice === 'on' && soundReady
  const toggleSound = () => {
    if (soundOn) { setSoundChoice('off'); return }
    if (enableAlarmSound()) { setSoundReady(true); setSoundChoice('on'); beep(660, 80) }
  }
  // Escolha salva mas áudio ainda não liberado (recarregou a página): o primeiro clique libera.
  useEffect(() => {
    if (soundChoice !== 'on' || soundReady) return
    const unlock = () => { if (enableAlarmSound()) setSoundReady(true) }
    window.addEventListener('pointerdown', unlock, { once: true })
    return () => window.removeEventListener('pointerdown', unlock)
  }, [soundChoice, soundReady])
  const remainingWhole = Math.ceil(remainingFrames / fps)
  useEffect(() => { if (soundOn && finalCountState === 'last5') beep(remainingWhole <= 1 ? 1320 : 880, remainingWhole <= 1 ? 300 : 100) }, [soundOn, finalCountState, remainingWhole])
  const fixedWhole = nextFixed ? Math.ceil(nextFixed.leftMs / 1000) : null
  useEffect(() => { if (soundOn && fixedWhole !== null && fixedWhole <= 10 && fixedWhole > 0) beep(fixedWhole <= 3 ? 1320 : 990, 90) }, [soundOn, fixedWhole])
  const gradeEndLevel = gradeEnd?.level ?? null
  useEffect(() => { if (soundOn && gradeEndLevel === 'urgent') { beep(520, 250); window.setTimeout(() => beep(520, 250), 350) } }, [soundOn, gradeEndLevel])
  useEffect(() => { if (soundOn && focusWhole !== null && focusWhole <= 10 && focusWhole > 0) beep(focusWhole <= 3 ? 1480 : 1100, 90) }, [soundOn, focusWhole])
  const progressPercent =
    onAirDurationFrames > 0 ? Math.min(100, Math.round((elapsedFrames / onAirDurationFrames) * 100)) : 0

  // Scroll automático para o item no ar se o bloqueio followOnAir estiver habilitado
  const gridContainerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!followOnAir || onAirIndex < 0 || !gridContainerRef.current) return
    const rowHeight = 40
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
      qcStatus: 'APPROVED' as const,
      qcNotes: null,
      qcCheckedAt: null,
      thumbnailUrl: '',
      createdAt: new Date().toISOString(),
      isLiveSource: true,
      sourceRef: cs.sourceRef,
      family: cs.family,
    }))
    // The playout library offers only what can go on air: VTs approved by
    // the QC for this channel (no probe error) and registered live inputs.
    // Pending/failed files stay in the QC queue, not in the Master's MAM.
    const airable=allAssets.filter((asset)=>qcApproved(asset.qcStatus)&&!asset.probeError)
    return [...airable, ...liveAsAssets]
  }, [allAssets, customSources])

  const gradeSourceRefs=useMemo(()=>view.items.map(entry=>entry.item.sourceRef).filter((ref):ref is string=>Boolean(ref)),[view.items])
  const takeLive=onTakeLive?liveOutsideGrade(live.transport.preview,gradeSourceRefs):null
  const takeReason=takeLive?(publicationRequired?takeBlockedReason(publicationRequired,live.transport.preview):null):takeBlockedReason(publicationRequired,live.transport.preview,gradeSourceRefs)
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
      // JORNAL saiu: era só "jornal" no nome, não uma categoria do acervo.
      if (selectedTag === 'AO VIVO') return Boolean(isLive)
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
    peakDbfs: [-90, -90],
    momentaryLufs: -70,
    shortTermLufs: -70,
    integratedLufs: -70,
    rangeLu: 0,
    truePeakDbtp: -90,
    gainReductionDb: 0,
    correlation: 0,
  }

  const nativeMeter = live.transport.mode === 'NATIVE' && live.transport.playing && Boolean(live.meters?.program)
  const validPhase = nativeMeter && meter.peakDbfs.some(peak=>peak > -70) && Number.isFinite(meter.correlation)
  const peak0 = nativeMeter ? meter.peakDbfs?.[0] ?? -90 : -90
  const peak1 = nativeMeter ? meter.peakDbfs?.[1] ?? -90 : -90
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

      <main className="w-full bg-surface-base flex-1 min-h-0 flex flex-col overflow-y-auto xl:overflow-hidden">
        {/* Faixa de altura FIXA reservada sempre: o aviso entra e sai sem empurrar a grade nem TAKE/ABORT. */}
        <div data-testid="cadence-notice-slot" className="w-full px-margin shrink-0 h-9 flex items-center">
          {publicationRequired && <div role="alert" className="w-full h-8 flex items-center gap-2 px-3 rounded bg-armed-amber/10 border border-armed-amber/40 text-armed-amber t-data overflow-hidden" title="A cadência foi convertida. Esta grade está bloqueada para CUE/TAKE até ser revisada e publicada em PLAYLIST. O histórico foi preservado.">
            <span className="material-symbols-outlined text-[16px] shrink-0">lock</span>
            <span className="truncate min-w-0">A cadência foi convertida. Esta grade está bloqueada para CUE/TAKE até ser revisada e publicada em PLAYLIST. O histórico foi preservado.</span>
            <button type="button" className="ml-auto shrink-0 px-2 h-6 rounded border border-armed-amber/60 t-label font-bold hover:bg-armed-amber/20" onClick={() => onNavigate('playlist')}>REVISAR EM PLAYLIST</button>
          </div>}
        </div>
        {/* 1.1 FAIXA DE STATUS DE ALTURA FIXA (U5): sonda + itens interrompidos */}
        <div className="w-full px-margin pt-2 pb-1 shrink-0 flex flex-col gap-1">
          <PgmProbeBanner channelId={channel.id} showContingency={false} />
          <InterruptedItemsBanner channelId={channel.id} rate={channel.rate} />
        </div>

        {/* 2. MASTER EM 3 FAIXAS (U1): esquerda = faixa do ar + grade alta; direita = PGM/PVW + ferramentas */}
        <div className="xl:flex-1 xl:min-h-0 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] 2xl:grid-cols-[minmax(0,1fr)_500px] gap-space-md px-margin pb-2">
          <div className="min-h-0 min-w-0 flex flex-col gap-space-sm">
            {/* 2a. FAIXA DO AR: NO AR · TAKE/CUE · PRÓXIMO */}
            <section className="shrink-0 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-space-sm items-stretch">
              <div className="flex flex-col min-w-0">
                <div className="bg-surface-panel/80 border border-border-subtle p-space-md rounded-xl flex flex-col justify-between shadow-md relative overflow-hidden backdrop-blur-sm h-full">
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between flex-wrap gap-1.5 pb-1 border-b border-border-subtle/50">
                      <div className="flex items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-on-air-crimson/20 border border-on-air-crimson/40 text-on-air-crimson font-label-caps text-[11px] font-bold tracking-wider whitespace-nowrap">
                          <span className={`w-1.5 h-1.5 rounded-full ${live?.transport.onAir && live.transport.playing ? 'bg-on-air-crimson animate-pulse' : 'bg-outline'}`}></span> {live?.transport.onAir ? live.transport.playing ? 'NO AR' : 'PGM PAUSADO' : 'SEM ITEM NO PGM'}
                        </span>
                        <span className="font-label-mono text-[12px] text-outline">
                          {formatStandardRate(channel.rate, channel.scan, channel.height)} • {onAirItem?.item.type === 'LIVE' ? 'AO VIVO' : onAirItem?.asset?.kind ?? 'SEM ITEM'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-start justify-between gap-2 pt-0.5">
                      <h3 className="font-headline-md text-[17px] text-on-surface font-semibold tracking-wide leading-tight truncate" title={itemDisplayTitle(onAirItem,'Nenhum item em reprodução')}>
                        {itemDisplayTitle(onAirItem,'Nenhum item em reprodução')}
                      </h3>
                    </div>
                  </div>
                  <div className="my-1 text-center">
                    <div className={`font-label-caps text-label-caps uppercase tracking-wider mb-0.5 ${overrunFrames > 0 || finalCountState ? 'text-armed-amber' : 'text-outline'}`}>{overrunFrames > 0 ? 'EXCEDIDO' : finalCountState ? 'CORTE EM' : 'TEMPO RESTANTE'}</div>
                    <div className={`font-timecode-display text-[26px] font-bold tabular-nums leading-none tracking-wider ${overrunFrames > 0 || finalCountState === 'last10' ? 'text-armed-amber' : finalCountState === 'last5' ? 'inline-block rounded px-1.5 bg-on-air-crimson text-white animate-pulse motion-reduce:animate-none' : 'text-on-air-crimson drop-shadow-[0_0_8px_rgba(255,59,48,0.45)]'}`} id="onair-countdown">
                      {onAirItem ? (overrunFrames > 0 ? `+${dur(overrunFrames, rate)}` : dur(remainingFrames, rate)) : '00:00:00:00'}
                    </div>
                    {overrunFrames > 0 && <div className="text-[11px] text-armed-amber mt-0.5">previsto {dur(onAirDurationFrames, rate)}</div>}
                    {nextFixed && nextFixed.leftMs <= 6 * 3_600_000 && nextFixed.itemId !== focusState?.itemId && <div role="status" className={`mt-1 rounded border px-1.5 py-0.5 text-left text-[11px] leading-snug ${nextFixedLate ? 'border-on-air-crimson/60 bg-on-air-crimson/10' : nextFixed.leftMs <= 60_000 ? 'border-armed-amber bg-armed-amber/15' : 'border-border-subtle bg-surface-container'}`} title={`${nextFixed.kind === 'HARD_TIME' ? 'Horário de rede (disparo obrigatório)' : 'Horário fixo'} de "${nextFixed.title}"`}>
                      <div className="flex items-baseline justify-between gap-2 font-label-caps font-bold">
                        <span className={nextFixed.leftMs <= 60_000 ? 'text-armed-amber' : 'text-outline'}>PRÓXIMO {nextFixed.kind === 'HARD_TIME' ? 'REDE' : 'FIXO'} {new Date(nextFixed.atMs).toLocaleTimeString('pt-BR')}</span>
                        <span className={`font-timecode-display tabular-nums ${nextFixed.leftMs <= 60_000 ? 'text-armed-amber' : 'text-on-surface'}`}>{countdownText(nextFixed.leftMs)}</span>
                      </div>
                      <div className="truncate text-on-surface-variant">{nextFixed.title}</div>
                      {nextFixedLate && <div className="font-bold text-on-air-crimson">{nextFixed.hit ? `ENTRA ${countdownText(nextFixed.deviationMs)} ATRASADO` : 'NÃO VAI BATER O HORÁRIO'} · ajuste a grade antes</div>}
                    </div>}
                    {focusState && <FocusCard status={focusState} targetHms={focus?.targetHms ?? null} onAir={focusOnAir} onTarget={targetHms => focus && setFocus({ ...focus, targetHms })} onClear={() => setFocus(null)} onAlign={() => setAlignOpen(true)} />}
                    {gradeEnd && <div role="status" title="A grade não está em loop. Depois do último item o canal só segue se houver próxima grade publicada com passagem automática." className={`mx-auto mt-1 block w-fit rounded border px-1.5 py-0.5 font-label-caps text-[11px] font-bold ${gradeEnd.level === 'urgent' ? 'border-on-air-crimson bg-on-air-crimson/15 text-on-air-crimson animate-pulse motion-reduce:animate-none' : 'border-armed-amber/60 bg-armed-amber/10 text-armed-amber'}`}>FIM DA GRADE ÀS {wallClock(view.schedule!.endsAt, rate, view.rundown.date)} · EM {mmss(gradeEnd.leftMs)}</div>}
                    <div className="font-label-mono text-label-mono text-outline mt-1">
                      TC {onAirItem ? dur(elapsedFrames, rate) : '00:00:00:00'}
                    </div>
                    {onAirItem?.item.type === 'LIVE' && <div className="mt-2 border-t border-border-subtle pt-1.5">
                      {/* Recolhido por padrão: a faixa do ar não cresce e a grade não encolhe. */}
                      <button type="button" onClick={() => setLiveAdjustOpen(value => !value)} aria-expanded={liveAdjustOpen || Boolean(pendingLiveAdjustment)} className="w-full flex items-center justify-center gap-1 text-[11px] text-outline hover:text-on-surface">
                        AJUSTAR ESTIMATIVA · {onAirItem.item.liveConfig?.autoFollowOnEnd ?? onAirItem.item.liveAutoFollowOnEnd ? 'saída automática' : 'saída manual'} <span className="material-symbols-outlined text-[14px]">{liveAdjustOpen || pendingLiveAdjustment ? 'expand_less' : 'expand_more'}</span>
                      </button>
                      {(liveAdjustOpen || Boolean(pendingLiveAdjustment) || Boolean(liveTimingMessage)) && <>
                      <div className="flex flex-wrap justify-center gap-1 mt-1">
                        {[-60, -30, -5, 5, 30, 60].map(seconds => <button key={seconds} disabled={adjustingLive||Boolean(pendingLiveAdjustment)} className="px-2 py-1 rounded border border-border-subtle text-[11px] hover:border-primary disabled:opacity-40" onClick={() => {
                          if(liveAdjustmentLock.current)return
                          liveAdjustmentLock.current=true
                          setAdjustingLive(true)
                          const input={itemId:onAirItem.item.id,expectedFrames:onAirItem.item.liveConfig?.estimatedDuration??onAirItem.item.liveEstimatedDuration??onAirItem.item.durationOverride??0,deltaSeconds:seconds}
                          void api.reviewLiveDuration(channel.id,input).then(review=>{
                            const operation={channelId:channel.id,body:{input:review.input,reviewToken:review.reviewToken,requestId:commandRequestId()}}
                            setPendingLiveAdjustment(operation);return submitLiveAdjustment(operation)
                          }).catch(error=>{setLiveTimingMessage(error instanceof Error?error.message:'Não foi possível conferir o ajuste.');liveAdjustmentLock.current=false;setAdjustingLive(false)})
                        }}>{seconds > 0 ? '+' : ''}{seconds}s</button>)}
                      </div>
                      {pendingLiveAdjustment&&<div className="flex justify-center gap-2 mt-1">
                        <button disabled={adjustingLive} onClick={()=>{if(liveAdjustmentLock.current)return;liveAdjustmentLock.current=true;setAdjustingLive(true);void submitLiveAdjustment(pendingLiveAdjustment)}}>Conferir solicitação</button>
                        <button disabled={adjustingLive} onClick={()=>{setPendingLiveAdjustment(null);setLiveTimingMessage('Solicitação dispensada na tela; isso não desfaz um ajuste já gravado. Confira a duração antes de outro ajuste.')}}>Dispensar aviso</button>
                      </div>}
                      <div className="text-[11px] text-outline mt-1">{onAirItem.item.liveConfig?.autoFollowOnEnd ?? onAirItem.item.liveAutoFollowOnEnd ? 'Saída automática ao fim da duração configurada.' : 'Saída manual: a estimativa não dispara TAKE.'}</div>
                      {liveTimingMessage && <div role="status" className="text-[11px] text-primary mt-1">{liveTimingMessage}</div>}
                      <LiveReplacementControl channelId={channel.id} info={live.liveReplacement??null} sources={sourceListReview?.sources??[]} />
                      </>}
                    </div>}
                  </div>
                  <div>
                    <div className="w-full bg-surface-container-lowest h-2 rounded-full overflow-hidden flex">
                      <div
                        className={`${overrunFrames > 0 ? 'bg-armed-amber' : 'bg-on-air-crimson'} h-full rounded-full transition-all duration-300`}
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

              <div className="flex flex-col min-w-0">
                <div className="h-full bg-surface-panel/90 border border-border-strong p-space-md rounded-xl flex flex-col justify-between shadow-lg relative overflow-hidden backdrop-blur-md">
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-label-caps text-[11px] text-outline uppercase">Transição</span>
                      <div className="inline-flex rounded-lg bg-surface-container-lowest p-0.5 border border-border-subtle">
                        {(['CUT', 'MIX', 'WIPE'] as const).map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            disabled={mode !== 'CUT'}
                            title={mode === 'CUT' ? 'Corte seco: é como o TAKE entra no ar' : `${mode} ainda não existe no engine; o TAKE é sempre corte seco`}
                            onClick={() => setTransitionMode(mode)}
                            className={`px-1.5 py-0.5 rounded font-label-mono text-[12px] transition-colors cursor-pointer ${
                              transitionMode === mode
                                ? 'bg-primary-container text-on-primary-container font-semibold'
                                : 'text-on-surface-variant hover:text-on-surface disabled:opacity-40 disabled:cursor-not-allowed'
                            }`}
                          >
                            {mode}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={toggleSound} aria-pressed={soundOn} title={soundOn ? 'Som ligado: bipes nos últimos 5 s de itens longos, 10 s antes de horário fixo e no aviso final da grade' : 'Ligar bipes de contagem (só nesta estação)'} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-container border border-border-subtle hover:bg-surface-container-high transition-colors">
                        <span className={`material-symbols-outlined text-[13px] ${soundOn ? 'text-status-ok' : 'text-outline'}`}>{soundOn ? 'volume_up' : 'volume_off'}</span>
                        <span className={`font-label-caps text-[11px] font-semibold ${soundOn ? 'text-status-ok' : 'text-outline'}`}>SOM</span>
                      </button>
                      {onLockPanel && <button type="button" onClick={onLockPanel} title="Bloqueia cliques e teclas de operação nesta estação (transmissões longas). Desbloqueia com um clique no aviso do topo." className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-container border border-border-subtle hover:bg-surface-container-high transition-colors" id="lock-toggle">
                        <span className="material-symbols-outlined text-[13px] text-on-surface-variant">lock</span>
                        <span className="font-label-caps text-[11px] font-semibold text-on-surface-variant">BLOQUEAR</span>
                      </button>}
                    </div>
                  </div>

                  {takeReason&&<div role="status" className="text-[11px] text-armed-amber text-center">{takeReason}</div>}
                  {transportRefusal&&<div role="alert" data-testid="transport-refusal" className="flex items-start gap-1.5 rounded border border-on-air-crimson/50 bg-on-air-crimson/10 px-2 py-1 text-[12px] text-on-surface">
                    <span className="material-symbols-outlined text-[15px] text-on-air-crimson shrink-0">block</span>
                    <span className="flex-1 min-w-0 break-words"><strong className="text-on-air-crimson">{transportRefusal.action.toUpperCase()} recusado:</strong> {transportRefusal.message} <span className="text-outline">(este comando não alterou o PGM)</span></span>
                    {onDismissTransportRefusal&&<button type="button" onClick={onDismissTransportRefusal} className="shrink-0 text-outline hover:text-on-surface" aria-label="Fechar aviso de comando recusado"><span className="material-symbols-outlined text-[15px]">close</span></button>}
                  </div>}
                  {!takeReason&&takeLive&&<div role="status" className="text-[11px] text-accent-ice text-center">Ao vivo fora da grade: o TAKE insere “{takeLive.title}” logo após o item no ar e coloca no ar.</div>}
                  <div className="grid grid-cols-12 gap-1.5 items-center my-1 text-center">
                    <button
                      onClick={handleTake}
                      className="col-span-6 h-12 bg-on-air-crimson hover:bg-on-air-glow active:scale-[0.98] text-surface-base rounded-lg font-headline-lg text-[18px] uppercase font-bold tracking-wider flex items-center justify-center gap-1 shadow transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
                      id="btn-take"
                      disabled={takeReason!==null}
                      title={takeReason??'Levar ao PGM o CUE confirmado no PVW (Espaço); Próximo não substitui o CUE'}
                    >
                      <span className="material-symbols-outlined text-[18px]">play_arrow</span>
                      <span>TAKE</span>
                      <span className="bg-surface-base/20 px-1 py-0.2 rounded font-label-mono text-[12px] text-surface-base font-semibold">ESPAÇO</span>
                    </button>

                    <button
                      onClick={() => {
                        const selected = selectedItemIds.size === 1
                          ? view.items.find((item) => selectedItemIds.has(item.item.id)) ?? null
                          : null
                        const target = selected ?? armedItem
                        if (target && !publicationRequired) onCue(target.item.id)
                      }}
                      className="col-span-4 h-12 bg-armed-amber hover:bg-armed-glow active:scale-[0.98] text-surface-base rounded-lg font-headline-md text-[14px] uppercase font-bold tracking-wide flex flex-col items-center justify-center shadow transition-all cursor-pointer"
                      title="Abre em CUE no PVW o item selecionado; sem seleção, abre o Próximo (F2)"
                    >
                      <div className="flex items-center gap-0.5">
                        <span className="material-symbols-outlined text-[14px]">skip_next</span>
                        <span>CUE</span>
                      </div>
                      <span className="font-label-mono text-[12px] text-surface-base/80 font-medium">F2</span>
                    </button>

                    <button
                      onClick={handleArmAbort}
                      disabled={!canStop}
                      className={`col-span-2 h-12 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg border border-border-subtle flex flex-col items-center justify-center transition-all cursor-pointer ${
                        abortArmed
                          ? 'bg-on-air-crimson text-white animate-pulse border-on-air-glow'
                          : 'bg-surface-container hover:bg-error-container text-outline hover:text-on-error-container'
                      }`}
                      title={!canStop ? deniedReason('parar o canal (ABORT)') : abortArmed ? 'CLIQUE PARA CONFIRMAR PARADA IMEDIATA' : 'Parada de emergência com trava de segurança (ABORT)'}
                    >
                      <span className="material-symbols-outlined text-[15px]">stop</span>
                      <span className="font-label-mono text-[12px] uppercase font-bold">
                        {abortArmed ? `CONFIRMAR ${abortCountdown}s · Esc cancela` : 'ABORT'}
                      </span>
                    </button>
                  </div>

                  <div className="flex items-center justify-between font-label-mono text-[12px] text-outline pt-0.5 border-t border-border-subtle/40">
                    <span className="inline-flex items-center gap-1 text-on-surface-variant" title="Sem placa SDI/genlock: o engine marca o tempo pelo relógio do Windows. Com DeckLink, a referência passa a ser a da placa.">
                      REFERÊNCIA: RELÓGIO DO SISTEMA
                    </span>
                    <span title="Do clique no TAKE até o servidor confirmar o novo item no ar. Não inclui a latência da saída (RTMP/SRT/NDI).">
                      {lastTake ? `ÚLTIMO TAKE: ${lastTake.ms} ms · ${lastTake.at.toLocaleTimeString('pt-BR')}` : 'ÚLTIMO TAKE: —'}
                    </span>
                  </div>
                </div>

              </div>
              <div className="flex flex-col min-w-0">
                <div className="h-full bg-surface-panel/80 border border-border-subtle p-space-md rounded-xl flex flex-col justify-between shadow-md relative overflow-hidden">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-space-sm">
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-armed-amber/20 border border-armed-amber/40 text-armed-amber font-label-caps text-label-caps font-bold tracking-wider">
                        {cueItem ? 'CUE [PVW]' : 'PRÓXIMO [PREP]'}
                      </span>
                      <span className="font-label-mono text-label-mono text-armed-amber bg-surface-container px-1.5 py-0.5 rounded">
                        {previewKind}
                      </span>
                    </div>
                    <span className={`font-label-mono text-label-mono ${previewSignalState === 'PVW_READY' || previewSignalState === 'ON_PGM' ? 'text-status-ok-bright' : previewSignalState === 'LOST' || previewSignalState === 'FAILED' ? 'text-on-air-crimson' : 'text-armed-amber'}`} title={previewSignal?.message ?? undefined}>
                      {previewSignalState ? previewSignalLabel[previewSignalState] : cueItem ? 'CUE MANUAL' : 'AUTO-PREP'}
                    </span>
                  </div>

                  <div className="my-space-xs">
                    <h3 className="font-headline-md text-[17px] text-on-surface font-semibold truncate tracking-wide" title={previewTitle}>
                      {previewTitle}
                    </h3>
                    <div className="flex items-baseline justify-between mt-1">
                      <div className="flex items-baseline gap-2">
                        <span className="font-label-caps text-label-caps text-outline uppercase tracking-wider">Duração</span>
                        <span className="font-timecode-display text-[24px] text-armed-amber font-bold tabular-nums leading-none tracking-wider">
                          {dur(nextCardFrames, rate)}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="font-label-mono text-label-mono text-outline block">PREVISÃO</span>
                        <span className="font-timecode-table text-timecode-table text-on-surface font-semibold tabular-nums">
                          {(cueItem ?? armedItem) && scheduleMap.get((cueItem ?? armedItem)!.item.id)?.start != null
                            ? wallClock(scheduleMap.get((cueItem ?? armedItem)!.item.id)!.start, rate, view.rundown.date)
                            : onAirItem && scheduleMap.get(onAirItem.item.id)?.end != null
                            ? wallClock(scheduleMap.get(onAirItem.item.id)!.end, rate, view.rundown.date)
                            : '--:--:--:--'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-on-surface-variant font-label-mono text-label-mono pt-1.5 border-t border-border-subtle/50">
                    <span className="text-outline">
                      {nextCardFormat}
                    </span>
                    <span className="text-armed-amber font-semibold">
                      {overrunFrames > 0 ? `ATRASADO +${dur(overrunFrames, rate)}` : `DISPARO EM ${dur(remainingFrames, rate)}`}
                    </span>
                  </div>
                </div>
              </div>
            </section>

            {/* 2b. GRADE ALTA + BIBLIOTECA (recolhível) */}
            <section className="h-[75vh] min-h-[420px] xl:h-auto xl:min-h-0 xl:flex-1 flex gap-space-sm">
              {mamOpen && (
                <div className="hidden md:flex w-[260px] 2xl:w-[340px] shrink-0 bg-surface-card border border-border-subtle p-space-md rounded-xl flex-col gap-space-sm shadow-sm min-h-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-primary text-[20px]">folder</span>
                      <span className="font-headline-md text-headline-md uppercase text-on-surface tracking-wide font-semibold">
                        Biblioteca
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button type="button" onClick={() => setMamPanel('closed')} className="hit-icon rounded text-outline hover:text-on-surface hover:bg-surface-container" title="Recolher a biblioteca (a grade ganha largura)" aria-label="Recolher a biblioteca">
                        <span className="material-symbols-outlined text-[22px]">left_panel_close</span>
                      </button>
                      <button
                        onClick={() => setFolderModalOpen(true)}
                        className="px-2 hit-btn rounded bg-primary/15 hover:bg-primary/30 text-primary border border-primary/40 font-label-caps t-label font-bold flex items-center gap-1 cursor-pointer transition-colors"
                        title="Adicionar pastas locais ou em rede ao acervo MAM"
                      >
                        <span className="material-symbols-outlined text-[15px]">create_new_folder</span>
                      </button>
                      <button
                        onClick={() => { resetLiveInput(); setLiveInputModalOpen(true) }}
                        className="px-2 hit-btn rounded bg-accent-ice/15 hover:bg-accent-ice/30 text-accent-ice-bright border border-accent-ice/40 font-label-caps t-label font-bold flex items-center gap-1 cursor-pointer transition-colors"
                        title="Adicionar fonte externa (DeckLink SDI, NDI, WebRTC, SRT) à biblioteca"
                      >
                        <span className="material-symbols-outlined text-[15px]">settings_input_antenna</span>
                      </button>
                      <span className="font-label-mono text-label-mono text-outline">
                        {libraryLoaded ? allAssetsWithLive.length : '…'}
                      </span>
                    </div>
                  </div>

                  {/* Barra de Busca MAM */}
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-outline text-[16px] pointer-events-none">
                      search
                    </span>
                    <input
                      value={mamSearch}
                      onChange={(e) => setMamSearch(e.target.value)}
                      className="w-full bg-surface-container-lowest text-on-surface font-body-sm text-body-sm pl-8 pr-space-md py-2 rounded-lg border border-border-subtle placeholder-outline focus:outline-none focus:border-primary transition-colors"
                      placeholder="Buscar no acervo…"
                      type="text"
                    />
                  </div>

                  {/* Filtros em Pílulas */}
                  <div className="flex gap-1.5 pb-1">
                    {(['TODOS', 'VT', 'AO VIVO'] as const).map((tag) => (
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
                  <div className="flex flex-col gap-2 min-h-0 overflow-y-auto pr-1.5 flex-1 broadcast-scroll">
                    {filteredAssets.length === 0 ? (
                      <div className="p-4 text-center text-outline font-body-sm">
                        {libraryLoaded ? 'Nenhuma mídia encontrada no filtro.' : 'Acervo ainda não conferido. A ausência de resultados não confirma acervo vazio.'}
                      </div>
                    ) : (
                      groupLiveVariants(filteredAssets).map(({ asset, variants }) => {
                        const isLive = 'isLiveSource' in asset && (asset as any).isLiveSource
                        return (
                          <div
                            key={asset.id}
                            draggable
                            onDragStart={(e) => handleDragStart(e, asset)}
                            onClick={() => handleMamPreview(asset)}
                            className={`px-2 hit-row rounded border cursor-grab active:cursor-grabbing flex items-center justify-between gap-2 transition-colors group relative ${
                              selectedPreviewAsset?.id === asset.id
                                ? 'bg-armed-amber/15 border-armed-amber/50 shadow-sm'
                                : isLive
                                ? 'bg-accent-ice/5 hover:bg-accent-ice/10 border-accent-ice/30'
                                : 'bg-surface-panel hover:bg-surface-container border-border-subtle'
                            }`}
                            title={
                              isLive
                                ? 'Fonte Externa Ao Vivo: Arraste para a grade ou clique + para adicionar'
                                : `${asset.title} • Clique para carregar e rodar preview no PVW`
                            }
                          >
                            <div className="flex items-center gap-1.5 min-w-0 flex-1">
                              <span
                                className={`material-symbols-outlined text-[15px] shrink-0 ${
                                  isLive ? 'text-accent-ice' : 'text-outline'
                                }`}
                              >
                                {isLive ? 'settings_input_antenna' : 'movie'}
                              </span>
                              <span
                                className="font-body-sm text-[12.5px] font-medium text-on-surface truncate whitespace-nowrap"
                                title={asset.title}
                              >
                                {asset.title}
                              </span>
                              {isLive && variants.map((variant) => (
                                <button
                                  type="button"
                                  key={variant.id}
                                  onClick={(e) => { e.stopPropagation(); handleMamPreview(variant) }}
                                  className="text-accent-ice font-bold bg-accent-ice/15 px-1 py-0.2 rounded border border-accent-ice/30 text-[11px] shrink-0 whitespace-nowrap hover:bg-accent-ice/30"
                                  title={`Abrir no PVW pela entrada ${liveProtocolLabel((variant as any).sourceRef ?? variant.path)}`}
                                >
                                  {liveProtocolLabel((variant as any).sourceRef ?? variant.path)}
                                </button>
                              ))}
                            </div>

                            <div className="flex items-center gap-2 shrink-0 font-label-mono text-[12px] text-outline">
                              <span className="text-on-surface font-semibold tabular-nums">
                                {dur(libraryFrames(asset, rate), rate)}
                              </span>

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
                                className="hit-icon rounded bg-primary-container/20 hover:bg-primary-container text-primary hover:text-white border border-primary/30 cursor-pointer"
                                title="Adicionar à grade" aria-label="Adicionar à grade"
                              >
                                <span className="material-symbols-outlined text-[18px]">add</span>
                              </button>
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>

              )}
              <div className="flex-1 min-w-0 min-h-0 flex flex-col gap-space-sm">
                <div className="bg-surface-card border border-border-subtle p-space-md rounded-xl flex flex-col gap-space-sm shadow-sm flex-1 min-h-0 min-w-0">
                  <div className="flex flex-wrap items-center justify-between gap-3 pb-1">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex items-center gap-2">
                        {!mamOpen && <button type="button" onClick={() => setMamPanel('open')} className="px-2 py-1 rounded border border-border-subtle text-[11px] font-label-caps font-bold text-primary flex items-center gap-1 hover:bg-surface-container" title="Mostrar a biblioteca ao lado da grade">
                          <span className="material-symbols-outlined text-[16px]">folder</span>BIBLIOTECA
                        </button>}
                        <span className="font-headline-md text-headline-md uppercase text-on-surface font-semibold tracking-wide whitespace-nowrap">
                          Grade de Exibição
                        </span>
                        {mirror && <MirrorStatus channel={channel} mirror={mirror} channels={channels} compact />}
                        <span className="font-label-mono text-[12px] text-outline" title="Grade carregada no canal">
                          {view.rundown.name} · {view.rundown.date ? view.rundown.date.split('-').reverse().slice(0, 2).join('/') : 'sem data'}{view.rundown.loop ? ' · loop' : ''}
                        </span>
                        {view.rundown.loop && view.rundown.date && view.rundown.date !== localDateKey(new Date()) && (
                          <span className="text-[11px] text-armed-amber" title="Os horários continuam certos; a data mostra quando a grade foi criada.">
                            em loop desde {view.rundown.date.split('-').reverse().slice(0, 2).join('/')}
                          </span>
                        )}
                      </div>

                      {/* A "Timeline multicamada" saiu: LUFS, SCTE e grafismos dela eram
                          estimados pelo título do item, não dados reais. A linha do tempo
                          de 24 h com lacunas reais fica na Playlist. */}
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
                        <span className="hidden 2xl:inline">{followOnAir ? 'TRAVADO NO AR' : 'ROLAGEM LIVRE'}</span>
                      </button>

                      <button
                        title="Adicionar linha na grade"
                        onClick={handleOpenAddLine}
                        className="px-3 py-1.5 rounded-lg bg-surface-panel hover:bg-surface-container border border-border-subtle text-on-surface font-body-sm text-body-sm flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[16px]">add</span> <span className="hidden 2xl:inline">Linha</span>
                      </button>
                      <button
                        title="EPG / Auto-Fill"
                        onClick={onAutoFill}
                        className="px-3 py-1.5 rounded-lg bg-surface-panel hover:bg-surface-container border border-border-subtle text-on-surface font-body-sm text-body-sm flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[16px]">sync</span> <span className="hidden 2xl:inline">EPG / Autofill</span>
                      </button>
                      <button
                        onClick={() => setIsConflictDrawerOpen(true)}
                        className="px-3 py-1.5 rounded-lg bg-surface-panel hover:bg-surface-container border border-border-subtle text-armed-amber font-body-sm text-body-sm flex items-center gap-1.5 transition-colors cursor-pointer"
                        title="Verificar Conflitos da Grade (Conflict Drawer)"
                      >
                        <span className="material-symbols-outlined text-[16px]">rule</span> <span className="hidden 2xl:inline">Conflitos</span>
                      </button>
                      <button
                        title="Exportar grade (CSV)"
                        onClick={onExportCsv}
                        className="px-3 py-1.5 rounded-lg bg-surface-panel hover:bg-surface-container border border-border-subtle text-on-surface font-body-sm text-body-sm flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[16px]">file_download</span> <span className="hidden 2xl:inline">Exportar</span>
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
                        if (target && !publicationRequired) onCue(target.item.id)
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
                    className={`w-full flex-1 min-h-0 rounded-lg border border-border-subtle broadcast-scroll relative ${
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
                          <th className="px-2 w-10 text-center font-timecode-table">#</th>
                          <th className="px-3 w-36 font-timecode-table">STATUS</th>
                          <th className="px-3 w-28 font-timecode-table">INÍCIO</th>
                          <th className="px-3 w-24 font-timecode-table">DURAÇÃO</th>
                          <th className="px-3 font-timecode-table">TÍTULO</th>
                          <th className="hidden 2xl:table-cell px-4 w-32 text-right font-timecode-table">TIPO</th>
                          <th className="px-3 w-48 text-right font-timecode-table">AÇÕES</th>
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
                            const isItemCued = selectedPreviewAsset === null && cueItem?.item.id === item.item.id
                            const isItemPrepared = item.item.id === live.transport.preparedItemId
                            const isAired = onAirIndex >= 0 && index < onAirIndex
                            const durationFrames = getItemDuration(item)
                            const isSelected = selectedItemIds.has(item.item.id)
                            const unavailable = Boolean(item.item.mediaId && (!item.asset || item.asset.probeError || item.asset.ignored || !qcApproved(item.asset.qcStatus ?? 'APPROVED')))

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

                            let rowClass = 'hover:bg-surface-panel transition-colors border-b border-border-subtle/40 bg-surface-card h-10'
                            if (isSelected) {
                              rowClass = 'bg-primary-container/25 border-b border-primary/50 ring-1 ring-primary/60 text-white h-10'
                            } else if (isItemOnAir) {
                              rowClass = 'bg-on-air-crimson/10 border-b border-on-air-crimson/30 h-12'
                            } else if (isItemCued) {
                              rowClass = 'bg-armed-amber/15 border-b border-armed-amber/40 h-12 shadow-sm'
                            } else if (isAired) {
                              rowClass = 'opacity-50 hover:opacity-80 transition-opacity border-b border-border-subtle/40 bg-surface-card h-10'
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
                                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setRowMenu({ x: e.clientX, y: e.clientY, itemId: item.item.id, title: item.item.title }) }}
                                className={`${rowClass} group cursor-pointer ${focus?.itemId === item.item.id ? 'outline outline-2 -outline-offset-2 outline-primary' : ''}`}
                                title="Clique para armar (CUE) no PVW • Ctrl/Shift para multiseleção • Botão direito: focar contagem"
                              >
                                <td className={`py-1.5 px-3 text-center font-label-mono text-label-mono ${
                                  isItemOnAir ? 'text-on-air-crimson font-bold text-[13px]' : isItemCued ? 'text-armed-amber font-bold text-[13px]' : 'text-outline t-data'
                                }`}>
                                  {focus?.itemId === item.item.id ? <span className="text-primary font-bold" title="Item em foco">◎</span> : index + 1}
                                </td>

                                <td className="py-1.5 px-3 whitespace-nowrap">
                                  {isItemOnAir ? (
                                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-on-air-crimson text-surface-base font-label-caps t-status">
                                      <span className="w-1.5 h-1.5 rounded-full bg-surface-base animate-ping"></span> NO AR
                                    </span>
                                  ) : isItemCued ? (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-armed-amber text-surface-base font-label-caps t-status">
                                      CUED
                                    </span>
                                  ) : unavailable ? (
                                    <button type="button" onClick={(event) => { event.stopPropagation(); onNavigate('qc') }} className="px-2 py-0.5 rounded t-status text-on-air-crimson bg-on-air-crimson/10 hover:bg-on-air-crimson/25" title={`${!item.asset ? 'Arquivo não encontrado no acervo' : item.asset.probeError ? `Arquivo com problema: ${item.asset.probeError}` : item.asset.ignored ? 'Arquivo ignorado no QC' : 'Arquivo ainda não aprovado no QC'}. Clique para abrir o QC.`}>{!item.asset || item.asset.probeError ? 'SEM ARQUIVO' : item.asset.ignored ? 'IGNORADO' : 'QC PENDENTE'}</button>
                                  ) : isItemPrepared ? (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-status-ok/20 text-status-ok-bright font-label-caps t-status">
                                      PRÓXIMO
                                    </span>
                                  ) : isAired ? (
                                    <span className="px-2 py-0.5 rounded font-label-caps t-status text-outline bg-surface-container">
                                      EXIBIDO
                                    </span>
                                  ) : (
                                    <span className="px-2 py-0.5 rounded font-label-caps t-status text-status-ok-bright bg-surface-container">
                                      AGENDADO
                                    </span>
                                  )}
                                </td>

                                <td className={`py-1.5 px-3 t-time ${
                                  isItemOnAir ? 'text-on-surface font-bold' : isItemCued ? 'text-armed-amber font-bold' : 'text-on-surface-variant'
                                }`}>
                                  {scheduleMap.get(item.item.id)?.start != null
                                    ? wallClock(scheduleMap.get(item.item.id)!.start, rate, view.rundown.date)
                                    : '--:--:--:--'}
                                </td>

                                <td className={`py-1.5 px-3 t-time ${
                                  isItemOnAir ? 'text-on-air-crimson font-bold' : isItemCued ? 'text-on-surface' : 'text-on-surface-variant'
                                }`}>
                                  {dur(durationFrames, rate)}
                                </td>

                                <td className="py-1 px-3 font-body-sm text-[13px] max-w-0 w-full">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    {/* Badges de Tipo de Evento (Fase A) */}
                                    {eventType === 'HARD_TIME' && (
                                      <span
                                        title="Ponto de Sincronismo Obrigatório de Rede (Hard Sync frame-accurate no frame zero)"
                                        className="inline-flex items-center gap-0.5 px-1 py-0.2 rounded bg-rose-950/80 border border-rose-600/70 text-rose-300 text-[11px] font-label-caps tracking-wider font-bold shrink-0 shadow-xs"
                                      >
                                        <span className="material-symbols-outlined text-[11px] text-rose-400">schedule</span>
                                        HARD SYNC
                                      </span>
                                    )}
                                    {eventType === 'FIXED' && (
                                      <span
                                        title="Horário Fixo Ancorado no Relógio da Emissora"
                                        className="inline-flex items-center gap-0.5 px-1 py-0.2 rounded bg-armed-amber/60 border border-armed-amber/50 text-armed-amber text-[11px] font-label-caps tracking-wider font-bold shrink-0"
                                      >
                                        <span className="material-symbols-outlined text-[11px] text-armed-amber">lock_clock</span>
                                        FIXO
                                      </span>
                                    )}
                                    {eventType === 'LIVE' && (
                                      <span
                                        title="Entrada de Sinal Ao Vivo Externa / Estúdio"
                                        className="inline-flex items-center gap-0.5 px-1 py-0.2 rounded bg-accent-ice/20 border border-accent-ice/50 text-accent-ice-bright text-[11px] font-label-caps tracking-wider font-bold shrink-0"
                                      >
                                        <span className="material-symbols-outlined text-[11px] text-accent-ice-bright animate-pulse">sensors</span>
                                        AO VIVO
                                      </span>
                                    )}
                                    {eventType === 'FILLER' && (
                                      <span
                                        title="Item Elástico de Preenchimento (Gap Fill / Elastic)"
                                        className="inline-flex items-center gap-0.5 px-1 py-0.2 rounded bg-purple-950/60 border border-purple-500/50 text-purple-300 text-[11px] font-label-caps tracking-wider font-bold shrink-0"
                                      >
                                        <span className="material-symbols-outlined text-[11px] text-purple-400">auto_awesome</span>
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
                                            className="inline-flex items-center gap-0.5 px-1 py-0.2 rounded bg-status-ok/70 border border-status-ok/50 text-status-ok-bright font-label-mono text-[12px] font-bold"
                                          >
                                            <span className="material-symbols-outlined text-[11px] text-status-ok-bright">shield</span>
                                            PROT
                                          </span>
                                        )}
                                        {trimmable && (
                                          <span
                                            title="Trimmable: Pode ter cauda reduzida para absorver atrasos e salvar a grade"
                                            className="px-1 py-0.2 rounded bg-surface-container border border-border-subtle text-outline font-label-mono text-[12px] font-medium tracking-tight"
                                          >
                                            [TRIM]
                                          </span>
                                        )}
                                        {optional && (
                                          <span
                                            title="Opcional: Pode ser descartado da grade em caso de emergência temporal"
                                            className="px-1 py-0.2 rounded bg-surface-container border border-border-subtle text-outline font-label-mono text-[12px] font-medium tracking-tight"
                                          >
                                            [OPT]
                                          </span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </td>

                                <td className="hidden 2xl:table-cell py-1 px-3 text-right">
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
                                      <span className={`text-[12px] font-label-mono font-medium ${
                                        eventType === 'HARD_TIME'
                                          ? 'text-rose-400'
                                          : eventType === 'FIXED'
                                            ? 'text-armed-amber'
                                            : eventType === 'LIVE'
                                              ? 'text-accent-ice-bright'
                                              : 'text-purple-400'
                                      }`}>
                                        {eventType === 'HARD_TIME' ? 'HARD SYNC' : eventType}
                                      </span>
                                    ) : (
                                      <span className="text-[12px] font-label-mono text-outline/60">
                                        SEQ
                                      </span>
                                    )}
                                  </div>
                                </td>

                                <td className="py-1 px-4 text-right">
                                  <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleOpenEditLine(item)
                                      }}
                                      className="hit-icon rounded hover:bg-surface-container text-outline hover:text-on-surface"
                                      title="Editar horário e compensação do item"
                                    >
                                      <span className="material-symbols-outlined text-[15px]">tune</span>
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        onOpenTrim(item)
                                      }}
                                      className="hit-icon rounded hover:bg-surface-container text-outline hover:text-on-surface"
                                      title="Ajustar Trim (IN / OUT)"
                                    >
                                      <span className="material-symbols-outlined text-[15px]">content_cut</span>
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        onOpenAudio(item)
                                      }}
                                      className="hit-icon rounded hover:bg-surface-container text-outline hover:text-on-surface"
                                      title="Ajustar Canais de Áudio"
                                    >
                                      <span className="material-symbols-outlined text-[15px]">volume_up</span>
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        onOpenGraphics(item)
                                      }}
                                      className="hit-icon rounded hover:bg-surface-container text-outline hover:text-on-surface"
                                      title="GCs e Vinhetas"
                                    >
                                      <span className="material-symbols-outlined text-[15px]">layers</span>
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        onRemoveItem(item.item.id)
                                      }}
                                      className="hit-icon rounded hover:bg-error-container text-outline hover:text-on-error-container"
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
                    <span>{view.items.length} EVENTOS PROGRAMADOS</span>
                    <span className="flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${live.transport.playing ? 'bg-status-ok' : 'bg-outline'}`}></span>
                      {live.transport.mode === 'SIMULATED' ? 'SIMULADO' : live.transport.mode === 'NATIVE' ? 'ENGINE NATIVO' : 'ENGINE NÃO CONFIRMADO'} · {live.transport.playing ? 'EM EXECUÇÃO' : 'PARADO'}
                    </span>
                  </div>
                </>
              )}
            </div>

                <div className="bg-surface-card border border-border-subtle px-space-lg py-space-sm rounded-xl flex items-center justify-between gap-space-lg shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-accent-ice text-[18px]">equalizer</span>
                      <span className="font-label-caps text-label-caps uppercase text-on-surface font-bold">
                        {nativeMeter ? 'Áudio PGM · EBU R128' : 'Áudio PGM · sem medição nativa'}
                      </span>
                    </div>
                    <span className={`font-headline-md text-[18px] font-bold tabular-nums ${loudnessToneClass[nativeMeter ? loudnessTone(meter.integratedLufs, channel.targetLufs) : 'unknown']}`}
                      title={`Integrado (I) do PGM; alvo ${channel.targetLufs} LUFS. Verde até ±2 LU, âmbar até ±5 LU; abaixo de −60 LUFS é silêncio.`}>
                      {nativeMeter && Number.isFinite(meter.integratedLufs) ? `${meter.integratedLufs.toFixed(1)} LUFS` : 'N/D'}
                      {nativeMeter && loudnessTone(meter.integratedLufs, channel.targetLufs) === 'silence' && <span className="ml-1.5 text-[12px] font-label-caps align-middle">SILÊNCIO</span>}
                    </span>
                  </div>

                  <div className="flex-1 max-w-xl flex items-center gap-space-md">
                    <div className="flex-1 flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="font-label-mono text-[12px] text-outline w-3">L</span>
                        <div className="h-2 flex-1 bg-surface-container-lowest rounded-full overflow-hidden flex border border-border-subtle/40">
                          <div
                            className="bg-status-ok h-full rounded-full transition-all duration-150"
                            style={{ width: `${leftPeakPercent}%` }}
                          ></div>
                        </div>
                        <span className="font-label-mono text-[12px] text-on-surface tabular-nums w-8">
                          {nativeMeter ? meter.peakDbfs[0]?.toFixed(1) ?? 'N/D' : 'N/D'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-label-mono text-[12px] text-outline w-3">R</span>
                        <div className="h-2 flex-1 bg-surface-container-lowest rounded-full overflow-hidden flex border border-border-subtle/40">
                          <div
                            className="bg-status-ok h-full rounded-full transition-all duration-150"
                            style={{ width: `${rightPeakPercent}%` }}
                          ></div>
                        </div>
                        <span className="font-label-mono text-[12px] text-on-surface tabular-nums w-8">
                          {nativeMeter ? meter.peakDbfs[1]?.toFixed(1) ?? 'N/D' : 'N/D'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-space-md font-label-mono text-label-mono text-outline">
                    <span>FASE: {validPhase ? `${meter.correlation >= 0 ? '+' : ''}${meter.correlation.toFixed(2)}` : 'N/D'}</span>
                    <span className={`${!validPhase ? 'text-outline' : meter.correlation < 0 ? 'text-danger' : 'text-status-ok'} flex items-center gap-1 font-semibold`}>
                      {validPhase ? meter.correlation < 0 ? 'ANTIFASE' : 'CORRELAÇÃO POSITIVA' : 'SEM MEDIÇÃO'}
                    </span>
                  </div>
                </div>
              </div>
            </section>
          </div>

          {/* 2c. COLUNA DIREITA: monitores e ferramentas (gaveta em abas) */}
          <aside className="min-h-0 flex flex-col gap-space-sm">
              <div className="flex flex-col shrink-0">
                <BroadcastMonitor
                  bus="pgm"
                  className="w-full"
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
                  onWatching={(_bus, watching) => { void api.setWatching(channel.id, 'mon', watching).catch(() => {}) }}
                />
              </div>

              <div className="flex flex-col shrink-0">
                <BroadcastMonitor
                  bus="pvw"
                  className="w-full"
                  title="PVW • CUE Selecionado"
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
                    void api.setWatching(channel.id, 'pvw', watching).catch(() => {})
                  }}
                />
                <button
                  type="button"
                  disabled={publicationRequired || !live.transport.preview}
                  onClick={() => { setSelectedPreviewAsset(null); onClearCue() }}
                  title="Limpar somente o CUE/PVW; conserva o PGM e permite selecionar outra grade com o canal parado"
                  className="mt-1 rounded border border-border-subtle px-2 py-1 text-[11px] text-on-surface-variant hover:text-on-surface disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  LIMPAR CUE / PVW
                </button>
                {live.transport.preview&&<PreviewFrameStatus sample={live.transport.previewFrame}/>}
              </div>

            <MasterToolsPanel channelId={channel.id} rate={channel.rate} assets={allAssets} />
          </aside>
        </div>
      </main>

      {/* MODAL 1: Ingestão de Entrada Externa / DeckLink na Biblioteca MAM */}
      {liveInputModalOpen && (
        <div
          role="dialog" aria-modal="true" aria-label="Entrada ao vivo"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4"
          onClick={() => {if(!sourcePending.current)setLiveInputModalOpen(false)}}
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
                    Selecione NDI, OMT, SDI, SRT ou RTMP; depois confirme o nome
                  </p>
                </div>
              </div>
              <button
                onClick={() => {if(!sourcePending.current)setLiveInputModalOpen(false)}}
                className="p-1 rounded hover:bg-surface-container text-outline hover:text-on-surface cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="flex flex-col gap-3">
              <CanonicalProtocolSelector mode="INPUT" defaultKind="NDI" onChange={selectNewLiveInput} />
              <div>
                <label className="font-label-caps text-label-caps text-outline block mb-1">
                  NOME / IDENTIFICADOR DA FONTE
                </label>
                <input
                  type="text"
                  value={newLiveTitle}
                  onChange={(e) => { setNewLiveTitle(e.target.value); setNewLiveNameEdited(Boolean(e.target.value.trim())) }}
                  className="w-full bg-surface-panel border border-border-subtle rounded-lg px-3 py-2 text-on-surface font-body-sm focus:border-primary focus:outline-none"
                  placeholder="Nome da fonte selecionada ou apelido operacional"
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

            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-border-subtle">
              <div className="mr-auto text-xs text-outline">
                <p>{sourceSaveMessage??'Cadastro não muda PGM/PVW; sinal só é conferido no CUE.'}</p>
                <button type="button" disabled={sourceSaveBusy} className="text-primary" onClick={()=>void reopenSourceList()}>Reabrir lista de entradas</button>
              </div>
              <button
                onClick={() => {if(!sourcePending.current)setLiveInputModalOpen(false)}}
                className="px-4 py-2 rounded-lg bg-surface-panel hover:bg-surface-container border border-border-subtle text-outline hover:text-on-surface font-body-sm cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  if (!newLiveTitle.trim() || !newLiveRef.trim() || !newLiveValid) return
                  const fpsVal = rate.num / rate.den
                  const durFrames = Math.round(newLiveDurationMin * 60 * fpsVal)
                  const newSource: Omit<CustomLiveSource, 'id'> = {
                    title: newLiveTitle.trim(),
                    sourceRef: newLiveRef.trim(),
                    family: newLiveFamily,
                    durationFrames: durFrames,
                  }
                  void saveCustomSource(newSource)
                    .then(() => {if(sourceChannel.current===channel.id)setLiveInputModalOpen(false)})
                    .catch(error => {if(sourceChannel.current===channel.id)void notify(`Cadastro não confirmado. Rascunho preservado: ${error instanceof Error?error.message:'Reabra a lista.'}`)})
                }}
                disabled={sourceSaveBusy||sourceNeedsReopen||!sourceFormReview||!newLiveValid || !newLiveTitle.trim()}
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
          role="dialog" aria-modal="true" aria-label="Linha da grade"
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
                    {editingItemView ? 'Horário e compensação do item' : 'Adicionar Linha na Grade'}
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
            {lineConfigError && <div role="alert" className="mx-6 mb-3 rounded-lg border border-on-air-crimson/40 bg-on-air-crimson/10 p-3 text-sm text-on-air-crimson">{lineConfigError} Feche e reabra o item para comparar com a versão atual antes de editar novamente.</div>}
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
                    <div className="text-[12px] font-label-mono text-outline">
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
                                  <span className="text-accent-ice font-bold text-[11px] bg-accent-ice/15 px-1 py-0.2 rounded">
                                    AO VIVO
                                  </span>
                                )}
                                <span>{dur(libraryFrames(asset, rate), rate)}</span>
                              </div>
                            </div>
                          )
                        })}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    <CanonicalProtocolSelector mode="INPUT" defaultKind="NDI" onChange={selectNewLiveInput} />
                    <div>
                      <label className="font-label-caps text-label-caps text-outline block mb-1">
                        NOME DA ENTRADA AO VIVO
                      </label>
                      <input
                        type="text"
                        value={newLiveTitle}
                        onChange={(e) => { setNewLiveTitle(e.target.value); setNewLiveNameEdited(Boolean(e.target.value.trim())) }}
                        className="w-full bg-surface-panel border border-border-subtle rounded-lg px-3 py-2 text-on-surface font-body-sm focus:border-primary focus:outline-none"
                        placeholder="ex: DeckLink SDI 1 - Estúdio A"
                      />
                    </div>

                    <div className="flex flex-col gap-1">
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
                    Horário e compensação
                  </span>
                </div>
                
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
                    <option value="SEQUENTIAL">Sequencial — entra após o item anterior</option>
                    <option value="FIXED">Horário fixo — a grade se ajusta para entrar no horário</option>
                    <option value="HARD_TIME">Horário rígido — corta o anterior no horário exato</option>
                    <option value="LIVE">Ao vivo — fonte de sinal</option>
                    <option value="FILLER">Preenchimento — elástico, cobre buracos</option>
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
                        className="rounded border-border-subtle text-status-ok-bright focus:ring-emerald-500"
                      />
                      <span className="flex items-center gap-1 font-semibold text-status-ok-bright">
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
                      <span className={`font-mono text-[12px] ${lineProtected ? 'opacity-50' : 'text-primary'}`}>
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
                      <span className={`font-mono text-[12px] ${lineProtected ? 'opacity-50' : 'text-primary'}`}>
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
              {addLineTab==='live'&&addLineSaveToLibrary&&!editingItemView&&<div className="mr-auto text-xs text-outline">
                <p>{sourceSaveMessage??'Cadastro usa a revisão aberta; não troca PGM/PVW.'}</p>
                <button type="button" disabled={sourceSaveBusy} className="text-primary" onClick={()=>void reopenSourceList()}>Reabrir lista de entradas</button>
              </div>}
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
                  disabled={sourceSaveBusy||(addLineTab==='live'&&addLineSaveToLibrary&&(sourceNeedsReopen||!sourceFormReview))}
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
                      if (!newLiveTitle.trim() || !newLiveRef.trim() || !newLiveValid) return
                      const fpsVal = rate.num / rate.den
                      const durFrames = Math.round(newLiveDurationMin * 60 * fpsVal)
                      if (addLineSaveToLibrary) {
                        void saveCustomSource({
                          title: newLiveTitle.trim(),
                          sourceRef: newLiveRef.trim(),
                          family: newLiveFamily,
                          durationFrames: durFrames,
                        }).catch(() => void notify('A entrada foi incluída na grade, mas não pôde ser salva nas Configurações.'))
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
      {rowMenu && (
        <div role="menu" aria-label={`Ações de ${rowMenu.title}`} className="fixed z-[95] min-w-[220px] rounded-lg border border-border-strong bg-surface-panel py-1 text-[13px] shadow-2xl" style={{ left: Math.min(rowMenu.x, window.innerWidth - 240), top: Math.min(rowMenu.y, window.innerHeight - 140) }} onClick={event => event.stopPropagation()}>
          <div className="truncate px-3 py-1 text-[11px] text-outline">{rowMenu.title}</div>
          {focus?.itemId === rowMenu.itemId
            ? <button type="button" role="menuitem" className="block w-full px-3 py-1.5 text-left hover:bg-surface-container" onClick={() => { setFocus(null); setRowMenu(null) }}>Tirar foco</button>
            : <button type="button" role="menuitem" className="block w-full px-3 py-1.5 text-left hover:bg-surface-container" onClick={() => { setFocus({ itemId: rowMenu.itemId, targetHms: null }); setRowMenu(null) }}>Focar contagem neste item</button>}
          <button type="button" role="menuitem" className="block w-full px-3 py-1.5 text-left hover:bg-surface-container" onClick={() => { if (focus?.itemId !== rowMenu.itemId) setFocus({ itemId: rowMenu.itemId, targetHms: null }); setRowMenu(null); setAlignOpen(true) }}>Alinhar até este item…</button>
        </div>
      )}
      {alignOpen && focusState && (focusState.mode === 'FILL' || focusState.mode === 'CUT') && !focusOnAir && (
        <AlignmentDialog channel={channel} view={view} status={focusState} onAirItemId={live?.transport.onAir?.itemId ?? null} library={folders.flatMap(folder => folder.assets)} categories={categorias} onClose={() => setAlignOpen(false)} onApplied={message => { setAlignOpen(false); void notify(message, 'Alinhamento aplicado') }} />
      )}
      {folderModalOpen && (
        <div
          role="dialog" aria-modal="true" aria-label="Pastas do acervo"
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

            {/* Seletor renderizado no navegador: a lista vem do servidor e
                nunca abre Explorer/WinForms na máquina onde ele roda. */}
            <div className="bg-surface-panel p-3.5 rounded-lg border border-border-subtle flex flex-col gap-2.5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <span className="font-headline-sm text-sm font-semibold text-on-surface block">
                    Pastas do Servidor
                  </span>
                  <span className="font-label-mono text-[12px] text-outline">
                    Navegue pelo disco ou NAS do servidor diretamente nesta página remota.
                  </span>
                </div>
                <button
                  onClick={() => void browseServerFolders(newFolderPath || undefined)}
                  disabled={isFolderLoading}
                  className="px-3 py-1.5 rounded bg-surface-container hover:bg-surface-container-high border border-border-subtle text-on-surface font-label-caps text-xs font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-[15px]">refresh</span>
                  Atualizar
                </button>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => serverBrowser?.parent && void browseServerFolders(serverBrowser.parent)}
                  disabled={!serverBrowser?.parent || isFolderLoading}
                  className="px-2 rounded border border-border-subtle text-outline hover:text-on-surface disabled:opacity-40"
                  title="Pasta acima"
                >
                  <span className="material-symbols-outlined text-[17px]">drive_folder_upload</span>
                </button>
                <input
                  type="text"
                  value={newFolderPath}
                  onChange={(e) => {setNewFolderPath(e.target.value);setFolderAddReview(null)}}
                  onKeyDown={(e) => { if (e.key === 'Enter') void browseServerFolders(newFolderPath) }}
                  placeholder="C:\\Midia ou \\\\NAS\\Playout"
                  className="min-w-0 flex-1 bg-surface-base border border-border-subtle rounded px-2.5 py-1.5 text-xs text-on-surface font-label-mono focus:border-primary focus:outline-none"
                />
              </div>
              <div className="max-h-36 overflow-y-auto broadcast-scroll border border-border-subtle/50 rounded bg-surface-base">
                {serverBrowser?.directories.length ? serverBrowser.directories.map((folder) => (
                  <button
                    key={folder.path}
                    type="button"
                    onClick={() => void browseServerFolders(folder.path)}
                    className="w-full text-left px-2.5 py-1.5 flex items-center gap-2 hover:bg-surface-container text-xs text-on-surface border-b border-border-subtle/40 last:border-b-0"
                  >
                    <span className="material-symbols-outlined text-[16px] text-primary">folder</span>
                    <span className="truncate">{folder.name}</span>
                  </button>
                )) : (
                  <span className="block px-3 py-4 text-center text-outline font-label-mono text-xs">
                    {isFolderLoading ? 'Consultando o servidor…' : 'Nenhuma subpasta acessível neste local.'}
                  </span>
                )}
              </div>
            </div>

            {/* Ação 2: Adição Manual por Caminho */}
            <div className="bg-surface-panel p-3.5 rounded-lg border border-border-subtle flex flex-col gap-2.5">
              <span className="font-label-caps text-[11px] text-outline font-bold uppercase tracking-wider">
                Adicionar a Pasta Selecionada
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="sm:col-span-2">
                  <input
                    type="text"
                    placeholder="Caminho selecionado no servidor"
                    value={newFolderPath}
                    onChange={(e) => {setNewFolderPath(e.target.value);setFolderAddReview(null)}}
                    className="w-full bg-surface-base border border-border-subtle rounded px-2.5 py-1.5 text-xs text-on-surface font-label-mono focus:border-primary focus:outline-none"
                  />
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
                <button className="btn small" disabled={isFolderLoading||!newFolderPath.trim()} onClick={()=>void conferFolderAdd()}>Conferir pasta e lista</button>
                <button
                  onClick={handleAddFolderManual}
                  disabled={isFolderLoading || !folderAddReview?.canEdit}
                  className="px-3 py-1.5 rounded bg-surface-container hover:bg-surface-container-high border border-border-subtle text-on-surface font-label-caps text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-[14px]">add</span>
                  <span>Adicionar Pasta Conferida</span>
                </button>
              </div>
            </div>

            {/* Lista de Pastas Atualmente Monitoradas */}
            <div className="flex flex-col gap-1.5">
              <span className="font-label-caps text-[11px] text-outline font-bold uppercase tracking-wider">
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
                        <span className="font-label-mono text-[12px] text-outline truncate" title={root.path}>
                          {root.path}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {root.present ? (
                          <span className="px-1.5 py-0.5 rounded font-label-caps text-[11px] bg-status-ok/15 text-status-ok-bright font-bold border border-status-ok/30">
                            ONLINE
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded font-label-caps text-[11px] bg-on-air-crimson/15 text-on-air-crimson font-bold border border-on-air-crimson/30">
                            FORA DO AR
                          </span>
                        )}
                        <button
                          onClick={() => handleRemoveFolder(root)}
                          disabled={isFolderLoading || !folderReview?.canEdit || mamRoots.length <= 1}
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
              <button className="btn small" disabled={isFolderLoading} onClick={()=>void loadMamRoots()}>Reabrir conferência da lista</button>
              <button
                onClick={() => {
                  onStartScan(false)
                  setFolderActionMsg('Conferência de varredura aberta. Confirme o pedido; a leitura ainda não foi iniciada por este botão.')
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
        channelId={channel.id}
        open={isConflictDrawerOpen}
        onClose={() => setIsConflictDrawerOpen(false)}
        items={view.items}
        rate={channel.rate}
        conflicts={view.schedule.conflicts}
        onAutoFill={onAutoFill}
      />
    </div>
  )
}
