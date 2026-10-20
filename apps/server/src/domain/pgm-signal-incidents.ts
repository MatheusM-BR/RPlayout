import type {Db} from '../db/client.js'
import {IncidentContextSchema} from '@rplayout/protocol'
import {and,eq,inArray,isNull,like} from 'drizzle-orm'
import {healthEvents,operatorDecisions} from '../db/schema.js'
import type {ExecutionLease} from './execution-ownership.js'
import {enqueueIntegrationEvent} from './integrations.js'
import type {PgmProbe} from './pgm-probe.js'
import {isRecoveryRehearsal} from './recovery-rehearsal.js'

const kinds={BLACK_FRAME:'black',FREEZE_FRAME:'freeze',SILENCE:'silence'} as const
/** Run once before constructing a new native runtime/probe. A successfully
 * claimed signed lease proves the predecessor stopped, not that its signal
 * recovered. Retain the detection context and never acknowledge automatically. */
export function endPreviousPgmObservation(db:Db,channelId:string,lease:ExecutionLease,occurredAt=new Date().toISOString(),currentProbe?:PgmProbe):number{
  if(isRecoveryRehearsal(db.$client))return 0
  return db.transaction(tx=>{
    if(isRecoveryRehearsal(db.$client))throw new Error('Observação em quarentena; alteração não autorizada.')
    const owner=lease.assertOwned()
    if(owner.channelId!==channelId)throw new Error('Posse não pertence ao canal da observação.')
    const protectedAlerts=new Set([...currentProbe?.getStatus().activeAlerts??[],...currentProbe?.pendingTransitions().map(row=>row.alert)??[]].map(alert=>'pgm-signal:'+alert.id+':active'))
    const rows=tx.select().from(healthEvents).where(and(eq(healthEvents.channelId,channelId),eq(healthEvents.component,'SIGNAL'),like(healthEvents.id,'pgm-signal:%:active'),inArray(healthEvents.state,['black','freeze','silence']),isNull(healthEvents.resolvedAt),isNull(healthEvents.observationEndedAt))).all().filter(row=>!protectedAlerts.has(row.id))
    for(const row of rows){
      const id=row.id.slice(0,-'active'.length)+'unobserved'
      const result=tx.insert(healthEvents).values({id,channelId,component:'SIGNAL',state:row.state+'_unobserved',severity:'WARN',message:'PGM: observação anterior encerrada após admissão de nova execução; recuperação não confirmada.',occurredAt,context:row.context}).onConflictDoNothing().run()
      // A collision with an incomplete transition is not successful retirement.
      if(result.changes!==1)throw new Error('Fim de observação anterior inconsistente; histórico preservado.')
      const updated=tx.update(healthEvents).set({observationEndedAt:occurredAt}).where(and(eq(healthEvents.id,row.id),isNull(healthEvents.resolvedAt),isNull(healthEvents.observationEndedAt))).run()
      if(updated.changes!==1)throw new Error('Observação anterior mudou; encerramento não confirmado.')
      enqueueIntegrationEvent(tx,'signal.'+row.state+'_unobserved',{incidentId:id,alertId:row.id.slice('pgm-signal:'.length,-':active'.length),kind:row.state,state:row.state+'_unobserved',signalRecovered:false,context:row.context,reason:'EXECUTION_ADMITTED',ownerRunId:owner.id},channelId,occurredAt)
      tx.insert(operatorDecisions).values({id:id+':audit',rundownId:'@execution',kind:'PGM_OBSERVATION_ENDED',actorUsername:'@runtime',createdAt:occurredAt,payload:{channelId,incidentId:row.id,ownerRunId:owner.id,signalRecovered:false,physicalOutputValidated:false}}).run()
    }
    return rows.length
  },{behavior:'immediate'})
}
/** Stable identity allows safe retry after DB failure or a repeated sample.
 * Acknowledgement and observation-ended are never signal recovery. */
export function persistPgmSignalIncidents(db:Db,channelId:string,probe:PgmProbe):number{
  if(isRecoveryRehearsal(db.$client))return 0
  const pending=probe.pendingTransitions();if(!pending.length)return 0
  const count=db.transaction(tx=>{
    if(isRecoveryRehearsal(db.$client))throw new Error('Incidentes em quarentena; fila externa não autorizada.')
    let inserted=0
    for(const transition of pending){
      const kind=kinds[transition.alert.type],state=transition.state==='active'?kind:transition.state==='recovered'?kind+'_recovered':kind+'_unobserved'
      const id='pgm-signal:'+transition.key
      const checked=IncidentContextSchema.safeParse(transition.context)
      const context=checked.success&&checked.data.channelId===channelId?checked.data:null
      const payload={incidentId:id,alertId:transition.alert.id,kind,state,durationMs:transition.alert.durationMs,thresholdMs:transition.alert.thresholdMs,signalRecovered:transition.state==='recovered',context}
      const message=transition.state==='active'?`PGM ${kind}: limite de ${transition.alert.thresholdMs} ms atingido.`:transition.state==='recovered'?`PGM ${kind}: recuperação confirmada por nova medição.`:`PGM ${kind}: observação encerrada; recuperação não confirmada.`
      const result=tx.insert(healthEvents).values({id,channelId,component:'SIGNAL',state,severity:transition.state==='active'?'CRITICAL':transition.state==='recovered'?'INFO':'WARN',message,occurredAt:transition.occurredAt,context}).onConflictDoNothing().run()
      if(result.changes===1){
        if(transition.state!=='active'){
          const updated=tx.update(healthEvents).set(transition.state==='recovered'?{resolvedAt:transition.occurredAt}:{observationEndedAt:transition.occurredAt})
            .where(eq(healthEvents.id,'pgm-signal:'+transition.alert.id+':active')).run()
          if(updated.changes!==1)throw new Error('Incidente original ausente; resolução não confirmada.')
        }
        enqueueIntegrationEvent(tx,'signal.'+state,payload,channelId,transition.occurredAt)
        // Preserve the original silence-recovery subscription contract.
        if(kind==='silence'&&transition.state==='recovered')enqueueIntegrationEvent(tx,'signal.recovered',payload,channelId,transition.occurredAt)
        inserted++
      }
    }
    return inserted
  },{behavior:'immediate'})
  probe.confirmTransitions(pending.map(row=>row.key))
  return count
}
