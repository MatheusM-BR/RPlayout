import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api.js'

type ProbeStatus = Awaited<ReturnType<typeof api.pgmProbeStatus>>

interface Props {
  channelId: string
  className?: string
  compact?: boolean
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
export function PgmProbeBanner({ channelId, className = '', compact = false, onSlateTriggered }: Props) {
  const [status, setStatus] = useState<ProbeStatus | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const next = await api.pgmProbeStatus(channelId)
      setStatus(next)
      setFailure(null)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Não foi possível ler a sonda PGM.')
    }
  }, [channelId])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 2_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const toggleSlate = async () => {
    setPending(true)
    try {
      const result = await api.setPgmEmergencySlate(channelId, status?.emergencySlateActive ? 'RESET' : 'TRIGGER')
      onSlateTriggered?.(result.emergencySlateActive)
      await refresh()
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Não foi possível alterar o slate de emergência.')
    } finally {
      setPending(false)
    }
  }

  const active = status?.activeAlerts ?? []
  const alert = active[0]
  const telemetryAvailable = Boolean(status?.lastSampleAt)
  const healthy = telemetryAvailable && !alert && !status?.emergencySlateActive
  const stateLabel = failure
    ? 'INDISPONÍVEL'
    : status?.emergencySlateActive
      ? 'SLATE ATIVO'
      : alert
        ? alertName[alert.type]
        : telemetryAvailable
          ? 'PGM: OK'
          : 'AGUARDANDO AMOSTRA'

  if (compact) {
    return (
      <div className={`flex items-center gap-1.5 ${className}`} title={failure ?? 'Telemetria da sonda PGM'}>
        <div className={`flex flex-col items-center justify-center px-2 py-1 rounded border text-center ${healthy ? 'bg-surface-panel border-border-subtle text-status-ok' : 'bg-armed-amber/20 border-armed-amber text-armed-amber'}`}>
          <span className="font-label-caps text-[8.5px] uppercase font-bold leading-none">SONDA</span>
          <span className="font-label-mono text-[9px] font-bold leading-none mt-0.5">{stateLabel}</span>
        </div>
      </div>
    )
  }

  const metrics = status?.metrics
  const thresholds = status?.thresholds
  return (
    <section className={`w-full flex flex-col gap-1.5 ${className}`} aria-label="Sonda de qualidade do PGM">
      {(alert || status?.emergencySlateActive || failure) && (
        <div role="alert" className={`px-3 py-2 rounded-lg border flex flex-wrap items-center justify-between gap-3 ${failure ? 'bg-armed-amber/15 border-armed-amber text-armed-amber' : 'bg-on-air-crimson/15 border-on-air-crimson text-on-air-crimson'}`}>
          <div className="font-label-mono text-[10px]">
            {failure
              ? `Sonda PGM indisponível: ${failure}`
              : status?.emergencySlateActive
                ? 'Slate de emergência marcado como ativo pela sonda.'
                : `${alertName[alert!.type]} acima do limiar: ${seconds(alert!.durationMs)} / ${seconds(alert!.thresholdMs)}.`}
          </div>
          {status && (
            <button disabled={pending} onClick={() => void toggleSlate()} className="px-2.5 py-1 rounded border border-border-subtle bg-surface-panel text-on-surface disabled:opacity-50 font-label-caps text-[9.5px] font-bold">
              {pending ? 'PROCESSANDO…' : status.emergencySlateActive ? 'DESARMAR SLATE' : 'ACIONAR SLATE'}
            </button>
          )}
        </div>
      )}

      <div className="w-full bg-surface-card border border-border-subtle px-3 py-1.5 rounded-lg flex flex-wrap items-center justify-between gap-2 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className={`material-symbols-outlined text-[16px] ${healthy ? 'text-status-ok' : 'text-armed-amber'}`}>troubleshoot</span>
            <span className="font-label-caps text-[10px] text-on-surface font-bold uppercase tracking-wider">Sonda de Qualidade PGM</span>
          </div>
          <div className="h-3.5 w-px bg-border-subtle" />
          <div className="flex items-center gap-3 font-label-mono text-[9.5px]">
            <span>Black: <strong className="text-on-surface">{metrics && thresholds ? `${seconds(metrics.blackDurationMs)} / ${seconds(thresholds.blackThresholdMs)}` : 'N/D'}</strong></span>
            <span>Silêncio: <strong className="text-on-surface">{metrics && thresholds ? `${metrics.audioDbfs?.toFixed(1) ?? 'N/D'} dBFS / ${thresholds.silenceDbfs} dBFS` : 'N/D'}</strong></span>
            <span>Freeze: <strong className="text-on-surface">{metrics && thresholds ? `${seconds(metrics.freezeDurationMs)} / ${seconds(thresholds.freezeThresholdMs)}` : 'N/D'}</strong></span>
          </div>
        </div>
        <span className="font-label-mono text-[9px] text-outline">{telemetryAvailable ? `Amostra: ${new Date(status!.lastSampleAt!).toLocaleTimeString('pt-BR')}` : 'Aguardando medição real do engine'}</span>
      </div>
    </section>
  )
}
