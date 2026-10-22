import { randomUUID,createHash } from 'node:crypto'
import { and,eq,isNull } from 'drizzle-orm'
import type { SecondaryEvent } from '@rplayout/protocol'
import type { Db } from '../db/client.js'
import { secondaryEventRuns, healthEvents,operatorDecisions } from '../db/schema.js'
import {readHaSecondaryRuns} from './ha-secondary-journal.js'
export class SecondaryEventUncertain extends Error {}
// Only work actually executing on this database handle is exempt. A FIRING
// row from another connection/process is never inferred to be alive or dead.
const localWork=new WeakMap<object,Set<string>>()
function graphicSelectionMatches(row:typeof secondaryEventRuns.$inferSelect,selection:unknown):boolean {
  if(!selection||typeof selection!=='object'||Array.isArray(selection))return false
  const value=selection as Record<string,unknown>,event=value.event as Record<string,unknown>|undefined
  return value.action==='SECONDARY_'+row.mode&&value.executionId===row.executionId&&value.revisionId===row.revisionId&&
    !!event&&typeof event==='object'&&!Array.isArray(event)&&event.id===row.eventId&&event.rundownItemId===row.itemId&&
    event.type!=='SCTE_TRIGGER'&&event.type!=='DEVICE_AUTOMATION'&&!event.scteConfig&&!event.deviceConfig
}

/** Persist intention before external side effects. A crash during FIRE leaves
 * FIRING (uncertain), which is NOT replayed automatically on recovery. Exactly
 * once cannot be guaranteed by an arbitrary external hardware gateway. */
export class SecondaryEventLedger {
  constructor(private readonly db:Db,private readonly channelId:string) {}
  assertActiveGraphicBinding(runId:string,selection:object):void {
    const row=this.db.select().from(secondaryEventRuns).where(and(eq(secondaryEventRuns.id,runId),eq(secondaryEventRuns.channelId,this.channelId))).get()
    if(!row||row.state!=='FIRING'||!localWork.get(this.db.$client)?.has(runId)||!graphicSelectionMatches(row,selection))throw new Error('Vínculo gráfico não pertence ao evento secundário em execução.')
  }
  /** Recover bookkeeping only from an explicitly bound durable terminal.
   * REVIEWED/UNCERTAIN and legacy unbound receipts are not execution proof. */
  reconcileGraphicReceipts():number {
    return this.db.transaction(()=>{
      const rows=this.db.select().from(secondaryEventRuns).where(and(eq(secondaryEventRuns.channelId,this.channelId),eq(secondaryEventRuns.state,'FIRING'))).all()
      if(!rows.length)return 0
      const accepted=this.db.select().from(operatorDecisions).where(and(eq(operatorDecisions.rundownId,'@graphics:'+this.channelId),eq(operatorDecisions.kind,'GRAPHIC_COMMAND_ACCEPTED'))).all()
      let reconciled=0
      for(const row of rows){
        if(localWork.get(this.db.$client)?.has(row.id))continue
        for(const receipt of accepted){
          if(receipt.payload.secondaryRunId!==row.id||!graphicSelectionMatches(row,receipt.payload.selection)||!receipt.id.endsWith(':ACCEPTED'))continue
          const phase=receipt.payload.native===true?'CONFIRMED':receipt.payload.native===false?'SIMULATED':null
          if(!phase)continue
          const commandId=receipt.id.slice(0,-9)
          const terminal=this.db.select().from(operatorDecisions).where(and(eq(operatorDecisions.id,commandId+':'+phase),eq(operatorDecisions.rundownId,receipt.rundownId),eq(operatorDecisions.kind,'GRAPHIC_COMMAND_'+phase))).get()
          if(!terminal)continue
          const identity=createHash('sha256').update(JSON.stringify([this.channelId,row.id])).digest('hex')
          this.db.update(secondaryEventRuns).set({state:'EXECUTED',error:null,completedAt:terminal.createdAt}).where(and(eq(secondaryEventRuns.id,row.id),eq(secondaryEventRuns.state,'FIRING'))).run()
          this.db.insert(operatorDecisions).values({id:'secondary-reconciled:'+identity,rundownId:receipt.rundownId,kind:'SECONDARY_GRAPHIC_RECONCILED',actorUsername:null,createdAt:new Date().toISOString(),payload:{secondaryRunId:row.id,graphicCommandId:commandId,terminalState:phase,physicalOutputValidated:false,signalRecovered:false}}).run()
          reconciled++
          break
        }
      }
      return reconciled
    },{behavior:'immediate'})
  }
  hasUnconfirmed():boolean {
    if(readHaSecondaryRuns(this.db,this.channelId).some(row=>row.state==='FIRING'))return true
    const active=localWork.get(this.db.$client)
    const rows=this.db.$client.prepare("SELECT id FROM secondary_event_runs WHERE channel_id=? AND state='FIRING'").iterate(this.channelId) as Iterable<{id:string}>
    for(const row of rows)if(!active?.has(row.id))return true
    return false
  }
  /** Admission repairs missing diagnostics, never outcomes. FIRING alone is
   * not proof that an old process died or that the destination did not act. */
  reportUnconfirmed():number {
    return this.db.transaction(()=>{
      const rows=this.db.select({id:secondaryEventRuns.id}).from(secondaryEventRuns).where(and(
        eq(secondaryEventRuns.channelId,this.channelId),eq(secondaryEventRuns.state,'FIRING'),
      )).all()
      let inserted=0
      for(const row of rows){
        const identity=createHash('sha256').update(JSON.stringify([this.channelId,row.id])).digest('hex')
        inserted+=this.db.insert(healthEvents).values({
          id:'secondary-unconfirmed:'+identity,channelId:this.channelId,
          component:'SECONDARY_EVENT',state:'secondary_confirmation_missing',severity:'CRITICAL',
          message:'Evento secundário registrado sem confirmação durável. Confira o histórico da automação e o destino; não haverá reenvio automático. A parada do processo anterior e a recuperação física não estão comprovadas por este registro.',
          occurredAt:new Date().toISOString(),
        }).onConflictDoNothing().run().changes
      }
      return inserted
    },{behavior:'immediate'})
  }
  fireFor(context:{executionId:string;itemId:string;revisionId:string|null},eventId:string) {
    return this.db.select().from(secondaryEventRuns).where(and(
      eq(secondaryEventRuns.channelId,this.channelId),
      eq(secondaryEventRuns.executionId,context.executionId),
      eq(secondaryEventRuns.itemId,context.itemId),
      context.revisionId===null?isNull(secondaryEventRuns.revisionId):eq(secondaryEventRuns.revisionId,context.revisionId),
      eq(secondaryEventRuns.eventId,eventId),eq(secondaryEventRuns.mode,'FIRE'),
    )).get()??readHaSecondaryRuns(this.db,this.channelId).find(row=>row.executionId===context.executionId&&row.itemId===context.itemId&&row.revisionId===context.revisionId&&row.eventId===eventId&&row.mode==='FIRE')
  }
  async execute(context:{executionId:string;itemId:string;revisionId:string|null;frames:number},event:SecondaryEvent,mode:'FIRE'|'DISMISS',work:(runId:string)=>Promise<void>,restoreGraphics=false):Promise<boolean> {
    const ha=readHaSecondaryRuns(this.db,this.channelId).filter(row=>row.executionId===context.executionId&&row.itemId===context.itemId&&row.revisionId===context.revisionId&&row.eventId===event.id)
    if(ha.length){
      if(ha.some(row=>row.state==='FIRING'))throw new SecondaryEventUncertain('Ocorrência HA anterior incerta; confira histórico, sem reenvio automático.')
      // Composition restoration has its own bound receipt path. Never replay
      // FIRE/DISMISS merely to create an ordinary row after HA/restart.
      return false
    }
    const id=randomUUID()
    const result=this.db.insert(secondaryEventRuns).values({id,channelId:this.channelId,...context,eventId:event.id,mode,state:'FIRING',createdAt:new Date().toISOString()}).onConflictDoNothing().run()
    if (!result.changes) {
      if (restoreGraphics && event.type==='GRAPHICS_OVERLAY' && mode==='FIRE') {
        // A confirmed event belongs to one frozen occurrence, not merely to
        // an event/execution identifier supplied by the caller. In particular,
        // NULL is a legacy revision, never a wildcard for a published revision.
        const rows=await this.db.select().from(secondaryEventRuns).where(and(
          eq(secondaryEventRuns.channelId,this.channelId),
          eq(secondaryEventRuns.executionId,context.executionId),
          eq(secondaryEventRuns.itemId,context.itemId),
          context.revisionId===null?isNull(secondaryEventRuns.revisionId):eq(secondaryEventRuns.revisionId,context.revisionId),
          eq(secondaryEventRuns.eventId,event.id),
        ))
        if (rows.some(row=>row.mode==='FIRE' && row.state==='EXECUTED') && !rows.some(row=>row.mode==='DISMISS')) {
          // Rendering a frozen local SVG is idempotent. Never resend SCTE or
          // external device commands to reconstruct the display after restart.
          // Reconstruction already has a completed occurrence; it creates a
          // fresh display receipt, not a new binding to the old FIRING phase.
          await work('')
        }
      }
      return false
    }
    let active=localWork.get(this.db.$client)
    if(!active){active=new Set();localWork.set(this.db.$client,active)}
    active.add(id)
    let workCompleted=false
    try {
      await work(id)
      workCompleted=true
      await this.db.update(secondaryEventRuns).set({state:'EXECUTED',completedAt:new Date().toISOString()}).where(eq(secondaryEventRuns.id,id))
      return true
    } catch (error) {
      // The side effect finished. Failure to persist completion is not a
      // refusal by the destination: keep FIRING for receipt reconciliation.
      if(workCompleted)throw error
      const uncertain = error instanceof SecondaryEventUncertain
      const message=uncertain ? 'Resultado do equipamento incerto. Confira o destino e reconheça o pedido na automação antes de um novo roteamento; não haverá reenvio automático.' : 'Comando secundário falhou; consulte o gateway/saída antes de tentar novamente. Não será repetido automaticamente.'
      await this.db.update(secondaryEventRuns).set({state:uncertain?'FIRING':'FAILED',error:message,completedAt:uncertain?null:new Date().toISOString()}).where(eq(secondaryEventRuns.id,id))
      await this.db.insert(healthEvents).values({id:randomUUID(),channelId:this.channelId,component:'SECONDARY_EVENT',state:uncertain?'uncertain':'failed',severity:'CRITICAL',message:`Evento ${event.id}: ${message}`,occurredAt:new Date().toISOString()})
      return false
    } finally {active.delete(id)}
  }
}
