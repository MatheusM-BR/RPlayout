import { randomUUID } from 'node:crypto'
import { and,eq } from 'drizzle-orm'
import type { SecondaryEvent } from '@rplayout/protocol'
import type { Db } from '../db/client.js'
import { secondaryEventRuns, healthEvents } from '../db/schema.js'
export class SecondaryEventUncertain extends Error {}

/** Persist intention before external side effects. A crash during FIRE leaves
 * FIRING (uncertain), which is NOT replayed automatically on recovery. Exactly
 * once cannot be guaranteed by an arbitrary external hardware gateway. */
export class SecondaryEventLedger {
  constructor(private readonly db:Db,private readonly channelId:string) {}
  async execute(context:{executionId:string;itemId:string;revisionId:string|null;frames:number},event:SecondaryEvent,mode:'FIRE'|'DISMISS',work:()=>Promise<void>,restoreGraphics=false):Promise<boolean> {
    const id=randomUUID()
    const result=this.db.insert(secondaryEventRuns).values({id,channelId:this.channelId,...context,eventId:event.id,mode,state:'FIRING',createdAt:new Date().toISOString()}).onConflictDoNothing().run()
    if (!result.changes) {
      if (restoreGraphics && event.type==='GRAPHICS_OVERLAY' && mode==='FIRE') {
        const rows=await this.db.select().from(secondaryEventRuns).where(and(eq(secondaryEventRuns.executionId,context.executionId),eq(secondaryEventRuns.eventId,event.id)))
        if (rows.some(row=>row.mode==='FIRE' && row.state==='EXECUTED') && !rows.some(row=>row.mode==='DISMISS')) {
          // Rendering a frozen local SVG is idempotent. Never resend SCTE or
          // external device commands to reconstruct the display after restart.
          await work()
        }
      }
      return false
    }
    try {
      await work()
      await this.db.update(secondaryEventRuns).set({state:'EXECUTED',completedAt:new Date().toISOString()}).where(eq(secondaryEventRuns.id,id))
      return true
    } catch (error) {
      const uncertain = error instanceof SecondaryEventUncertain
      const message=uncertain ? 'Resultado do equipamento incerto. Confira o destino e reconheça o pedido na automação antes de um novo roteamento; não haverá reenvio automático.' : 'Comando secundário falhou; consulte o gateway/saída antes de tentar novamente. Não será repetido automaticamente.'
      await this.db.update(secondaryEventRuns).set({state:uncertain?'FIRING':'FAILED',error:message,completedAt:uncertain?null:new Date().toISOString()}).where(eq(secondaryEventRuns.id,id))
      await this.db.insert(healthEvents).values({id:randomUUID(),channelId:this.channelId,component:'SECONDARY_EVENT',state:uncertain?'uncertain':'failed',severity:'CRITICAL',message:`Evento ${event.id}: ${message}`,occurredAt:new Date().toISOString()})
      return false
    }
  }
}
