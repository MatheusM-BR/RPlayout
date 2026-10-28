import { useState, useRef, useEffect, useCallback } from 'react'
import type { MediaAsset, Rate } from '@rplayout/protocol'
import { dur, formatStandardRate } from '../../format.js'
import type { LibraryAsset } from '../../types.js'
import { Whep } from '../Whep.js'
import {lightweightPreviewUrl} from '../../domain/media-preview.js'

export interface BroadcastMonitorProps {
  bus: 'pgm' | 'pvw'
  title: string
  badgeText?: string
  webrtcPath: string | null
  port: number
  asset: LibraryAsset | MediaAsset | null
  rate: Rate
  scan?: string
  height?: number
  positionFrames?: number
  durationFrames?: number
  autoRemainingFrames?: number
  isPlaying?: boolean
  isAudioMonitored?: boolean
  onToggleAudioMonitor?: () => void
  onSeek?: (frames: number) => void
  onWatching?: ((bus: 'pgm' | 'pvw', watching: boolean) => void) | (() => void)
  className?: string
}

/** Same cadence as the Whep heartbeat; the server idles a monitor after 20 s. */
export const MONITOR_HEARTBEAT_MS = 5_000
/** A failed WHEP offer is retried; meanwhile the file preview (if any) shows. */
export const MONITOR_RETRY_MS = 6_000

/** While WHEP is down: heartbeat now and every 5 s, then remount WHEP once. */
export function monitorRecovery(beat:()=>void,retry:()=>void):()=>void{
  beat()
  const heartbeat=setInterval(beat,MONITOR_HEARTBEAT_MS)
  const again=setTimeout(retry,MONITOR_RETRY_MS)
  return ()=>{clearInterval(heartbeat);clearTimeout(again)}
}

/** Text for the empty screen. A failed WHEP while PGM is on air must not tell
 * the operator to press TAKE: the program is running, only this view is not. */
export function emptyMonitorText(isPgm:boolean,onAir:boolean,monitorFailed:boolean):{title:string;detail:string}{
  if(monitorFailed)return {title:isPgm&&onAir?'Saída no ar · prévia sem vídeo':'Monitor do engine reconectando',detail:isPgm&&onAir?'O canal está no ar (confira SAÍDAS no cabeçalho). Só a prévia deste navegador não recebeu vídeo (WebRTC, porta 8889); nova tentativa a cada 6 s.':'O vídeo deste monitor não chegou ao navegador (WebRTC, porta 8889); nova tentativa a cada 6 s.'}
  if(isPgm&&onAir)return {title:'Monitor aguardando imagem',detail:'PGM no ar; o monitor do engine ainda está abrindo.'}
  return isPgm?{title:'Nenhum Sinal no Ar',detail:'Pressione TAKE para iniciar a transmissão'}:{title:'Nenhum Item Armado',detail:'Clique em um item da grade ou no acervo MAM'}
}

export function BroadcastMonitor({
  bus,
  title,
  badgeText,
  webrtcPath,
  port,
  asset,
  rate,
  scan,
  height = 1080,
  positionFrames = 0,
  durationFrames = 0,
  autoRemainingFrames = 0,
  isPlaying = false,
  isAudioMonitored,
  onToggleAudioMonitor,
  onSeek,
  onWatching,
  className = '',
}: BroadcastMonitorProps) {
  const fps = rate.num / rate.den
  const isPgm = bus === 'pgm'
  const isPvw = bus === 'pvw'

  // Video element ref & local interactive player states
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isPlayingPreview, setIsPlayingPreview] = useState(false)
  const [currentTimeSec, setCurrentTimeSec] = useState(0)
  const [videoDurationSec, setVideoDurationSec] = useState(0)
  const [isMuted, setIsMuted] = useState(true)
  const [volume, setVolume] = useState(0.8)
  const [hasMediaError, setHasMediaError] = useState(false)
  const [isScrubbing, setIsScrubbing] = useState(false)
  const [webrtcFailed, setWebrtcFailed] = useState(false)
  const failedMonitor=useCallback(()=>setWebrtcFailed(true),[])
  const onWatchingRef=useRef(onWatching)
  useEffect(()=>{onWatchingRef.current=onWatching},[onWatching])

  // WHEP failed (typically 404: the engine only publishes the monitor after
  // someone watches, so the first offer races it). The Whep element is gone,
  // and with it its heartbeat; without these two the server stopped the
  // monitor 20 s later and the window stayed on "Nenhum item armado" forever.
  // Keep telling the server this window is open and try WHEP again.
  useEffect(()=>{
    if(!webrtcPath||!webrtcFailed)return undefined
    const beat=()=>{
      const notify=onWatchingRef.current
      if(!notify)return
      if(notify.length>0)(notify as (bus:'pgm'|'pvw',watching:boolean)=>void)(bus,true)
      else (notify as ()=>void)()
    }
    return monitorRecovery(beat,()=>setWebrtcFailed(false))
  },[webrtcPath,webrtcFailed,bus])

  // O áudio é desmutado se isAudioMonitored for explicitamente verdadeiro
  const effectiveMuted = isAudioMonitored !== undefined ? !isAudioMonitored : isMuted

  // Reset states when asset or stream changes
  useEffect(() => {
    setHasMediaError(false)
    setWebrtcFailed(false)
    setCurrentTimeSec(0)
    setIsPlayingPreview(false)
    if (videoRef.current) {
      videoRef.current.currentTime = 0
      videoRef.current.pause()
    }
  }, [asset?.id, asset?.contentHash, webrtcPath])

  // Sync PGM playback position with live engine
  useEffect(() => {
    if (!isPgm || !videoRef.current || isScrubbing) return
    const targetTime = positionFrames / fps
    if (Math.abs(videoRef.current.currentTime - targetTime) > 0.5) {
      videoRef.current.currentTime = targetTime
    }
    if (isPlaying && videoRef.current.paused) {
      videoRef.current.play().catch(() => {})
    } else if (!isPlaying && !videoRef.current.paused) {
      videoRef.current.pause()
    }
  }, [isPgm, positionFrames, fps, isPlaying, isScrubbing])

  // Play / Pause toggle for PVW preview
  const togglePlayPause = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation()
    const el = videoRef.current
    if (!el) return
    if (el.paused) {
      el.play().then(() => {
        setIsPlayingPreview(true)
      }).catch(() => {})
    } else {
      el.pause()
      setIsPlayingPreview(false)
    }
  }, [])

  // Frame step (-1f / +1f)
  const handleFrameStep = useCallback((direction: -1 | 1, e?: React.MouseEvent) => {
    e?.stopPropagation()
    const el = videoRef.current
    if (!el) return
    el.pause()
    setIsPlayingPreview(false)
    const newTime = Math.max(0, Math.min(el.duration || (durationFrames / fps), el.currentTime + (direction / fps)))
    el.currentTime = newTime
    setCurrentTimeSec(newTime)
    onSeek?.(Math.round(newTime * fps))
  }, [fps, durationFrames, onSeek])

  // Scrubbing
  const handleScrubChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value)
    setCurrentTimeSec(val)
    if (videoRef.current) {
      videoRef.current.currentTime = val
    }
  }

  const handleScrubEnd = () => {
    setIsScrubbing(false)
    if (videoRef.current) {
      onSeek?.(Math.round(videoRef.current.currentTime * fps))
    }
  }

  // Volume toggle
  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation()
    const nextMute = !isMuted
    setIsMuted(nextMute)
    if (videoRef.current) {
      videoRef.current.muted = nextMute
      videoRef.current.volume = volume
    }
  }

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation()
    const newVol = Number(e.target.value)
    setVolume(newVol)
    setIsMuted(newVol === 0)
    if (videoRef.current) {
      videoRef.current.volume = newVol
      videoRef.current.muted = newVol === 0
    }
  }

  // Sincroniza estado de áudio / mute com o elemento de vídeo
  useEffect(() => {
    if (!videoRef.current) return
    videoRef.current.muted = effectiveMuted
    if (!effectiveMuted) {
      videoRef.current.volume = volume
    }
  }, [effectiveMuted, volume])

  const handleToggleAudio = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onToggleAudioMonitor) {
      onToggleAudioMonitor()
    } else {
      toggleMute(e)
    }
  }

  const currentPreviewFrames = Math.round(currentTimeSec * fps)
  const isStillImage = asset?.kind === 'STILL' || asset?.path.endsWith('.png') || asset?.path.endsWith('.jpg')

  return (
    <div className={`bg-surface-card border border-border-subtle p-space-sm rounded-xl flex flex-col justify-between shadow-sm ${className}`}>
      {/* Header do Monitor (Layout 2 Linhas conforme Padrão MCR) */}
      <div className="flex items-center justify-between pb-1.5 gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`w-2.5 h-2.5 rounded-full shrink-0 ${
              isPgm ? 'bg-on-air-crimson animate-pulse shadow-[0_0_6px_rgba(255,59,48,0.7)]' : 'bg-armed-amber'
            }`}
          />
          <div className="flex flex-col leading-tight">
            <span className="font-headline-md text-[10px] uppercase text-on-surface font-bold tracking-wider">
              {title}
            </span>
            <span className="font-label-caps text-[10px] uppercase text-outline font-semibold tracking-wider">
              {isPgm ? 'PRINCIPAL' : 'CUE MANUAL'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Botão de Monitoramento de Áudio Exclusivo (PGM ou PVW) em 2 linhas */}
          <button
            onClick={handleToggleAudio}
            className={`flex items-center gap-1.5 px-2 py-1 rounded text-center transition-all cursor-pointer border ${
              !effectiveMuted
                ? isPgm
                  ? 'bg-on-air-crimson text-white border-on-air-crimson shadow-[0_0_8px_rgba(255,59,48,0.5)]'
                  : 'bg-armed-amber text-surface-base border-armed-amber shadow-[0_0_8px_rgba(255,149,0,0.5)]'
                : 'bg-surface-panel hover:bg-surface-container text-outline hover:text-on-surface border-border-subtle'
            }`}
            title={
              !effectiveMuted
                ? `Ouvindo áudio ${bus.toUpperCase()} na cabine (Clique para mutar)`
                : `Monitorar áudio ${bus.toUpperCase()} (Exclusivo: desativa o outro canal)`
            }
          >
            <span className="material-symbols-outlined text-[15px]">
              {!effectiveMuted ? 'volume_up' : 'volume_off'}
            </span>
            <div className="flex flex-col text-left font-label-mono leading-none">
              <span className="text-[10px] font-bold uppercase">{!effectiveMuted ? 'ÁUDIO' : 'OUVIR'}</span>
              <span className="text-[10px] font-bold uppercase mt-0.5">{bus.toUpperCase()}</span>
            </div>
          </button>

        </div>
      </div>

      {/* Screen Container 16:9 - Altura compacta para console profissional */}
      <div className="w-full aspect-video max-h-[220px] bg-surface-container-lowest rounded-lg overflow-hidden relative shadow-sm group select-none flex items-center justify-center mx-auto">
        {/* Caso 1: WebRTC WHEP Ativo */}
        {webrtcPath && !webrtcFailed ? (
          <Whep
            path={webrtcPath}
            port={port}
            frameRate={fps}
            positionFrames={positionFrames}
            durationFrames={durationFrames}
            onSeek={onSeek}
            hideControls={true}
            muted={effectiveMuted}
            onErrorFallback={failedMonitor}
            onWatching={
              onWatching
                ? () => {
                    if (onWatching.length > 0) {
                      (onWatching as (bus: 'pgm' | 'pvw', watching: boolean) => void)(bus, true)
                    } else {
                      (onWatching as () => void)()
                    }
                  }
                : undefined
            }
          />
        ) : asset ? (
          /* Consulta leve de arquivo: não confirma sinal/saída do engine. */
          <div className="relative w-full h-full flex items-center justify-center bg-black">
            <span className="absolute bottom-1 left-1 right-1 z-30 rounded bg-black/80 px-2 py-1 text-[10px] text-amber-300 pointer-events-none">
              {hasMediaError ? 'Proxy indisponível — confira a fila de mídia' : 'Proxy de consulta — não confirma PGM/PVW'}
            </span>
            {webrtcFailed && webrtcPath && (
              <button
                onClick={() => setWebrtcFailed(false)}
                className="absolute top-1.5 left-1.5 z-30 px-2 py-0.5 rounded bg-surface-card/90 hover:bg-surface-card text-[10px] font-label-mono text-outline hover:text-white border border-border-subtle cursor-pointer flex items-center gap-1 shadow"
                title="Tentar reconectar stream WebRTC"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-armed-amber animate-pulse"></span>
                <span>Reconectar monitor do engine</span>
              </button>
            )}
            {isStillImage || hasMediaError ? (
              <img
                src={`/api/assets/${asset.id}/thumbnail.svg`}
                alt={asset.title}
                className="w-full h-full object-contain"
              />
            ) : (
              <video
                ref={videoRef}
                src={lightweightPreviewUrl(asset)}
                poster={`/api/assets/${asset.id}/thumbnail.svg`}
                preload="metadata"
                muted={effectiveMuted}
                playsInline
                className="w-full h-full object-contain cursor-pointer"
                onClick={isPvw ? togglePlayPause : undefined}
                onTimeUpdate={() => {
                  if (!isScrubbing && videoRef.current) {
                    setCurrentTimeSec(videoRef.current.currentTime)
                  }
                }}
                onLoadedMetadata={() => {
                  if (videoRef.current) {
                    setVideoDurationSec(videoRef.current.duration || (durationFrames / fps))
                    videoRef.current.volume = volume
                    videoRef.current.muted = effectiveMuted
                  }
                }}
                onEnded={() => {
                  setIsPlayingPreview(false)
                }}
                onError={() => {
                  setHasMediaError(true)
                }}
              />
            )}

            {/* PVW: Play / Pause Overlay Central */}
            {isPvw && !isStillImage && !hasMediaError && (
              <button
                onClick={togglePlayPause}
                className={`absolute inset-0 m-auto w-12 h-12 rounded-full bg-surface-base/70 hover:bg-armed-amber text-on-surface hover:text-surface-base flex items-center justify-center backdrop-blur-sm border border-border-subtle/80 transition-all duration-200 cursor-pointer z-20 ${
                  isPlayingPreview ? 'opacity-0 group-hover:opacity-100 scale-95' : 'opacity-90 scale-100 shadow-lg'
                }`}
                title={isPlayingPreview ? 'Pausar Preview' : 'Rodar Preview no Monitor'}
              >
                <span className="material-symbols-outlined text-[28px]">
                  {isPlayingPreview ? 'pause' : 'play_arrow'}
                </span>
              </button>
            )}

            {/* PVW: Barra de Controle Interativa de Scrub / Áudio (ao passar o mouse) */}
            {isPvw && !isStillImage && !hasMediaError && (
              <div className="absolute inset-x-0 bottom-6 bg-gradient-to-t from-surface-base/95 via-surface-base/80 to-transparent pt-3 pb-1 px-2.5 flex flex-col gap-1 z-20 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-auto">
                {/* Scrub Slider */}
                <input
                  type="range"
                  min="0"
                  max={videoDurationSec > 0 ? videoDurationSec : (durationFrames / fps) || 1}
                  step="0.01"
                  value={currentTimeSec}
                  onMouseDown={() => setIsScrubbing(true)}
                  onTouchStart={() => setIsScrubbing(true)}
                  onChange={handleScrubChange}
                  onMouseUp={handleScrubEnd}
                  onTouchEnd={handleScrubEnd}
                  className="w-full h-1 bg-surface-container-high rounded-lg appearance-none cursor-pointer accent-armed-amber"
                  title="Arrastar posição do clipe"
                />

                <div className="flex items-center justify-between text-[10px] font-label-mono text-on-surface pt-0.5">
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={togglePlayPause}
                      className="p-0.5 rounded hover:bg-surface-container text-armed-amber flex items-center justify-center cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[15px]">
                        {isPlayingPreview ? 'pause' : 'play_arrow'}
                      </span>
                    </button>
                    <button
                      onClick={(e) => handleFrameStep(-1, e)}
                      className="px-1 py-0.5 rounded bg-surface-panel hover:bg-surface-container text-outline hover:text-on-surface text-[10px] font-bold cursor-pointer"
                      title="Voltar 1 quadro (-1f)"
                    >
                      -1f
                    </button>
                    <button
                      onClick={(e) => handleFrameStep(1, e)}
                      className="px-1 py-0.5 rounded bg-surface-panel hover:bg-surface-container text-outline hover:text-on-surface text-[10px] font-bold cursor-pointer"
                      title="Avançar 1 quadro (+1f)"
                    >
                      +1f
                    </button>
                    <span className="text-armed-amber font-bold tabular-nums">
                      {dur(currentPreviewFrames, rate)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleToggleAudio}
                      className="p-0.5 rounded hover:bg-surface-container text-outline hover:text-on-surface cursor-pointer"
                      title={!effectiveMuted ? 'Mutar Áudio' : 'Ativar Áudio de Monitoramento'}
                    >
                      <span className="material-symbols-outlined text-[14px]">
                        {!effectiveMuted ? 'volume_up' : 'volume_off'}
                      </span>
                    </button>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={effectiveMuted ? 0 : volume}
                      onChange={handleVolumeChange}
                      className="w-12 h-1 bg-surface-container-high rounded appearance-none cursor-pointer accent-armed-amber"
                      title="Volume"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Caso 3: Sem sinal / Sem mídia */
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-surface-container-lowest text-outline p-4">
            <span className="material-symbols-outlined text-[32px] opacity-40">
              {isPgm ? 'videocam_off' : 'queue_play_next'}
            </span>
            <div className="font-label-caps text-[10px] uppercase font-semibold tracking-wider text-outline/80">
              {emptyMonitorText(isPgm,isPlaying,Boolean(webrtcPath&&webrtcFailed)).title}
            </div>
            <div className="font-label-mono text-[10px] text-outline/60 text-center">
              {emptyMonitorText(isPgm,isPlaying,Boolean(webrtcPath&&webrtcFailed)).detail}
            </div>
          </div>
        )}

        {/* O frame do WHEP já vem do compositor do engine. Não há CG HTML
            adicional aqui: assim PGM, WebRTC e todas as saídas exibem a mesma
            composição SVG/RGBA autoritativa. */}

        {/* Tarja Inferior Permanente (Design Stitch) */}
        <div className="absolute bottom-0 inset-x-0 bg-surface-base/80 backdrop-blur-sm px-2 py-0.5 flex items-center justify-between font-label-mono text-[10px] text-on-surface z-10 pointer-events-none">
          <span
            className={`font-bold tabular-nums ${
              isPgm ? 'text-on-air-crimson' : 'text-armed-amber'
            }`}
          >
            {isPgm
              ? dur(positionFrames, rate)
              : dur(durationFrames, rate)}
          </span>
          <span className="text-outline">
            {isPgm
              ? formatStandardRate(rate, scan, height)
              : `Auto ${dur(autoRemainingFrames, rate)}`}
          </span>
        </div>
      </div>
    </div>
  )
}
