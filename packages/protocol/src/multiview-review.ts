import type {MultiviewCell,MultiviewLayout} from './sources.js'
export interface MultiviewReview {
  id:string|null;channelId:string|null;layout:MultiviewLayout;cells:MultiviewCell[];updatedAt:string|null;revision:number
  /** Stored tally/peaks are historical configuration, never live evidence. */
  storedTelemetryIsHistorical:true;automaticTake:false;physicalSignalValidated:false
}
export const multiviewScope=(channelId:string|null)=>channelId===null?'G':`C:${channelId}`
export function multiviewETag(channelId:string|null,revision:number){
  if(!Number.isSafeInteger(revision)||revision<1)throw new Error('Revisão multiview inválida.')
  return `"multiview:${encodeURIComponent(multiviewScope(channelId))}:${revision}"`
}
