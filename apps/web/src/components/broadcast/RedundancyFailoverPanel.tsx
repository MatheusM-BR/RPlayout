import React, { useState } from 'react'
import type { RedundantStreamPair, SrtTelemetry } from '@rplayout/protocol'

interface RedundancyFailoverPanelProps {
  pair?: RedundantStreamPair
  onSwitchStream?: (target: 'PRIMARY' | 'BACKUP') => void
  onToggleAutoFailover?: (enabled: boolean) => void
  onMessage?: (msg: string) => void
}

const DEFAULT_PRIMARY_HEALTH: SrtTelemetry = {
  rttMs: 18.2,
  packetLossPercent: 0.05,
  bitrateKbps: 12400,
  packetsDropped: 0,
  packetsRetransmitted: 4,
  linkBandwidthKbps: 50000,
  bufferMs: 795,
  reconnectCount: 0,
  linkState: 'OPTIMAL',
}

const DEFAULT_BACKUP_HEALTH: SrtTelemetry = {
  rttMs: 24.8,
  packetLossPercent: 0.1,
  bitrateKbps: 12400,
  packetsDropped: 0,
  packetsRetransmitted: 8,
  linkBandwidthKbps: 45000,
  bufferMs: 790,
  reconnectCount: 0,
  linkState: 'OPTIMAL',
}

const DEFAULT_PAIR: RedundantStreamPair = {
  id: 'pair-pgm-transmissao',
  name: 'PGM MASTER // ENLACE DE DISTRIBUIÇÃO DUAL',
  role: 'DISTRIBUTION',
  primary: {
    id: 'ep-primary',
    label: 'TRANSMISSOR A (MASTER LOCAL - FIBRA)',
    kind: 'SRT',
    uri: 'srt://tx-primary.rplayout.net:9000?mode=caller&latency=800',
    priority: 1,
    enabled: true,
  },
  backup: {
    id: 'ep-backup',
    label: 'TRANSMISSOR B (HOT-STANDBY - WAN 5G)',
    kind: 'SRT',
    uri: 'srt://tx-backup.rplayout.net:9000?mode=caller&latency=1200',
    priority: 2,
    enabled: true,
  },
  policy: {
    signalLossTimeoutMs: 1500,
    packetLossThresholdPercent: 15.0,
    rttMultiplierThreshold: 3.0,
    qualificationTimeMs: 1000,
    autoRevertToPrimary: true,
    primaryHysteresisStabilizationMs: 30000,
    transitionStrategy: 'FREEZE_FRAME_HOLD',
  },
  runtimeState: {
    activeStream: 'PRIMARY',
    primaryHealth: DEFAULT_PRIMARY_HEALTH,
    backupHealth: DEFAULT_BACKUP_HEALTH,
    lastSwitchTimestamp: '2026-09-24 10:14:02 UTC',
    lastSwitchReason: 'Comutação manual preventiva pelo operador MCR',
    switchCount: 2,
  },
}

export const RedundancyFailoverPanel: React.FC<RedundancyFailoverPanelProps> = ({
  pair = DEFAULT_PAIR,
  onSwitchStream,
  onToggleAutoFailover,
  onMessage,
}) => {
  const [activeStream, setActiveStream] = useState<'PRIMARY' | 'BACKUP'>(pair.runtimeState.activeStream)
  const [autoArmed, setAutoArmed] = useState<boolean>(true)
  const [isSwitching, setIsSwitching] = useState<boolean>(false)

  const handleManualSwitch = (target: 'PRIMARY' | 'BACKUP') => {
    if (activeStream === target || isSwitching) return
    setIsSwitching(true)
    setActiveStream(target)
    onSwitchStream?.(target)
    onMessage?.(
      `Comutação tática executada: Transmissão transferida para o enlace ${
        target === 'PRIMARY' ? 'PRIMÁRIO (MAIN)' : 'BACKUP (STANDBY)'
      } com técnica Freeze-Frame Hold (glitch-free).`,
    )
    setTimeout(() => {
      setIsSwitching(false)
    }, 600)
  }

  const handleToggleArmed = () => {
    const next = !autoArmed
    setAutoArmed(next)
    onToggleAutoFailover?.(next)
    onMessage?.(
      next
        ? 'Failover Automático ARMADO: O sistema monitorará timeouts e perda de pacotes para chaveamento automático.'
        : 'Failover Automático DESARMADO: Chaveamento agora depende estritamente de comando manual.',
    )
  }

  return (
    <div className="flex flex-col h-full w-full bg-surface-card rounded-xl border border-border-subtle overflow-hidden shadow-sm">
      {/* 1. HEADER DA REDUNDÂNCIA */}
      <div className="px-4 py-2.5 bg-surface-panel border-b border-border-subtle flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <span className="material-symbols-outlined text-[18px]">verified_user</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-headline-md text-[14px] text-on-surface uppercase font-bold tracking-wide">
                REDUNDÂNCIA PRIMÁRIO / BACKUP (MAIN/STANDBY)
              </h3>
              {/* Badge de Auto-Failover */}
              <span
                className={`px-2 py-0.5 rounded text-[9px] font-label-mono font-bold flex items-center gap-1.5 border ${
                  autoArmed
                    ? 'bg-status-ok/15 text-status-ok border-status-ok/30'
                    : 'bg-red-500/15 text-red-400 border-red-500/30'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    autoArmed ? 'bg-status-ok animate-pulse' : 'bg-red-400'
                  }`}
                ></span>
                {autoArmed ? 'AUTO ARMED' : 'AUTO DISARMED'}
              </span>
            </div>
            <p className="font-label-mono text-[10px] text-outline">
              Arquitetura de Duplo Enlace com Histerese de 30s e Transição Glitch-Free (Freeze Frame Hold)
            </p>
          </div>
        </div>

        {/* Toggle do Auto-Failover */}
        <div className="flex items-center gap-2 bg-surface-base px-2.5 py-1 rounded-lg border border-border-subtle">
          <span className="font-label-mono text-[10px] text-outline">GUARDA AUTOMÁTICA:</span>
          <button
            onClick={handleToggleArmed}
            className={`px-2 py-0.5 rounded text-[9.5px] font-label-caps font-bold transition-all cursor-pointer ${
              autoArmed
                ? 'bg-status-ok text-surface-base'
                : 'bg-surface-panel text-outline hover:text-on-surface'
            }`}
          >
            {autoArmed ? 'ARMADO' : 'DESATIVAR'}
          </button>
        </div>
      </div>

      {/* 2. CHAVEADOR TÁTICO BROADCAST (MAIN VS STANDBY) */}
      <div className="p-3.5 flex-1 min-h-0 overflow-y-auto broadcast-scroll flex flex-col gap-4">
        {/* PAINEL TÁTICO DE CHAVEAMENTO VISUAL */}
        <div className="bg-surface-panel rounded-xl border border-border-subtle p-3.5 flex flex-col gap-3 shadow-inner">
          <div className="flex items-center justify-between border-b border-border-subtle/70 pb-2">
            <div>
              <span className="font-headline-md text-[13.5px] font-bold text-on-surface uppercase tracking-wide">
                Chaveamento Tático de Enlace
              </span>
              <span className="font-label-mono text-[9.5px] text-outline block">
                Comutação em tempo real sem interrupção de sinal (Freeze-Frame Hold de 4 frames max)
              </span>
            </div>

            <span className="font-label-mono text-[10px] text-outline tabular-nums">
              Comutações registradas: <strong className="text-on-surface">{pair.runtimeState.switchCount}</strong>
            </span>
          </div>

          {/* Grandes Botões de Chaveamento estilo Switcher de TV */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* BOTÃO PRIMÁRIO (MAIN) */}
            <button
              onClick={() => handleManualSwitch('PRIMARY')}
              disabled={isSwitching}
              className={`p-3.5 rounded-xl border-2 flex flex-col justify-between gap-2 text-left transition-all cursor-pointer relative overflow-hidden group ${
                activeStream === 'PRIMARY'
                  ? 'bg-on-air-crimson/15 border-on-air-crimson shadow-tally-onair ring-2 ring-on-air-crimson/30'
                  : 'bg-surface-base hover:bg-surface-panel/80 border-border-subtle hover:border-border-strong opacity-80'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-label-caps text-[10px] uppercase font-bold text-outline tracking-wider flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[15px] text-accent-ice">cable</span>
                  ENLACE A • PRIMÁRIO
                </span>
                <span
                  className={`px-2 py-0.5 rounded text-[9.5px] font-label-caps font-bold ${
                    activeStream === 'PRIMARY'
                      ? 'bg-on-air-crimson text-white animate-pulse'
                      : 'bg-surface-panel text-outline border border-border-subtle'
                  }`}
                >
                  {activeStream === 'PRIMARY' ? 'NO AR (ON AIR)' : 'STANDBY PRONTO'}
                </span>
              </div>

              <div>
                <div className="font-headline-md text-[15px] font-bold text-on-surface">
                  {pair.primary.label}
                </div>
                <div className="font-label-mono text-[10px] text-outline truncate" title={pair.primary.uri}>
                  {pair.primary.uri}
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1 border-t border-white/5 font-label-mono text-[10px] tabular-nums text-status-ok-bright">
                <span>RTT: {pair.runtimeState.primaryHealth?.rttMs.toFixed(1)}ms</span>
                <span>•</span>
                <span>Loss: {pair.runtimeState.primaryHealth?.packetLossPercent.toFixed(2)}%</span>
                <span>•</span>
                <span>{(pair.runtimeState.primaryHealth ? pair.runtimeState.primaryHealth.bitrateKbps / 1000 : 0).toFixed(1)} Mbps</span>
              </div>
            </button>

            {/* BOTÃO BACKUP (HOT-STANDBY) */}
            <button
              onClick={() => handleManualSwitch('BACKUP')}
              disabled={isSwitching}
              className={`p-3.5 rounded-xl border-2 flex flex-col justify-between gap-2 text-left transition-all cursor-pointer relative overflow-hidden group ${
                activeStream === 'BACKUP'
                  ? 'bg-armed-amber/15 border-armed-amber shadow-tally-pvw ring-2 ring-armed-amber/30'
                  : 'bg-surface-base hover:bg-surface-panel/80 border-border-subtle hover:border-border-strong opacity-80'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-label-caps text-[10px] uppercase font-bold text-outline tracking-wider flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[15px] text-amber-400">satellite_alt</span>
                  ENLACE B • CONTINGÊNCIA
                </span>
                <span
                  className={`px-2 py-0.5 rounded text-[9.5px] font-label-caps font-bold ${
                    activeStream === 'BACKUP'
                      ? 'bg-armed-amber text-surface-base font-bold'
                      : 'bg-surface-panel text-outline border border-border-subtle'
                  }`}
                >
                  {activeStream === 'BACKUP' ? 'ENGAGED (NO AR)' : 'HOT-STANDBY (PRONTO)'}
                </span>
              </div>

              <div>
                <div className="font-headline-md text-[15px] font-bold text-on-surface">
                  {pair.backup.label}
                </div>
                <div className="font-label-mono text-[10px] text-outline truncate" title={pair.backup.uri}>
                  {pair.backup.uri}
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1 border-t border-white/5 font-label-mono text-[10px] tabular-nums text-status-ok-bright">
                <span>RTT: {pair.runtimeState.backupHealth?.rttMs.toFixed(1)}ms</span>
                <span>•</span>
                <span>Loss: {pair.runtimeState.backupHealth?.packetLossPercent.toFixed(2)}%</span>
                <span>•</span>
                <span>{(pair.runtimeState.backupHealth ? pair.runtimeState.backupHealth.bitrateKbps / 1000 : 0).toFixed(1)} Mbps</span>
              </div>
            </button>
          </div>
        </div>

        {/* 3. POLÍTICA DE FAILOVER & GATILHOS TÉCNICOS */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Gatilho 1: Perda de Sinal */}
          <div className="bg-surface-panel p-2.5 rounded-lg border border-border-subtle flex flex-col justify-between">
            <span className="text-outline text-[9.5px] font-label-caps uppercase">Gatilho de Sinal</span>
            <div className="font-timecode-display text-[18px] font-bold text-on-surface tabular-nums">
              &gt; {pair.policy.signalLossTimeoutMs} <span className="text-[11px] text-outline font-normal">ms</span>
            </div>
            <span className="font-label-mono text-[9px] text-outline mt-0.5">
              Sem dados decodificados por 1.5s comuta de imediato
            </span>
          </div>

          {/* Gatilho 2: Perda de Pacotes */}
          <div className="bg-surface-panel p-2.5 rounded-lg border border-border-subtle flex flex-col justify-between">
            <span className="text-outline text-[9.5px] font-label-caps uppercase">Limite de Packet Loss</span>
            <div className="font-timecode-display text-[18px] font-bold text-on-surface tabular-nums">
              &gt; {pair.policy.packetLossThresholdPercent.toFixed(1)} <span className="text-[11px] text-outline font-normal">%</span>
            </div>
            <span className="font-label-mono text-[9px] text-outline mt-0.5">
              Degradação sustentada por mais de 1000ms
            </span>
          </div>

          {/* Gatilho 3: Histerese de Retorno */}
          <div className="bg-surface-panel p-2.5 rounded-lg border border-border-subtle flex flex-col justify-between">
            <span className="text-outline text-[9.5px] font-label-caps uppercase">Histerese de Estabilização</span>
            <div className="font-timecode-display text-[18px] font-bold text-status-ok-bright tabular-nums">
              {pair.policy.primaryHysteresisStabilizationMs / 1000} <span className="text-[11px] text-outline font-normal">segundos</span>
            </div>
            <span className="font-label-mono text-[9px] text-outline mt-0.5">
              Reversão segura apenas após Primário 100% estável
            </span>
          </div>
        </div>

        {/* 4. AUDITORIA DO ÚLTIMO EVENTO DE CHAVEAMENTO */}
        <div className="p-3 rounded-lg bg-surface-panel/80 border border-border-subtle flex items-start gap-2.5 text-[10.5px] font-label-mono">
          <span className="material-symbols-outlined text-[18px] text-accent-ice shrink-0">history</span>
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <span className="text-outline font-bold">ÚLTIMO REGISTRO DE TRANSIÇÃO:</span>
              <span className="text-on-surface font-medium">{pair.runtimeState.lastSwitchTimestamp}</span>
            </div>
            <span className="text-on-surface-variant">
              Motivo: {pair.runtimeState.lastSwitchReason}
            </span>
            <span className="text-status-ok text-[9.5px]">
              Transição executada com estratégia: {pair.policy.transitionStrategy} (Zero interrupção visível de imagem)
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
