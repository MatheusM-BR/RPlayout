import type { RundownView } from './plan.js'
import type { CacheSequenceEntry } from './continuity-cache.js'

/** Conservative ordered proof for the currently loaded published playlist.
 * Do not invent daily transitions, infinite loop hours or an available live
 * signal from a downloaded collection. A gap/live/manual hold stops autonomy. */
export function cacheSequence(view: RundownView | null, onAir: { itemId: string; elapsed: number } | null): CacheSequenceEntry[] {
  if (!view) return []
  const fps = view.channel.rate.num / view.channel.rate.den
  const scheduled = view.schedule.items.filter(entry => entry.state !== 'DROPPED')
  const startIndex = onAir ? scheduled.findIndex(entry => entry.id === onAir.itemId) : 0
  if (startIndex < 0) return []
  const result: CacheSequenceEntry[] = []
  let previousEnd: number | null = null
  for (let index = startIndex; index < scheduled.length; index++) {
    const timing = scheduled[index]!
    const entry = view.items.find(candidate => candidate.item.id === timing.id)
    if (!entry) break
    if (previousEnd !== null && timing.start > previousEnd) result.push({ asset: null, durationSeconds: (timing.start - previousEnd) / fps })
    const elapsed = index === startIndex && onAir ? onAir.elapsed : 0
    const durationSeconds = Math.max(0, timing.duration - elapsed) / fps
    if (durationSeconds <= 0) break
    const isFile = entry.asset && !entry.asset.probeError && !entry.item.sourceRef && !entry.item.liveEndpoint && entry.item.type !== 'LIVE' && entry.item.eventType !== 'LIVE'
    result.push({ asset: isFile ? entry.asset : null, durationSeconds })
    previousEnd = timing.start + timing.duration
    if (!entry.item.autoNext || entry.item.loop) {
      // The file itself is locally available, but no automatic next transition
      // was authorized (or a per-item loop changes the published timing).
      result.push({ asset: null, durationSeconds: 1 })
      break
    }
  }
  return result
}
