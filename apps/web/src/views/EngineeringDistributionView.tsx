import { deniedReason, useCan } from '../domain/permissions.js'
import { useState, useEffect } from 'react'
import type { Channel, ManagedLiveSource, RedundantStreamPair, SrtTelemetry } from '@rplayout/protocol'
import type { Live, Monitors } from '../types.js'
import { api } from '../api.js'
import type { WorkspaceId } from '../components/WorkspaceShell.js'
import { BroadcastHeader } from '../components/broadcast/BroadcastHeader.js'
import { OperationalMultiview } from '../components/broadcast/OperationalMultiview.js'
import {SharedMultiview} from '../components/broadcast/SharedMultiview.js'
import type { MultiviewSourceItem } from '../components/broadcast/OperationalMultiview.js'
import { SrtManagerPanel, type SrtLinkItem } from '../components/broadcast/SrtManagerPanel.js'
import { RedundancyFailoverPanel } from '../components/broadcast/RedundancyFailoverPanel.js'
import {HaReplicationPanel} from '../components/broadcast/HaReplicationPanel.js'
import { OutputsSummary } from '../components/broadcast/OutputsSummary.js'
import { PgmProbeBanner } from '../components/broadcast/PgmProbeBanner.js'
import { StudioAutomationPanel } from '../components/broadcast/StudioAutomationPanel.js'
import { HostResourcesPanel } from '../components/broadcast/HostResourcesPanel.js'
import {liveSourceMonitor} from '../domain/live-source-monitor.js'

interface Props {
  channel: Channel
  channels?: Channel[]
  onNavigate: (workspace: WorkspaceId) => void
  onSelectChannel?: (channelId: string) => void
  onMessage: (msg: string) => void
  sessionRole?: string
  authRequired?: boolean
  onOpenSettings?: () => void
  onOpenHealth?: () => void
  live?: Live | null
  monitors?: Monitors | null
}

type EngineeringSection = 'DASHBOARD' | 'MULTIVIEW' | 'SRT' | 'REDUNDANCY' | 'OUTPUTS' | 'AUTOMATION' | 'HOST' | 'LOGS'
type HostMetrics = Awaited<ReturnType<typeof api.hostMetrics>>
type ProcessSnapshot = Awaited<ReturnType<typeof api.processes>>['processes']
type OutputSnapshot = Awaited<ReturnType<typeof api.outputs>>['outputs']

const percent = (value: number | null) => value === null ? 'N/D' : `${value.toFixed(value % 1 ? 1 : 0)}%`
const gib = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`

export function EngineeringDistributionView({
  channel,
  channels = [channel],
  onNavigate,
  onSelectChannel = () => {},
  onMessage,
  sessionRole = 'Operador Master',
  authRequired = false,
  onOpenSettings,
  onOpenHealth,
  live = null,
  monitors = null,
}: Props) {
  // Seção ativa da visualização de engenharia
  const [activeSection, setActiveSection] = useState<EngineeringSection>('DASHBOARD')
  const [liveSources, setLiveSources] = useState<ManagedLiveSource[]>([])
  const [srtTelemetry, setSrtTelemetry] = useState<Record<string, SrtTelemetry>>({})
  const [monitorLoadError, setMonitorLoadError] = useState<string | null>(null)
  // Até a 1ª leitura, não afirmar "nenhuma entrada" / "engine não iniciado".
  const [monitorLoaded, setMonitorLoaded] = useState(false)
  const [hostMetrics, setHostMetrics] = useState<HostMetrics | null>(null)
  const [processes, setProcesses] = useState<ProcessSnapshot>([])
  const [outputs, setOutputs] = useState<OutputSnapshot>([])
  // Mantido somente durante a remoção gradual do painel legado, que não é renderizado.
  const [legacySinks, setLegacySinks] = useState({ sdi: false, ndi: false, srt: false, whep: false })
  const [engineeringAction, setEngineeringAction] = useState<'restart' | 'cache' | null>(null)

  useEffect(() => {
    let active = true
    const refresh = async () => {
      try {
        const [sources, telemetry, metrics, processSnapshot, outputSnapshot] = await Promise.all([api.liveSources(channel.id), api.srtTelemetry(), api.hostMetrics(), api.processes(), api.outputs(channel.id)])
        if (!active) return
        setLiveSources(sources)
        setSrtTelemetry(telemetry)
        setHostMetrics(metrics)
        setProcesses(processSnapshot.processes)
        setOutputs(outputSnapshot.outputs)
        setMonitorLoadError(null)
        setMonitorLoaded(true)
      } catch (error) {
        if (active) setMonitorLoadError(error instanceof Error ? error.message : 'Não foi possível ler as fontes de entrada.')
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 3000)
    return () => { active = false; window.clearInterval(timer) }
  }, [channel.id])

  const gpu = hostMetrics?.gpu ?? null
  const engineProcess = processes.find((process) => process.kind === 'ENGINE' && process.channelId === channel.id)
  const engineSimulated = engineProcess?.details?.transport === 'SIMULATED'
  const engineAlert = Boolean(live?.alerts.some((alert) => alert.kind === 'ENGINE')) || engineProcess?.state === 'error'

  const multiviewSources: MultiviewSourceItem[] = liveSources.map(source=>liveSourceMonitor(source,live,monitors,source.kind==='SRT'?srtTelemetry[source.id]:undefined,Date.now(),channel.qcProfile?.liveSignalPolicy))
  const srtLinks: SrtLinkItem[] = liveSources
    .filter((source) => source.kind === 'SRT')
    .map((source) => {
      const telemetry = srtTelemetry[source.id]
      return {
        id: source.id,
        name: source.name,
        endpoint: source.targetUrl,
        mode: source.srt?.mode ?? 'listener',
        latencyMs: source.srt?.latencyMs ?? 0,
        streamId: source.srt?.streamId,
        pbkeylen: source.srt?.pbkeylen,
        role: source.role === 'BACKUP' ? 'BACKUP' : 'PRIMARY',
        lastActivity: telemetry?.timestamp ? new Date(telemetry.timestamp).toLocaleTimeString('pt-BR') : 'Sem telemetria recebida',
        telemetry,
      }
    })
  const redundancyPair: RedundantStreamPair | undefined = (() => {
    const primary = liveSources.find((source) => source.kind === 'SRT' && source.role === 'PRIMARY' && source.pairedSourceId)
    const backup = primary?.pairedSourceId ? liveSources.find((source) => source.id === primary.pairedSourceId && source.kind === 'SRT') : undefined
    if (!primary || !backup) return undefined
    const threshold = primary.failoverThresholds
    return {
      id: `${primary.id}:${backup.id}`,
      name: `${primary.name} / ${backup.name}`,
      role: 'INGEST',
      primary: { id: primary.id, label: primary.name, kind: 'SRT', uri: primary.targetUrl, priority: 1, enabled: primary.enabled },
      backup: { id: backup.id, label: backup.name, kind: 'SRT', uri: backup.targetUrl, priority: 2, enabled: backup.enabled },
      policy: {
        signalLossTimeoutMs: threshold.signalLossTimeoutMs,
        packetLossThresholdPercent: threshold.maxPacketLossPercent,
        rttMultiplierThreshold: threshold.maxRttMultiplier,
        qualificationTimeMs: 1000,
        autoRevertToPrimary: primary.autoFailoverEnabled,
        primaryHysteresisStabilizationMs: 30_000,
        transitionStrategy: 'FREEZE_FRAME_HOLD',
      },
      runtimeState: {
        activeStream: 'PRIMARY',
        primaryHealth: srtTelemetry[primary.id] ?? null,
        backupHealth: srtTelemetry[backup.id] ?? null,
        lastSwitchTimestamp: null,
        lastSwitchReason: null,
        switchCount: 0,
      },
    }
  })()

  // Logs terminal state
  const [logFilter, setLogFilter] = useState<'ALL' | 'WARN' | 'ENGINE'>('ALL')
  const [isLogPaused, setIsLogPaused] = useState(false)
  const [logs, setLogs] = useState<Array<{ id: string; time: string; level: 'INFO' | 'WARN' | 'OK'; msg: string }>>([])

  useEffect(() => {
    if (isLogPaused) return
    const now = new Date()
    const time = now.toLocaleTimeString('pt-BR', { hour12: false })
    setLogs(processes.map((process) => ({
      id: `${process.id}:${process.state}:${process.pid ?? 'none'}`,
      time,
      level: process.state === 'error' || process.state === 'stopped' ? 'WARN' : process.state === 'running' ? 'OK' : 'INFO',
      msg: `${process.kind} ${process.channelId ? `(${process.channelId}) ` : ''}${process.state.toUpperCase()}${process.pid ? ` • PID ${process.pid}` : ''}${process.memoryBytes === null ? '' : ` • RAM ${(process.memoryBytes / 1024 ** 2).toFixed(0)} MiB`}`,
    })))
  }, [processes, isLogPaused])

  const filteredLogs = logs.filter((l) => {
    if (logFilter === 'WARN') return l.level === 'WARN'
    if (logFilter === 'ENGINE') return l.msg.includes('Engine') || l.msg.includes('Sync')
    return true
  })

  const canRestart = useCan('OUTPUT_CONTROL')
  const restartEngine = async () => {
    if (!window.confirm(`Reiniciar o engine de ${channel.name}? O ar para por alguns segundos.`)) return
    setEngineeringAction('restart')
    try {
      await api.restartChannel(channel.id)
      onMessage('Reinicialização do engine solicitada para este canal.')
    } catch (error) {
      onMessage(error instanceof Error ? error.message : 'Não foi possível reiniciar o engine.')
    } finally {
      setEngineeringAction(null)
    }
  }

  const warmCache = async () => {
    setEngineeringAction('cache')
    try {
      const result = await api.warmContinuityCache(channel.id)
      onMessage(`Cache de continuidade atualizado: ${result.cached48h} itens prontos para 48h; ${result.missing48h} pendentes.`)
    } catch (error) {
      onMessage(error instanceof Error ? error.message : 'Não foi possível atualizar o cache de continuidade.')
    } finally {
      setEngineeringAction(null)
    }
  }

  return (
    <div className="bg-surface-base text-on-surface select-none font-body-md antialiased h-screen overflow-hidden flex flex-col">
      {/* 1. CABEÇALHO PADRÃO RPLAYOUT (IDÊNTICO AO MASTER CONTROL) */}
      <BroadcastHeader
        activeWorkspace="monitor"
        channel={channel}
        channels={channels}
        onSelectChannel={onSelectChannel}
        onNavigate={onNavigate}
        sessionRole={sessionRole}
        authRequired={authRequired}
        onOpenSettings={onOpenSettings}
      />

      {/* MAIN CONTAINER */}
      <div className="flex-1 flex flex-col w-full bg-surface-base min-h-0 overflow-y-auto lg:overflow-hidden">
        {/* 2. BARRA DE STATUS / CARDS DE TELEMETRIA SUPERIOR */}
        <div className="w-full bg-surface-card border-b border-border-subtle px-4 py-2 shadow-sm shrink-0">
          <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
            {/* 4 Cards de Métricas Principais */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5 flex-1 min-w-0">
              {/* Card 1: GPU NVENC */}
              <div className="bg-surface-panel p-2.5 rounded-lg border border-border-subtle flex flex-col justify-between shadow-sm hover:border-border-strong transition-colors">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-label-caps text-[11px] text-outline uppercase font-bold tracking-wider flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-accent-ice text-[15px]">memory</span>
                    UTILIZAÇÃO DA GPU
                  </span>
                  <span className="font-label-mono text-[12px] text-status-ok font-bold bg-surface-base px-1.5 py-0.5 rounded border border-border-subtle/40">
                    {percent(hostMetrics?.gpu.utilizationPercent ?? null)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between mb-1">
                  <div className="font-timecode-display text-[20px] font-bold text-accent-ice-bright tracking-tight leading-none">
                    {hostMetrics?.gpu.utilizationPercent === null || !hostMetrics ? '—' : percent(hostMetrics.gpu.utilizationPercent)}
                  </div>
                  <span className="font-label-mono text-[12px] text-on-surface-variant font-medium">
                    {gpu?.memoryUsedMiB !== null && gpu?.memoryUsedMiB !== undefined && gpu?.memoryTotalMiB !== null && gpu?.memoryTotalMiB !== undefined
                      ? `VRAM ${gpu.memoryUsedMiB}/${gpu.memoryTotalMiB} MiB${gpu.temperatureC === null ? '' : ` • ${gpu.temperatureC}°C`}`
                      : gpu?.error ?? 'Aguardando coleta'}
                  </span>
                </div>
                <div className="w-full bg-surface-base h-1.5 rounded-full overflow-hidden shadow-inner border border-border-subtle/30">
                  <div className="bg-accent-ice h-full rounded-full" style={{ width: `${hostMetrics?.gpu.utilizationPercent ?? 0}%` }}></div>
                </div>
              </div>

              {/* Card 2: HOST CPU */}
              <div className="bg-surface-panel p-2.5 rounded-lg border border-border-subtle flex flex-col justify-between shadow-sm hover:border-border-strong transition-colors">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-label-caps text-[11px] text-outline uppercase font-bold tracking-wider flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-status-ok text-[15px]">developer_board</span>
                    HOST CPU
                  </span>
                  <span className="font-label-mono text-[12px] text-status-ok font-bold bg-surface-base px-1.5 py-0.5 rounded border border-border-subtle/40">
                    {percent(hostMetrics?.cpu.percent ?? null)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between mb-1">
                  <div className="font-timecode-display text-[20px] font-bold text-status-ok-bright tracking-tight leading-none">
                    {hostMetrics?.cpu.percent === null || !hostMetrics ? '—' : percent(hostMetrics.cpu.percent)}
                  </div>
                  <span className="font-label-mono text-[12px] text-on-surface-variant font-medium">{hostMetrics ? `${hostMetrics.cpu.cores} núcleos • coleta a cada ${hostMetrics.sampleIntervalSeconds} s` : 'Aguardando coleta'}</span>
                </div>
                <div className="w-full bg-surface-base h-1.5 rounded-full overflow-hidden shadow-inner border border-border-subtle/30">
                  <div className="bg-status-ok h-full rounded-full" style={{ width: `${hostMetrics?.cpu.percent ?? 0}%` }}></div>
                </div>
              </div>

              {/* Card 3: MEMÓRIA RAM */}
              <div className="bg-surface-panel p-2.5 rounded-lg border border-border-subtle flex flex-col justify-between shadow-sm hover:border-border-strong transition-colors">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-label-caps text-[11px] text-outline uppercase font-bold tracking-wider flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-armed-amber text-[15px]">storage</span>
                    MEMÓRIA RAM
                  </span>
                  <span className="font-label-mono text-[12px] text-accent-ice font-bold bg-surface-base px-1.5 py-0.5 rounded border border-border-subtle/40">
                    {percent(hostMetrics?.memory.percent ?? null)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between mb-1">
                  <div className="font-timecode-display text-[20px] font-bold text-on-surface tracking-tight leading-none">
                    {hostMetrics ? gib(hostMetrics.memory.usedBytes) : '—'}
                  </div>
                  <span className="font-label-mono text-[12px] text-on-surface-variant font-medium">{hostMetrics ? `${gib(hostMetrics.memory.freeBytes)} livre / ${gib(hostMetrics.memory.totalBytes)}` : 'Aguardando coleta'}</span>
                </div>
                <div className="w-full bg-surface-base h-1.5 rounded-full overflow-hidden shadow-inner border border-border-subtle/30">
                  <div className="bg-armed-amber h-full rounded-full" style={{ width: `${hostMetrics?.memory.percent ?? 0}%` }}></div>
                </div>
              </div>

              {/* Card 4: processo do engine. Jitter pertence à telemetria do link, não ao PID. */}
              <div className="bg-surface-panel p-2.5 rounded-lg border border-border-subtle flex flex-col justify-between shadow-sm hover:border-border-strong transition-colors">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-label-caps text-[11px] text-outline uppercase font-bold tracking-wider flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-status-ok-bright text-[15px]">speed</span>
                    ENGINE &amp; PROCESSO
                  </span>
                  <span className={`font-label-caps text-[11px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 ${engineAlert ? 'text-on-air-crimson bg-on-air-crimson/10 border border-on-air-crimson/30' : 'text-status-ok bg-status-ok/10 border border-status-ok/30'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${engineAlert ? 'bg-on-air-crimson' : 'bg-status-ok animate-pulse'}`}></span>{engineAlert ? 'ALERTA' : engineSimulated ? 'SIMULADO' : engineProcess?.state === 'running' ? 'ATIVO' : monitorLoaded ? 'SEM ALERTA' : '—'}
                  </span>
                </div>
                <div className="flex items-baseline justify-between mb-1">
                  <div className="font-timecode-display text-[20px] font-bold text-status-ok tracking-tight leading-none">
                    {engineProcess?.pid ? `PID ${engineProcess.pid}` : '—'}
                  </div>
                  <span className="font-label-mono text-[12px] text-on-surface-variant font-medium">{engineSimulated ? 'Transporte simulado • sem saída física' : engineProcess ? `Engine ${engineProcess.state} • ${engineProcess.memoryBytes === null ? 'RAM N/D' : `${(engineProcess.memoryBytes / 1024 ** 2).toFixed(0)} MiB`}` : monitorLoaded ? 'Engine não iniciado' : 'Consultando…'}</span>
                </div>
                <div className="w-full bg-surface-base h-1.5 rounded-full overflow-hidden shadow-inner border border-border-subtle/30">
                  <div className={`${engineAlert ? 'bg-on-air-crimson' : 'bg-status-ok'} h-full rounded-full`} style={{ width: engineProcess?.state === 'running' ? '100%' : engineProcess ? '45%' : '0%' }}></div>
                </div>
              </div>
            </div>

            {/* Ações Rápidas de Engenharia */}
            <div className="flex flex-wrap items-center justify-end gap-2 shrink-0 border-t lg:border-t-0 lg:border-l border-border-subtle pt-2 lg:pt-0 lg:pl-3">
              {onOpenHealth && <button type="button" onClick={onOpenHealth} className="flex items-center gap-1 px-2.5 py-1.5 bg-surface-panel text-on-surface text-[11px] font-bold rounded-lg border border-border-subtle"><span className="material-symbols-outlined text-[15px]">vital_signs</span>INCIDENTES DO CANAL</button>}
              {live?.reconfiguration?.ready === false && <span role="status" className="text-xs text-armed-amber max-w-52">{live.reconfiguration.reason ?? 'Aguardando recuperação do canal…'}</span>}
              <button
                disabled={engineeringAction !== null || live?.reconfiguration?.ready === false || !canRestart}
                title={!canRestart ? deniedReason('reiniciar o engine') : live?.reconfiguration?.reason ?? 'Reinício com interrupção controlada e recuperação do checkpoint (pede confirmação)'}
                onClick={() => void restartEngine()}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-surface-panel hover:bg-surface-container text-on-surface text-[11px] font-label-caps font-bold rounded-lg border border-border-subtle hover:border-border-strong transition-all shadow-sm cursor-pointer"
              >
                <span className="material-symbols-outlined text-armed-amber text-[15px]">refresh</span>
                <span>{engineeringAction === 'restart' ? 'REINICIANDO…' : 'REINICIAR'}</span>
              </button>
              <button
                disabled={engineeringAction !== null}
                onClick={() => void warmCache()}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-surface-panel hover:bg-surface-container text-on-surface text-[11px] font-label-caps font-bold rounded-lg border border-border-subtle hover:border-border-strong transition-all shadow-sm cursor-pointer"
              >
                <span className="material-symbols-outlined text-accent-ice text-[15px]">cleaning_services</span>
                <span>{engineeringAction === 'cache' ? 'ATUALIZANDO…' : 'AQUECER CACHE'}</span>
              </button>
              <button
                onClick={() => window.open(`/api/health-events.csv?channelId=${encodeURIComponent(channel.id)}`, '_blank', 'noopener,noreferrer')}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-primary-container/20 hover:bg-primary-container text-primary hover:text-white text-[11px] font-label-caps font-bold rounded-lg border border-primary-container/40 transition-all shadow-sm cursor-pointer"
              >
                <span className="material-symbols-outlined text-[15px]">archive</span>
                <span>EXPORTAR SAÚDE</span>
              </button>
            </div>
          </div>
        </div>

        {/* 3. BARRA DE NAVEGAÇÃO DE SUB-MÓDULOS DE ENGENHARIA (FASE B) */}
        <div className="w-full bg-surface-panel/80 border-b border-border-subtle px-4 py-1.5 flex items-center justify-between gap-3 shrink-0 overflow-x-auto">
          <div className="flex items-center gap-1.5 shrink-0">
            {[
              { id: 'DASHBOARD' as const, label: 'VISÃO INTEGRADA MCR', icon: 'dashboard' },
              { id: 'MULTIVIEW' as const, label: 'MULTIVIEW DE ENTRADAS', icon: 'grid_view' },
              { id: 'SRT' as const, label: 'SRT MANAGER & LINKS', icon: 'satellite_alt' },
              { id: 'REDUNDANCY' as const, label: 'REDUNDÂNCIA N+1 / FAILOVER', icon: 'verified_user' },
              { id: 'OUTPUTS' as const, label: 'MATRIZ DE SAÍDAS (SDI/NDI)', icon: 'hub' },
              { id: 'AUTOMATION' as const, label: 'AUTOMAÇÃO & ESTÚDIO', icon: 'precision_manufacturing' },
              { id: 'HOST' as const, label: 'RECURSOS DO SERVIDOR', icon: 'monitoring' },
              { id: 'LOGS' as const, label: 'LOGS TÉCNICOS', icon: 'terminal' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveSection(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-label-caps text-[11px] font-bold transition-all cursor-pointer whitespace-nowrap ${
                  activeSection === tab.id
                    ? 'bg-primary-container text-on-primary-container shadow-xs'
                    : 'text-outline hover:text-on-surface hover:bg-surface-panel'
                }`}
              >
                <span className="material-symbols-outlined text-[16px]">{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

        </div>

        {/* 4. CONTEÚDO PRINCIPAL DINÂMICO CONFORME A SUB-SEÇÃO */}
        <div className="lg:flex-1 lg:min-h-0 min-h-[80vh] p-3.5 lg:overflow-hidden flex flex-col gap-2.5">
          {/* WATCHDOG DE SONDA PGM & SLATE DE EMERGÊNCIA (FASE C) */}
          <PgmProbeBanner
            channelId={channel.id}
            onSlateTriggered={(active) =>
              onMessage(`Watchdog PGM: Slate de Emergência ${active ? 'INJETADO no PGM' : 'DESARMADO'}`)
            }
          />

          {/* SEÇÃO 1: VISÃO INTEGRADA MCR (DASHBOARD) */}
          {activeSection === 'DASHBOARD' && (
            <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-hidden">
              {monitorLoadError && <div role="alert" className="shrink-0 rounded border border-on-air-crimson/50 bg-on-air-crimson/10 px-2 py-1 font-label-mono text-[12px] text-on-air-crimson">Monitor sem dados: {monitorLoadError}</div>}
              {/* A visão integrada cabe integralmente no viewport operacional.
                  Detalhes extensos seguem nas abas SRT e Redundância. */}
              <OutputsSummary sample={hostMetrics} channelId={channel.id} profiles={outputs} />
              <div className="flex-1 min-h-0">
                <OperationalMultiview
                  sources={multiviewSources}
                  loading={!monitorLoaded}
                  initialLayout="COMPACT_LIST"
                  onWatchingBus={bus => { void api.watching(channel.id,bus).catch(() => undefined) }}
                />
              </div>

            </div>
          )}
          {activeSection === 'HOST' && <div className="flex-1 min-h-0"><HostResourcesPanel channels={channels} initialChannelId={channel.id}/></div>}

          {/* SEÇÃO 2: MULTIVIEW COMPLETO (FOCO TOTAL) */}
          {activeSection === 'MULTIVIEW' && (
            <div className="flex-1 min-h-0">
              <SharedMultiview key={channel.id}
                channelId={channel.id}
                sources={multiviewSources}
                  loading={!monitorLoaded}
                onWatchingBus={bus => { void api.watching(channel.id,bus).catch(() => undefined) }}
              />
            </div>
          )}

          {/* SEÇÃO 3: SRT MANAGER & TELEMETRIA COMPLETO */}
          {activeSection === 'SRT' && (
            <div className="flex-1 min-h-0">
              <SrtManagerPanel
                links={srtLinks}
                onReconnectLink={(id) => onMessage(`Socket SRT ${id} reinicializado.`)}
                onMessage={onMessage}
              />
            </div>
          )}

          {/* SEÇÃO 4: REDUNDÂNCIA PRIMÁRIO/BACKUP (FAILOVER) */}
          {activeSection === 'REDUNDANCY' && (
            <div className="flex-1 min-h-0 overflow-auto space-y-3">
              <HaReplicationPanel/>
              <RedundancyFailoverPanel
                pair={redundancyPair}
                onSwitchStream={(target) => {
                  if (!redundancyPair) return
                  return api.triggerFailover(redundancyPair.primary.id, target, 'Preferência de fonte registrada; sem comutação de PGM')
                    .then(() => onMessage('Preferência registrada. PGM não foi alterado; faça CUE/TAKE da fonte publicada e confira o sinal.'))
                }}
                onToggleAutoFailover={() => onMessage('A alteração da política deve ser salva na configuração da fonte primária.')}
                onMessage={onMessage}
              />
            </div>
          )}

          {/* SEÇÃO 5: MATRIZ DE SAÍDAS (SDI / NDI / IP) */}
          {activeSection === 'OUTPUTS' && (
            <div className="flex-1 min-h-0 overflow-y-auto broadcast-scroll flex flex-col gap-3">
              <div className="bg-surface-card p-3 rounded-lg border border-border-subtle flex items-center justify-between shadow-sm">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary text-[18px]">hub</span>
                  <h2 className="font-headline-md text-[16px] font-bold text-on-surface uppercase tracking-wide">
                    MATRIZ DE SAÍDAS FÍSICAS E IP
                  </h2>
                </div>
                <span className="font-label-mono text-[12px] text-status-ok bg-status-ok/10 border border-status-ok/30 px-2 py-0.5 rounded font-bold">
                  {outputs.filter((output) => output.enabled).length} SAÍDAS CONFIGURADAS
                </span>
              </div>

              {outputs.length === 0 ? (
                <p className="font-label-mono text-[12px] text-outline">Nenhuma saída cadastrada para este canal. Configure em Configurações → Saídas.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {outputs.map((output) => {
                    const process = processes.find((row) => row.kind === 'OUTPUT' && row.channelId === channel.id && String(row.details?.url ?? '') === output.target)
                    return <article key={output.id} className="bg-surface-card rounded-lg border border-border-subtle p-3.5 shadow-sm">
                      <div className="flex items-start justify-between gap-2"><div><strong className="font-headline-md text-[14px] text-on-surface">{output.name}</strong><p className="font-label-mono text-[12px] text-outline mt-1 break-all">{output.target || 'Destino gerenciado localmente'}</p></div><span className={`font-label-caps text-[12px] px-1.5 py-0.5 rounded border font-bold ${output.enabled ? 'text-status-ok border-status-ok/40 bg-status-ok/10' : 'text-outline border-border-subtle bg-surface-panel'}`}>{output.enabled ? 'HABILITADA' : 'DESLIGADA'}</span></div>
                      <div className="grid grid-cols-2 gap-1.5 font-label-mono text-[12px] mt-3"><span className="bg-surface-panel rounded px-2 py-1">{output.kind} · {output.role}</span><span className="bg-surface-panel rounded px-2 py-1">{process ? process.state.toUpperCase() : 'SEM TELEMETRIA'}</span></div>
                    </article>
                  })}
                </div>
              )}

              {false && <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {/* SINK 1: Blackmagic SDI */}
                <div className="bg-surface-card rounded-lg border border-border-subtle p-3.5 shadow-sm relative overflow-hidden group hover:border-border-strong transition-colors flex flex-col justify-between gap-3">
                  <div className={`absolute left-0 top-0 bottom-0 w-1 ${legacySinks.sdi ? 'bg-status-ok' : 'bg-outline'}`}></div>
                  <div className="flex items-start justify-between gap-2 pl-1">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-headline-md text-[15px] text-on-surface font-bold">
                          Blackmagic DeckLink 8K Pro
                        </span>
                        <span className="font-label-caps text-[11px] bg-status-ok/20 text-status-ok font-bold px-1.5 py-0.5 rounded border border-status-ok/40">
                          SDI PORT 1
                        </span>
                      </div>
                      <span className="font-label-mono text-[12px] text-outline block mt-0.5">
                        Dispositivo Físico PCIe • Bus #01 Direct
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={legacySinks.sdi}
                      onChange={(e) => {
                        setLegacySinks({ ...legacySinks, sdi: e.target.checked })
                        onMessage(`Saída SDI DeckLink ${e.target.checked ? 'habilitada' : 'desabilitada'}`)
                      }}
                      className="w-5 h-5 accent-status-ok cursor-pointer"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 font-label-mono text-[12px] pl-1">
                    <div className="bg-surface-panel px-2 py-1.5 rounded border border-border-subtle/50 flex flex-col">
                      <span className="text-outline text-[11px] uppercase font-label-caps">Formato Vídeo</span>
                      <span className="text-on-surface font-bold">1080i59.94 Rec.709</span>
                    </div>
                    <div className="bg-surface-panel px-2 py-1.5 rounded border border-border-subtle/50 flex flex-col">
                      <span className="text-outline text-[11px] uppercase font-label-caps">Genlock Sync</span>
                      <span className="text-status-ok-bright font-bold flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-status-ok"></span> BB LOCKED
                      </span>
                    </div>
                  </div>
                </div>

                {/* SINK 2: NDI Output */}
                <div className="bg-surface-card rounded-lg border border-border-subtle p-3.5 shadow-sm relative overflow-hidden group hover:border-border-strong transition-colors flex flex-col justify-between gap-3">
                  <div className={`absolute left-0 top-0 bottom-0 w-1 ${legacySinks.ndi ? 'bg-accent-ice-bright' : 'bg-outline'}`}></div>
                  <div className="flex items-start justify-between gap-2 pl-1">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-headline-md text-[15px] text-on-surface font-bold">
                          NDI Network Broadcast
                        </span>
                        <span className="font-label-caps text-[11px] bg-accent-ice/20 text-accent-ice-bright font-bold px-1.5 py-0.5 rounded border border-accent-ice/40">
                          IP GIGABIT
                        </span>
                      </div>
                      <span className="font-label-mono text-[12px] text-outline block mt-0.5">
                        RPLAYOUT_PGM_MASTER • Multicast Discovery
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={legacySinks.ndi}
                      onChange={(e) => {
                        setLegacySinks({ ...legacySinks, ndi: e.target.checked })
                        onMessage(`Saída NDI ${e.target.checked ? 'habilitada' : 'desabilitada'}`)
                      }}
                      className="w-5 h-5 accent-accent-ice cursor-pointer"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 font-label-mono text-[12px] pl-1">
                    <div className="bg-surface-panel px-2 py-1.5 rounded border border-border-subtle/50 flex flex-col">
                      <span className="text-outline text-[11px] uppercase font-label-caps">Stream Name</span>
                      <span className="text-on-surface font-bold">RPLAYOUT_PGM</span>
                    </div>
                    <div className="bg-surface-panel px-2 py-1.5 rounded border border-border-subtle/50 flex flex-col">
                      <span className="text-outline text-[11px] uppercase font-label-caps">Bitrate Médio</span>
                      <span className="text-accent-ice-bright font-bold">125 Mbps</span>
                    </div>
                  </div>
                </div>

                {/* SINK 3: SRT Ingest / Feed */}
                <div className="bg-surface-card rounded-lg border border-border-subtle p-3.5 shadow-sm relative overflow-hidden group hover:border-border-strong transition-colors flex flex-col justify-between gap-3">
                  <div className={`absolute left-0 top-0 bottom-0 w-1 ${legacySinks.srt ? 'bg-primary' : 'bg-outline'}`}></div>
                  <div className="flex items-start justify-between gap-2 pl-1">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-headline-md text-[15px] text-on-surface font-bold">
                          SRT Caller Primário
                        </span>
                        <span className="font-label-caps text-[11px] bg-primary/20 text-primary font-bold px-1.5 py-0.5 rounded border border-primary/40">
                          INTERNET WAN
                        </span>
                      </div>
                      <span className="font-label-mono text-[12px] text-outline block mt-0.5">
                        Caller para CDN / MUX Principal (srt://10.0.10.50:9000)
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={legacySinks.srt}
                      onChange={(e) => {
                        setLegacySinks({ ...legacySinks, srt: e.target.checked })
                        onMessage(`Saída SRT ${e.target.checked ? 'habilitada' : 'desabilitada'}`)
                      }}
                      className="w-5 h-5 accent-primary cursor-pointer"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 font-label-mono text-[12px] pl-1">
                    <div className="bg-surface-panel px-2 py-1.5 rounded border border-border-subtle/50 flex flex-col">
                      <span className="text-outline text-[11px] uppercase font-label-caps">RTT / Latência</span>
                      <span className="text-status-ok-bright font-bold">1.8 ms</span>
                    </div>
                    <div className="bg-surface-panel px-2 py-1.5 rounded border border-border-subtle/50 flex flex-col">
                      <span className="text-outline text-[11px] uppercase font-label-caps">Packet Loss</span>
                      <span className="text-status-ok-bright font-bold">0.00%</span>
                    </div>
                  </div>
                </div>
              </div>}
            </div>
          )}

          {/* SEÇÃO 6: AUTOMAÇÃO DE ESTÚDIO & CONTROLE EXTERNO (FASE D) */}
          {activeSection === 'AUTOMATION' && (
            <div className="flex-1 min-h-0 overflow-y-auto broadcast-scroll flex flex-col gap-3">
              <StudioAutomationPanel onMessage={onMessage} />
            </div>
          )}

          {/* SEÇÃO 7: TERMINAL DE LOGS TÉCNICOS */}
          {activeSection === 'LOGS' && (
            <div className="flex-1 min-h-0 flex flex-col gap-3">
              <div className="bg-surface-card p-3 rounded-lg border border-border-subtle flex items-center justify-between shadow-sm">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-accent-ice text-[18px]">terminal</span>
                  <h2 className="font-headline-md text-[16px] font-bold text-on-surface uppercase tracking-wide">
                    TERMINAL DE LOGS DA ENGINE EM TEMPO REAL
                  </h2>
                </div>
                <div className="flex items-center gap-1.5">
                  {(['ALL', 'WARN', 'ENGINE'] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setLogFilter(f)}
                      className={`px-2.5 py-1 rounded font-label-caps text-[11px] cursor-pointer transition-colors ${
                        logFilter === f
                          ? 'bg-primary-container text-on-primary-container font-bold'
                          : 'bg-surface-panel hover:bg-surface-container text-outline'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                  <button
                    onClick={() => setIsLogPaused(!isLogPaused)}
                    className="px-2.5 py-1 rounded font-label-caps text-[11px] bg-surface-panel hover:bg-surface-container border border-border-subtle text-outline cursor-pointer"
                  >
                    {isLogPaused ? 'RETOMAR' : 'PAUSAR'}
                  </button>
                  <button
                    onClick={() => setLogs([])}
                    className="px-2.5 py-1 rounded font-label-caps text-[11px] bg-surface-panel hover:bg-surface-container border border-border-subtle text-outline cursor-pointer"
                  >
                    LIMPAR
                  </button>
                </div>
              </div>

              {/* Terminal Box */}
              <div className="flex-1 bg-[#04060d] rounded-lg border border-border-subtle p-3 overflow-y-auto font-mono text-[12px] leading-relaxed flex flex-col gap-1 broadcast-scroll">
                {filteredLogs.map((log) => (
                  <div key={log.id} className="flex items-start gap-2">
                    <span className="text-outline text-[12px] tabular-nums">{log.time}</span>
                    <span
                      className={`font-bold text-[11px] px-1.5 rounded ${
                        log.level === 'OK'
                          ? 'bg-status-ok/15 text-status-ok'
                          : log.level === 'WARN'
                          ? 'bg-armed-amber/15 text-armed-amber'
                          : 'bg-accent-ice/15 text-accent-ice'
                      }`}
                    >
                      {log.level}
                    </span>
                    <span className="text-on-surface-variant flex-1 break-all">{log.msg}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
