import {afterEach,expect,it,vi} from 'vitest'
import {openDatabase} from '../db/client.js'
import {operatorDecisions,secondaryEventRuns,healthEvents} from '../db/schema.js'
import {SecondaryEventLedger} from './secondary-event-ledger.js'
import {GraphicCommandLedger} from './graphic-command-ledger.js'
import {EngineCommandRejected} from './engine.js'
const databases:ReturnType<typeof openDatabase>[]=[]
afterEach(()=>{for(const db of databases.splice(0))db.sqlite.close()})
const event={id:'event',rundownItemId:'item',targetLayer:'LOWER_THIRD' as const,triggerMode:'OFFSET_FROM_START' as const,offsetFrames:0,templateId:'',payload:{},enabled:true,type:'GRAPHICS_OVERLAY' as const}
const context={executionId:'execution',itemId:'item',revisionId:'revision',frames:12}
async function interrupted(native=true,outcome:'confirmed'|'uncertain'|'rejected'='confirmed',bind=true,denyOnlyCompletion=false){
  const database=openDatabase(':memory:');databases.push(database)
  const secondary=new SecondaryEventLedger(database.db,'ch'),graphics=new GraphicCommandLedger(database.db,'ch'),sendEffect=vi.fn()
  // Interrupt the bookkeeping after the real graphic ledger has committed.
  database.sqlite.exec("CREATE TRIGGER deny_secondary_completion BEFORE UPDATE ON secondary_event_runs "+(denyOnlyCompletion?"WHEN NEW.state='EXECUTED' ":'')+"BEGIN SELECT RAISE(ABORT,'completion-storage-fault'); END")
  await expect(secondary.execute(context,event,'FIRE',async runId=>{
    await graphics.execute({key:'secondary-confirmation',actorId:null,actorName:'AUTOMATIC',native,selection:{action:'SECONDARY_FIRE',executionId:context.executionId,revisionId:context.revisionId,event},...(bind?{secondaryRunId:runId}:{})},()=>{},async send=>{
      send();sendEffect()
      if(outcome==='uncertain')throw new Error('ACK_TIMEOUT')
      if(outcome==='rejected')throw new EngineCommandRejected('REJECTED')
    })
  })).rejects.toThrow('completion-storage-fault')
  database.sqlite.exec('DROP TRIGGER deny_secondary_completion')
  return {database,secondary,graphics,sendEffect}
}
it.each([true,false])('recupera conclusão vinculada nativa=%s sem reenviar e sem declarar sinal recuperado',async native=>{
  const {database,secondary,graphics,sendEffect}=await interrupted(native)
  expect(secondary.hasUnconfirmed()).toBe(true)
  secondary.reportUnconfirmed()
  const alarm=database.db.select().from(healthEvents).get()!
  database.sqlite.prepare('UPDATE health_events SET acknowledged_at=? WHERE id=?').run('operator-reviewed',alarm.id)
  expect(new SecondaryEventLedger(database.db,'ch').reconcileGraphicReceipts()).toBe(1)
  expect(secondary.hasUnconfirmed()).toBe(false)
  expect(secondary.fireFor(context,event.id)).toMatchObject({state:'EXECUTED',error:null,completedAt:expect.any(String)})
  const audit=database.db.select().from(operatorDecisions).all().find(row=>row.kind==='SECONDARY_GRAPHIC_RECONCILED')!
  expect(audit.payload).toMatchObject({graphicCommandId:graphics.list()[0]!.id,terminalState:native?'CONFIRMED':'SIMULATED',signalRecovered:false,physicalOutputValidated:false})
  expect(new SecondaryEventLedger(database.db,'ch').reconcileGraphicReceipts()).toBe(0)
  expect(sendEffect).toHaveBeenCalledTimes(1)
  expect(database.sqlite.prepare('SELECT acknowledged_at,resolved_at FROM health_events').get()).toEqual({acknowledged_at:'operator-reviewed',resolved_at:null})
})
it.each(['uncertain','rejected'] as const)('não transforma terminal %s em execução confirmada',async outcome=>{
  const {secondary,sendEffect}=await interrupted(true,outcome)
  expect(secondary.reconcileGraphicReceipts()).toBe(0)
  expect(secondary.hasUnconfirmed()).toBe(true)
  expect(secondary.fireFor(context,event.id)?.state).toBe('FIRING')
  expect(sendEffect).toHaveBeenCalledTimes(1)
})
it('conferência explícita de UNCERTAIN não é prova de execução secundária',async()=>{
  const {secondary,graphics}=await interrupted(true,'uncertain')
  const receipt=graphics.list()[0]!
  graphics.review(receipt.id,receipt.reviewToken,'Destino conferido, não reenviar','operator',()=>{})
  expect(secondary.reconcileGraphicReceipts()).toBe(0)
  expect(secondary.hasUnconfirmed()).toBe(true)
})
it('recibo legado sem vínculo explícito não libera FIRING, mesmo confirmado',async()=>{
  const {secondary,graphics}=await interrupted(true,'confirmed',false)
  expect(graphics.list()[0]?.state).toBe('CONFIRMED')
  expect(secondary.reconcileGraphicReceipts()).toBe(0)
  expect(secondary.hasUnconfirmed()).toBe(true)
})
it('falha da auditoria reverte reconciliação; repetição posterior registra uma única decisão',async()=>{
  const {database,secondary}=await interrupted()
  database.sqlite.exec("CREATE TRIGGER deny_reconciliation_audit BEFORE INSERT ON operator_decisions WHEN NEW.kind='SECONDARY_GRAPHIC_RECONCILED' BEGIN SELECT RAISE(ABORT,'audit-storage-fault'); END")
  expect(()=>secondary.reconcileGraphicReceipts()).toThrow('audit-storage-fault')
  expect(secondary.fireFor(context,event.id)?.state).toBe('FIRING')
  database.sqlite.exec('DROP TRIGGER deny_reconciliation_audit')
  expect(secondary.reconcileGraphicReceipts()).toBe(1)
  expect(secondary.reconcileGraphicReceipts()).toBe(0)
  expect(database.sqlite.prepare("SELECT count(*) n FROM operator_decisions WHERE kind='SECONDARY_GRAPHIC_RECONCILED'").get()).toEqual({n:1})
})
it('falha só ao persistir conclusão não classifica o efeito confirmado como FAILED',async()=>{
  const {secondary,sendEffect}=await interrupted(true,'confirmed',true,true)
  expect(secondary.fireFor(context,event.id)?.state).toBe('FIRING')
  expect(secondary.reconcileGraphicReceipts()).toBe(1)
  expect(secondary.fireFor(context,event.id)?.state).toBe('EXECUTED')
  expect(sendEffect).toHaveBeenCalledTimes(1)
})
it.each([
  ['channel_id','other'],['execution_id','other'],['item_id','other'],
  ['revision_id',null],['event_id','other'],['mode','DISMISS'],
] as const)('não reutiliza confirmação quando %s da ocorrência diverge',async(column,value)=>{
  const {database,secondary}=await interrupted()
  database.sqlite.prepare('UPDATE secondary_event_runs SET '+column+'=?').run(value)
  expect(secondary.reconcileGraphicReceipts()).toBe(0)
  expect(database.sqlite.prepare('SELECT state FROM secondary_event_runs').get()).toEqual({state:'FIRING'})
  expect(database.sqlite.prepare("SELECT count(*) n FROM operator_decisions WHERE kind='SECONDARY_GRAPHIC_RECONCILED'").get()).toEqual({n:0})
})
it('vínculo inexistente ou de outro item é recusado antes de aceitar/enviar',async()=>{
  const database=openDatabase(':memory:');databases.push(database)
  const graphics=new GraphicCommandLedger(database.db,'ch'),secondary=new SecondaryEventLedger(database.db,'ch'),work=vi.fn()
  await expect(graphics.execute({key:'nonexistent-binding',actorId:null,actorName:null,native:true,selection:{},secondaryRunId:'missing'},()=>{},work)).rejects.toThrow('Vínculo gráfico')
  expect(work).not.toHaveBeenCalled();expect(graphics.list()).toEqual([])
  await secondary.execute(context,event,'FIRE',async runId=>{
    await expect(graphics.execute({key:'mismatched-binding',actorId:null,actorName:null,native:true,selection:{action:'SECONDARY_FIRE',executionId:context.executionId,revisionId:context.revisionId,event:{...event,rundownItemId:'other'}},secondaryRunId:runId},()=>{},work)).rejects.toThrow('Vínculo gráfico')
  })
  expect(work).not.toHaveBeenCalled();expect(graphics.list()).toEqual([])
})
