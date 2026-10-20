import {randomUUID} from 'node:crypto'
import {and,desc,eq,isNull,like,sql} from 'drizzle-orm'
import {IncidentContextSchema,type IncidentContext} from '@rplayout/protocol'
import type {Db} from '../db/client.js'
import {healthEvents,operatorDecisions} from '../db/schema.js'
import type {ExecutionLease} from './execution-ownership.js'
import {readExecutionRun} from '../db/execution-ownership.js'
import {enqueueIntegrationEvent} from './integrations.js'
import {isRecoveryRehearsal} from './recovery-rehearsal.js'
import {installationVault} from './secret-vault.js'
import {captureIncidentContext} from './incident-context.js'
import type {MetricRuntime} from './operational-metrics.js'
import {safeMetricLabel,type MetricLabels} from './operational-metric-labels.js'

export interface RuntimeObservation {identity:string;component:'LIVE_SOURCE'|'OUTPUT';bus:'pgm'|'pvw'|'output';state:string;result:'FAILED'|'HEALTHY'|'UNKNOWN'|'ENDED';delivered:number;name:string|null;legacyState?:string;endpointIdentity?:string;generation?:number}
export interface RuntimeObservationSnapshot {channelId:string;context:IncidentContext;observations:RuntimeObservation[]}
/** Read existing native telemetry only. Catalog selection/READY is not recovery.
 * Publishers require a delivery advance after the failure baseline. */
export function runtimeObservationSnapshot(runtime:MetricRuntime,labelsInput?:MetricLabels|(()=>MetricLabels)):RuntimeObservationSnapshot{
  let labels:MetricLabels|undefined
  try{labels=typeof labelsInput==='function'?labelsInput():labelsInput}catch{/* Storage metadata failure must not discard native measurements. */}
  const context=captureIncidentContext(runtime,labels),state=runtime.transport.state(),health=runtime.transport.health()
  const observing=health.ready&&runtime.transport.processId()!==null&&state.mode==='NATIVE'
  const identity=(value:string,domain:string)=>installationVault(false).reviewIdentity(value,domain)
  const observations:RuntimeObservation[]=[]
  if(observing){
    for(const source of state.liveSources)for(const bus of ['pgm','pvw'] as const){
      const lifecycle=source.busStates?.[bus],signal=source.busSignals?.[bus]
      if(!lifecycle&&!signal)continue
      const failed=lifecycle==='FAILED'||lifecycle==='LOST'||['NO_VIDEO','NO_AUDIO','UNSTABLE','FAILED'].includes(signal?.status??'')
      const recent=signal?.sampleAgeMs!==null&&signal?.sampleAgeMs!==undefined&&Number.isFinite(signal.sampleAgeMs)&&signal.sampleAgeMs>=0&&signal.sampleAgeMs<=1500
      observations.push({identity:identity(source.source,'metric-source:v1'),component:'LIVE_SOURCE',bus,state:signal?.status??lifecycle??'UNKNOWN',result:failed?'FAILED':signal?.status==='SIGNAL_OK'&&recent&&signal.videoRecent&&signal.audioRecent?'HEALTHY':lifecycle==='IDLE'||signal?.status==='UNMONITORED'?'ENDED':'UNKNOWN',delivered:0,name:safeMetricLabel(labels?.sources.get(source.source)),legacyState:lifecycle})
    }
    for(const output of runtime.transport.publishers()){
      const profile=output.outputId?labels?.outputProfiles?.get(output.outputId):undefined
      observations.push({identity:output.outputId?identity(JSON.stringify([runtime.channel.id,output.outputId]),'metric-output-profile:v1'):identity(output.url,'metric-output:v1'),endpointIdentity:identity(output.url,'metric-output:v1'),generation:Number.isSafeInteger(output.generation)&&output.generation!>=0?output.generation:undefined,component:'OUTPUT',bus:'output',state:output.health,result:['failed','retrying'].includes(output.health)?'FAILED':output.health==='onAir'&&!output.error?'HEALTHY':output.health==='idle'?'ENDED':'UNKNOWN',delivered:Number.isSafeInteger(output.delivered)&&output.delivered>=0?output.delivered:0,name:safeMetricLabel(output.outputId?(profile?.target===output.url?profile.name:null):labels?.outputs.get(output.url))})
    }
  }
  return {channelId:runtime.channel.id,context,observations}
}
const entity=(channelId:string,row:RuntimeObservation)=>installationVault(false).reviewIdentity(JSON.stringify([channelId,row.component,row.bus,row.identity,...(row.component==='OUTPUT'&&row.endpointIdentity?[row.endpointIdentity]:[])]),'runtime-incident:v1')
/** Keep the detection snapshot across a failed DB write. The next item/config
 * must not silently replace the context of the incident being retried. */
export class RuntimeIncidentRecorder {
  private readonly pending:Array<{snapshot:RuntimeObservationSnapshot;at:string}>=[]
  private lost=0
  constructor(private readonly db:Db,private readonly lease:ExecutionLease){}
  record(capture:()=>RuntimeObservationSnapshot):number{
    if(this.pending.length>=512){this.lost++;throw new Error('Fila de observação cheia; lacuna exige conferência operacional.')}
    const snapshot=structuredClone(capture());this.pending.push({snapshot,at:snapshot.context.capturedAt})
    return this.flush()
  }
  persist(capture:()=>RuntimeObservationSnapshot):number{
    return this.pending.length?this.flush():this.record(capture)
  }
  /** Shutdown stops callbacks first. Quarantine or failed storage cannot seal. */
  drainAndSeal():void{
    if(isRecoveryRehearsal(this.db.$client))throw new Error('Observação em quarentena; encerramento não confirmado.')
    this.flush()
    this.lease.sealObservation()
  }
  private flush():number{
    if(isRecoveryRehearsal(this.db.$client))return 0
    let count=0
    while(this.pending.length){const row=this.pending[0]!;count+=persistRuntimeSignalIncidents(this.db,this.lease,row.snapshot,row.at);this.pending.shift()}
    if(this.lost){
      const lost=this.lost,at=new Date().toISOString()
      this.db.transaction(tx=>{
        if(isRecoveryRehearsal(this.db.$client))throw new Error('Observação em quarentena.')
        const owner=this.lease.assertOwned(),id='observation-gap:'+randomUUID()
        tx.insert(healthEvents).values({id,channelId:owner.channelId,component:'ENGINE',state:'observation_gap',severity:'CRITICAL',message:`${lost} observações excederam a fila durante falha de armazenamento; conferir histórico e sinal.`,occurredAt:at}).run()
        enqueueIntegrationEvent(tx,'engineering.observation_gap',{incidentId:id,lostObservations:lost,signalRecovered:false},owner.channelId,at)
      },{behavior:'immediate'})
      this.lost=0
    }
    return count
  }
}
/** Signed authority is checked inside the write transaction. No volatile
 * recorded-map commits ahead of SQLite; failed writes retry the same incident. */
export function persistRuntimeSignalIncidents(db:Db,lease:ExecutionLease,snapshot:RuntimeObservationSnapshot,at=new Date().toISOString(),admissionOnly=false):number{
  if(isRecoveryRehearsal(db.$client))return 0
  return db.transaction(tx=>{
    if(isRecoveryRehearsal(db.$client))throw new Error('Incidentes em quarentena.')
    const owner=lease.assertOwned(),channelId=snapshot.channelId
    if(owner.channelId!==channelId||snapshot.context.channelId!==channelId)throw new Error('Contexto/posse não pertence ao canal.')
    IncidentContextSchema.parse(snapshot.context)
    const rows=tx.select().from(healthEvents).where(and(eq(healthEvents.channelId,channelId),like(healthEvents.id,'runtime-signal:%:active'),isNull(healthEvents.resolvedAt),isNull(healthEvents.observationEndedAt))).all()
    const observations=new Map(snapshot.observations.map(row=>[entity(channelId,row),row])),open=new Set<string>();let inserted=0
    if(admissionOnly&&owner.recoveredRunId){
      const previous=readExecutionRun(db.$client,owner.recoveredRunId)
      if(previous.channelId!==channelId)throw new Error('Predecessor de observação pertence a outro canal.')
      // Signed epoch exists before native spawn. A crash cannot erase this
      // warning along with the volatile queue. No missing samples are invented.
      if(previous.observationClosed!==true){
        const id='observation-closure-gap:'+previous.id
        if(!tx.select({id:healthEvents.id}).from(healthEvents).where(eq(healthEvents.id,id)).get()){
          const legacy=previous.observationClosed===undefined
          tx.insert(healthEvents).values({id,channelId,component:'ENGINE',state:'observation_gap',severity:'CRITICAL',message:legacy?'Execução anterior sem confirmação de encerramento da observação; cobertura do histórico desconhecida.':'Execução anterior terminou sem esvaziamento confirmado da fila de observação; o histórico pode estar incompleto.',occurredAt:at}).run()
          enqueueIntegrationEvent(tx,'engineering.observation_gap',{incidentId:id,previousRunId:previous.id,historyCompleteness:'UNKNOWN',lostObservations:null,signalRecovered:false,physicalSignalValidated:false},channelId,at)
          tx.insert(operatorDecisions).values({id:id+':audit',rundownId:'@execution',kind:'OBSERVATION_CLOSURE_UNCONFIRMED',actorUsername:'@runtime',createdAt:at,payload:{channelId,previousRunId:previous.id,ownerRunId:owner.id,lostObservations:null,signalRecovered:false}}).run()
          inserted++
        }
      }
    }
    for(const row of rows){
      const parts=row.id.split(':'),key=parts[1]!,sameOwner=parts[2]===owner.id,observation=observations.get(key)
      if(sameOwner)open.add(key)
      if(admissionOnly&&sameOwner)continue
      const oldGeneration=parts[5]!==undefined&&parts[5]!=='active'&&parts[5]!=='legacy'?Number(parts[5]):null
      const generationConfirmed=observation?.generation!==undefined&&oldGeneration!==null&&Number.isSafeInteger(oldGeneration)&&oldGeneration>=0
      const deliveryAdvanced=observation&&(generationConfirmed?observation.generation!>oldGeneration!&&observation.delivered>0||observation.generation===oldGeneration&&observation.delivered>Number(parts[4]):oldGeneration===null&&observation.generation===undefined&&observation.delivered>Number(parts[4]))
      const recovered=!admissionOnly&&sameOwner&&observation?.result==='HEALTHY'&&(row.component!=='OUTPUT'||deliveryAdvanced)
      const ended=!sameOwner||!admissionOnly&&(!observation||observation.result==='ENDED')
      if(!recovered&&!ended)continue
      const suffix=recovered?'recovered':'unobserved',id=row.id.slice(0,-6)+suffix
      tx.insert(healthEvents).values({id,channelId,component:row.component,state:row.state+'_'+suffix,severity:recovered?'INFO':'WARN',message:recovered?'Recuperação confirmada pela telemetria nativa; não homologa saída física.':'Observação encerrada; recuperação não confirmada.',occurredAt:at,context:recovered?snapshot.context:row.context}).run()
      const updated=tx.update(healthEvents).set(recovered?{resolvedAt:at}:{observationEndedAt:at}).where(and(eq(healthEvents.id,row.id),isNull(healthEvents.resolvedAt),isNull(healthEvents.observationEndedAt))).run()
      if(updated.changes!==1)throw new Error('Incidente mudou; transição não confirmada.')
      enqueueIntegrationEvent(tx,(row.component==='OUTPUT'?'output.':'source.')+suffix,{incidentId:id,originalIncidentId:row.id,identity:key,signalRecovered:recovered,physicalSignalValidated:false,context:recovered?snapshot.context:row.context},channelId,at)
      tx.insert(operatorDecisions).values({id:id+':audit',rundownId:'@execution',kind:'RUNTIME_INCIDENT_'+suffix.toUpperCase(),actorUsername:'@runtime',createdAt:at,payload:{channelId,incidentId:row.id,ownerRunId:owner.id,signalRecovered:recovered,physicalOutputValidated:false}}).run()
      inserted++
    }
    if(!admissionOnly)for(const [key,observation] of observations){
      if(observation.result!=='FAILED'||open.has(key))continue
      const id=`runtime-signal:${key}:${owner.id}:${randomUUID()}:${observation.delivered}:${observation.generation??'legacy'}:active`
      const state=safeMetricLabel(observation.state)??'UNKNOWN'
      tx.insert(healthEvents).values({id,channelId,component:observation.component,state,severity:'CRITICAL',message:`${observation.bus.toUpperCase()} · ${safeMetricLabel(observation.name)??'Nome indisponível'} · ${state}`,occurredAt:at,context:snapshot.context}).run()
      enqueueIntegrationEvent(tx,(observation.component==='OUTPUT'?'output.':'source.')+'failed',{incidentId:id,identity:observation.identity,bus:observation.bus,state,signalRecovered:false,physicalSignalValidated:false,context:snapshot.context},channelId,at)
      inserted++
    }
    if(!admissionOnly)for(const [key,observation] of observations){
      const state=observation.component==='OUTPUT'?observation.state:observation.legacyState
      if(!state||!['connecting','onAir','retrying','failed','idle','IDLE','CUEING','PVW_READY','TAKE_PENDING','ON_PGM','LOST','FAILED'].includes(state))continue
      const prefix=`runtime-status:${key}:${owner.id}:`
      const previous=tx.select({state:healthEvents.state}).from(healthEvents).where(and(eq(healthEvents.channelId,channelId),like(healthEvents.id,prefix+'%'))).orderBy(desc(sql`rowid`)).limit(1).get()
      if(previous?.state===state)continue
      // Failure already has one correlated CRITICAL incident; lifecycle
      // history must not double the operator's pending-critical count.
      const id=prefix+randomUUID(),severity=state==='connecting'||state==='CUEING'?'WARN':'INFO'
      tx.insert(healthEvents).values({id,channelId,component:observation.component,state,severity,message:`${observation.bus.toUpperCase()} · ${safeMetricLabel(observation.name)??'Nome indisponível'} · estado reportado ${state}; não confirma recuperação.`,occurredAt:at,context:snapshot.context}).run()
      const event=(observation.component==='OUTPUT'?'output.':'source.')+(observation.component==='OUTPUT'?state:state.toLowerCase())
      // Canonical failure already carries the correlated incident for FAILED.
      if(event!=='source.failed'&&event!=='output.failed')enqueueIntegrationEvent(tx,event,{incidentId:id,identity:observation.identity,bus:observation.bus,state,signalRecovered:false,physicalSignalValidated:false,context:snapshot.context},channelId,at)
    }
    return inserted
  },{behavior:'immediate'})
}
