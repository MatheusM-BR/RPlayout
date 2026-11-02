import type { RundownItem } from '@rplayout/protocol'

/** An estimate is not permission to leave live. Explicit auto-follow governs
 * the transition; an estimated duration still drives conflict calculations. */
export function liveDurationLimit(item: RundownItem, scheduledDuration: number): number | null {
  const automatic = item.liveConfig?.autoFollowOnEnd ?? item.liveAutoFollowOnEnd ?? true
  if (!automatic) return null
  const estimate = item.liveConfig?.estimatedDuration ?? item.liveEstimatedDuration ?? item.durationOverride ?? scheduledDuration
  const maximum = item.liveConfig?.maxDuration ?? item.liveMaxDuration
  const candidates = [estimate, maximum].filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0)
  return candidates.length ? Math.min(...candidates) : null
}
