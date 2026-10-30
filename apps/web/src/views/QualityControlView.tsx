import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { confirmAction } from '../domain/confirm.js'
import { durationIn, qcApproved, type Channel, type ManagedLiveSource } from '@rplayout/protocol'
import type { LibraryFolder, LibraryAsset, ScanStatus, Live } from '../types.js'
import type { Monitors as MonitorFeeds } from '../types.js'
import type { WorkspaceId } from '../components/WorkspaceShell.js'
import { dur } from '../format.js'
import { BroadcastHeader } from '../components/broadcast/BroadcastHeader.js'
import { Whep } from '../components/Whep.js'
import { api } from '../api.js'
import { canonicalLiveSourceRef, sameLiveSource } from '../liveSource.js'
import { monitorAudioStatistics } from '../components/broadcast/audio-analysis.js'
import { QcWorkflowPanel } from '../components/broadcast/QcWorkflowPanel.js'
import { CutMarksPanel } from '../components/CutMarksPanel.js'
import { QcInspectionControls } from '../components/broadcast/QcInspectionControls.js'
import { QcSafeAreaOverlay } from '../components/broadcast/QcSafeAreaOverlay.js'
import {qcOriginalUrl,qcQualityFrameUrl,qcQualitySelected,qcInspectionUsesFrames,qcMonitorLabels,qcInspectionFrameAtTime,qcInspectionVideoHasPicture,qcQualityFrameFailed} from '../domain/media-preview.js'
import {useQcLiveInspection} from '../domain/use-qc-live-inspection.js'
import {qcLiveTuningFeedback} from '../domain/qc-live-preview.js'
import {qcFrameProgress,qcLiveFrameRecent,qcScopePixels,qcStableMeasurements,type QcFrameProgress} from '../domain/qc-scope-sample.js'
import {QcRenderCost} from '../domain/qc-render-cost.js'
import {drawQcParade} from '../domain/qc-parade-draw.js'
import {QcVectorColor} from '../domain/qc-vector-color.js'
import {retryMediaJobs} from '../domain/media-job-retry.js'
import {BoundedLatestRead} from '../domain/bounded-latest-read.js'
import {QcMediaRetryControl} from '../components/broadcast/QcMediaRetryControl.js'
import {commandRequestId} from '../domain/request-id.js'
import {qcReviewMatches} from '../domain/qc-review.js'
import {useQcLiveInputs} from '../domain/use-qc-live-inputs.js'
import {QcLiveSourceRow} from '../components/broadcast/QcLiveSourceRow.js'
import type {QcReview} from '@rplayout/protocol'

interface Props {
  folders: LibraryFolder[]
  libraryLoaded?: boolean
  scan: ScanStatus | null
  onAccept: (assetId: string,review:QcReview) => void | Promise<void>
  onIgnore: (assetId: string,review:QcReview) => void | Promise<void>
  onScan: (measure: boolean) => void
  onNavigate: (workspace: WorkspaceId) => void
  sessionRole?: string
  authRequired?: boolean
  isLiveOnAir?: boolean
  channel: Channel
  channels?: Channel[]
  onSelectChannel?: (channelId: string) => void
  onOpenSettings?: () => void
  /** Abre a fonte ao vivo diretamente no barramento de preview do engine. */
  monitors?: MonitorFeeds | null
  signals?: Live['transport']['liveSources']
  transportMode?: Live['transport']['mode']
  previewTarget?: Live['transport']['preview']
  onMediaChanged?: () => void
  onPreviewLiveSource?: (sourceRef: string, title: string) => void
}

type ScopeViewMode = 'QUAD' | 'VECTORSCOPE' | 'WAVEFORM' | 'PARADE'

export function QualityControlView(props:Props){
  return <QualityControlSession key={props.channel.id} {...props}/>
}

function QualityControlSession({
  folders,
  libraryLoaded = true,
  scan,
  onAccept,
  onIgnore,
  onScan,
  onNavigate,
  sessionRole = 'Operador Master',
  authRequired = false,
  isLiveOnAir,
  channel,
  channels = [channel],
  onSelectChannel = () => {},
  onOpenSettings,
  monitors = null,
  signals = [],
  transportMode,
  previewTarget,
  onMediaChanged,
  onPreviewLiveSource,
}: Props) {
  const channelRate = channel.rate
  const fps = channelRate.num / channelRate.den || 59.94

  const assets: LibraryAsset[] = useMemo(() => folders.flatMap((f) => f.assets), [folders])
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(() => assets[0]?.id ?? null)
  const [selectedLiveSourceId, setSelectedLiveSourceId] = useState<string | null>(null)
  const [,setSignalTick]=useState(0)
  const signalNow=Date.now()
  // One clock for the visible list: lost WebSocket updates must not freeze a
  // cached READY badge. No per-source polling or native connection is added.
  useEffect(()=>{
    if(!selectedLiveSourceId)return
    const timer=window.setInterval(()=>setSignalTick(value=>value+1),1000)
    return()=>window.clearInterval(timer)
  },[selectedLiveSourceId])

  useEffect(() => {
    if (!selectedLiveSourceId && assets.length > 0 && (!selectedAssetId || !assets.some((a) => a.id === selectedAssetId))) {
      setSelectedAssetId(assets[0]?.id ?? null)
    }
  }, [assets, selectedAssetId, selectedLiveSourceId])

  const selectedAsset = selectedAssetId ? assets.find((a) => a.id === selectedAssetId) ?? null : null
  const [qcReview,setQcReview]=useState<QcReview|null>(null)
  const [qcReviewRefresh,setQcReviewRefresh]=useState(0)
  const [qcDecisionBusy,setQcDecisionBusy]=useState(false)
  const qcActionPending=useRef(false)
  const qcSelectionKey=JSON.stringify([selectedAsset?.id,selectedAsset?.contentHash,channel.id,selectedLiveSourceId])
  const qcSelectionRef=useRef(qcSelectionKey)
  qcSelectionRef.current=qcSelectionKey
  const reportQcReview=useCallback((review:QcReview|null)=>setQcReview(review),[])
  const qcDecisionReady=Boolean(!selectedLiveSourceId && qcReviewMatches(qcReview,selectedAsset?.id,selectedAsset?.contentHash,channel.id))

  // É uma sobreposição de conferência, não parte do conteúdo. Nasce desligada
  // para que nunca esconda a primeira imagem que o operador precisa avaliar.
  const [safeAreaActive, setSafeAreaActive] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'OK' | 'PENDING' | 'ALERT' | 'IGNORED'>('ALL')
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | 'VIDEO' | 'AUDIO'>('ALL')
  const [scopeMode, setScopeMode] = useState<ScopeViewMode>('QUAD')
  const liveCatalog=useQcLiveInputs(channel.id)
  const liveInputs=liveCatalog.sources,liveTelemetry=liveCatalog.telemetry
  const selectedLiveSource = liveInputs.find((source) => source.id === selectedLiveSourceId) ?? null
  const liveSourceRef=selectedLiveSource?canonicalLiveSourceRef(selectedLiveSource):null
  const [liveQualitySelection,setLiveQualitySelection]=useState<{key:string;id:string}|null>(null)
  const [liveTuningKey,setLiveTuningKey]=useState<string|null>(null)
  const liveQualityKey=JSON.stringify([channel.id,selectedLiveSourceId,liveSourceRef])
  const liveQualityActive=Boolean(selectedLiveSource && liveQualitySelection?.key===liveQualityKey)
  // The QC opens live sources in its OWN engine decoder: selecting one here
  // never CUEs the Master's PVW, and a Master CUE never closes this view.
  const liveInspection=useQcLiveInspection(channel.id,liveSourceRef,liveQualityActive,liveQualitySelection?.id)
  const livePreviewReady=liveQualityActive && liveInspection.ready
  useEffect(()=>{
    if(livePreviewReady && liveTuningKey===liveQualityKey)setLiveTuningKey(null)
  },[livePreviewReady,liveTuningKey,liveQualityKey])

  const selectLiveSource = useCallback((source: ManagedLiveSource) => {
    if(!liveCatalog.canSelect||!source.enabled)return
    setLiveQualitySelection(null)
    setIsMuted(true)
    setSelectedAssetId(null)
    setSelectedLiveSourceId(source.id)
    setQcStatusFeedback(null)
    const key=JSON.stringify([channel.id,source.id,canonicalLiveSourceRef(source)])
    setLiveTuningKey(key)
    setLiveQualitySelection({key,id:commandRequestId()})
  }, [channel.id,liveCatalog.canSelect])

  // O QC de acervo não tenta decodificar NDI/SRT/RTMP no browser. Ele mostra a
  // mesma lista de ingest do servidor e as métricas que o processo realmente
  // publicou, para que uma fonte não desapareça simplesmente por ser ao vivo.
  // Catalog identity and SRT telemetry have independent bounded GET lifecycles.
  // A telemetry outage must not erase the selected NDI/OMT/SDI source/player.

  // Modos de reprodução e fallback
  const [videoError, setVideoError] = useState(false)
  const [proxyUrl, setProxyUrl] = useState<string | null>(null)
  const [proxyMessage, setProxyMessage] = useState('Preparando preview leve…')
  const [qualitySelection,setQualitySelection]=useState<{id:string;hash:string;channelId:string}|null>(null)
  const qualityActive=liveQualityActive || qcQualitySelected(qualitySelection,selectedAsset,channel.id,Boolean(selectedLiveSourceId))
  const qualityActiveRef=useRef(qualityActive)
  qualityActiveRef.current=qualityActive
  const playbackUrl=qualityActive&&selectedAsset?qcOriginalUrl(selectedAsset):proxyUrl
  const framesOnly=qcInspectionUsesFrames(playbackUrl,videoError)
  const monitorLabels=qcMonitorLabels(Boolean(selectedLiveSourceId),qualityActive,framesOnly)
  const pendingPositionRef=useRef<number|null>(null)
  const playerFrameRef=useRef<HTMLDivElement>(null)
  const [failedMediaJobs, setFailedMediaJobs] = useState<Array<{id:string;retryRequiresConfirmation:boolean}>>([])
  const [retryingMedia,setRetryingMedia]=useState(false)
  const proxyGeneration=useRef(0)
  const workflowReads=useRef(new BoundedLatestRead())
  const mediaRetryGeneration=useRef<number|null>(null)
  const [framePos, setFramePos] = useState(0)
  const inspectionFrameUrl=selectedAsset?(qualityActive?qcQualityFrameUrl(selectedAsset,framePos):`/api/assets/${selectedAsset.id}/frame/${framePos}.jpg?total=24`):null
  const [failedQualityFrame,setFailedQualityFrame]=useState<string|null>(null)
  const qualityFrameUnavailable=qcQualityFrameFailed(Boolean(selectedLiveSourceId),qualityActive&&framesOnly,inspectionFrameUrl,failedQualityFrame)
  const inspectionFrameUrlRef=useRef(inspectionFrameUrl)
  inspectionFrameUrlRef.current=inspectionFrameUrl

  // Player controls
  const videoRef = useRef<HTMLVideoElement | null>(null)
  // O vídeo WHEP precisa ser estado além de ref: a chegada do MediaStream é
  // assíncrona e o primeiro quadro pode ocorrer depois do render que montou o
  // QC. Guardá-lo reativamente impede que os scopes continuem lendo uma ref
  // antiga/nula enquanto a imagem já está visível no player.
  const [sharedPreviewVideo, setSharedPreviewVideo] = useState<HTMLVideoElement | null>(null)
  const frameImgRef = useRef<HTMLImageElement>(null)
  const safeAreaMedia=useCallback(()=>selectedLiveSourceId?sharedPreviewVideo:framesOnly?(qualityFrameUnavailable?null:frameImgRef.current):videoRef.current,[selectedLiveSourceId,sharedPreviewVideo,framesOnly,qcSelectionKey,playbackUrl,inspectionFrameUrl,qualityFrameUnavailable])
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTimeSec, setCurrentTimeSec] = useState(0)
  const [videoDurationSec, setVideoDurationSec] = useState(0)
  const [isMuted, setIsMuted] = useState(false)
  const [volume, setVolume] = useState(0.8)
  const [qcStatusFeedback, setQcStatusFeedback] = useState<string | null>(null)
  const visibleQcStatusFeedback=qcStatusFeedback ?? qcLiveTuningFeedback(liveTuningKey,liveQualityKey,selectedLiveSource?.name,livePreviewReady)

  // Telemetria dinâmica dos escopos
  const [waveformStats, setWaveformStats] = useState<{ minIre: number; maxIre: number; avgIre: number; clipping: boolean } | null>(null)
  const [vectorscopeStats, setVectorscopeStats] = useState<{ maxSat: number; legalGamut: boolean } | null>(null)
  const [audioMeter, setAudioMeter] = useState<ReturnType<typeof monitorAudioStatistics>>({ peakL: -100, peakR: -100, phase: null, active: false })

  // Canvas refs para os escopos técnicos
  const vectorscopeCanvasRef = useRef<HTMLCanvasElement>(null)
  const waveformCanvasRef = useRef<HTMLCanvasElement>(null)
  const paradeCanvasRef = useRef<HTMLCanvasElement>(null)
  const audioSpectrumCanvasRef = useRef<HTMLCanvasElement>(null)
  const scopeAudioBuffersRef=useRef({frequency:new Uint8Array(0),left:new Float32Array(0),right:new Float32Array(0)})
  const scopeSampleReadyRef = useRef(false)
  // WHEP pode expor um intervalo curto sem frame enquanto mantém o último
  // quadro no player. Os scopes devem espelhar esse comportamento e jamais
  // piscar para preto por uma leitura transitória que falhou.
  const lastScopePixelsRef = useRef<Uint8ClampedArray | null>(null)
  const liveScopeProgressRef = useRef<QcFrameProgress | null>(null)
  // Desenhar quatro scopes é relativamente caro. A entrada pode entregar 60
  // callbacks/s, mas atualizar os canvases nessa taxa disputa a thread da UI
  // com o WHEP e produz justamente o sintoma de imagem presente com scope
  // intermitente. Limitamos a análise a 10 Hz, suficiente para inspeção QC e
  // sem perder o último quadro real.
  const lastScopeRenderAtRef = useRef(0)
  const scopeCostRef=useRef(new QcRenderCost())
  const lastScopeCostReportRef=useRef(0)
  const [scopeCost,setScopeCost]=useState<ReturnType<QcRenderCost['snapshot']>>(null)
  useEffect(()=>{
    scopeCostRef.current.reset()
    lastScopeCostReportRef.current=0
    setScopeCost(null)
  },[channel.id,selectedAsset?.id,selectedAsset?.contentHash,selectedLiveSource?.id,qualityActive,framesOnly,scopeMode])
  const [scopeSampleReady, setScopeSampleReady] = useState(false)

  // A different JPEG is a different sample. Do not retain the previous frame's
  // measurements while loading it, or present a failed quality request as QC.
  useEffect(()=>{
    if(!framesOnly)return
    lastScopePixelsRef.current=null;scopeSampleReadyRef.current=false
    setScopeSampleReady(false);setWaveformStats(null);setVectorscopeStats(null)
  },[inspectionFrameUrl,framesOnly,qualityFrameUnavailable])

  useEffect(()=>{
    if(!selectedLiveSourceId)return
    liveScopeProgressRef.current=null
    lastScopePixelsRef.current=null;scopeSampleReadyRef.current=false
    setScopeSampleReady(false);setWaveformStats(null);setVectorscopeStats(null)
    setAudioMeter({peakL:-100,peakR:-100,phase:null,active:false})
  },[selectedLiveSourceId,liveSourceRef,livePreviewReady,liveQualityActive,liveInspection.ready,sharedPreviewVideo])

  // Offscreen sampling canvas
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null)
  if (!sampleCanvasRef.current && typeof document !== 'undefined') {
    const c = document.createElement('canvas')
    c.width = 160
    c.height = 90
    sampleCanvasRef.current = c
  }

  // Web Audio API analyzer
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const gainNodeRef = useRef<GainNode | null>(null)
  const audioSourcesRef = useRef(new WeakMap<object, AudioNode>())
  const audioSourceRef = useRef<AudioNode | null>(null)
  const leftAnalyserRef = useRef<AnalyserNode | null>(null)
  const rightAnalyserRef = useRef<AnalyserNode | null>(null)
  const monitorLevelRef = useRef({ isMuted, volume })
  monitorLevelRef.current = { isMuted, volume }

  // Duração real calculada
  const totalDurationSec = useMemo(() => {
    if (videoDurationSec > 0 && Number.isFinite(videoDurationSec)) return videoDurationSec
    if (selectedAsset?.durationNs) return selectedAsset.durationNs / 1e9
    if (selectedAsset?.durationFrames && selectedAsset.durationFrames > 0) return selectedAsset.durationFrames / fps
    return 10
  }, [videoDurationSec, selectedAsset, fps])

  const totalDurationFrames = useMemo(() => {
    if (selectedAsset) {
      if (selectedAsset.durationFrames > 0) return selectedAsset.durationFrames
      if (selectedAsset.durationNs) return durationIn(selectedAsset, channelRate)
    }
    return Math.max(1, Math.round(totalDurationSec * fps))
  }, [selectedAsset, channelRate, totalDurationSec, fps])

  // Reset ao trocar de arquivo
  useEffect(() => {
    setQualitySelection(null)
    setLiveQualitySelection(null)
    pendingPositionRef.current=null
    setIsPlaying(false)
    setCurrentTimeSec(0)
    setVideoDurationSec(0)
    setVideoError(false)
    setFailedQualityFrame(null)
    setFramePos(0)
    if (videoRef.current) {
      videoRef.current.currentTime = 0
      videoRef.current.pause()
    }
    lastScopePixelsRef.current = null
    liveScopeProgressRef.current = null
    scopeSampleReadyRef.current = false
    setScopeSampleReady(false)
    setWaveformStats(null)
    setVectorscopeStats(null)
  }, [selectedAsset?.id, selectedAsset?.contentHash, selectedAsset?.probeError, selectedLiveSourceId, channel.id])

  useEffect(() => {
    let active = true
    let ready = false
    proxyGeneration.current++
    workflowReads.current.cancel()
    mediaRetryGeneration.current=null
    setProxyUrl(null)
    setFailedMediaJobs([])
    setRetryingMedia(false)
    if (!selectedAsset || selectedLiveSource) return
    const id = selectedAsset.id, hash = selectedAsset.contentHash
    const load = async () => {
      if(mediaRetryGeneration.current===proxyGeneration.current)return
      const reading=workflowReads.current.start(false)
      if(!reading)return
      try {
        const workflow = await api.mediaWorkflow(id,hash,reading.signal)
        if (!active||!reading.isCurrent()) return
        const version = workflow.versions.find(candidate => candidate.content_hash === hash)
        const failures = version?.jobs.filter(job => job.state === 'FAILED') ?? []
        setFailedMediaJobs(failures.map(job => ({id:job.id,retryRequiresConfirmation:job.retryRequiresConfirmation})))
        setProxyMessage(workflow.previewReady ? 'Proxy leve • 240p / 10 fps. Medições técnicas do arquivo original.'
          : failures.length ? `Preview indisponível: ${failures[0]?.error ?? 'falha na fila de mídia'}`
          : version?.jobs.find(job=>job.ownershipMessage)?.ownershipMessage
            ? version.jobs.find(job=>job.ownershipMessage)!.ownershipMessage!
          : selectedAsset.probeError ? `Arquivo indisponível: ${selectedAsset.probeError}`
          : !version ? 'Arquivo ainda não versionado para preview. Reescaneie o acervo.'
          : 'Proxy em preparação. A régua de quadros permanece disponível.')
        setProxyUrl(workflow.previewUrl)
        if (workflow.previewReady && !ready) { ready = true; if(!qualityActiveRef.current)setVideoError(false) }
      } catch (error) { if (active&&reading.isCurrent()) setProxyMessage(reading.timedOut()?'Consulta da fila demorou demais. O estado dos trabalhos não foi alterado.':error instanceof Error ? error.message : 'Não foi possível consultar a fila de mídia.') }
      finally{reading.finish()}
    }
    void load()
    const timer = setInterval(() => void load(), 3000)
    return () => { active = false;proxyGeneration.current++; workflowReads.current.cancel(); clearInterval(timer) }
  }, [selectedAsset?.id, selectedAsset?.contentHash, selectedLiveSource?.id])

  // Análise do áudio do proxy/monitor, antes do volume de escuta.
  // Não equivale à medição de loudness do arquivo original feita pela sonda.
  const initAudio = useCallback(() => {
    const element = videoRef.current
    if (!element) return
    // Live inspection arrives as a remote WebRTC MediaStream. Chromium delivers
    // silence to a MediaElementAudioSourceNode for remote streams, so meters
    // and listening were mute for every live input. Tap the stream itself and
    // keep the element muted (its own output would bypass the monitor fader).
    const stream = element.srcObject instanceof MediaStream ? element.srcObject : null
    if (stream) {
      element.muted = true
      if (!stream.getAudioTracks().length) return
    } else {
      // Garante que o elemento de vídeo nunca esteja mutado no DOM, preservando o fluxo de bits para o Analyser pré-fader
      element.muted = false
      element.volume = 1.0
    }
    const sourceKey: object = stream ?? element

    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!AudioCtx) return
      const ctx = audioCtxRef.current ?? new AudioCtx()
      if (ctx.state === 'suspended') {
        void ctx.resume().catch(() => {})
      }
      audioCtxRef.current = ctx
      if (audioSourceRef.current && audioSourcesRef.current.get(sourceKey) === audioSourceRef.current) return
      audioSourceRef.current?.disconnect()
      gainNodeRef.current?.disconnect()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      analyser.smoothingTimeConstant = 0.8

      {
        const source = audioSourcesRef.current.get(sourceKey) ?? (stream ? ctx.createMediaStreamSource(stream) : ctx.createMediaElementSource(element))
        audioSourcesRef.current.set(sourceKey, source)
        audioSourceRef.current = source
        // Sample peaks do monitor, sem influência do volume de escuta.
        // Mudo ou ajuste de volume de monitor do operador não afeta a medição do arquivo.
        source.connect(analyser)
        const splitter = ctx.createChannelSplitter(2)
        source.connect(splitter)
        const left = ctx.createAnalyser(), right = ctx.createAnalyser()
        left.fftSize = right.fftSize = 512
        splitter.connect(left, 0); splitter.connect(right, 1)
        leftAnalyserRef.current = left; rightAnalyserRef.current = right

        // PÓS-FADER: Controle de escuta/monitor do operador via GainNode separado
        const gainNode = ctx.createGain()
        gainNode.gain.value = monitorLevelRef.current.isMuted ? 0 : monitorLevelRef.current.volume
        source.connect(gainNode)
        gainNode.connect(ctx.destination)
        gainNodeRef.current = gainNode

      }
      audioCtxRef.current = ctx
      analyserRef.current = analyser
    } catch {
      // Audio context já conectado ou sem permissão de áudio
    }
  }, [])

  useEffect(() => () => { audioSourceRef.current?.disconnect(); void audioCtxRef.current?.close().catch(() => {}) }, [])

  const attachSharedPreviewVideo = useCallback((element: HTMLVideoElement | null) => {
    videoRef.current = element
    setSharedPreviewVideo((current) => current === element ? current : element)
    // WHEP must start muted: unmuting before a gesture can block autoplay.
    // Reuse an already unlocked context, otherwise wait for Play/audio controls.
    if (element && audioCtxRef.current?.state === 'running') initAudio()
  }, [initAudio])

  useEffect(() => {
    if (!sharedPreviewVideo) return
    // WHEP adds audio after video; reconnect the meter tap once it exists.
    const retap = () => { if (audioCtxRef.current) initAudio() }
    const stream = sharedPreviewVideo.srcObject instanceof MediaStream ? sharedPreviewVideo.srcObject : null
    sharedPreviewVideo.addEventListener('loadedmetadata', retap)
    sharedPreviewVideo.addEventListener('playing', retap)
    stream?.addEventListener('addtrack', retap)
    return () => {
      sharedPreviewVideo.removeEventListener('loadedmetadata', retap)
      sharedPreviewVideo.removeEventListener('playing', retap)
      stream?.removeEventListener('addtrack', retap)
    }
  }, [sharedPreviewVideo, initAudio])

  useEffect(() => {
    if (!sharedPreviewVideo) { if(selectedLiveSourceId)setIsPlaying(false); return }
    const update = () => setIsPlaying(!sharedPreviewVideo.paused && !sharedPreviewVideo.ended)
    update()
    sharedPreviewVideo.addEventListener('playing', update)
    sharedPreviewVideo.addEventListener('pause', update)
    sharedPreviewVideo.addEventListener('ended', update)
    return () => {
      sharedPreviewVideo.removeEventListener('playing', update)
      sharedPreviewVideo.removeEventListener('pause', update)
      sharedPreviewVideo.removeEventListener('ended', update)
    }
  }, [sharedPreviewVideo,selectedLiveSourceId])

  // Sincroniza o volume do monitor pós-fader sem afetar a medição técnica pré-fader
  useEffect(() => {
    if (gainNodeRef.current && audioCtxRef.current) {
      try {
        gainNodeRef.current.gain.setValueAtTime(
          isMuted ? 0 : volume,
          audioCtxRef.current.currentTime,
        )
      } catch {
        // Ignora erro se context fechado
      }
    }
  }, [isMuted, volume])

  // Função central de renderização dos escopos (Waveform, Vectorscope, Parade, Áudio)
  const renderScopes = useCallback((force = false) => {
    // Hidden QC must not compete with decoding or the on-air controls.
    // The next visible render recomputes freshness from the playback clock.
    if(document.hidden)return
    const now = performance.now()
    if (!force && now - lastScopeRenderAtRef.current < 100) return
    lastScopeRenderAtRef.current = now
    if(selectedLiveSource && sharedPreviewVideo){
      liveScopeProgressRef.current=qcFrameProgress(liveScopeProgressRef.current,sharedPreviewVideo.currentTime,now)
    }
    const liveFrameValid=!selectedLiveSource || livePreviewReady && qcLiveFrameRecent(liveScopeProgressRef.current,now)
    let pixels: Uint8ClampedArray | null = null
    const sCanvas = sampleCanvasRef.current
    if (sCanvas) {
      const sCtx = sCanvas.getContext('2d', { willReadFrequently: true })
      if (sCtx) {
        const sourceEl = selectedLiveSource ? sharedPreviewVideo
          : selectedAsset?.probeError && !playbackUrl ? null
          : framesOnly ? (qualityFrameUnavailable?null:frameImgRef.current) : videoRef.current
        if (sourceEl && liveFrameValid) {
          try {
            // Não aceite um canvas transparente/sem decoder como amostra. Em
            // WHEP `loadedmetadata` pode anteceder o primeiro frame real.
            if (sourceEl instanceof HTMLVideoElement && (sourceEl.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || sourceEl.videoWidth < 1 || sourceEl.videoHeight < 1)) {
              throw new Error('WHEP ainda não entregou um frame decodificado')
            }
            if (sourceEl instanceof HTMLImageElement && (!sourceEl.complete || sourceEl.naturalWidth < 1)) throw new Error('Imagem ainda não decodificada')
            // Não limpe antes de desenhar: durante uma reconfiguração WHEP o
            // drawImage pode falhar entre callbacks; manter o bitmap anterior
            // evita uma amostra preta transitória no waveform/parade.
            sCtx.drawImage(sourceEl, 0, 0, 160, 90)
            const imgData = sCtx.getImageData(0, 0, 160, 90)
            pixels = imgData.data
            // getImageData returns an independent snapshot; drawing into the
            // canvas later does not mutate it. Retain it without another copy.
            lastScopePixelsRef.current = pixels
          } catch {
            // Não apaga a última amostra durante uma lacuna do decoder.
          }
        }
      }
    }

    // Sem frame novo, reutiliza o último RGBA real. Isto mantém waveform,
    // vectorscope e parade estáveis durante jitter/reconfiguração do WHEP;
    // ao trocar a fonte o efeito acima limpa explicitamente a amostra.
    const samplePixels = qcScopePixels(Boolean(selectedLiveSource),liveFrameValid && !qualityFrameUnavailable,pixels,lastScopePixelsRef.current)
    const hasPixels = samplePixels !== null
    if (scopeSampleReadyRef.current !== hasPixels) {
      scopeSampleReadyRef.current = hasPixels
      setScopeSampleReady(hasPixels)
      if(!hasPixels){setWaveformStats(null);setVectorscopeStats(null)}
    }

    // 1. Renderiza Vectorscope de Alta Definição Digital (ITU-R BT.709)
    const vCanvas = vectorscopeCanvasRef.current
    if (vCanvas) {
      const vCtx = vCanvas.getContext('2d')
      if (vCtx) {
        const w = vCanvas.width
        const h = vCanvas.height
        const cx = w / 2
        const cy = h / 2
        const rMax = Math.min(cx, cy) * 0.88
        const r75 = rMax * 0.75
        const r50 = rMax * 0.50
        const r25 = rMax * 0.25

        // Fundo ultra-escuro digital com contraste cirúrgico
        vCtx.fillStyle = '#040711'
        vCtx.fillRect(0, 0, w, h)

        // Anéis polares graduados concêntricos (25%, 50%, 75% SMPTE Legal, 100% Gamut Limit)
        vCtx.lineWidth = 1
        vCtx.strokeStyle = 'rgba(28, 42, 65, 0.75)'
        for (const ring of [r25, r50]) {
          vCtx.beginPath()
          vCtx.arc(cx, cy, ring, 0, Math.PI * 2)
          vCtx.stroke()
        }

        // Anel 75% (SMPTE Target Legal)
        vCtx.strokeStyle = 'rgba(56, 189, 248, 0.45)'
        vCtx.setLineDash([2, 3])
        vCtx.beginPath()
        vCtx.arc(cx, cy, r75, 0, Math.PI * 2)
        vCtx.stroke()
        vCtx.setLineDash([])

        // Anel 100% (Gamut Limit)
        vCtx.strokeStyle = 'rgba(255, 59, 48, 0.35)'
        vCtx.beginPath()
        vCtx.arc(cx, cy, rMax, 0, Math.PI * 2)
        vCtx.stroke()

        // Eixos ortogonais principais com divisões milimétricas digitais
        vCtx.strokeStyle = 'rgba(38, 56, 85, 0.7)'
        vCtx.beginPath()
        vCtx.moveTo(cx, cy - rMax)
        vCtx.lineTo(cx, cy + rMax)
        vCtx.moveTo(cx - rMax, cy)
        vCtx.lineTo(cx + rMax, cy)
        vCtx.stroke()

        // Graduações angulares a cada 30 graus
        vCtx.strokeStyle = 'rgba(28, 42, 65, 0.5)'
        for (let deg = 0; deg < 360; deg += 30) {
          const rad = (deg * Math.PI) / 180
          vCtx.beginPath()
          vCtx.moveTo(cx + Math.cos(rad) * (r75 - 4), cy - Math.sin(rad) * (r75 - 4))
          vCtx.lineTo(cx + Math.cos(rad) * (r75 + 4), cy - Math.sin(rad) * (r75 + 4))
          vCtx.stroke()
        }

        // Linha de tom de pele I-Axis (~123° com corredor de tolerância cromática)
        const iRad = (123 * Math.PI) / 180
        vCtx.strokeStyle = 'rgba(255, 170, 0, 0.75)'
        vCtx.setLineDash([3, 2])
        vCtx.beginPath()
        vCtx.moveTo(cx, cy)
        vCtx.lineTo(cx + Math.cos(iRad) * rMax, cy - Math.sin(iRad) * rMax)
        vCtx.stroke()
        vCtx.setLineDash([])

        // Caixas de alvos cromáticos 75% BT.709 (R, Mg, B, Cy, G, Yl) com mira dupla e rótulo nítido
        const targets = [
          { name: 'R', angle: 104, color: '#FF334B' },
          { name: 'Mg', angle: 61, color: '#F040FF' },
          { name: 'B', angle: 347, color: '#389BFF' },
          { name: 'Cy', angle: 284, color: '#00F0FF' },
          { name: 'G', angle: 241, color: '#00E676' },
          { name: 'Yl', angle: 167, color: '#FFD600' },
        ]
        const fontSize = Math.max(8, Math.min(11, w / 26))
        vCtx.font = `bold ${fontSize}px monospace`
        vCtx.textAlign = 'center'
        vCtx.textBaseline = 'middle'
        const boxSize = Math.max(6, w / 32)
        for (const t of targets) {
          const rad = (t.angle * Math.PI) / 180
          const tx = cx + Math.cos(rad) * r75
          const ty = cy - Math.sin(rad) * r75

          vCtx.strokeStyle = t.color
          vCtx.strokeRect(tx - boxSize / 2, ty - boxSize / 2, boxSize, boxSize)
          vCtx.beginPath()
          vCtx.moveTo(tx - 2, ty)
          vCtx.lineTo(tx + 2, ty)
          vCtx.moveTo(tx, ty - 2)
          vCtx.lineTo(tx, ty + 2)
          vCtx.stroke()

          vCtx.fillStyle = t.color
          vCtx.fillText(t.name, tx + Math.cos(rad) * (boxSize * 1.6), ty - Math.sin(rad) * (boxSize * 1.6))
        }

        // Renderização digital de alta definição dos pontos cromáticos reais amostrados
        if (samplePixels) {
          let maxDist = 0
          const pointColor=new QcVectorColor(vCtx)
          const dotSize = w > 240 ? 1.5 : 1.2
          for (let i = 0; i < samplePixels.length; i += 8) {
            const r = samplePixels[i] ?? 0
            const g = samplePixels[i + 1] ?? 0
            const b = samplePixels[i + 2] ?? 0
            const cb = -0.1146 * r - 0.3854 * g + 0.5 * b
            const cr = 0.5 * r - 0.4542 * g - 0.0458 * b
            const dist = Math.hypot(cb, cr)
            if (dist > maxDist) maxDist = dist
            const px = cx + (cb / 128) * rMax
            const py = cy - (cr / 128) * rMax

            // Desenho com cor calibrada e luminescência digital nítida
            pointColor.select(r,g,b)
            vCtx.fillRect(px, py, dotSize, dotSize)
          }

          const satPercent = Math.round((maxDist / 128) * 100)
          setVectorscopeStats(previous=>qcStableMeasurements(previous,{ maxSat: satPercent, legalGamut: satPercent <= 100 }))
        } else {
          setVectorscopeStats(null)
        }
      }
    }

    // 2. Renderiza Luma Waveform Digital (0-100 IRE + Gamut Limits)
    const wCanvas = waveformCanvasRef.current
    if (wCanvas) {
      const wCtx = wCanvas.getContext('2d')
      if (wCtx) {
        const w = wCanvas.width
        const h = wCanvas.height
        wCtx.fillStyle = '#040711'
        wCtx.fillRect(0, 0, w, h)

        const y108 = h * 0.06
        const y100 = h * 0.12
        const y80 = h * 0.28
        const y50 = h * 0.52
        const y20 = h * 0.76
        const y0 = h * 0.92
        const hRange = y0 - y100

        wCtx.lineWidth = 1

        // 108 IRE (Clipping ceiling)
        wCtx.strokeStyle = 'rgba(255, 59, 48, 0.4)'
        wCtx.setLineDash([2, 4])
        wCtx.beginPath()
        wCtx.moveTo(0, y108)
        wCtx.lineTo(w, y108)
        wCtx.stroke()

        // 100 IRE (Teto Legal Broadcast)
        wCtx.strokeStyle = 'rgba(255, 59, 48, 0.8)'
        wCtx.setLineDash([])
        wCtx.beginPath()
        wCtx.moveTo(0, y100)
        wCtx.lineTo(w, y100)
        wCtx.stroke()

        // 80 e 20 IRE Linhas de referência
        wCtx.strokeStyle = 'rgba(38, 56, 85, 0.5)'
        wCtx.setLineDash([1, 4])
        for (const yRef of [y80, y20]) {
          wCtx.beginPath()
          wCtx.moveTo(0, yRef)
          wCtx.lineTo(w, yRef)
          wCtx.stroke()
        }

        // 50 IRE (Cinza Médio 18%)
        wCtx.strokeStyle = 'rgba(56, 189, 248, 0.5)'
        wCtx.setLineDash([3, 3])
        wCtx.beginPath()
        wCtx.moveTo(0, y50)
        wCtx.lineTo(w, y50)
        wCtx.stroke()
        wCtx.setLineDash([])

        // 0 IRE (Piso Legal Broadcast)
        wCtx.strokeStyle = 'rgba(0, 230, 118, 0.8)'
        wCtx.beginPath()
        wCtx.moveTo(0, y0)
        wCtx.lineTo(w, y0)
        wCtx.stroke()

        // Régua graduada na borda esquerda
        const labelSize = Math.max(8, Math.min(10, h / 20))
        wCtx.font = `bold ${labelSize}px monospace`
        wCtx.fillStyle = 'rgba(255, 59, 48, 0.9)'
        wCtx.fillText('100', 4, y100 - 2)
        wCtx.fillStyle = 'rgba(56, 189, 248, 0.8)'
        wCtx.fillText('50', 4, y50 - 2)
        wCtx.fillStyle = 'rgba(0, 230, 118, 0.9)'
        wCtx.fillText('0', 4, y0 - 2)

        if (samplePixels) {
          let minI = 100
          let maxI = 0
          let sumI = 0
          let cnt = 0

          // Traço digital luminoso em ciano neon com alta definição
          wCtx.fillStyle = 'rgba(56, 189, 248, 0.45)'
          const dotSize = w > 400 ? 1.8 : 1.2
          for (let sy = 0; sy < 90; sy += 2) {
            for (let sx = 0; sx < 160; sx += 2) {
              const idx = (sy * 160 + sx) * 4
              const r = samplePixels[idx] ?? 0
              const g = samplePixels[idx + 1] ?? 0
              const b = samplePixels[idx + 2] ?? 0
              const yVal = 0.2126 * r + 0.7152 * g + 0.0722 * b
              const ire = (yVal / 255) * 100
              if (ire < minI) minI = ire
              if (ire > maxI) maxI = ire
              sumI += ire
              cnt++

              const cx = (sx / 160) * w
              const cy = y0 - (ire / 100) * hRange
              wCtx.fillRect(cx, cy, dotSize, dotSize)
            }
          }

          const avgI = cnt > 0 ? sumI / cnt : 0
          setWaveformStats(previous=>qcStableMeasurements(previous,{
            minIre: Math.round(minI * 10) / 10,
            maxIre: Math.round(maxI * 10) / 10,
            avgIre: Math.round(avgI * 10) / 10,
            clipping: maxI > 100 || minI < 0,
          }))
        } else {
          setWaveformStats(null)
        }
      }
    }

    // 3. Renderiza RGB Parade Digital
    const pCanvas = paradeCanvasRef.current
    if (pCanvas) {
      const pCtx = pCanvas.getContext('2d')
      if (pCtx) {
        const w = pCanvas.width
        const h = pCanvas.height
        pCtx.fillStyle = '#040711'
        pCtx.fillRect(0, 0, w, h)

        const colW = w / 3
        const y100 = h * 0.12
        const y50 = h * 0.52
        const y0 = h * 0.92
        const hRange = y0 - y100

        // Divisórias das colunas R, G, B
        pCtx.strokeStyle = 'rgba(28, 42, 65, 0.85)'
        pCtx.lineWidth = 1
        pCtx.beginPath()
        pCtx.moveTo(colW, 0)
        pCtx.lineTo(colW, h)
        pCtx.moveTo(colW * 2, 0)
        pCtx.lineTo(colW * 2, h)
        pCtx.stroke()

        // Linhas de escala 0 e 100 IRE
        pCtx.setLineDash([2, 3])
        pCtx.strokeStyle = 'rgba(255, 59, 48, 0.4)'
        pCtx.beginPath()
        pCtx.moveTo(0, y100)
        pCtx.lineTo(w, y100)
        pCtx.stroke()

        pCtx.strokeStyle = 'rgba(0, 230, 118, 0.4)'
        pCtx.beginPath()
        pCtx.moveTo(0, y0)
        pCtx.lineTo(w, y0)
        pCtx.stroke()
        pCtx.setLineDash([])

        const labelSize = Math.max(8, Math.min(10, h / 22))
        pCtx.font = `bold ${labelSize}px monospace`
        pCtx.fillStyle = '#FF334B'
        pCtx.fillText('R • RED', 6, labelSize + 3)
        pCtx.fillStyle = '#00E676'
        pCtx.fillText('G • GREEN', colW + 6, labelSize + 3)
        pCtx.fillStyle = '#389BFF'
        pCtx.fillText('B • BLUE', colW * 2 + 6, labelSize + 3)

        if (samplePixels) {
          const dotSize = w > 400 ? 1.8 : 1.2
          drawQcParade(pCtx,samplePixels,colW,y0,hRange,dotSize)
        }
      }
    }

    // 4. Renderiza Áudio EBU R128 Pré-Fader & RTA Spectrum
    const aCanvas = audioSpectrumCanvasRef.current
    if (aCanvas) {
      const aCtx = aCanvas.getContext('2d')
      if (aCtx) {
        const w = aCanvas.width
        const h = aCanvas.height
        aCtx.fillStyle = '#040711'
        aCtx.fillRect(0, 0, w, h)

        let freqData: Uint8Array | null = null
        if (analyserRef.current && isPlaying) {
          if(scopeAudioBuffersRef.current.frequency.length!==analyserRef.current.frequencyBinCount)scopeAudioBuffersRef.current.frequency=new Uint8Array(analyserRef.current.frequencyBinCount)
          const data = scopeAudioBuffersRef.current.frequency
          analyserRef.current.getByteFrequencyData(data)
          freqData = data
        }

        const bars = 24
        const barW = (w - (bars - 1) * 1.5) / bars
        // All bars share the same vertical scale: one gradient per canvas pass.
        const spectrumGradient = aCtx.createLinearGradient(0, h, 0, 0)
        spectrumGradient.addColorStop(0, '#00E676')
        spectrumGradient.addColorStop(0.65, '#FFD600')
        spectrumGradient.addColorStop(0.85, '#FF9500')
        spectrumGradient.addColorStop(1, '#FF334B')

        for (let b = 0; b < bars; b++) {
          // Sem amostra real do analisador, não desenha um espectro falso.
          const val = freqData ? freqData[b * 2] || 0 : 0
          const barH = Math.max(2, (val / 255) * (h - 8))
          const bx = b * (barW + 1.5)
          const by = h - barH - 2

          // Gradiente digital nítido: Verde (-60 a -18 dBFS) -> Amarelo (-18 a -9 dBFS) -> Vermelho (-9 a 0 dBFS)
          aCtx.fillStyle = spectrumGradient
          aCtx.fillRect(bx, by, barW, barH)

          // Peak hold bar
          aCtx.fillStyle = '#FFFFFF'
          aCtx.fillRect(bx, by - 1.5, barW, 1)

        }

      }
    }
    if (isPlaying && leftAnalyserRef.current && rightAnalyserRef.current && audioCtxRef.current?.state === 'running') {
      const buffers=scopeAudioBuffersRef.current
      if(buffers.left.length!==leftAnalyserRef.current.fftSize)buffers.left=new Float32Array(leftAnalyserRef.current.fftSize)
      if(buffers.right.length!==rightAnalyserRef.current.fftSize)buffers.right=new Float32Array(rightAnalyserRef.current.fftSize)
      const {left,right}=buffers
      leftAnalyserRef.current.getFloatTimeDomainData(left); rightAnalyserRef.current.getFloatTimeDomainData(right)
      const nextAudioMeter = monitorAudioStatistics(left, right)
      setAudioMeter(previous=>qcStableMeasurements(previous,nextAudioMeter))
    } else setAudioMeter(previous=>qcStableMeasurements(previous,{ peakL: -100, peakR: -100, phase: null, active: false }))
    scopeCostRef.current.add(performance.now()-now)
    if(now-lastScopeCostReportRef.current>=1000){
      lastScopeCostReportRef.current=now
      const next=scopeCostRef.current.snapshot()
      if(next)setScopeCost(previous=>qcStableMeasurements(previous,next))
    }
  }, [framesOnly, qualityFrameUnavailable, inspectionFrameUrl, isPlaying, sharedPreviewVideo, playbackUrl, selectedLiveSource, selectedAsset?.probeError,livePreviewReady])

  // O WHEP chama renderScopes em cada frame decodificado. Este pequeno
  // fallback cobre navegadores sem requestVideoFrameCallback e mídia local,
  // mas não mantém um loop a 60fps que possa atrasar o próprio decoder.
  useEffect(() => {
    renderScopes(true)
    // Also refresh paused first frames: loadeddata can precede GPU presentation.
    // Once the player stops, 4 Hz keeps inspection responsive without full-rate decoding.
    const interval = window.setInterval(() => renderScopes(), isPlaying || selectedLiveSource ? 100 : 250)
    return () => window.clearInterval(interval)
  }, [isPlaying, renderScopes, selectedAsset?.id, selectedLiveSource?.id, scopeMode])

  // Atalho de teclado para Barra de Espaço (Play/Pause)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && (e.target as HTMLElement).tagName !== 'INPUT') {
        e.preventDefault()
        togglePlay()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  })

  const togglePlay = () => {
    initAudio()
    if (audioCtxRef.current?.state === 'suspended') {
      void audioCtxRef.current.resume().catch(() => {})
    }

    if (framesOnly) {
      setIsPlaying(false)
      setQcStatusFeedback('Inspeção por quadros: use a régua para navegar. Este modo não reproduz vídeo contínuo nem áudio.')
      return
    }
    if (!videoRef.current) return
    if (videoRef.current.paused) {
      videoRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => {
          setVideoError(true)
          setIsPlaying(false)
          setQcStatusFeedback('Não foi possível reproduzir. Inspeção por quadros disponível; sem vídeo contínuo ou conferência de áudio.')
        })
    } else {
      videoRef.current.pause()
      setIsPlaying(false)
    }
  }

  const handleFrameStep = (frames: number) => {
    const stepSec = frames / fps
    const newTime = Math.max(0, Math.min(totalDurationSec, currentTimeSec + stepSec))
    setCurrentTimeSec(newTime)

    if (framesOnly) {
      setFramePos((prev) => {
        const next = prev + (frames > 0 ? 1 : -1)
        if (next < 0) return 23
        if (next > 23) return 0
        return next
      })
      renderScopes()
      return
    }

    if (videoRef.current) {
      videoRef.current.pause()
      setIsPlaying(false)
      videoRef.current.currentTime = newTime
    }
  }

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value)
    setCurrentTimeSec(val)

    if (framesOnly) {
      const normalized = Math.min(23, Math.max(0, Math.floor((val / (totalDurationSec || 1)) * 24)))
      setFramePos(normalized)
      renderScopes()
      return
    }

    if (videoRef.current && Number.isFinite(val)) {
      videoRef.current.currentTime = val
      renderScopes()
    }
  }

  const handleJumpToFrame = (frameIndex: number) => {
    setFramePos(frameIndex)
    const targetSec = (frameIndex / 23) * totalDurationSec
    setCurrentTimeSec(targetSec)
    if (videoRef.current && Number.isFinite(targetSec)) {
      videoRef.current.currentTime = targetSec
    }
    renderScopes()
  }

  const toggleMute = () => {
    initAudio()
    const next = !isMuted
    setIsMuted(next)
    if (gainNodeRef.current && audioCtxRef.current) {
      gainNodeRef.current.gain.setValueAtTime(
        next ? 0 : volume,
        audioCtxRef.current.currentTime,
      )
    }
  }

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    initAudio()
    const v = Number(e.target.value)
    setVolume(v)
    setIsMuted(v === 0)
    if (gainNodeRef.current && audioCtxRef.current) {
      gainNodeRef.current.gain.setValueAtTime(
        v,
        audioCtxRef.current.currentTime,
      )
    }
  }

  // Decision from the row buttons: fetch this asset's own server review (same
  // version/channel binding the inspection panel uses) instead of demanding a
  // prior click on the clip. The row reflects the result immediately.
  const [quickDecided,setQuickDecided]=useState<Record<string,'APPROVED'|'IGNORED'>>({})
  const decide = async (kind:'APPROVED'|'IGNORED', id?: string) => {
    const targetId = id ?? selectedAsset?.id
    if (!targetId || qcActionPending.current) return
    const asset = assets.find(a=>a.id===targetId)
    if(!asset){setQcStatusFeedback('Arquivo não está mais no acervo; nenhuma decisão foi enviada.');return}
    const key=qcSelectionRef.current
    qcActionPending.current=true;setQcDecisionBusy(true)
    try {
      let review:QcReview|null=targetId===selectedAsset?.id&&qcDecisionReady?qcReview:null
      if(!review){
        setQcStatusFeedback('Conferindo a versão do arquivo neste canal…')
        const fresh=await api.qcAssessment(targetId,channel.id)
        if(!qcReviewMatches(fresh.review,targetId,asset.contentHash,channel.id))throw new Error('O arquivo mudou desde a última leitura do acervo; nenhuma decisão foi enviada. Reescaneie e tente de novo.')
        review=fresh.review
      }
      if(kind==='APPROVED')await onAccept(targetId,review);else await onIgnore(targetId,review)
      setQuickDecided(current=>({...current,[targetId]:kind}))
      if(targetId===selectedAsset?.id&&qcSelectionRef.current===key){setQcReview(null);setQcReviewRefresh(value=>value+1)}
      setQcStatusFeedback(kind==='APPROVED'?'Aprovação registrada para a versão conferida neste canal.':'Rejeição global registrada; arquivo enviado aos ignorados / quarentena.')
    } catch (error) {
      if(targetId===selectedAsset?.id&&qcSelectionRef.current===key)setQcReview(null)
      setQcStatusFeedback(error instanceof Error ? error.message : kind==='APPROVED'?'Não foi possível aprovar o arquivo.':'Não foi possível rejeitar o arquivo.')
    }finally{qcActionPending.current=false;setQcDecisionBusy(false)}
  }
  const handleApprove = (id?: string) => decide('APPROVED', id)
  const handleReject = async (id?: string) => {
    const target = assets.find((a) => a.id === (id ?? selectedAssetId))
    const nome = target?.title ?? target?.path ?? 'este arquivo'
    const ok = await confirmAction({ title: 'Rejeitar clipe', message: `Rejeitar "${nome}"? Vale para todos os canais: o arquivo vai para ignorados/quarentena e sai das grades.`, confirmLabel: 'Rejeitar', tone: 'danger' })
    if (ok) await decide('IGNORED', id)
  }

  const okCount = assets.filter((a) => qcApproved(a.qcStatus) && !a.probeError && !a.ignored).length
  const pendingCount = assets.filter((a) => ['PENDING', 'ANALYSIS'].includes(a.qcStatus) && !a.ignored).length
  const alertCount = assets.filter((a) => (!!a.probeError || a.qcStatus === 'FAILED') && !a.ignored).length
  const ignoredCount = assets.filter((a) => a.kind === 'VIDEO' && !!a.ignored).length
  // Sem medição o nivelamento automático do PGM não tem referência. Antes
  // cada linha dizia "LUFS N/D" e nada indicava que bastava medir.
  const withAudio = assets.filter((a) => !a.ignored && a.probe?.hasAudio !== false)
  const unmeasuredCount = withAudio.filter((a) => typeof a.loudnessFile?.integratedLufs !== 'number').length

  const filteredAssets = useMemo(() => {
    return assets.filter((original) => {
      // Row decision applies immediately; the library refresh confirms it.
      const quick=quickDecided[original.id]
      const a=quick==='IGNORED'?{...original,ignored:true}:quick==='APPROVED'?{...original,qcStatus:'APPROVED' as typeof original.qcStatus,probeError:original.probeError}:original
      // Vídeos ignorados/rejeitados só aparecem quando o operador seleciona o filtro 'IGNORED'.
      // Em 'ALL', 'OK' ou 'ALERT', arquivos ignorados são totalmente ocultados tanto do QC quanto do Master.
      if (statusFilter === 'IGNORED') {
        if (!a.ignored || a.kind !== 'VIDEO') return false
      } else {
        if (a.ignored) return false
        if (statusFilter === 'OK' && (!qcApproved(a.qcStatus) || !!a.probeError)) return false
        if (statusFilter === 'PENDING' && !['PENDING', 'ANALYSIS'].includes(a.qcStatus)) return false
        if (statusFilter === 'ALERT' && !a.probeError && a.qcStatus !== 'FAILED') return false
      }

      if (categoryFilter === 'VIDEO' && a.kind !== 'VIDEO') return false
      if (categoryFilter === 'AUDIO' && a.kind !== 'AUDIO') return false

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const matchTitle = a.title.toLowerCase().includes(q)
        const matchFile = a.fileName?.toLowerCase().includes(q)
        const matchPath = a.path.toLowerCase().includes(q)
        if (!matchTitle && !matchFile && !matchPath) return false
      }
      return true
    })
  }, [assets, statusFilter, categoryFilter, searchQuery, quickDecided])

  return (
    <div className="w-full h-full bg-surface-base text-on-surface antialiased select-none flex flex-col overflow-hidden font-body-md text-body-md">
      {/* 1. CABEÇALHO PADRÃO RPLAYOUT */}
      <BroadcastHeader
        activeWorkspace="qc"
        channel={channel}
        channels={channels}
        onSelectChannel={onSelectChannel}
        onNavigate={onNavigate}
        sessionRole={sessionRole}
        authRequired={authRequired}
        isLiveOnAir={isLiveOnAir}
        onOpenSettings={onOpenSettings}
      />

      <main className="w-full bg-surface-base flex-1 min-h-0 flex flex-col overflow-hidden">
        {/* 2. BARRA DE STATUS TÁTICO & FERRAMENTAS */}
        <div className="w-full bg-surface-card border-b border-border-subtle px-margin py-2 flex flex-wrap items-center justify-between gap-gutter shadow-sm shrink-0">
          <div className="flex items-center gap-space-md">
            <div className="w-7 h-7 rounded bg-primary-container flex items-center justify-center text-on-primary-container shadow-sm">
              <span className="material-symbols-outlined text-[18px]">rule</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-headline-md text-[13.5px] tracking-wider text-on-surface uppercase font-bold">
                  QUALITY CONTROL // INGEST &amp; ACERVO
                </span>
                <span className="font-label-caps text-[11px] px-1.5 py-0.5 rounded bg-primary/20 text-primary border border-primary/40 font-bold uppercase">
                  INSPEÇÃO VISUAL & QC
                </span>
              </div>
              <div className="flex items-center gap-3 font-label-mono text-[12px] text-outline">
                {!libraryLoaded ? <span role="status" className="text-outline animate-pulse motion-reduce:animate-none">Carregando acervo…</span> : <>
                <span>Total: <strong className="text-on-surface">{assets.length}</strong></span>
                <span>•</span>
                <span className="text-status-ok-bright font-bold">{okCount} OK</span>
                <span>•</span>
                <span className="text-primary font-bold">{pendingCount} PENDENTES</span>
                <span>•</span>
                <span className="text-armed-amber font-bold">{alertCount} ALERTAS</span>
                <span>•</span>
                <span className="text-outline">{ignoredCount} IGNORADOS</span>
                </>}
                {libraryLoaded && unmeasuredCount > 0 && (<>
                  <span>•</span>
                  <button type="button" onClick={() => onScan(true)} className="text-armed-amber font-bold underline decoration-dotted cursor-pointer" title="Sem loudness medida o nivelamento automático não tem referência. Clique para medir (EBU R128); arquivos já medidos são pulados. Usa CPU: prefira fora de horário crítico.">
                    {unmeasuredCount} SEM LOUDNESS
                  </button>
                </>)}
              </div>
            </div>
          </div>

          {/* Toast de feedback */}
          {visibleQcStatusFeedback && (
            <div role="status" className="px-3 py-1 rounded bg-accent-ice/20 border border-accent-ice text-accent-ice-bright font-label-caps text-[11px] font-bold animate-pulse">
              {visibleQcStatusFeedback}
            </div>
          )}

          {/* Quick Action Buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => onScan(false)}
              className="flex items-center gap-1 px-3 py-1 rounded bg-primary-container hover:bg-accent-ice text-on-primary-container font-label-caps text-[11px] tracking-wide transition-colors shadow-sm cursor-pointer"
              title="Sincronizar arquivos da pasta de mídia"
            >
              <span className="material-symbols-outlined text-[15px]">upload_file</span>
              <span>ESCANEAR INGEST</span>
            </button>
            <button
              onClick={() => onScan(true)}
              className="flex items-center gap-1 px-3 py-1 rounded bg-surface-panel hover:bg-surface-container border border-border-subtle text-on-surface font-label-caps text-[11px] transition-colors cursor-pointer"
              title="Calcular níveis de loudness EBU R128 para arquivos pendentes"
            >
              <span className="material-symbols-outlined text-[15px] text-accent-ice">equalizer</span>
              <span>MEDIR LOUDNESS</span>
            </button>
            <button
              onClick={() => setSafeAreaActive(!safeAreaActive)}
              aria-pressed={safeAreaActive}
              className={`flex items-center gap-1 px-2.5 py-1 rounded border transition-colors cursor-pointer font-label-caps text-[11px] ${
                safeAreaActive
                  ? 'bg-status-ok/20 border-status-ok text-status-ok-bright font-bold'
                  : 'bg-surface-panel border-border-subtle text-outline hover:text-on-surface'
              }`}
              title="Alternar retículo de Safe Areas (Title 80% / Action 90%)"
            >
              <span className="material-symbols-outlined text-[15px]">crop_free</span>
              <span>SAFE AREAS</span>
            </button>
          </div>
        </div>

        {/* 3. WORKSPACE OPERACIONAL DE 2 COLUNAS */}
        <div className="w-full flex-1 min-h-0 p-space-md grid grid-cols-12 lg:grid-rows-1 gap-space-md overflow-y-auto lg:overflow-hidden">
          {/* COLUNA ESQUERDA: LISTAGEM DE ARQUIVOS (Cols 1 a 5) */}
          <div className="col-span-12 lg:col-span-4 flex flex-col h-[60vh] lg:h-full min-h-0 bg-surface-card rounded-xl border border-border-subtle overflow-hidden shadow-md">
            {/* Barra de Filtros e Busca do Acervo */}
            <div className="p-2.5 border-b border-border-subtle bg-surface-panel/50 flex flex-col gap-2 shrink-0">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Filtrar por nome, clipe ou formato..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-surface-base border border-border-subtle rounded px-2.5 py-1.5 pl-8 font-body-sm text-body-sm text-on-surface placeholder:text-outline focus:border-primary outline-none"
                />
                <span className="material-symbols-outlined absolute left-2 top-2 text-outline text-[16px]">
                  search
                </span>
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1.5 text-outline hover:text-on-surface cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[15px]">close</span>
                  </button>
                )}
              </div>

              {/* Botões de Filtro de Status */}
              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-1 font-label-caps text-[11px]">
                  {(['ALL', 'OK', 'PENDING', 'ALERT', 'IGNORED'] as const).map((filter) => (
                    <button
                      key={filter}
                      onClick={() => {
                        setSelectedLiveSourceId(null)
                        setStatusFilter(filter)
                      }}
                      className={`px-2 py-0.5 rounded cursor-pointer transition-colors border ${
                        statusFilter === filter
                          ? 'bg-primary text-on-primary font-bold border-primary'
                          : 'bg-surface-base text-outline border-border-subtle hover:text-on-surface'
                      }`}
                    >
                      {filter === 'ALL' ? 'TODOS' : filter === 'ALERT' ? 'ALERTAS' : filter === 'PENDING' ? 'PENDENTES' : filter}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={!liveCatalog.canSelect}
                    onClick={() => {
                        const firstSource = liveInputs[0]
                        if (firstSource) selectLiveSource(firstSource)
                        else {
                          setSelectedAssetId(null)
                          setSelectedLiveSourceId(null)
                          setQcStatusFeedback('Nenhuma entrada ao vivo cadastrada neste canal.')
                        }
                    }}
                    className={`px-2 py-0.5 rounded cursor-pointer transition-colors border ${
                      selectedLiveSourceId
                        ? 'bg-accent-ice text-surface-base font-bold border-accent-ice'
                        : 'bg-surface-base text-outline border-border-subtle hover:text-on-surface'
                    }`}
                    title="Listar e inspecionar entradas ao vivo no mesmo player QC"
                  >
                    AO VIVO ({liveCatalog.loaded?liveInputs.length:'N/D'})
                  </button>
                </div>

                <div className="flex items-center gap-1 font-label-caps text-[11px]">
                  {(['ALL', 'VIDEO', 'AUDIO'] as const).map((cat) => (
                    <button
                      key={cat}
                      onClick={() => {
                        setSelectedLiveSourceId(null)
                        setCategoryFilter(cat)
                      }}
                      className={`px-2 py-0.5 rounded cursor-pointer transition-colors border ${
                        categoryFilter === cat
                          ? 'bg-accent-ice text-surface-base font-bold border-accent-ice'
                          : 'bg-surface-base text-outline border-border-subtle hover:text-on-surface'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {(!liveCatalog.loaded||liveCatalog.error||liveCatalog.telemetryError) && <div role="status" aria-label="Conferência das entradas ao vivo" className="mx-2 mb-2 rounded border border-armed-amber/40 bg-armed-amber/10 p-2 text-[11px] text-outline">
              <p>{liveCatalog.error??(!liveCatalog.loaded?'Entradas ao vivo ainda não conferidas; isso não confirma lista vazia.':null)}</p>
              {liveCatalog.telemetryError&&<p>{liveCatalog.telemetryError}</p>}
              <button type="button" disabled={liveCatalog.pending} onClick={liveCatalog.refresh} className="mt-1 text-accent-ice disabled:opacity-40">Reconsultar entradas ao vivo</button>
            </div>}
            {/* Listagem com Scroll de Clipes */}
            <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1.5 broadcast-scrollbar">
              {selectedLiveSourceId ? (
                liveInputs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center p-8 text-outline gap-2 my-auto">
                    <span className="material-symbols-outlined text-[36px] opacity-40">sensors_off</span>
                    <span className="font-body-sm text-[12px]">Nenhuma entrada ao vivo cadastrada neste canal</span>
                  </div>
                ) : (
                  liveInputs.map((source) => (
                    <QcLiveSourceRow
                      key={source.id}
                      source={source}
                      telemetry={liveTelemetry[source.id]}
                      selected={source.id === selectedLiveSourceId}
                      disabled={!liveCatalog.canSelect||!source.enabled}
                      signal={signals.find(signal => sameLiveSource(signal.source, canonicalLiveSourceRef(source)))}
                      previewTarget={previewTarget}
                      transportMode={transportMode}
                      now={signalNow}
                      policy={channel.qcProfile?.liveSignalPolicy}
                      onSelect={() => selectLiveSource(source)}
                    />
                  ))
                )
              ) : <>
              {statusFilter === 'IGNORED' && (
                <div className="p-2.5 bg-on-air-crimson/15 border border-on-air-crimson/40 rounded-lg text-[11px] text-on-surface leading-snug flex items-start gap-2 shrink-0">
                  <span className="material-symbols-outlined text-on-air-crimson text-[18px] shrink-0">block</span>
                  <div>
                    <strong className="text-on-air-crimson block font-label-caps text-[11px]">
                      Arquivos Ignorados / Quarentena ({ignoredCount})
                    </strong>
                    Estes vídeos estão ignorados ou em quarentena e não aparecem na listagem padrão nem nos seletores do Master Playout. Ignorado não significa necessariamente rejeitado no QC: consulte a situação e a conferência técnica do arquivo antes de decidir.
                  </div>
                </div>
              )}
              {filteredAssets.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-8 text-outline gap-2 my-auto">
                  <span className="material-symbols-outlined text-[36px] opacity-40">inventory_2</span>
                  <span className="font-body-sm text-[12px]">{libraryLoaded ? 'Nenhum arquivo encontrado no filtro' : 'Carregando acervo… (isso ainda não confirma acervo vazio)'}</span>
                </div>
              ) : (
                filteredAssets.map((asset) => {
                  const isSelected = asset.id === selectedAsset?.id
                  const hasAlert = !!asset.probeError || asset.qcStatus === 'FAILED'
                  const quick = quickDecided[asset.id]
                  const isPending = !quick && ['PENDING', 'ANALYSIS'].includes(asset.qcStatus)
                  const isIgnored = quick === 'IGNORED' || !!asset.ignored
                  const isApproved = !hasAlert && !isPending && !isIgnored

                  const itemDurationFrames =
                    asset.durationFrames > 0
                      ? asset.durationFrames
                      : asset.durationNs
                        ? durationIn(asset, channelRate)
                        : 0

                  return (
                    <div
                      key={asset.id}
                      onClick={() => {
                        setSelectedLiveSourceId(null)
                        setSelectedAssetId(asset.id)
                      }}
                      className={`p-2 rounded-lg border flex items-center justify-between gap-2.5 transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-primary-container/20 border-primary shadow-sm ring-1 ring-primary/40'
                          : 'bg-surface-panel hover:bg-surface-panel/80 border-border-subtle hover:border-border-strong'
                      }`}
                    >
                      {/* Thumbnail ou Ícone */}
                      <div className="relative w-12 h-8 rounded bg-surface-container-lowest overflow-hidden flex-shrink-0 border border-border-subtle">
                        <img
                          src={`/api/assets/${asset.id}/thumbnail.svg`}
                          alt=""
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            ;(e.target as HTMLImageElement).style.display = 'none'
                          }}
                        />
                        <span className="material-symbols-outlined absolute inset-0 flex items-center justify-center text-outline text-[16px] pointer-events-none -z-0">
                          {asset.kind === 'AUDIO' ? 'audiotrack' : 'movie'}
                        </span>
                      </div>

                      {/* Dados do Ativo */}
                      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`font-headline-md text-[12.5px] truncate font-bold leading-snug ${
                              isSelected ? 'text-primary' : 'text-on-surface'
                            }`}
                            title={asset.title}
                          >
                            {asset.title}
                          </span>
                          {isIgnored ? (
                            <span className="font-label-caps text-[11px] px-1 py-0.2 rounded bg-surface-container text-outline border border-border-subtle">
                              IGNORADO
                            </span>
                          ) : hasAlert ? (
                            <span className="font-label-caps text-[11px] px-1 py-0.2 rounded bg-armed-amber/20 text-armed-amber border border-armed-amber/40">
                              ALERTA
                            </span>
                          ) : isPending ? (
                            <span className="font-label-caps text-[11px] px-1 py-0.2 rounded bg-primary/15 text-primary border border-primary/40">
                              PENDENTE QC
                            </span>
                          ) : (
                            <span className="font-label-caps text-[11px] px-1 py-0.2 rounded bg-status-ok/20 text-status-ok-bright border border-status-ok/40">
                              APROVADO
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 font-label-mono text-[12px] text-outline">
                          <span className="text-on-surface">
                            {dur(itemDurationFrames, channelRate)}
                          </span>
                          <span>•</span>
                          <span>{asset.kind}</span>
                          <span>•</span>
                          {typeof asset.loudnessFile?.integratedLufs === 'number'
                            ? <span>{asset.loudnessFile.integratedLufs.toFixed(1)} LUFS</span>
                            : asset.probe?.hasAudio === false
                            ? <span>SEM ÁUDIO</span>
                            : <span className="text-armed-amber" title="Loudness não medida. Use MEDIR LOUDNESS.">LUFS não medido</span>}
                        </div>
                      </div>

                      {/* Ações Rápidas por linha */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {!isApproved && <button
                          onClick={(e) => {
                            e.stopPropagation()
                            void handleApprove(asset.id)
                          }}
                          className="px-3 hit-btn rounded bg-status-ok/15 hover:bg-status-ok text-status-ok-bright hover:text-surface-base font-label-caps t-label font-bold transition-colors cursor-pointer border border-status-ok/30"
                          title="Aprovar no QC e liberar para a grade"
                          disabled={qcDecisionBusy}
                        >
                          Aprovar
                        </button>}
                        {!isIgnored && <button
                          onClick={(e) => {
                            e.stopPropagation()
                            void handleReject(asset.id)
                          }}
                          className="px-3 hit-btn rounded bg-surface-container hover:bg-on-air-crimson/20 text-outline hover:text-on-air-crimson font-label-caps t-label font-bold transition-colors cursor-pointer border border-border-subtle"
                          title="Rejeitar: reprova o arquivo para todos os canais e o manda para a quarentena (pede confirmação)"
                          disabled={qcDecisionBusy}
                        >
                          Rejeitar
                        </button>}
                      </div>
                    </div>
                  )
                })
              )}</>}
            </div>

            {/* Rodapé da Coluna com Resumo */}
            <div className="p-2 border-t border-border-subtle bg-surface-panel/30 font-label-mono text-[12px] text-outline flex items-center justify-between shrink-0">
              <span>{selectedLiveSourceId ? `${liveInputs.length} entradas ao vivo` : libraryLoaded ? `${filteredAssets.length} clipes na fila` : 'Carregando fila de clipes…'}</span>
              <span>{selectedLiveSourceId ? 'Clique na fonte para abrir no decodificador do QC (não usa o PVW do Master)' : 'Clique no clipe para inspecionar'}</span>
            </div>
          </div>

          {/* COLUNA DIREITA: INSPEÇÃO TÉCNICA (PLAYER FRAME-ACCURATE + SCOPES) (Cols 6 a 12) */}
          <div className="col-span-12 lg:col-span-8 flex flex-col lg:h-full min-h-0 gap-2.5 lg:overflow-y-auto">
            {/* 1. PLAYER DE VÍDEO & RÉGUA DE 24 QUADROS */}
            <div className="bg-surface-card rounded-xl border border-border-subtle flex flex-col overflow-hidden shadow-md shrink-0">
              {/* Barra de Título do Player */}
              <div className="px-3 py-1.5 border-b border-border-subtle flex items-center justify-between bg-surface-panel/40">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="material-symbols-outlined text-primary text-[16px]">play_circle</span>
                  <span className="font-headline-md text-[13px] text-on-surface font-bold truncate">
                    {selectedLiveSource?.name ?? selectedAsset?.title ?? 'Nenhum ativo selecionado'}
                  </span>
                  <span className="font-label-caps text-[11px] px-1.5 py-0.5 rounded bg-surface-panel text-outline border border-border-subtle uppercase">
                    {selectedLiveSource?.kind ?? (selectedAsset?.path ? selectedAsset.path.split('.').pop() : 'VIDEO')}
                  </span>
                </div>

                {/* Timecode Header Display */}
                <div className="flex items-center gap-2 font-label-mono text-[12px]">
                  {selectedLiveSource ? (
                    <span className="px-1.5 py-0.5 rounded bg-on-air-crimson/15 text-on-air-crimson border border-on-air-crimson/35 font-label-caps text-[11px]">AO VIVO · PVW</span>
                  ) : <>
                    <span className="text-outline">TC:</span>
                    <span className="text-primary font-bold">
                      {dur(Math.floor(currentTimeSec * fps), channelRate)}
                    </span>
                    <span className="text-outline">/</span>
                    <span className="text-on-surface-variant font-medium">
                      {dur(totalDurationFrames, channelRate)}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-surface-panel text-[11px] text-outline border border-border-subtle">
                      Q: {Math.floor(currentTimeSec * fps)}/{totalDurationFrames}
                    </span>
                  </>}
                </div>
              </div>

              <QcInspectionControls hasAsset={Boolean(selectedAsset)} isLive={Boolean(selectedLiveSourceId)}
                qualityActive={qualityActive} framesOnly={framesOnly}
                onToggleQuality={()=>{
                  if(selectedLiveSource){
                    if(!monitors?.inspection){setQcStatusFeedback('Inspeção ao vivo em qualidade exige engine e servidor de mídia ativos.');return}
                    setLiveQualitySelection(liveQualityActive?null:{key:liveQualityKey,id:commandRequestId()})
                    setQcStatusFeedback(null)
                    lastScopePixelsRef.current=null;scopeSampleReadyRef.current=false;setScopeSampleReady(false)
                    setWaveformStats(null);setVectorscopeStats(null)
                    setAudioMeter({peakL:-100,peakR:-100,phase:null,active:false})
                    return
                  }
                  if(!selectedAsset)return
                  videoRef.current?.pause();setIsPlaying(false);setVideoError(false)
                  setQcStatusFeedback(null)
                  pendingPositionRef.current=currentTimeSec
                  setFramePos(qcInspectionFrameAtTime(currentTimeSec,totalDurationSec,24,!qualityActive))
                  setQualitySelection(qualityActive?null:{id:selectedAsset.id,hash:selectedAsset.contentHash,channelId:channel.id})
                  lastScopePixelsRef.current=null;scopeSampleReadyRef.current=false;setScopeSampleReady(false)
                  setWaveformStats(null);setVectorscopeStats(null)
                  setAudioMeter({peakL:-100,peakR:-100,phase:null,active:false})
                }}
                onFullscreen={()=>{void playerFrameRef.current?.requestFullscreen().catch(()=>setQcStatusFeedback('Não foi possível abrir tela cheia neste navegador.'))}}
              />

              {/*
                O quadro de inspeção é sempre 16:9. A área externa preta serve
                só como matte; overlays técnicos pertencem ao quadro, nunca à
                largura inteira do painel (onde ficariam geometricamente errados).
              */}
              <div
                ref={playerFrameRef}
                onClick={togglePlay}
                className="relative w-full max-w-[calc(46vh*16/9)] mx-auto [&:fullscreen]:max-w-none aspect-video shrink-0 bg-black flex items-center justify-center overflow-hidden cursor-pointer group [&:fullscreen_.qc-fullscreen-exit]:flex"
              >
                <button type="button" aria-label="Sair da tela cheia" title="Sair da tela cheia"
                  className="qc-fullscreen-exit hidden absolute top-3 right-3 z-50 items-center gap-2 rounded bg-black/80 text-white border border-white/30 px-3 py-2"
                  onClick={(event)=>{event.stopPropagation();void document.exitFullscreen().catch(()=>setQcStatusFeedback('Não foi possível sair da tela cheia neste navegador.'))}}>
                  <span className="material-symbols-outlined">fullscreen_exit</span>Sair da tela cheia
                </button>
                <div className="relative w-full h-full aspect-video overflow-hidden bg-black">
                  {selectedLiveSource ? (
                    !liveQualityActive ? (
                      <div role="status" className="w-full h-full flex items-center justify-center text-center text-outline font-body-sm text-[11px] px-6">
                        Inspeção pausada. Clique em “Abrir inspeção” para abrir esta entrada no decodificador do QC (o PVW do Master não é usado).
                      </div>
                    ) : !livePreviewReady ? (
                      <div role="status" className="w-full h-full flex items-center justify-center text-center text-outline font-body-sm text-[11px] px-6">
                        {liveInspection.error ?? 'Abrindo a entrada no decodificador do QC…'}
                      </div>
                    ) : monitors?.inspection ? (
                      <Whep
                        key={`${liveQualityKey}:quality`}
                        path={monitors.inspection}
                        port={monitors.port}
                        frameRate={fps}
                        hideControls
                        muted
                        onVideoElement={attachSharedPreviewVideo}
                        onVideoFrame={renderScopes}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-center text-outline font-body-sm text-[11px] px-6">
                        Conectando o preview da fonte no engine…
                      </div>
                    )
                  ) : selectedAsset ? (
                    !framesOnly && playbackUrl ? (
                      <video
                        key={playbackUrl}
                        ref={videoRef}
                        src={playbackUrl}
                        className="w-full h-full object-contain"
                        crossOrigin="anonymous"
                        preload="metadata"
                        onError={(event) => {
                          // A detached rendition must not fail the newly selected player.
                          if(event.currentTarget!==videoRef.current)return
                          setFramePos(qcInspectionFrameAtTime(event.currentTarget.currentTime,totalDurationSec,24,qualityActive))
                          setVideoError(true)
                          setIsPlaying(false)
                          if(qualityActive)setQcStatusFeedback('O navegador não decodificou o original. Inspeção por quadros em resolução até 4K (JPEG); não é playback contínuo nem prova de áudio.')
                        }}
                        onTimeUpdate={() => {
                          if (videoRef.current) {
                            setCurrentTimeSec(videoRef.current.currentTime)
                            renderScopes()
                          }
                        }}
                        onLoadedMetadata={(event) => {
                          if(event.currentTarget!==videoRef.current)return
                          if(!qcInspectionVideoHasPicture(event.currentTarget.videoWidth,event.currentTarget.videoHeight)){
                            event.currentTarget.pause()
                            setFramePos(qcInspectionFrameAtTime(currentTimeSec,totalDurationSec,24,qualityActive))
                            setVideoError(true);setIsPlaying(false)
                            if(qualityActive)setQcStatusFeedback('O navegador abriu o original sem imagem decodificável. Inspeção por quadros do original; sem reprodução contínua nem conferência de áudio.')
                            return
                          }
                          if (videoRef.current) {
                            setVideoDurationSec(videoRef.current.duration)
                            if(pendingPositionRef.current!==null){videoRef.current.currentTime=Math.min(pendingPositionRef.current,Number.isFinite(videoRef.current.duration)?videoRef.current.duration:pendingPositionRef.current);pendingPositionRef.current=null}
                            initAudio()
                            renderScopes(true)
                          }
                        }}
                        onLoadedData={() => renderScopes(true)}
                        onPlay={() => {
                          initAudio()
                          setIsPlaying(true)
                        }}
                        onPause={() => setIsPlaying(false)}
                        onEnded={() => setIsPlaying(false)}
                      />
                    ) : qualityFrameUnavailable ? (
                      <div role="status" className="w-full h-full flex flex-col items-center justify-center gap-3 text-center text-outline text-[11px] px-6">
                        <span>Quadro em qualidade indisponível. Nenhuma miniatura substitui a conferência do original.</span>
                        <button type="button" className="px-3 py-2 border border-border-strong rounded text-primary"
                          onClick={(event)=>{event.stopPropagation();setFailedQualityFrame(null);setQcStatusFeedback(null)}}>
                          Tentar este quadro novamente
                        </button>
                      </div>
                    ) : (
                      <img
                        key={inspectionFrameUrl}
                        ref={frameImgRef}
                        src={inspectionFrameUrl!}
                        onLoad={() => {if(inspectionFrameUrlRef.current===inspectionFrameUrl)renderScopes(true)}}
                        onError={(e) => {
                          if(inspectionFrameUrlRef.current!==inspectionFrameUrl)return
                          if(qualityActive){setFailedQualityFrame(inspectionFrameUrl);lastScopePixelsRef.current=null;scopeSampleReadyRef.current=false;setScopeSampleReady(false);setWaveformStats(null);setVectorscopeStats(null);setQcStatusFeedback('Quadro em qualidade indisponível. A miniatura não substitui a conferência em qualidade.');return}
                          ;(e.target as HTMLImageElement).src = `/api/assets/${selectedAsset.id}/thumbnail.svg`
                        }}
                        alt=""
                        className="w-full h-full object-contain pointer-events-none"
                      />
                    )
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <span className="font-body-sm text-outline">Selecione um clipe ou uma entrada ao vivo para inspecionar</span>
                    </div>
                  )}

                {/* Play/Pause Overlay Indicator */}
                {!isPlaying && selectedAsset && !framesOnly && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/25 pointer-events-none">
                    <div className="w-12 h-12 rounded-full bg-surface-base/80 border border-border-strong flex items-center justify-center text-primary shadow-lg group-hover:scale-110 transition-transform">
                      <span className="material-symbols-outlined text-[28px] pl-0.5">play_arrow</span>
                    </div>
                  </div>
                )}

                  {/* Match actual object-contain picture, including fullscreen. */}
                  {safeAreaActive && (selectedAsset || selectedLiveSource) && (
                    <QcSafeAreaOverlay container={playerFrameRef} getMedia={safeAreaMedia}/>
                  )}
                </div>
              </div>

              {/* Controles de Transporte e Scrubber */}
              {selectedAsset && !selectedLiveSource && <div className="px-3 py-2 border-t border-border-subtle text-[11px] text-outline flex gap-2 items-center">
                <span className="flex-1">{qualityActive?(framesOnly?'Inspeção por quadros JPEG do original · até 4K. Sem playback contínuo.':'Qualidade original · maior consumo de rede/CPU. Reprodução depende dos codecs do navegador.'):proxyMessage}</span>
                {failedMediaJobs.length > 0 && <QcMediaRetryControl key={JSON.stringify([selectedAsset.id,selectedAsset.contentHash,failedMediaJobs])} pending={retryingMedia} requiresConfirmation={failedMediaJobs.some(job=>job.retryRequiresConfirmation)} onRetry={confirmed => {
                  if(retryingMedia||mediaRetryGeneration.current===proxyGeneration.current)return
                  const requiresConfirmation=failedMediaJobs.some(job=>job.retryRequiresConfirmation)
                  if(requiresConfirmation&&!confirmed)return
                  const started=proxyGeneration.current
                  mediaRetryGeneration.current=started
                  workflowReads.current.cancel()
                  setRetryingMedia(true)
                  void retryMediaJobs(failedMediaJobs,(id,confirmed)=>api.retryMediaJob(id,confirmed)).then(result => { if(proxyGeneration.current===started){setFailedMediaJobs(result.unresolved); setProxyMessage(result.message)} })
                    .catch(error => {if(proxyGeneration.current===started)setProxyMessage(error instanceof Error ? error.message : 'Não foi possível reexecutar.')})
                    .finally(()=>{if(proxyGeneration.current===started){mediaRetryGeneration.current=null;setRetryingMedia(false)}})
                }}/>}
              </div>}
              <div className="p-2 bg-surface-panel flex flex-col gap-1.5 border-t border-border-subtle">
                <div className="flex items-center gap-2">
                  {!selectedLiveSource && <button
                    onClick={togglePlay}
                    disabled={!selectedAsset || framesOnly}
                    className="p-1 rounded bg-primary-container text-on-primary-container hover:bg-accent-ice transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center"
                    title={framesOnly ? 'Inspeção por quadros — use a régua' : isPlaying ? 'Pausar (Espaço)' : 'Reproduzir (Espaço)'}
                  >
                    <span className="material-symbols-outlined text-[17px]">
                      {isPlaying ? 'pause' : 'play_arrow'}
                    </span>
                  </button>}

                  {/* Scrubber Slider Dinâmico */}
                  {!selectedLiveSource && <input
                    type="range"
                    min={0}
                    max={totalDurationSec || 1}
                    step={1 / fps}
                    value={currentTimeSec}
                    onChange={handleScrub}
                    className="flex-1 h-2 rounded appearance-none cursor-pointer accent-primary"
                    style={{
                      background: `linear-gradient(to right, #3B82F6 0%, #3B82F6 ${(currentTimeSec / (totalDurationSec || 1)) * 100}%, #1E293B ${(currentTimeSec / (totalDurationSec || 1)) * 100}%, #1E293B 100%)`,
                    }}
                  />}

                  {/* Controles de Áudio / Volume */}
                  {(selectedAsset || selectedLiveSource) && <div className="flex items-center gap-1 pl-1 border-l border-border-subtle">
                    <button
                      onClick={toggleMute}
                      className="text-outline hover:text-on-surface cursor-pointer p-0.5"
                      title={isMuted ? 'Desmutar Áudio' : 'Mutar Áudio'}
                    >
                      <span className="material-symbols-outlined text-[16px]">
                        {isMuted || volume === 0 ? 'volume_off' : 'volume_up'}
                      </span>
                    </button>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={isMuted ? 0 : volume}
                      onChange={handleVolumeChange}
                      className="w-14 h-1.5 accent-primary cursor-pointer"
                      title={`Volume: ${Math.round((isMuted ? 0 : volume) * 100)}%`}
                    />
                  </div>}
                  {selectedLiveSource && (
                    <span className="flex-1 font-label-mono text-[12px] text-accent-ice">
                      Decodificador próprio do QC · não usa o PVW do Master
                    </span>
                  )}

                  {/* Botões Grandes de Homologação */}
                  <button
                    onClick={() => void handleApprove()}
                    disabled={!qcDecisionReady||qcDecisionBusy}
                    className="flex items-center gap-1 px-4 hit-btn rounded bg-status-ok text-surface-base font-label-caps t-label font-bold hover:bg-status-ok-bright transition-colors shadow-sm cursor-pointer disabled:opacity-40 ml-3 mr-3"
                    title="Aprovar clipe e liberar para o Master Playout"
                  >
                    <span className="material-symbols-outlined text-[14px]">check_circle</span>
                    <span>APROVAR QC</span>
                  </button>
                  <button
                    onClick={() => void handleReject()}
                    disabled={!qcDecisionReady||qcDecisionBusy}
                    className="flex items-center gap-1 px-4 hit-btn rounded bg-on-air-crimson text-white font-label-caps t-label font-bold hover:bg-on-air-crimson transition-colors shadow-sm cursor-pointer disabled:opacity-40"
                    title="Mover clipe para os rejeitados / quarentena"
                  >
                    <span className="material-symbols-outlined text-[14px]">cancel</span>
                    <span>REJEITAR</span>
                  </button>
                </div>

                {/* Scrubber Filmstrip 24 Quadros GStreamer */}
                {selectedAsset && <QcWorkflowPanel key={JSON.stringify([selectedAsset.id,selectedAsset.contentHash,channel.id])} assetId={selectedAsset.id} contentHash={selectedAsset.contentHash} channel={channel} onChanged={onMediaChanged} onReview={reportQcReview} refreshKey={qcReviewRefresh} externalBusy={qcDecisionBusy} />}
                {selectedAsset && !selectedLiveSourceId && totalDurationSec > 0 && <CutMarksPanel key={`${selectedAsset.id}:${selectedAsset.contentHash}`} assetId={selectedAsset.id} contentHash={selectedAsset.contentHash} durationMs={Math.round(totalDurationSec * 1000)} channelId={channel.id} currentTimeSec={currentTimeSec} onSeek={seconds => { setCurrentTimeSec(seconds); if (videoRef.current && Number.isFinite(seconds)) videoRef.current.currentTime = seconds }} />}
                {selectedAsset && (
                  <div className="flex items-center gap-1 overflow-x-auto py-0.5 broadcast-scrollbar">
                    {Array.from({ length: 24 }).map((_, i) => {
                      const frameSec = (i / 23) * totalDurationSec
                      const isCurrent = Math.abs(currentTimeSec - frameSec) < totalDurationSec / 24
                      return (
                        <button
                          key={i}
                          onClick={() => handleJumpToFrame(i)}
                          className={`flex-shrink-0 w-10 aspect-video bg-black rounded overflow-hidden border cursor-pointer transition-all ${
                            isCurrent
                              ? 'ring-2 ring-primary border-primary scale-105 shadow-md z-10'
                              : 'border-border-subtle opacity-65 hover:opacity-100 hover:scale-105'
                          }`}
                          title={`Quadro ${i + 1} de 24 (${dur(Math.round(frameSec * fps), channelRate)})`}
                        >
                          <img
                            src={`/api/assets/${selectedAsset.id}/frame/${i}.jpg?total=24`}
                            onError={(e) => {
                              ;(e.target as HTMLImageElement).src = `/api/assets/${selectedAsset.id}/thumbnail.svg`
                            }}
                            alt=""
                            className="w-full h-full object-cover pointer-events-none"
                            loading="lazy"
                          />
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* 2. ESCOPOS TÉCNICOS BROADCAST (VECTORSCOPE, WAVEFORM, PARADE, ÁUDIO) */}
            <div className="flex-1 min-h-64 shrink-0 bg-surface-card rounded-xl border border-border-subtle p-2.5 flex flex-col gap-2 shadow-md overflow-hidden">
              <div className="flex items-center justify-between border-b border-border-subtle pb-1 shrink-0">
                <div className="flex items-center gap-2">
                  <span className="font-headline-md text-[12px] uppercase text-on-surface font-bold flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-accent-ice text-[16px]">query_stats</span>
                    Scopes · {monitorLabels.image} · inspeção visual aproximada
                  </span>
                  <span className="font-label-mono text-[12px] px-1.5 py-0.2 rounded bg-surface-panel border border-border-subtle text-status-ok-bright">
                    MONITORAMENTO {isPlaying||selectedLiveSource?10:4} Hz
                    {scopeCost && <span title="Custo local do desenho dos scopes; não mede decoder, CPU do servidor ou rede. Últimas até 120 amostras."> · DESENHO p95 {scopeCost.p95Ms.toFixed(1)} ms</span>}
                  </span>
                </div>

                {/* Seletor de Modo de Visualização dos Escopos */}
                <div className="flex items-center gap-1 bg-surface-base p-0.5 rounded border border-border-subtle font-label-caps text-[11px]">
                  {(['QUAD', 'VECTORSCOPE', 'WAVEFORM', 'PARADE'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setScopeMode(mode)}
                      className={`px-2 py-0.5 rounded cursor-pointer transition-colors ${
                        scopeMode === mode
                          ? 'bg-primary text-on-primary font-bold shadow-sm'
                          : 'text-outline hover:text-on-surface'
                      }`}
                    >
                      {mode === 'QUAD' ? '4 EM 1' : mode}
                    </button>
                  ))}
                </div>
              </div>

              {/* Área Gráfica dos Escopos */}
              <div className="flex-1 min-h-0 overflow-hidden">
                {/* Visualização QUAD (4 em 1) */}
                {scopeMode === 'QUAD' && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 h-full">
                    {/* Scope 1: Vectorscope BT.709 */}
                    <div className="bg-surface-panel rounded border border-border-subtle p-2 flex flex-col justify-between overflow-hidden">
                      <div className="flex items-center justify-between border-b border-border-subtle/50 pb-0.5 font-label-caps text-[11px]">
                        <span className="text-accent-ice font-bold">1. VECTORSCOPE</span>
                        <span className={`font-mono text-[12px] font-bold ${!vectorscopeStats ? 'text-outline' : vectorscopeStats.legalGamut ? 'text-status-ok' : 'text-on-air-crimson'}`}>
                            {!vectorscopeStats ? 'AGUARDANDO FRAME' : 'AMOSTRA DO PLAYER'}
                        </span>
                      </div>
                      <div className="relative w-full flex-1 bg-[#05070E] rounded border border-border-subtle/60 flex items-center justify-center overflow-hidden my-1">
                        <canvas ref={vectorscopeCanvasRef} width={180} height={180} className="w-full h-full object-contain" />
                      </div>
                      <div className="flex items-center justify-between font-label-mono text-[12px] text-outline">
                        <span>I-LINE PELE</span>
                        <span className="text-accent-ice font-bold">SAT: {vectorscopeStats ? `${vectorscopeStats.maxSat}%` : '—'}</span>
                      </div>
                    </div>

                    {/* Scope 2: Luma Waveform (0-100 IRE) */}
                    <div className="bg-surface-panel rounded border border-border-subtle p-2 flex flex-col justify-between overflow-hidden">
                      <div className="flex items-center justify-between border-b border-border-subtle/50 pb-0.5 font-label-caps text-[11px]">
                        <span className="text-status-ok-bright font-bold">2. LUMA WAVEFORM</span>
                        <span className={`font-mono text-[12px] font-bold ${!waveformStats ? 'text-outline' : waveformStats.clipping ? 'text-on-air-crimson' : 'text-status-ok'}`}>
                            {!waveformStats ? 'AGUARDANDO FRAME' : 'LUMA DO PLAYER'}
                        </span>
                      </div>
                      <div className="relative w-full flex-1 bg-[#05070E] rounded border border-border-subtle/60 overflow-hidden my-1">
                        <canvas ref={waveformCanvasRef} width={260} height={140} className="w-full h-full" />
                      </div>
                      <div className="flex items-center justify-between font-label-mono text-[12px] text-outline">
                        <span>MIN: {waveformStats?.minIre ?? '—'}</span>
                        <span className="text-status-ok-bright font-bold">MAX: {waveformStats ? `${waveformStats.maxIre} IRE` : '—'}</span>
                      </div>
                    </div>

                    {/* Scope 3: RGB Parade */}
                    <div className="bg-surface-panel rounded border border-border-subtle p-2 flex flex-col justify-between overflow-hidden">
                      <div className="flex items-center justify-between border-b border-border-subtle/50 pb-0.5 font-label-caps text-[11px]">
                        <span className="text-primary font-bold">3. RGB PARADE</span>
                        <span className={`font-mono text-[12px] ${scopeSampleReady ? 'text-status-ok' : 'text-outline'}`}>{scopeSampleReady ? 'RGB DO PLAYER' : 'AGUARDANDO FRAME'}</span>
                      </div>
                      <div className="relative w-full flex-1 bg-[#05070E] rounded border border-border-subtle/60 overflow-hidden my-1">
                        <canvas ref={paradeCanvasRef} width={260} height={140} className="w-full h-full" />
                      </div>
                      <div className="flex items-center justify-between font-label-mono text-[12px] text-outline">
                        <span>BALANÇO RGB</span>
                        <span className="text-outline font-bold">{scopeSampleReady ? 'AMOSTRADO' : 'SEM AMOSTRA'}</span>
                      </div>
                    </div>

                    {/* Scope 4: Áudio EBU R128 & Spectrum (Pré-Fader) */}
                    <div className="bg-surface-panel rounded border border-border-subtle p-2 flex flex-col justify-between overflow-hidden">
                      <div className="flex items-center justify-between border-b border-border-subtle/50 pb-0.5 font-label-caps text-[11px]">
                        <div className="flex items-center gap-1">
                          <span className="text-armed-amber font-bold">4. ÁUDIO ORIGINAL / MONITOR</span>
                          <span className="text-[11px] px-1 py-0.2 rounded bg-status-ok/20 text-status-ok-bright font-bold">{monitorLabels.audio}</span>
                        </div>
                        <span className="text-status-ok font-mono text-[12px]">ALVO: {channel.targetLufs} LUFS</span>
                      </div>

                      {/* Espectrograma Real em Canvas */}
                      <div className="relative w-full h-14 bg-[#040711] rounded border border-border-subtle/60 overflow-hidden my-1">
                        <canvas ref={audioSpectrumCanvasRef} width={180} height={70} className="w-full h-full" />
                      </div>

                      {/* Métricas e VU Meters */}
                      <div className="flex flex-col gap-0.5 font-label-mono text-[12px]">
                        <div className="flex justify-between">
                          <span className="text-outline">Integrated:</span>
                          <span className="text-status-ok font-bold">
                            {typeof selectedAsset?.loudnessFile?.integratedLufs === 'number'
                              ? `${selectedAsset.loudnessFile.integratedLufs.toFixed(1)} LUFS`
                              : '—'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-outline">True Peak:</span>
                          <span className="text-status-ok font-bold">
                            {typeof selectedAsset?.loudnessFile?.truePeakDbtp === 'number'
                              ? `${selectedAsset.loudnessFile.truePeakDbtp.toFixed(1)} dBTP`
                              : '—'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-outline">LRA / Pico:</span>
                          <span className="text-accent-ice font-bold">
                            {typeof selectedAsset?.loudnessFile?.lra === 'number' ? `${selectedAsset.loudnessFile.lra.toFixed(1)} LU` : '—'} • {audioMeter.active ? `${audioMeter.peakL.toFixed(0)} dB` : '—'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Visualização Expandida: Vectorscope */}
                {scopeMode === 'VECTORSCOPE' && (
                  <div className="w-full h-full bg-[#05070E] rounded-lg border border-border-subtle flex items-center justify-center p-3 relative">
                    <canvas ref={vectorscopeCanvasRef} width={380} height={380} className="h-full aspect-square" />
                    <div className="absolute top-3 right-3 bg-surface-panel/90 border border-border-subtle p-2 rounded font-label-mono text-[12px] flex flex-col gap-1">
                      <span className="text-accent-ice font-bold">ITU-R BT.709 VECTORSCOPE</span>
                      <span className="text-outline">Saturação Máx: <strong className="text-on-surface">{vectorscopeStats ? `${vectorscopeStats.maxSat}%` : '—'}</strong></span>
                      <span className="text-outline">Gamut original: <strong>NÃO CERTIFICADO NESTA TELA</strong></span>
                      <span className="text-outline">Eixo I: <strong className="text-armed-amber">123° TRAVADO</strong></span>
                    </div>
                  </div>
                )}

                {/* Visualização Expandida: Luma Waveform */}
                {scopeMode === 'WAVEFORM' && (
                  <div className="w-full h-full bg-[#05070E] rounded-lg border border-border-subtle flex flex-col p-2 relative">
                    <canvas ref={waveformCanvasRef} width={800} height={280} className="w-full h-full" />
                    <div className="absolute top-3 right-3 bg-surface-panel/90 border border-border-subtle p-2 rounded font-label-mono text-[12px] flex gap-4">
                      <span>Mínimo: <strong className="text-status-ok">{waveformStats ? `${waveformStats.minIre} IRE` : '—'}</strong></span>
                      <span>Médio: <strong className="text-accent-ice">{waveformStats ? `${waveformStats.avgIre} IRE` : '—'}</strong></span>
                      <span>Máximo: <strong className={waveformStats?.clipping ? 'text-on-air-crimson' : 'text-status-ok'}>{waveformStats ? `${waveformStats.maxIre} IRE` : '—'}</strong></span>
                      <span>Status: <strong className="text-outline">{waveformStats ? 'LUMA DO PLAYER' : 'AGUARDANDO FRAME'}</strong></span>
                    </div>
                  </div>
                )}

                {/* Visualização Expandida: RGB Parade */}
                {scopeMode === 'PARADE' && (
                  <div className="w-full h-full bg-[#05070E] rounded-lg border border-border-subtle flex flex-col p-2 relative">
                    <canvas ref={paradeCanvasRef} width={800} height={280} className="w-full h-full" />
                    <div className="absolute top-3 right-3 bg-surface-panel/90 border border-border-subtle p-2 rounded font-label-mono text-[12px] flex gap-4">
                      <span className="text-[#FF3B30] font-bold">CANAL RED</span>
                      <span className="text-[#34C759] font-bold">CANAL GREEN</span>
                      <span className="text-[#5B9BFF] font-bold">CANAL BLUE</span>
                      <span className="text-outline font-bold">{scopeSampleReady ? 'RGB DO PLAYER' : 'AGUARDANDO FRAME'}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

