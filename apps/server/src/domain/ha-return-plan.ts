import type {HaPromotionReport} from './ha-promotion.js'
import type {HaLeaseClient} from './ha-witness.js'
import {haStopReport} from './ha-stop.js'
import {haExportSeal} from './ha-execution-export.js'
import {z} from 'zod'

/** Planning only. These inputs are gathered by the owning service, not posted
 * by a browser. Releasing storage never implies reverse synchronization. */
export function planHaReturn(value:{promotion:HaPromotionReport;stop:unknown;assignment:Awaited<ReturnType<HaLeaseClient['assignment']>>;currentNodeId:string;primaryNodeId:string;localOwnerUnchanged:boolean;unresolvedControls:number;exportSeal?:unknown}){
  const {promotion,assignment}=value,channelId=promotion.request.preparation.channelId
  z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).parse(value.unresolvedControls)
  const stop=value.stop===null?null:haStopReport.parse(value.stop),blockers:string[]=[]
  if(promotion.request.targetNodeId!==value.currentNodeId||promotion.request.fromNodeId!==value.primaryNodeId)throw new Error('Retorno de outro pareamento.')
  if(stop&&(stop.request.channelId!==channelId||stop.request.promotionId!==promotion.request.requestId))throw new Error('Parada não pertence à execução a devolver.')
  if(assignment.channelId!==channelId)throw new Error('Admissão da testemunha de outro canal.')
  if(!value.localOwnerUnchanged)blockers.push('LOCAL_OWNER_CHANGED')
  if(!stop||stop.phase!=='CONFIRMED'||!stop.ownedResourcesStopped||!stop.storageReleased)blockers.push('STOP_NOT_CONFIRMED')
  if(assignment.selectedNodeId!==value.currentNodeId||assignment.lastTransferId!==promotion.request.requestId||assignment.revision!==promotion.request.expectedRevision+1)blockers.push('ASSIGNMENT_CHANGED')
  if(assignment.engineLeaseActive||assignment.waitingForLeaseExpiry)blockers.push('LEASE_STILL_ACTIVE')
  if(value.unresolvedControls)blockers.push('CONTROL_OUTCOMES_UNRESOLVED')
  const seal=value.exportSeal==null?null:haExportSeal.parse(value.exportSeal)
  if(seal&&(seal.channelId!==channelId||seal.promotionId!==promotion.request.requestId||seal.stopRequestId!==stop?.request.requestId||stop?.phase!=='CONFIRMED'))throw new Error('Selo não pertence ao encerramento desta execução.')
  // No trusted reverse-transfer receipt exists in this stage. Never replace
  // it with a checkbox, node heartbeat, copied file or a historical SHA.
  if(!seal)blockers.push('EXECUTION_EXPORT_NOT_SEALED')
  blockers.push('REVERSE_SYNC_NOT_CONFIRMED','PRIMARY_RECONCILIATION_NOT_CONFIRMED')
  return {channelId,promotionId:promotion.request.requestId,fromNodeId:value.currentNodeId,targetNodeId:value.primaryNodeId,stopConfirmed:stop?.phase==='CONFIRMED',stopRequestId:stop?.request.requestId??null,exportSealed:!!seal,assignmentRevision:assignment.revision,expectedTerm:assignment.lastTerm,engineLeaseActive:assignment.engineLeaseActive,unresolvedControls:value.unresolvedControls,blockers,transferReady:false as const,publicationAuthorized:false as const,automaticRestart:false as const,reverseSyncConfirmed:false as const,physicalOutputValidated:false as const,checkedAt:new Date().toISOString()}
}
