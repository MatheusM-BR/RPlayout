import {and,count,eq,inArray,isNull,or} from 'drizzle-orm'
import type {Db} from '../db/client.js'
import {healthEvents} from '../db/schema.js'
import {IncidentError} from './health-incidents.js'

/**
 * Só as contagens de pendentes (críticos e avisos sem ciente), para o selo
 * ALERTAS do cabeçalho. A página completa (`readHealthIncidentPage`) também
 * conta riscos, total filtrado e decifra as mensagens das linhas: com 100 mil
 * incidentes no banco, ~2 s por leitura -- e o cabeçalho relia a cada 10 s em
 * cada aba. Estas duas contagens usam o índice de pendentes por canal
 * (health_events_channel_pending) e não leem linha nenhuma.
 *
 * Mesmas regras de visibilidade da página: conta de canal restrito não vê
 * outro canal; incidentes do servidor só para quem enxerga todos os canais.
 */
export function readHealthPending(db:Db,channelIds:string[]|null,query:{channelId?:unknown;includeHost?:unknown}):{pending:{critical:number;warn:number}}{
  const channelId=typeof query.channelId==='string'?query.channelId:undefined
  if(query.channelId!==undefined&&channelId===undefined||query.includeHost!==undefined&&typeof query.includeHost!=='string')throw new IncidentError(400,'Parâmetro de incidentes inválido.')
  if(channelId&&channelIds!==null&&!channelIds.includes(channelId))throw new IncidentError(403,'Sem acesso aos incidentes deste canal.')
  if(channelIds?.length===0)return {pending:{critical:0,warn:0}}
  const withHost=query.includeHost==='1'&&channelIds===null
  const scope=channelId?(withHost?or(eq(healthEvents.channelId,channelId),isNull(healthEvents.channelId)):eq(healthEvents.channelId,channelId)):channelIds!==null?inArray(healthEvents.channelId,channelIds):undefined
  const amount=(severity:'CRITICAL'|'WARN')=>db.select({n:count()}).from(healthEvents).where(and(scope,isNull(healthEvents.acknowledgedAt),eq(healthEvents.severity,severity))).get()?.n??0
  return {pending:{critical:amount('CRITICAL'),warn:amount('WARN')}}
}
