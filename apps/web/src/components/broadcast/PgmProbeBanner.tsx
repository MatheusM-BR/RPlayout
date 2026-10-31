import { confirmAction } from '../../domain/confirm.js'
import { deniedReason, useCan } from '../../domain/permissions.js'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../api.js'
import { ContingencyLoopPanel } from './ContingencyLoopPanel.js'

type ProbeStatus = Awaited<ReturnType<typeof api.pgmProbeStatus>>

interface Props {
  channelId: string
  className?: string
  compact?: boolean
  /** Master mostra a contingência na aba de ferramentas (ContingencyTool). */
  showContingency?: boolean
  onSlateTriggered?: (active: boolean) => void
}

const alertName: Record<ProbeStatus['activeAlerts'][number]['type'], string> = {
  BLACK_FRAME: 'BLACK FRAME',
  SILENCE: 'SILÊNCIO',
  FREEZE_FRAME: 'CONGELAMENTO',
}

function seconds(ms: number) {
  return `${(ms / 1_000).toFixed(1)}s`
}

/**
 * Única apresentação da sonda PGM. Todo estado vem do processo do servidor;
 * esta tela nunca simula frames, áudio, alarmes ou a troca para slate.
 */
export function PgmProbeBanner({ channelId, className = '', compact = false, showContingency = true, onSlateTriggered }: Props) {
  const [status, setStatus] = useState<ProbeStatus | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  // Recusa do slate fica na tela até o operador fechar ou acionar de novo: a
  // leitura periódica da sonda limpava `failure` em 2 s e o 409 sumia.
  const [slateError, setSlateError] = useState<string | null>(null)
  const canAcknowledge = useCan('CHANNEL_STOP')
  const canPolicy = useCan('OUTPUT_CONTROL')
  const currentChannel = useRef(channelId)
  currentChannel.current = channelId

  const refresh = useCallback(async () => {
    try {
      const next = await api.pgmProbeStatus(channelId)
      if (currentChannel.current !== channelId) return
      setStatus(next)
      setFailure(null)
    } catch (error) {
      if (currentChannel.current !== channelId) return
      setFailure(error instanceof Error ? error.message : 'Não foi possível ler a sonda PGM.')
    }
  }, [channelId])

  useEffect(() => {
    setStatus(null); setFailure(null); setPending(false)
    void refresh()
    const timer = window.setInterval(() => void refresh(), 2_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const toggleSlate = async () => {
    setPending(true)
    setSlateError(null)
    try {
      const result = await api.setPgmEmergencySlate(channelId, status?.emergencySlateActive ? 'RESET' : 'TRIGGER')
      if (currentChannel.current !== channelId) return
      onSlateTriggered?.(result.emergencySlateActive)
      await refresh()
    } catch (error) {
      if (currentChannel.current === channelId) setSlateError(error instanceof Error ? error.message : 'Não foi possível alterar o slate de emergência.')
    } finally {
      if (currentChannel.current === channelId) setPending(false)
    }
  }

  const active = status?.activeAlerts ?? []
  const toggleAutomation = async () => {
    if (!status) return
    const enabled = !status.automaticActionsEnabled
    if (enabled && !(await confirmAction('Autorizar a sonda a intervir no PGM conforme a política selecionada? A ação exige engine real e configuração verificada. O retorno da contingência é manual.'))) return
    setPending(true)
    try { await api.setPgmProbePolicy(channelId, enabled); await refresh() }
    catch (error) { if (currentChannel.current === channelId) setFailure(error instanceof Error ? error.message : String(error)) }
    finally { if (currentChannel.current === channelId) setPending(false) }
  }
  const alert = active[0]
  // "Ciente" reconhece no servidor os alertas de sinal pendentes do canal (para
  // os lembretes externos) e recolhe a faixa vermelha; ela volta se surgir
  // outro tipo de alerta ou se este sumir e voltar.
  const alertKey = alert ? `${alert.type}` : null
  const [acknowledgedKey, setAcknowledgedKey] = useState<string | null>(null)
  useEffect(() => { if (!alertKey) setAcknowledgedKey(null) }, [alertKey])
  const acknowledge = async () => {
    if (!alertKey) return
    setPending(true)
    try {
      const pendingEvents = await api.healthEvents(channelId, { acknowledgement: 'PENDING' })
      await Promise.all(pendingEvents.events.filter(event => event.component === 'SIGNAL' && !event.resolvedAt).map(event => api.acknowledgeHealth(event.id)))
      if (currentChannel.current === channelId) setAcknowledgedKey(alertKey)
    } catch (error) {
      if (currentChannel.current === channelId) setFailure(error instanceof Error ? error.message : 'Não foi possível registrar o ciente.')
    } finally { if (currentChannel.current === channelId) setPending(false) }
  }
  const showAlertBanner = Boolean(failure || status?.emergencySlateActive || (alert && acknowledgedKey !== alertKey))
  const telemetryAvailable = Boolean(status?.lastSampleAt)
  const healthy = telemetryAvailable && !alert && !status?.emergencySlateActive && !status?.contingency?.active
  const stateLabel = failure
    ? 'INDISPONÍVEL'
    : status?.emergencySlateActive
      ? 'SLATE ATIVO'
      : status?.contingency?.active
        ? 'LOOP NO PGM'
      : alert
        ? alertName[alert.type]
        : telemetryAvailable
          ? 'PGM: OK'
          : 'AGUARDANDO AMOSTRA'

  if (compact) {
    return (
      <div className={`flex items-center gap-1.5 ${className}`} title={failure ?? 'Telemetria da sonda PGM'}>
        <div className={`flex flex-col items-center justify-center px-2 py-1 rounded border text-center ${healthy ? 'bg-surface-panel border-border-subtle text-status-ok' : 'bg-armed-amber/20 border-armed-amber text-armed-amber'}`}>
          <span className="font-label-caps text-[11px] uppercase font-bold leading-none">SONDA</span>
          <span className="font-label-mono text-[12px] font-bold leading-none mt-0.5">{stateLabel}</span>
        </div>
      </div>
    )
  }

  const metrics = status?.metrics
  const thresholds = status?.thresholds
  // Faixa de altura fixa (U5): alerta e telemetria dividem a mesma linha, o
  // layout não pula quando um alerta surge ou some.
  const tone = failure ? 'warn' : showAlertBanner ? 'bad' : healthy ? 'ok' : 'idle'
  const rowTone = { ok: 'bg-surface-card border-border-subtle', idle: 'bg-surface-card border-border-subtle', warn: 'bg-armed-amber/15 border-armed-amber', bad: 'bg-on-air-crimson/15 border-on-air-crimson' }[tone]
  const chipTone = { ok: 'text-status-ok-bright border-status-ok/50', idle: 'text-outline border-border-subtle', warn: 'text-armed-amber border-armed-amber', bad: 'text-on-air-crimson border-on-air-crimson' }[tone]
  const message = failure
    ? `Sonda PGM indisponível: ${failure}`
    : status?.emergencySlateActive
      ? 'Slate de emergência confirmado pelo engine.'
      : alert && showAlertBanner
        ? `${alertName[alert.type]} acima do limiar: ${seconds(alert.durationMs)} / ${seconds(alert.thresholdMs)}. ${alert.actionMessage ?? ''}`
        : null
  return (
    <section className={`w-full flex flex-col gap-1.5 ${className}`} aria-label="Sonda de qualidade do PGM">
      <div role={message ? 'alert' : undefined} className={`w-full h-9 border px-3 rounded-lg flex items-center gap-3 overflow-hidden ${rowTone}`}>
        <span className={`material-symbols-outlined text-[18px] shrink-0 ${tone === 'ok' ? 'text-status-ok' : tone === 'idle' ? 'text-outline' : tone === 'warn' ? 'text-armed-amber' : 'text-on-air-crimson'}`}>troubleshoot</span>
        <span className="font-label-caps text-[11px] text-on-surface font-bold uppercase tracking-wider shrink-0">Sonda PGM</span>
        <span className={`shrink-0 px-1.5 py-0.5 rounded border font-label-caps text-[11px] font-bold ${chipTone}`}>{alert && acknowledgedKey === alertKey ? `${alertName[alert.type]} · CIENTE` : stateLabel}</span>
        {message
          ? <span className={`min-w-0 flex-1 truncate font-label-mono text-[12px] ${tone === 'warn' ? 'text-armed-amber' : 'text-on-air-crimson'}`} title={message}>{message}</span>
          : <span className="min-w-0 flex-1 truncate font-label-mono text-[12px] text-outline">
              Black <strong className="text-on-surface">{metrics && thresholds ? `${seconds(metrics.blackDurationMs)} / ${seconds(thresholds.blackThresholdMs)}` : '—'}</strong>
              {'  ·  '}Silêncio <strong className="text-on-surface">{metrics && thresholds ? `${metrics.audioDbfs?.toFixed(1) ?? '—'} / ${thresholds.silenceDbfs} dBFS` : '—'}</strong>
              {'  ·  '}Freeze <strong className="text-on-surface">{metrics && thresholds ? `${seconds(metrics.freezeDurationMs)} / ${seconds(thresholds.freezeThresholdMs)}` : '—'}</strong>
            </span>}
        <span className="shrink-0 font-label-mono text-[12px] text-outline hidden 2xl:inline">{telemetryAvailable ? `Amostra ${new Date(status!.lastSampleAt!).toLocaleTimeString('pt-BR')}` : 'Aguardando medição do engine'}</span>
        {status && alert && showAlertBanner && !status.emergencySlateActive && !failure && (
          <button disabled={pending || !canAcknowledge} title={canAcknowledge ? 'Registrar que o alerta foi visto (para os lembretes externos)' : deniedReason('registrar ciente de incidentes')} onClick={() => void acknowledge()} className="shrink-0 px-2.5 py-1 rounded border border-on-air-crimson bg-surface-panel text-on-surface disabled:opacity-50 font-label-caps text-[11px] font-bold">
            CIENTE
          </button>
        )}
        {status && showAlertBanner && (
          <button disabled={pending} onClick={() => void toggleSlate()} className="shrink-0 px-2.5 py-1 rounded border border-border-subtle bg-surface-panel text-on-surface disabled:opacity-50 font-label-caps text-[11px] font-bold">
            {pending ? 'PROCESSANDO…' : status.emergencySlateActive ? 'DESARMAR SLATE' : 'ACIONAR SLATE'}
          </button>
        )}
        {status && <button type="button" disabled={pending || !canPolicy} onClick={() => void toggleAutomation()} className="shrink-0 text-[11px] px-2 py-1 rounded border border-border-subtle disabled:opacity-60" title={canPolicy ? 'Intervenção automática da sonda no PGM' : deniedReason('mudar a intervenção automática')}>
          {status.automaticActionsEnabled ? 'AUTO: LIGADA' : 'AUTO: DESLIGADA'}
        </button>}
      </div>
      {slateError && <SlateRefusal message={slateError} onClose={() => setSlateError(null)} />}
      {showContingency && status && <ContingencyLoopPanel channelId={channelId} status={status} onChanged={refresh} />}
    </section>
  )
}

/** Pede ao App para abrir Grafismo & Artes (onde se escolhe a apresentação técnica). */
export function openGraphicsSettings(): void { window.dispatchEvent(new CustomEvent('rplayout:open-graphics')) }

/** Motivo da recusa do slate, com o caminho para resolver (A5). */
function SlateRefusal({ message, onClose }: { message: string; onClose: () => void }) {
  const missingArt = /arte|apresenta/i.test(message)
  return (
    <div role="alert" className="w-full border border-armed-amber bg-armed-amber/15 px-3 py-1.5 rounded-lg flex items-center gap-3 text-[12px]">
      <span className="font-label-caps font-bold text-armed-amber shrink-0">SLATE NÃO ACIONADO</span>
      <span className="min-w-0 flex-1 text-on-surface">{message}</span>
      {missingArt && <button type="button" onClick={openGraphicsSettings} className="shrink-0 px-2.5 py-1 rounded border border-armed-amber text-armed-amber font-label-caps text-[11px] font-bold">CONFIGURAR ARTE</button>}
      <button type="button" onClick={onClose} aria-label="Fechar aviso do slate" className="shrink-0 px-2 py-1 rounded border border-border-subtle text-outline">✕</button>
    </div>
  )
}

/** Contingência e retorno como ferramenta do Master (fora da faixa do ar). */
export function ContingencyTool({ channelId, slateConfigured }: { channelId: string; slateConfigured?: boolean }) {
  const [status, setStatus] = useState<ProbeStatus | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    try { setStatus(await api.pgmProbeStatus(channelId)); setFailure(null) }
    catch (error) { setFailure(error instanceof Error ? error.message : 'Não foi possível ler a sonda PGM.') }
  }, [channelId])
  useEffect(() => {
    setStatus(null)
    void refresh()
    const timer = window.setInterval(() => void refresh(), 5_000)
    return () => window.clearInterval(timer)
  }, [refresh])
  if (failure) return <p role="alert" className="text-[12px] text-armed-amber">{failure}</p>
  if (!status) return <p className="text-[12px] text-outline">Consultando…</p>
  return <ContingencyLoopPanel channelId={channelId} status={status} onChanged={refresh} slateConfigured={slateConfigured} defaultOpen />
}
