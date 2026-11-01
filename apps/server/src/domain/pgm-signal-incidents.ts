import type {Db} from '../db/client.js'
import {IncidentContextSchema,type IncidentContext} from '@rplayout/protocol'
import {and,desc,eq,inArray,isNull,like} from 'drizzle-orm'
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
type Tx=Parameters<Parameters<Db['transaction']>[0]>[0]
/** Mesmo item (ou, sem item, mesmo nome) do contexto: é a mesma condição. */
const groupKey=(context:IncidentContext|null)=>context?(context.itemId??'nome:'+context.itemName):'sem-contexto'
const REPEAT=/ Repetiu (\d+) vez(?:es)?; última em \S+\.$/
/**
 * Avalanche de alertas: um VT silencioso de verdade numa grade em loop abria um
 * CRÍTICO novo (e pendente) a cada passagem -- 2460 críticos pendentes na
 * produção, escondendo qualquer alerta real. A mesma condição (mesmo canal,
 * componente, motivo e item) com um alerta ainda **pendente** (não
 * reconhecido) vira repetição agrupada: o registro detalhado continua (trilha
 * de auditoria), mas em INFO, e o pendente original ganha o contador e a
 * última vez. Reconhecido o pendente, a próxima ocorrência abre outro.
 */
function pendingGroup(tx:Tx,channelId:string,kind:string,context:IncidentContext|null){
  const key=groupKey(context)
  const rows=tx.select().from(healthEvents).where(and(eq(healthEvents.channelId,channelId),eq(healthEvents.component,'SIGNAL'),eq(healthEvents.state,kind),eq(healthEvents.severity,'CRITICAL'),like(healthEvents.id,'pgm-signal:%:active'),isNull(healthEvents.acknowledgedAt))).orderBy(desc(healthEvents.occurredAt)).limit(50).all()
  return rows.find(row=>{const checked=row.context?IncidentContextSchema.safeParse(row.context):null;return groupKey(checked?.success?checked.data:null)===key})??null
}
/** Stable identity allows safe retry after DB failure or a repeated sample.
 * Acknowledgement and observation-ended are never signal recovery. */
export function persistPgmSignalIncidents(db:Db,channelId:string,probe:PgmProbe):number{
  // No transition (the usual 20 Hz case) needs no storage read at all.
  const pending=probe.pendingTransitions();if(!pending.length)return 0
  if(isRecoveryRehearsal(db.$client))return 0
  const count=db.transaction(tx=>{
    if(isRecoveryRehearsal(db.$client))throw new Error('Incidentes em quarentena; fila externa não autorizada.')
    let inserted=0
    for(const transition of pending){
      const kind=kinds[transition.alert.type],state=transition.state==='active'?kind:transition.state==='recovered'?kind+'_recovered':kind+'_unobserved'
      const id='pgm-signal:'+transition.key
      const checked=IncidentContextSchema.safeParse(transition.context)
      const context=checked.success&&checked.data.channelId===channelId?checked.data:null
      const payload={incidentId:id,alertId:transition.alert.id,kind,state,durationMs:transition.alert.durationMs,thresholdMs:transition.alert.thresholdMs,signalRecovered:transition.state==='recovered',context,...((transition.alert.occurrences??1)>1?{occurrences:transition.alert.occurrences}:{})}
      let message=transition.state==='active'?`PGM ${kind}: limite de ${transition.alert.thresholdMs} ms atingido.`:transition.state==='recovered'?`PGM ${kind}: recuperação confirmada por nova medição${(transition.alert.occurrences??1)>1?` (${transition.alert.occurrences} ocorrências agrupadas neste incidente)`:''}.`:`PGM ${kind}: observação encerrada; recuperação não confirmada.`
      let severity:'CRITICAL'|'WARN'|'INFO'=transition.state==='active'?'CRITICAL':transition.state==='recovered'?'INFO':'WARN'
      let groupedInto:string|null=null
      const exists=tx.select({id:healthEvents.id}).from(healthEvents).where(eq(healthEvents.id,id)).get()
      if(!exists&&transition.state==='active'){
        const group=pendingGroup(tx,channelId,kind,context)
        if(group){
          groupedInto=group.id
          const previous=Number(REPEAT.exec(group.message??'')?.[1]??'1')
          const base=(group.message??`PGM ${kind}: limite de ${transition.alert.thresholdMs} ms atingido.`).replace(REPEAT,'')
          tx.update(healthEvents).set({message:`${base} Repetiu ${previous+1} vezes; última em ${transition.occurredAt}.`}).where(eq(healthEvents.id,group.id)).run()
          severity='INFO'
          message=`PGM ${kind}: repetição agrupada no alerta pendente de ${group.occurredAt} (mesmo item); não cria pendência nova.`
        }
      }else if(!exists&&transition.state==='unobserved'){
        // Repetição agrupada que perde a observação continua sem pendência nova.
        const original=tx.select({severity:healthEvents.severity}).from(healthEvents).where(eq(healthEvents.id,'pgm-signal:'+transition.alert.id+':active')).get()
        if(original?.severity==='INFO')severity='INFO'
      }
      const result=tx.insert(healthEvents).values({id,channelId,component:'SIGNAL',state,severity,message,occurredAt:transition.occurredAt,context}).onConflictDoNothing().run()
      if(result.changes===1){
        if(transition.state!=='active'){
          const updated=tx.update(healthEvents).set(transition.state==='recovered'?{resolvedAt:transition.occurredAt}:{observationEndedAt:transition.occurredAt})
            .where(eq(healthEvents.id,'pgm-signal:'+transition.alert.id+':active')).run()
          if(updated.changes!==1)throw new Error('Incidente original ausente; resolução não confirmada.')
        }
        enqueueIntegrationEvent(tx,'signal.'+state,groupedInto?{...payload,groupedInto}:payload,channelId,transition.occurredAt)
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
