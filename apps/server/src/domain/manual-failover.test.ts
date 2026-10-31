import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {openDatabase} from '../db/client.js'
import {channels,liveSources,operatorDecisions,healthEvents} from '../db/schema.js'
import {recordManualFailover} from './manual-failover.js'
import {FailoverManager} from './srt.js'

let database:ReturnType<typeof openDatabase>,manager:FailoverManager
beforeEach(()=>{
 database=openDatabase(':memory:');manager=new FailoverManager()
 database.db.insert(channels).values({id:'ch',name:'QA',width:320,height:180,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:new Date().toISOString()}).run()
 for(const id of ['a','b'])database.db.insert(liveSources).values({id,channelId:'ch',name:id,kind:'SRT',targetUrl:'srt://127.0.0.1:1',role:'PRIMARY',autoFailover:false,enabled:true,createdAt:new Date().toISOString()}).run()
})
afterEach(()=>{database.sqlite.close();vi.restoreAllMocks()})
const input={sourceId:'a'}
const record=(key:unknown='same-request',change=input,actor='actor',authorize=(_channel:string)=>{})=>recordManualFailover(database.db,manager,key,change,actor,'operator',authorize)
const rows=()=>({decisions:database.db.select().from(operatorDecisions).all(),health:database.db.select().from(healthEvents).all()})
it('stores decision and audit atomically before notifying local metadata; repeats do not toggle',()=>{
 const listener=vi.fn(()=>{expect(rows().decisions).toHaveLength(1);expect(rows().health).toHaveLength(1)})
 manager.onFailover(listener)
 const first=record(),again=record()
 expect(first).toMatchObject({event:{fromRole:'PRIMARY',toRole:'BACKUP'},cacheApplied:true,metadataDecision:{replayed:false,currentExecutionObserved:false},nativeProgramConfirmed:false,physicalOutputValidated:false})
 expect(again).toMatchObject({event:first.event,replayed:true,cacheApplied:false})
 expect(manager.getActiveRole('a')).toBe('BACKUP');expect(listener).toHaveBeenCalledOnce()
 expect(rows().decisions).toHaveLength(1);expect(rows().health).toHaveLength(1)
 expect(rows().health[0]!.state).toBe('METADATA_RECORDED')
})
it.each(['operator_decisions','health_events'])('rejection in %s leaves no role/listener/history side effect',table=>{
 const listener=vi.fn();manager.onFailover(listener)
 database.sqlite.exec(`CREATE TRIGGER reject_failover BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'QA_AUDIT_REJECTED'); END`)
 expect(()=>record()).toThrow('QA_AUDIT_REJECTED')
 expect(manager.getActiveRole('a')).toBe('PRIMARY');expect(listener).not.toHaveBeenCalled();expect(rows()).toEqual({decisions:[],health:[]})
 database.sqlite.exec('DROP TRIGGER reject_failover')
 expect(record().event.toRole).toBe('BACKUP');expect(record().replayed).toBe(true);expect(listener).toHaveBeenCalledOnce()
})
it.each([undefined,['array'],'bad key','x'.repeat(129)])('requires a stable bounded key: %j',key=>{
 expect(()=>recordManualFailover(database.db,manager,key,input,'actor','operator',()=>{})).toThrow(/Idempotency-Key/)
 expect(rows()).toEqual({decisions:[],health:[]})
})
it('same key cannot be rebound to another actor, source, reason or target',()=>{
 record();const before=rows()
 for(const [change,actor]of[[{sourceId:'b'},'actor'],[{sourceId:'a',targetRole:'PRIMARY'},'actor'],[{sourceId:'a',reason:'different'},'actor'],[input,'other']] as const){
  expect(()=>recordManualFailover(database.db,manager,'same-request',change,actor,'operator',()=>{})).toThrow('outra decisão')
 }
 expect(rows()).toEqual(before)
})
it('reauthorizes channel inside the transaction, including receipt replay',()=>{
 record();const before=rows()
 const deny=vi.fn((channel:string)=>{expect(channel).toBe('ch');throw new Error('REVOKED')})
 expect(()=>record('same-request',input,'actor',deny)).toThrow('REVOKED')
 expect(()=>record('new-request',input,'actor',deny)).toThrow('REVOKED')
 expect(rows()).toEqual(before);expect(manager.getActiveRole('a')).toBe('BACKUP')
})
it('fresh manager reads historical decision without replay; a new explicit request derives its role durably',()=>{
 record();manager=new FailoverManager();const listener=vi.fn();manager.onFailover(listener)
 const replay=record();expect(replay.replayed).toBe(true);expect(listener).not.toHaveBeenCalled()
 expect(manager.getActiveRole('a')).toBe('PRIMARY') // Receipt is not a current engine/cache claim.
 const next=record('new-request');expect(next.event).toMatchObject({fromRole:'BACKUP',toRole:'PRIMARY'})
 expect(listener).toHaveBeenCalledOnce();expect(rows().decisions).toHaveLength(2)
})
it('post-commit cache failure keeps receipt and never repeats side effects on replay',()=>{
 const work=vi.spyOn(manager,'applyRecordedDecision').mockImplementation(()=>{throw new Error('LOCAL_CACHE_FAILED')})
 const result=record();expect(result).toMatchObject({cacheApplied:false,metadataDecision:{state:'RECORDED',currentExecutionObserved:false}})
 expect(record().replayed).toBe(true);expect(work).toHaveBeenCalledOnce();expect(rows().decisions).toHaveLength(1)
})
it('synthetic lost commit acknowledgement does not mutate memory or replay after the committed row becomes readable',()=>{
 const original=database.db.transaction.bind(database.db),work=vi.spyOn(manager,'applyRecordedDecision')
 const tx=vi.spyOn(database.db,'transaction').mockImplementation(((callback:any,options:any)=>{original(callback,options);throw new Error('QA_COMMIT_ACK_UNKNOWN')}) as any)
 expect(()=>record()).toThrow('QA_COMMIT_ACK_UNKNOWN');expect(work).not.toHaveBeenCalled();expect(manager.getActiveRole('a')).toBe('PRIMARY')
 tx.mockRestore();expect(rows().decisions).toHaveLength(1);expect(record().replayed).toBe(true);expect(work).not.toHaveBeenCalled()
})
it('reason is diagnostic-redacted rather than returning URL credentials in a receipt',()=>{
 const result=recordManualFailover(database.db,manager,'redact',{sourceId:'a',reason:'srt://user:PRIVATE_PASSWORD@camera?passphrase=PRIVATE_PASSPHRASE'},'actor','operator',()=>{})
 expect(result.event.reason).not.toContain('PRIVATE_PASSWORD');expect(result.event.reason).not.toContain('PRIVATE_PASSPHRASE')
})
