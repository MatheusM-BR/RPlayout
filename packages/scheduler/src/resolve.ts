import {
  anchorPriority,
  anchorTarget,
  anchorWindow,
  formatClock,
  formatDuration,
  type Adjustment,
  type CompensationAction,
  type Conflict,
  type Frames,
  type ItemState,
  type PlanItem,
  type Rate,
  type ResolveInput,
  type ResolveResult,
  type ResolvedItem,
  type ScheduleCompensationReport,
  type ScheduleCompensationStatus,
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

function isHardTime(item: PlanItem): boolean {
  return item.eventType === 'HARD_TIME' || item.anchor.kind === 'HARD_TIME'
}

function isFixed(item: PlanItem): boolean {
  return (
    item.eventType === 'FIXED' ||
    item.anchor.kind === 'FIXED' ||
    isHardTime(item)
  )
}

function isProtected(item: PlanItem): boolean {
  return item.timingFlags?.protected === true || item.locked === true
}

function isFiller(item: PlanItem): boolean {
  return item.eventType === 'FILLER' || item.isFiller || item.elastic !== null
}

function isOptional(item: PlanItem): boolean {
  if (isProtected(item)) return false
  if (item.timingFlags?.optional === true) return true
  return item.onOverrun === 'DROP_FILLER' || item.onOverrun === 'SKIP'
}

function isTrimmable(item: PlanItem): boolean {
  if (isProtected(item)) return false
  if (item.timingFlags?.trimmable === true) return true
  return item.onOverrun === 'TRIM_PREV'
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
function forceCutBefore(
  work: Work[],
  upTo: number,
  hardStart: Frames,
  actions?: CompensationAction[],
  anchored?: Work,
  timestamp?: string,
): Frames {
  let deficit = 0
  for (let i = upTo - 1; i >= 0; i--) {
    const w = work[i]
    if (!w || w.dropped) continue
    if (w.end <= hardStart) break

    const floor = Math.max(w.aired, 0)
    const wanted = Math.max(hardStart - w.start, floor)
    const cut = w.duration - wanted

    if (cut > 0) {
      const prevDuration = w.duration
      w.duration = wanted
      w.end = w.start + w.duration
      w.adjustments.push({
        kind: 'TRIMMED',
        frames: cut,
        reason: 'Corte forçado pela âncora fixa seguinte.',
      })
      if (actions && anchored) {
        actions.push({
          itemId: w.item.id,
          itemTitle: w.item.title,
          actionType: 'TRIM_TAIL',
          deltaFrames: cut,
          originalDuration: prevDuration,
          newDuration: wanted,
          plannedDurationFrames: w.item.duration,
          effectiveDurationFrames: wanted,
          targetAnchorId: anchored.item.id,
          targetAnchorType: 'FIXED',
          reason: 'Corte forçado pela âncora fixa seguinte.',
          timestamp: timestamp ?? '1970-01-01T00:00:00.000Z',
        })
      }
    }
    if (w.end > hardStart) deficit = w.end - hardStart
    break
  }
  return deficit
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
  actions?: CompensationAction[],
  anchored?: Work,
  timestamp?: string,
): Frames {
  let left = amount
  for (let k = to - 1; k >= from && left > 0; k--) {
    const w = work[k]
    if (!w || w.dropped || isProtected(w.item)) continue
    if (!w.item.elastic) continue

    const room = w.item.elastic.max - w.duration
    if (room <= 0) continue

    const take = Math.min(room, left)
    const prevDuration = w.duration
    w.duration += take
    w.adjustments.push({
      kind: 'STRETCHED',
      frames: take,
      reason: `Esticado ${formatDuration(take, rate)} para cobrir a folga até a âncora.`,
    })
    if (actions && anchored) {
      actions.push({
        itemId: w.item.id,
        itemTitle: w.item.title,
        actionType: 'EXPAND_FILLER',
        deltaFrames: take,
        originalDuration: prevDuration,
        newDuration: w.duration,
        plannedDurationFrames: w.item.duration,
        effectiveDurationFrames: w.duration,
        targetAnchorId: anchored.item.id,
        targetAnchorType: isHardTime(anchored.item) ? 'HARD_TIME' : 'FIXED',
        reason: `Filler esticado ${formatDuration(take, rate)} para cobrir folga até a âncora.`,
        timestamp: timestamp ?? '1970-01-01T00:00:00.000Z',
      })
    }
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
  actions: CompensationAction[],
  timestamp: string,
): Frames {
  const gap = stretchElastics(
    work,
    segmentStart,
    index,
    windowFrom - cursor,
    rate,
    actions,
    anchored,
    timestamp,
  )
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
 * Falta tempo antes da âncora. Implementa o algoritmo de cascata de sacrifício da FASE A:
 * 1) Encolher FILLER até minDuration (ou elastic.min).
 * 2) Descartar OPTIONAL (de trás para frente no bloco).
 * 3) Cortar cauda de TRIMMABLE até minDuration (piso de 70% da duração original caso não configurado).
 * 4) Preservar itens PROTECTED (nunca tocados).
 * 5) Se for HARD_TIME, aplicar Emergency Truncation no item imediatamente anterior para zerar atraso no frame 0.
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
  actions: CompensationAction[],
  timestamp: string,
): Frames {
  let over = cursor - windowTo
  const targetAnchorType = isHardTime(anchored.item) ? 'HARD_TIME' : 'FIXED'

  // ---- PASSO 1: Encolher FILLER elástico ou inteligente até minDuration ----
  for (let k = index - 1; k >= segmentStart && over > 0; k--) {
    const w = work[k]
    if (!w || w.dropped || isProtected(w.item)) continue
    if (!isFiller(w.item)) continue

    const minFloor = w.item.elastic?.min ?? (w.item.minDuration > 0 ? w.item.minDuration : 0)
    const floor = Math.max(minFloor, w.aired)
    const room = w.duration - floor
    if (room <= 0) continue

    const take = Math.min(room, over)
    const prevDuration = w.duration
    w.duration -= take
    w.adjustments.push({
      kind: 'SHRUNK',
      frames: take,
      reason: `Filler encolhido ${formatDuration(take, rate)} para recuperar tempo.`,
    })
    actions.push({
      itemId: w.item.id,
      itemTitle: w.item.title,
      actionType: 'SHRINK_FILLER',
      deltaFrames: take,
      originalDuration: prevDuration,
      newDuration: w.duration,
      plannedDurationFrames: w.item.duration,
      effectiveDurationFrames: w.duration,
      targetAnchorId: anchored.item.id,
      targetAnchorType,
      reason: `Filler encolhido ${formatDuration(take, rate)} para absorver atraso até âncora.`,
      timestamp,
    })
    over -= take
  }

  // ---- PASSO 2: Descartar itens OPTIONAL (de trás para frente no bloco) ----
  for (let k = index - 1; k >= segmentStart && over > 0; k--) {
    const w = work[k]
    if (!w || w.dropped || isProtected(w.item) || w.aired > 0) continue
    if (!isOptional(w.item)) continue

    w.dropped = true
    const dropFrames = w.duration
    w.adjustments.push({
      kind: w.item.onOverrun === 'SKIP' ? 'SKIPPED' : 'DROPPED',
      frames: dropFrames,
      reason: 'Item opcional descartado para salvar a âncora seguinte.',
    })
    actions.push({
      itemId: w.item.id,
      itemTitle: w.item.title,
      actionType: 'DROP_ITEM',
      deltaFrames: dropFrames,
      originalDuration: dropFrames,
      newDuration: 0,
      plannedDurationFrames: w.item.duration,
      effectiveDurationFrames: 0,
      targetAnchorId: anchored.item.id,
      targetAnchorType,
      reason: 'Item opcional descartado para salvar a âncora seguinte.',
      timestamp,
    })
    over -= dropFrames
  }

  // ---- PASSO 3: Cortar cauda de TRIMMABLE até minDuration (de trás para frente) ----
  for (let k = index - 1; k >= segmentStart && over > 0; k--) {
    const w = work[k]
    if (!w || w.dropped || isProtected(w.item)) continue
    if (!isTrimmable(w.item)) continue

    // Regra de salvaguarda: piso mínimo é minDuration, ou 70% da duração original caso não declarada
    const configuredMin =
      w.item.minDuration > 0 ? w.item.minDuration : Math.round(w.item.duration * 0.7)
    const floor = Math.max(configuredMin, w.aired)
    const available = w.duration - floor
    if (available <= 0) continue

    const take = Math.min(available, over)
    const prevDuration = w.duration
    w.duration -= take
    w.adjustments.push({
      kind: 'TRIMMED',
      frames: take,
      reason: `Cortado ${formatDuration(take, rate)} para segurar a âncora.`,
    })
    actions.push({
      itemId: w.item.id,
      itemTitle: w.item.title,
      actionType: 'TRIM_TAIL',
      deltaFrames: take,
      originalDuration: prevDuration,
      newDuration: w.duration,
      plannedDurationFrames: w.item.duration,
      effectiveDurationFrames: w.duration,
      targetAnchorId: anchored.item.id,
      targetAnchorType,
      reason: `Corte de cauda de ${formatDuration(take, rate)} aplicado para recuperar tempo.`,
      timestamp,
    })
    over -= take
  }

  // Se descartar recuperou mais do que devia, elásticos devolvem a diferença
  if (over < 0) {
    stretchElastics(work, segmentStart, index, -over, rate, actions, anchored, timestamp)
  }

  let newCursor = relayout(work, segmentStart, index, segmentCursor)
  if (newCursor <= windowTo) return newCursor

  const remaining = newCursor - windowTo

  // ---- PASSO 5: Emergency Truncation em caso de HARD_TIME mandatório ----
  if (isHardTime(anchored.item)) {
    // Interrompe ou descarta itens anteriores que passem de windowTo de trás para frente
    for (let k = index - 1; k >= segmentStart; k--) {
      const w = work[k]
      if (!w || w.dropped) continue
      if (w.start >= windowTo) {
        const cut = w.duration
        w.dropped = true
        w.duration = 0
        w.end = w.start
        w.adjustments.push({
          kind: 'DROPPED',
          frames: cut,
          reason: 'Emergency Truncation forçado no frame zero do HARD_TIME.',
        })
        actions.push({
          itemId: w.item.id,
          itemTitle: w.item.title,
          actionType: 'EMERGENCY_CUT',
          deltaFrames: cut,
          originalDuration: cut,
          newDuration: 0,
          plannedDurationFrames: w.item.duration,
          effectiveDurationFrames: 0,
          targetAnchorId: anchored.item.id,
          targetAnchorType: 'HARD_TIME',
          reason: 'Emergency Truncation forçado no frame zero do HARD_TIME.',
          timestamp,
        })
        continue
      }

      if (w.end > windowTo) {
        const floor = Math.max(w.aired, 0)
        const wanted = Math.max(windowTo - w.start, floor)
        const cut = w.duration - wanted
        if (cut > 0) {
          const prevDuration = w.duration
          w.duration = wanted
          w.end = w.start + w.duration
          w.adjustments.push({
            kind: 'TRIMMED',
            frames: cut,
            reason: 'Emergency Truncation forçado no frame zero do HARD_TIME.',
          })
          actions.push({
            itemId: w.item.id,
            itemTitle: w.item.title,
            actionType: 'EMERGENCY_CUT',
            deltaFrames: cut,
            originalDuration: prevDuration,
            newDuration: wanted,
            plannedDurationFrames: w.item.duration,
            effectiveDurationFrames: wanted,
            targetAnchorId: anchored.item.id,
            targetAnchorType: 'HARD_TIME',
            reason: 'Emergency Truncation forçado no frame zero do HARD_TIME.',
            timestamp,
          })
        }
      }
      break
    }
    newCursor = relayout(work, segmentStart, index, segmentCursor)
    conflicts.push({
      kind: 'OVERRUN',
      itemId: anchored.item.id,
      frames: remaining,
      severity: 'ERROR',
      message: `Emergency Truncation forçado no frame zero para respeitar HARD_TIME às ${formatClock(windowTo, rate)}.`,
    })
    return windowTo
  }

  if (isFixed(anchored.item)) {
    const deficit = forceCutBefore(work, index, windowTo, actions, anchored, timestamp)
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
    return Math.max(windowTo, newCursor)
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
  const actions: CompensationAction[] = []
  let totalInitialDrift = 0

  const actionTimestamp = (input as any).generatedAt ?? '1970-01-01T00:00:00.000Z'

  const work: Work[] = items.map((item) => {
    // Suporte a items LIVE: utiliza estimatedDuration de liveConfig se configurado
    const baseDuration =
      item.liveConfig?.estimatedDuration && item.liveConfig.estimatedDuration > 0
        ? item.liveConfig.estimatedDuration
        : item.duration

    return {
      item,
      duration: baseDuration,
      dropped: false,
      start: 0,
      end: 0,
      state: 'PENDING',
      adjustments: [],
      anchorHit: true,
      deviation: 0,
      pinnedStart: null,
      aired: 0,
    }
  })

  if (work.length === 0) {
    return {
      items: [],
      conflicts,
      suggestions,
      endsAt: input.plannedStart,
      compensationReport: {
        rundownId: (input as any).rundownId,
        generatedAt: actionTimestamp,
        rateNum: rate.num,
        rateDen: rate.den,
        initialDriftFrames: 0,
        compensatedDriftFrames: 0,
        residualDriftFrames: 0,
        actions: [],
        status: 'RESOLVED_CLEAN',
      },
    }
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
    // Se estiver no ar e exceder a duração planejada (ex: LIVE ou atraso VT), estende a duração no cálculo
    const currentAired = onAir.elapsed
    if (currentAired > w.duration) {
      w.duration = currentAired
    }
    w.aired = Math.min(currentAired, w.duration)
    w.state = 'ON_AIR'
    w.start = onAir.startedAt
    w.end = w.start + w.duration

    // Alerta de maxDuration para transmissões LIVE
    if (w.item.liveConfig?.maxDuration && currentAired > w.item.liveConfig.maxDuration) {
      conflicts.push({
        kind: 'OVERRUN',
        itemId: w.item.id,
        frames: currentAired - w.item.liveConfig.maxDuration,
        severity: 'WARN',
        message: `Transmissão ao vivo excedeu a duração máxima de ${formatDuration(w.item.liveConfig.maxDuration, rate)}.`,
      })
    }

    cursor = w.end
    segmentStart = onAirIndex
  } else {
    // Nada no ar e início da grade já vencido: projeta a partir de agora.
    cursor =
      input.now === null ? input.plannedStart : Math.max(input.plannedStart, input.now)
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

    // Âncora vencida não puxa a grade para trás.
    if (input.now !== null && window.to < input.now) {
      const late = input.now - window.to
      conflicts.push({
        kind: 'ANCHOR_PAST',
        itemId: item.id,
        frames: late,
        severity: 'ERROR',
        message:
          `A âncora de ${formatClock(window.to, rate)} já passou ` +
          `(agora são ${formatClock(input.now, rate)}). O item entra no fluxo.`,
      })
      suggestions.push({
        itemId: item.id,
        action: 'MOVE_ANCHOR',
        frames: late,
        message: 'Marcar outra hora para este item, ou soltá-lo na sequência.',
      })

      w.start = cursor
      w.end = w.start + w.duration
      cursor = w.end
      continue
    }

    if (cursor < window.from) {
      totalInitialDrift += window.from - cursor
      cursor = fillGap(
        w,
        work,
        segmentStart,
        i,
        segmentCursor,
        cursor,
        window.from,
        rate,
        conflicts,
        suggestions,
        actions,
        actionTimestamp,
      )
    } else if (cursor > window.to) {
      totalInitialDrift += cursor - window.to
      cursor = recoverTime(
        w,
        work,
        segmentStart,
        i,
        segmentCursor,
        cursor,
        window.to,
        rate,
        lastAnchorWasFixed,
        conflicts,
        suggestions,
        actions,
        actionTimestamp,
      )
    }

    w.start = Math.max(cursor, window.from)
    w.end = w.start + w.duration
    cursor = w.end

    const target = anchorTarget(item.anchor)
    w.deviation = target === null ? 0 : w.start - target
    w.anchorHit = w.start >= window.from && w.start <= window.to

    if (isFixed(item)) {
      lastAnchorWasFixed = true
      segmentStart = i
      segmentCursor = w.start
    } else {
      lastAnchorWasFixed = false
    }
  }

  // Um relayout posterior pode ter movido âncoras flexíveis já processadas.
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

  const compensatedDriftFrames = actions.reduce((sum, a) => sum + a.deltaFrames, 0)
  const residualDriftFrames = conflicts
    .filter(
      (c) =>
        c.kind === 'OVERRUN' ||
        c.kind === 'GAP' ||
        c.kind === 'ANCHOR_MISSED' ||
        c.kind === 'ANCHOR_IMPOSSIBLE',
    )
    .reduce((sum, c) => sum + c.frames, 0)

  const status: ScheduleCompensationStatus = (() => {
    if (actions.some((a) => a.actionType === 'EMERGENCY_CUT')) {
      return 'HARD_TIME_VIOLATION_PREVENTED'
    }
    if (conflicts.some((c) => c.kind === 'GAP')) {
      return 'CRITICAL_UNDERRUN'
    }
    if (conflicts.some((c) => c.severity === 'ERROR' || c.kind === 'ANCHOR_MISSED')) {
      return 'RESOLVED_WITH_WARNINGS'
    }
    return 'RESOLVED_CLEAN'
  })()

  const compensationReport: ScheduleCompensationReport = {
    rundownId: (input as any).rundownId,
    generatedAt: actionTimestamp,
    rateNum: rate.num,
    rateDen: rate.den,
    initialDriftFrames: totalInitialDrift,
    compensatedDriftFrames,
    residualDriftFrames,
    actions,
    status,
  }

  return {
    items: resolved,
    conflicts,
    suggestions,
    endsAt: lastLive?.end ?? input.plannedStart,
    compensationReport,
  }
}
