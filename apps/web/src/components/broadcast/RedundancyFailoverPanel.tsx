import React, { useState } from 'react'
import type { RedundantStreamPair } from '@rplayout/protocol'

interface RedundancyFailoverPanelProps {
  pair?: RedundantStreamPair
  onSwitchStream?: (target: 'PRIMARY' | 'BACKUP') => void
  onToggleAutoFailover?: (enabled: boolean) => void
  onMessage?: (msg: string) => void
}

export const RedundancyFailoverPanel: React.FC<RedundancyFailoverPanelProps> = ({
  pair,
  onSwitchStream,
  onToggleAutoFailover,
  onMessage,
}) => {
  const [activeStream, setActiveStream] = useState<'PRIMARY' | 'BACKUP'>(pair?.runtimeState.activeStream ?? 'PRIMARY')
  const [autoArmed, setAutoArmed] = useState<boolean>(pair?.policy ? true : false)
  const [isSwitching, setIsSwitching] = useState<boolean>(false)

  if (!pair) {
    return <div className="flex h-full w-full items-center justify-center rounded-xl border border-dashed border-border-strong bg-surface-card p-8 text-center">
      <div><span className="material-symbols-outlined text-[34px] text-outline">verified_user</span><p className="mt-2 font-headline-md text-[14px] font-bold text-on-surface">Redundância não configurada</p><p className="mt-1 font-label-mono text-[10px] text-outline">Cadastre uma fonte primária e associe uma fonte backup nas configurações de entradas ao vivo.</p></div>
    </div>
  }

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

          {/* DIAGRAMA TÁTICO DE FLUXO DE SINAL BROADCAST (MAIN -> BACKUP -> DISTRIBUIÇÃO) */}
          <div className="bg-[#040711] rounded-lg border border-border-subtle/80 p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between text-[10px] font-label-mono text-outline">
              <span className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-accent-ice-bright">
                <span className="material-symbols-outlined text-[14px]">account_tree</span>
                DIAGRAMA DE FLUXO DE REDUNDÂNCIA (FAILOVER ENGINE)
              </span>
              <span className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-status-ok-bright animate-ping"></span>
                  HEARTBEAT 100ms
                </span>
                <span>•</span>
                <span className={activeStream === 'PRIMARY' ? 'text-on-air-crimson font-bold' : 'text-armed-amber font-bold'}>
                  ROTA ATIVA: {activeStream === 'PRIMARY' ? 'HOST A (PRIMÁRIO)' : 'HOST B (STANDBY)'}
                </span>
              </span>
            </div>

            <div className="w-full overflow-x-auto py-1">
              <svg viewBox="0 0 760 110" className="w-full min-w-[680px] h-24 select-none font-mono text-[10px]">
                <defs>
                  <linearGradient id="primaryGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#EF4444" stopOpacity="0.8" />
                    <stop offset="100%" stopColor="#F87171" stopOpacity="0.9" />
                  </linearGradient>
                  <linearGradient id="backupGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.8" />
                    <stop offset="100%" stopColor="#FBBF24" stopOpacity="0.9" />
                  </linearGradient>
                  <filter id="glowGreen" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="3" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                  </filter>
                </defs>

                {/* NÓ 1: HOST A (MAIN) */}
                <g transform="translate(10, 10)">
                  <rect
                    width="180"
                    height="38"
                    rx="5"
                    fill={activeStream === 'PRIMARY' ? '#1F1116' : '#0B0F19'}
                    stroke={activeStream === 'PRIMARY' ? '#EF4444' : '#374151'}
                    strokeWidth={activeStream === 'PRIMARY' ? '2' : '1'}
                  />
                  <circle cx="16" cy="19" r="5" fill={activeStream === 'PRIMARY' ? '#EF4444' : '#10B981'} />
                  <text x="28" y="16" fill="#F3F4F6" fontSize="10.5" fontWeight="bold">HOST A (MAIN ENGINE)</text>
                  <text x="28" y="29" fill="#9CA3AF" fontSize="8.5">SRT CALLER • FIBRA DEDICADA</text>
                </g>

                {/* NÓ 2: HOST B (HOT-STANDBY) */}
                <g transform="translate(10, 62)">
                  <rect
                    width="180"
                    height="38"
                    rx="5"
                    fill={activeStream === 'BACKUP' ? '#1F170A' : '#0B0F19'}
                    stroke={activeStream === 'BACKUP' ? '#F59E0B' : '#374151'}
                    strokeWidth={activeStream === 'BACKUP' ? '2' : '1'}
                  />
                  <circle cx="16" cy="19" r="5" fill={activeStream === 'BACKUP' ? '#F59E0B' : '#6B7280'} />
                  <text x="28" y="16" fill="#F3F4F6" fontSize="10.5" fontWeight="bold">HOST B (HOT-STANDBY)</text>
                  <text x="28" y="29" fill="#9CA3AF" fontSize="8.5">SRT CALLER • BACKUP 5G/WAN</text>
                </g>

                {/* LINHAS DE ENTRADA AO SWITCHER */}
                <path
                  d="M 190 29 L 320 29 L 340 45"
                  fill="none"
                  stroke={activeStream === 'PRIMARY' ? '#EF4444' : '#374151'}
                  strokeWidth={activeStream === 'PRIMARY' ? '2.5' : '1.5'}
                  strokeDasharray={activeStream === 'PRIMARY' ? 'none' : '4 3'}
                />
                <path
                  d="M 190 81 L 320 81 L 340 65"
                  fill="none"
                  stroke={activeStream === 'BACKUP' ? '#F59E0B' : '#374151'}
                  strokeWidth={activeStream === 'BACKUP' ? '2.5' : '1.5'}
                  strokeDasharray={activeStream === 'BACKUP' ? 'none' : '4 3'}
                />

                {/* HEARTBEAT LINK ENTRE HOST A E B */}
                <path
                  d="M 100 48 L 100 62"
                  fill="none"
                  stroke="#06B6D4"
                  strokeWidth="1.5"
                  strokeDasharray="2 2"
                />
                <text x="106" y="58" fill="#06B6D4" fontSize="7.5">PTP SYNC</text>

                {/* NÓ CENTRAL: SWITCHER MATRIZ COMUTADORA */}
                <g transform="translate(340, 25)">
                  <polygon
                    points="0,0 90,15 90,45 0,60"
                    fill="#111827"
                    stroke="#4B5563"
                    strokeWidth="1.5"
                  />
                  <text x="15" y="33" fill="#E5E7EB" fontSize="9.5" fontWeight="bold">SELETOR</text>
                  <text x="15" y="44" fill="#9CA3AF" fontSize="7.5">SEAMLESS</text>

                  {/* INDICADOR DA CHAVE FÍSICA / LÓGICA */}
                  <line
                    x1="2"
                    y1={activeStream === 'PRIMARY' ? '20' : '40'}
                    x2="85"
                    y2="30"
                    stroke={activeStream === 'PRIMARY' ? '#EF4444' : '#F59E0B'}
                    strokeWidth="3"
                  />
                </g>

                {/* LINHA SAÍDA PARA DISTRIBUIÇÃO */}
                <line
                  x1="430"
                  y1="55"
                  x2="520"
                  y2="55"
                  stroke="#10B981"
                  strokeWidth="3"
                  filter="url(#glowGreen)"
                />
                <text x="445" y="47" fill="#10B981" fontSize="8.5" fontWeight="bold">ON AIR PGM</text>

                {/* NÓ FINAL: DESTINO DE DISTRIBUIÇÃO */}
                <g transform="translate(520, 20)">
                  <rect width="220" height="70" rx="6" fill="#091410" stroke="#10B981" strokeWidth="1.5" />
                  <circle cx="16" cy="18" r="5" fill="#10B981" />
                  <text x="28" y="18" fill="#F3F4F6" fontSize="10.5" fontWeight="bold">DISTRIBUIÇÃO MASTER PGM</text>
                  <text x="28" y="32" fill="#34D399" fontSize="8.5">SDI DECKLINK + NDI IP + SRT CDN</text>

                  <rect x="28" y="40" width="180" height="22" rx="3" fill="#040D0A" stroke="#059669" strokeWidth="0.8" />
                  <text x="35" y="54" fill="#A7F3D0" fontSize="8.5">
                    {activeStream === 'PRIMARY' ? 'RECEBENDO DO HOST A (FIBRA)' : 'RECEBENDO DO HOST B (CONTINGÊNCIA)'}
                  </text>
                </g>
              </svg>
            </div>
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
