import type {OperationalCompensationInput,Rate} from '@rplayout/protocol'
import type {ItemView} from '../types.js'
import {compensationActionHint,compensationDeltaFrames} from './compensation-input.js'

type Action=OperationalCompensationInput['action']
export interface CompensationConflict {kind:string;itemId:string;frames:number}
export interface CompensationConflictMeasure {
 key:string;itemId:string;anchorItemId:string;anchorTitle:string;action:Action
 conflictFrames:number;deltaFrames:number;secondsText:string;rate:Rate
}
/** Copy a scheduler measurement, not a second timing engine or a grant. Only
 * preceding items can compensate a future anchor; accepting delay targets
 * that flexible anchor itself. The server still reviews the frozen revision,
 * actual PGM/CUE, protected zones, media bounds and effective timing. */
export function compensationConflictMeasures(items:readonly ItemView[],itemId:string,action:Action,conflicts:readonly CompensationConflict[],rate:Rate):CompensationConflictMeasure[]{
 if(!itemId||action==='DROP_OPTIONAL'||!Number.isSafeInteger(rate.num)||!Number.isSafeInteger(rate.den)||rate.num<=0||rate.den<=0)return[]
 const indices=new Map(items.map((row,index)=>[row.item.id,index])),targetIndex=indices.get(itemId)??-1,target=items[targetIndex]
 if(!target||compensationActionHint(target.item,action))return[]
 const result:CompensationConflictMeasure[]=[],seen=new Set<string>()
 for(const conflict of conflicts){
  if(!Number.isSafeInteger(conflict.frames)||conflict.frames<=0)continue
  const anchorIndex=indices.get(conflict.itemId)??-1
  if(anchorIndex<0)continue
  let direction=0
  if(action==='ACCEPT_DELAY'){
   if(conflict.kind==='ANCHOR_MISSED'&&itemId===conflict.itemId)direction=1
  }else if(targetIndex<anchorIndex){
   if(conflict.kind==='GAP'&&action==='FILLER')direction=1
   if(['OVERRUN','ANCHOR_IMPOSSIBLE','ANCHOR_MISSED'].includes(conflict.kind)&&(action==='TRIM'||action==='FILLER'))direction=-1
  }
  if(!direction)continue
  const seconds=direction*conflict.frames*rate.den/rate.num
  if(!Number.isFinite(seconds)||Math.abs(seconds)>600)continue
  const key=JSON.stringify([conflict.kind,conflict.itemId,conflict.frames])
  if(seen.has(key))continue
  seen.add(key)
  result.push({key,itemId,anchorItemId:conflict.itemId,anchorTitle:items[anchorIndex]!.item.title,action,
   conflictFrames:conflict.frames,deltaFrames:direction*conflict.frames,
   secondsText:seconds.toLocaleString('en-US',{useGrouping:false,maximumFractionDigits:18}),rate:{...rate}})
 }
 return result
}
/** Frozen operator intent survives a live timing tick. Editing the text,
 * target or action invalidates the copied exact-frame value. Do not silently
 * replace a reviewed amount as the live duration keeps changing. */
export function compensationMeasuredDelta(itemId:string,action:Action,seconds:string,rate:Rate,measure:CompensationConflictMeasure|null):number{
 if(measure&&measure.itemId===itemId&&measure.action===action&&measure.secondsText===seconds){
  if(measure.rate.num!==rate.num||measure.rate.den!==rate.den)throw new Error('A cadência mudou desde a cópia do conflito. Copie a medida novamente ou informe o ajuste em segundos.')
  return measure.deltaFrames
 }
 return compensationDeltaFrames(action,seconds,rate)
}
