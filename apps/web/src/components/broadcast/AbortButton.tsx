/** ABORT do Master com trava de dois toques. Armado, o texto vem em duas
 * linhas curtas e o botão cresce para a esquerda (TAKE/CUE cedem colunas):
 * o ponto onde o operador clicou continua sendo o ABORT e o texto
 * "CONFIRMAR … · ESC CANCELA" não transborda (B6). */
export function transportColumns(abortArmed: boolean): { take: string; cue: string; abort: string } {
  return abortArmed ? { take: 'col-span-4', cue: 'col-span-3', abort: 'col-span-5' } : { take: 'col-span-6', cue: 'col-span-4', abort: 'col-span-2' }
}

interface Props { armed: boolean; countdown: number; canStop: boolean; deniedTitle: string; onClick: () => void }
export function AbortButton({ armed, countdown, canStop, deniedTitle, onClick }: Props) {
  return <button
    onClick={onClick}
    disabled={!canStop}
    data-testid="btn-abort"
    className={`${transportColumns(armed).abort} h-12 min-w-0 overflow-hidden px-1 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg border border-border-subtle flex flex-col items-center justify-center transition-all cursor-pointer ${
      armed
        ? 'bg-on-air-crimson text-white animate-pulse motion-reduce:animate-none border-on-air-glow'
        : 'bg-surface-container hover:bg-error-container text-outline hover:text-on-error-container'
    }`}
    title={!canStop ? deniedTitle : armed ? 'CLIQUE PARA CONFIRMAR PARADA IMEDIATA · Esc cancela' : 'Parada de emergência com trava de segurança (ABORT)'}
  >
    {armed ? <>
      <span className="font-label-mono text-[12px] uppercase font-bold leading-tight whitespace-nowrap">CONFIRMAR {countdown}s</span>
      <span className="font-label-mono text-[11px] uppercase leading-tight whitespace-nowrap opacity-90">Esc cancela</span>
    </> : <>
      <span className="material-symbols-outlined text-[15px]">stop</span>
      <span className="font-label-mono text-[12px] uppercase font-bold">ABORT</span>
    </>}
  </button>
}
