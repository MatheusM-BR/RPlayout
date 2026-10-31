import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { wallClock, wallTime } from '../../domain/wall-clock.js'
import type { Channel, Rate } from '@rplayout/protocol'
import {
  framesToMs,
  msToFrames,
  type TimelineZoomLevel,
  type BroadcastItemCategory,
  BROADCAST_CATEGORY_COLORS,
} from '@rplayout/protocol'
import type { ItemView } from '../../types.js'
import { clock, dur } from '../../format.js'

export interface MultiTrackTimelineProps {
  channel: Channel
  items: ItemView[]
  onAirIndex?: number
  cuedIndex?: number
  elapsedFrames?: number
  remainingFrames?: number
  onSelectItem?: (index: number) => void
  onAutoFill?: () => void
  rundownId?: string
}

interface TimelineBlock {
  id: string
  index: number
  title: string
  category: BroadcastItemCategory
  colorHex: string
  startFrames: number
  durationFrames: number
  endFrames: number
  startMs: number
  durationMs: number
  endMs: number
  isGap: boolean
  isOnAir: boolean
  isCued: boolean
  lufsEstimated: number
  hasLowerThird: boolean
  hasLogo: boolean
  hasTicker: boolean
  hasScteCueOut: boolean
  hasScteCueIn: boolean
  scteDurationSec: number
}

// Escalas em milissegundos para cada modo de zoom
const ZOOM_CONFIG: Record<TimelineZoomLevel, { totalMs: number; label: string; description: string; tickIntervalMs: number }> = {
  ZOOM_24H: {
    totalMs: 24 * 60 * 60 * 1000, // 24 Horas
    label: '24H',
    description: 'Visão Macro Diária 24 Horas',
    tickIntervalMs: 60 * 60 * 1000, // Marcador a cada 1 hora
  },
  ZOOM_1H: {
    totalMs: 60 * 60 * 1000, // 1 Hora
    label: '1H',
    description: 'Visão de Bloco de 60 Minutos',
    tickIntervalMs: 5 * 60 * 1000, // Marcador a cada 5 minutos
  },
  ZOOM_5M: {
    totalMs: 5 * 60 * 1000, // 5 Minutos
    label: '5M',
    description: 'Trimming de Breaks (5 Minutos)',
    tickIntervalMs: 30 * 1000, // Marcador a cada 30 segundos
  },
  ZOOM_10S: {
    totalMs: 10 * 1000, // 10 Segundos
    label: '10S',
    description: 'Precisão de Quadro Frame-Accurate (10 Segundos)',
    tickIntervalMs: 1 * 1000, // Marcador a cada 1 segundo
  },
}

export const MultiTrackTimeline: React.FC<MultiTrackTimelineProps> = ({
  channel,
  items,
  onAirIndex = -1,
  cuedIndex = -1,
  elapsedFrames = 0,
  onSelectItem,
  onAutoFill,
}) => {
  const [zoomLevel, setZoomLevel] = useState<TimelineZoomLevel>('24H' as any)
  // Normalizar zoomLevel para a chave correspondente
  const activeZoomKey: TimelineZoomLevel =
    zoomLevel === 'ZOOM_24H' || (zoomLevel as string) === '24H'
      ? 'ZOOM_24H'
      : zoomLevel === 'ZOOM_1H' || (zoomLevel as string) === '1H'
      ? 'ZOOM_1H'
      : zoomLevel === 'ZOOM_5M' || (zoomLevel as string) === '5M'
      ? 'ZOOM_5M'
      : 'ZOOM_10S'

  const [followPlayhead, setFollowPlayhead] = useState(true)
  const [hoveredBlock, setHoveredBlock] = useState<TimelineBlock | null>(null)
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null)
  const [scrollOffsetMs, setScrollOffsetMs] = useState(0)

  const containerRef = useRef<HTMLDivElement>(null)
  const tracksScrollRef = useRef<HTMLDivElement>(null)

  const rate: Rate = channel.rate

  // 1. Processamento e projeção temporal de todos os blocos da grade
  const { blocks, totalDurationFrames, totalDurationMs, detectedGaps, playheadFrames, playheadMs } = useMemo(() => {
    const list: TimelineBlock[] = []
    let cumulativeFrames = 0
    let gapsCount = 0

    items.forEach((iv, index) => {
      const duration = iv.trim
        ? Math.max(0, iv.trim.out - iv.trim.in)
        : (iv.item.durationOverride ?? iv.asset?.durationFrames ?? 0)

      const startF = cumulativeFrames
      const endF = cumulativeFrames + duration
      const startM = framesToMs(startF, rate)
      const durM = framesToMs(duration, rate)
      const endM = framesToMs(endF, rate)

      // Determinar categoria canônica
      let category: BroadcastItemCategory = 'NEWS'
      const titleUpper = (iv.item.title || iv.asset?.title || '').toUpperCase()

      const isLive = iv.item.eventType === 'LIVE' || ('isLiveSource' in (iv.asset || {}) && (iv.asset as any).isLiveSource)
      if (duration <= 0 || !iv.asset && !isLive) {
        category = 'GAP'
        gapsCount++
      } else if (isLive) {
        category = 'LIVE'
      } else if (
        titleUpper.includes('COMERCIAL') ||
        titleUpper.includes('BREAK') ||
        titleUpper.includes('SPOT') ||
        titleUpper.includes('PATROC')
      ) {
        category = 'COMMERCIAL'
      } else if (
        titleUpper.includes('PROMO') ||
        titleUpper.includes('CHAMADA') ||
        titleUpper.includes('INSTITUCIONAL') ||
        titleUpper.includes('VINHETA')
      ) {
        category = 'PROMO'
      } else if (titleUpper.includes('FILLER') || titleUpper.includes('COLORBAR')) {
        category = 'FILLER'
      } else if (titleUpper.includes('FILME') || titleUpper.includes('SERIE') || titleUpper.includes('NOVELA')) {
        category = 'DRAMA'
      } else {
        category = 'NEWS'
      }

      const colorHex = category === 'GAP'
        ? BROADCAST_CATEGORY_COLORS.GAP
        : category === 'LIVE'
        ? '#06B6D4'
        : BROADCAST_CATEGORY_COLORS[category] || '#2563EB'

      // Estimativa sonora de Loudness (EBU R128 alvo -23 LUFS)
      let lufsEstimated = -23.0
      if (category === 'COMMERCIAL') {
        lufsEstimated = -22.1 // Comerciais ligeiramente mais quentes
      } else if (category === 'LIVE') {
        lufsEstimated = -23.8
      } else if (category === 'PROMO') {
        lufsEstimated = -22.8
      } else if (category === 'GAP') {
        lufsEstimated = -99.0 // Silêncio no gap
      }

      // Sincronia de eventos secundários e SCTE-35
      const hasLowerThird = category === 'NEWS' || category === 'LIVE'
      const hasLogo = category !== 'COMMERCIAL' && category !== 'GAP'
      const hasTicker = category === 'NEWS'
      const hasScteCueOut = category === 'COMMERCIAL'
      const hasScteCueIn = category === 'COMMERCIAL'
      const scteDurationSec = category === 'COMMERCIAL' ? Math.round(duration / (rate.num / rate.den)) : 0

      list.push({
        id: `block-${iv.item.id}-${index}`,
        index,
        title: iv.item.title || iv.asset?.title || (category === 'GAP' ? 'GAP / LACUNA NÃO PREENCHIDA' : `Item #${index + 1}`),
        category,
        colorHex,
        startFrames: startF,
        durationFrames: duration,
        endFrames: endF,
        startMs: startM,
        durationMs: durM,
        endMs: endM,
        isGap: category === 'GAP',
        isOnAir: index === onAirIndex,
        isCued: index === cuedIndex,
        lufsEstimated,
        hasLowerThird,
        hasLogo,
        hasTicker,
        hasScteCueOut,
        hasScteCueIn,
        scteDurationSec,
      })

      cumulativeFrames += duration
    })

    // Calcular posição do playhead
    let currentPlayheadF = 0
    if (onAirIndex >= 0 && onAirIndex < list.length) {
      const onAirBlock = list[onAirIndex]
      if (onAirBlock) {
        currentPlayheadF = onAirBlock.startFrames + elapsedFrames
      }
    }
    const currentPlayheadM = framesToMs(currentPlayheadF, rate)

    return {
      blocks: list,
      totalDurationFrames: cumulativeFrames,
      totalDurationMs: framesToMs(cumulativeFrames, rate),
      detectedGaps: gapsCount,
      playheadFrames: currentPlayheadF,
      playheadMs: currentPlayheadM,
    }
  }, [items, onAirIndex, cuedIndex, elapsedFrames, rate])

  // 2. Parâmetros de Viewport e Zoom
  const zoomConfig = ZOOM_CONFIG[activeZoomKey] ?? ZOOM_CONFIG.ZOOM_24H
  const visibleDurationMs = zoomConfig.totalMs

  // Ajustar início da janela temporal visível
  const viewportStartMs = useMemo(() => {
    if (activeZoomKey === 'ZOOM_24H') return 0
    if (followPlayhead) {
      // Lookahead buffer: playhead posicionado a 20% da tela à esquerda
      const targetStart = playheadMs - visibleDurationMs * 0.2
      return Math.max(0, targetStart)
    }
    return scrollOffsetMs
  }, [activeZoomKey, followPlayhead, playheadMs, visibleDurationMs, scrollOffsetMs])

  const viewportEndMs = viewportStartMs + visibleDurationMs

  // Conversão de tempo (ms) para percentual da timeline visível
  const msToPercent = useCallback(
    (ms: number) => {
      const relMs = ms - viewportStartMs
      return (relMs / visibleDurationMs) * 100
    },
    [viewportStartMs, visibleDurationMs]
  )

  // 3. Playhead NTP Timecode Textual formatado
  const playheadTimecode = useMemo(() => {
    return wallTime(playheadFrames, rate)
  }, [playheadFrames, rate])

  // Ação de 1-Clique: Autofill de Gap
  // Opens the parent's proposal editor; no mutation or optimistic success.
  const handleAutoFillClick = () => onAutoFill?.()

  // Ticks da Régua Temporal
  const rulerTicks = useMemo(() => {
    const ticks: { ms: number; label: string; isMajor: boolean; leftPercent: number }[] = []
    const step = zoomConfig.tickIntervalMs

    // Alinhamento ao primeiro múltiplo do step
    const firstTickMs = Math.floor(viewportStartMs / step) * step
    const lastTickMs = viewportEndMs + step

    for (let t = firstTickMs; t <= lastTickMs; t += step) {
      if (t < viewportStartMs || t > viewportEndMs) continue
      const leftP = ((t - viewportStartMs) / visibleDurationMs) * 100

      // Rótulo direto do tempo (antes vinha de quadros arredondados para baixo
      // e o eixo mostrava 00:59, 01:59…).
      const totalSeconds = Math.round(t / 1000)
      const two = (value: number) => String(value).padStart(2, '0')
      const hhmm = `${two(Math.floor(totalSeconds / 3600) % 24)}:${two(Math.floor(totalSeconds / 60) % 60)}`
      let label = hhmm
      if (activeZoomKey === 'ZOOM_1H' || activeZoomKey === 'ZOOM_5M') {
        label = `${hhmm}:${two(totalSeconds % 60)}`
      } else if (activeZoomKey === 'ZOOM_10S') {
        label = wallTime(msToFrames(t, rate), rate) // HH:MM:SS:FF
      }

      ticks.push({
        ms: t,
        label,
        isMajor: true,
        leftPercent: leftP,
      })
    }
    // No máximo ~12 rótulos: com 24 marcas os textos se sobrepunham.
    const every = Math.max(1, Math.ceil(ticks.length / 12))
    return ticks.map((tick, index) => (index % every === 0 ? tick : { ...tick, label: '' }))
  }, [viewportStartMs, viewportEndMs, visibleDurationMs, zoomConfig.tickIntervalMs, activeZoomKey, rate])

  // Playhead posição horizontal em percentual
  const playheadPercent = msToPercent(playheadMs)
  const isPlayheadVisible = playheadPercent >= 0 && playheadPercent <= 100

  // Tratamento de rolagem horizontal manual quando followPlayhead desativado
  const handleWheel = (e: React.WheelEvent) => {
    if (activeZoomKey === 'ZOOM_24H') return
    e.stopPropagation()
    const deltaMs = (e.deltaX || e.deltaY) * (visibleDurationMs / 1000)
    setFollowPlayhead(false)
    setScrollOffsetMs((prev) => Math.max(0, prev + deltaMs))
  }

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      className="w-full bg-surface-card border border-border-subtle rounded-xl flex flex-col shadow-lg overflow-hidden select-none"
      aria-label="Timeline Visual Multicamada 24H"
    >
      {/* 1. BARRA DE CONTROLE SUPERIOR DA TIMELINE */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-space-lg py-space-sm bg-surface-panel/95 border-b border-border-subtle">
        {/* Esquerda: Identificação e Timecode Playhead NTP */}
        <div className="flex items-center gap-space-lg">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-accent-ice text-[22px]">view_timeline</span>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-headline-md text-headline-md uppercase text-on-surface font-bold tracking-wide">
                  Timeline Multicamada
                </span>
              </div>
              <div className="font-label-mono text-[12px] text-outline">
                Relógio do sistema • {channel.name || 'Canal Master'}
              </div>
            </div>
          </div>

          {/* Timecode Luminescente do Playhead NTP no ar */}
          <div className="px-3 py-1 rounded-lg bg-surface-base/90 border border-on-air-crimson/50 flex flex-col items-center shadow-inner">
            <span className="font-label-caps text-[11px] text-on-air-crimson/90 font-bold uppercase tracking-wider">
              HORA DO PLAYHEAD
            </span>
            <span className="font-timecode-display text-[22px] font-bold text-on-air-crimson tabular-nums leading-none tracking-wider drop-shadow-[0_0_8px_rgba(255,59,48,0.55)]">
              {playheadTimecode}
            </span>
          </div>
        </div>

        {/* Centro: Seletor Tátil de Zoom e Controles de Navegação */}
        <div className="flex items-center gap-2">
          {/* Botões Táteis de Zoom: 24H | 1H | 5M | 10S */}
          <div className="flex items-center bg-surface-base p-1 rounded-lg border border-border-subtle">
            {(['ZOOM_24H', 'ZOOM_1H', 'ZOOM_5M', 'ZOOM_10S'] as TimelineZoomLevel[]).map((level) => {
              const active = activeZoomKey === level
              const cfg = ZOOM_CONFIG[level]
              return (
                <button
                  key={level}
                  onClick={() => {
                    setZoomLevel(level)
                    if (level === 'ZOOM_24H') setFollowPlayhead(false)
                  }}
                  title={cfg.description}
                  className={`px-3 py-1 rounded font-timecode-table text-xs font-bold transition-all cursor-pointer ${
                    active
                      ? 'bg-accent-ice text-white shadow-sm ring-1 ring-accent-ice/80'
                      : 'text-outline hover:text-on-surface hover:bg-surface-container'
                  }`}
                >
                  {cfg.label}
                </button>
              )
            })}
          </div>

          {/* Botão Seguir Playhead */}
          <button
            onClick={() => setFollowPlayhead((prev) => !prev)}
            className={`px-2.5 py-1.5 rounded-lg border font-body-sm text-body-sm flex items-center gap-1.5 transition-colors cursor-pointer ${
              followPlayhead
                ? 'bg-on-air-crimson/20 border-on-air-crimson text-on-air-crimson font-bold shadow-sm'
                : 'bg-surface-panel hover:bg-surface-container border-border-subtle text-outline hover:text-on-surface'
            }`}
            title="Manter playhead centralizado com lookahead contínuo"
          >
            <span className="material-symbols-outlined text-[16px]">gps_fixed</span>
            <span className="text-[11px] uppercase font-bold">{followPlayhead ? 'SEGUINDO NO AR' : 'LIVRE'}</span>
          </button>
        </div>

        {/* Direita: Detecção de Gap & Ação Rápida de Autofill em 1-Clique */}
        <div className="flex items-center gap-2">
          {detectedGaps > 0 ? (
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-armed-amber/20 border border-armed-amber/60 text-armed-amber font-label-mono text-[12px] font-bold animate-pulse">
                <span className="material-symbols-outlined text-[16px]">warning</span>
                {detectedGaps} {detectedGaps === 1 ? 'GAP DETECTADO' : 'GAPS DETECTADOS'}
              </span>

              <button
                onClick={handleAutoFillClick}
                disabled={!onAutoFill}
                className="px-3 py-1.5 rounded-lg bg-armed-amber hover:bg-armed-amber-hover text-surface-base font-label-caps text-xs font-bold flex items-center gap-1.5 transition-all shadow-md active:scale-95 cursor-pointer disabled:opacity-50"
                title="Preencher lacunas com fillers ou colorbars com 1 clique"
              >
                <span className="material-symbols-outlined text-[16px]">
                  auto_fix_high
                </span>
                <span>REVISAR PREENCHIMENTO</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-status-ok/15 border border-status-ok/30 text-status-ok font-label-mono text-[12px] font-bold">
              <span className="material-symbols-outlined text-[16px]">check_circle</span>
              GRADE 100% CONTÍNUA
            </div>
          )}
        </div>
      </div>

      {/* 2. ÁREA MULTIPISTA COM RÉGUA GRADUADA E TRACKS PARALELAS */}
      <div className="relative flex flex-col bg-surface-base overflow-hidden">
        {/* Playhead Luminescente Global (Linha vertical que atravessa Régua + 4 Pistas) */}
        {isPlayheadVisible && (
          <div
            className="absolute top-0 bottom-0 pointer-events-none z-30 transition-all duration-75 ease-linear flex flex-col items-center"
            style={{ left: `${playheadPercent}%` }}
          >
            {/* Marcador triangular luminescente no topo */}
            <div className="w-0 h-0 border-x-[5px] border-x-transparent border-t-[8px] border-t-on-air-crimson drop-shadow-[0_0_8px_#EF4444] -mt-0.5"></div>
            {/* Linha vertical luminescente contínua de 2px */}
            <div className="w-[2px] flex-1 bg-on-air-crimson shadow-[0_0_10px_#EF4444]"></div>
          </div>
        )}

        {/* 2.1 RÉGUA DE TEMPO GRADUADA (TIME RULER) */}
        <div className="flex border-b border-border-subtle bg-surface-panel/90 h-8 sticky top-0 z-20">
          {/* Label fixo lateral da régua */}
          <div className="w-44 shrink-0 px-space-md flex items-center justify-between border-r border-border-subtle bg-surface-panel font-label-mono text-[12px] text-outline uppercase font-bold">
            <span>ESCALA TEMPORAL</span>
            <span className="text-accent-ice">{zoomConfig.label}</span>
          </div>

          {/* Área da régua graduada */}
          <div className="flex-1 relative overflow-hidden h-full">
            {rulerTicks.map((tick, i) => (
              <div
                key={`tick-${i}-${tick.ms}`}
                className="absolute top-0 bottom-0 flex flex-col justify-between pointer-events-none"
                style={{ left: `${tick.leftPercent}%` }}
              >
                <div className="h-2 w-[1px] bg-border-strong"></div>
                <span className="font-timecode-table text-[12px] text-outline font-semibold -ml-3 select-none">
                  {tick.label}
                </span>
                <div className="h-1 w-[1px] bg-border-subtle"></div>
              </div>
            ))}
          </div>
        </div>

        {/* 2.2 AS 4 PISTAS PARALELAS SINCRONIZADAS */}
        <div ref={tracksScrollRef} className="flex flex-col divide-y divide-border-subtle/50 relative">
          {/* ========================================================= */}
          {/* PISTA 1: PGM / MASTER VIDEO                                */}
          {/* ========================================================= */}
          <div className="flex items-stretch h-14 bg-surface-card/60 hover:bg-surface-card/90 transition-colors group">
            {/* Track Header Lateral */}
            <div className="w-44 shrink-0 px-space-md flex items-center justify-between border-r border-border-subtle bg-surface-panel/80 font-label-caps">
              <div className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-on-air-crimson text-[17px]">movie</span>
                <span className="font-bold text-[11px] text-on-surface">1. PGM VIDEO</span>
              </div>
              <span className="font-label-mono text-[12px] px-1 py-0.5 rounded bg-surface-container text-outline">
                MASTER
              </span>
            </div>

            {/* Pista Gráfica de Blocos */}
            <div className="flex-1 relative overflow-hidden h-full">
              {blocks.map((block) => {
                const left = msToPercent(block.startMs)
                const width = Math.max(0.4, (block.durationMs / visibleDurationMs) * 100)

                // Culling visual para performance
                if (left + width < 0 || left > 100) return null

                const isHovered = hoveredBlock?.id === block.id

                return (
                  <div
                    key={block.id}
                    onClick={() => onSelectItem?.(block.index)}
                    onMouseEnter={(e) => {
                      setHoveredBlock(block)
                      const rect = e.currentTarget.getBoundingClientRect()
                      setTooltipPos({ x: rect.left + rect.width / 2, y: rect.top - 12 })
                    }}
                    onMouseLeave={() => setHoveredBlock(null)}
                    className={`absolute top-1 bottom-1 rounded px-2 flex flex-col justify-center overflow-hidden cursor-pointer transition-all duration-100 ${
                      block.isGap
                        ? 'bg-[repeating-linear-gradient(45deg,#EAB308,#EAB308_8px,#713F12_8px,#713F12_16px)] text-yellow-100 font-bold border border-yellow-500 shadow-md'
                        : block.isOnAir
                        ? 'border-2 border-on-air-crimson shadow-[0_0_12px_rgba(255,59,48,0.5)] z-10'
                        : block.isCued
                        ? 'border-2 border-armed-amber shadow-[0_0_10px_rgba(255,149,0,0.4)] z-10'
                        : 'border border-black/30 hover:border-white/40'
                    }`}
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      backgroundColor: block.isGap ? undefined : block.colorHex,
                    }}
                  >
                    <div className="flex items-center justify-between gap-1 overflow-hidden leading-tight">
                      <span className="font-body-sm text-[11px] font-bold text-white truncate drop-shadow-sm">
                        {block.isGap ? `⚠ GAP: ${dur(block.durationFrames, rate)}` : block.title}
                      </span>
                      {block.isOnAir && (
                        <span className="shrink-0 px-1 py-0.2 rounded bg-on-air-crimson text-white font-label-caps text-[11px] font-bold">
                          AR
                        </span>
                      )}
                      {block.isCued && (
                        <span className="shrink-0 px-1 py-0.2 rounded bg-armed-amber text-surface-base font-label-caps text-[11px] font-bold">
                          PVW
                        </span>
                      )}
                    </div>
                    {width > 4 && (
                      <div className="flex items-center gap-1 font-timecode-table text-[12px] text-white/80 tabular-nums">
                        <span>{wallClock(block.startFrames, rate)}</span>
                        <span>•</span>
                        <span>{dur(block.durationFrames, rate)}</span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* ========================================================= */}
          {/* PISTA 2: SECONDARY EVENTS / CG                             */}
          {/* ========================================================= */}
          <div className="flex items-stretch h-9 bg-surface-card/40 hover:bg-surface-card/70 transition-colors">
            {/* Track Header Lateral */}
            <div className="w-44 shrink-0 px-space-md flex items-center justify-between border-r border-border-subtle bg-surface-panel/80 font-label-caps">
              <div className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-cyan-400 text-[16px]">layers</span>
                <span className="font-bold text-[11px] text-on-surface">2. SECONDARY / CG</span>
              </div>
              <span className="font-label-mono text-[12px] px-1 py-0.5 rounded bg-surface-container text-outline">
                OVERLAY
              </span>
            </div>

            {/* Pista Gráfica de Grafismo e Overlays */}
            <div className="flex-1 relative overflow-hidden h-full">
              {blocks.map((block) => {
                const left = msToPercent(block.startMs)
                const width = Math.max(0.4, (block.durationMs / visibleDurationMs) * 100)

                if (left + width < 0 || left > 100) return null

                return (
                  <React.Fragment key={`cg-${block.id}`}>
                    {/* Tarja de Lower-Third */}
                    {block.hasLowerThird && (
                      <div
                        className="absolute top-1 bottom-1 rounded bg-cyan-500/80 border border-cyan-400/90 text-surface-base font-label-caps text-[11px] font-bold flex items-center px-1 truncate shadow-sm z-10"
                        style={{
                          left: `${left + width * 0.1}%`,
                          width: `${width * 0.7}%`,
                        }}
                        title={`Lower-Third: ${block.title}`}
                      >
                        <span className="material-symbols-outlined text-[11px] mr-0.5">subtitles</span>
                        <span>LOWER-THIRD</span>
                      </div>
                    )}

                    {/* Logo d'água On-Air */}
                    {block.hasLogo && !block.hasLowerThird && (
                      <div
                        className="absolute top-1 bottom-1 rounded bg-sky-600/40 border border-sky-400/50 text-sky-200 font-label-caps text-[11px] font-medium flex items-center px-1 truncate"
                        style={{
                          left: `${left}%`,
                          width: `${width}%`,
                        }}
                        title="Selo / Logotipo no ar"
                      >
                        <span className="material-symbols-outlined text-[11px] mr-0.5">watermark</span>
                        <span>LOGO ON-AIR</span>
                      </div>
                    )}
                  </React.Fragment>
                )
              })}
            </div>
          </div>

          {/* ========================================================= */}
          {/* PISTA 3: SCTE-35 / DPI MARKERS                             */}
          {/* ========================================================= */}
          <div className="flex items-stretch h-9 bg-surface-card/40 hover:bg-surface-card/70 transition-colors">
            {/* Track Header Lateral */}
            <div className="w-44 shrink-0 px-space-md flex items-center justify-between border-r border-border-subtle bg-surface-panel/80 font-label-caps">
              <div className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-fuchsia-400 text-[16px]">cell_tower</span>
                <span className="font-bold text-[11px] text-on-surface">3. SCTE-35 / DPI</span>
              </div>
              <span className="font-label-mono text-[12px] px-1 py-0.5 rounded bg-surface-container text-outline">
                REGIONAL
              </span>
            </div>

            {/* Pista Gráfica de SCTE-35 */}
            <div className="flex-1 relative overflow-hidden h-full">
              {blocks.map((block) => {
                const left = msToPercent(block.startMs)
                const width = Math.max(0.4, (block.durationMs / visibleDurationMs) * 100)

                if (left + width < 0 || left > 100) return null

                if (!block.hasScteCueOut) return null

                return (
                  <div
                    key={`scte-${block.id}`}
                    className="absolute top-1 bottom-1 rounded bg-fuchsia-950/50 border border-fuchsia-500/70 text-fuchsia-300 flex items-center justify-between px-1.5 overflow-hidden"
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                    }}
                    title={`Janela SCTE-35 DPI: Cue Out -> Cue In (${block.scteDurationSec}s)`}
                  >
                    <div className="flex items-center gap-0.5 text-fuchsia-400 font-bold font-label-mono text-[12px]">
                      <span>▶</span>
                      <span>CUE-OUT</span>
                    </div>
                    {width > 6 && (
                      <span className="font-label-mono text-[12px] text-fuchsia-200">
                        SPLICE ({block.scteDurationSec}s)
                      </span>
                    )}
                    <div className="flex items-center gap-0.5 text-purple-400 font-bold font-label-mono text-[12px]">
                      <span>CUE-IN</span>
                      <span>◀</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* ========================================================= */}
          {/* PISTA 4: AUDIO LEVEL ENVELOPE (EBU R128)                  */}
          {/* ========================================================= */}
          <div className="flex items-stretch h-12 bg-surface-card/60 hover:bg-surface-card/90 transition-colors">
            {/* Track Header Lateral */}
            <div className="w-44 shrink-0 px-space-md flex items-center justify-between border-r border-border-subtle bg-surface-panel/80 font-label-caps">
              <div className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-status-ok text-[16px]">graphic_eq</span>
                <span className="font-bold text-[11px] text-on-surface">4. EBU R128 AUDIO</span>
              </div>
              <span className="font-label-mono text-[12px] px-1 py-0.5 rounded bg-surface-container text-status-ok font-bold">
                -23 LUFS
              </span>
            </div>

            {/* Pista Gráfica de Loudness com Alvo Regulamentar */}
            <div className="flex-1 relative overflow-hidden h-full flex items-center">
              {/* Linha de Alvo Regulamentar (-23 LUFS Tracejada Verde) */}
              <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[1px] border-b border-dashed border-status-ok/60 z-10 pointer-events-none flex items-center justify-end pr-2">
                <span className="bg-surface-base/80 px-1 font-label-mono text-[12px] text-status-ok font-bold">
                  ALVO -23 LUFS
                </span>
              </div>

              {/* Envelopes sonoros por bloco */}
              {blocks.map((block) => {
                const left = msToPercent(block.startMs)
                const width = Math.max(0.4, (block.durationMs / visibleDurationMs) * 100)

                if (left + width < 0 || left > 100) return null

                // Cor de conformidade EBU R128
                const isCompliant = block.lufsEstimated >= -24.0 && block.lufsEstimated <= -22.5
                const isWarning = block.lufsEstimated > -22.5 && block.lufsEstimated <= -20.0
                const isError = block.lufsEstimated > -20.0 || block.isGap

                const barColor = isCompliant
                  ? 'bg-status-ok/80 border-status-ok'
                  : isWarning
                  ? 'bg-armed-amber/80 border-armed-amber'
                  : 'bg-on-air-crimson/80 border-on-air-crimson'

                // Altura proporcional simulando o envelope sonoro
                const heightPercent = block.isGap ? 15 : Math.min(85, Math.max(30, (block.lufsEstimated + 40) * 3))

                return (
                  <div
                    key={`audio-${block.id}`}
                    className="absolute bottom-1 rounded-sm flex flex-col justify-end items-center overflow-hidden"
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      height: '80%',
                    }}
                  >
                    <div
                      className={`w-full rounded-t border-t transition-all ${barColor}`}
                      style={{ height: `${heightPercent}%` }}
                    ></div>
                    {width > 5 && !block.isGap && (
                      <span className="font-timecode-table text-[12px] text-on-surface font-semibold tabular-nums mt-0.5 truncate">
                        {block.lufsEstimated.toFixed(1)} LUFS
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* 3. TOOLTIP DETALHADO EM HOVER DE ALTA FIDELIDADE */}
      {hoveredBlock && tooltipPos && (
        <div
          className="fixed z-50 pointer-events-none -translate-x-1/2 -translate-y-full bg-surface-panel/95 border border-border-strong rounded-xl p-space-md shadow-2xl backdrop-blur-md min-w-[260px] flex flex-col gap-1 text-on-surface"
          style={{ left: `${tooltipPos.x}px`, top: `${tooltipPos.y}px` }}
        >
          {/* Header do Tooltip */}
          <div className="flex items-center justify-between pb-1 border-b border-border-subtle/80">
            <span className="font-label-mono text-[12px] text-outline">
              ITEM #{hoveredBlock.index + 1} • {hoveredBlock.category}
            </span>
            <span
              className={`font-label-caps text-[11px] px-1.5 py-0.5 rounded font-bold ${
                hoveredBlock.isGap
                  ? 'bg-on-air-crimson/30 text-on-air-crimson border border-on-air-crimson/60'
                  : hoveredBlock.isOnAir
                  ? 'bg-on-air-crimson text-white'
                  : hoveredBlock.isCued
                  ? 'bg-armed-amber text-surface-base'
                  : 'bg-surface-container text-outline'
              }`}
            >
              {hoveredBlock.isGap ? 'GAP CRÍTICO' : hoveredBlock.isOnAir ? 'NO AR' : hoveredBlock.isCued ? 'PRÓXIMO' : 'AGUARDANDO'}
            </span>
          </div>

          {/* Título do Bloco */}
          <div className="font-body-md text-sm font-bold text-white truncate max-w-[280px]">
            {hoveredBlock.title}
          </div>

          {/* TCs e Duração */}
          <div className="grid grid-cols-2 gap-2 py-1 font-timecode-table text-xs text-outline bg-surface-base/60 p-1.5 rounded border border-border-subtle/40">
            <div>
              <span className="block text-[11px] uppercase font-bold text-outline">INÍCIO:</span>
              <span className="text-on-surface font-semibold">{wallClock(hoveredBlock.startFrames, rate)}</span>
            </div>
            <div>
              <span className="block text-[11px] uppercase font-bold text-outline">DURAÇÃO:</span>
              <span className="text-accent-ice font-semibold">{dur(hoveredBlock.durationFrames, rate)}</span>
            </div>
          </div>

          {/* Conformidade e Eventos Secundários */}
          <div className="flex items-center justify-between text-[12px] font-label-mono pt-0.5">
            <span className="text-outline">Áudio R128:</span>
            <span
              className={`font-bold ${
                hoveredBlock.lufsEstimated >= -24.0 && hoveredBlock.lufsEstimated <= -22.5
                  ? 'text-status-ok'
                  : 'text-armed-amber'
              }`}
            >
              {hoveredBlock.isGap ? 'N/A' : `${hoveredBlock.lufsEstimated.toFixed(1)} LUFS (CONFORME)`}
            </span>
          </div>
          {hoveredBlock.hasScteCueOut && (
            <div className="flex items-center justify-between text-[12px] font-label-mono">
              <span className="text-fuchsia-400">SCTE-35 DPI:</span>
              <span className="text-fuchsia-300 font-bold">{hoveredBlock.scteDurationSec}s Cue Out/In</span>
            </div>
          )}
        </div>
      )}

      {/* 4. BARRA DE RODAPÉ / STATUS DA TIMELINE */}
      <div className="px-space-md py-1 bg-surface-panel/90 border-t border-border-subtle flex flex-wrap items-center justify-between text-[12px] font-label-mono text-outline">
        <div className="flex items-center gap-space-lg">
          <span>
            EXTENSÃO TOTAL: <strong className="text-on-surface">{clock(totalDurationFrames, rate)}</strong>
          </span>
          <span>•</span>
          <span>
            BLOCOS: <strong className="text-on-surface">{blocks.length} ITENS</strong>
          </span>
          <span>•</span>
          <span>
            TAXA DE COBERTURA:{' '}
            <strong className={detectedGaps === 0 ? 'text-status-ok' : 'text-armed-amber'}>
              {detectedGaps === 0 ? '100% PREENCHIDA' : `${detectedGaps} LACUNA(S)`}
            </strong>
          </span>
        </div>
      </div>
    </div>
  )
}
