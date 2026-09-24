import { useState } from 'react'

export interface PgmProbeIncident {
  type: 'BLACK_FRAME' | 'SILENCE' | 'FREEZE_FRAME'
  durationSeconds: number
  thresholdSeconds: number
  detectedAt: string
}

interface Props {
  className?: string
  compact?: boolean
  onSlateTriggered?: (active: boolean) => void
}

export function PgmProbeBanner({ className = '', compact = false, onSlateTriggered }: Props) {
  // Estado do Slate de Emergência
  const [isEmergencySlateActive, setIsEmergencySlateActive] = useState(false)
  // Incidente simulado / detectado
  const [currentIncident, setCurrentIncident] = useState<PgmProbeIncident | null>(null)
  // Simulação / Teste rápido para validação de bancada MCR
  const [isSimulating, setIsSimulating] = useState(false)

  const handleTriggerSlate = () => {
    const nextState = !isEmergencySlateActive
    setIsEmergencySlateActive(nextState)
    if (onSlateTriggered) onSlateTriggered(nextState)
  }

  const handleSimulateAlarm = (type: 'BLACK_FRAME' | 'SILENCE' | 'FREEZE_FRAME') => {
    setIsSimulating(true)
    const threshold = type === 'SILENCE' ? 3.0 : 2.0
    setCurrentIncident({
      type,
      durationSeconds: threshold + 0.4,
      thresholdSeconds: threshold,
      detectedAt: new Date().toLocaleTimeString('pt-BR'),
    })
  }

  const handleResetAlarm = () => {
    setCurrentIncident(null)
    setIsSimulating(false)
    setIsEmergencySlateActive(false)
    if (onSlateTriggered) onSlateTriggered(false)
  }

  // Se estiver em modo compacto (ex: embutido no monitor ou cabeçalho)
  if (compact) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        {/* Indicador de status do Watchdog */}
        <div
          className={`flex items-center gap-1.5 px-2 py-0.5 rounded border text-[9.5px] font-label-mono ${
            isEmergencySlateActive
              ? 'bg-on-air-crimson/20 border-on-air-crimson text-on-air-crimson animate-pulse font-bold'
              : currentIncident
              ? 'bg-armed-amber/20 border-armed-amber text-armed-amber animate-pulse'
              : 'bg-surface-panel border-border-subtle text-status-ok'
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              isEmergencySlateActive ? 'bg-on-air-crimson' : currentIncident ? 'bg-armed-amber' : 'bg-status-ok'
            }`}
          ></span>
          <span>
            {isEmergencySlateActive
              ? 'SLATE NO AR'
              : currentIncident
              ? `ALERTA: ${currentIncident.type}`
              : 'SONDA PGM: OK'}
          </span>
        </div>

        {/* Botão de Disparo / Desarme do Slate */}
        <button
          onClick={handleTriggerSlate}
          className={`px-2 py-0.5 rounded font-label-caps text-[9px] font-bold transition-all cursor-pointer border ${
            isEmergencySlateActive
              ? 'bg-on-air-crimson text-white border-on-air-glow shadow-sm'
              : 'bg-surface-panel hover:bg-on-air-crimson/20 text-outline hover:text-on-air-crimson border-border-subtle hover:border-on-air-crimson/40'
          }`}
          title={isEmergencySlateActive ? 'Clique para retirar slate de emergência do PGM' : 'Disparo manual do Slate de Emergência'}
        >
          {isEmergencySlateActive ? 'DESARMAR SLATE' : 'SLATE EMERGÊNCIA'}
        </button>
      </div>
    )
  }

  // Banner Proeminente de Sonda PGM (Master Control & Engineering)
  return (
    <div className={`w-full flex flex-col gap-1.5 ${className}`}>
      {/* Banner de Incidente ou Slate Ativo */}
      {(currentIncident || isEmergencySlateActive) && (
        <div
          className={`w-full px-3 py-2 rounded-lg border flex flex-wrap items-center justify-between gap-3 shadow-lg animate-in fade-in duration-150 ${
            isEmergencySlateActive
              ? 'bg-gradient-to-r from-on-air-crimson/30 via-on-air-crimson/20 to-surface-card border-on-air-crimson'
              : 'bg-gradient-to-r from-armed-amber/25 via-armed-amber/15 to-surface-card border-armed-amber'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <span
              className={`material-symbols-outlined text-[22px] animate-bounce ${
                isEmergencySlateActive ? 'text-on-air-crimson' : 'text-armed-amber'
              }`}
            >
              {isEmergencySlateActive ? 'emergency_home' : 'warning'}
            </span>
            <div>
              <div className="flex items-center gap-2">
                <span
                  className={`font-label-caps text-[11px] font-bold tracking-wider uppercase ${
                    isEmergencySlateActive ? 'text-on-air-crimson' : 'text-armed-amber'
                  }`}
                >
                  {isEmergencySlateActive
                    ? 'SLATE DE EMERGÊNCIA INSTITUCIONAL ATIVO NO PGM'
                    : `WATCHDOG PGM DISPARADO: ${
                        currentIncident?.type === 'BLACK_FRAME'
                          ? 'BLACK FRAME (> 2.0s)'
                          : currentIncident?.type === 'SILENCE'
                          ? 'SILÊNCIO DE ÁUDIO (> 3.0s)'
                          : 'CONGELAMENTO DE VÍDEO (FREEZE)'
                      }`}
                </span>
                <span className="font-label-mono text-[9px] px-1.5 py-0.2 rounded bg-black/40 text-outline border border-border-subtle">
                  {currentIncident ? `Detectado às ${currentIncident.detectedAt}` : 'Disparo Manual'}
                </span>
              </div>
              <span className="font-label-mono text-[10px] text-on-surface-variant block">
                {isEmergencySlateActive
                  ? 'Transmissão comutada para o gráfico de contingência 1080p50 com áudio filler em loop.'
                  : `Limiar técnico de tolerância excedido (${currentIncident?.durationSeconds.toFixed(1)}s > ${currentIncident?.thresholdSeconds.toFixed(1)}s). Ação preventiva armada.`}
              </span>
            </div>
          </div>

          {/* Botões de Ação Imediata do Diretor de Master */}
          <div className="flex items-center gap-2">
            {!isEmergencySlateActive && (
              <button
                onClick={handleTriggerSlate}
                className="px-3 py-1.5 rounded-lg bg-on-air-crimson hover:bg-on-air-glow text-white font-headline-md text-[11px] font-bold uppercase tracking-wide shadow transition-all cursor-pointer flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[15px]">emergency</span>
                <span>INJETAR SLATE AGORA</span>
              </button>
            )}

            <button
              onClick={handleResetAlarm}
              className="px-3 py-1.5 rounded-lg bg-surface-panel hover:bg-surface-container border border-border-subtle hover:border-border-strong text-on-surface font-label-caps text-[10px] font-bold uppercase transition-all cursor-pointer flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-[14px]">restart_alt</span>
              <span>RESETAR ALARME / RETOMAR PGM</span>
            </button>
          </div>
        </div>
      )}

      {/* Faixa técnica de monitoramento contínuo da Sonda PGM */}
      <div className="w-full bg-surface-card border border-border-subtle px-3 py-1.5 rounded-lg flex flex-wrap items-center justify-between gap-2 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-accent-ice text-[16px]">troubleshoot</span>
            <span className="font-label-caps text-[10px] text-on-surface font-bold uppercase tracking-wider">
              Sonda de Qualidade PGM (Watchdog)
            </span>
          </div>

          <div className="h-3.5 w-px bg-border-subtle"></div>

          {/* Três Métricas em Linha */}
          <div className="flex items-center gap-3 font-label-mono text-[9.5px]">
            {/* Black Frame */}
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-status-ok"></span>
              <span className="text-outline">Black:</span>
              <span className="text-status-ok font-semibold">0.0s (&lt; 2.0s)</span>
            </div>

            {/* Silêncio */}
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-status-ok"></span>
              <span className="text-outline">Silêncio:</span>
              <span className="text-status-ok font-semibold">-24 LUFS (&lt; 3.0s)</span>
            </div>

            {/* Freeze Frame */}
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-status-ok"></span>
              <span className="text-outline">Freeze:</span>
              <span className="text-status-ok font-semibold">0.0% SAD OK</span>
            </div>
          </div>
        </div>

        {/* Botões Táticos de Controle e Teste */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleTriggerSlate}
            className={`px-2.5 py-1 rounded font-label-caps text-[9.5px] font-bold transition-all cursor-pointer border flex items-center gap-1 ${
              isEmergencySlateActive
                ? 'bg-on-air-crimson text-white border-on-air-glow shadow-sm'
                : 'bg-surface-panel hover:bg-on-air-crimson/15 text-on-surface hover:text-on-air-crimson border-border-subtle hover:border-on-air-crimson/40'
            }`}
            title="Injetar ou retirar Slate de Emergência com música de contingência no PGM"
          >
            <span className="material-symbols-outlined text-[13px]">
              {isEmergencySlateActive ? 'remove_done' : 'emergency'}
            </span>
            <span>{isEmergencySlateActive ? 'DESARMAR SLATE' : 'SLATE DE EMERGÊNCIA'}</span>
          </button>

          {/* Botões de Simulação de Bancada para Homologação */}
          <div className="flex items-center gap-0.5 border-l border-border-subtle pl-1.5">
            <button
              onClick={() => handleSimulateAlarm('BLACK_FRAME')}
              className="px-1.5 py-0.5 rounded font-label-caps text-[8.5px] text-outline hover:text-armed-amber hover:bg-surface-panel transition-colors"
              title="Simular Black Frame > 2.0s para teste do watchdog"
            >
              Simular Black
            </button>
            <button
              onClick={() => handleSimulateAlarm('SILENCE')}
              className="px-1.5 py-0.5 rounded font-label-caps text-[8.5px] text-outline hover:text-armed-amber hover:bg-surface-panel transition-colors"
              title="Simular Silêncio > 3.0s para teste do watchdog"
            >
              Simular Silêncio
            </button>
            <button
              onClick={() => handleSimulateAlarm('FREEZE_FRAME')}
              className="px-1.5 py-0.5 rounded font-label-caps text-[8.5px] text-outline hover:text-armed-amber hover:bg-surface-panel transition-colors"
              title="Simular Freeze Frame para teste do watchdog"
            >
              Simular Freeze
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
