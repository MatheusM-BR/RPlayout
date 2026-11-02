import {z} from 'zod'

export const haMonitorIntent=z.object({requestId:z.string().uuid(),channelId:z.string().min(1).max(128),promotionId:z.string().uuid(),bus:z.enum(['pvw','mon']),on:z.boolean(),supersedesRequestId:z.string().uuid().optional(),reviewToken:z.string().min(1).max(256).optional()}).strict().superRefine((value,ctx)=>{
  if(!!value.supersedesRequestId!==!!value.reviewToken||value.supersedesRequestId===value.requestId)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Revisão exige pedido anterior distinto e token de conferência.'})
})
export const haMonitorLedgerReport=z.object({version:z.literal(1),request:haMonitorIntent,phase:z.enum(['ACCEPTED','SENDING','CONFIRMED','REFUSED','UNCERTAIN']),actor:z.string().min(1).max(256),updatedAt:z.string().datetime(),confirmationIsHistorical:z.literal(true),physicalOutputValidated:z.literal(false)}).strict()
export type HaMonitorLedgerReport=z.infer<typeof haMonitorLedgerReport>
export const monitorUnresolved=(phase:HaMonitorLedgerReport['phase'])=>['ACCEPTED','SENDING','UNCERTAIN'].includes(phase)
/** A correction is a NEW state-setting command, not proof of the old delivery.
 * Only a confirmed descendant resolves an ambiguous ancestor. Refusals do not.
 * Reject broken chains, cycles and cross-generation/bus references. */
export function resolvedMonitorRequests(reports:HaMonitorLedgerReport[]):Map<string,string>{
  const byId=new Map<string,HaMonitorLedgerReport>(),resolved=new Map<string,string>()
  for(const report of reports){if(byId.has(report.request.requestId))throw new Error('Pedido duplicado no diário.');byId.set(report.request.requestId,report)}
  for(const report of reports){
    let current=report;const visited=new Set<string>([current.request.requestId])
    while(current.request.supersedesRequestId){
      const parent=byId.get(current.request.supersedesRequestId)
      if(!parent||visited.has(parent.request.requestId)||parent.request.channelId!==report.request.channelId||parent.request.promotionId!==report.request.promotionId||parent.request.bus!==report.request.bus||!monitorUnresolved(parent.phase))throw new Error('Revisão de monitor sem cadeia íntegra.')
      visited.add(parent.request.requestId)
      if(report.phase==='CONFIRMED')resolved.set(parent.request.requestId,report.request.requestId)
      current=parent
    }
  }
  return resolved
}
export function monitorReviewAncestors(reports:HaMonitorLedgerReport[],requestId:string):Set<string>{
  resolvedMonitorRequests(reports)
  const byId=new Map(reports.map(report=>[report.request.requestId,report])),ancestors=new Set<string>()
  let current=byId.get(requestId)
  if(!current)throw new Error('Pedido a revisar não registrado.')
  while(current){ancestors.add(current.request.requestId);current=current.request.supersedesRequestId?byId.get(current.request.supersedesRequestId):undefined}
  return ancestors
}
