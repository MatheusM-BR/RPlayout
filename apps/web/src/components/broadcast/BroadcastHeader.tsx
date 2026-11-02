import { useState, useEffect } from 'react'
import type { Channel } from '@rplayout/protocol'
import type { WorkspaceId } from '../WorkspaceShell.js'
import { formatStandardRate } from '../../format.js'
import { ContinuityCacheBadge } from './ContinuityCacheBadge.js'
import { useAirState } from '../../domain/air-state.js'
import { HeaderHealth } from './HeaderHealth.js'
import { clockLevel, useClockOffset } from '../../domain/clock-offset.js'
import { PROFILES, PROFILE_IDS, defaultProfileFor, navWorkspaces, profileShowsSettings, type ProfileId } from '../../domain/profiles.js'
import { useStoredChoice } from '../../domain/stored-choice.js'

const WORKSPACE_LABEL: Partial<Record<WorkspaceId, string>> = { master: 'Master', playlist: 'Playlist', qc: 'QC', monitor: 'Monitor', aired: 'Aired', docs: 'Docs', audit: 'Auditoria', users: 'Usuários' }

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
  isLiveOnAir,
  onOpenAlerts,
  onOpenSettings,
  onOpenLiveInput,
}: Props) {
  // Telas que não recebem o transporte usam o estado do ar compartilhado.
  const sharedAir = useAirState()
  isLiveOnAir = isLiveOnAir ?? sharedAir ?? undefined
  const [channelDropdownOpen, setChannelDropdownOpen] = useState(false)
  const [profile, setProfile] = useStoredChoice<ProfileId>('rplayout.profile', PROFILE_IDS, defaultProfileFor(sessionRole))
  const profileInfo = PROFILES.find(entry => entry.id === profile) ?? PROFILES[PROFILES.length - 1]!
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const profileSelect = (
    <select
      aria-label="Perfil de navegação desta estação"
      title="Perfil: escolhe quais telas aparecem no menu desta estação. Não altera permissões."
      value={profile}
      onChange={event => { setProfile(event.target.value as ProfileId); setProfileMenuOpen(false) }}
      className="w-auto bg-transparent font-label-caps text-[11px] text-outline uppercase border-0 p-0 pr-1 cursor-pointer hover:text-on-surface focus:outline-none"
    >
      {PROFILES.map(entry => <option key={entry.id} value={entry.id} title={entry.description}>{entry.label}</option>)}
    </select>
  )
  const rate = channel.rate
  const fps = rate.num / rate.den
  const offset = useClockOffset()
  const clock = clockLevel(offset)
  const clockTitle = !offset ? 'Hora local desta estação (comparação com o servidor ainda não medida)'
    : `Hora local desta estação. Diferença para o servidor: ${offset.offsetMs > 0 ? '+' : '−'}${(Math.abs(offset.offsetMs) / 1000).toFixed(1)} s${clock === 'ok' ? '' : ' — acerte o relógio do Windows (sincronizar agora); as contagens de horário desta tela usam este relógio.'}`

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
    <header className="w-full shrink-0 z-40 bg-surface-card border-b border-border-subtle select-none">
      <div className="min-h-16 px-margin py-1 lg:py-0 lg:h-16 flex flex-wrap lg:flex-nowrap items-center justify-between gap-x-3 2xl:gap-x-gutter gap-y-1">
        {/* Left: Logo + Spacious Channel Selector */}
        <div className="order-1 flex items-center gap-2 2xl:gap-space-lg min-w-0">
          <div className="flex items-center gap-space-sm cursor-pointer" onClick={() => onNavigate('master')}>
            <span className="font-headline-md text-headline-md tracking-wider text-accent-ice uppercase font-bold text-[22px] flex items-center gap-1.5">
              <span className="material-symbols-outlined text-accent-ice text-[24px]">play_circle</span>
              <span className="hidden sm:inline">RPlayout</span>
            </span>
            {isLiveOnAir === undefined ? (
              <span className="px-2 py-0.5 rounded-full bg-surface-container border border-border-subtle text-outline text-[11px] whitespace-nowrap">PGM: N/D</span>
            ) : isLiveOnAir ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-on-air-crimson/20 border border-on-air-crimson/40 text-on-air-crimson font-label-caps text-[11px] font-bold tracking-wider whitespace-nowrap shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-on-air-crimson animate-pulse"></span> NO AR
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-container border border-border-subtle text-outline font-label-caps text-[11px] font-bold tracking-wider whitespace-nowrap shrink-0">
                <span className="material-symbols-outlined text-[12px] text-armed-amber">pause</span> PARADO
              </span>
            )}
          </div>

          <div className="hidden md:block h-8 w-px bg-border-subtle"></div>

          {/* Spacious Channel Selector Dropdown */}
          <div className="relative min-w-0">
            <div
              onClick={() => setChannelDropdownOpen(!channelDropdownOpen)}
              className="flex items-center gap-2 bg-surface-panel px-2 2xl:px-3 py-1.5 rounded-lg border border-border-subtle hover:border-border-strong cursor-pointer transition-colors shadow-sm min-w-0"
              title="Selecionar Canal de Exibição"
            >
              <span className="material-symbols-outlined text-accent-ice text-[20px] hidden md:inline">tv</span>
              <div className="flex flex-col min-w-0">
                <span className="font-body-md text-body-md font-semibold text-on-surface leading-tight truncate max-w-[120px] sm:max-w-[180px] 2xl:max-w-[260px]" title={channel.name}>
                  {channel.name || 'Canal 1 - TV Principal HD'}
                </span>
                <span className="font-label-mono text-[12px] text-outline leading-tight truncate hidden 2xl:block">
                  {formatStandardRate(channel.rate, channel.scan, channel.height)} • Master Principal
                </span>
              </div>
              <span className="material-symbols-outlined text-outline text-[18px]">expand_more</span>
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
                    <span className="font-label-mono text-[12px] opacity-75">
                      {formatStandardRate(ch.rate, ch.scan, ch.height)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Center: Stacked SDI/NDI/NVENC/SRT Badge Grid & Master Clock */}
        <div className="order-2 flex items-center gap-2 2xl:gap-space-xl">
          {/* Saúde real: engine, saídas, disco, alertas */}
          <HeaderHealth channelId={channel.id} onClick={onOpenLiveInput} />

          {/* Repositioned Master Clock */}
          <div className={`flex items-center gap-2 bg-surface-base px-2 2xl:px-3 py-1 rounded-lg border shadow-inner ${clock === 'bad' ? 'border-on-air-crimson' : clock === 'warn' ? 'border-armed-amber' : 'border-border-subtle'}`} title={clockTitle}>
            <span className="hidden 2xl:inline font-label-mono text-label-mono text-outline uppercase">HORA LOCAL</span>
            <span className="font-timecode-display text-[17px] sm:text-[20px] 2xl:text-[24px] text-on-surface tracking-wider 2xl:tracking-widest font-bold tabular-nums">
              {ntpTime}
            </span>
            <span aria-hidden="true" className={`w-2 h-2 rounded-full ${clock === 'ok' ? 'bg-status-ok shadow-[0_0_6px_#34C759]' : clock === 'warn' ? 'bg-armed-amber' : clock === 'bad' ? 'bg-on-air-crimson animate-pulse motion-reduce:animate-none' : 'bg-outline'}`}></span>
            {(clock === 'warn' || clock === 'bad') && offset && <span className={`font-label-mono text-[11px] font-bold ${clock === 'bad' ? 'text-on-air-crimson' : 'text-armed-amber'}`}>{offset.offsetMs > 0 ? '+' : '−'}{(Math.abs(offset.offsetMs) / 1000).toFixed(1)}s</span>}
          </div>

          {/* Badge de Continuidade e Cache 48h (XMirror) */}
          <ContinuityCacheBadge className="hidden 2xl:inline-flex" channelId={channel.id} />
        </div>

        {/* Navegação: segunda linha em telas estreitas, rolável */}
          <nav className="order-4 lg:order-3 w-full lg:w-auto lg:ml-auto flex items-center gap-space-xs bg-surface-panel p-space-xs rounded border border-border-subtle overflow-x-auto" aria-label={`Telas do perfil ${profileInfo.label}`}>
            {navWorkspaces(profile, activeWorkspace).map(id => (
              <button
                key={id}
                onClick={() => onNavigate(id)}
                aria-current={activeWorkspace === id ? 'page' : undefined}
                className={`shrink-0 px-2 2xl:px-space-md py-1.5 lg:py-1 uppercase transition-colors rounded font-body-sm text-body-sm ${
                  activeWorkspace === id
                    ? 'bg-primary-container text-on-primary-container font-bold border border-border-strong'
                    : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
                }`}
              >
                {WORKSPACE_LABEL[id] ?? id}
              </button>
            ))}
          </nav>

        {/* Right: User Profile & Quick Dialogs */}
        <div className="order-3 lg:order-4 flex items-center gap-2 2xl:gap-space-md">


          {/* Sino de Alertas / Notificações */}
          {onOpenAlerts && (
            <button
              onClick={onOpenAlerts}
              className="relative p-1.5 rounded-lg bg-surface-panel hover:bg-surface-container text-outline hover:text-on-surface transition-colors border border-border-subtle"
              title="Problemas e Alertas da Sessão"
            >
              <span className="material-symbols-outlined text-[18px]">notifications</span>
              {problemasCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-on-air-crimson text-[11px] text-surface-base font-bold flex items-center justify-center animate-pulse">
                  {problemasCount}
                </span>
              )}
            </button>
          )}

          {/* Configurações (perfis Engenharia e Completo) */}
          {(profileShowsSettings(profile) || activeWorkspace === 'settings') && <button
            onClick={onOpenSettings || (() => onNavigate('settings'))}
            className={`p-1.5 rounded-lg transition-colors border ${
              activeWorkspace === 'settings'
                ? 'bg-primary-container text-on-primary-container border-border-strong font-bold'
                : 'bg-surface-panel hover:bg-surface-container text-outline hover:text-on-surface border-border-subtle'
            }`}
            title="Configurações e Canais"
          >
            <span className="material-symbols-outlined text-[18px]">settings</span>
          </button>}

          {/* Operador e perfil: em telas largas o perfil fica à vista; nas demais,
              no menu do avatar (o cabeçalho não corta a navegação). */}
          <div className="relative flex items-center gap-space-sm pl-space-xs">
            <div className="hidden 2xl:block text-right">
              <div className="font-body-sm text-body-sm font-semibold text-on-surface leading-none">
                {sessionRole || 'Operador Master'}
              </div>
              <div className="flex items-center justify-end gap-space-xs mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-status-ok" title={authRequired ? 'Sessão autenticada' : 'Acesso local (sem login)'}></span>
                {profileSelect}
              </div>
            </div>
            <button type="button" onClick={() => setProfileMenuOpen(value => !value)} aria-expanded={profileMenuOpen}
              className="w-8 h-8 rounded-full bg-primary flex items-center justify-center shadow-sm" title={`${sessionRole || 'Operador'} · perfil ${profileInfo.label}`}>
              <span className="material-symbols-outlined text-on-primary text-[18px]">person</span>
            </button>
            {profileMenuOpen && (
              <div className="absolute right-0 top-full mt-2 w-60 z-50 rounded-lg border border-border-strong bg-surface-card p-3 shadow-2xl grid gap-2 text-[12px]">
                <div className="font-semibold text-on-surface">{sessionRole || 'Operador'}</div>
                <div className="text-outline">{authRequired ? 'Sessão autenticada' : 'Acesso local (sem login)'}</div>
                <label className="grid gap-1 text-outline">Perfil desta estação{profileSelect}</label>
                <p className="text-[11px] text-outline">Escolhe as telas do menu; não altera permissões.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
