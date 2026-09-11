import type { Frames } from '@rplayout/protocol'

/**
 * Montagem automática de grade.
 *
 * A função é pura: recebe o que existe no acervo e o que já aconteceu, e
 * devolve a lista de itens que preenche a janela. Nada de banco, nada de
 * relógio -- é o que permite testar a decisão em vez de testar o efeito dela.
 */

export interface Candidate {
  readonly id: string
  readonly durationFrames: Frames
  /** Categoria do acervo. Regra pede categoria, não arquivo. */
  readonly categoryId: string | null
  /**
   * Quando foi ao ar pela última vez, em milissegundos de época. Nulo é
   * material que nunca entrou.
   */
  readonly lastAiredMs: number | null
  /** O que o operador ensinou sobre ele. Zero é neutro. */
  readonly preference: number
}

export interface FillRequest {
  /** Quanto tempo há para preencher, em frames. */
  readonly window: Frames
  readonly candidates: readonly Candidate[]
  /** Categorias aceitas, na ordem de preferência. Vazio aceita todas. */
  readonly categories: readonly string[]
  /** Não repetir o que foi ao ar dentro deste intervalo, em milissegundos. */
  readonly avoidWithinMs: number
  /** Instante de referência para a regra de repetição. */
  readonly nowMs: number
  /** Sobra tolerada no fim da janela, em frames. */
  readonly slackFrames: Frames
}

export interface FillResult {
  readonly items: readonly Candidate[]
  /** O que sobrou da janela depois do último item. */
  readonly leftover: Frames
  /** Por que parou: encheu, ou não havia mais material que coubesse. */
  readonly reason: 'FILLED' | 'OUT_OF_MATERIAL'
}

/**
 * Nota de um candidato para uma vaga.
 *
 * Três forças, e nenhuma delas é aleatória: o que o operador escolhe ganha
 * peso, o que acabou de ir ao ar perde, e o que cabe melhor na sobra ganha.
 * Sorteio faria a grade parecer viva e tornaria impossível explicar por que um
 * item entrou -- num playout, "por que isso foi ao ar?" precisa de resposta.
 */
export function score(
  candidate: Candidate,
  remaining: Frames,
  nowMs: number,
  avoidWithinMs: number,
): number {
  if (candidate.durationFrames > remaining) return Number.NEGATIVE_INFINITY

  const age = candidate.lastAiredMs === null ? Infinity : nowMs - candidate.lastAiredMs
  if (age < avoidWithinMs) return Number.NEGATIVE_INFINITY

  // Encaixe: quanto menos sobra deixar, melhor. Normalizado pela janela para
  // não depender do tamanho absoluto dos arquivos.
  const fit = 1 - (remaining - candidate.durationFrames) / Math.max(remaining, 1)

  // Frescor: material parado há mais tempo sobe, com retorno decrescente.
  const freshness = age === Infinity ? 1 : Math.min(1, age / (avoidWithinMs * 4 || 1))

  return fit * 2 + freshness + candidate.preference
}

/**
 * Preenche a janela, item a item, sempre escolhendo o de maior nota.
 *
 * Guloso de propósito: um otimizador exato encaixaria o tempo com perfeição e
 * produziria uma sequência que ninguém consegue explicar -- e a grade que o
 * operador não entende é a grade que ele desmonta na mão.
 */
export function autoFill(request: FillRequest): FillResult {
  const chosen: Candidate[] = []
  const used = new Set<string>()
  let remaining = request.window

  const allowed = (candidate: Candidate): boolean =>
    request.categories.length === 0 ||
    (candidate.categoryId !== null && request.categories.includes(candidate.categoryId))

  while (remaining > request.slackFrames) {
    let best: Candidate | null = null
    let bestScore = Number.NEGATIVE_INFINITY

    for (const candidate of request.candidates) {
      if (used.has(candidate.id) || !allowed(candidate)) continue
      const value = score(candidate, remaining, request.nowMs, request.avoidWithinMs)
      if (value > bestScore) {
        best = candidate
        bestScore = value
      }
    }

    if (!best || bestScore === Number.NEGATIVE_INFINITY) {
      return { items: chosen, leftover: remaining, reason: 'OUT_OF_MATERIAL' }
    }

    chosen.push(best)
    used.add(best.id)
    remaining -= best.durationFrames
  }

  return { items: chosen, leftover: remaining, reason: 'FILLED' }
}

/** O que o operador fez, resumido em peso por arquivo. */
export interface Lesson {
  readonly mediaId: string
  /** Inserido na mão: sinal de que o operador quer este material. */
  readonly inserted: number
  /** Removido ou descartado pelo scheduler: sinal contrário. */
  readonly dropped: number
}

/**
 * Transforma o histórico em preferência.
 *
 * O peso é limitado nos dois sentidos: um arquivo inserido cinquenta vezes não
 * pode dominar a grade inteira, e um descartado uma vez não pode ser banido
 * para sempre. Aprendizado que vira dogma é pior do que aprendizado nenhum.
 */
export function preferences(lessons: readonly Lesson[]): Map<string, number> {
  const weights = new Map<string, number>()
  for (const lesson of lessons) {
    const raw = lesson.inserted * 0.4 - lesson.dropped * 0.6
    weights.set(lesson.mediaId, Math.max(-1.5, Math.min(1.5, raw)))
  }
  return weights
}
