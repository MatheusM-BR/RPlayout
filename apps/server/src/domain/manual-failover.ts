import {randomUUID} from 'node:crypto'
import {eq} from 'drizzle-orm'
import type {Db} from '../db/client.js'
import {liveSources,operatorDecisions,healthEvents} from '../db/schema.js'
import {installationVault} from './secret-vault.js'
import {CollaborativeEditError} from './collaborative-edit.js'
import {sanitizeDiagnostic} from './sanitize-diagnostic.js'
import type {FailoverManager,FailoverEvent,RedundancyRole} from './srt.js'

const conflict=(status:number,error:string):never=>{throw new CollaborativeEditError(status,{error})}
const kind='MANUAL_FAILOVER_METADATA'
export interface ManualFailoverInput {sourceId:string;targetRole?:RedundancyRole;reason?:string}
/** Durable metadata decision only. Never drives or confirms a native PGM.
 * SQL failure/uncertainty must precede any local role/listener mutation. A
 * replay reads history, not a second toggle, even across aliases/restarts. */
export function recordManualFailover(db:Db,manager:FailoverManager,key:unknown,input:ManualFailoverInput,actorId:string|null,actorName:string|null,authorize:(channelId:string)=>void){
 if(key===undefined)conflict(428,'Informe Idempotency-Key estável antes de solicitar failover. Nenhuma decisão foi aplicada.')
 if(typeof key!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(key))conflict(400,'Idempotency-Key inválido.')
 const requestId=key as string,vault=installationVault(),id='manual-failover:'+vault.reviewIdentity(requestId,'manual-failover-key:v1')
 const digest=vault.reviewIdentity(JSON.stringify({input:{sourceId:input.sourceId,targetRole:input.targetRole??null,reason:input.reason??null},actorId}),'manual-failover-request:v1')
 const result=db.transaction(tx=>{
  const source=tx.select().from(liveSources).where(eq(liveSources.id,input.sourceId)).get()
  if(!source)conflict(404,'Fonte ao vivo não encontrada.')
  authorize(source!.channelId)
  const prior=tx.select().from(operatorDecisions).where(eq(operatorDecisions.id,id)).get()
  if(prior){
   if(prior.kind!==kind||prior.payload.digest!==digest||prior.payload.actorId!==actorId)conflict(409,'Identificador pertence a outra decisão de failover; nenhum pedido foi repetido.')
   return {event:prior.payload.event as unknown as FailoverEvent,replayed:true,channelId:source!.channelId}
  }
  const scope='@failover:'+source!.id
  const latestId=db.$client.prepare('SELECT id FROM operator_decisions WHERE rundown_id=? AND kind=? ORDER BY rowid DESC LIMIT 1').get(scope,kind) as {id:string}|undefined
  const latest=latestId?tx.select().from(operatorDecisions).where(eq(operatorDecisions.id,latestId.id)).get():null
  const previous=latest?.payload.event as unknown as FailoverEvent|undefined
  if(previous&&(previous.sourceId!==source!.id||!['PRIMARY','BACKUP'].includes(previous.toRole)))conflict(409,'Histórico de seleção inválido; confira a decisão antes de continuar.')
  const fromRole=previous?.toRole??manager.getActiveRole(source!.id,source!.role)
  const toRole=input.targetRole??(fromRole==='PRIMARY'?'BACKUP':'PRIMARY')
  const event:FailoverEvent={sourceId:source!.id,pairedSourceId:source!.pairedSourceId,fromRole,toRole,
   reason:sanitizeDiagnostic(input.reason??`Seleção manual solicitada por ${actorName??'operador local'}`),timestamp:new Date().toISOString(),operator:actorName??undefined,automatic:false}
  tx.insert(operatorDecisions).values({id,rundownId:scope,kind,actorUsername:actorName,createdAt:event.timestamp,
   payload:{digest,actorId,event,state:'METADATA_RECORDED',nativeProgramConfirmed:false,physicalOutputValidated:false}}).run()
  tx.insert(healthEvents).values({id:randomUUID(),channelId:source!.channelId,component:'FAILOVER_CONTROLLER',state:'METADATA_RECORDED',severity:'WARN',
   message:`Seleção de metadados ${fromRole} -> ${toRole} registrada; sem confirmação do PGM. ${event.reason}`,occurredAt:event.timestamp}).run()
  return {event,replayed:false,channelId:source!.channelId}
 },{behavior:'immediate'})
 let cacheApplied=false
 if(!result.replayed){try{manager.applyRecordedDecision(result.event);cacheApplied=true}catch{/* Durable commit is not rollback. Never retry side effects here. */}}
 return {...result,requestId,cacheApplied,operation:'METADATA_DECISION_ONLY' as const,nativeProgramConfirmed:false as const,physicalOutputValidated:false as const,
  metadataDecision:{state:'RECORDED' as const,replayed:result.replayed,currentExecutionObserved:false as const}}
}
