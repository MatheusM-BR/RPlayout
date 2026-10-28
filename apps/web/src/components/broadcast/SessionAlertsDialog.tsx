import type { Problema } from '../Problemas.js'

interface Props {
  open: boolean
  problemas: Problema[]
  onLimpar: () => void
  onClose: () => void
  onOpenSettings: () => void
  onOpenEngineering: () => void
}

export function SessionAlertsDialog({
  open,
  problemas,
  onLimpar,
  onClose,
  onOpenSettings,
  onOpenEngineering,
}: Props) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 select-none animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-surface-card border border-border-subtle rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-[85vh] animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 1. CABEÇALHO */}
        <div className="p-4 bg-surface-panel border-b border-border-subtle flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold shadow-sm ${
                problemas.length > 0
                  ? 'bg-status-danger/20 text-status-danger-bright border border-status-danger/40'
                  : 'bg-status-ok/20 text-status-ok-bright border border-status-ok/40'
              }`}
            >
              <span className="material-symbols-outlined text-[22px]">
                {problemas.length > 0 ? 'warning' : 'check_circle'}
              </span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-headline-md text-headline-md uppercase text-on-surface font-bold tracking-wider">
                  Problemas &amp; Alertas da Sessão
                </h3>
                <span
                  className={`font-label-caps text-[11px] px-2 py-0.5 rounded font-bold uppercase ${
                    problemas.length > 0
                      ? 'bg-status-danger/20 text-status-danger-bright border border-status-danger/40'
                      : 'bg-status-ok/20 text-status-ok-bright border border-status-ok/40'
                  }`}
                >
                  {problemas.length} {problemas.length === 1 ? 'REGISTRO' : 'REGISTROS'}
                </span>
              </div>
              <p className="font-body-sm text-[11px] text-outline mt-0.5">
                Central unificada de anomalias em tempo real com atalhos diretos para Configurações e Engenharia
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {problemas.length > 0 && (
              <button
                onClick={onLimpar}
                className="px-2.5 py-1 rounded bg-surface-base hover:bg-surface-container text-outline hover:text-on-surface border border-border-subtle font-label-caps text-[11px] transition-colors cursor-pointer"
                title="Limpar todos os problemas da memória desta sessão"
              >
                LIMPAR LOGS
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1 rounded-lg text-outline hover:text-on-surface hover:bg-surface-container transition-colors cursor-pointer"
              title="Fechar"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>
        </div>

        {/* 2. CONTEÚDO: LISTA DE PROBLEMAS */}
        <div className="p-4 flex-1 overflow-y-auto broadcast-scroll flex flex-col gap-2.5">
          {problemas.length === 0 ? (
            <div className="py-12 px-6 flex flex-col items-center justify-center text-center gap-3 bg-surface-base rounded-xl border border-border-subtle/50">
              <span className="material-symbols-outlined text-[44px] text-status-ok-bright opacity-60">
                task_alt
              </span>
              <div>
                <h4 className="font-headline-md text-[14px] text-on-surface font-semibold">
                  Nenhum problema detectado na sessão
                </h4>
                <p className="font-body-sm text-[11.5px] text-outline mt-1 max-w-md">
                  O engine Rust, pipelines de transporte e conexões de rede estão operando normalmente sem erros ou anomalias registradas.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {problemas.map((p) => {
                let badgeClass = 'bg-surface-container text-outline border-border-subtle'
                if (p.origem === 'SERVIDOR') badgeClass = 'bg-blue-500/20 text-blue-400 border-blue-500/40'
                if (p.origem === 'SAÍDA') badgeClass = 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                if (p.origem === 'ARQUIVO') badgeClass = 'bg-purple-500/20 text-purple-400 border-purple-500/40'
                if (p.origem === 'TELA') badgeClass = 'bg-cyan-500/20 text-cyan-400 border-cyan-500/40'

                return (
                  <div
                    key={p.id}
                    className="p-3 bg-surface-panel rounded-xl border border-border-subtle flex items-start gap-3 shadow-xs hover:border-border-strong transition-colors"
                  >
                    <span
                      className={`font-label-caps text-[11px] font-bold px-2 py-0.5 rounded border shrink-0 uppercase tracking-wider ${badgeClass}`}
                    >
                      {p.origem}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-body-md text-[12.5px] text-on-surface font-mono break-words leading-relaxed">
                        {p.texto}
                      </p>
                      <span className="font-label-mono text-[12px] text-outline mt-1 block">
                        Registrado às {p.quando}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 3. RODAPÉ UNIFICADO COM ATALHOS PARA CONFIGURAÇÕES E ENGENHARIA */}
        <div className="p-3 bg-surface-panel border-t border-border-subtle flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                onClose()
                onOpenSettings()
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-base hover:bg-surface-container text-on-surface border border-border-subtle font-label-caps text-[11px] font-bold transition-all shadow-xs cursor-pointer hover:border-primary"
            >
              <span className="material-symbols-outlined text-primary text-[16px]">settings</span>
              <span>CONFIGURAÇÕES DO SISTEMA</span>
            </button>

            <button
              onClick={() => {
                onClose()
                onOpenEngineering()
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-base hover:bg-surface-container text-on-surface border border-border-subtle font-label-caps text-[11px] font-bold transition-all shadow-xs cursor-pointer hover:border-accent-ice"
            >
              <span className="material-symbols-outlined text-accent-ice text-[16px]">grid_view</span>
              <span>MONITOR &amp; ENGENHARIA</span>
            </button>
          </div>

          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-primary hover:bg-primary-hover text-surface-base font-label-caps text-[11px] font-bold transition-all cursor-pointer shadow-sm"
          >
            FECHAR
          </button>
        </div>
      </div>
    </div>
  )
}
