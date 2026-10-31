import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {eq} from 'drizzle-orm'
import {openDatabase} from '../db/client.js'
import {channels,liveSources,operatorDecisions,healthEvents} from '../db/schema.js'
import {NativeLiveReplacementLedger,nativeSourceConnectionSignature,type NativeLiveReplacementContext} from './native-live-replacement-ledger.js'
import {NativeLiveReplacementWire,type NativeLiveReplacementRequest,type NativeLiveReplacementReceipt} from './native-live-replacement.js'

let database:ReturnType<typeof openDatabase>,ledger:NativeLiveReplacementLedger,context:NativeLiveReplacementContext
let authorize:ReturnType<typeof vi.fn>,owner:ReturnType<typeof vi.fn>,current:ReturnType<typeof vi.fn>
const sourceUrl='srt://user:PRIMARY_SECRET@primary.invalid:9000?passphrase=PRIMARY_PASSWORD'
const targetUrl='srt://user:BACKUP_SECRET@backup.invalid:9000?passphrase=BACKUP_PASSWORD'
beforeEach(()=>{
 database=openDatabase(':memory:')
 database.db.insert(channels).values({id:'ch',name:'QA',width:320,height:180,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:new Date().toISOString()}).run()
 for(const [id,role,target]of[['primary','PRIMARY',sourceUrl],['backup','BACKUP',targetUrl]] as const){
  database.db.insert(liveSources).values({id,channelId:'ch',name:id,kind:'SRT',targetUrl:target,role,pairedSourceId:id==='primary'?'backup':'primary',autoFailover:false,enabled:true,createdAt:new Date().toISOString()}).run()
 }
 context={channelId:'ch',rundownId:'r',revisionId:'revision',executionId:'execution',occurrenceId:'asrun-1',
  ownerRunId:'00000000-0000-4000-8000-000000000010',engineGeneration:'00000000-0000-4000-8000-000000000020',itemId:'live',decoderId:7,sourceId:'primary',
  sourceConnectionSignature:nativeSourceConnectionSignature('primary','SRT',sourceUrl),policySignature:'a'.repeat(64)}
 authorize=vi.fn();owner=vi.fn();current=vi.fn(()=>({...context}))
 ledger=new NativeLiveReplacementLedger(database.db,'actor','operator',{authorize,current,assertOwner:owner})
})
afterEach(()=>{database.sqlite.close();vi.restoreAllMocks()})
const rows=()=>({decisions:database.db.select().from(operatorDecisions).all(),health:database.db.select().from(healthEvents).all()})
function begin(key:unknown='key-1'){return ledger.begin(key,'backup',{...context})}
function receipt(request:NativeLiveReplacementRequest,phase:NativeLiveReplacementReceipt['phase']='READY'):NativeLiveReplacementReceipt{
 const {targetSource:_,targetSourceType:__,...binding}=request
 return {...binding,preparedDecoderId:8,phase,programFrames:phase==='COMMITTED'?143:null}
}
function ready(){const decision=begin(),request=ledger.request(decision.transactionId);ledger.beforeSend('PREPARE',request);ledger.recordReceipt(receipt(request));return {decision,request}}

it('records one protected intent and replay, without URLs, native proof or manager side effects',()=>{
 const first=begin(),again=begin();expect(first.replayed).toBe(false);expect(again).toMatchObject({replayed:true,transactionId:first.transactionId,receipt:null,closed:false})
 expect(rows().decisions).toHaveLength(1);expect(rows().health).toHaveLength(1)
 const decoded=JSON.stringify(rows().decisions[0]!.payload)
 expect(decoded).not.toContain('srt://');expect(decoded).not.toContain('SECRET');expect(decoded).not.toContain('PASSWORD')
 const raw=database.sqlite.prepare('SELECT payload FROM operator_decisions').get() as {payload:string}
 expect(raw.payload).not.toContain('occurrenceId');expect(raw.payload).not.toContain('asrun-1')
 expect(ledger.receipt(first.transactionId)).toMatchObject({nativeProgramConfirmed:false,physicalOutputValidated:false,currentExecutionObserved:false})
})
it.each([undefined,'bad key','x'.repeat(129)])('rejects missing/invalid idempotency key %j',key=>{
 expect(()=>ledger.begin(key,'backup',context)).toThrow('Idempotency-Key');expect(rows()).toEqual({decisions:[],health:[]})
})
it('same key cannot bind another actor or context; another key cannot bypass unresolved channel work',()=>{
 begin()
 const other=new NativeLiveReplacementLedger(database.db,'other','other',{authorize,current,assertOwner:owner})
 expect(()=>other.begin('key-1','backup',context)).toThrow('outro pedido')
 expect(()=>ledger.begin('key-1','backup',{...context,occurrenceId:'new-occurrence'})).toThrow('outro pedido')
 expect(()=>begin('key-2')).toThrow('não reconciliada');expect(rows().decisions).toHaveLength(1)
})
it.each(['channel','role','pair','disabled','connection'] as const)('rejects an invalid %s pair before durable intent',mode=>{
 if(mode==='channel'){
  database.db.insert(channels).values({id:'different',name:'Other QA',width:320,height:180,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:new Date().toISOString()}).run()
  database.db.update(liveSources).set({channelId:'different'}).where(eq(liveSources.id,'backup')).run()
 }
 if(mode==='role')database.db.update(liveSources).set({role:'PRIMARY'}).where(eq(liveSources.id,'backup')).run()
 if(mode==='pair')database.db.update(liveSources).set({pairedSourceId:null}).where(eq(liveSources.id,'backup')).run()
 if(mode==='disabled')database.db.update(liveSources).set({enabled:false}).where(eq(liveSources.id,'backup')).run()
 if(mode==='connection')database.db.update(liveSources).set({targetUrl:'srt://changed.invalid:9000'}).where(eq(liveSources.id,'primary')).run()
 expect(()=>begin()).toThrow(mode==='connection'?'realmente aberta':'par recíproco');expect(rows()).toEqual({decisions:[],health:[]})
})
it('reauthorizes before sending, rechecks owner and refuses a changed published occurrence',()=>{
 const decision=begin(),request=ledger.request(decision.transactionId)
 authorize.mockImplementation(()=>{throw new Error('REVOKED')})
 expect(()=>ledger.beforeSend('PREPARE',request)).toThrow('REVOKED')
 authorize.mockReset();owner.mockImplementation(()=>{throw new Error('OWNER_CHANGED')})
 expect(()=>ledger.beforeSend('PREPARE',request)).toThrow('OWNER_CHANGED')
 owner.mockReset();current.mockReturnValue({...context,revisionId:'new-revision'})
 expect(()=>ledger.beforeSend('PREPARE',request)).toThrow('mudou')
 expect(ledger.receipt(decision.transactionId).prepareSent).toBe(false)
})
it('rejects a target connection change after preparation before any COMMIT intent',()=>{
 const {decision,request}=ready()
 database.db.update(liveSources).set({targetUrl:'srt://changed.invalid:9000?passphrase=OTHER'}).where(eq(liveSources.id,'backup')).run()
 expect(()=>ledger.beforeSend('COMMIT',request)).toThrow('mudou')
 expect(ledger.receipt(decision.transactionId).commitSent).toBe(false)
})
it('write rejection rolls back intent and audit together',()=>{
 database.sqlite.exec("CREATE TRIGGER reject_native_intent BEFORE INSERT ON health_events BEGIN SELECT RAISE(ABORT,'QA_NATIVE_AUDIT_REFUSED'); END")
 expect(()=>begin()).toThrow('QA_NATIVE_AUDIT_REFUSED');expect(rows()).toEqual({decisions:[],health:[]})
 database.sqlite.exec('DROP TRIGGER reject_native_intent');expect(begin().replayed).toBe(false)
})
it('each send transition is atomic, and COMMIT intent cannot be repeated even after a READY lookup',()=>{
 const {decision,request}=ready()
 database.sqlite.exec("CREATE TRIGGER reject_native_stage BEFORE INSERT ON health_events BEGIN SELECT RAISE(ABORT,'QA_NATIVE_STAGE_REFUSED'); END")
 expect(()=>ledger.beforeSend('COMMIT',request)).toThrow('QA_NATIVE_STAGE_REFUSED')
 expect(ledger.receipt(decision.transactionId).commitSent).toBe(false)
 database.sqlite.exec('DROP TRIGGER reject_native_stage')
 ledger.beforeSend('COMMIT',request);ledger.recordReceipt(receipt(request))
 expect(()=>ledger.beforeSend('COMMIT',request)).toThrow('não pode ser reenviado')
 ledger.beforeSend('STATUS',request);expect(ledger.receipt(decision.transactionId)).toMatchObject({commitSent:true,closed:false,nativeProgramConfirmed:false})
})
it('missing COMMIT ACK remains locked across a new ledger instance and new request key',()=>{
 const {decision,request}=ready();ledger.beforeSend('COMMIT',request)
 ledger=new NativeLiveReplacementLedger(database.db,'actor','operator',{authorize,current,assertOwner:owner})
 expect(begin().replayed).toBe(true);expect(()=>begin('new-key')).toThrow('não reconciliada')
 expect(ledger.receipt(decision.transactionId)).toMatchObject({commitSent:true,closed:false,currentExecutionObserved:false})
})
it('only a bound native COMMITTED receipt closes as native evidence, never physical proof',()=>{
 const {decision,request}=ready()
 expect(()=>ledger.recordReceipt(receipt(request,'COMMITTED'))).toThrow('COMMIT durável')
 ledger.beforeSend('COMMIT',request);ledger.recordReceipt(receipt(request,'COMMITTED'))
 expect(ledger.receipt(decision.transactionId)).toMatchObject({closed:true,nativeProgramConfirmed:true,physicalOutputValidated:false,currentExecutionObserved:false})
 const count=rows().health.length;ledger.recordReceipt(receipt(request,'COMMITTED'));expect(rows().health).toHaveLength(count)
 expect(()=>ledger.recordReceipt({...receipt(request,'COMMITTED'),programFrames:144})).toThrow('reescrito')
 expect(()=>ledger.recordReceipt(receipt(request,'READY'))).toThrow('reescrito')
})
it('facts are recorded after session revocation, but not after owner loss; historical receipt stays protected',()=>{
 const {decision,request}=ready();ledger.beforeSend('COMMIT',request)
 authorize.mockImplementation(()=>{throw new Error('SESSION_EXPIRED')})
 expect(()=>ledger.recordReceipt(receipt(request,'COMMITTED'))).not.toThrow()
 expect(()=>ledger.receipt(decision.transactionId)).toThrow('SESSION_EXPIRED')
 owner.mockImplementation(()=>{throw new Error('OWNER_LOST')})
 expect(()=>ledger.recordReceipt(receipt(request,'COMMITTED'))).toThrow('OWNER_LOST')
})
it('receipt audit failure preserves unresolved state and can persist the same proof without another cut',()=>{
 const {decision,request}=ready();ledger.beforeSend('COMMIT',request)
 database.sqlite.exec("CREATE TRIGGER reject_native_receipt BEFORE INSERT ON health_events BEGIN SELECT RAISE(ABORT,'QA_NATIVE_RECEIPT_REFUSED'); END")
 expect(()=>ledger.recordReceipt(receipt(request,'COMMITTED'))).toThrow('QA_NATIVE_RECEIPT_REFUSED')
 expect(ledger.receipt(decision.transactionId)).toMatchObject({closed:false,commitSent:true,nativeProgramConfirmed:false})
 database.sqlite.exec('DROP TRIGGER reject_native_receipt');ledger.recordReceipt(receipt(request,'COMMITTED'))
 expect(ledger.receipt(decision.transactionId).nativeProgramConfirmed).toBe(true)
})
it('identical nonterminal status queries do not duplicate durable audit events',()=>{
 const {request}=ready(),count=rows().health.length
 ledger.recordReceipt(receipt(request));ledger.recordReceipt(receipt(request))
 expect(rows().health).toHaveLength(count)
})
it('inconsistent stored closure cannot become a receipt authorizing another transaction',()=>{
 const {decision}=ready(),row=rows().decisions[0]!
 database.db.update(operatorDecisions).set({payload:{...row.payload,closed:true}}).where(eq(operatorDecisions.id,row.id)).run()
 expect(()=>ledger.receipt(decision.transactionId)).toThrow('Journal de troca nativa inválido')
})
it('uncertain selectors cannot close the journal or allow a new transaction',()=>{
 const {decision,request}=ready();ledger.beforeSend('COMMIT',request);ledger.recordReceipt(receipt(request,'UNCERTAIN'))
 expect(ledger.receipt(decision.transactionId)).toMatchObject({closed:false,nativeProgramConfirmed:false})
 expect(()=>begin('new')).toThrow('não reconciliada')
 expect(()=>ledger.beforeSend('COMMIT',request)).toThrow('inconclusiva')
})
it('real SQLite rejection of send intent prevents the wire from writing COMMIT',async()=>{
 const decision=begin(),request=ledger.request(decision.transactionId);let sequence=0;const commands:Record<string,unknown>[]=[]
 // Private native events are simulated, but PREPARE/COMMIT intent and receipt
 // transitions use the real SQL implementation and rejection trigger.
 const wire=new NativeLiveReplacementWire({nextId:()=>++sequence,assertOwned:()=>owner(context.ownerRunId),validate:()=>{},
  beforeSend:(operation,value)=>ledger.beforeSend(operation,value),recordReceipt:value=>ledger.recordReceipt(value),
  write:value=>commands.push(value),fence:()=>({ownerId:'native-owner',term:17}),fenceRequired:()=>true,selectionObserved:()=>false})
 wire.ready({engineGeneration:context.engineGeneration,liveReplacementProtocol:1,decoderIdentity:true})
 const prepare=wire.prepare(request);wire.absorb({event:'liveReplacement',id:sequence,receipt:receipt(request)});wire.absorb({event:'ack',id:sequence,ok:true});await prepare
 database.sqlite.exec("CREATE TRIGGER reject_native_wire BEFORE INSERT ON health_events BEGIN SELECT RAISE(ABORT,'QA_NATIVE_WIRE_REFUSED'); END")
 await expect(wire.commit(decision.transactionId)).rejects.toThrow('QA_NATIVE_WIRE_REFUSED')
 expect(commands.map(command=>command.cmd)).toEqual(['prepareLiveReplacement'])
 expect(ledger.receipt(decision.transactionId).commitSent).toBe(false);wire.disconnected()
})
