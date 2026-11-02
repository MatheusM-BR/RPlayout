import {createHash} from 'node:crypto'
import {eq} from 'drizzle-orm'
import type {Db} from '../db/client.js'
import {operatorDecisions} from '../db/schema.js'
import {GraphicCommandLedger} from './graphic-command-ledger.js'

export interface GraphicRecoveryContext {executionId:string|undefined;revisionId:string|null;itemId:string;startedAt?:number}
const identity=(context:GraphicRecoveryContext)=>JSON.stringify([context.executionId??null,context.revisionId,context.itemId,context.startedAt??null])
/** Active warning lifecycle, separate from transport/recovery errors. Audit
 * preserves the unknown historical result even after a new known composition. */
export class GraphicRecoveryIncident {
  readonly id:string
  private resolved=false
  constructor(private readonly db:Db,private readonly channelId:string,private readonly context:GraphicRecoveryContext,private readonly sourceReceipt:string|null,readonly message:string){
    this.id='graphic-recovery:'+createHash('sha256').update(JSON.stringify([channelId,identity(context),sourceReceipt])).digest('hex')
    this.db.transaction(()=>{
      const existing=this.db.select().from(operatorDecisions).where(eq(operatorDecisions.id,this.id)).get()
      if(existing&&(existing.kind!=='GRAPHIC_RECOVERY_BLOCKED'||existing.rundownId!=='@graphics:'+channelId||existing.payload.channelId!==channelId||existing.payload.sourceReceipt!==sourceReceipt||identity(existing.payload.context as GraphicRecoveryContext)!==identity(context)))throw new Error('Identidade do incidente gráfico diverge do histórico; registro preservado.')
      if(!existing)this.db.insert(operatorDecisions).values({id:this.id,rundownId:'@graphics:'+channelId,kind:'GRAPHIC_RECOVERY_BLOCKED',actorUsername:null,createdAt:new Date().toISOString(),payload:{channelId,context,sourceReceipt,message,historicalResultKnown:false,physicalOutputValidated:false}}).run()
    },{behavior:'immediate'})
  }
  reconcile(current:GraphicRecoveryContext|null):boolean {
    if(this.resolved)return true
    if(!current||identity(current)!==identity(this.context))return false
    const ledger=new GraphicCommandLedger(this.db,this.channelId),head=ledger.latestNativeCompositionId()
    if(!head||head===this.sourceReceipt||ledger.hasUnresolved())return false
    const confirmedContext=ledger.confirmedContext(head)
    if(!confirmedContext||identity(confirmedContext)!==identity(current))return false
    try{ledger.confirmedDisplay(head)}catch{return false}
    this.db.transaction(()=>{
      // Recheck inside the transaction; never clear on a stale head or review.
      if(ledger.latestNativeCompositionId()!==head)throw new Error('Composição mudou durante reconciliação de alerta.')
      ledger.confirmedDisplay(head)
      const freshContext=ledger.confirmedContext(head)
      if(!freshContext||identity(freshContext)!==identity(current))throw new Error('Confirmação gráfica pertence a outra ocorrência de PGM.')
      const id=this.id+':known:'+head
      const existing=this.db.select().from(operatorDecisions).where(eq(operatorDecisions.id,id)).get()
      if(existing&&(existing.kind!=='GRAPHIC_RECOVERY_REESTABLISHED'||existing.rundownId!=='@graphics:'+this.channelId||existing.payload.incidentId!==this.id||existing.payload.confirmedReceipt!==head))throw new Error('Correlação da resolução gráfica diverge do histórico; alerta mantido.')
      if(!existing)this.db.insert(operatorDecisions).values({id,rundownId:'@graphics:'+this.channelId,kind:'GRAPHIC_RECOVERY_REESTABLISHED',actorUsername:null,createdAt:new Date().toISOString(),payload:{channelId:this.channelId,incidentId:this.id,context:current,previousSourceReceipt:this.sourceReceipt,confirmedReceipt:head,activeWarningResolved:true,historicalResultKnown:false,physicalOutputValidated:false,signalRecovered:false}}).run()
    },{behavior:'immediate'})
    this.resolved=true
    return true
  }
}
