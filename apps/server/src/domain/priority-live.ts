import { framesToMs } from '@rplayout/protocol'
import type { RundownView } from './plan.js'
import { localDate, rundownMidnight } from './rundown-clock.js'

export interface PriorityLive { itemId: string; key: string; atMs: number; rundownId: string }
/** Only hard/fixed live anchors are mandatory. CUE remains a separate bus. */
export function priorityLives(view: RundownView, nowMs: number): PriorityLive[] {
  // Undated legacy fixtures retain their current-day clock. A dated grade
  // never gets rebased to today; due-window filtering belongs to transport.
  const base = rundownMidnight(view.rundown.date ?? localDate(new Date(nowMs)))
  if (base === null || !Number.isFinite(nowMs)) return []
  return view.items.flatMap(({ item }) => {
    if (!(item.type === 'LIVE' || item.eventType === 'LIVE') || !(item.sourceRef || item.liveEndpoint || item.liveConfig?.sourceEndpoint)) return []
    if (item.anchor?.kind !== 'FIXED' && item.anchor?.kind !== 'HARD_TIME') return []
    const atMs = base + framesToMs(item.anchor.at, view.channel.rate)
    if (!Number.isFinite(atMs) || item.anchor.at < 0) return []
    return [{ itemId: item.id, rundownId: view.rundown.id, atMs, key: `${view.rundown.id}:${item.id}:${atMs}:${item.sourceRef ?? item.liveEndpoint ?? item.liveConfig?.sourceEndpoint}` }]
  }).sort((left,right) => left.atMs-right.atMs)
}
export interface LivePriorityEvent {
  kind: 'REQUESTED' | 'CONFIRMED' | 'FAILED'
  rundownId: string
  itemId: string
  previousItemId: string
  previousFrames: number
  scheduledAt: string
  occurredAt: string
  reason?: string
}
