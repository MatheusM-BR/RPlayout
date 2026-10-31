import {durationIn,isStill,resolveTrim,secondsToFrames,STILL_DEFAULT_SECONDS,type ResolvedItem,type Rate,type Trim,type RundownItem,type MediaAsset} from '@rplayout/protocol'
import type {ItemView,RundownView} from './plan.js'

/** A projected cut for an anchored LIVE is conditional on a real source TAKE.
 * Do not encode that projection as file EOS, which would defeat signal gating.
 * Explicit media cuts and adjustments for non-live anchors remain authoritative. */
function liveAdmissionDuration(entry:Pick<ItemView,'item'>,timing:ResolvedItem,context:Pick<RundownView,'items'|'schedule'>):number {
  const changes=(context.schedule.compensationReport?.actions??[]).filter(action=>action.itemId===entry.item.id
    &&Number.isSafeInteger(action.originalDuration)&&Number.isSafeInteger(action.newDuration)
    &&action.originalDuration!>=0&&action.newDuration!>=0&&action.originalDuration!==action.newDuration)
  if(!changes.length)return timing.duration
  const targets=new Set(context.items.filter(({item})=>(item.type==='LIVE'||item.eventType==='LIVE')
    &&Boolean(item.sourceRef||item.liveEndpoint||item.liveConfig?.sourceEndpoint)
    &&(item.anchor?.kind==='HARD_TIME'||item.anchor?.kind==='FIXED')).map(({item})=>item.id))
  const conditional=(action:typeof changes[number])=>action.originalDuration!>action.newDuration!&&Boolean(action.targetAnchorId&&targets.has(action.targetAnchorId))
  if(!changes.some(conditional))return timing.duration
  let duration=timing.duration
  // Reports are ordered transformations. An independent adjustment AFTER a
  // conditional cut still wins; an earlier cut cannot erase a later stretch.
  for(const action of changes)duration=conditional(action)?Math.max(duration,action.originalDuration!):action.newDuration!
  return duration
}

/** Declared file mount before dynamic timing. Analysis and adoption must use
 * the same duration override as execution, never silently clamp or loop. */
export function declaredFileTrim(item:Pick<RundownItem,'trim'>&Partial<Pick<RundownItem,'durationOverride'>>,asset:MediaAsset,rate:Rate):Trim {
  if(!Number.isSafeInteger(rate.num)||!Number.isSafeInteger(rate.den)||rate.num<=0||rate.den<=0)throw new Error('Cadência inválida para corte declarado.')
  const original=resolveTrim(item.trim,asset,rate).value,duration=item.durationOverride
  if(duration!==null&&duration!==undefined&&(!Number.isSafeInteger(duration)||duration<=0))throw new Error('Duração declarada não reproduzível.')
  const cut={in:original.in,out:duration===null||duration===undefined?original.out:original.in+duration},available=durationIn(asset,rate)
  if(!Number.isSafeInteger(cut.in)||!Number.isSafeInteger(cut.out)||cut.in<0||cut.out<=cut.in||!Number.isSafeInteger(available)||available<=0||cut.out>available)throw new Error('Corte declarado excede ou invalida quadros do arquivo.')
  return cut
}

/** Resolve only at mount; historical items keep their declared cut on return. */
export function executionTrim(entry:Pick<ItemView,'item'|'asset'|'trim'>,timing:ResolvedItem|undefined,rate:Rate,context?:Pick<RundownView,'items'|'schedule'>):Trim {
  const still=Boolean(entry.asset&&isStill(entry.asset))
  const base=entry.item.durationOverride??(still?secondsToFrames(STILL_DEFAULT_SECONDS,rate):entry.trim.out-entry.trim.in)
  const planned=timing&&!['DONE','ON_AIR'].includes(timing.state)?context?liveAdmissionDuration(entry,timing,context):timing.duration:base
  if(!Number.isSafeInteger(planned)||planned<=0)throw new Error('O timing não contém duração reproduzível para este item.')
  const trim={in:still?0:entry.trim.in,out:(still?0:entry.trim.in)+planned}
  if(!Number.isSafeInteger(trim.in)||trim.in<0||!Number.isSafeInteger(trim.out))throw new Error('O corte operacional contém posição inválida.')
  if(!still&&entry.asset){
    const available=durationIn(entry.asset,rate)
    if(Number.isFinite(available)&&trim.out>available)throw new Error('A duração resolvida excede os quadros do arquivo. Insira outro filler ou revise os limites elásticos; o engine não pode fabricar esse tempo.')
  }
  return trim
}
