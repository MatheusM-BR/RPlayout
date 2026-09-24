import { useState, useEffect } from 'react'
import type { Channel } from '@rplayout/protocol'
import type { WorkspaceId } from '../WorkspaceShell.js'
import { formatStandardRate } from '../../format.js'
import { ContinuityCacheBadge } from './ContinuityCacheBadge.js'

interface Props {
  activeWorkspace: WorkspaceId
  channel: Channel
  channels: Channel[]
  onSelectChannel: (channelId: string) => void
  onNavigate: (workspace: WorkspaceId) => void
  sessionRole: string
  authRequired: boolean
  problemasCount?: number
  isLiveOnAir?: boolean
  onOpenAlerts?: () => void
  onOpenSettings?: () => void
  onOpenLiveInput?: () => void
}

export function BroadcastHeader({
  activeWorkspace,
  channel,
  channels,
  onSelectChannel,
  onNavigate,
  sessionRole,
  authRequired,
  problemasCount = 0,
  isLiveOnAir = true,
  onOpenAlerts,
  onOpenSettings,
  onOpenLiveInput,
}: Props) {
  const [channelDropdownOpen, setChannelDropdownOpen] = useState(false)
  const rate = channel.rate
  const fps = rate.num / rate.den

  const [ntpTime, setNtpTime] = useState(() => {
    const now = new Date()
    const h = String(now.getHours()).padStart(2, '0')
    const m = String(now.getMinutes()).padStart(2, '0')
    const s = String(now.getSeconds()).padStart(2, '0')
    const f = String(Math.floor((now.getMilliseconds() / 1000) * (fps || 50))).padStart(2, '0')
    return `${h}:${m}:${s}:${f}`
  })

  useEffect(() => {
    const updateClock = () => {
      const now = new Date()
      const h = String(now.getHours()).padStart(2, '0')
      const m = String(now.getMinutes()).padStart(2, '0')
      const s = String(now.getSeconds()).padStart(2, '0')
      const f = String(Math.floor((now.getMilliseconds() / 1000) * (fps || 50))).padStart(2, '0')
      setNtpTime(`${h}:${m}:${s}:${f}`)
    }
    updateClock()
    const timer = setInterval(updateClock, 40)
    return () => clearInterval(timer)
  }, [fps])

  return (
    <header className="fixed top-0 left-0 right-0 w-full z-50 bg-surface-card border-b border-border-subtle select-none">
      <div className="h-16 px-margin flex items-center justify-between gap-gutter">
        {/* Left: Logo + Spacious Channel Selector */}
        <div className="flex items-center gap-space-lg">
          <div className="flex items-center gap-space-sm cursor-pointer" onClick={() => onNavigate('master')}>
            <span className="font-headline-md text-headline-md tracking-wider text-accent-ice uppercase font-bold text-[22px] flex items-center gap-1.5">
              <span className="material-symbols-outlined text-accent-ice text-[24px]">play_circle</span>
              RPlayout
            </span>
            {isLiveOnAir ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-on-air-crimson/20 border border-on-air-crimson/40 text-on-air-crimson font-label-caps text-[9px] font-bold tracking-wider whitespace-nowrap shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-on-air-crimson animate-pulse"></span> NO AR
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-container border border-border-subtle text-outline font-label-caps text-[9px] font-bold tracking-wider whitespace-nowrap shrink-0">
                <span className="material-symbols-outlined text-[12px] text-armed-amber">pause</span> PARADO
              </span>
            )}
          </div>

          <div className="h-8 w-px bg-border-subtle"></div>

          {/* Spacious Channel Selector Dropdown */}
          <div className="relative">
            <div
              onClick={() => setChannelDropdownOpen(!channelDropdownOpen)}
              className="flex items-center gap-space-sm bg-surface-panel px-3 py-1.5 rounded-lg border border-border-subtle hover:border-border-strong cursor-pointer transition-colors shadow-sm ml-2"
              title="Selecionar Canal de Exibição"
            >
              <span className="material-symbols-outlined text-accent-ice text-[20px]">tv</span>
              <div className="flex flex-col">
                <span className="font-body-md text-body-md font-semibold text-on-surface leading-tight">
                  {channel.name || 'Canal 1 - TV Principal HD'}
                </span>
                <span className="font-label-mono text-[9px] text-outline leading-tight">
                  {formatStandardRate(channel.rate, channel.scan, channel.height)} • Master Principal
                </span>
              </div>
              <span className="material-symbols-outlined text-outline text-[18px] ml-2">expand_more</span>
            </div>

            {channelDropdownOpen && (
              <div className="absolute top-full left-2 mt-1 w-64 bg-surface-card border border-border-strong rounded-lg shadow-2xl z-50 p-1 flex flex-col gap-1">
                {channels.map((ch) => (
                  <button
                    key={ch.id}
                    onClick={() => {
                      onSelectChannel(ch.id)
                      setChannelDropdownOpen(false)
                    }}
                    className={`flex items-center justify-between px-3 py-2 rounded text-left font-body-sm text-body-sm transition-colors ${
                      ch.id === channel.id
                        ? 'bg-primary-container text-on-primary-container font-bold'
                        : 'hover:bg-surface-panel text-on-surface'
                    }`}
                  >
                    <span>{ch.name}</span>
                    <span className="font-label-mono text-[9px] opacity-75">
                      {formatStandardRate(ch.rate, ch.scan, ch.height)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Center: Stacked SDI/NDI/NVENC/SRT Badge Grid & Master Clock */}
        <div className="flex items-center gap-space-xl">
          {/* Status Tags Stacked 2x2 Grid */}
          <div
            onClick={onOpenLiveInput}
            className={`hidden xl:grid grid-cols-2 gap-1 bg-surface-panel p-1 rounded-lg border border-border-subtle ${
              onOpenLiveInput ? 'cursor-pointer hover:border-border-strong transition-colors' : ''
            }`}
            title="Clique para configurar matriz de entradas externas (SDI, NDI, NVENC, SRT)"
          >
            <div className="flex items-center gap-space-xs px-2 py-0.5 rounded bg-surface-container border border-border-subtle/50">
              <span className="w-1.5 h-1.5 rounded-full bg-status-ok"></span>
              <span className="font-label-caps text-[9px] text-on-surface-variant">SDI:</span>
              <span className="font-label-caps text-[9px] text-status-ok-bright font-bold">OK</span>
            </div>
            <div className="flex items-center gap-space-xs px-2 py-0.5 rounded bg-surface-container border border-border-subtle/50">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-ice-bright"></span>
              <span className="font-label-caps text-[9px] text-on-surface-variant">NDI:</span>
              <span className="font-label-caps text-[9px] text-accent-ice-bright font-bold">ON</span>
            </div>
            <div className="flex items-center gap-space-xs px-2 py-0.5 rounded bg-surface-container border border-border-subtle/50">
              <span className="w-1.5 h-1.5 rounded-full bg-status-ok"></span>
              <span className="font-label-caps text-[9px] text-on-surface-variant">NVENC:</span>
              <span className="font-label-caps text-[9px] text-status-ok-bright font-bold">60FPS</span>
            </div>
            <div className="flex items-center gap-space-xs px-2 py-0.5 rounded bg-surface-container border border-border-subtle/50">
              <span className="w-1.5 h-1.5 rounded-full bg-primary-container"></span>
              <span className="font-label-caps text-[9px] text-on-surface-variant">SRT:</span>
              <span className="font-label-caps text-[9px] text-primary font-bold">LIVE</span>
            </div>
          </div>

          {/* Repositioned Master Clock */}
          <div className="flex items-center gap-space-sm bg-surface-base px-3 py-1 rounded-lg border border-border-subtle shadow-inner">
            <span className="font-label-mono text-label-mono text-outline uppercase">NTP REF</span>
            <span className="font-timecode-display text-[24px] text-on-surface tracking-widest font-bold tabular-nums">
              {ntpTime}
            </span>
            <span className="w-2 h-2 rounded-full bg-status-ok shadow-[0_0_6px_#34C759] animate-pulse"></span>
          </div>

          {/* Badge de Continuidade e Cache 48h (XMirror) */}
          <ContinuityCacheBadge className="hidden xl:inline-flex" />
        </div>

        {/* Right: Nav & User Profile & Quick Dialogs */}
        <div className="flex items-center gap-space-md">
          <nav className="flex items-center gap-space-xs bg-surface-panel p-space-xs rounded border border-border-subtle">
            <button
              onClick={() => onNavigate('master')}
              className={`px-space-md py-1 uppercase transition-colors rounded font-body-sm text-body-sm ${
                activeWorkspace === 'master'
                  ? 'bg-primary-container text-on-primary-container font-bold border border-border-strong'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
              }`}
            >
              Master
            </button>
            <button
              onClick={() => onNavigate('playlist')}
              className={`px-space-md py-1 uppercase transition-colors rounded font-body-sm text-body-sm ${
                activeWorkspace === 'playlist'
                  ? 'bg-primary-container text-on-primary-container font-bold border border-border-strong'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
              }`}
            >
              Playlist
            </button>
            <button
              onClick={() => onNavigate('qc')}
              className={`px-space-md py-1 uppercase transition-colors rounded font-body-sm text-body-sm ${
                activeWorkspace === 'qc'
                  ? 'bg-primary-container text-on-primary-container font-bold border border-border-strong'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
              }`}
            >
              QC
            </button>
            <button
              onClick={() => onNavigate('monitor')}
              className={`px-space-md py-1 uppercase transition-colors rounded font-body-sm text-body-sm ${
                activeWorkspace === 'monitor'
                  ? 'bg-primary-container text-on-primary-container font-bold border border-border-strong'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
              }`}
            >
              Monitor
            </button>
            <button
              onClick={() => onNavigate('aired')}
              className={`px-space-md py-1 uppercase transition-colors rounded font-body-sm text-body-sm ${
                activeWorkspace === 'aired'
                  ? 'bg-primary-container text-on-primary-container font-bold border border-border-strong'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
              }`}
            >
              Aired
            </button>
            <button
              onClick={() => onNavigate('docs')}
              className={`px-space-md py-1 uppercase transition-colors rounded font-body-sm text-body-sm ${
                activeWorkspace === 'docs'
                  ? 'bg-primary-container text-on-primary-container font-bold border border-border-strong'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
              }`}
            >
              Docs
            </button>
          </nav>

          <div className="h-6 w-px bg-border-subtle"></div>

          {/* Sino de Alertas / Notificações */}
          {onOpenAlerts && (
            <button
              onClick={onOpenAlerts}
              className="relative p-1.5 rounded-lg bg-surface-panel hover:bg-surface-container text-outline hover:text-on-surface transition-colors border border-border-subtle"
              title="Problemas e Alertas da Sessão"
            >
              <span className="material-symbols-outlined text-[18px]">notifications</span>
              {problemasCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-on-air-crimson text-[9px] text-surface-base font-bold flex items-center justify-center animate-pulse">
                  {problemasCount}
                </span>
              )}
            </button>
          )}

          {/* Configurações */}
          <button
            onClick={onOpenSettings || (() => onNavigate('settings'))}
            className={`p-1.5 rounded-lg transition-colors border ${
              activeWorkspace === 'settings'
                ? 'bg-primary-container text-on-primary-container border-border-strong font-bold'
                : 'bg-surface-panel hover:bg-surface-container text-outline hover:text-on-surface border-border-subtle'
            }`}
            title="Configurações e Canais"
          >
            <span className="material-symbols-outlined text-[18px]">settings</span>
          </button>

          {/* Operador Master */}
          <div className="flex items-center gap-space-sm pl-space-xs">
            <div className="text-right hidden sm:block">
              <div className="font-body-sm text-body-sm font-semibold text-on-surface leading-none">
                {sessionRole || 'Operador Master'}
              </div>
              <div className="flex items-center justify-end gap-space-xs mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-status-ok"></span>
                <span className="font-label-caps text-[9px] text-outline uppercase">
                  {authRequired ? 'AUTENTICADO' : 'ONLINE'}
                </span>
              </div>
            </div>
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center shadow-sm">
              <span className="material-symbols-outlined text-on-primary text-[18px]">person</span>
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
