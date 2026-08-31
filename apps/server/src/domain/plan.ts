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
  type ResolveResult,
  type Rundown,
  type RundownItem,
  type Trim,
  type ValueSource,
} from '@rplayout/protocol'
import { resolve } from '@rplayout/scheduler'

/**
 * Duração no ar do item: o corte manda quando existe arquivo; sem arquivo,
 * vale a duração declarada. É esta a duração que o scheduler recebe.
 */
export function itemDuration(item: RundownItem, asset: MediaAsset | undefined): Frames {
  if (!asset) return item.durationOverride ?? 0
  if (item.durationOverride !== null) return item.durationOverride
  return trimDuration(resolveTrim(item.trim, asset).value)
}

export function toPlanItem(item: RundownItem, asset: MediaAsset | undefined): PlanItem {
  const duration = itemDuration(item, asset)
  return {
    id: item.id,
    order: item.order,
    duration,
    // Um mínimo maior que a duração travaria o corte; o piso nunca passa dela.
    minDuration: Math.min(item.minDuration, duration),
    anchor: item.anchor,
    onOverrun: item.onOverrun,
    elastic: item.elastic,
    isFiller: item.type === 'FILLER',
    locked: item.locked,
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

    const trim = resolveTrim(item.trim, asset)
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

  const schedule = resolve({
    rate: channel.rate,
    items: ordered.map((item) => toPlanItem(item, item.mediaId ? assets.get(item.mediaId) : undefined)),
    now,
    onAir,
    plannedStart: rundown.plannedStart,
  })

  return { rundown, channel, items: views, schedule }
}
