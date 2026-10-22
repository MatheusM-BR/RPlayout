import {beforeEach,afterEach,it,expect} from 'vitest'
import {openDatabase} from '../db/client.js'
import {GraphicRecoveryIncident} from './graphic-recovery-incident.js'
import {GraphicCommandLedger} from './graphic-command-ledger.js'
import {Graphics} from './graphics.js'
import type {Channel} from '@rplayout/protocol'
import type {Transport} from './transport.js'
let database:ReturnType<typeof openDatabase>,ledger:GraphicCommandLedger,graphics:Graphics
const context={executionId:'exec',revisionId:'rev',itemId:'live'}
const input=(key:string,native=true)=>({key,actorId:null,actorName:'TEST',native,selection:{action:'SHOW'},context:()=>context})
const count=()=> (database.sqlite.prepare("SELECT count(*) n FROM operator_decisions WHERE kind='GRAPHIC_RECOVERY_REESTABLISHED'").get() as {n:number}).n
async function show(key:string,native=true){return ledger.execute(input(key,native),()=>{},send=>graphics.triggerLayerConfirmed('LOWER_THIRD','SHOW',{payload:{title:key}},()=>{},send))}
beforeEach(()=>{
  database=openDatabase(':memory:');database.sqlite.exec("INSERT INTO channels(id,name,width,height,rate_num,rate_den,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES('a','A',320,180,25,1,-23,-1,5,'now')")
  ledger=new GraphicCommandLedger(database.db,'a')
  graphics=new Graphics({id:'a',rate:{num:25,den:1}} as Channel,{state:()=>({mode:'NATIVE'}),graphicConfirmed:async(_svg:string|null,_fade:number,authorize:()=>void)=>authorize()} as unknown as Transport)
})
afterEach(()=>database.sqlite.close())
it('same confirmed head, no PGM or changed execution/revision cannot clear an incident',async()=>{
  const old=await show('old-known'),incident=new GraphicRecoveryIncident(database.db,'a',context,old.receipt.id,'ACTIVE')
  expect(incident.reconcile(context)).toBe(false)
  await show('fresh-known')
  for(const current of [null,{...context,executionId:'other'},{...context,revisionId:'other'},{...context,itemId:'other'}])expect(incident.reconcile(current)).toBe(false)
  expect(count()).toBe(0)
})
it('review and simulated receipts never clear an unknown result; new native composition does',async()=>{
  const old=await show('old-before-unknown')
  await expect(ledger.execute(input('unknown-command'),()=>{},async send=>{send();throw new Error('ACK_LOST')})).rejects.toMatchObject({status:409})
  const incident=new GraphicRecoveryIncident(database.db,'a',context,old.receipt.id,'UNKNOWN')
  expect(incident.reconcile(context)).toBe(false)
  const unknown=ledger.list().find(row=>row.state==='UNCERTAIN')!
  ledger.review(unknown.id,unknown.reviewToken,'Acknowledge only','admin',()=>{})
  expect(incident.reconcile(context)).toBe(false)
  await show('simulated-result',false);expect(incident.reconcile(context)).toBe(false)
  const corrected=await show('corrected-native')
  expect(incident.reconcile(context)).toBe(true);expect(incident.reconcile(context)).toBe(true);expect(count()).toBe(1)
  const {operatorDecisions}=await import('../db/schema.js')
  const history=database.db.select().from(operatorDecisions).all(),resolution=history.find(row=>row.kind==='GRAPHIC_RECOVERY_REESTABLISHED')!
  expect(resolution.payload.confirmedReceipt).toBe(corrected.receipt.id)
  expect(resolution.payload.historicalResultKnown).toBe(false);expect(resolution.payload.physicalOutputValidated).toBe(false)
  expect(ledger.read(unknown.id)?.state).toBe('REVIEWED')
})
it('audit failure retains incident until a successful audited reconciliation',async()=>{
  const old=await show('before-audit-fail'),incident=new GraphicRecoveryIncident(database.db,'a',context,old.receipt.id,'ACTIVE')
  await show('new-before-audit')
  database.sqlite.exec("CREATE TRIGGER refuse_incident_resolution BEFORE INSERT ON operator_decisions WHEN NEW.kind='GRAPHIC_RECOVERY_REESTABLISHED' BEGIN SELECT RAISE(ABORT,'owned-audit-fault'); END")
  expect(()=>incident.reconcile(context)).toThrow('owned-audit-fault');expect(count()).toBe(0)
  database.sqlite.exec('DROP TRIGGER refuse_incident_resolution')
  expect(incident.reconcile(context)).toBe(true);expect(count()).toBe(1)
})
it('another channel cannot establish the composition for this incident',async()=>{
  const old=await show('before-other-channel'),incident=new GraphicRecoveryIncident(database.db,'a',context,old.receipt.id,'ACTIVE')
  const other=new GraphicCommandLedger(database.db,'b')
  await other.execute(input('other-native'),()=>{},send=>graphics.triggerLayerConfirmed('LOWER_THIRD','SHOW',{payload:{title:'OTHER'}},()=>{},send))
  expect(incident.reconcile(context)).toBe(false);expect(count()).toBe(0)
})
it('confirmação de outra execução não apaga alerta da ocorrência atual',async()=>{
  const old=await show('before-other-execution'),incident=new GraphicRecoveryIncident(database.db,'a',context,old.receipt.id,'ACTIVE')
  await ledger.execute({...input('other-execution'),context:()=>({...context,executionId:'other'})},()=>{},send=>graphics.triggerLayerConfirmed('LOWER_THIRD','SHOW',{payload:{title:'OTHER'}},()=>{},send))
  expect(incident.reconcile(context)).toBe(false);expect(count()).toBe(0)
  await show('same-execution-correction')
  expect(incident.reconcile(context)).toBe(true);expect(count()).toBe(1)
})
it('recibo legado sem contexto não qualifica correção para apagar alerta',async()=>{
  const old=await show('before-unbound'),incident=new GraphicRecoveryIncident(database.db,'a',context,old.receipt.id,'ACTIVE')
  await ledger.execute({...input('legacy-unbound'),context:undefined},()=>{},send=>graphics.triggerLayerConfirmed('LOWER_THIRD','SHOW',{payload:{title:'LEGACY'}},()=>{},send))
  expect(incident.reconcile(context)).toBe(false);expect(count()).toBe(0)
})
it('nova passagem do mesmo item não resolve incidente da passagem anterior',async()=>{
  const original={...context,startedAt:100}
  const old=await show('before-repeat'),incident=new GraphicRecoveryIncident(database.db,'a',original,old.receipt.id,'ACTIVE')
  await ledger.execute({...input('repeated-item'),context:()=>({...original,startedAt:200})},()=>{},send=>graphics.triggerLayerConfirmed('LOWER_THIRD','SHOW',{payload:{title:'REPEATED'}},()=>{},send))
  expect(incident.reconcile(original)).toBe(false);expect(count()).toBe(0)
})
it('recreated incident and repeated resolution preserve one audit correlation',async()=>{
  const old=await show('before-recreate'),incident=new GraphicRecoveryIncident(database.db,'a',context,old.receipt.id,'ACTIVE')
  const recreated=new GraphicRecoveryIncident(database.db,'a',context,old.receipt.id,'ACTIVE')
  expect(recreated.id).toBe(incident.id)
  await show('after-recreate')
  expect(incident.reconcile(context)).toBe(true);expect(recreated.reconcile(context)).toBe(true);expect(count()).toBe(1)
})
