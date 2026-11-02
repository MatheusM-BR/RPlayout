import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {eq} from 'drizzle-orm'
import {openDatabase} from '../db/client.js'
import {channels,healthEvents,liveSources,operatorDecisions} from '../db/schema.js'
import {Checkpoints,type ChannelCheckpoint} from './checkpoints.js'
import {commitNativeReplacementReceipt,commitNativeReplacementStop} from './native-live-replacement-commit.js'
import {NativeLiveReplacementLedger,nativeSourceConnectionSignature,assertPersistedLiveReplacementReceipt,type NativeLiveReplacementContext} from './native-live-replacement-ledger.js'
import {resolveLiveProgramBinding} from './live-program-binding.js'
import type {NativeLiveReplacementRequest,NativeLiveReplacementReceipt} from './native-live-replacement.js'

let database:ReturnType<typeof openDatabase>,checkpoints:Checkpoints,ledger:NativeLiveReplacementLedger
let context:NativeLiveReplacementContext,request:NativeLiveReplacementRequest,cursor:ChannelCheckpoint
let committed:NativeLiveReplacementReceipt
const generation='00000000-0000-4000-8000-000000000020'
const proof={engineGeneration:generation,nativeRequestId:12,previousOwnedGenerationExited:false}
beforeEach(()=>{
 database=openDatabase(':memory:');checkpoints=new Checkpoints(database.sqlite)
 database.db.insert(channels).values({id:'ch',name:'QA',width:320,height:180,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:new Date().toISOString()}).run()
 for(const [id,role]of[['primary','PRIMARY'],['backup','BACKUP']] as const)database.db.insert(liveSources).values({id,channelId:'ch',name:id,kind:'NDI',targetUrl:'ndi:'+id,role,pairedSourceId:id==='primary'?'backup':'primary',autoFailover:false,enabled:true,createdAt:new Date().toISOString()}).run()
 context={channelId:'ch',rundownId:'r',revisionId:'rev',executionId:'exec',occurrenceId:'asrun-1',itemId:'live',ownerRunId:'00000000-0000-4000-8000-000000000010',engineGeneration:generation,decoderId:7,sourceId:'primary',sourceConnectionSignature:nativeSourceConnectionSignature('primary','NDI','ndi:primary'),policySignature:'a'.repeat(64)}
 ledger=new NativeLiveReplacementLedger(database.db,'actor','operator',{authorize:()=>{},current:()=>context,assertOwner:()=>{}})
 const decision=ledger.begin('atomic-1','backup',context);request=ledger.request(decision.transactionId)
 const {targetSource:_,targetSourceType:__,...binding}=request
 ledger.beforeSend('PREPARE',request);ledger.recordReceipt({...binding,phase:'READY',preparedDecoderId:8,programFrames:null});ledger.beforeSend('COMMIT',request)
 committed={...binding,phase:'COMMITTED',preparedDecoderId:8,programFrames:143}
 cursor={version:1,channelId:'ch',rundownId:'r',revisionId:'rev',executionId:'exec',itemId:'live',elapsed:150,playing:true,realEngine:true,rate:{num:25,den:1}}
 checkpoints.write(cursor)
})
afterEach(()=>{database.sqlite.close();vi.restoreAllMocks()})
function commit(capture=()=>cursor){return commitNativeReplacementReceipt(database.db,checkpoints,ledger,context,request,committed,true,capture)}
const auditCount=()=>database.db.select().from(healthEvents).all().length
const stop=()=>commitNativeReplacementStop(database.db,checkpoints,ledger,request.transactionId,'ch',proof)

it('atomically persists the real receipt, authenticated selected connection and exact current cursor',()=>{
 const binding=commit()!,saved=checkpoints.read('ch')!
 expect(saved).toMatchObject({...cursor,version:2,liveProgramBinding:binding})
 expect(resolveLiveProgramBinding(binding,saved)).toEqual({source:'ndi:backup',sourceType:'NDI',configuredSourceId:'backup'})
 expect(()=>assertPersistedLiveReplacementReceipt(database.db,binding)).not.toThrow()
 expect(ledger.receipt(request.transactionId)).toMatchObject({closed:true,nativeProgramConfirmed:true,currentExecutionObserved:false,physicalOutputValidated:false})
 expect(database.sqlite.prepare('SELECT payload FROM channel_checkpoints').get()).not.toEqual(expect.objectContaining({payload:expect.stringContaining('ndi:backup')}))
})
it('checkpoint rejection rolls back receipt, audit and cursor on the same actual SQLite transaction',()=>{
 const before=auditCount()
 database.sqlite.exec("CREATE TRIGGER refuse_cut_cursor BEFORE UPDATE ON channel_checkpoints BEGIN SELECT RAISE(ABORT,'QA_CUT_CURSOR_REFUSED'); END")
 expect(()=>commit()).toThrow('QA_CUT_CURSOR_REFUSED')
 expect(ledger.receipt(request.transactionId)).toMatchObject({closed:false,nativeProgramConfirmed:false,commitSent:true})
 expect(checkpoints.read('ch')).toEqual(cursor);expect(auditCount()).toBe(before)
 database.sqlite.exec('DROP TRIGGER refuse_cut_cursor');expect(commit()).toBeDefined()
})
it('receipt audit rejection never writes a replacement checkpoint',()=>{
 database.sqlite.exec("CREATE TRIGGER refuse_cut_audit BEFORE INSERT ON health_events BEGIN SELECT RAISE(ABORT,'QA_CUT_AUDIT_REFUSED'); END")
 expect(()=>commit()).toThrow('QA_CUT_AUDIT_REFUSED');expect(checkpoints.read('ch')).toEqual(cursor)
 expect(ledger.receipt(request.transactionId).nativeProgramConfirmed).toBe(false)
})
it('reconciliation after a lost SQL response reuses the same authenticated envelope without rewriting audit/cursor',()=>{
 const first=commit()!,before=auditCount()
 database.sqlite.exec("CREATE TRIGGER no_rewrite BEFORE UPDATE ON channel_checkpoints BEGIN SELECT RAISE(ABORT,'QA_UNEXPECTED_REWRITE'); END")
 expect(commit()).toEqual(first);expect(auditCount()).toBe(before)
})
it.each(['itemId','executionId','revisionId','rundownId','channelId'] as const)('a saved receipt cannot authorize a replay over another current %s',field=>{
 commit();const previous=checkpoints.read('ch')!,before=auditCount()
 expect(()=>commit(()=>({...cursor,[field]:'different'}))).toThrow()
 expect(checkpoints.read('ch')).toEqual(previous);expect(auditCount()).toBe(before)
})
it('a forged context cannot attach a genuine receipt to another occurrence',()=>{
 const wrong={...context,occurrenceId:'different-asrun'}
 expect(()=>commitNativeReplacementReceipt(database.db,checkpoints,ledger,wrong,request,committed,true,()=>cursor)).toThrow('recibo durável correspondente')
 expect(checkpoints.read('ch')).toEqual(cursor);expect(ledger.receipt(request.transactionId).nativeProgramConfirmed).toBe(false)
})
it('a reused binding must still match the exact private connection, not only IDs and native receipt',()=>{
 commit();const previous=checkpoints.read('ch')!
 expect(()=>commitNativeReplacementReceipt(database.db,checkpoints,ledger,context,{...request,targetSource:'ndi:other'},committed,true,()=>cursor)).toThrow('conexão preparada')
 expect(checkpoints.read('ch')).toEqual(previous)
})
it('a late historical receipt is recorded without replacing a different current program',()=>{
 const capture=vi.fn(()=>{throw new Error('MUST_NOT_CAPTURE')})
 expect(commitNativeReplacementReceipt(database.db,checkpoints,ledger,context,request,committed,false,capture)).toBeUndefined()
 expect(capture).not.toHaveBeenCalled();expect(checkpoints.read('ch')).toEqual(cursor)
 expect(ledger.receipt(request.transactionId).nativeProgramConfirmed).toBe(true)
})
it('confirmed STOP resolves uncertainty and clears the old automatic resume cursor together',()=>{
 const {targetSource:_,targetSourceType:__,...binding}=request
 ledger.recordReceipt({...binding,phase:'UNCERTAIN',preparedDecoderId:8,programFrames:null})
 stop()
 expect(ledger.receipt(request.transactionId)).toMatchObject({closed:true,nativeProgramConfirmed:false,stopResolution:proof})
 expect(checkpoints.read('ch')).toMatchObject({version:1,playing:false,itemId:null,elapsed:0})
 expect(()=>ledger.begin('after-stop','backup',context)).not.toThrow()
})
it('STOP cursor rejection rolls back resolution, preserving the lock until the same stop fact can be persisted',()=>{
 const before=auditCount()
 database.sqlite.exec("CREATE TRIGGER refuse_stop BEFORE UPDATE ON channel_checkpoints BEGIN SELECT RAISE(ABORT,'QA_STOP_CURSOR_REFUSED'); END")
 expect(stop).toThrow('QA_STOP_CURSOR_REFUSED');expect(auditCount()).toBe(before)
 expect(ledger.receipt(request.transactionId)).toMatchObject({closed:false,stopResolution:null})
 expect(checkpoints.read('ch')).toEqual(cursor)
 database.sqlite.exec('DROP TRIGGER refuse_stop');stop();const count=auditCount();stop();expect(auditCount()).toBe(count)
})
it('STOP must exclude the previous native generation before resolving its missing outcome',()=>{
 const next={...proof,engineGeneration:'00000000-0000-4000-8000-000000000021'}
 expect(()=>commitNativeReplacementStop(database.db,checkpoints,ledger,request.transactionId,'ch',next)).toThrow('geração anterior')
 expect(ledger.receipt(request.transactionId).stopResolution).toBeNull()
 commitNativeReplacementStop(database.db,checkpoints,ledger,request.transactionId,'ch',{...next,previousOwnedGenerationExited:true})
 expect(ledger.receipt(request.transactionId).closed).toBe(true)
})
it('a STOP for another channel cannot resolve the transaction or overwrite its cursor',()=>{
 expect(()=>commitNativeReplacementStop(database.db,checkpoints,ledger,request.transactionId,'other',proof)).toThrow('outro canal')
 expect(ledger.receipt(request.transactionId).closed).toBe(false);expect(checkpoints.read('ch')).toEqual(cursor)
})
it('STOP preserves historical native proof but explicitly forbids recovering its old selected-source binding',()=>{
 const binding=commit()!;stop()
 expect(()=>assertPersistedLiveReplacementReceipt(database.db,binding)).toThrow('recibo durável correspondente')
 expect(ledger.receipt(request.transactionId)).toMatchObject({nativeProgramConfirmed:true,closed:true,stopResolution:proof})
 expect(checkpoints.read('ch')!.liveProgramBinding).toBeUndefined()
 // A delayed identical native receipt cannot undo the durable STOP fact.
 ledger.recordReceipt(committed)
 expect(ledger.receipt(request.transactionId).stopResolution).not.toBeNull()
})
it('corrupted stored receipt cannot be used by an otherwise valid checkpoint',()=>{
 const binding=commit()!,row=database.db.select().from(operatorDecisions).get()!
 database.db.update(operatorDecisions).set({payload:{...row.payload,receipt:{...committed,programFrames:144}}}).where(eq(operatorDecisions.id,row.id)).run()
 expect(()=>assertPersistedLiveReplacementReceipt(database.db,binding)).toThrow()
})
it('refuses checkpoint and journal connections from different databases before recording any native fact',()=>{
 const other=openDatabase(':memory:')
 try{
  expect(()=>commitNativeReplacementReceipt(database.db,new Checkpoints(other.sqlite),ledger,context,request,committed,true,()=>cursor)).toThrow('mesma conexão SQLite')
  expect(()=>commitNativeReplacementStop(other.db,checkpoints,ledger,request.transactionId,'ch',proof)).toThrow('mesma conexão SQLite')
  expect(()=>commitNativeReplacementReceipt(other.db,new Checkpoints(other.sqlite),ledger,context,request,committed,false,()=>cursor)).toThrow('mesma conexão SQLite')
  expect(ledger.receipt(request.transactionId)).toMatchObject({closed:false,nativeProgramConfirmed:false,stopResolution:null})
  expect(checkpoints.read('ch')).toEqual(cursor)
 }finally{other.sqlite.close()}
})
