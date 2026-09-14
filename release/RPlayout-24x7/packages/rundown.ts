import type { Frames } from './rate.js'
import type { AudioLevel, Trim } from './media.js'

/** 1 é o que se sacrifica primeiro; 5 é o que não se sacrifica. */
export type Priority = 1 | 2 | 3 | 4 | 5

/**
 * O compromisso que o item tem com o relógio. É daqui que sai todo o
 * remanejamento automático.
 */
export type Anchor =
  /** Entra quando o anterior termina. */
  | { readonly kind: 'FLOW' }
  /** Hora obrigatória. O scheduler tem que respeitar. */
  | { readonly kind: 'FIXED'; readonly at: Frames }
  /** Hora alvo com tolerância para os dois lados. */
  | {
      readonly kind: 'SOFT'
      readonly at: Frames
      readonly tolerance: Frames
      readonly priority: Priority
    }
  /** Pode entrar em qualquer ponto da janela. */
  | {
      readonly kind: 'WINDOW'
      readonly from: Frames
      readonly to: Frames
      readonly priority: Priority
    }

export type AnchorKind = Anchor['kind']

export const FLOW: Anchor = { kind: 'FLOW' }

/** A janela em que o item pode começar, normalizada. */
export function anchorWindow(anchor: Anchor): { from: Frames; to: Frames } | null {
  switch (anchor.kind) {
    case 'FLOW':
      return null
    case 'FIXED':
      return { from: anchor.at, to: anchor.at }
    case 'SOFT':
      return { from: anchor.at - anchor.tolerance, to: anchor.at + anchor.tolerance }
    case 'WINDOW':
      return { from: anchor.from, to: anchor.to }
  }
}

/** O horário ideal — o centro da janela para SOFT, o início para WINDOW. */
export function anchorTarget(anchor: Anchor): Frames | null {
  switch (anchor.kind) {
    case 'FLOW':
      return null
    case 'FIXED':
      return anchor.at
    case 'SOFT':
      return anchor.at
    case 'WINDOW':
      return anchor.from
  }
}

export function anchorPriority(anchor: Anchor): Priority {
  switch (anchor.kind) {
    case 'FLOW':
      return 1
    case 'FIXED':
      return 5
    case 'SOFT':
    case 'WINDOW':
      return anchor.priority
  }
}

/** O que fazer com este item quando o tempo não fecha. */
export type OverrunPolicy =
  /** Pode ser encurtado até `minDuration`. */
  | 'TRIM_PREV'
  /** Pode ser removido se for filler. */
  | 'DROP_FILLER'
  /** Não abre mão de nada: empurra o resto para frente. */
  | 'PUSH'
  /** Pode ser removido inteiro para salvar o compromisso seguinte. */
  | 'SKIP'

export type ItemType = 'VT' | 'LIVE' | 'GFX' | 'SLATE' | 'COMMERCIAL' | 'FILLER'

/**
 * O que fazer quando a proporção do material não é a do canal.
 *
 * `PILLARBOX` mostra o quadro inteiro e preenche a sobra com preto; `CROP`
 * enche a tela e corta o que passa da borda. Nenhum dos dois deforma -- essa
 * terceira opção não existe de propósito.
 */
export type Fit = 'PILLARBOX' | 'CROP'

export const DEFAULT_FIT: Fit = 'PILLARBOX'

/** Item elástico: estica ou encolhe para absorver folga e sobra. */
export interface Elastic {
  readonly min: Frames
  readonly max: Frames
}

export interface RundownItem {
  readonly id: string
  readonly rundownId: string
  readonly order: number
  readonly type: ItemType
  readonly title: string

  /** Arquivo do acervo, quando é VT, comercial, filler ou slate. */
  readonly mediaId: string | null
  /** Fonte ao vivo: `sdi:0`, `ndi:ESTUDIO (CAM1)`, `srt://…`, `guest:<chave>`. */
  readonly sourceRef: string | null

  /** Corte só deste item. Nulo herda do asset. */
  readonly trim: Trim | null
  /** Nivelamento só deste item. Nulo herda do asset. */
  readonly audio: AudioLevel | null

  /** Duração declarada, para itens sem arquivo (LIVE, GFX). */
  readonly durationOverride: Frames | null
  /** Piso para o corte automático. O scheduler nunca desce daqui. */
  readonly minDuration: Frames

  readonly anchor: Anchor
  readonly onOverrun: OverrunPolicy
  readonly elastic: Elastic | null

  /**
   * Bloco a que o item pertence. Itens do mesmo bloco andam juntos: arrastar
   * um arrasta todos, e o bloco entra e sai inteiro.
   */
  readonly blockId: string | null

  /** Proporção diferente da do canal: mostrar inteiro ou encher cortando. */
  readonly fit: Fit

  /** Trilha de áudio escolhida. Nulo é a primeira que o arquivo declara. */
  readonly audioTrack: number | null

  /** Item travado não é cortado, removido nem reordenado pelo scheduler. */
  readonly locked: boolean
  /** false segura no último frame esperando take manual. */
  readonly autoNext: boolean
  readonly loop: boolean

  readonly notes: string | null
}

export interface Rundown {
  readonly id: string
  readonly channelId: string
  readonly name: string
  /** Início planejado da grade, em frames desde a meia-noite. */
  readonly plannedStart: Frames
  /**
   * Programação não acaba: ao terminar o último item, volta para o primeiro.
   * Desligue só para uma grade de evento, que tem fim de verdade.
   */
  readonly loop: boolean
  readonly date: string
  readonly createdAt: string
  readonly updatedAt: string
}
