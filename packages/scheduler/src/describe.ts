import type { Adjustment, AdjustmentKind, Conflict, ConflictKind } from '@rplayout/protocol'

const CONFLICT_LABEL: Record<ConflictKind, string> = {
  OVERRUN: 'Estouro',
  GAP: 'Buraco',
  ANCHOR_IMPOSSIBLE: 'Âncoras incompatíveis',
  ANCHOR_MISSED: 'Fora da janela',
  ANCHOR_PAST: 'Horário já passou',
}

const ADJUSTMENT_LABEL: Record<AdjustmentKind, string> = {
  TRIMMED: 'Cortado',
  DROPPED: 'Descartado',
  SKIPPED: 'Pulado',
  STRETCHED: 'Esticado',
  SHRUNK: 'Encolhido',
  GAP_BEFORE: 'Buraco antes',
}

/** Rótulo curto do conflito, para o selo da linha no rundown. */
export const describeConflict = (conflict: Conflict): string => CONFLICT_LABEL[conflict.kind]

/** Rótulo curto do ajuste, para o selo da linha no rundown. */
export const describeAdjustment = (adjustment: Adjustment): string =>
  ADJUSTMENT_LABEL[adjustment.kind]
