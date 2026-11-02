import {eq} from 'drizzle-orm'
import type {Db} from '../db/client.js'
import {liveSources,outputProfiles} from '../db/schema.js'
import type {RundownView} from './plan.js'
import {targetOf} from './outputs.js'
import {MediaMtx,type ChannelPaths} from './mediamtx.js'
import {configuredSourceEndpoint} from './item-source-binding.js'
export interface MetricLabels {items:ReadonlyMap<string,string>;sources:ReadonlyMap<string,string>;outputs:ReadonlyMap<string,string>;ambiguousSources?:ReadonlySet<string>;ambiguousOutputs?:ReadonlySet<string>;outputProfiles?:ReadonlyMap<string,{target:string;name:string}>;sourceItems?:ReadonlyMap<string,{configuredId:string;endpoint:string;name:string}>}
/** Labels are snapshots, never endpoint-derived display names. Unsafe labels
 * remain absent rather than copying a URL, path or credential into history. */
export function safeMetricLabel(value:unknown):string|null{
  if(typeof value!=='string')return null
  const label=value.trim().normalize('NFC')
  if(!label||/[\u0000-\u001f\u007f]|:\/\/|\\|^[a-z]:|^\/|^(?:ndi|omt|sdi|guest|path):|(?:password|passphrase|token|secret|key)\s*=/i.test(label))return null
  return [...label].slice(0,160).join('')
}
function reference(ref:string){if(ref.startsWith('guest:'))return MediaMtx.internalRead(`guest/${ref.slice(6)}`);if(ref.startsWith('path:'))return MediaMtx.internalRead(ref.slice(5));return ref}
export function operationalMetricLabels(db:Db,channelId:string,path:ChannelPaths|undefined,view:RundownView|null):MetricLabels{
  const items=new Map<string,string>(),sources=new Map<string,string>(),outputs=new Map<string,string>()
  const ambiguousSources=new Set<string>(),ambiguousOutputs=new Set<string>(),profiles=new Map<string,{target:string;name:string}>()
  const catalog=new Map<string,{endpoint:string;name:string}>(),sourceItems=new Map<string,{configuredId:string;endpoint:string;name:string}>()
  const unique=(map:Map<string,string>,ambiguous:Set<string>,key:string,name:string)=>{if(ambiguous.has(key))return;if(map.has(key)){map.delete(key);ambiguous.add(key)}else map.set(key,name)}
  // Scope every database lookup. Observability never discovers or opens sources.
  for(const row of db.select().from(liveSources).where(eq(liveSources.channelId,channelId)).all()){
    const ref=configuredSourceEndpoint(row)
    unique(sources,ambiguousSources,reference(ref),row.name)
    catalog.set(row.id,{endpoint:reference(ref),name:row.name})
  }
  for(const entry of view?.items??[]){
    items.set(entry.item.id,entry.item.title)
    const id=entry.item.configuredSourceId,configured=id?catalog.get(id):undefined
    const endpoint=entry.item.sourceRef??entry.item.liveEndpoint??entry.item.liveConfig?.sourceEndpoint
    if(id&&configured&&endpoint&&reference(endpoint)===configured.endpoint)sourceItems.set(entry.item.id,{configuredId:id,...configured})
    // A published title is an item label, not proof of the selected configured
    // source. Direct/uncatalogued source names remain explicitly unavailable.
  }
  for(const row of db.select().from(outputProfiles).where(eq(outputProfiles.channelId,channelId)).all()){
    const target=targetOf(row,path)
    if(target){const address=row.kind==='SDI'?`sdi:${target.replace(/^sdi:/,'')}`:target;unique(outputs,ambiguousOutputs,address,row.name);profiles.set(row.id,{target:address,name:row.name})}
  }
  return {items,sources,outputs,ambiguousSources,ambiguousOutputs,outputProfiles:profiles,sourceItems}
}
