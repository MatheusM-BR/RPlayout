/** Track presentation progress, not repeated canvas reads of a retained frame.
 * A paused file is intentionally inspectable; a stalled live decoder is not. */
export interface QcFrameProgress { position: number; advancedAt: number }
export function qcFrameProgress(previous: QcFrameProgress | null, position: number, now: number): QcFrameProgress | null {
  if (!Number.isFinite(position) || position < 0 || !Number.isFinite(now) || now < 0) return null
  if (!previous || position !== previous.position) return {position, advancedAt: now}
  return previous
}
export function qcLiveFrameRecent(progress: QcFrameProgress | null, now: number): boolean {
  if (!progress || !Number.isFinite(now)) return false
  const age = now - progress.advancedAt
  return age >= 0 && age <= 2000
}

/** Only a recent live decoder may bridge a short read gap with retained pixels.
 * File frames must belong to the current request; failed/loading JPEGs cannot
 * inherit a measurement from a different position or rendition. */
export function qcScopePixels(live:boolean,valid:boolean,current:Uint8ClampedArray|null,retained:Uint8ClampedArray|null):Uint8ClampedArray|null{
  if(!valid)return null
  return current ?? (live?retained:null)
}

/** Preserve React state identity only when every displayed measurement agrees.
 * Canvas sampling/rendering still runs; do not suppress a changed alarm. */
export function qcStableMeasurements<T extends object>(previous:T|null,next:T):T{
  if(!previous)return next
  const keys=Object.keys(next) as Array<keyof T>
  return Object.keys(previous).length===keys.length&&keys.every(key=>Object.is(previous[key],next[key]))?previous:next
}
