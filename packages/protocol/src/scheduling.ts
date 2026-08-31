import type { Frames, Rate } from './rate.js'
import type { Anchor, Elastic, OverrunPolicy } from './rundown.js'

/**
 * O que o scheduler consome. É uma projeção do RundownItem com a duração já
 * resolvida a partir do corte — o motor de tempo não precisa saber o que é um
 * arquivo, um asset ou uma fonte ao vivo.
 */
export interface PlanItem {
  readonly id: string
  readonly order: number
  /** Duração pretendida no ar, já com o trim aplicado. */
  readonly duration: Frames
  /** Piso do corte automático. */
  readonly minDuration: Frames
  readonly anchor: Anchor
  readonly onOverrun: OverrunPolicy
  readonly elastic: Elastic | null
  readonly isFiller: boolean
  readonly locked: boolean
}

/** Estado do item que está no ar agora, vindo do engine. */
export interface OnAirState {
  readonly itemId: string
  /** Quando entrou de fato, em frames desde a meia-noite. */
  readonly startedAt: Frames
  /** Quanto já rodou. */
  readonly elapsed: Frames
}

export interface ResolveInput {
  readonly rate: Rate
  readonly items: readonly PlanItem[]
  /** Agora, em frames desde a meia-noite. Nulo é planejamento offline. */
  readonly now: Frames | null
  readonly onAir: OnAirState | null
  /** Onde a grade começa quando nada está no ar. */
  readonly plannedStart: Frames
}

export type AdjustmentKind =
  /** Encurtado para recuperar tempo. */
  | 'TRIMMED'
  /** Filler removido. */
  | 'DROPPED'
  /** Item pulado inteiro. */
  | 'SKIPPED'
  /** Elástico esticado para cobrir folga. */
  | 'STRETCHED'
  /** Elástico encolhido para recuperar tempo. */
  | 'SHRUNK'
  /** Ficou dead air antes deste item. */
  | 'GAP_BEFORE'

export interface Adjustment {
  readonly kind: AdjustmentKind
  /** Quantos frames o ajuste mexeu. Sempre positivo. */
  readonly frames: Frames
  readonly reason: string
}

export type ItemState = 'DONE' | 'ON_AIR' | 'PENDING' | 'DROPPED'

export interface ResolvedItem {
  readonly id: string
  readonly order: number
  readonly start: Frames
  readonly end: Frames
  /** Duração depois dos ajustes. */
  readonly duration: Frames
  /** Duração antes dos ajustes. */
  readonly plannedDuration: Frames
  readonly state: ItemState
  readonly adjustments: readonly Adjustment[]
  /** Falso quando a âncora não pôde ser respeitada. */
  readonly anchorHit: boolean
  /** Desvio em relação ao horário alvo. Negativo é adiantado. */
  readonly deviation: Frames
}

export type ConflictKind =
  /** Não deu para recuperar tempo suficiente antes de uma âncora. */
  | 'OVERRUN'
  /** Sobrou buraco e não havia com o que preencher. */
  | 'GAP'
  /** Duas âncoras rígidas que não cabem uma na outra. */
  | 'ANCHOR_IMPOSSIBLE'
  /** Âncora flexível que teve de ser violada. */
  | 'ANCHOR_MISSED'
  /** Âncora com horário já passado. */
  | 'ANCHOR_PAST'

export interface Conflict {
  readonly kind: ConflictKind
  readonly itemId: string
  /** Tamanho do problema, em frames. */
  readonly frames: Frames
  readonly message: string
  readonly severity: 'WARN' | 'ERROR'
}

export type SuggestionAction =
  | 'ADD_FILLER'
  | 'SHORTEN_ITEM'
  | 'DROP_ITEM'
  | 'RELAX_ANCHOR'
  | 'MOVE_ANCHOR'

export interface Suggestion {
  readonly itemId: string
  readonly action: SuggestionAction
  readonly frames: Frames
  readonly message: string
}

export interface ResolveResult {
  readonly items: readonly ResolvedItem[]
  readonly conflicts: readonly Conflict[]
  readonly suggestions: readonly Suggestion[]
  /** Fim projetado da grade. */
  readonly endsAt: Frames
}
