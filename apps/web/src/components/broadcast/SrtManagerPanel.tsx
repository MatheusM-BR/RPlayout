import React, { useState } from 'react'
import type { SrtMode, SrtLinkState, SrtTelemetry } from '@rplayout/protocol'

export interface SrtLinkItem {
  id: string
  name: string
  endpoint: string
  mode: SrtMode
  latencyMs: number
  passphrase?: string
  pbkeylen?: 16 | 24 | 32
  streamId?: string
  /** Ausente até o socket real entregar a primeira sonda. */
  telemetry?: SrtTelemetry
  role: 'PRIMARY' | 'BACKUP' | 'CONTINGENCY'
  lastActivity: string
}

interface SrtManagerPanelProps {
  links?: SrtLinkItem[]
  onReconnectLink?: (linkId: string) => void
  onUpdateLatency?: (linkId: string, latencyMs: number) => void
  onMessage?: (msg: string) => void
}

export const SrtManagerPanel: React.FC<SrtManagerPanelProps> = ({
  // Não mostrar enlaces de demonstração como se fossem desta instalação.
  links = [],
  onReconnectLink,
  onUpdateLatency,
  onMessage,
}) => {
  // Controle de visibilidade de senha por ID de link (mascaramento estrito de senhas por padrão)
  const [revealedKeys, setRevealedKeys] = useState<Record<string, boolean>>({})
  const [selectedLinkId, setSelectedLinkId] = useState<string>(links[0]?.id ?? '')

  const togglePasswordVisibility = (linkId: string) => {
    setRevealedKeys((prev) => ({
      ...prev,
      [linkId]: !prev[linkId],
    }))
  }

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => onMessage?.(`${label} copiado para a área de transferência.`))
      .catch(() => onMessage?.('Não foi possível copiar automaticamente.'))
  }

  return (
    <div className="flex flex-col h-full w-full bg-surface-card rounded-xl border border-border-subtle overflow-hidden shadow-sm">
      {/* 1. HEADER DO SRT MANAGER */}
      <div className="px-4 py-2.5 bg-surface-panel border-b border-border-subtle flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded bg-accent-ice/15 border border-accent-ice/30 flex items-center justify-center text-accent-ice-bright">
            <span className="material-symbols-outlined text-[18px]">satellite_alt</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-headline-md text-[14px] text-on-surface uppercase font-bold tracking-wide">
                SRT MANAGER &amp; TELEMETRIA DE LINKS
              </h3>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-label-mono font-bold bg-accent-ice/20 text-accent-ice-bright border border-accent-ice/40">
                LIBSRT 1.5.3 NATIVO
              </span>
            </div>
            <p className="font-label-mono text-[10px] text-outline">
              Monitoração de Sockets SRT, Buffer de Latência (ARQ), Criptografia AES e Métricas em Tempo Real
            </p>
          </div>
        </div>

        {/* Resumo Rápido de Saúde de Links */}
        <div className="flex items-center gap-2 font-label-mono text-[10px] tabular-nums">
          <div className="px-2 py-1 rounded bg-surface-base border border-border-subtle flex items-center gap-1.5">
            <span className="text-outline">LINKS ATIVOS:</span>
            <span className="text-on-surface font-bold">{links.length}</span>
          </div>
          <div className="px-2 py-1 rounded bg-status-ok/10 border border-status-ok/30 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-status-ok animate-pulse"></span>
            <span className="text-status-ok font-bold">
              {links.filter((l) => l.telemetry?.linkState === 'OPTIMAL').length} ÓTIMOS
            </span>
          </div>
        </div>
      </div>

      {/* 2. GRID DE CARDS DE ENLACE SRT */}
      <div className="p-3.5 flex-1 min-h-0 overflow-y-auto broadcast-scroll">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {links.length === 0 && (
            <div className="md:col-span-2 rounded-lg border border-dashed border-border-strong bg-surface-base p-8 text-center">
              <span className="material-symbols-outlined text-[32px] text-outline">satellite_alt</span>
              <p className="mt-2 font-headline-md text-[14px] font-bold text-on-surface">Nenhum link SRT configurado</p>
              <p className="mt-1 font-label-mono text-[10px] text-outline">Cadastre uma fonte SRT em Configurações para acompanhar a telemetria real do socket.</p>
            </div>
          )}
          {links.map((link) => {
            const isRevealed = Boolean(revealedKeys[link.id])
            const statusConfig = getSrtStateConfig(link.telemetry?.linkState ?? 'DISCONNECTED')

            return (
              <div
                key={link.id}
                onClick={() => setSelectedLinkId(link.id)}
                className={`bg-surface-panel rounded-xl border-2 p-3.5 flex flex-col justify-between gap-3 shadow-sm transition-all cursor-pointer ${
                  selectedLinkId === link.id
                    ? 'border-accent-ice ring-2 ring-accent-ice/30'
                    : 'border-border-subtle hover:border-border-strong'
                }`}
              >
                {/* TOPO: NOME, MODO, LATÊNCIA E STATUS */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-headline-md text-[14px] text-on-surface font-bold truncate">
                          {link.name}
                        </span>
                        {link.role === 'BACKUP' && (
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-label-caps font-bold bg-amber-500/20 text-amber-400 border border-amber-500/40">
                            BACKUP
                          </span>
                        )}
                      </div>
                      <span className="font-label-mono text-[10px] text-outline truncate" title={link.endpoint}>
                        {link.endpoint}
                      </span>
                    </div>

                    {/* Badge de Status do Enlace */}
                    <span
                      className={`px-2 py-0.5 rounded text-[11px] font-label-mono font-bold flex items-center gap-1.5 shrink-0 ${statusConfig.badgeClass}`}
                    >
                      <span className={`w-2 h-2 rounded-full ${statusConfig.dotClass}`}></span>
                      {statusConfig.label}
                    </span>
                  </div>

                  {/* CHIPS DE CONFIGURAÇÃO (MODO, LATÊNCIA, STREAMID) */}
                  <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-label-mono">
                    {/* Modo: Caller / Listener / Rendezvous */}
                    <span
                      className={`px-2 py-0.5 rounded uppercase font-bold border ${
                        link.mode === 'caller'
                          ? 'bg-blue-500/15 text-blue-400 border-blue-500/30'
                          : link.mode === 'listener'
                          ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                          : 'bg-purple-500/15 text-purple-400 border-purple-500/30'
                      }`}
                    >
                      MODO: {link.mode.toUpperCase()}
                    </span>

                    {/* Latência de Buffer Configurada */}
                    <span className="px-2 py-0.5 rounded bg-surface-base border border-border-subtle text-on-surface font-medium flex items-center gap-1">
                      <span className="material-symbols-outlined text-[13px] text-outline">history</span>
                      BUFFER: <strong className="text-on-surface-variant font-bold tabular-nums">{link.latencyMs}ms</strong>
                    </span>

                    {/* StreamID */}
                    {link.streamId && (
                      <span
                        className="px-2 py-0.5 rounded bg-surface-base border border-border-subtle text-outline truncate max-w-[200px]"
                        title={link.streamId}
                      >
                        ID: {link.streamId}
                      </span>
                    )}
                  </div>
                </div>

                {/* PAINEL DE TELEMETRIA EM TEMPO REAL (MÉTRICAS DO SOCKET) */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-2 rounded-lg bg-surface-base/80 border border-border-subtle font-label-mono text-[11px] tabular-nums">
                  {/* RTT */}
                  <div className="flex flex-col p-1">
                    <span className="text-outline text-[10px] uppercase font-label-caps">RTT (Latency)</span>
                    <span className="text-on-surface font-bold text-[13px]">
                      {link.telemetry ? link.telemetry.rttMs.toFixed(1) : '—'} <span className="text-[11px] text-outline font-normal">ms</span>
                    </span>
                  </div>

                  {/* Perda de Pacotes */}
                  <div className="flex flex-col p-1">
                    <span className="text-outline text-[10px] uppercase font-label-caps">Packet Loss</span>
                    <span
                      className={`font-bold text-[13px] ${
                        (link.telemetry?.packetLossPercent ?? 0) > 5
                          ? 'text-red-400'
                          : (link.telemetry?.packetLossPercent ?? 0) > 1
                          ? 'text-amber-400'
                          : 'text-status-ok-bright'
                      }`}
                    >
                      {link.telemetry ? link.telemetry.packetLossPercent.toFixed(2) : '—'} <span className="text-[11px] font-normal">%</span>
                    </span>
                  </div>

                  {/* Bitrate Efetivo */}
                  <div className="flex flex-col p-1">
                    <span className="text-outline text-[10px] uppercase font-label-caps">Bitrate Efetivo</span>
                    <span className="text-accent-ice-bright font-bold text-[13px]">
                      {link.telemetry ? (link.telemetry.bitrateKbps / 1000).toFixed(2) : '—'} <span className="text-[11px] font-normal">Mbps</span>
                    </span>
                  </div>

                  {/* Reconexões & Descartes */}
                  <div className="flex flex-col p-1">
                    <span className="text-outline text-[10px] uppercase font-label-caps">Reconexões</span>
                    <span className="text-on-surface font-bold text-[13px] flex items-center gap-1">
                      {link.telemetry?.reconnectCount ?? '—'}
                      {(link.telemetry?.packetsDropped ?? 0) > 0 && (
                        <span className="text-[10px] text-red-400 font-normal">
                          ({link.telemetry?.packetsDropped} drop)
                        </span>
                      )}
                    </span>
                  </div>
                </div>

                {/* MASCARAMENTO ESTRITO DE SENHAS & CRIPTOGRAFIA */}
                <div className="p-2 rounded bg-surface-base border border-border-subtle flex items-center justify-between gap-2 text-[10.5px] font-label-mono">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="material-symbols-outlined text-[15px] text-accent-ice shrink-0">key</span>
                    <span className="text-outline text-[10px] uppercase font-label-caps shrink-0">
                      AES-{link.pbkeylen ?? 256}:
                    </span>
                    <span className="text-on-surface font-medium truncate select-all">
                      {isRevealed ? link.passphrase ?? '(sem senha)' : '••••••••••••••••'}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {/* Botão de Toggle de Olho para revelar/mascarar */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        togglePasswordVisibility(link.id)
                      }}
                      className="p-1 rounded text-outline hover:text-on-surface hover:bg-surface-panel transition-colors cursor-pointer"
                      title={isRevealed ? 'Ocultar senha' : 'Visualizar senha da chave AES'}
                    >
                      <span className="material-symbols-outlined text-[16px]">
                        {isRevealed ? 'visibility_off' : 'visibility'}
                      </span>
                    </button>

                    {/* Botão de Cópia da Senha */}
                    {link.passphrase && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleCopy(link.passphrase!, 'Frase secreta AES')
                        }}
                        className="p-1 rounded text-outline hover:text-accent-ice hover:bg-surface-panel transition-colors cursor-pointer"
                        title="Copiar passphrase"
                      >
                        <span className="material-symbols-outlined text-[15px]">content_copy</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* AÇÕES TÁTICAS DO ENLACE */}
                <div className="flex items-center justify-between pt-1 border-t border-border-subtle/50 text-[10px] font-label-caps">
                  <span className="text-outline text-[11px] font-label-mono">
                    Último heartbeat: {link.lastActivity}
                  </span>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onReconnectLink?.(link.id)
                        onMessage?.(`Forçando reconexão do socket SRT (${link.name})…`)
                      }}
                      className="px-2.5 py-1 rounded bg-surface-panel hover:bg-surface-container text-on-surface border border-border-subtle font-bold transition-all cursor-pointer flex items-center gap-1"
                    >
                      <span className="material-symbols-outlined text-[14px] text-accent-ice">sync</span>
                      RECONECTAR
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* =========================================================================
   HELPER DE CORES E STATUS DO ENLACE SRT
   ========================================================================= */
function getSrtStateConfig(state: SrtLinkState) {
  switch (state) {
    case 'OPTIMAL':
      return {
        label: 'OPTIMAL (ESTÁVEL)',
        badgeClass: 'bg-status-ok/15 text-status-ok border border-status-ok/30',
        dotClass: 'bg-status-ok animate-pulse',
      }
    case 'DEGRADED':
      return {
        label: 'DEGRADED (JITTER)',
        badgeClass: 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
        dotClass: 'bg-amber-400',
      }
    case 'CRITICAL':
      return {
        label: 'CRITICAL (PERDA)',
        badgeClass: 'bg-red-500/15 text-red-400 border border-red-500/30',
        dotClass: 'bg-red-400 animate-ping',
      }
    case 'DISCONNECTED':
    default:
      return {
        label: 'DISCONNECTED',
        badgeClass: 'bg-surface-base text-outline border border-border-subtle',
        dotClass: 'bg-outline',
      }
  }
}
