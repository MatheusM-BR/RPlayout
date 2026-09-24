import { useState, useEffect } from 'react'
import type { Channel } from '@rplayout/protocol'
import type { WorkspaceId } from '../components/WorkspaceShell.js'
import { BroadcastHeader } from '../components/broadcast/BroadcastHeader.js'
import { OperationalMultiview } from '../components/broadcast/OperationalMultiview.js'
import { SrtManagerPanel } from '../components/broadcast/SrtManagerPanel.js'
import { RedundancyFailoverPanel } from '../components/broadcast/RedundancyFailoverPanel.js'
import { ContinuityCacheBadge } from '../components/broadcast/ContinuityCacheBadge.js'
import { PgmProbeBanner } from '../components/broadcast/PgmProbeBanner.js'
import { StudioAutomationPanel } from '../components/broadcast/StudioAutomationPanel.js'

interface Props {
  channel: Channel
  channels?: Channel[]
  onNavigate: (workspace: WorkspaceId) => void
  onSelectChannel?: (channelId: string) => void
  onMessage: (msg: string) => void
  sessionRole?: string
  authRequired?: boolean
  onOpenSettings?: () => void
}

type EngineeringSection = 'DASHBOARD' | 'MULTIVIEW' | 'SRT' | 'REDUNDANCY' | 'OUTPUTS' | 'AUTOMATION' | 'LOGS'

export function EngineeringDistributionView({
  channel,
  channels = [channel],
  onNavigate,
  onSelectChannel = () => {},
  onMessage,
  sessionRole = 'Operador Master',
  authRequired = false,
  onOpenSettings,
}: Props) {
  // Seção ativa da visualização de engenharia
  const [activeSection, setActiveSection] = useState<EngineeringSection>('DASHBOARD')

  // Sinks state
  const [sinks, setSinks] = useState({
    sdi: true,
    ndi: true,
    srt: true,
    whep: true,
  })

  // Logs terminal state
  const [logFilter, setLogFilter] = useState<'ALL' | 'WARN' | 'ENGINE'>('ALL')
  const [isLogPaused, setIsLogPaused] = useState(false)
  const [logs, setLogs] = useState<Array<{ id: number; time: string; level: 'INFO' | 'WARN' | 'OK'; msg: string }>>([
    { id: 1, time: '20:51:24.050', level: 'OK', msg: 'SDI Port 1: Blackmagic 8K Pro Genlock locked to Blackburst' },
    { id: 2, time: '20:51:23.980', level: 'INFO', msg: 'NDI Output: 1920x1080@59.94fps multicast announced on 10.0.4.1' },
    { id: 3, time: '20:51:22.410', level: 'OK', msg: 'SRT Caller: Connected to CDN ingest (RTT 1.8ms, Bitrate 25.4 Mbps)' },
    { id: 4, time: '20:51:20.100', level: 'WARN', msg: 'Audio True-Peak detected at -1.1 dBTP (EBU R128 limit -1.0 dBTP)' },
    { id: 5, time: '20:51:15.020', level: 'OK', msg: 'Engine Playout Core: Cadence locked 59.94 FPS, dropped: 0' },
  ])

  useEffect(() => {
    if (isLogPaused) return
    const interval = setInterval(() => {
      const now = new Date()
      const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(now.getMilliseconds()).padStart(3, '0')}`
      setLogs((prev) => [
        {
          id: Date.now(),
          time: timeStr,
          level: 'INFO',
          msg: `Sync pulse: 59.94 FPS continuous • VRAM 3.1GB • Buffer Ring 100% OK`,
        },
        ...prev.slice(0, 40),
      ])
    }, 5000)
    return () => clearInterval(interval)
  }, [isLogPaused])

  const filteredLogs = logs.filter((l) => {
    if (logFilter === 'WARN') return l.level === 'WARN'
    if (logFilter === 'ENGINE') return l.msg.includes('Engine') || l.msg.includes('Sync')
    return true
  })

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
      <div className="flex-1 flex flex-col w-full bg-surface-base min-h-0 overflow-hidden">
        {/* 2. BARRA DE STATUS / CARDS DE TELEMETRIA SUPERIOR */}
        <div className="w-full bg-surface-card border-b border-border-subtle px-4 py-2 shadow-sm shrink-0">
          <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
            {/* 4 Cards de Métricas Principais */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5 flex-1 min-w-0">
              {/* Card 1: GPU NVENC */}
              <div className="bg-surface-panel p-2.5 rounded-lg border border-border-subtle flex flex-col justify-between shadow-sm hover:border-border-strong transition-colors">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-label-caps text-[10px] text-outline uppercase font-bold tracking-wider flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-accent-ice text-[15px]">memory</span>
                    GPU NVENC LOAD
                  </span>
                  <span className="font-label-mono text-[10px] text-status-ok font-bold bg-surface-base px-1.5 py-0.5 rounded border border-border-subtle/40">
                    52°C
                  </span>
                </div>
                <div className="flex items-baseline justify-between mb-1">
                  <div className="font-timecode-display text-[20px] font-bold text-accent-ice-bright tracking-tight leading-none">
                    34<span className="text-[13px] text-outline font-normal">%</span>
                  </div>
                  <span className="font-label-mono text-[10px] text-on-surface-variant font-medium">
                    VRAM: 3.1 / 12 GB
                  </span>
                </div>
                <div className="w-full bg-surface-base h-1.5 rounded-full overflow-hidden shadow-inner border border-border-subtle/30">
                  <div className="bg-accent-ice h-full rounded-full transition-all duration-500" style={{ width: '34%' }}></div>
                </div>
              </div>

              {/* Card 2: HOST CPU */}
              <div className="bg-surface-panel p-2.5 rounded-lg border border-border-subtle flex flex-col justify-between shadow-sm hover:border-border-strong transition-colors">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-label-caps text-[10px] text-outline uppercase font-bold tracking-wider flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-status-ok text-[15px]">developer_board</span>
                    HOST CPU
                  </span>
                  <span className="font-label-mono text-[10px] text-status-ok font-bold bg-surface-base px-1.5 py-0.5 rounded border border-border-subtle/40">
                    46°C
                  </span>
                </div>
                <div className="flex items-baseline justify-between mb-1">
                  <div className="font-timecode-display text-[20px] font-bold text-status-ok-bright tracking-tight leading-none">
                    18<span className="text-[13px] text-outline font-normal">%</span>
                  </div>
                  <span className="font-label-mono text-[10px] text-on-surface-variant font-medium">Load: 1.12, 1.08</span>
                </div>
                <div className="w-full bg-surface-base h-1.5 rounded-full overflow-hidden shadow-inner border border-border-subtle/30">
                  <div className="bg-status-ok h-full rounded-full transition-all duration-500" style={{ width: '18%' }}></div>
                </div>
              </div>

              {/* Card 3: MEMÓRIA RAM */}
              <div className="bg-surface-panel p-2.5 rounded-lg border border-border-subtle flex flex-col justify-between shadow-sm hover:border-border-strong transition-colors">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-label-caps text-[10px] text-outline uppercase font-bold tracking-wider flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-armed-amber text-[15px]">storage</span>
                    MEMÓRIA RAM ECC
                  </span>
                  <span className="font-label-mono text-[10px] text-accent-ice font-bold bg-surface-base px-1.5 py-0.5 rounded border border-border-subtle/40">
                    DDR4
                  </span>
                </div>
                <div className="flex items-baseline justify-between mb-1">
                  <div className="font-timecode-display text-[20px] font-bold text-on-surface tracking-tight leading-none">
                    4.2<span className="text-[13px] text-outline font-normal"> / 16 GB</span>
                  </div>
                  <span className="font-label-mono text-[10px] text-status-ok font-medium">1.2 GB Buffer Livre</span>
                </div>
                <div className="w-full bg-surface-base h-1.5 rounded-full overflow-hidden shadow-inner border border-border-subtle/30">
                  <div className="bg-armed-amber h-full rounded-full transition-all duration-500" style={{ width: '26%' }}></div>
                </div>
              </div>

              {/* Card 4: ENGINE & JITTER */}
              <div className="bg-surface-panel p-2.5 rounded-lg border border-border-subtle flex flex-col justify-between shadow-sm hover:border-border-strong transition-colors">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-label-caps text-[10px] text-outline uppercase font-bold tracking-wider flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-status-ok-bright text-[15px]">speed</span>
                    ENGINE &amp; JITTER
                  </span>
                  <span className="font-label-caps text-[9px] text-status-ok font-bold bg-status-ok/10 border border-status-ok/30 px-1.5 py-0.5 rounded flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-status-ok animate-pulse"></span> LOCKED
                  </span>
                </div>
                <div className="flex items-baseline justify-between mb-1">
                  <div className="font-timecode-display text-[20px] font-bold text-status-ok tracking-tight leading-none">
                    59.94<span className="text-[13px] font-normal text-outline"> FPS</span>
                  </div>
                  <span className="font-label-mono text-[10px] text-status-ok-bright font-medium">Jitter: 0.02ms</span>
                </div>
                <div className="w-full bg-surface-base h-1.5 rounded-full overflow-hidden shadow-inner border border-border-subtle/30">
                  <div className="bg-status-ok h-full rounded-full" style={{ width: '100%' }}></div>
                </div>
              </div>
            </div>

            {/* Ações Rápidas de Engenharia */}
            <div className="flex items-center justify-end gap-2 shrink-0 border-t lg:border-t-0 lg:border-l border-border-subtle pt-2 lg:pt-0 lg:pl-3">
              <button
                onClick={() => onMessage('Pipeline de renderização reiniciado sem perda de sinal')}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-surface-panel hover:bg-surface-container text-on-surface text-[10.5px] font-label-caps font-bold rounded-lg border border-border-subtle hover:border-border-strong transition-all shadow-sm cursor-pointer"
              >
                <span className="material-symbols-outlined text-armed-amber text-[15px]">refresh</span>
                <span>REINICIAR</span>
              </button>
              <button
                onClick={() => onMessage('Cache local de thumbnails e buffers limpo com sucesso')}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-surface-panel hover:bg-surface-container text-on-surface text-[10.5px] font-label-caps font-bold rounded-lg border border-border-subtle hover:border-border-strong transition-all shadow-sm cursor-pointer"
              >
                <span className="material-symbols-outlined text-accent-ice text-[15px]">cleaning_services</span>
                <span>LIMPAR CACHE</span>
              </button>
              <button
                onClick={() => onMessage('Pacote de diagnóstico e telemetria gerado (RPlayout-Diag.zip)')}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-primary-container/20 hover:bg-primary-container text-primary hover:text-white text-[10.5px] font-label-caps font-bold rounded-lg border border-primary-container/40 transition-all shadow-sm cursor-pointer"
              >
                <span className="material-symbols-outlined text-[15px]">archive</span>
                <span>DIAGNÓSTICO</span>
              </button>
            </div>
          </div>
        </div>

        {/* 3. BARRA DE NAVEGAÇÃO DE SUB-MÓDULOS DE ENGENHARIA (FASE B) */}
        <div className="w-full bg-surface-panel/80 border-b border-border-subtle px-4 py-1.5 flex items-center justify-between gap-3 shrink-0 overflow-x-auto broadcast-scroll">
          <div className="flex items-center gap-1.5">
            {[
              { id: 'DASHBOARD' as const, label: 'VISÃO INTEGRADA MCR', icon: 'dashboard' },
              { id: 'MULTIVIEW' as const, label: 'MULTIVIEW DE ENTRADAS', icon: 'grid_view' },
              { id: 'SRT' as const, label: 'SRT MANAGER & LINKS', icon: 'satellite_alt' },
              { id: 'REDUNDANCY' as const, label: 'REDUNDÂNCIA N+1 / FAILOVER', icon: 'verified_user' },
              { id: 'OUTPUTS' as const, label: 'MATRIZ DE SAÍDAS (SDI/NDI)', icon: 'hub' },
              { id: 'AUTOMATION' as const, label: 'AUTOMAÇÃO & ESTÚDIO', icon: 'precision_manufacturing' },
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

          <div className="font-label-mono text-[10px] text-outline flex items-center gap-2">
            <span>CANAL: <strong className="text-on-surface">{channel.name}</strong></span>
            <span>•</span>
            <span className="text-status-ok-bright font-bold flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-status-ok animate-pulse"></span>
              24/7 BROADCAST CONTINUOUS
            </span>
            <div className="h-3.5 w-px bg-border-subtle"></div>
            {/* Badge de Cobertura do Cache de Continuidade (Fase C: 48h AIR-GAP) */}
            <ContinuityCacheBadge />
          </div>
        </div>

        {/* 4. CONTEÚDO PRINCIPAL DINÂMICO CONFORME A SUB-SEÇÃO */}
        <div className="flex-1 min-h-0 p-3.5 overflow-hidden flex flex-col gap-2.5">
          {/* WATCHDOG DE SONDA PGM & SLATE DE EMERGÊNCIA (FASE C) */}
          <PgmProbeBanner
            onSlateTriggered={(active) =>
              onMessage(`Watchdog PGM: Slate de Emergência ${active ? 'INJETADO no PGM' : 'DESARMADO'}`)
            }
          />

          {/* SEÇÃO 1: VISÃO INTEGRADA MCR (DASHBOARD) */}
          {activeSection === 'DASHBOARD' && (
            <div className="flex-1 min-h-0 flex flex-col gap-3.5 overflow-y-auto broadcast-scroll">
              {/* PARTE SUPERIOR: MULTIVIEW OPERACIONAL */}
              <div className="h-[460px] shrink-0">
                <OperationalMultiview
                  onSelectPreview={(srcId) => onMessage(`Fonte ${srcId} enviada para o canal de PREVIEW.`)}
                  onTakeDirect={(srcId) => onMessage(`Comando TAKE direto executado para a fonte ${srcId}.`)}
                  onConfigureSource={(srcId) => onMessage(`Abrindo configurações avançadas da fonte ${srcId}.`)}
                />
              </div>

              {/* PARTE INFERIOR: SRT MANAGER & REDUNDÂNCIA EM 2 COLUNAS */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 min-h-[420px]">
                {/* Coluna Esquerda: SRT Manager */}
                <div className="lg:col-span-7 flex flex-col min-h-0">
                  <SrtManagerPanel
                    onReconnectLink={(id) => onMessage(`Reconectando socket SRT ${id}…`)}
                    onMessage={onMessage}
                  />
                </div>

                {/* Coluna Direita: Redundância Primário/Backup */}
                <div className="lg:col-span-5 flex flex-col min-h-0">
                  <RedundancyFailoverPanel
                    onSwitchStream={(target) => onMessage(`Transmissão alternada para ${target}.`)}
                    onToggleAutoFailover={(enabled) => onMessage(`Guarda de Failover ${enabled ? 'ativada' : 'desativada'}.`)}
                    onMessage={onMessage}
                  />
                </div>
              </div>

              {/* PARTE INFERIOR 2: AUTOMAÇÃO DE ESTÚDIO & CONTROLE EXTERNO (FASE D) */}
              <StudioAutomationPanel onMessage={onMessage} />
            </div>
          )}

          {/* SEÇÃO 2: MULTIVIEW COMPLETO (FOCO TOTAL) */}
          {activeSection === 'MULTIVIEW' && (
            <div className="flex-1 min-h-0">
              <OperationalMultiview
                onSelectPreview={(srcId) => onMessage(`Fonte ${srcId} enviada para PREVIEW.`)}
                onTakeDirect={(srcId) => onMessage(`Comando TAKE direto executado para ${srcId}.`)}
                onConfigureSource={(srcId) => onMessage(`Configurando ${srcId}…`)}
              />
            </div>
          )}

          {/* SEÇÃO 3: SRT MANAGER & TELEMETRIA COMPLETO */}
          {activeSection === 'SRT' && (
            <div className="flex-1 min-h-0">
              <SrtManagerPanel
                onReconnectLink={(id) => onMessage(`Socket SRT ${id} reinicializado.`)}
                onMessage={onMessage}
              />
            </div>
          )}

          {/* SEÇÃO 4: REDUNDÂNCIA PRIMÁRIO/BACKUP (FAILOVER) */}
          {activeSection === 'REDUNDANCY' && (
            <div className="flex-1 min-h-0">
              <RedundancyFailoverPanel
                onSwitchStream={(target) => onMessage(`Chaveamento manual para ${target} concluído.`)}
                onToggleAutoFailover={(enabled) => onMessage(`Guarda automática: ${enabled ? 'ARMADA' : 'DESARMADA'}.`)}
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
                <span className="font-label-mono text-[10px] text-status-ok bg-status-ok/10 border border-status-ok/30 px-2 py-0.5 rounded font-bold">
                  {Object.values(sinks).filter(Boolean).length} SAÍDAS ATIVAS NO AR
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {/* SINK 1: Blackmagic SDI */}
                <div className="bg-surface-card rounded-lg border border-border-subtle p-3.5 shadow-sm relative overflow-hidden group hover:border-border-strong transition-colors flex flex-col justify-between gap-3">
                  <div className={`absolute left-0 top-0 bottom-0 w-1 ${sinks.sdi ? 'bg-status-ok' : 'bg-outline'}`}></div>
                  <div className="flex items-start justify-between gap-2 pl-1">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-headline-md text-[15px] text-on-surface font-bold">
                          Blackmagic DeckLink 8K Pro
                        </span>
                        <span className="font-label-caps text-[9px] bg-status-ok/20 text-status-ok font-bold px-1.5 py-0.5 rounded border border-status-ok/40">
                          SDI PORT 1
                        </span>
                      </div>
                      <span className="font-label-mono text-[10px] text-outline block mt-0.5">
                        Dispositivo Físico PCIe • Bus #01 Direct
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={sinks.sdi}
                      onChange={(e) => {
                        setSinks({ ...sinks, sdi: e.target.checked })
                        onMessage(`Saída SDI DeckLink ${e.target.checked ? 'habilitada' : 'desabilitada'}`)
                      }}
                      className="w-5 h-5 accent-status-ok cursor-pointer"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 font-label-mono text-[11px] pl-1">
                    <div className="bg-surface-panel px-2 py-1.5 rounded border border-border-subtle/50 flex flex-col">
                      <span className="text-outline text-[9px] uppercase font-label-caps">Formato Vídeo</span>
                      <span className="text-on-surface font-bold">1080i59.94 Rec.709</span>
                    </div>
                    <div className="bg-surface-panel px-2 py-1.5 rounded border border-border-subtle/50 flex flex-col">
                      <span className="text-outline text-[9px] uppercase font-label-caps">Genlock Sync</span>
                      <span className="text-status-ok-bright font-bold flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-status-ok"></span> BB LOCKED
                      </span>
                    </div>
                  </div>
                </div>

                {/* SINK 2: NDI Output */}
                <div className="bg-surface-card rounded-lg border border-border-subtle p-3.5 shadow-sm relative overflow-hidden group hover:border-border-strong transition-colors flex flex-col justify-between gap-3">
                  <div className={`absolute left-0 top-0 bottom-0 w-1 ${sinks.ndi ? 'bg-accent-ice-bright' : 'bg-outline'}`}></div>
                  <div className="flex items-start justify-between gap-2 pl-1">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-headline-md text-[15px] text-on-surface font-bold">
                          NDI Network Broadcast
                        </span>
                        <span className="font-label-caps text-[9px] bg-accent-ice/20 text-accent-ice-bright font-bold px-1.5 py-0.5 rounded border border-accent-ice/40">
                          IP GIGABIT
                        </span>
                      </div>
                      <span className="font-label-mono text-[10px] text-outline block mt-0.5">
                        RPLAYOUT_PGM_MASTER • Multicast Discovery
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={sinks.ndi}
                      onChange={(e) => {
                        setSinks({ ...sinks, ndi: e.target.checked })
                        onMessage(`Saída NDI ${e.target.checked ? 'habilitada' : 'desabilitada'}`)
                      }}
                      className="w-5 h-5 accent-accent-ice cursor-pointer"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 font-label-mono text-[11px] pl-1">
                    <div className="bg-surface-panel px-2 py-1.5 rounded border border-border-subtle/50 flex flex-col">
                      <span className="text-outline text-[9px] uppercase font-label-caps">Stream Name</span>
                      <span className="text-on-surface font-bold">RPLAYOUT_PGM</span>
                    </div>
                    <div className="bg-surface-panel px-2 py-1.5 rounded border border-border-subtle/50 flex flex-col">
                      <span className="text-outline text-[9px] uppercase font-label-caps">Bitrate Médio</span>
                      <span className="text-accent-ice-bright font-bold">125 Mbps</span>
                    </div>
                  </div>
                </div>

                {/* SINK 3: SRT Ingest / Feed */}
                <div className="bg-surface-card rounded-lg border border-border-subtle p-3.5 shadow-sm relative overflow-hidden group hover:border-border-strong transition-colors flex flex-col justify-between gap-3">
                  <div className={`absolute left-0 top-0 bottom-0 w-1 ${sinks.srt ? 'bg-primary' : 'bg-outline'}`}></div>
                  <div className="flex items-start justify-between gap-2 pl-1">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-headline-md text-[15px] text-on-surface font-bold">
                          SRT Caller Primário
                        </span>
                        <span className="font-label-caps text-[9px] bg-primary/20 text-primary font-bold px-1.5 py-0.5 rounded border border-primary/40">
                          INTERNET WAN
                        </span>
                      </div>
                      <span className="font-label-mono text-[10px] text-outline block mt-0.5">
                        Caller para CDN / MUX Principal (srt://10.0.10.50:9000)
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={sinks.srt}
                      onChange={(e) => {
                        setSinks({ ...sinks, srt: e.target.checked })
                        onMessage(`Saída SRT ${e.target.checked ? 'habilitada' : 'desabilitada'}`)
                      }}
                      className="w-5 h-5 accent-primary cursor-pointer"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 font-label-mono text-[11px] pl-1">
                    <div className="bg-surface-panel px-2 py-1.5 rounded border border-border-subtle/50 flex flex-col">
                      <span className="text-outline text-[9px] uppercase font-label-caps">RTT / Latência</span>
                      <span className="text-status-ok-bright font-bold">1.8 ms</span>
                    </div>
                    <div className="bg-surface-panel px-2 py-1.5 rounded border border-border-subtle/50 flex flex-col">
                      <span className="text-outline text-[9px] uppercase font-label-caps">Packet Loss</span>
                      <span className="text-status-ok-bright font-bold">0.00%</span>
                    </div>
                  </div>
                </div>
              </div>
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
                      className={`px-2.5 py-1 rounded font-label-caps text-[9.5px] cursor-pointer transition-colors ${
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
                    className="px-2.5 py-1 rounded font-label-caps text-[9.5px] bg-surface-panel hover:bg-surface-container border border-border-subtle text-outline cursor-pointer"
                  >
                    {isLogPaused ? 'RETOMAR' : 'PAUSAR'}
                  </button>
                  <button
                    onClick={() => setLogs([])}
                    className="px-2.5 py-1 rounded font-label-caps text-[9.5px] bg-surface-panel hover:bg-surface-container border border-border-subtle text-outline cursor-pointer"
                  >
                    LIMPAR
                  </button>
                </div>
              </div>

              {/* Terminal Box */}
              <div className="flex-1 bg-[#04060d] rounded-lg border border-border-subtle p-3 overflow-y-auto font-mono text-[11px] leading-relaxed flex flex-col gap-1 broadcast-scroll">
                {filteredLogs.map((log) => (
                  <div key={log.id} className="flex items-start gap-2">
                    <span className="text-outline text-[10px] tabular-nums">{log.time}</span>
                    <span
                      className={`font-bold text-[9px] px-1.5 rounded ${
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
