import type {OnAirState} from './scheduling.js'
/** Countdown/end-relative events use the mounted decoder, not editorial length. */
export function programDurationFrames(onAir:OnAirState|null|undefined,fallback:number):number{
  const duration=onAir?.mountedDuration??fallback
  return Number.isSafeInteger(duration)&&duration>=0?duration:0
}
