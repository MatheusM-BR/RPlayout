import { useCallback, useEffect, useRef, useState } from 'react'
import { WATCHDOG_DETECTION_LABELS, WATCHDOG_STATE_LABELS, type WatchdogInputStatus, type WatchdogMode, type WatchdogState } from '@rplayout/protocol'
import { api, type LiveWatchdogView } from '../../api.js'
import { confirmAction } from '../../domain/confirm.js'
import { deniedReason, useCan } from '../../domain/permissions.js'
import { LiveWatchdogConfigDialog } from './LiveWatchdogConfigDialog.js'

export const WATCHDOG_MODE_LABELS: Record<WatchdogMode, string> = { OFF: 'DESLIGADO', ALERT_ONLY: 'SÓ ALERTA', AUTOMATIC: 'AUTOMÁTICO' }
const STATE_TONE: Record<WatchdogState, string> = {
  OK: 'text-status-ok-bright border-status-ok/60',
  SUSPEITA: 'text-armed-amber border-armed-amber bg-armed-amber/10',
  ESPERA: 'text-on-air-crimson border-on-air-crimson bg-on-air-crimson/15',
  CONTINGENCIA: 'text-on-surface border-on-air-crimson bg-on-air-crimson/60',
  RETORNO: 'text-primary border-primary bg-primary/10',
}
const seconds = (ms: number | null | undefined, digits = 1) => ms === null || ms === undefined ? '—' : `${(ms / 1000).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })} s`
const number = (value: number | null | undefined, digits = 1) => value === null || value === undefined ? '—' : value.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })

/** Texto curto do que o watchdog está vendo e do que vai fazer. */
export function watchdogDetail(input: WatchdogInputStatus): string {
  const conditions = input.conditions.map(condition => `${WATCHDOG_DETECTION_LABELS[condition.detection]} ${seconds(condition.durationMs)}/${seconds(condition.thresholdMs)}${condition.action === 'ACT' ? '' : ' (alerta)'}`)
  const parts: string[] = []
  if (input.state === 'ESPERA') parts.push(input.waitArtOnAir ? `Arte de espera no ar · contingência em ${seconds(input.waitRemainingMs)}` : `Espera · contingência em ${seconds(input.waitRemainingMs)}`)
  if (input.state === 'CONTINGENCIA') parts.push(!input.contingencyOnAir ? (input.pendingAction === 'ENTER_CONTINGENCY' ? 'Acionando a contingência (vinheta + vídeos)' : 'Contingência sem conteúdo · arte de espera mantida')
    : input.blindReturn ? 'Contingência no PGM · canal sem PVW: retorno por tentativa (só corta com quadro real)' : 'Contingência no PGM · observando a entrada no PVW')
  if (input.state === 'RETORNO') parts.push(input.awaitingOperator ? 'Sinal estável · aguardando "voltar para a live"' : `Sinal voltou · estável há ${seconds(input.stableMs)}`)
  if (input.holdContingency) parts.push('contingência mantida pelo operador')
  if (input.pendingAction) parts.push('aguardando confirmação do engine…')
  if (conditions.length) parts.push(conditions.join(' · '))
  if (input.lastError) parts.push(`Falha: ${input.lastError}`)
  return parts.join(' — ') || 'Sinal íntegro'
}

export function watchdogMetrics(input: WatchdogInputStatus): string {
  const m = input.metrics
  return [
    `fps ${number(m.effectiveFps)}/${number(m.referenceFps, 2)}`,
    `luma ${m.lumaPercent === null ? '—' : number(m.lumaPercent, 0) + '%'}`,
    `áudio ${m.audioDbfs === null ? '—' : number(m.audioDbfs, 0) + ' dBFS'}${m.audioStalledMs ? ' travado' : ''}`,
    `rede ${m.inputKbps === null ? '—' : number(m.inputKbps, 0) + ' kbps'}`,
  ].join(' · ')
}

/**
 * Indicador do watchdog por entrada ao vivo (PGM e PVW), para Master e Monitor.
 * Estado, métricas medidas no engine e os comandos "voltar para a live agora"
 * e "manter contingência". Tudo vem do servidor; nada é simulado aqui.
 */
export function LiveWatchdogStrip({ channelId, compact = false, className = '' }: { channelId: string; compact?: boolean; className?: string }) {
  const [view, setView] = useState<LiveWatchdogView | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [configuring, setConfiguring] = useState(false)
  const canCommand = useCan('TRANSPORT')
  const canConfigure = useCan('OUTPUT_CONTROL')
  const current = useRef(channelId)
  current.current = channelId
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try { const next = await api.liveWatchdog(channelId, signal); if (current.current === channelId) { setView(next); setFailure(null) } }
    catch (error) { if (current.current === channelId && !signal?.aborted) setFailure(error instanceof Error ? error.message : String(error)) }
  }, [channelId])
  useEffect(() => {
    setView(null); setFailure(null)
    const controller = new AbortController()
    void refresh(controller.signal)
    const timer = window.setInterval(() => void refresh(controller.signal), 1000)
    return () => { window.clearInterval(timer); controller.abort() }
  }, [refresh])
  const command = async (action: 'RETURN_NOW' | 'HOLD' | 'RELEASE_HOLD') => {
    if (action === 'RETURN_NOW' && !(await confirmAction('Voltar para a live agora? Com contingência no ar, a entrada é levada ao PGM e o corte só acontece quando o engine confirmar quadro real. Com a arte de espera, ela sai do ar.'))) return
    setPending(true)
    try { await api.liveWatchdogCommand(channelId, action); await refresh() }
    catch (error) { if (current.current === channelId) setFailure(error instanceof Error ? error.message : String(error)) }
    finally { if (current.current === channelId) setPending(false) }
  }
  const mode = view?.policy.mode ?? 'ALERT_ONLY'
  const inputs = view?.inputs ?? []
  // No Master a faixa só ocupa espaço quando há entrada ao vivo para mostrar.
  if (compact && !inputs.length && !failure) return null
  return (
    <section aria-label="Watchdog das entradas ao vivo" className={`w-full flex flex-col gap-1 ${className}`}>
      <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border-subtle bg-surface-card px-3 py-1">
        <span className="material-symbols-outlined text-[18px] text-outline">sensors</span>
        <span className="font-label-caps text-[11px] font-bold uppercase tracking-wider text-on-surface">Watchdog ao vivo</span>
        <span data-testid="watchdog-mode" className={`rounded border px-1.5 py-0.5 font-label-caps text-[11px] font-bold ${mode === 'AUTOMATIC' ? 'border-status-ok/60 text-status-ok-bright' : mode === 'OFF' ? 'border-border-subtle text-outline' : 'border-armed-amber text-armed-amber'}`}>{WATCHDOG_MODE_LABELS[mode]}</span>
        {failure ? <span role="alert" className="min-w-0 flex-1 truncate font-label-mono text-[12px] text-armed-amber">Watchdog indisponível: {failure}</span>
          : !inputs.length ? <span className="min-w-0 flex-1 truncate font-label-mono text-[12px] text-outline">{view ? 'Nenhuma entrada ao vivo no PGM ou PVW agora.' : 'Consultando…'}{view && !view.nativeEngine ? ' Canal sem engine nativo: sem medição.' : ''}</span>
          : <span className="min-w-0 flex-1" />}
        <button type="button" className="shrink-0 rounded border border-border-subtle px-2 py-0.5 text-[11px] font-label-caps font-bold disabled:opacity-50" disabled={!canConfigure}
          title={canConfigure ? 'Limiares, tempos, arte de espera e contingência' : deniedReason('configurar o watchdog')} onClick={() => setConfiguring(true)}>CONFIGURAR</button>
      </div>
      {inputs.map(input => {
        const intervening = input.bus === 'pgm' && (input.state === 'ESPERA' || input.state === 'CONTINGENCIA' || input.state === 'RETORNO')
        const detail = watchdogDetail(input)
        return (
          <div key={input.bus + input.sourceKey} data-testid="watchdog-input" data-state={input.state}
            className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-1 ${input.state === 'OK' ? 'border-border-subtle bg-surface-card' : input.state === 'SUSPEITA' ? 'border-armed-amber/60 bg-armed-amber/5' : 'border-on-air-crimson/70 bg-on-air-crimson/10'}`}>
            <span className={`rounded px-1.5 py-0.5 font-label-caps text-[11px] font-bold ${input.bus === 'pgm' ? 'bg-on-air-crimson text-white' : 'bg-status-ok/30 text-on-surface'}`}>{input.bus.toUpperCase()}</span>
            <span className="max-w-[16rem] truncate font-label-caps text-[12px] font-bold text-on-surface" title={input.name}>{input.name}{input.kind ? <span className="ml-1 font-normal text-outline">{input.kind}</span> : null}</span>
            <span data-testid="watchdog-state" className={`rounded border px-1.5 py-0.5 font-label-caps text-[11px] font-bold ${STATE_TONE[input.state]}`}>{WATCHDOG_STATE_LABELS[input.state]}</span>
            <span className={`min-w-[12rem] flex-1 ${compact ? 'truncate' : ''} font-label-mono text-[12px] ${input.state === 'OK' ? 'text-outline' : 'text-on-surface'}`} title={detail}>{detail}</span>
            <span className="shrink-0 font-label-mono text-[12px] text-outline" data-testid="watchdog-metrics">{watchdogMetrics(input)}</span>
            {intervening && <span className="flex shrink-0 gap-1.5">
              <button type="button" disabled={pending || !canCommand || Boolean(input.pendingAction)} title={canCommand ? 'Leva a entrada ao vivo de volta ao PGM agora' : deniedReason('comandar o watchdog')}
                className="rounded border border-status-ok px-2 py-0.5 font-label-caps text-[11px] font-bold text-status-ok-bright disabled:opacity-50" onClick={() => void command('RETURN_NOW')}>VOLTAR PARA A LIVE AGORA</button>
              {input.contingencyOnAir && <button type="button" disabled={pending || !canCommand} title={canCommand ? 'Sem retorno automático até alguém pedir' : deniedReason('comandar o watchdog')}
                className="rounded border border-armed-amber px-2 py-0.5 font-label-caps text-[11px] font-bold text-armed-amber disabled:opacity-50" onClick={() => void command(input.holdContingency ? 'RELEASE_HOLD' : 'HOLD')}>{input.holdContingency ? 'LIBERAR RETORNO AUTOMÁTICO' : 'MANTER CONTINGÊNCIA'}</button>}
            </span>}
          </div>
        )
      })}
      {!compact && view && view.events.length > 0 && (
        <details className="rounded border border-border-subtle bg-surface-panel px-3 py-1 text-[12px]">
          <summary className="cursor-pointer font-label-caps text-[11px] text-outline">Últimos eventos do watchdog ({view.events.length})</summary>
          <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto font-label-mono">
            {view.events.map((event, index) => <li key={index} className="text-on-surface-variant"><span className="text-outline">{new Date(event.at).toLocaleTimeString('pt-BR')}</span> {event.message}</li>)}
          </ul>
        </details>
      )}
      {configuring && <LiveWatchdogConfigDialog channelId={channelId} onClose={() => setConfiguring(false)} onSaved={() => void refresh()} />}
    </section>
  )
}
