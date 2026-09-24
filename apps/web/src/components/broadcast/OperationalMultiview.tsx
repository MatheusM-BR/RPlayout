import React, { useState, useEffect } from 'react'
import type { MultiviewLayout, MultiviewTally, MultiviewSyncState, SrtTelemetry } from '@rplayout/protocol'

export interface MultiviewSourceItem {
  id: string
  name: string
  role: 'PRIMARY' | 'BACKUP' | 'AUX'
  kind: 'SRT' | 'NDI' | 'SDI' | 'RTMP'
  targetUrl: string
  format: string
  fps: number
  tally: MultiviewTally
  syncState: MultiviewSyncState
  audioLevels: {
    leftDb: number
    rightDb: number
    peakLeftDb: number
    peakRightDb: number
  }
  srtTelemetry?: SrtTelemetry
  thumbnailPattern?: 'bars' | 'grid' | 'live'
}

interface OperationalMultiviewProps {
  sources?: MultiviewSourceItem[]
  onSelectPreview?: (sourceId: string) => void
  onTakeDirect?: (sourceId: string) => void
  onConfigureSource?: (sourceId: string) => void
  initialLayout?: MultiviewLayout
}

const DEFAULT_SOURCES: MultiviewSourceItem[] = [
  {
    id: 'src-ndi-studio1',
    name: 'ESTÚDIO MASTER 01',
    role: 'PRIMARY',
    kind: 'NDI',
    targetUrl: 'ndi://PRODUCTION-PC/STUDIO1-PGM',
    format: '1080i59.94',
    fps: 59.94,
    tally: 'ON_AIR',
    syncState: 'LOCKED',
    audioLevels: {
      leftDb: -18.2,
      rightDb: -18.5,
      peakLeftDb: -12.1,
      peakRightDb: -12.4,
    },
    thumbnailPattern: 'live',
  },
  {
    id: 'src-srt-mochila1',
    name: 'LINK EXTERNA MOCHILA 01',
    role: 'PRIMARY',
    kind: 'SRT',
    targetUrl: 'srt://187.32.40.11:9000?mode=caller&latency=800',
    format: '1080p59.94',
    fps: 59.94,
    tally: 'NEXT',
    syncState: 'LOCKED',
    audioLevels: {
      leftDb: -22.4,
      rightDb: -22.1,
      peakLeftDb: -15.8,
      peakRightDb: -15.6,
    },
    srtTelemetry: {
      rttMs: 42.1,
      packetLossPercent: 0.12,
      bitrateKbps: 5420,
      packetsDropped: 0,
      packetsRetransmitted: 14,
      linkState: 'OPTIMAL',
      reconnectCount: 0,
      bufferMs: 792,
    },
    thumbnailPattern: 'grid',
  },
  {
    id: 'src-srt-satellite',
    name: 'FEED SATÉLITE / REDE',
    role: 'PRIMARY',
    kind: 'SRT',
    targetUrl: 'srt://0.0.0.0:9100?mode=listener&latency=1200',
    format: '1080i59.94',
    fps: 59.94,
    tally: 'CUED',
    syncState: 'LOCKED',
    audioLevels: {
      leftDb: -20.0,
      rightDb: -19.8,
      peakLeftDb: -14.0,
      peakRightDb: -13.9,
    },
    srtTelemetry: {
      rttMs: 18.4,
      packetLossPercent: 0.0,
      bitrateKbps: 8250,
      packetsDropped: 0,
      packetsRetransmitted: 2,
      linkState: 'OPTIMAL',
      reconnectCount: 0,
      bufferMs: 1195,
    },
    thumbnailPattern: 'bars',
  },
  {
    id: 'src-srt-cloud-backup',
    name: 'CONTINGÊNCIA CLOUD (BACKUP)',
    role: 'BACKUP',
    kind: 'SRT',
    targetUrl: 'srt://backup.rplayout.cloud:9200?mode=caller&latency=1500',
    format: '1080p29.97',
    fps: 29.97,
    tally: 'OFFLINE',
    syncState: 'DRIFT',
    audioLevels: {
      leftDb: -60.0,
      rightDb: -60.0,
      peakLeftDb: -60.0,
      peakRightDb: -60.0,
    },
    srtTelemetry: {
      rttMs: 145.0,
      packetLossPercent: 4.8,
      bitrateKbps: 3100,
      packetsDropped: 18,
      packetsRetransmitted: 86,
      linkState: 'DEGRADED',
      reconnectCount: 2,
      bufferMs: 1420,
    },
    thumbnailPattern: 'bars',
  },
]

export const OperationalMultiview: React.FC<OperationalMultiviewProps> = ({
  sources = DEFAULT_SOURCES,
  onSelectPreview,
  onTakeDirect,
  onConfigureSource,
  initialLayout = 'GRID_2X2',
}) => {
  const [layout, setLayout] = useState<MultiviewLayout>(initialLayout)
  const [selectedFeedId, setSelectedFeedId] = useState<string>(sources[0]?.id ?? '')
  const [audioFluctuation, setAudioFluctuation] = useState<number>(0)

  // Leve animação orgânica de VU para simular áudio ao vivo
  useEffect(() => {
    const timer = setInterval(() => {
      setAudioFluctuation(Math.sin(Date.now() / 300) * 2.5)
    }, 150)
    return () => clearInterval(timer)
  }, [])

  const selectedSource = sources.find((s) => s.id === selectedFeedId) ?? sources[0]

  return (
    <div className="flex flex-col h-full w-full bg-surface-card rounded-xl border border-border-subtle overflow-hidden shadow-sm">
      {/* 1. BARRA SUPERIOR DO MULTIVIEW (CONTROLE TÁTICO & LAYOUTS) */}
      <div className="px-4 py-2.5 bg-surface-panel border-b border-border-subtle flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded bg-primary/10 border border-primary/30 flex items-center justify-center text-primary">
            <span className="material-symbols-outlined text-[18px]">grid_view</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-headline-md text-[14px] text-on-surface uppercase font-bold tracking-wide">
                MULTIVIEW OPERACIONAL DE ENTRADAS
              </h3>
              <span className="px-1.5 py-0.5 rounded text-[9px] font-label-mono font-bold bg-status-ok/15 text-status-ok-bright border border-status-ok/30 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-status-ok animate-pulse"></span>
                4 FEEDS ATIVOS
              </span>
            </div>
            <p className="font-label-mono text-[10px] text-outline">
              Monitoração MCR com Tally Dinâmico, Medidores VU EBU e Lock de Sincronismo
            </p>
          </div>
        </div>

        {/* Seletor de Layout: 2x2, 1+3 e Lista Técnica Compacta */}
        <div className="flex items-center bg-surface-base p-1 rounded-lg border border-border-subtle gap-1">
          <button
            onClick={() => setLayout('GRID_2X2')}
            title="Grid 2x2: Quatro telas balanceadas"
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[10.5px] font-label-caps transition-all cursor-pointer ${
              layout === 'GRID_2X2'
                ? 'bg-primary-container text-on-primary-container font-bold shadow-xs'
                : 'text-outline hover:text-on-surface hover:bg-surface-panel'
            }`}
          >
            <span className="material-symbols-outlined text-[15px]">grid_4x4</span>
            <span>GRID 2x2</span>
          </button>

          <button
            onClick={() => setLayout('GRID_1_PLUS_3')}
            title="Grid 1+3: 1 Feed Principal com 3 miniaturas laterais"
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[10.5px] font-label-caps transition-all cursor-pointer ${
              layout === 'GRID_1_PLUS_3'
                ? 'bg-primary-container text-on-primary-container font-bold shadow-xs'
                : 'text-outline hover:text-on-surface hover:bg-surface-panel'
            }`}
          >
            <span className="material-symbols-outlined text-[15px]">splitscreen</span>
            <span>GRID 1+3</span>
          </button>

          <button
            onClick={() => setLayout('COMPACT_LIST')}
            title="Lista Técnica Compacta: Linhas detalhadas com telemetria direta"
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[10.5px] font-label-caps transition-all cursor-pointer ${
              layout === 'COMPACT_LIST'
                ? 'bg-primary-container text-on-primary-container font-bold shadow-xs'
                : 'text-outline hover:text-on-surface hover:bg-surface-panel'
            }`}
          >
            <span className="material-symbols-outlined text-[15px]">view_list</span>
            <span>LISTA TÉCNICA</span>
          </button>
        </div>
      </div>

      {/* 2. ÁREA DE EXIBIÇÃO DE VÍDEO CONFORME O LAYOUT SELECIONADO */}
      <div className="p-3.5 flex-1 min-h-0 overflow-y-auto broadcast-scroll">
        {/* LAYOUT A: GRID 2X2 */}
        {layout === 'GRID_2X2' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 h-full">
            {sources.map((source) => (
              <MultiviewCellCard
                key={source.id}
                source={source}
                isSelected={source.id === selectedFeedId}
                onSelect={() => setSelectedFeedId(source.id)}
                onPreview={() => onSelectPreview?.(source.id)}
                onTake={() => onTakeDirect?.(source.id)}
                onConfigure={() => onConfigureSource?.(source.id)}
                audioFluctuation={audioFluctuation}
              />
            ))}
          </div>
        )}

        {/* LAYOUT B: GRID 1+3 */}
        {layout === 'GRID_1_PLUS_3' && selectedSource && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 h-full items-stretch">
            {/* Célula Principal 1 (Maior) */}
            <div className="lg:col-span-8 flex flex-col min-h-0">
              <MultiviewCellCard
                source={selectedSource}
                isSelected={true}
                isHero={true}
                onSelect={() => {}}
                onPreview={() => onSelectPreview?.(selectedSource.id)}
                onTake={() => onTakeDirect?.(selectedSource.id)}
                onConfigure={() => onConfigureSource?.(selectedSource.id)}
                audioFluctuation={audioFluctuation}
              />
            </div>

            {/* As 3 Células Secundárias Laterais */}
            <div className="lg:col-span-4 flex flex-col gap-2.5 overflow-y-auto broadcast-scroll">
              {sources
                .filter((s) => s.id !== selectedSource.id)
                .map((source) => (
                  <div key={source.id} className="min-h-0">
                    <MultiviewCellCard
                      source={source}
                      isSelected={false}
                      isCompact={true}
                      onSelect={() => setSelectedFeedId(source.id)}
                      onPreview={() => onSelectPreview?.(source.id)}
                      onTake={() => onTakeDirect?.(source.id)}
                      onConfigure={() => onConfigureSource?.(source.id)}
                      audioFluctuation={audioFluctuation}
                    />
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* LAYOUT C: LISTA TÉCNICA COMPACTA */}
        {layout === 'COMPACT_LIST' && (
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-12 gap-2 px-3 py-1.5 text-[10px] font-label-caps text-outline uppercase border-b border-border-subtle bg-surface-panel/40 rounded-t">
              <span className="col-span-1">TALLY</span>
              <span className="col-span-3">FONTE / ENDPOINT</span>
              <span className="col-span-2">FORMATO / FPS</span>
              <span className="col-span-2">SINCRONISMO</span>
              <span className="col-span-2">TELEMETRIA SRT</span>
              <span className="col-span-2 text-right">AÇÕES RÁPIDAS</span>
            </div>

            {sources.map((source) => (
              <CompactSourceRow
                key={source.id}
                source={source}
                isSelected={source.id === selectedFeedId}
                onSelect={() => setSelectedFeedId(source.id)}
                onPreview={() => onSelectPreview?.(source.id)}
                onTake={() => onTakeDirect?.(source.id)}
                audioFluctuation={audioFluctuation}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* =========================================================================
   SUB-COMPONENTE: CARD DA CÉLULA MULTIVIEW (16:9 COM TALLY E VU DUPLO)
   ========================================================================= */
interface MultiviewCellCardProps {
  source: MultiviewSourceItem
  isSelected: boolean
  isHero?: boolean
  isCompact?: boolean
  onSelect: () => void
  onPreview: () => void
  onTake: () => void
  onConfigure: () => void
  audioFluctuation: number
}

function MultiviewCellCard({
  source,
  isSelected,
  isHero = false,
  isCompact = false,
  onSelect,
  onPreview,
  onTake,
  onConfigure,
  audioFluctuation,
}: MultiviewCellCardProps) {
  // Configuração visual de Tally Broadcast
  const tallyConfig = getTallyBorderAndBadge(source.tally)

  return (
    <div
      onClick={onSelect}
      className={`relative group rounded-xl border-2 transition-all flex flex-col bg-surface-panel overflow-hidden cursor-pointer ${
        tallyConfig.borderClass
      } ${isSelected ? 'ring-2 ring-primary/40' : ''}`}
    >
      {/* CABEÇALHO DO MONITOR COM TALLY E SINCRONISMO */}
      <div className={`px-2.5 py-1.5 flex items-center justify-between gap-2 border-b border-border-subtle/70 ${tallyConfig.headerBg}`}>
        <div className="flex items-center gap-2 min-w-0">
          {/* Badge de Tally Broadcast */}
          <span className={`px-2 py-0.5 rounded text-[9.5px] font-label-caps font-bold tracking-wider flex items-center gap-1.5 ${tallyConfig.badgeClass}`}>
            <span className={`w-2 h-2 rounded-full ${tallyConfig.dotClass}`}></span>
            {tallyConfig.label}
          </span>

          <span className="font-headline-md text-[13px] text-on-surface font-bold truncate">
            {source.name}
          </span>

          {source.role === 'BACKUP' && (
            <span className="px-1.5 py-0.2 rounded text-[8.5px] font-label-caps font-bold bg-amber-500/20 text-amber-400 border border-amber-500/40">
              BACKUP
            </span>
          )}
        </div>

        {/* Status de Sincronismo e Badge SRT */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className={`px-1.5 py-0.5 rounded text-[9px] font-label-mono font-bold flex items-center gap-1 ${
              source.syncState === 'LOCKED'
                ? 'bg-status-ok/15 text-status-ok border border-status-ok/30'
                : source.syncState === 'DRIFT'
                ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                : 'bg-red-500/15 text-red-400 border border-red-500/30'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                source.syncState === 'LOCKED'
                  ? 'bg-status-ok animate-pulse'
                  : source.syncState === 'DRIFT'
                  ? 'bg-amber-400'
                  : 'bg-red-400'
              }`}
            ></span>
            {source.syncState === 'LOCKED' ? 'SYNC LOCKED' : source.syncState === 'DRIFT' ? 'DRIFT' : 'NO SIGNAL'}
          </span>
        </div>
      </div>

      {/* RASTER DE VÍDEO (ASPECT RATIO 16:9 RÍGIDO) */}
      <div className="relative w-full aspect-video bg-[#04060b] flex items-center justify-center overflow-hidden select-none">
        {/* Fundo de Simulação de Vídeo Broadcast */}
        {source.tally === 'OFFLINE' ? (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-[#080c14] text-outline">
            <span className="material-symbols-outlined text-[36px] text-outline/40">satellite_alt</span>
            <span className="font-label-mono text-[11px] text-outline uppercase tracking-wider">
              SINAL FORA DO AR / DESCONECTADO
            </span>
            <span className="font-label-mono text-[9px] text-outline/60">
              Aguardando handshake de socket SRT
            </span>
          </div>
        ) : (
          <div className="w-full h-full relative flex items-center justify-center">
            {/* Grade técnica de enquadramento broadcast */}
            <div className="absolute inset-0 opacity-15 pointer-events-none bg-[radial-gradient(#5570AB_1px,transparent_1px)] [background-size:16px_16px]"></div>
            
            {/* Safe Area e Crosshair Central */}
            <div className="absolute inset-8 border border-white/5 rounded-xs pointer-events-none"></div>
            <div className="w-4 h-4 border-t border-b border-l border-r border-white/20 pointer-events-none"></div>

            {/* Simulação gráfica sutil de barras ou estúdio */}
            <div className="absolute inset-x-0 bottom-0 h-10 bg-linear-to-t from-black/80 to-transparent"></div>

            {/* Indicador de Resolução & Framerate em overlay */}
            <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/70 backdrop-blur-xs border border-white/10 font-label-mono text-[9.5px] text-on-surface-variant tabular-nums">
              {source.format} • {source.fps} FPS
            </div>

            {/* Overlay com Telemetria SRT rápida quando aplicável */}
            {source.srtTelemetry && (
              <div className="absolute top-2 right-2 px-2 py-0.5 rounded bg-black/75 backdrop-blur-xs border border-white/10 font-label-mono text-[9.5px] text-accent-ice-bright tabular-nums flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-accent-ice animate-pulse"></span>
                <span>RTT: {source.srtTelemetry.rttMs.toFixed(1)}ms</span>
                <span className="text-outline">|</span>
                <span>LOSS: {source.srtTelemetry.packetLossPercent.toFixed(1)}%</span>
                <span className="text-outline">|</span>
                <span>{(source.srtTelemetry.bitrateKbps / 1000).toFixed(1)}M</span>
              </div>
            )}

            {/* Mini VU Meter Estéreo L/R Flutuante à direita do Raster */}
            <div className="absolute right-2 bottom-2 bg-black/80 backdrop-blur-xs p-1 rounded border border-white/15 flex items-center gap-1 z-10 shadow-sm">
              <span className="font-label-mono text-[8px] text-outline uppercase font-bold">L</span>
              <MiniAudioBar levelDb={source.audioLevels.leftDb + audioFluctuation} peakDb={source.audioLevels.peakLeftDb} />
              <span className="font-label-mono text-[8px] text-outline uppercase font-bold ml-0.5">R</span>
              <MiniAudioBar levelDb={source.audioLevels.rightDb + audioFluctuation} peakDb={source.audioLevels.peakRightDb} />
            </div>

            {/* Botões Táticos de Intervenção Rápida (Hover) */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onPreview()
                }}
                className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-label-caps text-[10.5px] font-bold shadow-lg transition-transform hover:scale-105 flex items-center gap-1 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[15px]">preview</span>
                ENVIAR PVW
              </button>

              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onTake()
                }}
                className="px-3 py-1.5 rounded bg-on-air-crimson hover:bg-red-500 text-white font-label-caps text-[10.5px] font-bold shadow-lg transition-transform hover:scale-105 flex items-center gap-1 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[15px]">play_arrow</span>
                TAKE NO AR
              </button>

              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onConfigure()
                }}
                className="p-1.5 rounded bg-surface-container hover:bg-surface-bright text-on-surface border border-border-subtle shadow-md transition-colors cursor-pointer"
                title="Configurar Parâmetros de Ingest"
              >
                <span className="material-symbols-outlined text-[16px]">tune</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* RODAPÉ DO CARD COM ENDPOINT E TIPO */}
      <div className="px-2.5 py-1.5 bg-surface-panel/90 border-t border-border-subtle/50 flex items-center justify-between text-[10.5px] font-label-mono text-outline">
        <span className="truncate max-w-[220px]" title={source.targetUrl}>
          {source.targetUrl}
        </span>
        <span className="px-1.5 py-0.2 rounded bg-surface-base text-accent-ice font-bold border border-border-subtle">
          {source.kind}
        </span>
      </div>
    </div>
  )
}

/* =========================================================================
   SUB-COMPONENTE: LINHA NA LISTA TÉCNICA COMPACTA
   ========================================================================= */
interface CompactSourceRowProps {
  source: MultiviewSourceItem
  isSelected: boolean
  onSelect: () => void
  onPreview: () => void
  onTake: () => void
  audioFluctuation: number
}

function CompactSourceRow({
  source,
  isSelected,
  onSelect,
  onPreview,
  onTake,
  audioFluctuation,
}: CompactSourceRowProps) {
  const tally = getTallyBorderAndBadge(source.tally)

  return (
    <div
      onClick={onSelect}
      className={`grid grid-cols-12 gap-2 items-center px-3 py-2 rounded-lg border transition-all cursor-pointer ${
        isSelected
          ? 'bg-surface-panel border-primary/50 shadow-xs'
          : 'bg-surface-card hover:bg-surface-panel/70 border-border-subtle'
      }`}
    >
      {/* Tally */}
      <div className="col-span-1 flex items-center">
        <span className={`px-2 py-0.5 rounded text-[9px] font-label-caps font-bold tracking-wider flex items-center gap-1 ${tally.badgeClass}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${tally.dotClass}`}></span>
          {tally.label}
        </span>
      </div>

      {/* Fonte / Endpoint */}
      <div className="col-span-3 flex flex-col min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-headline-md text-[13px] text-on-surface font-bold truncate">
            {source.name}
          </span>
          <span className="px-1 py-0.2 rounded text-[8px] font-label-mono bg-surface-base border border-border-subtle text-accent-ice font-bold">
            {source.kind}
          </span>
        </div>
        <span className="font-label-mono text-[9.5px] text-outline truncate" title={source.targetUrl}>
          {source.targetUrl}
        </span>
      </div>

      {/* Formato / FPS */}
      <div className="col-span-2 font-label-mono text-[11px] tabular-nums text-on-surface-variant">
        <span>{source.format}</span>
        <span className="text-outline text-[9.5px] block">{source.fps} FPS</span>
      </div>

      {/* Sincronismo */}
      <div className="col-span-2">
        <span
          className={`px-1.5 py-0.5 rounded text-[9.5px] font-label-mono font-bold inline-flex items-center gap-1 ${
            source.syncState === 'LOCKED'
              ? 'bg-status-ok/15 text-status-ok border border-status-ok/30'
              : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${source.syncState === 'LOCKED' ? 'bg-status-ok animate-pulse' : 'bg-amber-400'}`}></span>
          {source.syncState === 'LOCKED' ? 'SYNC LOCKED' : 'DRIFT'}
        </span>
      </div>

      {/* Telemetria SRT & Áudio */}
      <div className="col-span-2 flex items-center gap-2 font-label-mono text-[10px] tabular-nums">
        {source.srtTelemetry ? (
          <div className="flex flex-col">
            <span className="text-accent-ice font-bold">RTT: {source.srtTelemetry.rttMs.toFixed(0)}ms</span>
            <span className="text-outline text-[9px]">Perda: {source.srtTelemetry.packetLossPercent.toFixed(1)}%</span>
          </div>
        ) : (
          <span className="text-outline text-[10px]">—</span>
        )}

        <div className="flex items-center gap-0.5 ml-auto">
          <MiniAudioBar levelDb={source.audioLevels.leftDb + audioFluctuation} peakDb={source.audioLevels.peakLeftDb} />
          <MiniAudioBar levelDb={source.audioLevels.rightDb + audioFluctuation} peakDb={source.audioLevels.peakRightDb} />
        </div>
      </div>

      {/* Ações Rápidas */}
      <div className="col-span-2 flex items-center justify-end gap-1.5">
        <button
          onClick={(e) => {
            e.stopPropagation()
            onPreview()
          }}
          className="px-2 py-1 rounded bg-emerald-600/20 hover:bg-emerald-600 text-emerald-400 hover:text-white border border-emerald-500/40 text-[10px] font-label-caps font-bold transition-all cursor-pointer"
        >
          PVW
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onTake()
          }}
          className="px-2 py-1 rounded bg-on-air-crimson/20 hover:bg-on-air-crimson text-red-400 hover:text-white border border-red-500/40 text-[10px] font-label-caps font-bold transition-all cursor-pointer"
        >
          TAKE
        </button>
      </div>
    </div>
  )
}

/* =========================================================================
   SUB-COMPONENTE: MINI BARRA DE VU ESTÉREO (-60 a 0 dBFS)
   ========================================================================= */
function MiniAudioBar({ levelDb, peakDb }: { levelDb: number; peakDb: number }) {
  // Converte dBFS (-60 a 0) em percentual (0 a 100)
  const clampedDb = Math.max(-60, Math.min(0, levelDb))
  const percent = ((clampedDb + 60) / 60) * 100

  const clampedPeak = Math.max(-60, Math.min(0, peakDb))
  const peakPercent = ((clampedPeak + 60) / 60) * 100

  // Cores dinâmicas segundo padrão EBU R128:
  // -60 a -18: Verde (#34C759)
  // -18 a -6: Amarelo (#FF9500)
  // -6 a 0: Vermelho (#FF3B30)
  let barColor = 'bg-status-ok'
  if (clampedDb > -6) {
    barColor = 'bg-on-air-crimson'
  } else if (clampedDb > -18) {
    barColor = 'bg-armed-amber'
  }

  return (
    <div className="relative w-1.5 h-6 bg-surface-base rounded-xs overflow-hidden border border-white/10 flex flex-col justify-end">
      {/* Barra de Áudio */}
      <div
        className={`w-full transition-all duration-100 ${barColor}`}
        style={{ height: `${percent}%` }}
      ></div>

      {/* Floating Peak Hold Line */}
      {peakPercent > 0 && (
        <div
          className="absolute left-0 right-0 h-0.5 bg-white shadow-xs pointer-events-none"
          style={{ bottom: `${peakPercent}%` }}
        ></div>
      )}
    </div>
  )
}

/* =========================================================================
   HELPER DE CORES E ESTILOS DE TALLY BROADCAST
   ========================================================================= */
function getTallyBorderAndBadge(tally: MultiviewTally) {
  switch (tally) {
    case 'ON_AIR':
      return {
        borderClass: 'border-on-air-crimson shadow-tally-onair',
        headerBg: 'bg-on-air-crimson/15',
        badgeClass: 'bg-on-air-crimson text-white',
        dotClass: 'bg-white animate-ping',
        label: 'NO AR (PGM)',
      }
    case 'NEXT':
      return {
        borderClass: 'border-emerald-500 shadow-tally-lock',
        headerBg: 'bg-emerald-500/15',
        badgeClass: 'bg-emerald-600 text-white',
        dotClass: 'bg-white',
        label: 'PRÓXIMO (PVW)',
      }
    case 'CUED':
      return {
        borderClass: 'border-amber-500 shadow-tally-pvw',
        headerBg: 'bg-amber-500/15',
        badgeClass: 'bg-amber-500 text-surface-base',
        dotClass: 'bg-surface-base',
        label: 'CUED (STANDBY)',
      }
    case 'OFFLINE':
    default:
      return {
        borderClass: 'border-border-subtle/80 opacity-70',
        headerBg: 'bg-surface-panel',
        badgeClass: 'bg-surface-base text-outline border border-border-subtle',
        dotClass: 'bg-outline',
        label: 'OFFLINE',
      }
  }
}
