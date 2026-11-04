import type { HistoryState } from '../types.js'

interface Props {
  history: HistoryState | null | undefined
  onUndo?: () => void
  onRedo?: () => void
  /** Motivo para desabilitar os dois (ex.: grade exibida não é a carregada). */
  blockedReason?: string | null
  compact?: boolean
}

/** Desfazer/refazer visíveis (B14: só existiam pelo Ctrl+Z / Ctrl+Y). Usa o
 * mesmo histórico do servidor que o teclado e mostra o que será desfeito. */
export function UndoRedoButtons({ history, onUndo, onRedo, blockedReason = null, compact = false }: Props) {
  if (!onUndo && !onRedo) return null
  const undoTitle = blockedReason ?? (history?.canUndo ? `Desfazer: ${history.undoLabel ?? 'última alteração'} (Ctrl+Z)` : 'Nada para desfazer (Ctrl+Z)')
  const redoTitle = blockedReason ?? (history?.canRedo ? `Refazer: ${history.redoLabel ?? 'alteração desfeita'} (Ctrl+Y)` : 'Nada para refazer (Ctrl+Y)')
  const base = 'flex items-center gap-1 px-2 py-1 rounded border border-border-subtle bg-surface-panel text-[11px] font-label-caps text-on-surface hover:bg-surface-container disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer'
  return <div className="inline-flex items-center gap-1" role="group" aria-label="Desfazer e refazer">
    <button type="button" data-testid="btn-undo" className={base} disabled={Boolean(blockedReason) || !history?.canUndo || !onUndo} title={undoTitle} aria-label={undoTitle} onClick={onUndo}>
      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">undo</span>{!compact && <span>Desfazer</span>}
    </button>
    <button type="button" data-testid="btn-redo" className={base} disabled={Boolean(blockedReason) || !history?.canRedo || !onRedo} title={redoTitle} aria-label={redoTitle} onClick={onRedo}>
      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">redo</span>{!compact && <span>Refazer</span>}
    </button>
  </div>
}
