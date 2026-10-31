import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { confirmAction } from '../domain/confirm.js'
import { durationIn, qcApproved, assessQc, DEFAULT_QC_PROFILE, type Channel, type ManagedLiveSource, type Rate } from '@rplayout/protocol'
import type { LibraryFolder, LibraryAsset, ScanStatus, Live } from '../types.js'
import type { Monitors as MonitorFeeds } from '../types.js'
import type { WorkspaceId } from '../components/WorkspaceShell.js'
import { BroadcastHeader } from '../components/broadcast/BroadcastHeader.js'
import { Whep } from '../components/Whep.js'
import { api } from '../api.js'
import { canonicalLiveSourceRef, sameLiveSource } from '../liveSource.js'
import { monitorAudioStatistics } from '../components/broadcast/audio-analysis.js'
import { QcWorkflowPanel } from '../components/broadcast/QcWorkflowPanel.js'
import { CutMarksPanel } from '../components/CutMarksPanel.js'
import { QcInspectionControls } from '../components/broadcast/QcInspectionControls.js'
import { QcSafeAreaOverlay } from '../components/broadcast/QcSafeAreaOverlay.js'
import {qcOriginalUrl,qcExactFrameUrl,qcQualitySelected,qcInspectionUsesFrames,qcMonitorLabels,qcInspectionFrameAtTime,qcInspectionVideoHasPicture,qcQualityFrameFailed} from '../domain/media-preview.js'
import {useQcLiveInspection} from '../domain/use-qc-live-inspection.js'
import {qcLiveTuningFeedback} from '../domain/qc-live-preview.js'
import {qcFrameProgress,qcLiveFrameRecent,qcScopePixels,qcStableMeasurements,type QcFrameProgress} from '../domain/qc-scope-sample.js'
import {QcRenderCost} from '../domain/qc-render-cost.js'
import {analyzeScopeSample,parseYcc,sampleFromRgba,type QcScopeSample} from '../domain/qc-colorimetry.js'
import {kWeightingCoefficients,loudnessFromPower,meanSquare,ShortTermLoudness,loudnessTone,truePeakTone,formatFileIntegrated,formatPeak,TONE_CLASS} from '../domain/qc-loudness.js'
import {qcFrameCount,qcParseTimecode,qcRateLabel,qcStepFrame,qcTimecode} from '../domain/qc-timecode.js'
import {QcScopePanel,type QcScopeMode} from '../components/broadcast/QcScopePanel.js'
import {QcAudioStrip,type QcListeningMeter} from '../components/broadcast/QcAudioStrip.js'
import type {LevelUnit} from '../domain/qc-scope-draw.js'
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

/** Amostra para os scopes lida do navegador (vídeo/WHEP/JPEG): 640×360 ≥ 480 pontos por linha. */
const BROWSER_SAMPLE = {width: 640, height: 360} as const
const IDLE_METER: QcListeningMeter = {active: false, momentary: null, shortTerm: null, peakL: -Infinity, peakR: -Infinity, phase: null, muted: null}
const validRate = (rate: Rate | null | undefined): rate is Rate => Boolean(rate && rate.num > 0 && rate.den > 0)

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
  const [centerCut, setCenterCut] = useState(false)
  const [listOpen, setListOpen] = useState(true)
  const [scopeUnit, setScopeUnit] = useState<LevelUnit>('%')
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'OK' | 'PENDING' | 'ALERT' | 'IGNORED'>('ALL')
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | 'VIDEO' | 'AUDIO'>('ALL')
  const [scopeMode, setScopeMode] = useState<QcScopeMode>('COMBO')
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
  // Quadro corrente na cadência do PRÓPRIO arquivo: é o TC que o QC mostra e o
  // índice que o servidor usa para buscar o quadro exato do original.
  const fileRate: Rate = validRate(selectedAsset?.probe?.rate) ? selectedAsset!.probe!.rate : channel.rate
  const fileFps = fileRate.num / fileRate.den
  const [currentFrame, setCurrentFrame] = useState(0)
  const currentFrameRef = useRef(0)
  currentFrameRef.current = currentFrame
  // Navegação por teclado gera vários passos por segundo; o quadro só é pedido
  // ao servidor quando o operador para (custo limitado do lado de lá também).
  const [settledFrame, setSettledFrame] = useState(0)
  useEffect(() => {
    if (settledFrame === currentFrame) return
    const timer = window.setTimeout(() => setSettledFrame(currentFrame), 140)
    return () => window.clearTimeout(timer)
  }, [currentFrame, settledFrame])
  const [shuttle, setShuttle] = useState(0)
  const [videoDurationSec, setVideoDurationSec] = useState(0)
  const totalDurationSec = useMemo(() => {
    if (videoDurationSec > 0 && Number.isFinite(videoDurationSec)) return videoDurationSec
    if (selectedAsset?.durationNs) return selectedAsset.durationNs / 1e9
    if (selectedAsset?.durationFrames && selectedAsset.durationFrames > 0) return selectedAsset.durationFrames * channelRate.den / channelRate.num
    return 10
  }, [videoDurationSec, selectedAsset, channelRate])
  const totalFrames = qcFrameCount(selectedAsset?.durationNs, fileRate) ?? Math.max(1, Math.round(totalDurationSec * fileFps))
  const currentTimeSec = currentFrame / fileFps
  // Sem proxy e sem qualidade: régua de 24 quadros de navegação (aproximado).
  const stripIndex = qcInspectionFrameAtTime(settledFrame / fileFps, totalDurationSec, 24)
  const inspectionFrameUrl=selectedAsset?(qualityActive?qcExactFrameUrl(selectedAsset,settledFrame,'jpg'):`/api/assets/${selectedAsset.id}/frame/${stripIndex}.jpg?total=24`):null
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
  const [isMuted, setIsMuted] = useState(false)
  const [volume, setVolume] = useState(0.8)
  const [qcStatusFeedback, setQcStatusFeedback] = useState<string | null>(null)
  const visibleQcStatusFeedback=qcStatusFeedback ?? qcLiveTuningFeedback(liveTuningKey,liveQualityKey,selectedLiveSource?.name,livePreviewReady)

  // Amostras dos scopes. `browserSample`: o que o navegador decodificou (vídeo,
  // WHEP ou JPEG) -- aproximado, recortado em 0..100%. `exact`: Y'CbCr do
  // original no quadro exato (pausado em "Ver em qualidade").
  const [browserSample, setBrowserSample] = useState<QcScopeSample | null>(null)
  const [exact, setExact] = useState<{key: string; frame: number; sample: QcScopeSample} | null>(null)
  const [exactState, setExactState] = useState<{key: string; status: 'loading' | 'error'; message?: string} | null>(null)
  const [audioMeter, setAudioMeter] = useState<QcListeningMeter>(IDLE_METER)
  const scopeSampleReadyRef = useRef(false)
  const [scopeSampleReady, setScopeSampleReady] = useState(false)
  const lastScopePixelsRef = useRef<Uint8ClampedArray | null>(null)
  const lastBrowserSampleKeyRef = useRef<string | null>(null)
  const liveScopeProgressRef = useRef<QcFrameProgress | null>(null)
  // A entrada pode entregar 60 callbacks/s; amostrar a 10 Hz basta para QC e
  // não disputa a thread da UI com o decoder.
  const lastScopeRenderAtRef = useRef(0)
  const scopeCostRef=useRef(new QcRenderCost())
  const lastScopeCostReportRef=useRef(0)
  const [scopeCost,setScopeCost]=useState<ReturnType<QcRenderCost['snapshot']>>(null)
  const clearBrowserSample = useCallback(() => {
    lastScopePixelsRef.current = null; lastBrowserSampleKeyRef.current = null; scopeSampleReadyRef.current = false
    setScopeSampleReady(false); setBrowserSample(null)
  }, [])
  useEffect(()=>{
    scopeCostRef.current.reset()
    lastScopeCostReportRef.current=0
    setScopeCost(null)
  },[channel.id,selectedAsset?.id,selectedAsset?.contentHash,selectedLiveSource?.id,qualityActive,framesOnly])

  // A different JPEG is a different sample. Do not retain the previous frame's
  // measurements while loading it, or present a failed quality request as QC.
  useEffect(()=>{
    if(!framesOnly)return
    clearBrowserSample()
  },[inspectionFrameUrl,framesOnly,qualityFrameUnavailable,clearBrowserSample])

  useEffect(()=>{
    if(!selectedLiveSourceId)return
    liveScopeProgressRef.current=null
    clearBrowserSample()
    setAudioMeter(IDLE_METER)
  },[selectedLiveSourceId,liveSourceRef,livePreviewReady,liveQualityActive,liveInspection.ready,sharedPreviewVideo,clearBrowserSample])

  // Offscreen sampling canvas
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null)
  if (!sampleCanvasRef.current && typeof document !== 'undefined') {
    const c = document.createElement('canvas')
    c.width = BROWSER_SAMPLE.width
    c.height = BROWSER_SAMPLE.height
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
  // Ramo com o filtro K da BS.1770 por canal (M/S da escuta).
  const kLeftAnalyserRef = useRef<AnalyserNode | null>(null)
  const kRightAnalyserRef = useRef<AnalyserNode | null>(null)
  const shortTermRef = useRef(new ShortTermLoudness())
  const monitorLevelRef = useRef({ isMuted, volume })
  monitorLevelRef.current = { isMuted, volume }


  // Reset ao trocar de arquivo
  useEffect(() => {
    setQualitySelection(null)
    setLiveQualitySelection(null)
    pendingPositionRef.current=null
    setIsPlaying(false)
    setShuttle(0)
    setCurrentFrame(0)
    setSettledFrame(0)
    setVideoDurationSec(0)
    setVideoError(false)
    setFailedQualityFrame(null)
    if (videoRef.current) {
      videoRef.current.currentTime = 0
      videoRef.current.pause()
    }
    liveScopeProgressRef.current = null
    clearBrowserSample()
    setExact(null)
    setExactState(null)
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
        // ~85 ms em 48 kHz: lido a 10 Hz, quase todo pico entra na janela.
        left.fftSize = right.fftSize = 4096
        splitter.connect(left, 0); splitter.connect(right, 1)
        leftAnalyserRef.current = left; rightAnalyserRef.current = right
        // Filtro K (BS.1770) por canal; janela de 32768 amostras cobre os 400 ms da M.
        const k = kWeightingCoefficients(ctx.sampleRate)
        const weighted = [0, 1].map(channelIndex => {
          const shelf = ctx.createIIRFilter(k.shelf.b, k.shelf.a), highpass = ctx.createIIRFilter(k.highpass.b, k.highpass.a)
          const meter = ctx.createAnalyser(); meter.fftSize = 32768
          splitter.connect(shelf, channelIndex); shelf.connect(highpass); highpass.connect(meter)
          return meter
        })
        kLeftAnalyserRef.current = weighted[0]!; kRightAnalyserRef.current = weighted[1]!
        shortTermRef.current.reset()

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


  // Amostra do que o navegador está mostrando (vídeo, WHEP ou JPEG). É a
  // fonte dos scopes em reprodução, no proxy e ao vivo; no original pausado a
  // amostra exata Y'CbCr (abaixo) tem precedência.
  const exactWanted = Boolean(qualityActive && selectedAsset && !selectedLiveSourceId && !isPlaying)
  const exactKey = selectedAsset ? `${selectedAsset.id}:${selectedAsset.contentHash}:${settledFrame}` : null
  const exactFailed = exactWanted && exactState?.key === exactKey && exactState.status === 'error'
  const renderScopes = useCallback((force = false) => {
    // Hidden QC must not compete with decoding or the on-air controls.
    if(document.hidden)return
    const now = performance.now()
    if (!force && now - lastScopeRenderAtRef.current < 100) return
    lastScopeRenderAtRef.current = now
    if(selectedLiveSource && sharedPreviewVideo){
      liveScopeProgressRef.current=qcFrameProgress(liveScopeProgressRef.current,sharedPreviewVideo.currentTime,now)
    }
    // Em reprodução o TC acompanha o vídeo a 10 Hz (timeupdate é ~4 Hz).
    if(!framesOnly && !selectedLiveSource && videoRef.current && !videoRef.current.paused){
      const frame=Math.floor(videoRef.current.currentTime*fileFps+1e-3)
      if(frame!==currentFrameRef.current)setCurrentFrame(frame)
    }
    // Exato pedido e ainda válido: não gaste CPU lendo o canvas.
    if (exactWanted && !exactFailed) return
    const liveFrameValid=!selectedLiveSource || livePreviewReady && qcLiveFrameRecent(liveScopeProgressRef.current,now)
    const sourceEl = selectedLiveSource ? sharedPreviewVideo
      : selectedAsset?.probeError && !playbackUrl ? null
      : framesOnly ? (qualityFrameUnavailable?null:frameImgRef.current) : videoRef.current
    // Arquivo parado no mesmo quadro: a amostra não muda, não recalcule.
    const sampleKey = !sourceEl ? null : sourceEl instanceof HTMLImageElement ? `img:${sourceEl.currentSrc}` : selectedLiveSource ? null : `video:${sourceEl.currentSrc}:${sourceEl.currentTime}`
    if (sampleKey && sampleKey === lastBrowserSampleKeyRef.current && !force) return
    let pixels: Uint8ClampedArray | null = null
    const sCtx = sampleCanvasRef.current?.getContext('2d', { willReadFrequently: true })
    if (sCtx && sourceEl && liveFrameValid) {
      try {
        // Não aceite um canvas transparente/sem decoder como amostra. Em WHEP
        // `loadedmetadata` pode anteceder o primeiro frame real.
        if (sourceEl instanceof HTMLVideoElement && (sourceEl.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || sourceEl.videoWidth < 1 || sourceEl.videoHeight < 1)) throw new Error('sem quadro decodificado')
        if (sourceEl instanceof HTMLImageElement && (!sourceEl.complete || sourceEl.naturalWidth < 1)) throw new Error('imagem ainda não decodificada')
        sCtx.drawImage(sourceEl, 0, 0, BROWSER_SAMPLE.width, BROWSER_SAMPLE.height)
        pixels = sCtx.getImageData(0, 0, BROWSER_SAMPLE.width, BROWSER_SAMPLE.height).data
        lastScopePixelsRef.current = pixels
      } catch {
        // Não apaga a última amostra durante uma lacuna do decoder.
      }
    }
    // Sem quadro novo, só o ao vivo reaproveita o último RGBA real (jitter do WHEP).
    const samplePixels = qcScopePixels(Boolean(selectedLiveSource),liveFrameValid && !qualityFrameUnavailable,pixels,lastScopePixelsRef.current)
    const hasPixels = samplePixels !== null
    if (scopeSampleReadyRef.current !== hasPixels) { scopeSampleReadyRef.current = hasPixels; setScopeSampleReady(hasPixels) }
    if (!samplePixels) { setBrowserSample(null); lastBrowserSampleKeyRef.current = null }
    else if (pixels || selectedLiveSource) {
      lastBrowserSampleKeyRef.current = pixels ? sampleKey : null
      setBrowserSample(sampleFromRgba(samplePixels, BROWSER_SAMPLE.width, BROWSER_SAMPLE.height))
    }
    scopeCostRef.current.add(performance.now()-now)
    if(now-lastScopeCostReportRef.current>=1000){
      lastScopeCostReportRef.current=now
      const next=scopeCostRef.current.snapshot()
      if(next)setScopeCost(previous=>qcStableMeasurements(previous,next))
    }
  }, [framesOnly, qualityFrameUnavailable, inspectionFrameUrl, sharedPreviewVideo, playbackUrl, selectedLiveSource, selectedAsset?.probeError, livePreviewReady, exactWanted, exactFailed, fileFps])

  // O WHEP chama renderScopes em cada frame decodificado. Este fallback cobre
  // mídia local sem manter um loop a 60 fps que atrase o próprio decoder.
  useEffect(() => {
    renderScopes(true)
    const interval = window.setInterval(() => renderScopes(), isPlaying || selectedLiveSource ? 100 : 250)
    return () => window.clearInterval(interval)
  }, [isPlaying, renderScopes, selectedAsset?.id, selectedLiveSource?.id])

  // Quadro exato do original para os scopes: Y'CbCr cru, sem o navegador no
  // meio. Só em "Ver em qualidade" (opt-in de custo) e com a imagem parada.
  useEffect(() => {
    if (!exactWanted || !selectedAsset || !exactKey) return
    if (exact?.key === exactKey) return
    const asset = selectedAsset, frame = settledFrame, key = exactKey
    const controller = new AbortController()
    let retry: number | undefined
    setExactState({key, status: 'loading'})
    const load = async (attempt: number) => {
      try {
        const response = await fetch(qcExactFrameUrl(asset, frame, 'ycc'), {signal: controller.signal})
        // Servidor ocupado (limite de custo): tenta de novo quando ele liberar.
        if (response.status === 503 && attempt < 8) { retry = window.setTimeout(() => void load(attempt + 1), 700); return }
        if (!response.ok) {
          let message = `HTTP ${response.status}`
          try { message = ((await response.json()) as {error?: string}).error ?? message } catch { /* corpo não-JSON */ }
          throw new Error(message)
        }
        const sample = parseYcc(await response.arrayBuffer())
        if (controller.signal.aborted) return
        setExact({key, frame, sample}); setExactState(null)
      } catch (error) {
        if (controller.signal.aborted) return
        setExactState({key, status: 'error', message: error instanceof Error ? error.message : 'Amostra exata indisponível.'})
      }
    }
    void load(0)
    return () => { controller.abort(); if (retry !== undefined) window.clearTimeout(retry) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exactWanted, exactKey])

  const exactCurrent = exactWanted && exact?.key === exactKey ? exact.sample : null
  // Enquanto o próximo quadro exato chega, mantém o anterior -- o cabeçalho diz qual é.
  const exactShown = exactWanted ? (exactCurrent ?? (!exactFailed && exact?.key.startsWith(`${selectedAsset?.id}:${selectedAsset?.contentHash}:`) ? exact.sample : null)) : null
  const scopeSample: QcScopeSample | null = exactShown ?? (exactWanted && !exactFailed ? null : browserSample)
  const scopeStats = useMemo(() => scopeSample ? analyzeScopeSample(scopeSample) : null, [scopeSample])
  const scopeStatus = (() => {
    if (exactWanted) {
      if (exactCurrent) return {text: `Y'CbCr DO ORIGINAL · EXATO · ${qcTimecode(exact!.frame, fileRate)} · 4:4:4 BT.709`, tone: 'exact' as const}
      if (exactFailed) return {text: `Amostra exata indisponível (${exactState?.message}) · usando RGB do navegador (aprox.)`, tone: 'approx' as const}
      return {text: exact && exactShown ? `Mostrando ${qcTimecode(exact.frame, fileRate)} · carregando ${qcTimecode(settledFrame, fileRate)}…` : `Carregando Y'CbCr de ${qcTimecode(settledFrame, fileRate)}…`, tone: 'approx' as const}
    }
    if (!browserSample) return {text: 'AGUARDANDO FRAME', tone: 'idle' as const}
    return {text: `RGB DECODIFICADO PELO NAVEGADOR · ${monitorLabels.image} · aproximado`, tone: 'approx' as const}
  })()

  // Escuta: M (400 ms) e S (3 s) com filtro K, picos L/R e correlação a 10 Hz.
  useEffect(() => {
    if (!isPlaying) { setAudioMeter(IDLE_METER); shortTermRef.current.reset(); return }
    const buffers = {left: new Float32Array(4096), right: new Float32Array(4096), kLeft: new Float32Array(32768), kRight: new Float32Array(32768)}
    const timer = window.setInterval(() => {
      const ctx = audioCtxRef.current, left = leftAnalyserRef.current, right = rightAnalyserRef.current
      if (!ctx || ctx.state !== 'running' || !left || !right) return
      left.getFloatTimeDomainData(buffers.left); right.getFloatTimeDomainData(buffers.right)
      const stats = monitorAudioStatistics(buffers.left, buffers.right)
      let momentary: number | null = null, shortTerm: number | null = null
      if (kLeftAnalyserRef.current && kRightAnalyserRef.current) {
        kLeftAnalyserRef.current.getFloatTimeDomainData(buffers.kLeft); kRightAnalyserRef.current.getFloatTimeDomainData(buffers.kRight)
        const window400 = Math.round(ctx.sampleRate * 0.4)
        const power = meanSquare(buffers.kLeft, window400) + meanSquare(buffers.kRight, window400)
        momentary = loudnessFromPower(power)
        shortTermRef.current.push(performance.now(), power)
        shortTerm = shortTermRef.current.value()
      }
      setAudioMeter({active: stats.active, momentary, shortTerm, peakL: stats.peakL, peakR: stats.peakR, phase: stats.phase, muted: stats.muted})
    }, 100)
    return () => window.clearInterval(timer)
  }, [isPlaying])

  const seekToFrame = useCallback((frame: number) => {
    const target = qcStepFrame(frame, 0, totalFrames)
    setCurrentFrame(target)
    if (!framesOnly && videoRef.current) {
      // Mira o meio do quadro: o decoder mostra exatamente este quadro.
      const duration = Number.isFinite(videoRef.current.duration) ? videoRef.current.duration : Infinity
      videoRef.current.currentTime = Math.min((target + 0.5) / fileFps, Math.max(0, duration - 0.5 / fileFps))
    }
  }, [totalFrames, framesOnly, fileFps])

  const pauseVideo = () => {
    if (videoRef.current && !videoRef.current.paused) videoRef.current.pause()
    if (videoRef.current) videoRef.current.playbackRate = 1
    setIsPlaying(false)
  }

  const stepFrames = useCallback((delta: number) => {
    if (selectedLiveSourceId || !selectedAsset) return
    if (videoRef.current && !videoRef.current.paused) { videoRef.current.pause(); setIsPlaying(false) }
    seekToFrame(currentFrameRef.current + delta)
  }, [selectedLiveSourceId, selectedAsset, seekToFrame])

  const togglePlay = () => {
    initAudio()
    if (audioCtxRef.current?.state === 'suspended') {
      void audioCtxRef.current.resume().catch(() => {})
    }
    setShuttle(0)
    if (framesOnly) {
      setIsPlaying(false)
      setQcStatusFeedback('Inspeção por quadros: use ←/→ (quadro), Shift+←/→ (1 s) ou J/L. Este modo não reproduz vídeo contínuo nem áudio.')
      return
    }
    if (!videoRef.current) return
    if (videoRef.current.paused) {
      videoRef.current.playbackRate = 1
      videoRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => {
          setVideoError(true)
          setIsPlaying(false)
          setQcStatusFeedback('Não foi possível reproduzir. Inspeção por quadros disponível; sem vídeo contínuo ou conferência de áudio.')
        })
    } else {
      pauseVideo()
    }
  }

  // J/K/L: L avança (repetir dobra até 4×), K para, J volta (repetir dobra).
  const shuttleKey = (key: 'J' | 'K' | 'L') => {
    if (selectedLiveSourceId || !selectedAsset) return
    if (key === 'K') { setShuttle(0); pauseVideo(); return }
    const direction = key === 'L' ? 1 : -1
    const next = Math.sign(shuttle) === direction ? Math.max(-4, Math.min(4, shuttle * 2)) : direction
    setShuttle(next)
    if (!framesOnly && videoRef.current && direction > 0) {
      initAudio()
      videoRef.current.playbackRate = next
      void videoRef.current.play().then(() => setIsPlaying(true)).catch(() => setShuttle(0))
    } else if (!framesOnly && videoRef.current) {
      pauseVideo()
    } else if (framesOnly) {
      // Por quadros: dá o primeiro passo; os seguintes saem quando cada quadro carregar.
      seekToFrame(currentFrameRef.current + next)
    }
  }
  // Ré no vídeo (o navegador não toca para trás) e shuttle no modo por quadros.
  useEffect(() => {
    if (!shuttle || (!framesOnly && shuttle > 0)) return
    if (framesOnly) return
    const timer = window.setInterval(() => {
      if (currentFrameRef.current <= 0) { setShuttle(0); return }
      seekToFrame(currentFrameRef.current - Math.max(1, Math.round(fileFps * 0.1 * Math.abs(shuttle))))
    }, 100)
    return () => window.clearInterval(timer)
  }, [shuttle, framesOnly, fileFps, seekToFrame])
  const advanceShuttleAfterLoad = () => {
    if (!framesOnly || !shuttle) return
    const next = qcStepFrame(currentFrameRef.current, shuttle, totalFrames)
    if (next === currentFrameRef.current) { setShuttle(0); return }
    window.setTimeout(() => seekToFrame(next), 0)
  }

  // Teclado do QC: ←/→ ±1 quadro, Shift ±1 s, Home/End, J/K/L, Espaço.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); return }
      if (selectedLiveSourceId || !selectedAsset) return
      const second = Math.max(1, Math.round(fileFps))
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault(); setShuttle(0)
        stepFrames((e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? second : 1))
      } else if (e.key === 'Home') { e.preventDefault(); setShuttle(0); stepFrames(-totalFrames) }
      else if (e.key === 'End') { e.preventDefault(); setShuttle(0); stepFrames(totalFrames) }
      else if (['j', 'k', 'l', 'J', 'K', 'L'].includes(e.key)) { e.preventDefault(); shuttleKey(e.key.toUpperCase() as 'J' | 'K' | 'L') }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  })

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    setShuttle(0)
    seekToFrame(Number(e.target.value))
  }

  // Régua de navegação: cada miniatura vem do meio da sua fatia (proxy).
  const handleJumpToFrame = (stripPosition: number) => {
    setShuttle(0)
    if (videoRef.current && !videoRef.current.paused) pauseVideo()
    seekToFrame(Math.floor((stripPosition + 0.5) / 24 * totalFrames))
  }

  const [tcDraft, setTcDraft] = useState<string | null>(null)
  const commitTimecode = () => {
    if (tcDraft === null) return
    const frame = qcParseTimecode(tcDraft, fileRate)
    if (frame === null) { setQcStatusFeedback(`TC inválido para ${qcRateLabel(fileRate)}: use HH:MM:SS:FF${fileRate.den === 1001 ? ' (;FF em drop-frame)' : ''}.`); return }
    setTcDraft(null); setShuttle(0); stepFrames(frame - currentFrameRef.current)
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

  const qcProfile = channel.qcProfile ?? DEFAULT_QC_PROFILE


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
  // Avisos técnicos (âmbar), separados de erros (vermelho). O assessQc com a
  // referência do canal (3º parâmetro) devolve loudness/TP fora da faixa,
  // cadência, raster, varredura etc.; numa versão que ainda não o aceita, o
  // parâmetro extra é ignorado e contam só os avisos que ela já dá.
  const warningCount = useMemo(() => {
    const assess = assessQc as unknown as (asset: LibraryAsset, profile: typeof qcProfile, channel?: Channel) => {warnings?: string[]}
    return assets.filter(a => !a.ignored && !a.probeError && a.qcStatus !== 'FAILED' && (assess(a, qcProfile, channel).warnings ?? [])
      .some(warning => !warning.startsWith('Compatibilidade de legado'))).length
  }, [assets, qcProfile, channel])
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


  const selectedLoudness = selectedAsset?.loudnessFile ?? null
  const listening = selectedLiveSource ? monitorLabels.audio : framesOnly ? null : monitorLabels.audio
  const navDisabled = !selectedAsset || Boolean(selectedLiveSource)
  const navButton = 'flex items-center justify-center min-w-[32px] hit-btn px-1.5 rounded border border-border-subtle bg-surface-base text-on-surface hover:border-primary hover:text-primary cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed font-label-mono text-[11px]'

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
        <div className="w-full bg-surface-card border-b border-border-subtle px-margin py-1.5 flex flex-wrap items-center justify-between gap-gutter shadow-sm shrink-0">
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
                <span className={`font-bold ${alertCount ? 'text-on-air-crimson' : 'text-outline'}`} title="Erros: arquivo não sondado ou reprovado na verificação técnica">{alertCount} ALERTAS</span>
                <span>•</span>
                <span className={`font-bold ${warningCount ? 'text-armed-amber' : 'text-outline'}`} title="Avisos técnicos contra o perfil e o canal (loudness/TP fora da faixa, cadência, raster, varredura, canais, áudio mudo); não bloqueiam">{warningCount} AVISOS</span>
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
              title="Safe areas HD (SMPTE ST 2046-1 / EBU R95): action 93%, graphics 90%"
            >
              <span className="material-symbols-outlined text-[15px]">crop_free</span>
              <span>SAFE AREAS</span>
            </button>
            <button
              onClick={() => { setCenterCut(!centerCut); if (!centerCut) setSafeAreaActive(true) }}
              aria-pressed={centerCut}
              className={`flex items-center gap-1 px-2 py-1 rounded border transition-colors cursor-pointer font-label-caps text-[11px] ${
                centerCut ? 'bg-armed-amber/20 border-armed-amber text-armed-amber font-bold' : 'bg-surface-panel border-border-subtle text-outline hover:text-on-surface'
              }`}
              title="Área de proteção 4:3 (center cut) para material que também vai a SD 4:3"
            >
              4:3
            </button>
            <button
              onClick={() => setListOpen(!listOpen)}
              aria-pressed={listOpen}
              className="hidden lg:flex items-center gap-1 px-2 py-1 rounded border bg-surface-panel border-border-subtle text-outline hover:text-on-surface cursor-pointer font-label-caps text-[11px]"
              title={listOpen ? 'Recolher a lista do acervo e ampliar a inspeção' : 'Mostrar a lista do acervo'}
            >
              <span className="material-symbols-outlined text-[15px]">{listOpen ? 'left_panel_close' : 'left_panel_open'}</span>
              <span>ACERVO</span>
            </button>
          </div>
        </div>

        {/* 3. WORKSPACE: acervo (recolhível) | inspeção (player + scopes, áudio, decisão) */}
        <div className="w-full flex-1 min-h-0 p-2 flex flex-col lg:flex-row gap-2 overflow-y-auto lg:overflow-hidden">
          {/* COLUNA ESQUERDA: LISTAGEM DE ARQUIVOS (recolhível em telas largas) */}
          <div className={`${listOpen ? 'lg:flex' : 'lg:hidden'} w-full lg:w-[290px] xl:w-[330px] 2xl:w-[380px] shrink-0 flex flex-col h-[60vh] lg:h-full min-h-0 bg-surface-card rounded-xl border border-border-subtle overflow-hidden shadow-md`}>
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
              <div className="flex flex-wrap items-center justify-between gap-1">
                <div className="flex flex-wrap items-center gap-1 font-label-caps text-[11px]">
                  {(['ALL', 'OK', 'PENDING', 'ALERT', 'IGNORED'] as const).map((filter) => (
                    <button
                      key={filter}
                      onClick={() => {
                        setSelectedLiveSourceId(null)
                        setStatusFilter(filter)
                      }}
                      className={`px-2 py-0.5 hit-chip whitespace-nowrap rounded cursor-pointer transition-colors border ${
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
                    className={`px-2 py-0.5 hit-chip whitespace-nowrap rounded cursor-pointer transition-colors border ${
                      selectedLiveSourceId
                        ? 'bg-accent-ice text-surface-base font-bold border-accent-ice'
                        : 'bg-surface-base text-outline border-border-subtle hover:text-on-surface'
                    }`}
                    title="Listar e inspecionar entradas ao vivo no mesmo player QC"
                  >
                    AO VIVO ({liveCatalog.loaded?liveInputs.length:'N/D'})
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-1 font-label-caps text-[11px]">
                  {(['ALL', 'VIDEO', 'AUDIO'] as const).map((cat) => (
                    <button
                      key={cat}
                      onClick={() => {
                        setSelectedLiveSourceId(null)
                        setCategoryFilter(cat)
                      }}
                      className={`px-2 py-0.5 hit-chip whitespace-nowrap rounded cursor-pointer transition-colors border ${
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
                        {/* Quadro real do meio do arquivo (régua do proxy, sob demanda);
                            sem proxy pronto o servidor devolve a miniatura de sempre. */}
                        <img
                          src={`/api/assets/${asset.id}/frame/12.jpg?total=24`}
                          alt=""
                          loading="lazy"
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
                            <span className="shrink-0 whitespace-nowrap font-label-caps text-[11px] px-1 py-0.2 rounded bg-surface-container text-outline border border-border-subtle">
                              IGNORADO
                            </span>
                          ) : hasAlert ? (
                            <span className="shrink-0 whitespace-nowrap font-label-caps text-[11px] px-1 py-0.2 rounded bg-armed-amber/20 text-armed-amber border border-armed-amber/40">
                              ALERTA
                            </span>
                          ) : isPending ? (
                            <span className="shrink-0 whitespace-nowrap font-label-caps text-[11px] px-1 py-0.2 rounded bg-primary/15 text-primary border border-primary/40">
                              PENDENTE QC
                            </span>
                          ) : (
                            <span className="shrink-0 whitespace-nowrap font-label-caps text-[11px] px-1 py-0.2 rounded bg-status-ok/20 text-status-ok-bright border border-status-ok/40">
                              APROVADO
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0 font-label-mono text-[12px] text-outline [&>span]:whitespace-nowrap">
                          <span className="text-on-surface" title={`Duração · ${asset.kind}`}>
                            {qcTimecode(itemDurationFrames, channelRate)}
                          </span>
                          {typeof asset.loudnessFile?.integratedLufs === 'number'
                            ? <span title={`Faixa do perfil: ${qcProfile.minLufs}…${qcProfile.maxLufs} LUFS · TP ≤ ${qcProfile.maxTruePeakDbtp} dBTP`}>
                                <span className={TONE_CLASS[loudnessTone(asset.loudnessFile.integratedLufs, qcProfile)]}>{formatFileIntegrated(asset.loudnessFile.integratedLufs, true)}</span>
                                {' · '}<span className={TONE_CLASS[truePeakTone(asset.loudnessFile.truePeakDbtp, qcProfile)]}>{formatPeak(asset.loudnessFile.truePeakDbtp, 'dBTP')}</span>
                              </span>
                            : asset.probe?.hasAudio === false
                            ? <span>SEM ÁUDIO</span>
                            : <span className="text-armed-amber" title="Loudness não medida. Use MEDIR LOUDNESS.">LUFS não medido</span>}
                        </div>
                      </div>

                      {/* Ações Rápidas por linha */}
                      <div className="flex flex-col 2xl:flex-row items-stretch gap-1 flex-shrink-0">
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

          {/* INSPEÇÃO TÉCNICA: imagem e scopes lado a lado, áudio e decisão sempre visíveis */}
          <section aria-label="Inspeção técnica" className="flex-1 min-w-0 flex flex-col gap-2 lg:h-full min-h-0">
            <div className="lg:flex-1 lg:min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-2">
            {/* 1. PLAYER DE VÍDEO */}
            <div className="bg-surface-card rounded-xl border border-border-subtle flex flex-col min-h-0 overflow-hidden shadow-md">
              {/* Barra de Título do Player */}
              <div className="px-3 py-1.5 border-b border-border-subtle flex flex-wrap items-center justify-between gap-x-2 bg-surface-panel/40 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="material-symbols-outlined text-primary text-[16px]">play_circle</span>
                  <span className="font-headline-md text-[13px] text-on-surface font-bold truncate">
                    {selectedLiveSource?.name ?? selectedAsset?.title ?? 'Nenhum ativo selecionado'}
                  </span>
                  <span className="font-label-caps text-[11px] px-1.5 py-0.5 rounded bg-surface-panel text-outline border border-border-subtle uppercase">
                    {selectedLiveSource?.kind ?? (selectedAsset?.path ? selectedAsset.path.split('.').pop() : 'VIDEO')}
                  </span>
                </div>

                {/* Timecode do arquivo, com quadros (;FF em drop-frame) */}
                <div className="flex items-center gap-2 font-label-mono text-[12px]">
                  {selectedLiveSource ? (
                    <span className="px-1.5 py-0.5 rounded bg-on-air-crimson/15 text-on-air-crimson border border-on-air-crimson/35 font-label-caps text-[11px]">AO VIVO · PVW</span>
                  ) : selectedAsset ? <>
                    <span className="text-outline">TC</span>
                    <input aria-label="Timecode atual (digite e Enter para ir)" value={tcDraft ?? qcTimecode(currentFrame, fileRate)}
                      onChange={event => setTcDraft(event.target.value)} onFocus={event => { setTcDraft(qcTimecode(currentFrame, fileRate)); event.currentTarget.select() }}
                      onBlur={() => setTcDraft(null)} onKeyDown={event => { if (event.key === 'Enter') { commitTimecode(); event.currentTarget.blur() } else if (event.key === 'Escape') { setTcDraft(null); event.currentTarget.blur() } }}
                      className="w-[104px] bg-surface-base border border-border-subtle rounded px-1 py-0.5 text-primary font-bold text-center focus:border-primary outline-none"/>
                    <span className="text-outline">/</span>
                    <span className="text-on-surface-variant font-medium" title="Duração">{qcTimecode(totalFrames, fileRate)}</span>
                    <span className="px-1.5 py-0.5 rounded bg-surface-panel text-[11px] text-outline border border-border-subtle" title="Quadro atual / total, na cadência do arquivo">
                      Q {currentFrame}/{totalFrames} · {qcRateLabel(fileRate)}
                    </span>
                  </> : null}
                </div>
              </div>

              <QcInspectionControls hasAsset={Boolean(selectedAsset)} isLive={Boolean(selectedLiveSourceId)}
                qualityActive={qualityActive} framesOnly={framesOnly}
                onToggleQuality={()=>{
                  if(selectedLiveSource){
                    if(!monitors?.inspection){setQcStatusFeedback('Inspeção ao vivo em qualidade exige engine e servidor de mídia ativos.');return}
                    setLiveQualitySelection(liveQualityActive?null:{key:liveQualityKey,id:commandRequestId()})
                    setQcStatusFeedback(null)
                    clearBrowserSample()
                    setAudioMeter(IDLE_METER)
                    return
                  }
                  if(!selectedAsset)return
                  videoRef.current?.pause();setIsPlaying(false);setVideoError(false);setShuttle(0)
                  setQcStatusFeedback(null)
                  // O original abre no MESMO quadro (TC) em que o operador estava.
                  pendingPositionRef.current=(currentFrameRef.current+0.5)/fileFps
                  setSettledFrame(currentFrameRef.current)
                  setQualitySelection(qualityActive?null:{id:selectedAsset.id,hash:selectedAsset.contentHash,channelId:channel.id})
                  clearBrowserSample()
                  setAudioMeter(IDLE_METER)
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
                className="relative w-full max-w-[calc(50vh*16/9)] mx-auto [&:fullscreen]:max-w-none aspect-video shrink-0 bg-black flex items-center justify-center overflow-hidden cursor-pointer group [&:fullscreen_.qc-fullscreen-exit]:flex"
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
                          setSettledFrame(currentFrameRef.current)
                          setVideoError(true)
                          setIsPlaying(false)
                          if(qualityActive)setQcStatusFeedback('O navegador não decodificou o original. Inspeção pelo quadro exato do original no TC (←/→, Shift, J/K/L); sem playback contínuo nem áudio.')
                        }}
                        onTimeUpdate={() => {
                          if (videoRef.current) {
                            const frame=Math.floor(videoRef.current.currentTime*fileFps+1e-3)
                            if(frame!==currentFrameRef.current)setCurrentFrame(frame)
                            renderScopes()
                          }
                        }}
                        onSeeked={() => renderScopes(true)}
                        onLoadedMetadata={(event) => {
                          if(event.currentTarget!==videoRef.current)return
                          if(!qcInspectionVideoHasPicture(event.currentTarget.videoWidth,event.currentTarget.videoHeight)){
                            event.currentTarget.pause()
                            setSettledFrame(currentFrameRef.current)
                            setVideoError(true);setIsPlaying(false)
                            if(qualityActive)setQcStatusFeedback('O navegador abriu o original sem imagem decodificável. Inspeção pelo quadro exato do original; sem reprodução contínua nem conferência de áudio.')
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
                        onEnded={() => { setIsPlaying(false); setShuttle(0) }}
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
                        onLoad={() => {if(inspectionFrameUrlRef.current===inspectionFrameUrl){renderScopes(true);advanceShuttleAfterLoad()}}}
                        onError={(e) => {
                          if(inspectionFrameUrlRef.current!==inspectionFrameUrl)return
                          setShuttle(0)
                          if(qualityActive){setFailedQualityFrame(inspectionFrameUrl);clearBrowserSample();setQcStatusFeedback('Quadro em qualidade indisponível. A miniatura não substitui a conferência em qualidade.');return}
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
                    <QcSafeAreaOverlay container={playerFrameRef} getMedia={safeAreaMedia} centerCut={centerCut}/>
                  )}
                </div>
              </div>

              {/* Transporte: quadro a quadro, ±1 s, J/K/L, régua e escuta */}
              <div className="p-2 bg-surface-panel flex flex-col gap-1.5 border-t border-border-subtle shrink-0">
                <div className="flex flex-wrap items-center gap-1">
                  {!selectedLiveSource && <>
                    <button type="button" className={navButton} disabled={navDisabled} onClick={() => { setShuttle(0); stepFrames(-totalFrames) }} title="Primeiro quadro (Home)" aria-label="Primeiro quadro">
                      <span className="material-symbols-outlined text-[16px]">first_page</span></button>
                    <button type="button" className={navButton} disabled={navDisabled} onClick={() => { setShuttle(0); stepFrames(-Math.max(1, Math.round(fileFps))) }} title="Voltar 1 segundo (Shift+←)">−1s</button>
                    <button type="button" className={navButton} disabled={navDisabled} onClick={() => { setShuttle(0); stepFrames(-1) }} title="Quadro anterior (←)" aria-label="Quadro anterior">
                      <span className="material-symbols-outlined text-[16px]">navigate_before</span></button>
                    <button
                      onClick={togglePlay}
                      disabled={!selectedAsset || framesOnly}
                      className="p-1 rounded bg-primary-container text-on-primary-container hover:bg-accent-ice transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center min-w-[32px] hit-btn"
                      title={framesOnly ? 'Inspeção por quadros — use a régua' : isPlaying ? 'Pausar (Espaço / K)' : 'Reproduzir (Espaço / L)'}
                    >
                      <span className="material-symbols-outlined text-[17px]">
                        {isPlaying ? 'pause' : 'play_arrow'}
                      </span>
                    </button>
                    <button type="button" className={navButton} disabled={navDisabled} onClick={() => { setShuttle(0); stepFrames(1) }} title="Próximo quadro (→)" aria-label="Próximo quadro">
                      <span className="material-symbols-outlined text-[16px]">navigate_next</span></button>
                    <button type="button" className={navButton} disabled={navDisabled} onClick={() => { setShuttle(0); stepFrames(Math.max(1, Math.round(fileFps))) }} title="Avançar 1 segundo (Shift+→)">+1s</button>
                    <button type="button" className={navButton} disabled={navDisabled} onClick={() => { setShuttle(0); stepFrames(totalFrames) }} title="Último quadro (End)" aria-label="Último quadro">
                      <span className="material-symbols-outlined text-[16px]">last_page</span></button>
                    {shuttle !== 0 && <span className="px-1.5 py-0.5 rounded bg-primary/15 text-primary border border-primary/40 font-label-mono text-[11px]" role="status">{shuttle > 0 ? '▶' : '◀'} {Math.abs(shuttle)}×{framesOnly ? ' quadros' : ''}</span>}
                  </>}

                  {/* Scrubber por quadro */}
                  {!selectedLiveSource && <input
                    type="range"
                    aria-label="Posição (quadro)"
                    min={0}
                    max={Math.max(0, totalFrames - 1)}
                    step={1}
                    value={currentFrame}
                    onChange={handleScrub}
                    disabled={!selectedAsset}
                    className="flex-1 min-w-[120px] h-2 rounded appearance-none cursor-pointer accent-primary"
                    style={{
                      background: `linear-gradient(to right, #3B82F6 0%, #3B82F6 ${(currentFrame / Math.max(1, totalFrames - 1)) * 100}%, #1E293B ${(currentFrame / Math.max(1, totalFrames - 1)) * 100}%, #1E293B 100%)`,
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
                </div>
                {selectedAsset && !selectedLiveSource && <p className="font-label-mono text-[11px] text-outline">
                  ←/→ quadro · Shift+←/→ 1 s · J/K/L shuttle · Home/End · Espaço play{qualityActive ? ' · em qualidade, cada passo busca o quadro exato do original' : ''}
                </p>}
              </div>

              {/* Detalhes do arquivo: rolam sem empurrar imagem, scopes e decisão */}
              <div className="lg:flex-1 lg:min-h-0 lg:overflow-y-auto broadcast-scrollbar p-2 flex flex-col gap-1.5">
              {selectedAsset && !selectedLiveSource && <div className="text-[11px] text-outline flex gap-2 items-center">
                <span className="flex-1">{qualityActive?(framesOnly?'Quadro exato do original no TC · imagem RGB BT.709 · scopes no Y\'CbCr cru. Sem playback contínuo.':'Qualidade original · maior consumo de rede/CPU. Pausado, os scopes usam o Y\'CbCr exato do quadro.'):proxyMessage}</span>
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
                {/* Régua de 24 quadros de navegação (proxy) */}
                {selectedAsset && (
                  <div className="flex items-center gap-1 overflow-x-auto py-0.5 broadcast-scrollbar shrink-0">
                    {Array.from({ length: 24 }).map((_, i) => {
                      const stripFrame = Math.floor((i + 0.5) / 24 * totalFrames)
                      const isCurrent = Math.floor(currentFrame * 24 / Math.max(1, totalFrames)) === i
                      return (
                        <button
                          key={i}
                          onClick={() => handleJumpToFrame(i)}
                          className={`flex-shrink-0 w-10 aspect-video bg-black rounded overflow-hidden border cursor-pointer transition-all ${
                            isCurrent
                              ? 'ring-2 ring-primary border-primary scale-105 shadow-md z-10'
                              : 'border-border-subtle opacity-65 hover:opacity-100 hover:scale-105'
                          }`}
                          title={`Régua ${i + 1}/24 · ${qcTimecode(stripFrame, fileRate)}`}
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
                {selectedAsset && <QcWorkflowPanel key={JSON.stringify([selectedAsset.id,selectedAsset.contentHash,channel.id])} assetId={selectedAsset.id} contentHash={selectedAsset.contentHash} channel={channel} onChanged={onMediaChanged} onReview={reportQcReview} refreshKey={qcReviewRefresh} externalBusy={qcDecisionBusy} />}
                {selectedAsset && !selectedLiveSourceId && totalDurationSec > 0 && <CutMarksPanel key={`${selectedAsset.id}:${selectedAsset.contentHash}`} assetId={selectedAsset.id} contentHash={selectedAsset.contentHash} durationMs={Math.round(totalDurationSec * 1000)} channelId={channel.id} currentTimeSec={currentTimeSec} onSeek={seconds => { setShuttle(0); seekToFrame(Math.floor(seconds * fileFps + 1e-3)) }} />}
              </div>
            </div>

            {/* 2. SCOPES (waveform, vectorscope, parade) */}
            <div className="bg-surface-card rounded-xl border border-border-subtle p-2 flex flex-col gap-1.5 shadow-md min-h-[460px] lg:min-h-0 overflow-hidden">
              <div className="flex items-center gap-2 border-b border-border-subtle pb-1 shrink-0">
                <span className="material-symbols-outlined text-accent-ice text-[16px]">query_stats</span>
                <span className="font-headline-md text-[12px] uppercase text-on-surface font-bold truncate">Scopes · {monitorLabels.image}</span>
                <span className="ml-auto font-label-mono text-[11px] text-outline shrink-0">SMPTE RP 219 · BT.709 · EBU R103</span>
              </div>
              <div className="flex-1 min-h-0">
                <QcScopePanel sample={scopeSample} stats={scopeStats} status={scopeStatus.text} statusTone={scopeStatus.tone}
                  mode={scopeMode} onModeChange={setScopeMode} unit={scopeUnit} onUnitChange={setScopeUnit}
                  costLabel={scopeCost && !exactWanted ? `amostra p95 ${scopeCost.p95Ms.toFixed(1)} ms` : null}/>
              </div>
            </div>
            </div>

            {/* 3. ÁUDIO: arquivo (servidor) × escuta (navegador) */}
            <div className="bg-surface-card rounded-xl border border-border-subtle px-3 py-2 shadow-md shrink-0">
              <QcAudioStrip loudness={selectedLoudness} hasAudio={selectedAsset?.probe ? selectedAsset.probe.hasAudio : null} profile={qcProfile} targetLufs={channel.targetLufs}
                meter={audioMeter} listening={listening}/>
            </div>

            {/* 4. DECISÃO: sempre visível */}
            <div className="bg-surface-card rounded-xl border border-border-subtle px-3 py-1.5 shadow-md shrink-0 flex flex-wrap items-center gap-2">
              <span className="font-label-caps text-[11px] text-outline">DECISÃO QC</span>
              <span className="flex-1 min-w-[160px] font-label-mono text-[12px] text-on-surface truncate">
                {selectedLiveSource ? 'Entrada ao vivo: inspeção sem decisão de acervo.' : selectedAsset ? `${selectedAsset.title} · ${qcDecisionReady ? 'versão conferida neste canal' : 'conferindo versão…'}` : 'Nenhum arquivo selecionado'}
              </span>
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
          </section>
        </div>
      </main>
    </div>
  )
}
