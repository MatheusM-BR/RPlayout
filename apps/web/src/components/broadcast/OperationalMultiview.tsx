import { useState } from 'react'
import type { LiveSignalStatus, MultiviewLayout, MultiviewSyncState, MultiviewTally, SrtTelemetry } from '@rplayout/protocol'
import { Whep } from '../Whep.js'

export interface MultiviewSourceItem {
  id: string
  name: string
  role: 'PRIMARY' | 'BACKUP' | 'AUX'
  kind: 'SRT' | 'NDI' | 'SDI' | 'RTMP' | 'OMT'
  targetUrl: string
  format: string
  fps: number
  tally: MultiviewTally
  syncState: MultiviewSyncState
  signalLabel?: string
  signalStatus?: LiveSignalStatus
  signalMessage?: string
  monitorBus?: 'pvw' | 'mon'
  /**
   * O multiview não abre uma segunda conexão da fonte. Quando a fonte já está
   * no PVW, recebe o mesmo WHEP do barramento compartilhado do engine.
   */
  whepPath?: string | null
  whepPort?: number
  /** Só é preenchida quando o processo SRT realmente reportou métricas. */
  srtTelemetry?: SrtTelemetry
}

interface OperationalMultiviewProps {
  sources?: MultiviewSourceItem[]
  initialLayout?: MultiviewLayout
  /** Controlled by the shared editor; local selection alone never writes. */
  selectedLayout?:MultiviewLayout
  onLayoutChange?:(layout:MultiviewLayout)=>void
  layoutDisabled?:boolean
  /** Mantém acordado o único barramento de PVW que está sendo observado. */
  onWatchingPreview?: () => void
  onWatchingBus?: (bus:'pvw'|'mon') => void
}

/**
 * Painel de observação. O Monitor não arma preview e nunca executa TAKE: essas
 * ações pertencem exclusivamente ao Master/Playlist, onde há confirmação do
 * operador e estado do motor.
 */
export function OperationalMultiview({ sources = [], initialLayout = 'GRID_2X2', selectedLayout,onLayoutChange,layoutDisabled=false,onWatchingPreview,onWatchingBus }: OperationalMultiviewProps) {
  const [localLayout, setLayout] = useState<MultiviewLayout>(initialLayout)
  const layout=selectedLayout??localLayout
  return (
    <section className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-border-subtle bg-surface-card shadow-sm">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border-subtle bg-surface-panel px-4 py-2.5">
        <div className="flex items-center gap-2.5"><div className="flex h-7 w-7 items-center justify-center rounded border border-primary/30 bg-primary/10 text-primary"><span className="material-symbols-outlined text-[18px]">visibility</span></div><div><div className="flex items-center gap-2"><h3 className="font-headline-md text-[14px] font-bold tracking-wide text-on-surface">MULTIVIEW DE ENTRADAS</h3><span className="rounded border border-border-subtle px-1.5 py-0.5 font-label-mono text-[10px] text-outline">{sources.length} CONFIGURADA{sources.length === 1 ? '' : 'S'}</span></div><p className="font-label-mono text-[10px] text-outline">Somente visualização e telemetria do processo de ingest.</p></div></div>
        <div className="flex gap-1 rounded-lg border border-border-subtle bg-surface-base p-1">{([['GRID_2X2', 'GRID 2×2', 'grid_4x4'], ['GRID_1_PLUS_3', 'GRID 1+3', 'splitscreen'], ['COMPACT_LIST', 'LISTA TÉCNICA', 'view_list']] as const).map(([value, label, icon]) => <button key={value} disabled={layoutDisabled} onClick={() => {if(onLayoutChange)onLayoutChange(value);else setLayout(value)}} className={`flex items-center gap-1 px-2.5 py-1 rounded font-label-caps text-[10px] ${layout === value ? 'bg-primary-container font-bold text-on-primary-container' : 'text-outline hover:bg-surface-panel hover:text-on-surface'}`}><span className="material-symbols-outlined text-[15px]">{icon}</span>{label}</button>)}</div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-3.5">{sources.length === 0 ? <EmptyState /> : layout === 'COMPACT_LIST' ? <TechnicalList sources={sources} /> : <div className={layout === 'GRID_1_PLUS_3' ? 'grid grid-cols-1 gap-3.5 lg:grid-cols-12' : 'grid grid-cols-1 gap-3.5 md:grid-cols-2'}>{sources.map((source, index) => <SourceCard key={source.id} source={source} hero={layout === 'GRID_1_PLUS_3' && index === 0} onWatchingPreview={()=>{if(onWatchingBus)onWatchingBus(source.monitorBus ?? 'pvw');else if(source.monitorBus!=='mon')onWatchingPreview?.()}} />)}</div>}</div>
    </section>
  )
}

function EmptyState() { return <div className="flex h-full min-h-48 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border-subtle bg-surface-base p-5 text-center"><span className="material-symbols-outlined text-[32px] text-armed-amber">settings_input_antenna</span><strong className="font-label-caps text-[11px] text-on-surface">Nenhuma entrada configurada</strong><span className="max-w-md font-label-mono text-[10px] text-outline">Cadastre uma entrada no menu Configurações. O Monitor não cria fontes e não presume sinal de rede.</span></div> }

function SourceCard({ source, hero, onWatchingPreview }: { source: MultiviewSourceItem; hero: boolean; onWatchingPreview?: () => void }) {
  const hasSharedFrame = Boolean(source.whepPath && source.whepPort)
  const busLabel=source.monitorBus==='mon'?'PGM':'PVW'
  return <article className={`${hero ? 'lg:col-span-8' : 'lg:col-span-4'} overflow-hidden rounded-xl border-2 bg-surface-panel ${syncBorder(source.syncState)}`}>
    <div className="flex items-center justify-between gap-2 border-b border-border-subtle px-2.5 py-1.5">
      <div className="min-w-0"><div className="flex items-center gap-2"><span className="rounded bg-surface-base px-1.5 py-0.5 font-label-mono text-[10px] font-bold text-accent-ice">{source.kind}</span><strong className="truncate font-headline-md text-[13px] text-on-surface">{source.name}</strong></div>
        <span className="font-label-mono text-[10px] text-outline">{source.role} · {source.tally==='ON_AIR'?'NO PGM':source.tally==='CUED'?'CUE / PVW':'FORA DOS BARRAMENTOS'}</span>
      </div>
      <span title={source.signalMessage} className={`shrink-0 rounded border px-1.5 py-0.5 font-label-mono text-[10px] font-bold ${syncClass(source.syncState)}`}>{source.signalLabel ?? syncLabel(source.syncState)}</span>
    </div>
    <div className="relative aspect-video bg-[#080c14]">{hasSharedFrame ? <>
      <Whep path={source.whepPath ?? null} port={source.whepPort ?? 8889} hideControls muted onWatching={onWatchingPreview} />
      <span className="absolute left-2 top-2 rounded bg-black/70 px-2 py-1 font-label-mono text-[10px] text-on-surface pointer-events-none">{busLabel} COMPARTILHADO</span>
    </> : <div className="flex h-full flex-col items-center justify-center gap-2 p-3 text-center">
      <span className="material-symbols-outlined text-[32px] text-accent-ice">sensors</span>
      <strong className="font-label-caps text-[10px] text-on-surface">{source.signalLabel ?? (source.srtTelemetry?'TELEMETRIA DE TRANSPORTE RECEBIDA':'SEM FRAME PUBLICÁVEL')}</strong>
      <span className="max-w-[90%] font-label-mono text-[10px] text-outline">{source.signalMessage ?? frameMessage(source)}</span>
      {source.srtTelemetry && <span className="rounded border border-border-subtle bg-black/60 px-2 py-1 font-label-mono text-[10px] text-accent-ice">RTT {source.srtTelemetry.rttMs.toFixed(1)} ms · perda {source.srtTelemetry.packetLossPercent.toFixed(2)}% · {(source.srtTelemetry.bitrateKbps / 1000).toFixed(2)} Mbps</span>}
    </div>}</div>
    {hasSharedFrame && (source.signalStatus==='UNSTABLE'||source.signalStatus==='NO_AUDIO') && <p role="status" className="border-t border-armed-amber/30 bg-armed-amber/10 px-2.5 py-1.5 font-label-mono text-[10px] text-armed-amber">{source.signalMessage}</p>}
    <footer className="flex items-center justify-between gap-2 border-t border-border-subtle px-2.5 py-1.5 font-label-mono text-[10px] text-outline"><span className="truncate" title={source.targetUrl}>{source.targetUrl}</span><span className="shrink-0">{source.format}{source.fps>0?` · ${source.fps.toFixed(2)} FPS`:''}</span></footer>
  </article>
}

function TechnicalList({ sources }: { sources: MultiviewSourceItem[] }) { return <div className="space-y-2"><div className="grid grid-cols-12 gap-2 border-b border-border-subtle px-3 py-1.5 font-label-caps text-[10px] text-outline"><span className="col-span-3">Fonte</span><span className="col-span-4">Endpoint</span><span className="col-span-2">Estado</span><span className="col-span-3">Telemetria</span></div>{sources.map((source) => <div key={source.id} className="grid grid-cols-12 items-center gap-2 rounded-lg border border-border-subtle bg-surface-card px-3 py-2 font-label-mono text-[10px]"><span className="col-span-3 truncate font-bold text-on-surface">{source.name} <em className="not-italic text-accent-ice">{source.kind}</em></span><span className="col-span-4 truncate text-outline" title={source.targetUrl}>{source.targetUrl}</span><span className={`col-span-2 ${syncText(source.syncState)}`}>{source.signalLabel ?? syncLabel(source.syncState)}</span><span className="col-span-3 text-outline" title={source.signalMessage}>{source.fps>0?`${source.format} · ${source.fps.toFixed(2)} FPS`:source.srtTelemetry ? `${source.srtTelemetry.bitrateKbps} kbps · ${source.srtTelemetry.packetLossPercent.toFixed(2)}% perda` : source.signalMessage ?? telemetryMessage(source.kind)}</span></div>)}</div> }

function frameMessage(source: MultiviewSourceItem) { if (source.srtTelemetry) return 'A sonda recebeu métricas de transporte. Para imagem no navegador, a entrada precisa publicar um endpoint WebRTC/WHEP.'; return source.kind === 'SRT' ? 'Aguardando conexão/telemetria SRT.' : `A entrada ${source.kind} está cadastrada, mas ainda não há sonda ou endpoint WebRTC/WHEP publicável.` }
function telemetryMessage(kind: MultiviewSourceItem['kind']) { return kind === 'SRT' ? 'aguardando SRT' : `${kind}: sonda não disponível` }
function syncLabel(state: MultiviewSyncState) { return state === 'LOCKED' ? 'LOCKED' : state === 'DRIFT' ? 'DEGRADADO' : 'SEM SINAL' }
function syncBorder(state: MultiviewSyncState) { return state === 'LOCKED' ? 'border-status-ok/60' : state === 'DRIFT' ? 'border-armed-amber/60' : 'border-border-subtle' }
function syncText(state: MultiviewSyncState) { return state === 'LOCKED' ? 'text-status-ok' : state === 'DRIFT' ? 'text-armed-amber' : 'text-on-air-crimson' }
function syncClass(state: MultiviewSyncState) { return state === 'LOCKED' ? 'border-status-ok/30 bg-status-ok/15 text-status-ok' : state === 'DRIFT' ? 'border-armed-amber/30 bg-armed-amber/15 text-armed-amber' : 'border-on-air-crimson/30 bg-on-air-crimson/15 text-on-air-crimson' }
