import { framesToMs } from '@rplayout/protocol'
import type { RundownView } from './plan.js'
import { localDate, rundownMidnight } from './rundown-clock.js'

export interface PriorityLive { itemId: string; key: string; atMs: number; rundownId: string }
/** Hard/fixed anchors (live sources and files) are mandatory. CUE remains a separate bus. */
export function priorityLives(view: RundownView, nowMs: number): PriorityLive[] {
  // Undated legacy fixtures retain their current-day clock. A dated grade
  // never gets rebased to today; due-window filtering belongs to transport.
  const base = rundownMidnight(view.rundown.date ?? localDate(new Date(nowMs)))
  if (base === null || !Number.isFinite(nowMs)) return []
  return view.items.flatMap(({ item }) => {
    // HORA FIXA vale para arquivo também: o planejador corta o que vem antes,
    // mas o item já no ar foi montado com a saída antiga e só acabaria no fim
    // dele -- o comercial das 04:10:00 entrava às 04:13:02. Na hora marcada o
    // transporte faz o TAKE, igual ao ao vivo.
    const live = (item.type === 'LIVE' || item.eventType === 'LIVE') && Boolean(item.sourceRef || item.liveEndpoint || item.liveConfig?.sourceEndpoint)
    const file = !live && item.type !== 'LIVE' && item.eventType !== 'LIVE' && Boolean(item.mediaId)
    if (!live && !file) return []
    if (item.anchor?.kind !== 'FIXED' && item.anchor?.kind !== 'HARD_TIME') return []
    const atMs = base + framesToMs(item.anchor.at, view.channel.rate)
    if (!Number.isFinite(atMs) || item.anchor.at < 0) return []
    return [{ itemId: item.id, rundownId: view.rundown.id, atMs, key: `${view.rundown.id}:${item.id}:${atMs}:${live ? item.sourceRef ?? item.liveEndpoint ?? item.liveConfig?.sourceEndpoint : `file:${item.mediaId}`}` }]
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
