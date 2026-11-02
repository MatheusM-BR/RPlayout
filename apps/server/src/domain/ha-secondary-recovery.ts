import {z} from 'zod'
import type {SecondaryEvent} from '@rplayout/protocol'
import {secondaryGraphicWindow} from './secondary-graphic-window.js'

const run=z.object({id:z.string().min(1),channelId:z.string().min(1),executionId:z.string().min(1),itemId:z.string().min(1),revisionId:z.string().nullable(),eventId:z.string().min(1),mode:z.enum(['FIRE','DISMISS']),state:z.enum(['FIRING','EXECUTED','FAILED']),frames:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)}).passthrough()
/** Classify one frozen foreign occurrence, never convert imported runs into
 * local EXECUTED rows or replay commands. Future occurrences are separate. */
export function prepareHaSecondaryRecovery(events:readonly SecondaryEvent[],journals:readonly Record<string,unknown>[],context:{channelId:string;executionId:string;revisionId:string|null;itemId:string;elapsed:number;duration:number}){
  for(const value of [context.elapsed,context.duration])if(!Number.isSafeInteger(value)||value<0)throw new Error('Janela de evento HA inválida.')
  if(!context.executionId||!context.itemId||!context.channelId)throw new Error('Ocorrência HA sem identidade de execução/item/canal.')
  const relevant=journals.filter(row=>row.channelId===context.channelId&&row.executionId===context.executionId&&row.itemId===context.itemId&&row.revisionId===context.revisionId&&row.eventId!==undefined&&row.mode!==undefined).map(row=>run.parse(row))
  if(new Set(relevant.map(row=>row.id)).size!==relevant.length)throw new Error('Ocorrências secundárias duplicadas no espelho HA.')
  const identities=relevant.map(row=>JSON.stringify([row.eventId,row.mode]))
  if(new Set(identities).size!==identities.length)throw new Error('Fases secundárias ambíguas na ocorrência HA.')
  const selected=events.filter(event=>event.enabled&&(!event.rundownItemId||event.rundownItemId===context.itemId))
  if(new Set(selected.map(event=>event.id)).size!==selected.length)throw new Error('Eventos publicados duplicados na ocorrência HA.')
  const blockers=relevant.filter(row=>row.state==='FIRING').map(row=>({eventId:row.eventId,sourceRunId:row.id,reason:'FOREIGN_RESULT_UNCERTAIN' as const}))
  const entries=selected.map(event=>{
    if(!Number.isSafeInteger(event.offsetFrames)||event.offsetFrames<0||event.durationFrames!=null&&(!Number.isSafeInteger(event.durationFrames)||event.durationFrames<0))throw new Error('Temporização secundária publicada inválida.')
    if(event.triggerMode==='OFFSET_BEFORE_END'&&context.duration===0)throw new Error('Evento relativo ao fim exige duração confirmada; live sem fim não pode usar zero como duração.')
    const fire=relevant.find(row=>row.eventId===event.id&&row.mode==='FIRE'),dismiss=relevant.find(row=>row.eventId===event.id&&row.mode==='DISMISS')
    if(dismiss&&!fire)throw new Error('Descarte secundário HA sem intenção de disparo correspondente.')
    const window=secondaryGraphicWindow(event,context.duration,context.elapsed,fire?.frames)
    const past=event.triggerMode!=='MANUAL'&&window.start<=context.elapsed
    const disposition=fire||dismiss||past?'SUPPRESSED_NO_REPLAY' as const:event.triggerMode==='MANUAL'?'MANUAL_ONLY' as const:'FUTURE' as const
    const localOwnershipRequired=!!fire&&fire.state==='EXECUTED'&&!dismiss&&!window.expired&&(!event.type||event.type==='GRAPHICS_OVERLAY')&&!event.deviceConfig&&!event.scteConfig
    return {eventId:event.id,disposition,window,sourceFireId:fire?.id??null,sourceDismissId:dismiss?.id??null,localOwnershipRequired,
      // A source outcome, including FAILED, never authorizes a new send here.
      seedFired:disposition==='SUPPRESSED_NO_REPLAY',seedDismissed:disposition==='SUPPRESSED_NO_REPLAY'}
  })
  return {version:1 as const,sourceOccurrence:{...context},entries,blockers,automaticReplay:false as const,localExecutionAdmitted:false as const}
}
