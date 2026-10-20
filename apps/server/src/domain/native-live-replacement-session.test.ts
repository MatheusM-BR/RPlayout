import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {openDatabase} from '../db/client.js'
import {channels,liveSources,operatorDecisions} from '../db/schema.js'
import {CollaborativeEditError} from './collaborative-edit.js'
import {Checkpoints,type ChannelCheckpoint} from './checkpoints.js'
import type {NativeReplacementAction,NativeReplacementPersistence} from './engine.js'
import {NativeLiveReplacementLedger,nativeSourceConnectionSignature,unresolvedNativeReplacementJournals,type NativeLiveReplacementContext} from './native-live-replacement-ledger.js'
import {resolveLiveProgramBinding} from './live-program-binding.js'
import type {NativeLiveReplacementReceipt,NativeLiveReplacementRequest} from './native-live-replacement.js'
import {createNativeReplacementSession,resolveStoppedPredecessorJournals,type NativeReplacementRuntimePort} from './native-live-replacement-session.js'

/** Simulated transport following EngineTransport's contract: the per-command
 * action is used only for that command; receipts go to durable persistence. */
class FakeTransport {
 sessions=new Map<string,{request:NativeLiveReplacementRequest;persistence:NativeReplacementPersistence}>()
 sent:string[]=[]
 refusePrepareBeforeSend:Error|null=null
 failAfterPrepareSent:Error|null=null
 deferCommitReceipt=false
 deferred:(()=>void)|null=null
 private receipt(request:NativeLiveReplacementRequest,phase:NativeLiveReplacementReceipt['phase']):NativeLiveReplacementReceipt{
  const {targetSource:_,targetSourceType:__,...binding}=request
  return {...binding,phase,preparedDecoderId:8,programFrames:phase==='COMMITTED'?143:null}
 }
 private send(op:'PREPARE'|'COMMIT'|'CANCEL'|'STATUS',id:string,action?:NativeReplacementAction){
  const session=this.sessions.get(id)!
  const gate=action??session.persistence
  gate.validate(op,session.request);gate.beforeSend(op,session.request);gate.validate(op,session.request)
  this.sent.push(op)
 }
 async prepareNativeLiveReplacement(request:NativeLiveReplacementRequest,persistence:NativeReplacementPersistence,action?:NativeReplacementAction){
  if(this.refusePrepareBeforeSend)throw this.refusePrepareBeforeSend
  if(!this.sessions.has(request.transactionId))this.sessions.set(request.transactionId,{request:structuredClone(request),persistence})
  this.send('PREPARE',request.transactionId,action)
  if(this.failAfterPrepareSent)throw this.failAfterPrepareSent
  const ready=this.receipt(request,'READY');persistence.receipt(ready,true);return ready
 }
 async nativeLiveReplacementCommand(op:'COMMIT'|'CANCEL'|'STATUS',id:string,action?:NativeReplacementAction){
  const session=this.sessions.get(id);if(!session)throw new Error('Transação não pertence à sessão nativa; consultar journal durável.')
  this.send(op,id,action)
  const receipt=this.receipt(session.request,op==='CANCEL'?'CANCELLED':op==='COMMIT'?'COMMITTED':'READY')
  if(op==='COMMIT'&&this.deferCommitReceipt){this.deferred=()=>session.persistence.receipt(receipt,true);return receipt}
  if(op!=='STATUS')session.persistence.receipt(receipt,true)
  return receipt
 }
}

const generation='00000000-0000-4000-8000-000000000020'
const OWNER='00000000-0000-4000-8000-000000000010',OLD='00000000-0000-4000-8000-000000000009'
let database:ReturnType<typeof openDatabase>,checkpoints:Checkpoints,transport:FakeTransport,port:NativeReplacementRuntimePort
let context:NativeLiveReplacementContext,owner:string,stopped:string[],cursor:ChannelCheckpoint
let allowed:boolean
const actor={id:'user-1',name:'operador'}
const authorize=vi.fn(()=>{if(!allowed)throw new CollaborativeEditError(403,{error:'SESSION_EXPIRED'})})

beforeEach(()=>{
 database=openDatabase(':memory:');checkpoints=new Checkpoints(database.sqlite);transport=new FakeTransport()
 database.db.insert(channels).values({id:'ch',name:'QA',width:320,height:180,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:new Date().toISOString()}).run()
 for(const [id,role]of[['primary','PRIMARY'],['backup','BACKUP']] as const)database.db.insert(liveSources).values({id,channelId:'ch',name:id,kind:'NDI',targetUrl:'ndi:'+id,role,pairedSourceId:id==='primary'?'backup':'primary',autoFailover:false,enabled:true,createdAt:new Date().toISOString()}).run()
 owner=OWNER;stopped=[];allowed=true;authorize.mockClear()
 context={channelId:'ch',rundownId:'r',revisionId:'rev',executionId:'exec',occurrenceId:'asrun-1',itemId:'live',ownerRunId:OWNER,engineGeneration:generation,decoderId:7,sourceId:'primary',sourceConnectionSignature:nativeSourceConnectionSignature('primary','NDI','ndi:primary'),policySignature:'a'.repeat(64)}
 cursor={version:1,channelId:'ch',rundownId:'r',revisionId:'rev',executionId:'exec',itemId:'live',elapsed:150,playing:true,realEngine:true,rate:{num:25,den:1}}
 checkpoints.write(cursor)
 port={channelId:'ch',db:database.db,checkpoints,transport,context:()=>({...context,ownerRunId:owner}),capture:()=>cursor,ownerRunId:()=>owner,stoppedPredecessorRunIds:()=>stopped}
})
afterEach(()=>{database.sqlite.close();vi.restoreAllMocks()})
const session=(who=actor)=>createNativeReplacementSession(port,who,authorize)

describe('authorized native replacement session factory (real SQLite, simulated transport)',()=>{
 it('prepare then commit persists journal, authenticated binding and v2 cursor through the real helper',async()=>{
  const prepared=await session().prepare('cut-1','backup')
  expect(prepared).toMatchObject({replayed:false,prepareSent:true,receipt:{phase:'READY'},closed:false})
  const done=await session().commit(prepared.transactionId)
  expect(done).toMatchObject({nativeProgramConfirmed:true,closed:true,physicalOutputValidated:false,currentExecutionObserved:false})
  const saved=checkpoints.read('ch')!
  expect(saved.version).toBe(2)
  expect(resolveLiveProgramBinding(saved.liveProgramBinding,saved)).toEqual({source:'ndi:backup',sourceType:'NDI',configuredSourceId:'backup'})
  expect(transport.sent).toEqual(['PREPARE','COMMIT'])
 })
 it('re-checks authorization at the moment of each command, not only at creation',async()=>{
  const prepared=await session().prepare('cut-2','backup')
  const calls=authorize.mock.calls.length
  allowed=false
  await expect(session().commit(prepared.transactionId)).rejects.toMatchObject({status:403})
  expect(authorize.mock.calls.length).toBeGreaterThan(calls)
  expect(transport.sent).toEqual(['PREPARE'])
  allowed=true
  expect(session().receipt(prepared.transactionId)).toMatchObject({commitSent:false,closed:false})
 })
 it('an expired session inside the queue slot sends nothing and records no COMMIT intent',async()=>{
  const prepared=await session().prepare('cut-3','backup')
  let checks=0
  const flaky=vi.fn(()=>{checks++;if(checks>1)throw new CollaborativeEditError(403,{error:'SESSION_EXPIRED_IN_QUEUE'})})
  await expect(createNativeReplacementSession(port,actor,flaky).commit(prepared.transactionId)).rejects.toMatchObject({status:403})
  expect(transport.sent).toEqual(['PREPARE'])
  expect(session().receipt(prepared.transactionId)).toMatchObject({commitSent:false})
 })
 it('engine facts are still recorded after the initiating session expired (ownership only)',async()=>{
  transport.deferCommitReceipt=true
  const prepared=await session().prepare('cut-4','backup')
  await session().commit(prepared.transactionId)
  allowed=false
  transport.deferred!()
  allowed=true
  expect(session().receipt(prepared.transactionId)).toMatchObject({nativeProgramConfirmed:true,closed:true})
  expect(checkpoints.read('ch')!.version).toBe(2)
 })
 it('lost ownership refuses commands and engine facts alike',async()=>{
  const prepared=await session().prepare('cut-5','backup')
  owner='00000000-0000-4000-8000-000000000099'
  await expect(session().commit(prepared.transactionId)).rejects.toMatchObject({status:409})
  expect(transport.sent).toEqual(['PREPARE'])
 })
 it('durable persistence alone cannot send a command',async()=>{
  const prepared=await session().prepare('cut-6','backup')
  await expect(transport.nativeLiveReplacementCommand('COMMIT',prepared.transactionId)).rejects.toMatchObject({status:403})
  expect(transport.sent).toEqual(['PREPARE'])
 })
 it('another operator cannot commit a cut prepared by someone else',async()=>{
  const prepared=await session().prepare('cut-7','backup')
  await expect(session({id:'user-2',name:'outro'}).commit(prepared.transactionId)).rejects.toMatchObject({status:403})
  expect(transport.sent).toEqual(['PREPARE'])
 })
 it('the same Idempotency-Key replays from the journal without a second PREPARE',async()=>{
  await session().prepare('cut-8','backup')
  await expect(session().prepare('cut-8','backup')).resolves.toMatchObject({replayed:true,prepareSent:true})
  expect(transport.sent).toEqual(['PREPARE'])
 })
 it('a retry of the same key after its own confirmed cut replays from the journal (no 409, no second cut)',async()=>{
  const prepared=await session().prepare('cut-retry','backup')
  await session().commit(prepared.transactionId)
  // The PGM now runs the backup: decoder/source/connection of the context changed.
  context={...context,sourceId:'backup',decoderId:8,sourceConnectionSignature:nativeSourceConnectionSignature('backup','NDI','ndi:backup')}
  await expect(session().prepare('cut-retry','backup')).resolves.toMatchObject({replayed:true,nativeProgramConfirmed:true})
  expect(transport.sent).toEqual(['PREPARE','COMMIT'])
  // Same key for a cut back to the primary is another request: refused.
  await expect(session().prepare('cut-retry','primary')).rejects.toMatchObject({status:409})
  // Same key in another occurrence is refused even after the cut.
  context={...context,occurrenceId:'asrun-2'}
  await expect(session().prepare('cut-retry','backup')).rejects.toMatchObject({status:409})
 })
 it('a refusal before any byte closes the intent durably and frees the channel',async()=>{
  transport.refusePrepareBeforeSend=new Error('Engine sem contrato de troca nativa desta geração; nenhum TAKE alternativo será enviado.')
  await expect(session().prepare('cut-9','backup')).rejects.toThrow('sem contrato')
  expect(unresolvedNativeReplacementJournals(database.db,'ch')).toEqual([])
  const row=database.db.select().from(operatorDecisions).all().find(value=>value.kind==='NATIVE_LIVE_REPLACEMENT_V1')!
  expect(row.payload).toMatchObject({closed:true,prepareSent:false,abandonedBeforeSend:{reason:expect.stringContaining('sem contrato')}})
  transport.refusePrepareBeforeSend=null
  await expect(session().prepare('cut-10','backup')).resolves.toMatchObject({prepareSent:true})
 })
 it('a failure after PREPARE was durable keeps the journal open and blocks new cuts',async()=>{
  transport.failAfterPrepareSent=new Error('ACK perdido')
  await expect(session().prepare('cut-11','backup')).rejects.toThrow('ACK perdido')
  expect(unresolvedNativeReplacementJournals(database.db,'ch')).toMatchObject([{prepareSent:true}])
  transport.failAfterPrepareSent=null
  await expect(session().prepare('cut-12','backup')).rejects.toMatchObject({status:409})
 })
 it('rejects a session targeting another channel',async()=>{
  const other=createNativeReplacementSession({...port,channelId:'other'},actor,authorize)
  await expect(other.prepare('cut-13','backup')).rejects.toMatchObject({status:403})
  expect(transport.sent).toEqual([])
 })
})

describe('STOP resolution of journals without a session in this process',()=>{
 function orphan(ownerRunId:string,key:string,sendPrepare:boolean){
  const ledger=new NativeLiveReplacementLedger(database.db,'user-1','operador',{authorize:()=>{},current:()=>({...context,ownerRunId}),assertOwner:()=>{}})
  const decision=ledger.begin(key,'backup',{...context,ownerRunId})
  if(sendPrepare)ledger.beforeSend('PREPARE',ledger.request(decision.transactionId))
  return decision.transactionId
 }
 const proof={engineGeneration:'00000000-0000-4000-8000-000000000021',nativeRequestId:3}
 it('resolves a predecessor journal only when that run is proven stopped',()=>{
  const id=orphan(OLD,'old-1',true)
  expect(resolveStoppedPredecessorJournals(port,proof,()=>false)).toEqual({resolved:[],preserved:[id]})
  expect(unresolvedNativeReplacementJournals(database.db,'ch')).toHaveLength(1)
  stopped=[OLD]
  expect(resolveStoppedPredecessorJournals(port,proof,()=>false)).toEqual({resolved:[id],preserved:[]})
  const row=database.db.select().from(operatorDecisions).all().find(value=>value.kind==='NATIVE_LIVE_REPLACEMENT_V1')!
  expect(row.payload).toMatchObject({closed:true,stopResolution:{previousOwnedGenerationExited:true,engineGeneration:proof.engineGeneration}})
 })
 it('without a native generation identity, a predecessor journal is preserved',()=>{
  stopped=[OLD];const id=orphan(OLD,'old-2',true)
  expect(resolveStoppedPredecessorJournals(port,{engineGeneration:null,nativeRequestId:3},()=>false)).toEqual({resolved:[],preserved:[id]})
 })
 it('closes an unsent intent of the current owner, preserves a sent one without session',()=>{
  const unsent=orphan(OWNER,'cur-1',false)
  expect(resolveStoppedPredecessorJournals(port,proof,()=>false)).toEqual({resolved:[unsent],preserved:[]})
  const sent=orphan(OWNER,'cur-2',true)
  expect(resolveStoppedPredecessorJournals(port,proof,()=>false)).toEqual({resolved:[],preserved:[sent]})
 })
 it('leaves journals owned by the live transport session to the transport',()=>{
  const id=orphan(OWNER,'cur-3',true)
  expect(resolveStoppedPredecessorJournals(port,proof,value=>value===id)).toEqual({resolved:[],preserved:[]})
  expect(unresolvedNativeReplacementJournals(database.db,'ch')).toHaveLength(1)
 })
 it('rolls back every resolution of the batch when the audit write fails',()=>{
  stopped=[OLD];orphan(OLD,'old-3',true)
  database.sqlite.exec("CREATE TRIGGER refuse_stop_audit BEFORE INSERT ON health_events BEGIN SELECT RAISE(ABORT,'QA_STOP_AUDIT_REFUSED'); END")
  expect(()=>resolveStoppedPredecessorJournals(port,proof,()=>false)).toThrow('QA_STOP_AUDIT_REFUSED')
  expect(unresolvedNativeReplacementJournals(database.db,'ch')).toHaveLength(1)
 })
})
