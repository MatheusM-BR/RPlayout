import type {SecondaryEvent} from '@rplayout/protocol'
/** Window belongs to the program occurrence, never to time since restart. */
export function secondaryGraphicWindow(event:SecondaryEvent,itemDuration:number,elapsed:number,manualFireFrame?:number){
  const start=event.triggerMode==='MANUAL'?manualFireFrame??Math.floor(elapsed):event.triggerMode==='OFFSET_BEFORE_END'?Math.max(0,itemDuration-event.offsetFrames):event.offsetFrames
  const end=event.durationFrames&&event.durationFrames>0?start+event.durationFrames:null
  return {start,end,expired:end!==null&&elapsed>=end,remainingFrames:end===null?undefined:Math.max(0,Math.ceil(end-elapsed))}
}
