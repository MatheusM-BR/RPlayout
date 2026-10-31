import { msToFrames, type Rate,type OnAirState } from '@rplayout/protocol'

export const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

/** Anchors are elapsed frames from this grade's local midnight, not from
 * today's midnight. The epoch also keeps a >24h anchor fixed across rollover. */
export function rundownMidnight(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const [year, month, day] = date.split('-').map(Number)
  const value = new Date(0)
  value.setFullYear(year!, month! - 1, day!)
  value.setHours(0, 0, 0, 0)
  return localDate(value) === date ? value.getTime() : null
}

export function rundownFrames(date: string, rate: Rate, now = new Date()): number | null {
  const base = rundownMidnight(date), instant = now.getTime()
  if (base === null || !Number.isFinite(instant) || !Number.isFinite(rate.num / rate.den) || rate.num <= 0 || rate.den <= 0) return null
  return msToFrames(instant - base, rate)
}

/** Transport elapsed is authoritative. Rebase only the planner's copy;
 * never reset a decoder, seek PGM, or rewrite its transport/checkpoint clock. */
export function rundownClock(date: string, rate: Rate, now: Date,
  onAir: OnAirState | null) {
  const frames = rundownFrames(date, rate, now)
  return { now: frames, onAir: frames === null || !onAir ? null : { ...onAir, startedAt: frames - onAir.elapsed } }
}
