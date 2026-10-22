import type {Transport} from './transport.js'
import {ProcessMetrics} from './process-metrics.js'
import {installationVault} from './secret-vault.js'
import {safeMetricLabel,type MetricLabels} from './operational-metric-labels.js'
export interface MetricRuntime {
  channel:{id:string}
  transport:Pick<Transport,'state'|'health'|'processId'|'publishers'>
  telemetryIdentity():{revisionId:string|null;executionId:string|null}
}
export interface OperationalMetricFrame {
  version:1;capturedAt:string;available:boolean;channelsTruncated:boolean
  channels:Array<{
    channelId:string;rundownId:string|null;revisionId:string|null;executionId:string|null;itemId:string|null;itemName?:string|null;elapsedFrames:number|null;mode:string|null
    engine:{pid:number|null;ready:boolean;restarts:number;deaths:number;stalls:number;hasError:boolean;cpuTimeMs:number|null;memoryBytes:number|null}
    sources:Array<{sourceId:string;sourceName?:string|null;nameAmbiguous?:boolean;itemId:string;state:string;busItemIds:unknown;busSignals:unknown;busCatalog?:Partial<Record<'pgm'|'pvw',{configuredSourceId:string;sourceName:string|null;identityBasis:'PUBLISHED_ITEM'|'NATIVE_DECODER'}>>}>
    outputs:Array<{outputId:string;outputName?:string|null;nameAmbiguous?:boolean;identityType?:'PROFILE'|'ENDPOINT';state:string;attempts:number;delivered:number;hasError:boolean}>
    sourcesTruncated:boolean;outputsTruncated:boolean
  }>
}
/** Read-only snapshots of already instantiated runtimes; no runtimeFor/CUE,
 * discovery, publishers, external URLs or credentials are opened/persisted. */
export async function captureOperationalMetrics(runtimes:ReadonlyMap<string,MetricRuntime>,metrics:ProcessMetrics,labelsFor?:(runtime:MetricRuntime)=>MetricLabels):Promise<OperationalMetricFrame>{
  const selected=[...runtimes.values()].slice(0,256),initialPids=new Map(selected.map(runtime=>[runtime,runtime.transport.processId()])),pids=[...initialPids.values()].filter((pid):pid is number=>pid!==null)
  const counters=await metrics.latest(pids)
  const identity=(value:string,domain:string)=>installationVault(false).reviewIdentity(value,domain)
  const itemIdentity=(value:string)=>value.startsWith('source:')?`source:${identity(value.slice(7),'metric-source:v1')}`:value
  return {version:1,capturedAt:new Date().toISOString(),available:true,channelsTruncated:runtimes.size>selected.length,channels:selected.filter(runtime=>runtimes.get(runtime.channel.id)===runtime).map(runtime=>{
    const state=runtime.transport.state(),health=runtime.transport.health(),pid=runtime.transport.processId(),counter=pid!==null&&initialPids.get(runtime)===pid&&health.ready?counters.samples.get(pid):undefined,outputs=runtime.transport.publishers()
    let labels:MetricLabels|undefined;try{labels=labelsFor?.(runtime)}catch{/* Names unavailable: retain health data, never invent a label. */}
    return {channelId:runtime.channel.id,rundownId:state.rundownId,...runtime.telemetryIdentity(),itemId:state.onAir?itemIdentity(state.onAir.itemId):null,itemName:safeMetricLabel(state.onAir?labels?.items.get(state.onAir.itemId):null),elapsedFrames:state.onAir?.elapsed??null,mode:state.mode??null,
      engine:{pid,ready:health.ready,restarts:health.restarts,deaths:health.deaths,stalls:health.stalls,hasError:health.error!==null,cpuTimeMs:counter?.cpuTimeMs??null,memoryBytes:counter?.memoryBytes??null},
      sources:state.liveSources.slice(0,128).map(source=>{
        // Keep physical endpoint identity separate from catalog attribution.
        // A decoder may serve two published selections on different buses.
        // Upgrade attribution only after the current native decoder echoed
        // the exact selected catalog ID; identity does not establish signal.
        const busCatalog:Partial<Record<'pgm'|'pvw',{configuredSourceId:string;sourceName:string|null;identityBasis:'PUBLISHED_ITEM'|'NATIVE_DECODER'}>>={}
        for(const bus of ['pgm','pvw'] as const){
          const itemId=source.busItemIds?.[bus],binding=itemId?labels?.sourceItems?.get(itemId):undefined
          if(binding?.endpoint===source.source)busCatalog[bus]={configuredSourceId:identity(JSON.stringify([runtime.channel.id,binding.configuredId]),'metric-source-profile:v1'),sourceName:safeMetricLabel(binding.name),identityBasis:source.nativeCatalogBindings?.[bus]===binding.configuredId?'NATIVE_DECODER':'PUBLISHED_ITEM'}
        }
        return {sourceId:identity(source.source,'metric-source:v1'),sourceName:safeMetricLabel(labels?.sources.get(source.source)),nameAmbiguous:labels?.ambiguousSources?.has(source.source)??false,itemId:itemIdentity(source.itemId),state:source.state,busItemIds:source.busItemIds?Object.fromEntries(Object.entries(source.busItemIds).map(([bus,id])=>[bus,id===undefined?null:itemIdentity(id)])):null,busSignals:source.busSignals??null,busCatalog}
      }),
      outputs:outputs.slice(0,128).map(output=>{
        const profile=output.outputId?labels?.outputProfiles?.get(output.outputId):undefined
        return {outputId:output.outputId?identity(JSON.stringify([runtime.channel.id,output.outputId]),'metric-output-profile:v1'):identity(output.url,'metric-output:v1'),identityType:output.outputId?'PROFILE' as const:'ENDPOINT' as const,outputName:safeMetricLabel(output.outputId?(profile?.target===output.url?profile.name:null):labels?.outputs.get(output.url)),nameAmbiguous:!output.outputId&&(labels?.ambiguousOutputs?.has(output.url)??false),state:output.health,attempts:output.attempts,delivered:output.delivered,hasError:Boolean(output.error)}
      }),sourcesTruncated:state.liveSources.length>128,outputsTruncated:outputs.length>128}
  })}
}
export function scopedOperationalSample<T extends {operations?:OperationalMetricFrame}>(sample:T,allowed:(channelId:string)=>boolean,channelId?:string):T{
  if(!sample.operations)return sample
  return {...sample,operations:{...sample.operations,channels:sample.operations.channels.filter(channel=>allowed(channel.channelId)&&(!channelId||channel.channelId===channelId))}}
}
