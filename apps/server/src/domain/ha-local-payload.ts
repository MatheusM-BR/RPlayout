import {createHash} from 'node:crypto'
import {audioCutIdentity,durationIn,hasMatchingAudioMeasurement,knownInputAudioChannels,resolveAudio,resolveTrim,resolvedAudioRouting,validateAudioRouting,validateAuxiliaryPairs,renderTemplate,type MediaAsset,type Rate,type RundownItem} from '@rplayout/protocol'
import {readOperationalPayload} from './operational-playlist.js'
import {haSourceBindingKey,type HaLocalInput} from './ha-bindings.js'
import {declaredFileTrim} from './execution-trim.js'
export interface LocalMountCheck {itemId:string;revisionId?:string;title?:string;errors:string[];warnings:string[];livePending:boolean}
export function inspectHaLocalMount(item:Pick<RundownItem,'trim'|'audio'|'audioTrack'>&Partial<Pick<RundownItem,'durationOverride'>>,asset:MediaAsset,rate:Rate,audioChannels:number,check:LocalMountCheck){
  try{
    if(asset.probeError||(asset.kind==='AUDIO'?asset.audioMetadata?.hasAudio!==true:!asset.probe))check.errors.push('LOCAL_DECODE_NOT_PROVEN')
    let cut
    // A declared cut beyond the local file is the specific finding, not a
    // generic mount failure.
    try{cut=asset.kind==='STILL'?resolveTrim(item.trim,asset,rate).value:declaredFileTrim(item,asset,rate)}catch{check.errors.push('TRIM_OUTSIDE_LOCAL_MEDIA');return}
    if(asset.kind!=='STILL'&&(!Number.isSafeInteger(cut.in)||!Number.isSafeInteger(cut.out)||cut.in<0||cut.out<=cut.in||cut.out>durationIn(asset,rate)))check.errors.push('TRIM_OUTSIDE_LOCAL_MEDIA')
    const track=item.audioTrack??0
    if(!Number.isSafeInteger(track)||track<0)check.errors.push('INVALID_AUDIO_TRACK')
    if(track>0&&!(asset.audioMetadata?.tracks??asset.probe?.audioTracks)?.some(row=>row.index===track))check.errors.push('LOCAL_AUDIO_TRACK_MISSING')
    const known=knownInputAudioChannels(asset,track),audio=resolveAudio(item.audio,asset,track,asset.kind==='STILL'?undefined:audioCutIdentity(cut,rate)).value
    const routing=resolvedAudioRouting(audio)
    if(validateAudioRouting(routing,known))check.errors.push('LOCAL_AUDIO_ROUTING_INVALID')
    if(validateAuxiliaryPairs(audio.auxiliaryPairs??[],audioChannels,known))check.errors.push('LOCAL_AUXILIARY_PAIRS_INVALID')
    if(audio.mode==='AUTO'&&!hasMatchingAudioMeasurement(audio,asset.contentHash,track,asset.kind==='STILL'?undefined:audioCutIdentity(cut,rate)))check.errors.push('SELECTED_AUDIO_MEASUREMENT_MISSING')
    if(track>0||routing.mode!=='DEFAULT'||(audio.auxiliaryPairs?.length??0)>0)check.warnings.push('LOCAL_SELECTED_MIX_RENDER_PENDING')
  }catch{check.errors.push('LOCAL_MOUNT_INVALID')}
}
/** A frozen SVG is portable only when its resources are self-contained.
 * This is a dependency inventory, not an XML/security validator or render proof. */
export function hasExternalGraphicResource(svg:string){
  if(/<!DOCTYPE|<!ENTITY|@import\b/i.test(svg))return true
  const references=[...svg.matchAll(/(?:\b(?:xlink:)?href\s*=\s*["']([^"']*)["']|\burl\(\s*["']?([^\s)'"<>]+))/gi)]
  return references.some(match=>{
    const value=(match[1]??match[2]??'').trim()
    // Encoded/escaped resource locations need an explicit local decision;
    // this inventory must not pretend to implement XML/CSS parsing.
    if(/[&\\]/.test(value))return true
    return value!==''&&!value.startsWith('#')&&!/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(value)
  })
}
/** Same graphic/automation inventory for review and derivative construction.
 * Render *fields* as on-air does, but never claim native pixel rendering here. */
export function inspectHaLocalGraphics(payload:ReturnType<typeof readOperationalPayload>,revisionId?:string,onComposition?:(check:LocalMountCheck,svg:string|null)=>void):LocalMountCheck[]{
  const checks:LocalMountCheck[]=[],templates=new Map((payload.graphics?.templates??[]).map(template=>[template.id,template]))
  if(templates.size!==(payload.graphics?.templates??[]).length)throw new Error('Templates publicados duplicados.')
  const references=[...(payload.graphics?.cues??[]).map(cue=>({itemId:cue.itemId,templateId:cue.templateId,values:cue.values??{}})),...(payload.secondaryEvents??[]).filter(event=>event.enabled&&(!event.type||event.type==='GRAPHICS_OVERLAY')).map(event=>({itemId:event.rundownItemId??'@event:'+event.id,templateId:event.templateId,values:Object.fromEntries(Object.entries(event.payload??{}).map(([key,value])=>[key,String(value)]))}))]
  if(references.length>100000)throw new Error('Grafismos excedem limite; não truncar como prontos.')
  for(const reference of references){
    const template=templates.get(reference.templateId),check:LocalMountCheck={revisionId,itemId:reference.itemId+':graphic:'+reference.templateId,title:template?.name??'Grafismo sem template',errors:[],warnings:[],livePending:false}
    let composition:string|null=null
    if(!template)check.errors.push('LOCAL_GRAPHIC_TEMPLATE_MISSING')
    else{
      check.warnings.push('LOCAL_GRAPHIC_RENDER_PENDING')
      try{
        if(Buffer.byteLength(template.svg)>4*1024*1024)throw new Error('SVG excede limite.')
        const rendered=renderTemplate({...template,fields:template.fields??[]},reference.values)
        if(Buffer.byteLength(rendered)>4*1024*1024)throw new Error('SVG preenchido excede limite.')
        if(hasExternalGraphicResource(rendered))check.errors.push('GRAPHIC_EXTERNAL_RESOURCE_LOCAL_BINDING_REQUIRED')
        composition=rendered
      }catch{check.errors.push('LOCAL_GRAPHIC_PAYLOAD_INVALID')}
    }
    onComposition?.(check,composition)
    checks.push(check)
  }
  for(const event of payload.secondaryEvents??[])if(event.enabled&&(event.type==='DEVICE_AUTOMATION'||event.type==='SCTE_TRIGGER'||event.deviceConfig||event.scteConfig))checks.push({revisionId,itemId:event.rundownItemId??'@event:'+event.id,errors:['EXTERNAL_AUTOMATION_LOCAL_BINDING_REQUIRED'],warnings:[],livePending:false})
  if(checks.length>100000)throw new Error('Grafismos/eventos excedem limite; não truncar como prontos.')
  return checks
}
/** Derived execution variant, not an in-place mutation of a published edition.
 * Original editorial IDs/clock/trims/mixes stay frozen and retain provenance. */
export function materializeHaPayload(input:Record<string,unknown>,sourceRevisionId:string,plan:{planId:string;bindingDigest:string;inputs:Array<{sourceKey:string;local:HaLocalInput}>},paths:ReadonlyMap<string,string>,localAssets:ReadonlyMap<string,MediaAsset>,rate:Rate,audioChannels:number){
  const original=readOperationalPayload(input),payload=structuredClone(original),checks:LocalMountCheck[]=[]
  if(!Number.isSafeInteger(rate.num)||!Number.isSafeInteger(rate.den)||rate.num<=0||rate.den<=0)throw new Error('Cadência local inválida.')
  const referenced=new Set(payload.items.flatMap(item=>[item.mediaId,item.liveFallbackMediaId,item.liveConfig?.fallbackMediaId]).filter(Boolean))
  payload.assets=(payload.assets??[]).filter(asset=>referenced.has(asset.id)).map(asset=>{
    const path=paths.get(asset.contentHash),local=localAssets.get(asset.id+':'+asset.contentHash)
    if(!path||!local)throw new Error('Mídia publicada sem cópia/análise local desta versão.')
    return {...asset,path,durationNs:local.durationNs,probe:local.probe,audioMetadata:local.audioMetadata,loudnessFile:local.loudnessFile,probeError:local.probeError}
  })
  payload.items=payload.items.map(item=>{
    const check:LocalMountCheck={itemId:item.id,title:item.title,errors:[],warnings:[],livePending:false};checks.push(check)
    for(const id of new Set([item.liveFallbackMediaId,item.liveConfig?.fallbackMediaId].filter((value):value is string=>Boolean(value)))){
      const fallback:LocalMountCheck={itemId:item.id+':fallback:'+id,title:item.title+' — contingência',errors:[],warnings:[],livePending:false};checks.push(fallback)
      const asset=payload.assets?.find(row=>row.id===id)
      if(!asset)fallback.errors.push('FALLBACK_MEDIA_VERSION_MISSING')
      else inspectHaLocalMount({trim:null,audio:null,audioTrack:null},asset,rate,audioChannels,fallback)
    }
    const reference=item.sourceRef??item.liveEndpoint??item.liveConfig?.sourceEndpoint
    if(reference){
      const local=plan.inputs.find(row=>row.sourceKey===haSourceBindingKey(reference))?.local
      if(!local)throw new Error('Entrada publicada sem vínculo local explícito.')
      for(const field of [item.sourceRef,item.liveEndpoint,item.liveConfig?.sourceEndpoint])if(field&&field!==reference)throw new Error('Item possui referências de entrada conflitantes.')
      check.livePending=true;check.warnings.push('LIVE_SIGNAL_LOCAL_PENDING')
      return {...item,configuredSourceId:local.key.startsWith('configured:')?local.key.slice('configured:'.length):null,sourceRef:local.reference,liveEndpoint:item.liveEndpoint?local.reference:item.liveEndpoint,liveConfig:item.liveConfig?{...item.liveConfig,sourceEndpoint:local.reference}:item.liveConfig}
    }
    const asset=payload.assets?.find(row=>row.id===item.mediaId)
    if(!asset){if(item.type!=='GFX')check.errors.push('MEDIA_VERSION_MISSING');return item}
    inspectHaLocalMount(item,asset,rate,audioChannels,check)
    return item
  })
  checks.push(...inspectHaLocalGraphics(payload))
  if(checks.length>100000)throw new Error('Montagens excedem limite; não truncar como prontas.')
  const identity=createHash('sha256').update(JSON.stringify([sourceRevisionId,plan.planId,plan.bindingDigest,payload])).digest('hex')
  return {id:'ha-local:'+identity,payload:{...payload,haOrigin:{version:1,sourceRevisionId,planId:plan.planId,bindingDigest:plan.bindingDigest}},checks}
}
