import {and,asc,eq,sql} from 'drizzle-orm'
import {createHash} from 'node:crypto'
import type {Db} from '../db/client.js'
import {operatorDecisions} from '../db/schema.js'
import {graphicDisplaySchema} from './graphic-composition.js'

export const HA_GRAPHIC_RECEIPT_PREFIX='ha-graphic:'
const kinds=['HA_GRAPHIC_PREPARATION','HA_GRAPHIC_EXPIRATION','HA_SECONDARY']
/** Authenticated schema codec, insertion chronology, strict local namespace.
 * This reads a display input only; it never promotes a foreign receipt to a
 * local command or interprets a historical ACK as present publication. */
export function readHaGraphicComposition(db:Db,channelId:string,receiptId:string){
  if(!receiptId.startsWith(HA_GRAPHIC_RECEIPT_PREFIX))throw new Error('Recibo não pertence à composição local HA.')
  const id=receiptId.slice(HA_GRAPHIC_RECEIPT_PREFIX.length)
  if(!/^[a-f0-9-]{36}:CONFIRMED$/i.test(id))throw new Error('Identidade de recibo gráfico HA inválida.')
  const row=db.select().from(operatorDecisions).where(and(eq(operatorDecisions.id,id),eq(operatorDecisions.rundownId,'@ha'))).get()
  if(!row||!kinds.some(kind=>row.kind===kind+'_CONFIRMED')||row.payload.channelId!==channelId||typeof row.payload.promotionId!=='string'||typeof row.payload.ownerId!=='string'||!Number.isSafeInteger(row.payload.term)||Number(row.payload.term)<=0)throw new Error('Composição HA sem confirmação/vínculo nativos deste canal.')
  const display=graphicDisplaySchema.parse(row.payload.composition)
  if(row.payload.compositionHash!==createHash('sha256').update(JSON.stringify(display)).digest('hex'))throw new Error('SHA da composição HA não corresponde ao recibo.')
  const later=db.select().from(operatorDecisions).where(and(eq(operatorDecisions.rundownId,'@ha'),sql`rowid > (SELECT rowid FROM operator_decisions WHERE id=${id})`)).orderBy(asc(sql`rowid`)).all()
  const phases=new Map<string,string>()
  for(const next of later){
    if(next.payload.channelId!==channelId||next.payload.promotionId!==row.payload.promotionId||next.payload.ownerId!==row.payload.ownerId||next.payload.term!==row.payload.term||!kinds.some(kind=>next.kind.startsWith(kind+'_')))continue
    const separator=next.id.lastIndexOf(':')
    if(separator<0)throw new Error('Histórico gráfico HA inválido.')
    const phase=next.id.slice(separator+1)
    if(!['ACCEPTED','SENDING','CONFIRMED','REJECTED','UNCERTAIN','SUPERSEDED'].includes(phase))throw new Error('Fase gráfica HA desconhecida.')
    phases.set(next.id.slice(0,separator),phase)
    if(phase==='CONFIRMED')throw new Error('Checkpoint gráfico HA anterior à composição confirmada mais recente.')
  }
  if([...phases.values()].some(phase=>!['REJECTED','SUPERSEDED'].includes(phase)))throw new Error('Composição HA posterior incerta/em andamento; não restaurar display anterior.')
  return display
}
