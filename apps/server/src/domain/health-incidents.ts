import {randomUUID} from 'node:crypto'
import {and,count,desc,eq,gte,inArray,isNull,isNotNull,like,lt,lte,or} from 'drizzle-orm'
import type {Db} from '../db/client.js'
import {healthEvents,operatorDecisions} from '../db/schema.js'
import {IncidentContextSchema} from '@rplayout/protocol'

export interface IncidentAuthority {actor:string|null;channelIds:string[]|null;canAcknowledge:boolean}
export class IncidentError extends Error {
  constructor(readonly status:number,message:string){super(message)}
}

export interface IncidentPageQuery {
  channelId?:string;limit?:number;severity?:'ALL'|'INFO'|'WARN'|'CRITICAL'
  acknowledgement?:'ALL'|'PENDING'|'ACKNOWLEDGED'
  until?:string;beforeAt?:string;beforeId?:string
  /** '1': junto do canal, inclui incidentes do servidor (HOST, CLOCK, MEDIAMTX…),
   * que não pertencem a canal. Só para quem enxerga todos os canais. */
  includeHost?:string
}

/** Keyset pagination includes the ID because several transitions share a timestamp.
 * The date window stays fixed; acknowledgements reflect the current database. */
export function readHealthIncidentPage(db:Db,channelIds:string[]|null,query:IncidentPageQuery){
  for(const field of ['channelId','severity','acknowledgement','until','beforeAt','beforeId','includeHost'] as const)if(query[field]!==undefined&&typeof query[field]!=='string')throw new IncidentError(400,'Parâmetro de incidentes inválido.')
  const {channelId,beforeAt,beforeId}=query
  if(channelId&&channelIds!==null&&!channelIds.includes(channelId))throw new IncidentError(403,'Sem acesso aos incidentes deste canal.')
  const severity=query.severity??'ALL',acknowledgement=query.acknowledgement??'ALL'
  const validDate=(value:string)=>Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value
  if(!['ALL','INFO','WARN','CRITICAL'].includes(severity)||!['ALL','PENDING','ACKNOWLEDGED'].includes(acknowledgement))throw new IncidentError(400,'Filtro de incidentes inválido.')
  if((beforeAt===undefined)!==(beforeId===undefined)||beforeId!==undefined&&(!beforeId||beforeId.length>256)||beforeAt!==undefined&&!query.until)throw new IncidentError(400,'Cursor de incidentes incompleto.')
  const until=query.until??new Date().toISOString()
  if(!validDate(until)||beforeAt!==undefined&&(!validDate(beforeAt)||beforeAt>until))throw new IncidentError(400,'Janela de incidentes inválida.')
  const limit=Math.min(500,Math.max(1,Math.trunc(query.limit??200)||200))
  const withHost=query.includeHost==='1'&&channelIds===null
  const scope=channelId?(withHost?or(eq(healthEvents.channelId,channelId),isNull(healthEvents.channelId)):eq(healthEvents.channelId,channelId)):channelIds!==null?inArray(healthEvents.channelId,channelIds):undefined
  const none=channelIds?.length===0
  return db.transaction(tx=>{
    const pending={critical:0,warn:0}
    const risk={observedUnresolved:0,observationEndedUnresolved:0,withoutContext:0}
    if(!none){
      for(const level of ['CRITICAL','WARN'] as const){const n=tx.select({n:count()}).from(healthEvents).where(and(scope,isNull(healthEvents.acknowledgedAt),eq(healthEvents.severity,level))).get()?.n??0;pending[level==='CRITICAL'?'critical':'warn']=n}
      const unresolved=and(scope,or(and(eq(healthEvents.component,'SIGNAL'),like(healthEvents.id,'pgm-signal:%:active'),inArray(healthEvents.state,['black','freeze','silence'])),and(inArray(healthEvents.component,['LIVE_SOURCE','OUTPUT']),like(healthEvents.id,'runtime-signal:%:active'))),isNull(healthEvents.resolvedAt))
      const amount=(filter:ReturnType<typeof and>)=>tx.select({n:count()}).from(healthEvents).where(and(unresolved,filter)).get()?.n??0
      risk.observedUnresolved=amount(isNull(healthEvents.observationEndedAt));risk.observationEndedUnresolved=amount(isNotNull(healthEvents.observationEndedAt));risk.withoutContext=amount(isNull(healthEvents.context))
    }
    const filters=and(scope,lte(healthEvents.occurredAt,until),severity==='ALL'?undefined:eq(healthEvents.severity,severity),acknowledgement==='ALL'?undefined:acknowledgement==='PENDING'?isNull(healthEvents.acknowledgedAt):isNotNull(healthEvents.acknowledgedAt))
    const totalMatching=none?0:tx.select({n:count()}).from(healthEvents).where(filters).get()?.n??0
    const rows=none?[]:tx.select().from(healthEvents).where(and(filters,beforeAt&&beforeId?or(lt(healthEvents.occurredAt,beforeAt),and(eq(healthEvents.occurredAt,beforeAt),lt(healthEvents.id,beforeId))):undefined)).orderBy(desc(healthEvents.occurredAt),desc(healthEvents.id)).limit(limit+1).all()
    const hasMore=rows.length>limit,events=rows.slice(0,limit).map(row=>{
      if(row.context!==null){const checked=IncidentContextSchema.safeParse(row.context);if(!checked.success||checked.data.channelId!==row.channelId)throw new IncidentError(409,'Contexto de incidente não confiável; consulta interrompida.');return {...row,context:checked.data}}
      return row
    }),last=events.at(-1)
    return {events,pending,risk,page:{until,totalMatching,hasMore,nextBefore:hasMore&&last?{occurredAt:last.occurredAt,id:last.id}:null}}
  })
}

/** Apply visibility before the limit: other channels must not starve this list. */
export function readHealthIncidents(db:Db,channelIds:string[]|null,channelId:string|undefined,limit:number,since?:string,includeHost=false){
  if(channelId&&channelIds!==null&&!channelIds.includes(channelId))throw new IncidentError(403,'Sem acesso aos incidentes deste canal.')
  if(channelIds?.length===0)return []
  const withHost=includeHost&&channelIds===null
  const scope=channelId?(withHost?or(eq(healthEvents.channelId,channelId),isNull(healthEvents.channelId)):eq(healthEvents.channelId,channelId)):channelIds!==null?inArray(healthEvents.channelId,channelIds):undefined
  return db.select().from(healthEvents).where(and(scope,since?gte(healthEvents.occurredAt,since):undefined))
    .orderBy(desc(healthEvents.occurredAt),desc(healthEvents.id)).limit(limit).all().reverse()
}

/** Acknowledgement is not signal recovery. Audit and timestamp commit together. */
export function acknowledgeHealthIncident(db:Db,id:string,authority:()=>IncidentAuthority){
  return db.transaction(tx=>{
    const access=authority()
    if(!access.canAcknowledge)throw new IncidentError(403,'Supervisor, Gestor ou Administrador precisa reconhecer alertas.')
    const event=tx.select().from(healthEvents).where(eq(healthEvents.id,id)).get()
    if(!event)throw new IncidentError(404,'Alerta não encontrado.')
    if(access.channelIds!==null&&(event.channelId===null||!access.channelIds.includes(event.channelId)))throw new IncidentError(403,'Sem acesso a este alerta.')
    if(event.acknowledgedAt)return {ok:true as const,acknowledgedAt:event.acknowledgedAt,deduplicated:true,signalRecovered:false as const}
    const acknowledgedAt=new Date().toISOString()
    tx.insert(operatorDecisions).values({id:randomUUID(),rundownId:'@health',itemId:null,kind:'HEALTH_EVENT_ACKNOWLEDGED',actorUsername:access.actor,createdAt:acknowledgedAt,
      payload:{eventId:event.id,channelId:event.channelId,component:event.component,state:event.state,severity:event.severity,acknowledgedAt,signalRecovered:false}}).run()
    const changed=tx.update(healthEvents).set({acknowledgedAt}).where(and(eq(healthEvents.id,id),eq(healthEvents.occurredAt,event.occurredAt))).run()
    if(changed.changes!==1)throw new IncidentError(409,'Alerta não reconhecido; gravação não confirmada.')
    return {ok:true as const,acknowledgedAt,deduplicated:false,signalRecovered:false as const}
  })
}
