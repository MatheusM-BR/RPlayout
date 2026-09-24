import {
  effectiveGainDb,
  resolveAudio,
  resolveTrim,
  trimDuration,
  type AudioLevel,
  type Channel,
  type Frames,
  type MediaAsset,
  type PlanItem,
  type Rate,
  type ResolveResult,
  type Rundown,
  type RundownItem,
  type Trim,
  type ValueSource,
} from '@rplayout/protocol'
import { resolve } from '@rplayout/scheduler'

/**
 * Duração no ar do item: o corte manda quando existe arquivo; sem arquivo,
 * vale a duração declarada ou estimada do live. É esta a duração que o scheduler recebe.
 */
export function itemDuration(
  item: RundownItem,
  asset: MediaAsset | undefined,
  rate: Rate,
): Frames {
  if (item.type === 'LIVE' || item.eventType === 'LIVE') {
    const liveEst = item.liveConfig?.estimatedDuration ?? item.liveEstimatedDuration
    if (liveEst && liveEst > 0) return liveEst
    if (item.durationOverride !== null && item.durationOverride > 0) return item.durationOverride
    return 0
  }
  if (!asset) return item.durationOverride ?? 0
  if (item.durationOverride !== null) return item.durationOverride
  return trimDuration(resolveTrim(item.trim, asset, rate).value)
}

export function toPlanItem(
  item: RundownItem,
  asset: MediaAsset | undefined,
  rate: Rate,
): PlanItem {
  const duration = itemDuration(item, asset, rate)
  const eventType =
    item.eventType ??
    (item.type === 'LIVE'
      ? 'LIVE'
      : item.type === 'FILLER'
        ? 'FILLER'
        : item.anchor.kind === 'HARD_TIME'
          ? 'HARD_TIME'
          : item.anchor.kind === 'FIXED'
            ? 'FIXED'
            : 'SEQUENTIAL')

  const timingFlags = item.timingFlags ?? {
    trimmable: item.trimmable ?? item.onOverrun === 'TRIM_PREV',
    optional: item.optional ?? (item.onOverrun === 'DROP_FILLER' || item.onOverrun === 'SKIP'),
    protected: item.protected ?? item.locked,
  }

  const liveConfig =
    item.liveConfig ??
    (item.type === 'LIVE' || item.sourceRef || item.liveEndpoint
      ? {
          sourceType: (item.liveSourceType ?? 'SRT') as any,
          sourceEndpoint: item.liveEndpoint ?? item.sourceRef ?? '',
          estimatedDuration: item.liveEstimatedDuration ?? item.durationOverride ?? 0,
          maxDuration: item.liveMaxDuration ?? null,
          autoFollowOnEnd: item.liveAutoFollowOnEnd ?? false,
          fallbackMediaId: item.liveFallbackMediaId ?? null,
        }
      : null)

  return {
    id: item.id,
    order: item.order,
    title: item.title,
    duration,
    // Um mínimo maior que a duração travaria o corte; o piso nunca passa dela.
    minDuration: Math.min(item.minDuration, duration),
    anchor: item.anchor,
    onOverrun: item.onOverrun,
    elastic: item.elastic,
    isFiller: item.type === 'FILLER' || eventType === 'FILLER',
    locked: item.locked || timingFlags.protected,
    eventType,
    timingFlags,
    liveConfig,
  }
}

/** O item com tudo que a interface precisa mostrar já resolvido. */
export interface ItemView {
  readonly item: RundownItem
  readonly asset: MediaAsset | null
  readonly trim: Trim
  readonly trimSource: ValueSource
  readonly audio: AudioLevel
  readonly audioSource: ValueSource
  /** Ganho que o engine aplicaria neste item agora. */
  readonly gainDb: number
  /** Quantos outros itens usam o mesmo arquivo — habilita o escopo em lote. */
  readonly siblingCount: number
}

export interface RundownView {
  readonly rundown: Rundown
  readonly channel: Channel
  readonly items: readonly ItemView[]
  readonly schedule: ResolveResult
}

export function buildView(
  rundown: Rundown,
  channel: Channel,
  items: readonly RundownItem[],
  assets: ReadonlyMap<string, MediaAsset>,
  now: Frames | null,
  onAir: { itemId: string; startedAt: Frames; elapsed: Frames } | null,
): RundownView {
  const ordered = [...items].sort((a, b) => a.order - b.order)

  const usage = new Map<string, number>()
  for (const item of ordered) {
    if (item.mediaId) usage.set(item.mediaId, (usage.get(item.mediaId) ?? 0) + 1)
  }

  const views: ItemView[] = ordered.map((item) => {
    const asset = item.mediaId ? (assets.get(item.mediaId) ?? null) : null

    if (!asset) {
      const audio = item.audio ?? { mode: 'OFF' as const, gainDb: 0, measured: null }
      return {
        item,
        asset: null,
        trim: { in: 0, out: item.durationOverride ?? 0 },
        trimSource: 'NONE',
        audio,
        audioSource: item.audio ? 'ITEM' : 'NONE',
        gainDb: effectiveGainDb(audio, channel.targetLufs, channel.ceilingDbtp),
        siblingCount: 0,
      }
    }

    const trim = resolveTrim(item.trim, asset, channel.rate)
    const audio = resolveAudio(item.audio, asset)
    return {
      item,
      asset,
      trim: trim.value,
      trimSource: trim.source,
      audio: audio.value,
      audioSource: audio.source,
      gainDb: effectiveGainDb(audio.value, channel.targetLufs, channel.ceilingDbtp),
      siblingCount: usage.get(asset.id) ?? 1,
    }
  })

  // Alinha o início planejado da grade com a hora real atual:
  // Se a grade está em loop contínuo ou o início planejado já passou em relação a agora,
  // projeta a grade a partir do horário real corrente (now ou onAir.startedAt).
  const effectivePlannedStart = (() => {
    if (now === null) return rundown.plannedStart
    if (onAir) return onAir.startedAt
    if (
      rundown.loop ||
      rundown.plannedStart < now ||
      Math.abs(rundown.plannedStart - now) > 12 * 3600 * (channel.rate.num / channel.rate.den)
    ) {
      return now
    }
    return rundown.plannedStart
  })()

  const schedule = resolve({
    rate: channel.rate,
    items: ordered.map((item) => {
      const asset = item.mediaId ? assets.get(item.mediaId) : undefined
      const plan = toPlanItem(item, asset, channel.rate)
      if (item.id !== onAir?.itemId && item.mediaId && (!asset || asset.probeError)) {
        return { ...plan, duration: 0, minDuration: 0, anchor: { kind: 'FLOW' as const }, locked: false }
      }
      return plan
    }),
    now,
    onAir,
    plannedStart: effectivePlannedStart,
    rundownId: rundown.id,
  } as any)

  const unavailable = views.filter((entry) => entry.item.id !== onAir?.itemId &&
    entry.item.mediaId && (!entry.asset || entry.asset.probeError))
  const unavailableIds = new Set(unavailable.map((entry) => entry.item.id))
  return { rundown, channel, items: views, schedule: {
    ...schedule,
    items: schedule.items.map((entry) => unavailableIds.has(entry.id) ? { ...entry, state: 'DROPPED' as const } : entry),
    conflicts: [...schedule.conflicts, ...unavailable.map((entry) => ({
      kind: 'MEDIA_UNAVAILABLE' as const, itemId: entry.item.id, frames: 0,
      severity: 'ERROR' as const, message: `Será pulado: ${entry.asset?.probeError ?? 'arquivo removido do acervo'}`,
    }))],
  } }
}
