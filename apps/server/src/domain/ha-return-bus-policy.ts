import {createHash} from 'node:crypto'
import {z} from 'zod'
import {bindReturnBusEvidence} from './ha-return-bus-evidence.js'
import type {planReturnBusAudio} from './ha-return-bus-plan.js'
import type {HaSnapshot} from './ha-replication.js'

const range=z.object({minLufs:z.number().finite().min(-100).max(0),maxLufs:z.number().finite().min(-100).max(0)}).strict().refine(value=>value.minLufs<=value.maxLufs,'Faixa de loudness inválida.')
/** Explicit local policy for EVERY pair. No master policy guessed for SAP/AD.
 * Null loudness range means peak-only, not proof that silence is acceptable. */
export const returnBusPolicySchema=z.object({channelId:z.string().min(1).max(128),configurationRevision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),audioChannels:z.union([z.literal(2),z.literal(8),z.literal(16)]),pairs:z.array(z.object({outputPair:z.number().int().min(1).max(8),loudness:range.nullable(),maxTruePeakDbtp:z.number().finite().min(-100).max(0)}).strict()).min(1).max(8)}).strict().refine(value=>value.pairs.length===value.audioChannels/2&&value.pairs.every((pair,index)=>pair.outputPair===index+1),'Política deve declarar todos os pares em ordem.')

/** Revision supplied by local configuration store, snapshot by local capture.
 * Missing policy is a pending prerequisite, never generated from defaults. */
export function captureReturnBusPolicy(snapshot:HaSnapshot,channelId:string,configurationRevision:number){
  const channels=snapshot.channels.filter(row=>row.channelId===channelId)
  if(channels.length!==1)throw new Error('Política bus exige um único canal local.')
  const channel=z.object({id:z.string(),audioChannels:z.number(),qcProfile:z.object({renderedBusPairs:z.unknown()}).passthrough()}).passthrough().parse(channels[0]!.configuration.channel)
  if(channel.id!==channelId||channel.qcProfile.renderedBusPairs===undefined)throw new Error('Política bus local não configurada ou identidade divergente.')
  return returnBusPolicySchema.parse({channelId,configurationRevision,audioChannels:channel.audioChannels,pairs:channel.qcProfile.renderedBusPairs})
}
export function captureReturnBusPolicyOrPending(snapshot:HaSnapshot,channelId:string,configurationRevision:number){
  z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).parse(configurationRevision)
  const rows=snapshot.channels.filter(row=>row.channelId===channelId)
  if(rows.length!==1)throw new Error('Política bus exige um único canal local.')
  const channel=z.object({id:z.literal(channelId),qcProfile:z.object({renderedBusPairs:z.unknown().optional()}).passthrough().nullish()}).passthrough().parse(rows[0]!.configuration.channel)
  return channel.qcProfile?.renderedBusPairs===undefined?null:captureReturnBusPolicy(snapshot,channelId,configurationRevision)
}
export const returnBusAssessmentSummarySchema=z.object({required:z.number().int().min(0).max(100000),withinProfile:z.number().int().min(0).max(100000),failed:z.number().int().min(0).max(100000),planBlocked:z.number().int().min(0).max(100000),isolatedAssessmentComplete:z.boolean(),policyFingerprint:z.string().regex(/^[a-f0-9]{64}$/),configurationRevision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)}).strict().refine(value=>value.required===value.withinProfile+value.failed&&value.isolatedAssessmentComplete===(value.required>0&&value.failed===0&&value.planBlocked===0))
export function summarizeReturnBusAssessment(value:ReturnType<typeof assessReturnBusAudio>){return returnBusAssessmentSummarySchema.parse({required:value.required,withinProfile:value.withinProfile,failed:value.failed,planBlocked:value.planBlocked,isolatedAssessmentComplete:value.isolatedAssessmentComplete,policyFingerprint:value.policyFingerprint,configurationRevision:value.policy.configurationRevision})}

/** Technical assessment of exact isolated receipts. Store must capture policy
 * locally and reconfirm revision; never accept policy from an HTTP body.
 * Deliberately does not change editorial QC or authorize transmission. */
export function assessReturnBusAudio(plan:ReturnType<typeof planReturnBusAudio>,raw:unknown,policyRaw:unknown){
  const policy=returnBusPolicySchema.parse(policyRaw),bound=bindReturnBusEvidence(plan,raw)
  if(policy.channelId!==plan.profile.channelId||policy.audioChannels!==plan.profile.audioChannels)throw new Error('Política bus não corresponde ao canal/barramento do plano.')
  const entries=bound.evidence.entries.map(entry=>{
    const errors:string[]=[],pairs:Array<{outputPair:number;errors:string[]}>=[]
    if(entry.status!=='MEASURED'||!entry.receipt)errors.push('LOCAL_BUS_MEASUREMENT_FAILED')
    else for(const rule of policy.pairs){
      const measured=entry.receipt.reading.pairs[rule.outputPair-1]!,failures:string[]=[]
      if(measured.truePeakDbtp>rule.maxTruePeakDbtp)failures.push('LOCAL_BUS_TRUE_PEAK_OUT_OF_PROFILE')
      if(rule.loudness&&(measured.integratedLufs<rule.loudness.minLufs||measured.integratedLufs>rule.loudness.maxLufs))failures.push('LOCAL_BUS_LOUDNESS_OUT_OF_PROFILE')
      pairs.push({outputPair:rule.outputPair,errors:failures})
    }
    return {jobKey:entry.job.key,revisionId:entry.job.mount.revisionId,itemId:entry.job.mount.itemId,withinProfile:errors.length===0&&pairs.every(pair=>pair.errors.length===0),errors,pairs}
  })
  const planBlocked=plan.issues.filter(issue=>issue.errors.length).length
  return {version:1 as const,policy,policyFingerprint:createHash('sha256').update(JSON.stringify(policy)).digest('hex'),required:entries.length,withinProfile:entries.filter(entry=>entry.withinProfile).length,failed:entries.filter(entry=>!entry.withinProfile).length,planBlocked,isolatedAssessmentComplete:entries.length>0&&planBlocked===0&&entries.every(entry=>entry.withinProfile),entries,scope:'ISOLATED_RENDERED_BUS' as const,continuousPlaybackQualified:false as const,transitionQualified:false as const,avQualified:false as const,editorialApproved:false as const,publicationAuthorized:false as const}
}
