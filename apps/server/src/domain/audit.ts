import {and,desc,eq,lt,or} from 'drizzle-orm'
import type {Db} from '../db/client.js'
import {operatorDecisions,rundowns} from '../db/schema.js'
import {sanitizeDiagnostic} from './sanitize-diagnostic.js'

const sensitiveKey=/^(?:password|passwd|token|accessToken|secret|credentials?|passphrase|streamKey|stream_id|authorization|cookie)$/i
export function publicAuditValue(value:unknown):unknown {
  if(typeof value==='string')return sanitizeDiagnostic(value)
  if(Array.isArray(value))return value.map(publicAuditValue)
  if(value && typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,entry])=>[key,sensitiveKey.test(key) ? '[PROTEGIDO]' : publicAuditValue(entry)]))
  return value
}

/** Visibility precedes the limit. Keyset pagination cannot starve a channel
 * just because unrelated administration events occupy the newest rows. */
export async function readAudit(db:Db,scope:{channelIds:string[]|null;channelId?:string;globalAdmin:boolean;kind?:string;actor?:string;before?:{createdAt:string;id:string}},limit:number) {
  const ownership=new Map((await db.select({id:rundowns.id,channelId:rundowns.channelId}).from(rundowns)).map(row=>[row.id,row.channelId]))
  const result:Array<typeof operatorDecisions.$inferSelect>=[]
  let cursor:{createdAt:string;id:string}|undefined=scope.before
  while(result.length<limit){
    const rows=await db.select().from(operatorDecisions)
      .where(cursor ? or(lt(operatorDecisions.createdAt,cursor.createdAt),and(eq(operatorDecisions.createdAt,cursor.createdAt),lt(operatorDecisions.id,cursor.id))) : undefined)
      .orderBy(desc(operatorDecisions.createdAt),desc(operatorDecisions.id)).limit(256)
    if(!rows.length)break
    for(const row of rows){
      const ids=new Set<string>()
      const owner=ownership.get(row.rundownId);if(owner)ids.add(owner)
      const payload=row.payload && typeof row.payload==='object' && !Array.isArray(row.payload) ? row.payload : {}
      if(typeof payload.channelId==='string')ids.add(payload.channelId)
      if(Array.isArray(payload.channelIds))for(const id of payload.channelIds)if(typeof id==='string')ids.add(id)
      if(scope.kind&&row.kind!==scope.kind)continue
      if(scope.actor&&(row.actorUsername??'').toLowerCase()!==scope.actor.toLowerCase())continue
      const visible=ids.size>0 ?
        (!scope.channelId || ids.has(scope.channelId)) && [...ids].every(id=>scope.channelIds===null || scope.channelIds.includes(id)) :
        scope.globalAdmin && scope.channelIds===null && !scope.channelId
      if(visible)result.push({...row,payload:publicAuditValue(row.payload) as Record<string,unknown>})
      if(result.length===limit)break
    }
    const last=rows.at(-1)!;cursor={createdAt:last.createdAt,id:last.id}
    if(rows.length<256)break
  }
  return result.reverse()
}
