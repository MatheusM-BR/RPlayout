import {IncidentContextSchema,type IncidentContext} from '@rplayout/protocol'
import type {MetricRuntime} from './operational-metrics.js'
import {installationVault} from './secret-vault.js'
import {safeMetricLabel,type MetricLabels} from './operational-metric-labels.js'

/** Snapshot only an existing runtime. No discovery, CUE, process launch or I/O. */
export function captureIncidentContext(runtime:MetricRuntime,labels?:MetricLabels):IncidentContext{
  const state=runtime.transport.state(),hash=(value:string,domain:string)=>installationVault(false).reviewIdentity(value,domain)
  const item=(value:string)=>value.startsWith('source:')?'source:'+hash(value.slice(7),'metric-source:v1'):value
  const sources=state.liveSources.slice(0,32).map(source=>{
    const binding=source.busItemIds?.pgm?labels?.sourceItems?.get(source.busItemIds.pgm):undefined
    return {identity:hash(source.source,'metric-source:v1'),name:safeMetricLabel(labels?.sources.get(source.source)),state:safeMetricLabel(source.state),pgm:safeMetricLabel(source.busSignals?.pgm?.status),pvw:safeMetricLabel(source.busSignals?.pvw?.status),
      pgmSelection:binding?.endpoint===source.source?{identity:hash(JSON.stringify([runtime.channel.id,binding.configuredId]),'metric-source-profile:v1'),name:safeMetricLabel(binding.name),basis:source.nativeCatalogBindings?.pgm===binding.configuredId?'NATIVE_DECODER' as const:'PUBLISHED_ITEM' as const}:null}
  })
  const publishers=runtime.transport.publishers(),outputs=publishers.slice(0,32).map(output=>{
    const profile=output.outputId?labels?.outputProfiles?.get(output.outputId):undefined
    return {identity:output.outputId?hash(JSON.stringify([runtime.channel.id,output.outputId]),'metric-output-profile:v1'):hash(output.url,'metric-output:v1'),identityType:output.outputId?'PROFILE' as const:'ENDPOINT' as const,name:safeMetricLabel(output.outputId?(profile?.target===output.url?profile.name:null):labels?.outputs.get(output.url)),state:safeMetricLabel(output.health),hasError:Boolean(output.error)}
  })
  return IncidentContextSchema.parse({version:1,capturedAt:new Date().toISOString(),channelId:runtime.channel.id,rundownId:state.rundownId,...runtime.telemetryIdentity(),itemId:state.onAir?item(state.onAir.itemId):null,itemName:safeMetricLabel(state.onAir?labels?.items.get(state.onAir.itemId):null),elapsedFrames:state.onAir?.elapsed??null,engine:{ready:runtime.transport.health().ready,processPresent:runtime.transport.processId()!==null},sources,outputs,sourcesTruncated:state.liveSources.length>32,outputsTruncated:publishers.length>32,physicalSignalValidated:false})
}
