import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { durationIn, type Channel, type ManagedLiveSource, type SrtTelemetry } from '@rplayout/protocol'
import type { LibraryFolder, LibraryAsset, ScanStatus } from '../types.js'
import type { Monitors as MonitorFeeds } from '../types.js'
import type { WorkspaceId } from '../components/WorkspaceShell.js'
import { dur } from '../format.js'
import { BroadcastHeader } from '../components/broadcast/BroadcastHeader.js'
import { Whep } from '../components/Whep.js'
import { api } from '../api.js'

interface Props {
  folders: LibraryFolder[]
  scan: ScanStatus | null
  onAccept: (assetId: string) => void | Promise<void>
  onIgnore: (assetId: string) => void | Promise<void>
  onScan: (measure: boolean) => void
  onNavigate: (workspace: WorkspaceId) => void
  sessionRole?: string
  authRequired?: boolean
  channel: Channel
  channels?: Channel[]
  onSelectChannel?: (channelId: string) => void
  onOpenSettings?: () => void
  /** O PVW é o único render de uma entrada ao vivo; o QC apenas o assiste. */
  monitors?: MonitorFeeds | null
  onPreviewLiveSource?: (sourceRef: string, title: string) => void
}

type ScopeViewMode = 'QUAD' | 'VECTORSCOPE' | 'WAVEFORM' | 'PARADE'

export function QualityControlView({
  folders,
  scan,
  onAccept,
  onIgnore,
  onScan,
  onNavigate,
  sessionRole = 'Operador Master',
  authRequired = false,
  channel,
  channels = [channel],
  onSelectChannel = () => {},
  onOpenSettings,
  monitors = null,
  onPreviewLiveSource,
}: Props) {
  const channelRate = channel.rate
  const fps = channelRate.num / channelRate.den || 59.94

  const assets: LibraryAsset[] = useMemo(() => folders.flatMap((f) => f.assets), [folders])
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(() => assets[0]?.id ?? null)
  const [selectedLiveSourceId, setSelectedLiveSourceId] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedLiveSourceId && assets.length > 0 && (!selectedAssetId || !assets.some((a) => a.id === selectedAssetId))) {
      setSelectedAssetId(assets[0]?.id ?? null)
    }
  }, [assets, selectedAssetId, selectedLiveSourceId])

  const selectedAsset = selectedAssetId ? assets.find((a) => a.id === selectedAssetId) ?? null : null

  const [safeAreaActive, setSafeAreaActive] = useState(true)
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'OK' | 'ALERT' | 'IGNORED'>('ALL')
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | 'VIDEO' | 'AUDIO'>('ALL')
  const [scopeMode, setScopeMode] = useState<ScopeViewMode>('QUAD')
  const [liveInputs, setLiveInputs] = useState<ManagedLiveSource[]>([])
  const [liveTelemetry, setLiveTelemetry] = useState<Record<string, SrtTelemetry>>({})
  const selectedLiveSource = liveInputs.find((source) => source.id === selectedLiveSourceId) ?? null

  const selectLiveSource = useCallback((source: ManagedLiveSource) => {
    setSelectedAssetId(null)
    setSelectedLiveSourceId(source.id)
    setQcStatusFeedback(`PVW compartilhado solicitado para ${source.name}`)
    onPreviewLiveSource?.(source.targetUrl, source.name)
  }, [onPreviewLiveSource])

  // O QC de acervo não tenta decodificar NDI/SRT/RTMP no browser. Ele mostra a
  // mesma lista de ingest do servidor e as métricas que o processo realmente
  // publicou, para que uma fonte não desapareça simplesmente por ser ao vivo.
  useEffect(() => {
    let mounted = true
    const refresh = async () => {
      try {
        const [sources, telemetry] = await Promise.all([api.liveSources(channel.id), api.srtTelemetry()])
        if (mounted) { setLiveInputs(sources); setLiveTelemetry(telemetry) }
      } catch {
        if (mounted) { setLiveInputs([]); setLiveTelemetry({}) }
      }
    }
    void refresh()
    const interval = window.setInterval(() => void refresh(), 3000)
    return () => { mounted = false; window.clearInterval(interval) }
  }, [channel.id])

  // Modos de reprodução e fallback
  const [inspectMode, setInspectMode] = useState<'video' | 'frames'>('video')
  const [videoError, setVideoError] = useState(false)
  const [framePos, setFramePos] = useState(0)

  // Player controls
  const videoRef = useRef<HTMLVideoElement | null>(null)
  // O vídeo WHEP precisa ser estado além de ref: a chegada do MediaStream é
  // assíncrona e o primeiro quadro pode ocorrer depois do render que montou o
  // QC. Guardá-lo reativamente impede que os scopes continuem lendo uma ref
  // antiga/nula enquanto a imagem já está visível no player.
  const [sharedPreviewVideo, setSharedPreviewVideo] = useState<HTMLVideoElement | null>(null)
  const frameImgRef = useRef<HTMLImageElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTimeSec, setCurrentTimeSec] = useState(0)
  const [videoDurationSec, setVideoDurationSec] = useState(0)
  const [isMuted, setIsMuted] = useState(false)
  const [volume, setVolume] = useState(0.8)
  const [qcStatusFeedback, setQcStatusFeedback] = useState<string | null>(null)

  // Telemetria dinâmica dos escopos
  const [waveformStats, setWaveformStats] = useState<{ minIre: number; maxIre: number; avgIre: number; clipping: boolean } | null>(null)
  const [vectorscopeStats, setVectorscopeStats] = useState<{ maxSat: number; legalGamut: boolean } | null>(null)
  const [audioMeter, setAudioMeter] = useState({ peakL: -60, peakR: -60, phase: 0, active: false })

  // Canvas refs para os escopos técnicos
  const vectorscopeCanvasRef = useRef<HTMLCanvasElement>(null)
  const waveformCanvasRef = useRef<HTMLCanvasElement>(null)
  const paradeCanvasRef = useRef<HTMLCanvasElement>(null)
  const audioSpectrumCanvasRef = useRef<HTMLCanvasElement>(null)
  const scopeSampleReadyRef = useRef(false)
  // WHEP pode expor um intervalo curto sem frame enquanto mantém o último
  // quadro no player. Os scopes devem espelhar esse comportamento e jamais
  // piscar para preto por uma leitura transitória que falhou.
  const lastScopePixelsRef = useRef<Uint8ClampedArray | null>(null)
  // Desenhar quatro scopes é relativamente caro. A entrada pode entregar 60
  // callbacks/s, mas atualizar os canvases nessa taxa disputa a thread da UI
  // com o WHEP e produz justamente o sintoma de imagem presente com scope
  // intermitente. Limitamos a análise a 10 Hz, suficiente para inspeção QC e
  // sem perder o último quadro real.
  const lastScopeRenderAtRef = useRef(0)
  const [scopeSampleReady, setScopeSampleReady] = useState(false)

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
  const audioSourceConnectedRef = useRef(false)

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
    setIsPlaying(false)
    setCurrentTimeSec(0)
    setVideoDurationSec(0)
    setVideoError(false)
    setInspectMode('video')
    setFramePos(0)
    if (videoRef.current) {
      videoRef.current.currentTime = 0
      videoRef.current.pause()
    }
    lastScopePixelsRef.current = null
    scopeSampleReadyRef.current = false
    setScopeSampleReady(false)
    setWaveformStats(null)
    setVectorscopeStats(null)
  }, [selectedAsset?.id, selectedLiveSource?.id])

  // Inicializa Web Audio com Medição EBU Pré-Fader (puro da mídia de entrada)
  const initAudio = useCallback(() => {
    if (!videoRef.current) return
    // Garante que o elemento de vídeo nunca esteja mutado no DOM, preservando o fluxo de bits para o Analyser pré-fader
    videoRef.current.muted = false
    videoRef.current.volume = 1.0

    if (audioCtxRef.current) {
      if (audioCtxRef.current.state === 'suspended') {
        void audioCtxRef.current.resume()
      }
      return
    }
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!AudioCtx) return
      const ctx = new AudioCtx()
      if (ctx.state === 'suspended') {
        void ctx.resume()
      }
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 128
      analyser.smoothingTimeConstant = 0.8

      if (!audioSourceConnectedRef.current && videoRef.current) {
        const source = ctx.createMediaElementSource(videoRef.current)
        // PRE-FADER: Analisador EBU R128 conectado diretamente na fonte original do arquivo (100% nível de entrada)
        // Mudo ou ajuste de volume de monitor do operador não afeta a medição do arquivo.
        source.connect(analyser)

        // PÓS-FADER: Controle de escuta/monitor do operador via GainNode separado
        const gainNode = ctx.createGain()
        gainNode.gain.value = isMuted ? 0 : volume
        source.connect(gainNode)
        gainNode.connect(ctx.destination)
        gainNodeRef.current = gainNode

        audioSourceConnectedRef.current = true
      }
      audioCtxRef.current = ctx
      analyserRef.current = analyser
    } catch {
      // Audio context já conectado ou sem permissão de áudio
    }
  }, [])

  const attachSharedPreviewVideo = useCallback((element: HTMLVideoElement | null) => {
    videoRef.current = element
    setSharedPreviewVideo((current) => current === element ? current : element)
    if (element) initAudio()
  }, [initAudio])

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
    const now = performance.now()
    if (!force && now - lastScopeRenderAtRef.current < 100) return
    lastScopeRenderAtRef.current = now
    let pixels: Uint8ClampedArray | null = null
    const sCanvas = sampleCanvasRef.current
    if (sCanvas) {
      const sCtx = sCanvas.getContext('2d', { willReadFrequently: true })
      if (sCtx) {
        const sourceEl = !videoError ? (sharedPreviewVideo ?? videoRef.current) : frameImgRef.current
        if (sourceEl) {
          try {
            // Não aceite um canvas transparente/sem decoder como amostra. Em
            // WHEP `loadedmetadata` pode anteceder o primeiro frame real.
            if (sourceEl instanceof HTMLVideoElement && (sourceEl.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || sourceEl.videoWidth < 1 || sourceEl.videoHeight < 1)) {
              throw new Error('WHEP ainda não entregou um frame decodificado')
            }
            // Não limpe antes de desenhar: durante uma reconfiguração WHEP o
            // drawImage pode falhar entre callbacks; manter o bitmap anterior
            // evita uma amostra preta transitória no waveform/parade.
            sCtx.drawImage(sourceEl, 0, 0, 160, 90)
            const imgData = sCtx.getImageData(0, 0, 160, 90)
            pixels = imgData.data
            // Copia o buffer: ImageData/canvas pode ser reutilizado pelo
            // navegador no próximo ciclo de composição.
            lastScopePixelsRef.current = new Uint8ClampedArray(pixels)
          } catch {
            // Não apaga a última amostra durante uma lacuna do decoder.
          }
        }
      }
    }

    // Sem frame novo, reutiliza o último RGBA real. Isto mantém waveform,
    // vectorscope e parade estáveis durante jitter/reconfiguração do WHEP;
    // ao trocar a fonte o efeito acima limpa explicitamente a amostra.
    const samplePixels = pixels ?? lastScopePixelsRef.current
    const hasPixels = samplePixels !== null
    if (scopeSampleReadyRef.current !== hasPixels) {
      scopeSampleReadyRef.current = hasPixels
      setScopeSampleReady(hasPixels)
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
            vCtx.fillStyle = `rgba(${Math.max(60, r)}, ${Math.max(100, g)}, ${Math.max(120, b)}, 0.65)`
            vCtx.fillRect(px, py, dotSize, dotSize)
          }

          const satPercent = Math.min(100, Math.round((maxDist / 128) * 100))
          setVectorscopeStats({ maxSat: satPercent, legalGamut: satPercent <= 100 })
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
          setWaveformStats({
            minIre: Math.round(minI * 10) / 10,
            maxIre: Math.round(maxI * 10) / 10,
            avgIre: Math.round(avgI * 10) / 10,
            clipping: maxI > 100 || minI < 0,
          })
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
          for (let sy = 0; sy < 90; sy += 2) {
            for (let sx = 0; sx < 160; sx += 2) {
              const idx = (sy * 160 + sx) * 4
              const r = samplePixels[idx] ?? 0
              const g = samplePixels[idx + 1] ?? 0
              const b = samplePixels[idx + 2] ?? 0
              const colFrac = sx / 160

              pCtx.fillStyle = 'rgba(255, 51, 75, 0.45)'
              pCtx.fillRect(colFrac * colW, y0 - (r / 255) * hRange, dotSize, dotSize)

              pCtx.fillStyle = 'rgba(0, 230, 118, 0.45)'
              pCtx.fillRect(colW + colFrac * colW, y0 - (g / 255) * hRange, dotSize, dotSize)

              pCtx.fillStyle = 'rgba(56, 155, 255, 0.45)'
              pCtx.fillRect(colW * 2 + colFrac * colW, y0 - (b / 255) * hRange, dotSize, dotSize)
            }
          }
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
          const data = new Uint8Array(analyserRef.current.frequencyBinCount)
          analyserRef.current.getByteFrequencyData(data)
          freqData = data
        }

        const bars = 24
        const barW = (w - (bars - 1) * 1.5) / bars
        let maxL = -60
        let maxR = -60

        for (let b = 0; b < bars; b++) {
          // Sem amostra real do analisador, não desenha um espectro falso.
          const val = freqData ? freqData[b * 2] || 0 : 0
          const barH = Math.max(2, (val / 255) * (h - 8))
          const bx = b * (barW + 1.5)
          const by = h - barH - 2

          // Gradiente digital nítido: Verde (-60 a -18 dBFS) -> Amarelo (-18 a -9 dBFS) -> Vermelho (-9 a 0 dBFS)
          const grad = aCtx.createLinearGradient(0, h, 0, 0)
          grad.addColorStop(0, '#00E676')
          grad.addColorStop(0.65, '#FFD600')
          grad.addColorStop(0.85, '#FF9500')
          grad.addColorStop(1, '#FF334B')
          aCtx.fillStyle = grad
          aCtx.fillRect(bx, by, barW, barH)

          // Peak hold bar
          aCtx.fillStyle = '#FFFFFF'
          aCtx.fillRect(bx, by - 1.5, barW, 1)

          if (b < 12) maxL = Math.max(maxL, (val / 255) * 60 - 60)
          else maxR = Math.max(maxR, (val / 255) * 60 - 60)
        }

        if (freqData) {
          setAudioMeter({
            peakL: Math.round(maxL * 10) / 10,
            peakR: Math.round(maxR * 10) / 10,
            phase: 0.96,
            active: true,
          })
        }
      }
    }
  }, [videoError, isPlaying, sharedPreviewVideo])

  // O WHEP chama renderScopes em cada frame decodificado. Este pequeno
  // fallback cobre navegadores sem requestVideoFrameCallback e mídia local,
  // mas não mantém um loop a 60fps que possa atrasar o próprio decoder.
  useEffect(() => {
    renderScopes(true)
    if (!isPlaying && !selectedLiveSource) return undefined
    const interval = window.setInterval(() => renderScopes(), 250)
    return () => window.clearInterval(interval)
  }, [isPlaying, renderScopes, currentTimeSec, selectedAsset?.id, selectedLiveSource?.id, scopeMode])

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
      void audioCtxRef.current.resume()
    }

    if (inspectMode === 'frames' || videoError) {
      setIsPlaying(!isPlaying)
      return
    }
    if (!videoRef.current) return
    if (videoRef.current.paused) {
      videoRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => {
          setVideoError(true)
          setInspectMode('frames')
          setIsPlaying(true)
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

    if (inspectMode === 'frames' || videoError) {
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

    if (inspectMode === 'frames' || videoError) {
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

  const handleApprove = async (id?: string) => {
    const targetId = id ?? selectedAsset?.id
    if (!targetId) return
    await onAccept(targetId)
    setQcStatusFeedback('Arquivo aprovado com sucesso!')
    setTimeout(() => setQcStatusFeedback(null), 3000)
  }

  const handleReject = async (id?: string) => {
    const targetId = id ?? selectedAsset?.id
    if (!targetId) return
    await onIgnore(targetId)
    setQcStatusFeedback('Arquivo movido para os ignorados / quarentena')
    setTimeout(() => setQcStatusFeedback(null), 3000)
  }

  const okCount = assets.filter((a) => !a.probeError && !a.ignored).length
  const alertCount = assets.filter((a) => !!a.probeError && !a.ignored).length
  const ignoredCount = assets.filter((a) => !!a.ignored).length

  const filteredAssets = useMemo(() => {
    return assets.filter((a) => {
      // Vídeos ignorados/rejeitados só aparecem quando o operador seleciona o filtro 'IGNORED'.
      // Em 'ALL', 'OK' ou 'ALERT', arquivos ignorados são totalmente ocultados tanto do QC quanto do Master.
      if (statusFilter === 'IGNORED') {
        if (!a.ignored) return false
      } else {
        if (a.ignored) return false
        if (statusFilter === 'OK' && !!a.probeError) return false
        if (statusFilter === 'ALERT' && !a.probeError) return false
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
  }, [assets, statusFilter, categoryFilter, searchQuery])

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
                <span className="font-label-caps text-[9px] px-1.5 py-0.5 rounded bg-primary/20 text-primary border border-primary/40 font-bold uppercase">
                  INSPEÇÃO FRAME-ACCURATE
                </span>
              </div>
              <div className="flex items-center gap-3 font-label-mono text-[10px] text-outline">
                <span>Total: <strong className="text-on-surface">{assets.length}</strong></span>
                <span>•</span>
                <span className="text-status-ok-bright font-bold">{okCount} OK</span>
                <span>•</span>
                <span className="text-armed-amber font-bold">{alertCount} ALERTAS</span>
                <span>•</span>
                <span className="text-outline">{ignoredCount} IGNORADOS</span>
              </div>
            </div>
          </div>

          {/* Toast de feedback */}
          {qcStatusFeedback && (
            <div className="px-3 py-1 rounded bg-accent-ice/20 border border-accent-ice text-accent-ice-bright font-label-caps text-[10px] font-bold animate-pulse">
              {qcStatusFeedback}
            </div>
          )}

          {/* Quick Action Buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => onScan(false)}
              className="flex items-center gap-1 px-3 py-1 rounded bg-primary-container hover:bg-accent-ice text-on-primary-container font-label-caps text-[10px] tracking-wide transition-colors shadow-sm cursor-pointer"
              title="Sincronizar arquivos da pasta de mídia"
            >
              <span className="material-symbols-outlined text-[15px]">upload_file</span>
              <span>ESCANEAR INGEST</span>
            </button>
            <button
              onClick={() => onScan(true)}
              className="flex items-center gap-1 px-3 py-1 rounded bg-surface-panel hover:bg-surface-container border border-border-subtle text-on-surface font-label-caps text-[10px] transition-colors cursor-pointer"
              title="Calcular níveis de loudness EBU R128 para arquivos pendentes"
            >
              <span className="material-symbols-outlined text-[15px] text-accent-ice">equalizer</span>
              <span>MEDIR LOUDNESS</span>
            </button>
            <button
              onClick={() => setSafeAreaActive(!safeAreaActive)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded border transition-colors cursor-pointer font-label-caps text-[10px] ${
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
        <div className="w-full flex-1 min-h-0 p-space-md grid grid-cols-12 gap-space-md overflow-hidden">
          {/* COLUNA ESQUERDA: LISTAGEM DE ARQUIVOS (Cols 1 a 5) */}
          <div className="col-span-12 lg:col-span-5 flex flex-col h-full bg-surface-card rounded-xl border border-border-subtle overflow-hidden shadow-md">
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
                <div className="flex items-center gap-1 font-label-caps text-[9px]">
                  {(['ALL', 'OK', 'ALERT', 'IGNORED'] as const).map((filter) => (
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
                      {filter === 'ALL' ? 'TODOS' : filter === 'ALERT' ? 'ALERTAS' : filter}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedAssetId(null)
                      setSelectedLiveSourceId(liveInputs[0]?.id ?? null)
                    }}
                    className={`px-2 py-0.5 rounded cursor-pointer transition-colors border ${
                      selectedLiveSourceId
                        ? 'bg-accent-ice text-surface-base font-bold border-accent-ice'
                        : 'bg-surface-base text-outline border-border-subtle hover:text-on-surface'
                    }`}
                    title="Listar e inspecionar entradas ao vivo no mesmo player QC"
                  >
                    AO VIVO ({liveInputs.length})
                  </button>
                </div>

                <div className="flex items-center gap-1 font-label-caps text-[9px]">
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
                    <LiveSourceRow
                      key={source.id}
                      source={source}
                      telemetry={liveTelemetry[source.id]}
                      selected={source.id === selectedLiveSourceId}
                      onSelect={() => selectLiveSource(source)}
                    />
                  ))
                )
              ) : <>
              {statusFilter === 'IGNORED' && (
                <div className="p-2.5 bg-on-air-crimson/15 border border-on-air-crimson/40 rounded-lg text-[10.5px] text-on-surface leading-snug flex items-start gap-2 shrink-0">
                  <span className="material-symbols-outlined text-on-air-crimson text-[18px] shrink-0">block</span>
                  <div>
                    <strong className="text-on-air-crimson block font-label-caps text-[10px]">
                      Arquivos Ignorados / Quarentena ({ignoredCount})
                    </strong>
                    Estes vídeos foram rejeitados no QC e estão suspensos: eles não aparecem na listagem padrão do QC nem nos seletores de mídia do Master Playout.
                  </div>
                </div>
              )}
              {filteredAssets.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-8 text-outline gap-2 my-auto">
                  <span className="material-symbols-outlined text-[36px] opacity-40">inventory_2</span>
                  <span className="font-body-sm text-[12px]">Nenhum arquivo encontrado no filtro</span>
                </div>
              ) : (
                filteredAssets.map((asset) => {
                  const isSelected = asset.id === selectedAsset?.id
                  const hasAlert = !!asset.probeError
                  const isIgnored = !!asset.ignored

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
                            <span className="font-label-caps text-[8px] px-1 py-0.2 rounded bg-surface-container text-outline border border-border-subtle">
                              IGNORADO
                            </span>
                          ) : hasAlert ? (
                            <span className="font-label-caps text-[8px] px-1 py-0.2 rounded bg-armed-amber/20 text-armed-amber border border-armed-amber/40">
                              ALERTA
                            </span>
                          ) : (
                            <span className="font-label-caps text-[8px] px-1 py-0.2 rounded bg-status-ok/20 text-status-ok-bright border border-status-ok/40">
                              100% OK
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 font-label-mono text-[9.5px] text-outline">
                          <span className="text-on-surface">
                            {dur(itemDurationFrames, channelRate)}
                          </span>
                          <span>•</span>
                          <span>{asset.kind}</span>
                          <span>•</span>
                          <span>
                            {typeof asset.loudnessFile?.integratedLufs === 'number'
                              ? `${asset.loudnessFile.integratedLufs.toFixed(1)} LUFS`
                              : '-24 LUFS'}
                          </span>
                        </div>
                      </div>

                      {/* Ações Rápidas por linha */}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            void handleApprove(asset.id)
                          }}
                          className="px-2 py-1 rounded bg-status-ok/15 hover:bg-status-ok text-status-ok-bright hover:text-surface-base font-label-caps text-[9px] font-bold transition-colors cursor-pointer border border-status-ok/30"
                          title="Aprovar no QC e liberar para a grade"
                        >
                          Aprovar
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            void handleReject(asset.id)
                          }}
                          className="px-2 py-1 rounded bg-surface-container hover:bg-on-air-crimson/20 text-outline hover:text-on-air-crimson font-label-caps text-[9px] transition-colors cursor-pointer border border-border-subtle"
                          title="Mover para quarentena / ignorar"
                        >
                          Ignorar
                        </button>
                      </div>
                    </div>
                  )
                })
              )}</>}
            </div>

            {/* Rodapé da Coluna com Resumo */}
            <div className="p-2 border-t border-border-subtle bg-surface-panel/30 font-label-mono text-[10px] text-outline flex items-center justify-between shrink-0">
              <span>{selectedLiveSourceId ? `${liveInputs.length} entradas ao vivo` : `${filteredAssets.length} clipes na fila`}</span>
              <span>{selectedLiveSourceId ? 'Clique na fonte para abrir o PVW compartilhado' : 'Clique no clipe para inspecionar'}</span>
            </div>
          </div>

          {/* COLUNA DIREITA: INSPEÇÃO TÉCNICA (PLAYER FRAME-ACCURATE + SCOPES) (Cols 6 a 12) */}
          <div className="col-span-12 lg:col-span-7 flex flex-col h-full gap-2.5 overflow-hidden">
            {/* 1. PLAYER DE VÍDEO & RÉGUA DE 24 QUADROS */}
            <div className="bg-surface-card rounded-xl border border-border-subtle flex flex-col overflow-hidden shadow-md shrink-0">
              {/* Barra de Título do Player */}
              <div className="px-3 py-1.5 border-b border-border-subtle flex items-center justify-between bg-surface-panel/40">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="material-symbols-outlined text-primary text-[16px]">play_circle</span>
                  <span className="font-headline-md text-[13px] text-on-surface font-bold truncate">
                    {selectedLiveSource?.name ?? selectedAsset?.title ?? 'Nenhum ativo selecionado'}
                  </span>
                  <span className="font-label-caps text-[8.5px] px-1.5 py-0.5 rounded bg-surface-panel text-outline border border-border-subtle uppercase">
                    {selectedLiveSource?.kind ?? (selectedAsset?.path ? selectedAsset.path.split('.').pop() : 'VIDEO')}
                  </span>
                </div>

                {/* Timecode Header Display */}
                <div className="flex items-center gap-2 font-label-mono text-[10.5px]">
                  {selectedLiveSource ? (
                    <span className="px-1.5 py-0.5 rounded bg-on-air-crimson/15 text-on-air-crimson border border-on-air-crimson/35 font-label-caps text-[9px]">AO VIVO · PVW</span>
                  ) : <>
                    <span className="text-outline">TC:</span>
                    <span className="text-primary font-bold">
                      {dur(Math.floor(currentTimeSec * fps), channelRate)}
                    </span>
                    <span className="text-outline">/</span>
                    <span className="text-on-surface-variant font-medium">
                      {dur(totalDurationFrames, channelRate)}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-surface-panel text-[9px] text-outline border border-border-subtle">
                      Q: {Math.floor(currentTimeSec * fps)}/{totalDurationFrames}
                    </span>
                  </>}
                </div>
              </div>

              {/* Viewport do Vídeo com Retículo de Safe Areas */}
              <div
                onClick={togglePlay}
                className="relative w-full h-56 bg-black flex items-center justify-center overflow-hidden cursor-pointer group"
              >
                {selectedLiveSource ? (
                  monitors?.preview ? (
                    <Whep
                      path={monitors.preview}
                      port={monitors.port}
                      frameRate={fps}
                      onWatching={() => { void api.watching(channel.id, 'pvw').catch(() => {}) }}
                      muted
                      onVideoElement={attachSharedPreviewVideo}
                      onVideoFrame={renderScopes}
                    />
                  ) : (
                    <div className="text-center text-outline font-body-sm text-[11px] px-6">
                      O render compartilhado ainda não está disponível. Aguarde o PVW conectar à fonte.
                    </div>
                  )
                ) : selectedAsset ? (
                  !videoError ? (
                    <video
                      ref={videoRef}
                      src={`/api/assets/${selectedAsset.id}/media`}
                      className="w-full h-full object-contain"
                      crossOrigin="anonymous"
                      onError={() => {
                        setVideoError(true)
                        setInspectMode('frames')
                      }}
                      onTimeUpdate={() => {
                        if (videoRef.current) {
                          setCurrentTimeSec(videoRef.current.currentTime)
                          renderScopes()
                        }
                      }}
                      onLoadedMetadata={() => {
                        if (videoRef.current) {
                          setVideoDurationSec(videoRef.current.duration)
                          initAudio()
                          renderScopes()
                        }
                      }}
                      onPlay={() => {
                        initAudio()
                        setIsPlaying(true)
                      }}
                      onPause={() => setIsPlaying(false)}
                      onEnded={() => setIsPlaying(false)}
                    />
                  ) : (
                    <img
                      ref={frameImgRef}
                      src={`/api/assets/${selectedAsset.id}/frame/${framePos}.jpg?total=24`}
                      onLoad={() => renderScopes(true)}
                      onError={(e) => {
                        ;(e.target as HTMLImageElement).src = `/api/assets/${selectedAsset.id}/thumbnail.svg`
                      }}
                      alt=""
                      className="w-full h-full object-contain pointer-events-none"
                    />
                  )
                ) : (
                  <span className="font-body-sm text-outline">Selecione um clipe na fila para inspecionar</span>
                )}

                {/* Play/Pause Overlay Indicator */}
                {!isPlaying && selectedAsset && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/25 pointer-events-none">
                    <div className="w-12 h-12 rounded-full bg-surface-base/80 border border-border-strong flex items-center justify-center text-primary shadow-lg group-hover:scale-110 transition-transform">
                      <span className="material-symbols-outlined text-[28px] pl-0.5">play_arrow</span>
                    </div>
                  </div>
                )}

                {/* Safe Areas Overlay */}
                {safeAreaActive && (selectedAsset || selectedLiveSource) && (
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                    <div className="w-[90%] h-[90%] border border-status-ok/30 relative">
                      <span className="absolute top-0.5 left-1 text-[7.5px] font-label-mono text-status-ok/70">
                        ACTION SAFE (90%)
                      </span>
                      <div className="w-[88.8%] h-[88.8%] m-auto border border-status-ok/40 relative h-full">
                        <span className="absolute top-0.5 left-1 text-[7.5px] font-label-mono text-status-ok/80">
                          TITLE SAFE (80%)
                        </span>
                      </div>
                    </div>
                    {/* Mira Central */}
                    <div className="absolute w-4 h-px bg-status-ok/40"></div>
                    <div className="absolute h-4 w-px bg-status-ok/40"></div>
                  </div>
                )}
              </div>

              {/* Controles de Transporte e Scrubber */}
              <div className="p-2 bg-surface-panel flex flex-col gap-1.5 border-t border-border-subtle">
                <div className="flex items-center gap-2">
                  {!selectedLiveSource && <button
                    onClick={togglePlay}
                    className="p-1 rounded bg-primary-container text-on-primary-container hover:bg-accent-ice transition-colors cursor-pointer flex items-center justify-center"
                    title={isPlaying ? 'Pausar (Espaço)' : 'Reproduzir (Espaço)'}
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
                  {!selectedLiveSource && <div className="flex items-center gap-1 pl-1 border-l border-border-subtle">
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
                    <span className="flex-1 font-label-mono text-[10px] text-accent-ice">
                      PVW compartilhado · sem segunda decodificação no navegador
                    </span>
                  )}

                  {/* Botões Grandes de Homologação */}
                  <button
                    onClick={() => void handleApprove()}
                    disabled={!selectedAsset}
                    className="flex items-center gap-1 px-3 py-1 rounded bg-status-ok text-surface-base font-label-caps text-[9.5px] font-bold hover:bg-status-ok-bright transition-colors shadow-sm cursor-pointer disabled:opacity-40 ml-1"
                    title="Aprovar clipe e liberar para o Master Playout"
                  >
                    <span className="material-symbols-outlined text-[14px]">check_circle</span>
                    <span>APROVAR QC</span>
                  </button>
                  <button
                    onClick={() => void handleReject()}
                    disabled={!selectedAsset}
                    className="flex items-center gap-1 px-3 py-1 rounded bg-on-air-crimson text-white font-label-caps text-[9.5px] font-bold hover:bg-red-600 transition-colors shadow-sm cursor-pointer disabled:opacity-40"
                    title="Mover clipe para os rejeitados / quarentena"
                  >
                    <span className="material-symbols-outlined text-[14px]">cancel</span>
                    <span>REJEITAR</span>
                  </button>
                </div>

                {/* Scrubber Filmstrip 24 Quadros GStreamer */}
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
            <div className="flex-1 min-h-0 bg-surface-card rounded-xl border border-border-subtle p-2.5 flex flex-col gap-2 shadow-md overflow-hidden">
              <div className="flex items-center justify-between border-b border-border-subtle pb-1 shrink-0">
                <div className="flex items-center gap-2">
                  <span className="font-headline-md text-[12px] uppercase text-on-surface font-bold flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-accent-ice text-[16px]">query_stats</span>
                    Scopes Técnicos Broadcast (ITU-R BT.709 &amp; EBU R128)
                  </span>
                  <span className="font-label-mono text-[9px] px-1.5 py-0.2 rounded bg-surface-panel border border-border-subtle text-status-ok-bright">
                    AO VIVO 60FPS
                  </span>
                </div>

                {/* Seletor de Modo de Visualização dos Escopos */}
                <div className="flex items-center gap-1 bg-surface-base p-0.5 rounded border border-border-subtle font-label-caps text-[8.5px]">
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
                      <div className="flex items-center justify-between border-b border-border-subtle/50 pb-0.5 font-label-caps text-[8.5px]">
                        <span className="text-accent-ice font-bold">1. VECTORSCOPE</span>
                        <span className={`font-mono text-[8px] font-bold ${!vectorscopeStats ? 'text-outline' : vectorscopeStats.legalGamut ? 'text-status-ok' : 'text-on-air-crimson'}`}>
                          {!vectorscopeStats ? 'AGUARDANDO FRAME' : vectorscopeStats.legalGamut ? '75% LEGAL' : 'GAMUT OVER'}
                        </span>
                      </div>
                      <div className="relative w-full flex-1 bg-[#05070E] rounded border border-border-subtle/60 flex items-center justify-center overflow-hidden my-1">
                        <canvas ref={vectorscopeCanvasRef} width={180} height={180} className="w-full h-full object-contain" />
                      </div>
                      <div className="flex items-center justify-between font-label-mono text-[8px] text-outline">
                        <span>I-LINE PELE</span>
                        <span className="text-accent-ice font-bold">SAT: {vectorscopeStats ? `${vectorscopeStats.maxSat}%` : '—'}</span>
                      </div>
                    </div>

                    {/* Scope 2: Luma Waveform (0-100 IRE) */}
                    <div className="bg-surface-panel rounded border border-border-subtle p-2 flex flex-col justify-between overflow-hidden">
                      <div className="flex items-center justify-between border-b border-border-subtle/50 pb-0.5 font-label-caps text-[8.5px]">
                        <span className="text-status-ok-bright font-bold">2. LUMA WAVEFORM</span>
                        <span className={`font-mono text-[8px] font-bold ${!waveformStats ? 'text-outline' : waveformStats.clipping ? 'text-on-air-crimson' : 'text-status-ok'}`}>
                          {!waveformStats ? 'AGUARDANDO FRAME' : waveformStats.clipping ? 'CLIPPING' : '0-100 IRE OK'}
                        </span>
                      </div>
                      <div className="relative w-full flex-1 bg-[#05070E] rounded border border-border-subtle/60 overflow-hidden my-1">
                        <canvas ref={waveformCanvasRef} width={260} height={140} className="w-full h-full" />
                      </div>
                      <div className="flex items-center justify-between font-label-mono text-[8px] text-outline">
                        <span>MIN: {waveformStats?.minIre ?? '—'}</span>
                        <span className="text-status-ok-bright font-bold">MAX: {waveformStats ? `${waveformStats.maxIre} IRE` : '—'}</span>
                      </div>
                    </div>

                    {/* Scope 3: RGB Parade */}
                    <div className="bg-surface-panel rounded border border-border-subtle p-2 flex flex-col justify-between overflow-hidden">
                      <div className="flex items-center justify-between border-b border-border-subtle/50 pb-0.5 font-label-caps text-[8.5px]">
                        <span className="text-primary font-bold">3. RGB PARADE</span>
                        <span className={`font-mono text-[8px] ${scopeSampleReady ? 'text-status-ok' : 'text-outline'}`}>{scopeSampleReady ? 'REC.709' : 'AGUARDANDO FRAME'}</span>
                      </div>
                      <div className="relative w-full flex-1 bg-[#05070E] rounded border border-border-subtle/60 overflow-hidden my-1">
                        <canvas ref={paradeCanvasRef} width={260} height={140} className="w-full h-full" />
                      </div>
                      <div className="flex items-center justify-between font-label-mono text-[8px] text-outline">
                        <span>BALANÇO RGB</span>
                        <span className="text-status-ok font-bold">CALIBRADO</span>
                      </div>
                    </div>

                    {/* Scope 4: Áudio EBU R128 & Spectrum (Pré-Fader) */}
                    <div className="bg-surface-panel rounded border border-border-subtle p-2 flex flex-col justify-between overflow-hidden">
                      <div className="flex items-center justify-between border-b border-border-subtle/50 pb-0.5 font-label-caps text-[8.5px]">
                        <div className="flex items-center gap-1">
                          <span className="text-armed-amber font-bold">4. ÁUDIO EBU R128</span>
                          <span className="text-[7.5px] px-1 py-0.2 rounded bg-status-ok/20 text-status-ok-bright font-bold">PRÉ-FADER</span>
                        </div>
                        <span className="text-status-ok font-mono text-[8px]">ALVO: -23 LUFS</span>
                      </div>

                      {/* Espectrograma Real em Canvas */}
                      <div className="relative w-full h-14 bg-[#040711] rounded border border-border-subtle/60 overflow-hidden my-1">
                        <canvas ref={audioSpectrumCanvasRef} width={180} height={70} className="w-full h-full" />
                      </div>

                      {/* Métricas e VU Meters */}
                      <div className="flex flex-col gap-0.5 font-label-mono text-[8px]">
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
                    <div className="absolute top-3 right-3 bg-surface-panel/90 border border-border-subtle p-2 rounded font-label-mono text-[10px] flex flex-col gap-1">
                      <span className="text-accent-ice font-bold">ITU-R BT.709 VECTORSCOPE</span>
                      <span className="text-outline">Saturação Máx: <strong className="text-on-surface">{vectorscopeStats ? `${vectorscopeStats.maxSat}%` : '—'}</strong></span>
                      <span className="text-outline">Gamut: <strong className="text-status-ok">LEGAL BROADCAST</strong></span>
                      <span className="text-outline">Eixo I: <strong className="text-armed-amber">123° TRAVADO</strong></span>
                    </div>
                  </div>
                )}

                {/* Visualização Expandida: Luma Waveform */}
                {scopeMode === 'WAVEFORM' && (
                  <div className="w-full h-full bg-[#05070E] rounded-lg border border-border-subtle flex flex-col p-2 relative">
                    <canvas ref={waveformCanvasRef} width={800} height={280} className="w-full h-full" />
                    <div className="absolute top-3 right-3 bg-surface-panel/90 border border-border-subtle p-2 rounded font-label-mono text-[10px] flex gap-4">
                      <span>Mínimo: <strong className="text-status-ok">{waveformStats ? `${waveformStats.minIre} IRE` : '—'}</strong></span>
                      <span>Médio: <strong className="text-accent-ice">{waveformStats ? `${waveformStats.avgIre} IRE` : '—'}</strong></span>
                      <span>Máximo: <strong className={waveformStats?.clipping ? 'text-on-air-crimson' : 'text-status-ok'}>{waveformStats ? `${waveformStats.maxIre} IRE` : '—'}</strong></span>
                      <span>Status: <strong className="text-status-ok-bright">0-100 IRE LEGAL</strong></span>
                    </div>
                  </div>
                )}

                {/* Visualização Expandida: RGB Parade */}
                {scopeMode === 'PARADE' && (
                  <div className="w-full h-full bg-[#05070E] rounded-lg border border-border-subtle flex flex-col p-2 relative">
                    <canvas ref={paradeCanvasRef} width={800} height={280} className="w-full h-full" />
                    <div className="absolute top-3 right-3 bg-surface-panel/90 border border-border-subtle p-2 rounded font-label-mono text-[10px] flex gap-4">
                      <span className="text-[#FF3B30] font-bold">CANAL RED</span>
                      <span className="text-[#34C759] font-bold">CANAL GREEN</span>
                      <span className="text-[#5B9BFF] font-bold">CANAL BLUE</span>
                      <span className="text-status-ok font-bold">BALANÇO CALIBRADO</span>
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

function LiveSourceRow({ source, telemetry, selected, onSelect }: {
  source: ManagedLiveSource
  telemetry?: SrtTelemetry
  selected: boolean
  onSelect: () => void
}) {
  // A fonte selecionada está comprovadamente ativa quando o QC a assiste pelo
  // PVW compartilhado. Não rotule isso como "aguardando sinal" só porque NDI
  // ainda não tem a telemetria de transporte equivalente ao SRT.
  const state = !source.enabled ? 'DESATIVADA' : selected ? 'PVW ATIVO' : telemetry ? telemetry.linkState : 'AGUARDANDO SINAL'
  const statusClass = !source.enabled || telemetry?.linkState === 'DISCONNECTED'
    ? 'text-on-air-crimson border-on-air-crimson/35 bg-on-air-crimson/10'
    : selected
      ? 'text-status-ok border-status-ok/35 bg-status-ok/10'
    : telemetry?.linkState === 'OPTIMAL'
      ? 'text-status-ok border-status-ok/35 bg-status-ok/10'
      : 'text-armed-amber border-armed-amber/35 bg-armed-amber/10'
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full p-2 rounded-lg border flex items-center gap-2.5 text-left transition-all cursor-pointer ${selected ? 'bg-primary-container/20 border-primary shadow-sm ring-1 ring-primary/40' : 'bg-surface-panel hover:bg-surface-panel/80 border-border-subtle hover:border-border-strong'}`}
      title="Abrir esta fonte no PVW compartilhado e assistir no player QC"
    >
      <span className="material-symbols-outlined text-accent-ice text-[20px]">sensors</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5"><strong className="truncate font-headline-md text-[12px] text-on-surface">{source.name}</strong><span className="rounded bg-surface-base px-1 font-label-mono text-[8px] text-accent-ice">{source.kind}</span></span>
        <span className="mt-0.5 block truncate font-label-mono text-[9px] text-outline" title={source.targetUrl}>{telemetry ? `${telemetry.bitrateKbps} kbps · RTT ${telemetry.rttMs.toFixed(0)} ms · perda ${telemetry.packetLossPercent.toFixed(2)}%` : source.targetUrl}</span>
      </span>
      <span className={`rounded border px-1.5 py-0.5 font-label-mono text-[8px] font-bold ${statusClass}`}>{state}</span>
    </button>
  )
}
