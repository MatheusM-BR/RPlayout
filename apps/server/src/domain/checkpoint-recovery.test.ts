import {afterEach,beforeEach,it,expect,vi} from 'vitest'
import {openDatabase} from '../db/client.js'
import {operatorDecisions,liveSources} from '../db/schema.js'
import {NativeLiveReplacementLedger,nativeSourceConnectionSignature} from './native-live-replacement-ledger.js'
import {createLiveProgramBinding} from './live-program-binding.js'
import {readExecutionOwner} from '../db/execution-ownership.js'
import {ChannelRuntime} from '../app.js'
import {EngineTransport,EngineCommandRejected} from './engine.js'
import {Checkpoints} from './checkpoints.js'
import {ExecutionOwnership} from './execution-ownership.js'
import {AsRun} from './asrun.js'
import type {ExecutionLease} from './execution-ownership.js'
import type {RundownView} from './plan.js'
import type {Channel} from '@rplayout/protocol'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'fixture-native'}))
vi.mock('./engine.js',()=>({EngineCommandRejected:class extends Error{},EngineTransport:class {
  callbacks:any
  constructor(_channel:unknown,_view:unknown,_assets:unknown,callbacks:unknown){this.callbacks=callbacks}
  recover=vi.fn().mockRejectedValue(new Error('decoder fixture refused'))
  recoverHeld=vi.fn().mockRejectedValue(new Error('held decoder fixture refused'))
  state=()=>({onAir:null,playing:false,preview:null})
  health=()=>({ready:true})
  close=()=>{}
  closeGracefully=vi.fn(async()=>({ownedNativeProcessesStopped:true,graceful:true,forceRequested:false}))
}}))
let database:ReturnType<typeof openDatabase>,runtime:ChannelRuntime,write:ReturnType<typeof vi.fn>,saved:any
const owner='00000000-0000-4000-8000-000000000001',hash='a'.repeat(64)
beforeEach(()=>{
  database=openDatabase(':memory:');database.sqlite.exec("INSERT INTO channels (id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES ('ch','CH',25,1,320,180,-23,-1,5,'now')")
  saved={version:1,channelId:'ch',rundownId:'rd',revisionId:'rev',itemId:'vt',elapsed:25,playing:true,realEngine:true,ownerRunId:owner,programTrim:{in:0,out:75,contentHash:hash}}
  write=vi.fn(value=>{saved=value});const checks={read:()=>saved,write} as unknown as Checkpoints
  const lease={assertOwned:()=>({id:owner,recoveredRunId:null}),canRecoverCursorFrom:(id:string)=>id===owner,recoverablePredecessorRunIds:()=>[],release:()=>{},acknowledgeStoppedPredecessor:()=>{}} as unknown as ExecutionLease
  const channel={id:'ch',rate:{num:25,den:1},width:320,height:180} as Channel
  runtime=new ChannelRuntime(channel,database.db,['null'],null,new Set(),new Map(),null,checks,null,null,null,null,null,null,lease)
  runtime.operationalRevision={id:'rev',revision:1,publishedAt:'now'}
  runtime.operationalView={rundown:{id:'rd'},items:[{item:{id:'vt'},asset:{contentHash:hash,durationFrames:250,durationNs:null},trim:{in:0,out:125}}],schedule:{items:[{id:'vt',duration:125}]}} as unknown as RundownView
  vi.spyOn(runtime,'load').mockResolvedValue(runtime.operationalView)
})
afterEach(()=>{vi.useRealTimers();runtime.close();database.sqlite.close();vi.restoreAllMocks()})
function liveCheckpoint(){
  saved.itemId='live';saved.executionId='saved-live';delete saved.programTrim
  runtime.operationalView={rundown:{id:'rd'},items:[{item:{id:'live',sourceRef:'guest:fixture'}}],schedule:{items:[{id:'live',duration:1000}]}} as unknown as RundownView
}
function alternativeCheckpoint(){
  liveCheckpoint();saved.version=2;saved.elapsed=200
  Object.assign(runtime.operationalView!.items[0]!.item,{sourceRef:'ndi:PRINCIPAL',configuredSourceId:'primary'})
  for(const [id,role,url]of[['primary','PRIMARY','ndi:PRINCIPAL'],['backup','BACKUP','ndi:RESERVA']] as const)database.db.insert(liveSources).values({id,channelId:'ch',name:id,kind:'NDI',role,targetUrl:url,pairedSourceId:id==='primary'?'backup':'primary',enabled:true,createdAt:new Date().toISOString()}).run()
  const context={channelId:'ch',rundownId:'rd',revisionId:'rev',executionId:'saved-live',occurrenceId:'saved-live',itemId:'live',ownerRunId:owner,engineGeneration:'00000000-0000-4000-8000-000000000020',decoderId:7,sourceId:'primary',sourceConnectionSignature:nativeSourceConnectionSignature('primary','NDI','ndi:PRINCIPAL'),policySignature:'a'.repeat(64)}
  const ledger=new NativeLiveReplacementLedger(database.db,'actor','operator',{authorize:()=>{},assertOwner:()=>{},current:()=>context})
  const {transactionId}=ledger.begin('runtime-alternative','backup',context),request=ledger.request(transactionId)
  const {targetSource:_,targetSourceType:__,...base}=request
  ledger.beforeSend('PREPARE',request);ledger.recordReceipt({...base,preparedDecoderId:8,phase:'READY',programFrames:null})
  ledger.beforeSend('COMMIT',request);const receipt={...base,preparedDecoderId:8,phase:'COMMITTED' as const,programFrames:143};ledger.recordReceipt(receipt)
  saved.liveProgramBinding=createLiveProgramBinding(context,request,receipt)
}
it('passes the authenticated confirmed leg to normal automatic recovery, keeping the saved occurrence identity',async()=>{
  alternativeCheckpoint();expect(await runtime.recoverCheckpoint()).toBe(true)
  runtime.checkpoint(true)
  expect((runtime.transport as EngineTransport).recover).toHaveBeenCalledWith('rd','live',200,undefined,saved.liveProgramBinding)
  const record=database.db.select().from(operatorDecisions).all().find(row=>row.kind==='CHECKPOINT_AUTO_RECOVERY_REQUESTED')
  expect(record?.payload).toMatchObject({policy:'LAST_SAVED_CHECKPOINT',positionFrames:200,operatorConfirmationRequired:false})
})
it('does not issue recovery intent or select primary when the selected-source envelope is invalid',async()=>{
  alternativeCheckpoint();saved.liveProgramBinding.sealedSource=saved.liveProgramBinding.sealedSource.slice(0,-8)+'AAAAAAAA'
  expect(await runtime.recoverCheckpoint()).toBe(false)
  expect(runtime.recoveryError).toContain('não será selecionada por fallback')
  expect(database.db.select().from(operatorDecisions).all().some(row=>row.kind==='CHECKPOINT_AUTO_RECOVERY_REQUESTED')).toBe(false)
  expect((runtime.transport as EngineTransport).recover).not.toHaveBeenCalled()
})
it('requires matching durable native receipt before an alternate checkpoint becomes executable',async()=>{
  alternativeCheckpoint();database.db.delete(operatorDecisions).run()
  expect(await runtime.recoverCheckpoint()).toBe(false);expect(runtime.recoveryError).toContain('sem recibo durável')
  expect((runtime.transport as EngineTransport).recover).not.toHaveBeenCalled();expect(write).not.toHaveBeenCalled()
})
it('automatic recovery requests the exact durable cursor, audits possible replay and needs no operator confirmation',async()=>{
  expect(await runtime.recoverCheckpoint()).toBe(true)
  const [decision]=database.db.select().from(operatorDecisions).all()
  expect(decision).toMatchObject({kind:'CHECKPOINT_AUTO_RECOVERY_REQUESTED',actorUsername:'@runtime',rundownId:'rd',itemId:'vt',payload:{
    policy:'LAST_SAVED_CHECKPOINT',sourceOwnerRunId:owner,ownerRunId:owner,positionFrames:25,rate:{num:25,den:1},
    possibleReplay:true,unpersistedEndKnown:false,operatorConfirmationRequired:false,nativeRecoveryConfirmed:false,held:false,
  }})
  expect(write).not.toHaveBeenCalled()
  runtime.checkpoint(true)
  expect((runtime.transport as EngineTransport).recover).toHaveBeenCalledWith('rd','vt',25,saved.programTrim)
})
it('automatic recovery audit failure preserves cursor and does not send an unregistered native command',async()=>{
  database.sqlite.exec("CREATE TRIGGER recovery_audit_failure BEFORE INSERT ON operator_decisions WHEN NEW.kind='CHECKPOINT_AUTO_RECOVERY_REQUESTED' BEGIN SELECT RAISE(ABORT,'RECOVERY_AUDIT_FIXTURE'); END")
  expect(await runtime.recoverCheckpoint()).toBe(false);expect(runtime.recoveryError).toContain('RECOVERY_AUDIT_FIXTURE')
  runtime.checkpoint(true);expect(write).not.toHaveBeenCalled()
  expect((runtime.transport as EngineTransport).recover).not.toHaveBeenCalled()
  expect(saved.elapsed).toBe(25)
})
it('invalid checkpoint does not produce a misleading automatic-recovery request',async()=>{
  delete saved.programTrim
  expect(await runtime.recoverCheckpoint()).toBe(false)
  expect(database.db.select().from(operatorDecisions).all()).toEqual([])
})
it('normal shutdown retains ownership until the final open as-run has been flushed',async()=>{
  const channel=runtime.channel;runtime.close()
  const ownership=new ExecutionOwnership(database.db),lease=ownership.claim('ch')
  runtime=new ChannelRuntime(channel,database.db,['null'],null,new Set(),new Map(),null,new Checkpoints(database.sqlite,lease),null,null,null,null,null,null,lease)
  await runtime.asRun.follow('vt',null,'rev',25)
  expect(await runtime.closeGracefully()).toEqual({ownedNativeProcessesStopped:true,graceful:true,forceRequested:false})
  expect(lease.assertOwned().phase).toBe('ACTIVE')
  await runtime.asRun.finish('SHUTDOWN')
  expect(database.sqlite.prepare('SELECT ended_by FROM as_run').get()).toEqual({ended_by:'SHUTDOWN'})
  ownership.close()
  expect(readExecutionOwner(database.sqlite,'ch')).toMatchObject({phase:'RELEASED',finalRelease:true})
})
it('held checkpoint uses only paused recovery and remains protected on refusal',async()=>{
  saved.playing=false;saved.programHold={status:'HELD',decoderId:7,frames:25}
  expect(await runtime.recoverCheckpoint()).toBe(true)
  runtime.checkpoint(true)
  await vi.waitFor(()=>expect(runtime.recoveryError).toContain('held decoder fixture refused'))
  expect(write).not.toHaveBeenCalled();expect((runtime.transport as EngineTransport).recover).not.toHaveBeenCalled()
  expect((runtime.transport as EngineTransport).recoverHeld).toHaveBeenCalledWith('rd','vt',25,saved.programTrim,expect.any(Function))
  expect(saved.elapsed).toBe(25)
})
it.each([false,true])('held runtime commit preserves execution and checkpoint; as-run failure=%s',async(failed)=>{
  saved.playing=false;saved.programHold={status:'HELD',decoderId:7,frames:25};saved.executionId='saved-hold-execution'
  const follow=vi.spyOn(runtime.asRun,'followHeldWithCommit')
  if(failed)follow.mockRejectedValue(new Error('as-run fixture refused'))
  else follow.mockImplementation(async(_item,_view,_revision,_frames,commit)=>{commit()})
  const state={onAir:{itemId:'vt',startedAt:0,elapsed:25},playing:false,preview:null,programTrim:saved.programTrim}
  const health={restarts:0,deaths:0,stalls:0,error:null,ready:true,programHold:{itemId:'vt',decoderId:8,status:'HELD',frames:25}}
  const engine=runtime.transport as EngineTransport
  vi.mocked(engine.recoverHeld).mockImplementation(async(_rundown,_item,_frames,_trim,commit)=>{
    vi.spyOn(engine,'state').mockReturnValue(state as ReturnType<typeof engine.state>)
    vi.spyOn(engine,'health').mockReturnValue(health as ReturnType<typeof engine.health>)
    await commit!({itemId:'vt',decoderId:8,frames:25})
    return {itemId:'vt',decoderId:8,frames:25}
  })
  expect(await runtime.recoverCheckpoint()).toBe(true);runtime.checkpoint(true)
  if(failed){await vi.waitFor(()=>expect(runtime.recoveryError).toContain('as-run fixture refused'));runtime.checkpoint(true);expect(write).not.toHaveBeenCalled()}
  else{await vi.waitFor(()=>expect(write).toHaveBeenCalled());expect(write).toHaveBeenCalledWith(expect.objectContaining({playing:false,elapsed:25,executionId:'saved-hold-execution',programHold:{status:'HELD',decoderId:8,frames:25}}))}
  expect(follow).toHaveBeenCalledWith('vt',runtime.operationalView,'rev',25,expect.any(Function))
  expect(engine.recover).not.toHaveBeenCalled()
})
it.each(['NONE','ASRUN','CHECKPOINT'] as const)('real SQLite commit binds restored segment/checkpoint; failure=%s',async(failure)=>{
  const view=runtime.operationalView!,channel=runtime.channel;runtime.close()
  const ownership=new ExecutionOwnership(database.db),predecessor=ownership.claim('ch')
  const previousAsRun=new AsRun(database.db,channel,'NATIVE',predecessor)
  await previousAsRun.follow('vt',view,'rev',0,false)
  const original=database.sqlite.prepare('SELECT id FROM as_run WHERE ended_at IS NULL').get() as {id:string}
  saved={...saved,playing:false,executionId:'held-continuation',ownerRunId:predecessor.assertOwned().id,programHold:{status:'HELD',decoderId:7,frames:25}}
  new Checkpoints(database.sqlite,predecessor).write(saved)
  predecessor.finalRelease()
  const lease=ownership.claim('ch'),checkpoints=new Checkpoints(database.sqlite,lease)
  runtime=new ChannelRuntime(channel,database.db,['null'],null,new Set(),new Map(),null,checkpoints,null,null,null,null,null,null,lease)
  runtime.operationalRevision={id:'rev',revision:1,publishedAt:'now'};runtime.operationalView=view
  vi.spyOn(runtime,'load').mockResolvedValue(view)
  if(failure==='ASRUN')database.sqlite.exec("CREATE TRIGGER fail_held_segment BEFORE INSERT ON as_run BEGIN SELECT RAISE(ABORT,'held segment fixture refused'); END")
  if(failure==='CHECKPOINT')database.sqlite.exec("CREATE TRIGGER fail_held_checkpoint BEFORE UPDATE ON channel_checkpoints BEGIN SELECT RAISE(ABORT,'held checkpoint fixture refused'); END")
  const engine=runtime.transport as EngineTransport
  vi.mocked(engine.recoverHeld).mockImplementation(async(_rundown,_item,_frames,_trim,commit)=>{
    vi.spyOn(engine,'state').mockReturnValue({onAir:{itemId:'vt',startedAt:0,elapsed:25},playing:false,preview:null,programTrim:saved.programTrim} as ReturnType<typeof engine.state>)
    vi.spyOn(engine,'health').mockReturnValue({ready:true,restarts:0,deaths:0,stalls:0,error:null,programHold:{itemId:'vt',decoderId:8,status:'HELD',frames:25}} as ReturnType<typeof engine.health>)
    await commit!({itemId:'vt',decoderId:8,frames:25});return {itemId:'vt',decoderId:8,frames:25}
  })
  expect(await runtime.recoverCheckpoint()).toBe(true);runtime.checkpoint(true)
  if(failure!=='NONE'){
    await vi.waitFor(()=>expect(runtime.recoveryError).toContain(failure==='ASRUN'?'held segment fixture refused':'held checkpoint fixture refused'))
    runtime.checkpoint(true)
    expect(checkpoints.read('ch')).toMatchObject({ownerRunId:saved.ownerRunId,programHold:{decoderId:7},elapsed:25,playing:false})
    expect(lease.assertOwned().predecessorResolved).toBe(false)
    expect(database.sqlite.prepare('SELECT count(*) AS n FROM as_run').get()).toEqual({n:1})
    return
  }
  await vi.waitFor(()=>expect(checkpoints.read('ch')?.programHold?.decoderId).toBe(8))
  await vi.waitFor(()=>expect((runtime as unknown as {recoveryAttempt:unknown}).recoveryAttempt).toBeNull())
  expect(runtime.recoveryError).toBeNull()
  expect(checkpoints.read('ch')).toMatchObject({playing:false,elapsed:25,executionId:'held-continuation',ownerRunId:lease.assertOwned().id})
  const rows=database.sqlite.prepare('SELECT id,ended_by,start_position_frames FROM as_run ORDER BY rowid').all() as Array<{id:string;ended_by:string|null;start_position_frames:number}>
  expect(rows).toHaveLength(2);expect(rows[0]).toMatchObject({id:original.id,ended_by:'RESTART'});expect(rows[1]).toMatchObject({ended_by:null,start_position_frames:25})
  expect(lease.ownsAsRun(rows[1]!.id)).toBe(true)
  expect(database.sqlite.pragma('foreign_key_check')).toEqual([])
})
it('native held receipt persists exact cursor and trim instead of playing',()=>{
  vi.spyOn(runtime.transport,'state').mockReturnValue({onAir:{itemId:'vt',startedAt:0,elapsed:30},playing:true,preview:null,programTrim:saved.programTrim} as ReturnType<typeof runtime.transport.state>)
  vi.spyOn(runtime.transport,'health').mockReturnValue({restarts:0,deaths:0,stalls:0,error:null,ready:true,programHold:{itemId:'vt',decoderId:7,status:'HELD',frames:25}} as ReturnType<typeof runtime.transport.health>)
  runtime.checkpoint(true)
  expect(write).toHaveBeenCalledWith(expect.objectContaining({itemId:'vt',elapsed:25,playing:false,programTrim:saved.programTrim,programHold:{status:'HELD',decoderId:7,frames:25}}))
})
it('inconclusive native hold preserves previous checkpoint',()=>{
  vi.spyOn(runtime.transport,'health').mockReturnValue({restarts:0,deaths:0,stalls:0,error:null,ready:true,programHold:{itemId:'vt',decoderId:7,status:'UNCONFIRMED',frames:null}} as ReturnType<typeof runtime.transport.health>)
  runtime.checkpoint(true);expect(write).not.toHaveBeenCalled();expect(runtime.recoveryError).toContain('inconclusiva')
})
it('live recusada definitivamente pode tentar de novo com backoff mantendo checkpoint e identidade',async()=>{
  liveCheckpoint();vi.useFakeTimers({toFake:['Date']})
  const recover=(runtime.transport as EngineTransport).recover as ReturnType<typeof vi.fn>
  recover.mockRejectedValue(new EngineCommandRejected('source not found'))
  expect(await runtime.recoverCheckpoint()).toBe(true);runtime.checkpoint(true)
  await vi.waitFor(()=>expect(runtime.recoveryError).toContain('tentativa limitada'))
  runtime.checkpoint(true);expect(recover).toHaveBeenCalledTimes(1)
  vi.setSystemTime(Date.now()+1500);runtime.checkpoint(true)
  await vi.waitFor(()=>expect(recover).toHaveBeenCalledTimes(2))
  expect(recover.mock.calls.every(call=>call[0]==='rd'&&call[1]==='live'&&call[2]===25)).toBe(true)
  expect(write).not.toHaveBeenCalled()
})
it('recusa tardia após ACK agenda uma única tentativa do mesmo checkpoint',async()=>{
  liveCheckpoint();vi.useFakeTimers({toFake:['Date']})
  const engine=runtime.transport as unknown as {recover:ReturnType<typeof vi.fn>;callbacks:{onRecoveryRejected:(attempt:object,error:Error)=>void}}
  engine.recover.mockResolvedValue(undefined)
  expect(await runtime.recoverCheckpoint()).toBe(true);runtime.checkpoint(true)
  await vi.waitFor(()=>expect(engine.recover).toHaveBeenCalledTimes(1))
  await Promise.resolve();await Promise.resolve()
  const failure=new EngineCommandRejected('native opening refused')
  engine.callbacks.onRecoveryRejected({rundownId:'rd',itemId:'live',frames:25},failure)
  engine.callbacks.onRecoveryRejected({rundownId:'rd',itemId:'live',frames:25},failure)
  expect(runtime.recoveryError).toContain('tentativa limitada')
  vi.setSystemTime(Date.now()+1500);runtime.checkpoint(true)
  await vi.waitFor(()=>expect(engine.recover).toHaveBeenCalledTimes(2))
  expect(write).not.toHaveBeenCalled()
})
it('timeout de live não autoriza repetição automática de TAKE',async()=>{
  liveCheckpoint();vi.useFakeTimers({toFake:['Date']})
  const recover=(runtime.transport as EngineTransport).recover as ReturnType<typeof vi.fn>
  recover.mockRejectedValue(new Error('ACK_TIMEOUT'))
  expect(await runtime.recoverCheckpoint()).toBe(true);runtime.checkpoint(true)
  await vi.waitFor(()=>expect(runtime.recoveryError).toContain('ACK_TIMEOUT'))
  vi.setSystemTime(Date.now()+30000);runtime.checkpoint(true)
  expect(recover).toHaveBeenCalledTimes(1);expect(write).not.toHaveBeenCalled()
})
it('PGM recuperado elimina erro da tentativa anterior, sem nova identidade',async()=>{
  liveCheckpoint()
  expect(await runtime.recoverCheckpoint()).toBe(true)
  const identity=saved.executionId
  runtime.recoveryError='PGM não recuperado: tentativa anterior'
  ;(runtime.transport as unknown as {callbacks:{onTakeConfirmed:(id:string,frames:number,recovered:boolean,previous:null)=>void}}).callbacks.onTakeConfirmed('live',25,true,null)
  expect(runtime.recoveryError).toBeNull()
  expect((runtime as unknown as {executionId:string}).executionId).toBe(identity)
})
it('revisão alterada durante backoff impede a nova tentativa',async()=>{
  liveCheckpoint();vi.useFakeTimers({toFake:['Date']})
  const recover=(runtime.transport as EngineTransport).recover as ReturnType<typeof vi.fn>
  recover.mockRejectedValue(new EngineCommandRejected('source not found'))
  expect(await runtime.recoverCheckpoint()).toBe(true);runtime.checkpoint(true)
  await vi.waitFor(()=>expect(runtime.recoveryError).toContain('tentativa limitada'))
  runtime.operationalRevision={id:'changed',revision:2,publishedAt:'now'}
  vi.setSystemTime(Date.now()+1500);runtime.checkpoint(true)
  expect(recover).toHaveBeenCalledTimes(1);expect(runtime.recoveryError).toContain('Contexto/posse mudou')
  expect(write).not.toHaveBeenCalled()
})
it('legacy checkpoint without confirmed crop is refused and empty state cannot erase it',async()=>{
  delete saved.programTrim
  expect(await runtime.recoverCheckpoint()).toBe(false)
  expect(runtime.recoveryError).toContain('Checkpoint antigo')
  runtime.checkpoint(true);expect(write).not.toHaveBeenCalled();expect(saved.elapsed).toBe(25)
})
it('failed decoder recovery retains checkpoint and forwards the exact saved crop',async()=>{
  expect(await runtime.recoverCheckpoint()).toBe(true);runtime.checkpoint(true)
  await vi.waitFor(()=>expect(runtime.recoveryError).toContain('decoder fixture refused'))
  expect(runtime.transport).toBeInstanceOf(EngineTransport)
  expect((runtime.transport as EngineTransport).recover).toHaveBeenCalledWith('rd','vt',25,saved.programTrim)
  runtime.checkpoint(true);expect(write).not.toHaveBeenCalled()
})
it('explicit confirmed STOP releases checkpoint preservation',async()=>{
  delete saved.programTrim;expect(await runtime.recoverCheckpoint()).toBe(false)
  ;(runtime.transport as unknown as {callbacks:{onStopConfirmed:()=>void}}).callbacks.onStopConfirmed()
  runtime.checkpoint(true);expect(write).toHaveBeenCalledWith(expect.objectContaining({playing:false,itemId:null,elapsed:0,programTrim:undefined}))
})
it('end-relative scheduler receives mounted native duration, not nominal projection',()=>{
  vi.spyOn(runtime.transport,'state').mockReturnValue({onAir:{itemId:'vt',startedAt:0,elapsed:50,mountedDuration:75},playing:true,preview:null} as ReturnType<typeof runtime.transport.state>)
  const tick=vi.spyOn(runtime.graphics.scheduler,'tick').mockResolvedValue({fired:[],dismissed:[]})
  runtime.fireDueGraphics()
  expect(tick).toHaveBeenCalledWith('vt',50,75)
})
it('held PGM does not tick timed graphics/secondary events until playback resumes',()=>{
  const state={onAir:{itemId:'vt',startedAt:0,elapsed:50,mountedDuration:75},playing:false,preview:null}
  const read=vi.spyOn(runtime.transport,'state').mockReturnValue(state as ReturnType<typeof runtime.transport.state>)
  const tick=vi.spyOn(runtime.graphics.scheduler,'tick').mockResolvedValue({fired:[],dismissed:[]})
  expect(runtime.fireDueGraphics()).toBe(false);expect(tick).not.toHaveBeenCalled()
  read.mockReturnValue({...state,playing:true} as ReturnType<typeof runtime.transport.state>)
  runtime.fireDueGraphics();expect(tick).toHaveBeenCalledWith('vt',50,75)
})
