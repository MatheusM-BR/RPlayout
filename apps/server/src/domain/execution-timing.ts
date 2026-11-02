import type {RundownView} from './plan.js'

/** Wall-clock projections are not mutations of the published media contract. */
export function executionTimingKey(view:RundownView):string{
  return JSON.stringify({rundown:view.rundown,rate:view.channel.rate,items:view.items.map(entry=>({item:entry.item,trim:entry.trim,durationNs:entry.asset?.durationNs,durationFrames:entry.asset?.durationFrames}))})
}
export function freezeExecutionTiming(view:RundownView){
  return {key:executionTimingKey(view),schedule:structuredClone(view.schedule)}
}
export type FrozenExecutionTiming=ReturnType<typeof freezeExecutionTiming>
