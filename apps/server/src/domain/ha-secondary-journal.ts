import {and,asc,eq,sql} from 'drizzle-orm'
import {z} from 'zod'
import {createHash} from 'node:crypto'
import type {Db} from '../db/client.js'
import {operatorDecisions} from '../db/schema.js'
import {graphicDisplaySchema} from './graphic-composition.js'

const facts=z.object({version:z.literal(1),promotionId:z.string().uuid(),channelId:z.string().min(1),executionId:z.string().min(1),revisionId:z.string().nullable(),itemId:z.string().min(1),decoderId:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),eventId:z.string().min(1),mode:z.enum(['FIRE','DISMISS']),frames:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),ownerId:z.string().min(1),term:z.number().int().positive().max(Number.MAX_SAFE_INTEGER)}).passthrough()
type Row={id:string;kind:string;createdAt:string;payload:Record<string,unknown>}
/** Read-only projection for replication/restart. Never inserts foreign/local
 * HA outcomes into the ordinary run table or proves present physical signal. */
export function canonicalHaSecondaryRuns(rows:readonly Row[]){
  const groups=new Map<string,{facts:z.infer<typeof facts>;phases:Set<string>;last:string;createdAt:string;completedAt:string|null}>()
  for(const row of rows){
    if(!row.kind.startsWith('HA_SECONDARY_'))continue
    const separator=row.id.lastIndexOf(':'),id=row.id.slice(0,separator),phase=row.id.slice(separator+1)
    if(!z.string().uuid().safeParse(id).success||row.kind!=='HA_SECONDARY_'+phase||!['ACCEPTED','SENDING','CONFIRMED','REJECTED','UNCERTAIN','SUPERSEDED'].includes(phase))throw new Error('Fase HA secundária inválida.')
    const value=facts.parse(row.payload),previous=groups.get(id)
    if(phase==='SUPERSEDED'&&(value.mode!=='DISMISS'||previous?.last!=='ACCEPTED'))throw new Error('Descarte HA substituído não pode representar comando enviado.')
    if(!previous){if(phase!=='ACCEPTED')throw new Error('Evento HA sem intenção anterior.');groups.set(id,{facts:value,phases:new Set([phase]),last:phase,createdAt:row.createdAt,completedAt:null});continue}
    const identity=(entry:z.infer<typeof facts>)=>JSON.stringify([entry.promotionId,entry.channelId,entry.executionId,entry.revisionId,entry.itemId,entry.decoderId,entry.eventId,entry.mode,entry.ownerId,entry.term])
    if(identity(value)!==identity(previous.facts)||previous.phases.has(phase)||!['ACCEPTED','SENDING'].includes(previous.last)||phase==='CONFIRMED'&&previous.last!=='SENDING'||phase==='UNCERTAIN'&&previous.last!=='SENDING')throw new Error('Cronologia/contexto HA secundário inconsistente.')
    if(phase==='CONFIRMED'){
      const display=graphicDisplaySchema.parse(value.composition)
      if(value.compositionHash!==createHash('sha256').update(JSON.stringify(display)).digest('hex'))throw new Error('Evento HA sem composição confirmada íntegra.')
    }
    if(phase==='SENDING')previous.facts=value
    previous.phases.add(phase);previous.last=phase
    if(['CONFIRMED','REJECTED','UNCERTAIN','SUPERSEDED'].includes(phase))previous.completedAt=row.createdAt
  }
  return [...groups].map(([id,entry])=>({id:'ha-secondary:'+id,channelId:entry.facts.channelId,executionId:entry.facts.executionId,revisionId:entry.facts.revisionId,itemId:entry.facts.itemId,eventId:entry.facts.eventId,mode:entry.facts.mode,
    state:entry.last==='CONFIRMED'?'EXECUTED' as const:entry.last==='REJECTED'||entry.last==='SUPERSEDED'?'FAILED' as const:'FIRING' as const,
    frames:entry.facts.frames,createdAt:entry.createdAt,completedAt:entry.last==='UNCERTAIN'?null:entry.completedAt,error:entry.last==='UNCERTAIN'?'Resultado HA incerto; não reenviar.':null,sourceNamespace:'HA_SECONDARY' as const,physicalOutputValidated:false as const}))
}
export function readHaSecondaryRuns(db:Db,channelId?:string){
  const rows=db.select().from(operatorDecisions).where(and(eq(operatorDecisions.rundownId,'@ha'),sql`${operatorDecisions.kind} LIKE 'HA_SECONDARY_%'`)).orderBy(asc(sql`rowid`)).all()
  return canonicalHaSecondaryRuns(rows).filter(row=>channelId===undefined||row.channelId===channelId)
}
