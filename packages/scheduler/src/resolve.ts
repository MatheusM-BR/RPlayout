import {
  anchorPriority,
  anchorTarget,
  anchorWindow,
  formatClock,
  formatDuration,
  type Adjustment,
  type Conflict,
  type Frames,
  type ItemState,
  type PlanItem,
  type Rate,
  type ResolveInput,
  type ResolveResult,
  type ResolvedItem,
  type Suggestion,
} from '@rplayout/protocol'

/**
 * Item durante o cálculo. Tudo aqui é mutável de propósito: o motor faz várias
 * passadas sobre o mesmo segmento até o tempo fechar.
 */
interface Work {
  readonly item: PlanItem
  duration: Frames
  dropped: boolean
  start: Frames
  end: Frames
  state: ItemState
  adjustments: Adjustment[]
  anchorHit: boolean
  deviation: Frames
  /** Hora de entrada travada: o item no ar já entrou, não se replaneja. */
  pinnedStart: Frames | null
  /** Quanto já foi ao ar e portanto não pode ser cortado. */
  aired: Frames
}

type RecoveryKind = 'SHRUNK' | 'DROPPED' | 'SKIPPED' | 'TRIMMED'

interface Candidate {
  readonly index: number
  readonly kind: RecoveryKind
  /** Quantos frames dá para recuperar deste item. */
  readonly available: Frames
  /** Menor custo é sacrificado primeiro. */
  readonly cost: number
}

/**
 * Ordem de sacrifício. Encolher um elástico não custa nada — ele existe para
 * isso. Descartar filler é barato. Cortar conteúdo é caro. Pular um item
 * inteiro é a última coisa que se faz de propósito.
 */
const COST = { SHRUNK: 0, DROPPED: 1, TRIMMED: 2, SKIPPED: 3 } as const

function recoveryCandidate(work: Work, index: number): Candidate | null {
  const { item } = work
  if (work.dropped || item.locked) return null

  const floor = Math.max(item.minDuration, work.aired)

  if (item.elastic) {
    const available = work.duration - Math.max(item.elastic.min, floor)
    return available > 0 ? { index, kind: 'SHRUNK', available, cost: COST.SHRUNK } : null
  }

  switch (item.onOverrun) {
    case 'DROP_FILLER': {
      if (!item.isFiller || work.aired > 0) return null
      return { index, kind: 'DROPPED', available: work.duration, cost: COST.DROPPED }
    }
    case 'SKIP': {
      if (work.aired > 0) return null
      return { index, kind: 'SKIPPED', available: work.duration, cost: COST.SKIPPED }
    }
    case 'TRIM_PREV': {
      const available = work.duration - floor
      return available > 0 ? { index, kind: 'TRIMMED', available, cost: COST.TRIMMED } : null
    }
    case 'PUSH':
      return null
  }
}

/**
 * Recalcula entradas e saídas de um trecho. Item com hora travada ancora o
 * cursor; item descartado não ocupa tempo.
 */
function relayout(work: Work[], from: number, to: number, cursor: Frames): Frames {
  let at = cursor
  for (let i = from; i < to; i++) {
    const w = work[i]
    if (!w || w.dropped) continue
    if (w.pinnedStart !== null) {
      w.start = w.pinnedStart
    } else {
      // Recuperar tempo pode empurrar uma âncora flexível para trás, mas nunca
      // para antes da janela em que ela pode entrar.
      const window = anchorWindow(w.item.anchor)
      w.start = window ? Math.max(at, window.from) : at
    }
    w.end = w.start + w.duration
    at = w.end
  }
  return at
}

/**
 * Corte forçado: a âncora fixa manda, e o que estava no ar sai do ar na hora.
 * Volta encurtando de trás para frente até absorver o excesso ou esbarrar no
 * que já foi ao ar — daí não há mais o que fazer e vira conflito.
 */
function forceCutBefore(work: Work[], upTo: number, hardStart: Frames): Frames {
  let deficit = 0
  for (let i = upTo - 1; i >= 0; i--) {
    const w = work[i]
    if (!w || w.dropped) continue
    if (w.end <= hardStart) break

    const floor = Math.max(w.aired, 0)
    const wanted = Math.max(hardStart - w.start, floor)
    const cut = w.duration - wanted

    if (cut > 0) {
      w.duration = wanted
      w.end = w.start + w.duration
      w.adjustments.push({
        kind: 'TRIMMED',
        frames: cut,
        reason: 'Corte forçado pela âncora fixa seguinte.',
      })
    }
    if (w.end > hardStart) deficit = w.end - hardStart
    break
  }
  return deficit
}

/**
 * Motor de remanejamento.
 *
 * Função pura: mesma entrada, mesma saída, sem relógio próprio e sem I/O. É o
 * que torna cada cenário de atraso um teste unitário em vez de um susto no ar.
 */
export function resolve(input: ResolveInput): ResolveResult {
  const rate: Rate = input.rate
  const items = [...input.items].sort((a, b) => a.order - b.order)
  const conflicts: Conflict[] = []
  const suggestions: Suggestion[] = []

  const work: Work[] = items.map((item) => ({
    item,
    duration: item.duration,
    dropped: false,
    start: 0,
    end: 0,
    state: 'PENDING',
    adjustments: [],
    anchorHit: true,
    deviation: 0,
    pinnedStart: null,
    aired: 0,
  }))

  if (work.length === 0) {
    return { items: [], conflicts, suggestions, endsAt: input.plannedStart }
  }

  // ---- ponto de partida ------------------------------------------------

  const onAirIndex = input.onAir ? work.findIndex((w) => w.item.id === input.onAir?.itemId) : -1
  let cursor: Frames
  let segmentStart: number

  if (input.onAir && onAirIndex >= 0) {
    const onAir = input.onAir
    const w = work[onAirIndex]!

    // O que já passou é história: horários reconstruídos de trás para frente.
    let back = onAir.startedAt
    for (let i = onAirIndex - 1; i >= 0; i--) {
      const prev = work[i]!
      prev.end = back
      prev.start = back - prev.duration
      prev.state = 'DONE'
      back = prev.start
    }

    w.pinnedStart = onAir.startedAt
    w.aired = Math.min(onAir.elapsed, w.duration)
    w.state = 'ON_AIR'
    w.start = onAir.startedAt
    w.end = w.start + w.duration

    cursor = w.end
    segmentStart = onAirIndex
  } else {
    cursor = input.plannedStart
    segmentStart = 0
  }

  const firstPending = input.onAir && onAirIndex >= 0 ? onAirIndex + 1 : 0
  /** Cursor no começo do segmento recuperável corrente. */
  let segmentCursor = input.onAir && onAirIndex >= 0 ? work[onAirIndex]!.start : cursor
  let lastAnchorWasFixed = false

  // ---- passada principal -----------------------------------------------

  for (let i = firstPending; i < work.length; i++) {
    const w = work[i]!
    const { item } = w
    const window = anchorWindow(item.anchor)

    if (!window) {
      w.start = cursor
      w.end = w.start + w.duration
      cursor = w.end
      continue
    }

    if (input.now !== null && window.to < input.now) {
      conflicts.push({
        kind: 'ANCHOR_PAST',
        itemId: item.id,
        frames: input.now - window.to,
        severity: 'ERROR',
        message:
          `A âncora de ${formatClock(window.to, rate)} já passou ` +
          `(agora são ${formatClock(input.now, rate)}).`,
      })
    }

    if (cursor < window.from) {
      cursor = fillGap(w, work, segmentStart, i, segmentCursor, cursor, window.from, rate, conflicts, suggestions)
    } else if (cursor > window.to) {
      cursor = recoverTime(
        w, work, segmentStart, i, segmentCursor, cursor, window.to, rate,
        lastAnchorWasFixed, conflicts, suggestions,
      )
    }

    w.start = Math.max(cursor, window.from)
    w.end = w.start + w.duration
    cursor = w.end

    const target = anchorTarget(item.anchor)
    w.deviation = target === null ? 0 : w.start - target
    w.anchorHit = w.start >= window.from && w.start <= window.to

    // Só uma âncora fixa fecha o segmento. Âncora flexível é flexível também
    // para trás: recuperar tempo para a próxima fixa pode passar por cima dela.
    if (item.anchor.kind === 'FIXED') {
      lastAnchorWasFixed = true
      segmentStart = i
      segmentCursor = w.start
    } else {
      lastAnchorWasFixed = false
    }
  }

  // Um relayout posterior pode ter movido âncoras flexíveis já processadas.
  // O desvio e o acerto da janela valem pelos horários finais.
  for (const w of work) {
    if (w.dropped) continue
    const window = anchorWindow(w.item.anchor)
    if (!window) continue
    const target = anchorTarget(w.item.anchor)
    w.deviation = target === null ? 0 : w.start - target
    w.anchorHit = w.start >= window.from && w.start <= window.to
  }

  const resolved: ResolvedItem[] = work.map((w) => ({
    id: w.item.id,
    order: w.item.order,
    start: w.start,
    end: w.end,
    duration: w.duration,
    plannedDuration: w.item.duration,
    state: w.dropped ? 'DROPPED' : w.state,
    adjustments: w.adjustments,
    anchorHit: w.anchorHit,
    deviation: w.deviation,
  }))

  const lastLive = [...work].reverse().find((w) => !w.dropped)
  return {
    items: resolved,
    conflicts,
    suggestions,
    endsAt: lastLive?.end ?? input.plannedStart,
  }
}

/**
 * Estica os elásticos do trecho, começando pelo mais próximo da âncora — é o
 * filler que está ali justamente para isso. Devolve o que ainda faltou cobrir.
 */
function stretchElastics(
  work: Work[],
  from: number,
  to: number,
  amount: Frames,
  rate: Rate,
): Frames {
  let left = amount
  for (let k = to - 1; k >= from && left > 0; k--) {
    const w = work[k]
    if (!w || w.dropped || w.item.locked || !w.item.elastic) continue
    const room = w.item.elastic.max - w.duration
    if (room <= 0) continue

    const take = Math.min(room, left)
    w.duration += take
    w.adjustments.push({
      kind: 'STRETCHED',
      frames: take,
      reason: `Esticado ${formatDuration(take, rate)} para cobrir a folga até a âncora.`,
    })
    left -= take
  }
  return left
}

/** Sobra tempo antes da âncora: estica o que der e reporta o que ficou aberto. */
function fillGap(
  anchored: Work,
  work: Work[],
  segmentStart: number,
  index: number,
  segmentCursor: Frames,
  cursor: Frames,
  windowFrom: Frames,
  rate: Rate,
  conflicts: Conflict[],
  suggestions: Suggestion[],
): Frames {
  const gap = stretchElastics(work, segmentStart, index, windowFrom - cursor, rate)
  const newCursor = relayout(work, segmentStart, index, segmentCursor)

  if (gap > 0) {
    anchored.adjustments.push({
      kind: 'GAP_BEFORE',
      frames: gap,
      reason: `Buraco de ${formatDuration(gap, rate)} antes da entrada.`,
    })
    conflicts.push({
      kind: 'GAP',
      itemId: anchored.item.id,
      frames: gap,
      severity: 'WARN',
      message:
        `Sobram ${formatDuration(gap, rate)} até ` +
        `${formatClock(windowFrom, rate)} e não há elástico para cobrir.`,
    })
    suggestions.push({
      itemId: anchored.item.id,
      action: 'ADD_FILLER',
      frames: gap,
      message: `Inserir filler de ${formatDuration(gap, rate)} antes deste item.`,
    })
  }

  return Math.max(newCursor, windowFrom)
}

/**
 * Falta tempo antes da âncora. Recupera do segmento na ordem de custo: encolhe
 * elástico, descarta filler, corta o que pode ser cortado, pula o que pode ser
 * pulado. Nada travado e nada que já foi ao ar é tocado.
 */
function recoverTime(
  anchored: Work,
  work: Work[],
  segmentStart: number,
  index: number,
  segmentCursor: Frames,
  cursor: Frames,
  windowTo: Frames,
  rate: Rate,
  lastAnchorWasFixed: boolean,
  conflicts: Conflict[],
  suggestions: Suggestion[],
): Frames {
  let over = cursor - windowTo

  const candidates: Candidate[] = []
  for (let k = segmentStart; k < index; k++) {
    const w = work[k]
    if (!w) continue
    const c = recoveryCandidate(w, k)
    if (c) candidates.push(c)
  }
  // Custo primeiro; empate resolve pelo item mais próximo da âncora.
  candidates.sort((a, b) => a.cost - b.cost || b.index - a.index)

  for (const c of candidates) {
    if (over <= 0) break
    const w = work[c.index]!

    if (c.kind === 'DROPPED' || c.kind === 'SKIPPED') {
      w.dropped = true
      w.adjustments.push({
        kind: c.kind,
        frames: w.duration,
        reason:
          c.kind === 'DROPPED'
            ? 'Filler descartado para recuperar tempo.'
            : 'Item pulado para salvar a âncora seguinte.',
      })
      over -= w.duration
      continue
    }

    const take = Math.min(c.available, over)
    w.duration -= take
    w.adjustments.push({
      kind: c.kind,
      frames: take,
      reason:
        c.kind === 'SHRUNK'
          ? `Encolhido ${formatDuration(take, rate)} para recuperar tempo.`
          : `Cortado ${formatDuration(take, rate)} para segurar a âncora.`,
    })
    over -= take
  }

  // Descartar um item inteiro recupera mais do que era preciso. O elástico que
  // sobrou no trecho devolve a diferença, em vez de virar dead air.
  if (over < 0) stretchElastics(work, segmentStart, index, -over, rate)

  let newCursor = relayout(work, segmentStart, index, segmentCursor)
  if (newCursor <= windowTo) return newCursor

  const remaining = newCursor - windowTo

  if (anchored.item.anchor.kind === 'FIXED') {
    const deficit = forceCutBefore(work, index, windowTo)
    newCursor = relayout(work, segmentStart, index, segmentCursor)
    conflicts.push({
      kind: lastAnchorWasFixed ? 'ANCHOR_IMPOSSIBLE' : 'OVERRUN',
      itemId: anchored.item.id,
      frames: remaining,
      severity: 'ERROR',
      message:
        `Faltam ${formatDuration(remaining, rate)} para caber antes de ` +
        `${formatClock(windowTo, rate)}` +
        (deficit > 0
          ? `; nem o corte forçado resolve, sobram ${formatDuration(deficit, rate)}.`
          : '; o item anterior sai do ar cortado.'),
    })
    suggestions.push({
      itemId: anchored.item.id,
      action: 'SHORTEN_ITEM',
      frames: remaining,
      message: `Encurtar ${formatDuration(remaining, rate)} nos itens anteriores.`,
    })
    // Âncora fixa manda: entra na hora dela, custe o que custar ao anterior.
    return windowTo
  }

  anchored.anchorHit = false
  conflicts.push({
    kind: 'ANCHOR_MISSED',
    itemId: anchored.item.id,
    frames: remaining,
    severity: 'WARN',
    message:
      `Entra ${formatDuration(remaining, rate)} depois da janela ` +
      `(prioridade ${anchorPriority(anchored.item.anchor)}).`,
  })
  suggestions.push({
    itemId: anchored.item.id,
    action: 'RELAX_ANCHOR',
    frames: remaining,
    message: `Aumentar a tolerância em ${formatDuration(remaining, rate)} ou cortar antes.`,
  })
  return newCursor
}
