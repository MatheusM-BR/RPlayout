import type {ManagedLiveSource} from './sources.js'

/** A read baseline, not discovery or proof of a usable signal. */
export interface LiveSourceReview {
  channelId:string
  revision:number
  sources:ManagedLiveSource[]
  automaticTake:false
  physicalSignalValidated:false
}
export function liveSourceETag(channelId:string,revision:number):string {
  if(!channelId || !Number.isSafeInteger(revision)||revision<1)throw new Error('Conferência de entradas inválida.')
  return `"sources:${encodeURIComponent(channelId)}:${revision}"`
}
