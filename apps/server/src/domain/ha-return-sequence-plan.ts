import {createHash} from 'node:crypto'
import {audioCutIdentity,type MediaAsset} from '@rplayout/protocol'
import {planReturnBusAudio,type ReturnBusJob} from './ha-return-bus-plan.js'
import {declaredFileTrim,executionTrim} from './execution-trim.js'
type Origin=Parameters<typeof planReturnBusAudio>[0]
export interface ReturnSequenceJob{key:string;revisionId:string;scheduleFingerprint:string;profileFingerprint:string;orderedJobs:ReturnBusJob[]}
export function returnSequenceJobKey(job:Omit<ReturnSequenceJob,'key'>){return createHash('sha256').update(JSON.stringify(['continuous-rendered-cut-sequence:v1',job.revisionId,job.scheduleFingerprint,job.profileFingerprint,job.orderedJobs.map(item=>item.key)])).digest('hex')}
/** Full frozen edition, no filtering around live/gap/missing audio to manufacture
 * continuity. Dynamic cuts require their own matching analysis, not old proofs. */
export function orderReturnSequenceJobs(edition:Origin['entries'][number],bus:ReturnType<typeof planReturnBusAudio>,assets:ReadonlyMap<string,MediaAsset>){
  const errors:string[]=[],jobs:ReturnBusJob[]=[],items=edition.payload.items,timing=edition.payload.schedule?.items,rate=edition.payload.rate
  if(!rate||!timing||items.length===0||items.length>128||timing.length!==items.length||new Set(items.map(item=>item.id)).size!==items.length){return {jobs:[],errors:['LOCAL_SEQUENCE_EDITION_CONTRACT_PENDING']}}
  if(bus.issues.some(issue=>issue.revisionId===edition.revision.id&&issue.errors.length))errors.push('LOCAL_SEQUENCE_BUS_PLAN_BLOCKED')
  for(let index=0;index<items.length;index++){
    const item=items[index]!,resolved=timing[index]!,found=bus.jobs.filter(job=>job.mount.revisionId===edition.revision.id&&job.mount.itemId===item.id)
    if(resolved.id!==item.id||resolved.order!==item.order||!Number.isSafeInteger(item.order)||index>0&&item.order<=items[index-1]!.order||resolved.state==='DROPPED'||!Number.isSafeInteger(resolved.start)||!Number.isSafeInteger(resolved.end)||resolved.end<=resolved.start||resolved.end-resolved.start!==resolved.duration||index>0&&resolved.start!==timing[index-1]!.end){errors.push('LOCAL_SEQUENCE_ORDER_GAP_OR_TIMING_PENDING');continue}
    if(item.sourceRef||item.liveEndpoint||item.liveConfig?.sourceEndpoint||item.type==='GFX'||!item.mediaId||found.length!==1){errors.push('LOCAL_SEQUENCE_ITEM_RENDER_CONTRACT_PENDING');continue}
    const job=found[0]!,original=edition.payload.assets?.find(asset=>asset.id===item.mediaId),asset=original?assets.get(original.id+':'+original.contentHash):undefined
    if(!asset||asset.contentHash!==job.mount.contentHash){errors.push('LOCAL_SEQUENCE_MEDIA_UNPROVEN');continue}
    try{
      const declared=declaredFileTrim(item,asset,rate),actual=audioCutIdentity(executionTrim({item,asset,trim:declared},resolved,rate),rate)
      if(actual.inNs!==job.configuration.trim.inNs||actual.outNs!==job.configuration.trim.outNs)throw new Error('timing cut differs')
      jobs.push(job)
    }catch{errors.push('LOCAL_SEQUENCE_EXECUTION_CUT_EVIDENCE_REQUIRED')}
  }
  return {jobs:errors.length?[]:jobs,errors:[...new Set(errors)]}
}
export function planReturnSequences(...args:Parameters<typeof planReturnBusAudio>){
  const [origin,receipt]=args,bus=planReturnBusAudio(...args),assets=new Map(receipt.evidence.localAssets.map(([key,value])=>[key,value as unknown as MediaAsset]))
  const sequences:ReturnSequenceJob[]=[],issues:Array<{revisionId:string;errors:string[];warnings:string[]}>=[]
  for(const edition of origin.entries){
    const ordered=orderReturnSequenceJobs(edition,bus,assets)
    issues.push({revisionId:edition.revision.id,errors:ordered.errors,warnings:['LOCAL_SEQUENCE_OPERATIONAL_SELECTOR_AND_AV_PENDING']})
    if(ordered.errors.length)continue
    const identity={revisionId:edition.revision.id,scheduleFingerprint:createHash('sha256').update(JSON.stringify(edition.payload.schedule)).digest('hex'),profileFingerprint:bus.profileFingerprint,orderedJobs:ordered.jobs}
    sequences.push({...identity,key:returnSequenceJobKey(identity)})
  }
  if(new Set(sequences.map(sequence=>sequence.key)).size!==sequences.length)throw new Error('Sequências duplicadas.')
  return {profile:bus.profile,profileFingerprint:bus.profileFingerprint,sequences,issues,operationalSelectorQualified:false as const,nativeTransitionQualified:false as const,avQualified:false as const,publicationAuthorized:false as const}
}
