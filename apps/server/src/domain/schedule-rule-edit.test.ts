import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {scheduleRuleETag} from '@rplayout/protocol'
import {openDatabase} from '../db/client.js'
import {channels,scheduleRules,operatorDecisions} from '../db/schema.js'
import {scheduleRuleRevision} from '../db/schedule-rule-revisions.js'
import {editScheduleRule,readScheduleRuleReview,type ScheduleRuleHooks} from './schedule-rule-edit.js'
let database:ReturnType<typeof openDatabase>,hooks:ScheduleRuleHooks
const band={name:'Manhã çãó',weekdays:'0123456',startMinute:60,endMinute:120,categories:['Vídeos'],avoidHours:0}
beforeEach(()=>{
  database=openDatabase(':memory:')
  for(const id of ['a','b','channel:ç'])database.db.insert(channels).values({id,name:id,width:320,height:180,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:'now'}).run()
  hooks={authorize:vi.fn(),audit:(tx,details)=>{tx.insert(operatorDecisions).values({id:String(Math.random()),rundownId:'@security',kind:'SCHEDULE_RULE_EDITED',payload:details,createdAt:'now'}).run()}}
})
afterEach(()=>{database.sqlite.close();vi.restoreAllMocks()})
const review=(id='a')=>readScheduleRuleReview(database.db,id,hooks.authorize)
const proof=(id='a')=>scheduleRuleETag(id,review(id).revision)
const edit=(body=band,id='a')=>editScheduleRule(database.db,'CREATE',id,body,proof(id),hooks)
const state=()=>({rules:database.sqlite.prepare('SELECT * FROM schedule_rules ORDER BY id').all(),versions:database.sqlite.prepare('SELECT * FROM schedule_rule_versions ORDER BY channel_id').all(),projects:database.sqlite.prepare('SELECT * FROM channel_project_versions ORDER BY channel_id').all(),audit:database.sqlite.prepare('SELECT * FROM operator_decisions').all()})
describe('faixas usam revisão original e transação editorial',()=>{
  it('conferência estável não escreve nem fabrica pauta/publicação',()=>{
    const before=state(),first=review();expect(review()).toEqual(first);expect(state()).toEqual(before)
    expect(first).toMatchObject({rules:[],editorialOnly:true,automaticTake:false})
  })
  it.each([undefined,'junk','"rules:b:1"','"rules:a:0"','"rules:a:9007199254740992"',[]])('prova ausente/malformada/estrangeira %j não altera nada',header=>{
    const before=state();expect(()=>editScheduleRule(database.db,'CREATE','a',band,header,hooks)).toThrow();expect(state()).toEqual(before)
  })
  it('CRUD Unicode consome revisão e retorna lista do mesmo commit, sem publicar',()=>{
    const saved=edit(band,'channel:ç');expect(saved.rules).toEqual([saved.rule]);expect(saved.eTag).toBe(scheduleRuleETag('channel:ç',saved.revision))
    const updated=editScheduleRule(database.db,'UPDATE',saved.rule!.id,{name:'Tarde Ã'},saved.eTag,hooks)
    expect(updated.rules[0]?.name).toBe('Tarde Ã');expect(updated.rule?.createdAt).toBe(saved.rule?.createdAt)
    const removed=editScheduleRule(database.db,'DELETE',saved.rule!.id,undefined,updated.eTag,hooks)
    expect(removed.rules).toEqual([]);expect(removed.rule).toBeNull();expect(state().audit).toHaveLength(3)
  })
  it('mesma revisão admite uma alteração, inclusive DELETE não é repetido',()=>{
    const header=proof(),saved=editScheduleRule(database.db,'CREATE','a',band,header,hooks),before=state()
    expect(()=>editScheduleRule(database.db,'CREATE','a',{...band,startMinute:120,endMinute:180},header,hooks)).toThrow();expect(state()).toEqual(before)
    editScheduleRule(database.db,'DELETE',saved.rule!.id,undefined,saved.eTag,hooks)
    expect(()=>editScheduleRule(database.db,'DELETE',saved.rule!.id,undefined,saved.eTag,hooks)).toThrow()
  })
  it('sobreposição é recusada sob o lock, dias distintos e horários encostados são válidos',()=>{
    edit();const before=state();expect(()=>edit({...band,startMinute:110,endMinute:180})).toThrow();expect(state()).toEqual(before)
    edit({...band,startMinute:120,endMinute:180})
    const sunday=edit({...band,weekdays:'0',startMinute:180,endMinute:240})
    edit({...band,weekdays:'1',startMinute:180,endMinute:240})
    const intact=state();expect(()=>editScheduleRule(database.db,'UPDATE',sunday.rule!.id,{startMinute:110},proof(),hooks)).toThrow();expect(state()).toEqual(intact)
  })
  it('ABA e mesmo valor do canal invalidam campos antigos',()=>{
    const saved=edit(),old=saved.eTag
    database.sqlite.prepare('UPDATE schedule_rules SET name=? WHERE id=?').run('Changed',saved.rule!.id)
    database.sqlite.prepare('UPDATE schedule_rules SET name=? WHERE id=?').run(band.name,saved.rule!.id)
    const before=state();expect(()=>editScheduleRule(database.db,'UPDATE',saved.rule!.id,{name:'Draft'},old,hooks)).toThrow();expect(state()).toEqual(before)
    const fresh=proof();database.sqlite.prepare("UPDATE channels SET name=name WHERE id='a'").run()
    expect(()=>editScheduleRule(database.db,'DELETE',saved.rule!.id,undefined,fresh,hooks)).toThrow()
  })
  it.each(['CREATE','UPDATE','DELETE'] as const)('falha SQL de auditoria reverte %s, revisão e projeto',operation=>{
    const saved=operation==='CREATE'?null:edit(),header=proof(),before=state()
    database.sqlite.exec("CREATE TRIGGER rule_audit_fail BEFORE INSERT ON operator_decisions WHEN NEW.kind='SCHEDULE_RULE_EDITED' BEGIN SELECT RAISE(ABORT,'RULE_AUDIT_FIXTURE'); END")
    expect(()=>editScheduleRule(database.db,operation,saved?.rule!.id??'a',operation==='CREATE'?band:operation==='UPDATE'?{name:'Changed'}:undefined,header,hooks)).toThrow()
    expect(state()).toEqual(before)
  })
  it.each([{name:' '},{weekdays:'00'},{weekdays:''},{startMinute:60.5},{endMinute:60},{endMinute:1441},{avoidHours:241},{categories:['X','X']},{channelId:'b'},{unexpected:true}])('schema estrito recusa %j',patch=>{
    const before=state();expect(()=>editScheduleRule(database.db,'CREATE','a',{...band,...patch},proof(),hooks)).toThrow();expect(state()).toEqual(before)
  })
  it('PATCH parcial vazio, troca de dono e resultado temporal inválido são recusados',()=>{
    const saved=edit(),before=state()
    for(const body of [{},{channelId:'b'},{endMinute:1}])expect(()=>editScheduleRule(database.db,'UPDATE',saved.rule!.id,body,saved.eTag,hooks)).toThrow()
    expect(state()).toEqual(before)
  })
  it('canal ausente/arquivado não pode receber faixas; consulta de histórico é permitida',()=>{
    expect(()=>editScheduleRule(database.db,'CREATE','missing',band,scheduleRuleETag('missing',1),hooks)).toThrow()
    database.sqlite.prepare("UPDATE channels SET archived_at='now' WHERE id='a'").run()
    const before=state();expect(review().rules).toEqual([])
    expect(()=>editScheduleRule(database.db,'CREATE','a',band,scheduleRuleETag('a',scheduleRuleRevision(database.db,'a')),hooks)).toThrow();expect(state()).toEqual(before)
  })
  it('legado inválido/sobreposto é erro explícito, não lista vazia ou normalizada',()=>{
    const saved=edit();database.sqlite.prepare('UPDATE schedule_rules SET weekdays=? WHERE id=?').run('00',saved.rule!.id)
    const before=state();expect(()=>review()).toThrow();expect(state()).toEqual(before)
    database.sqlite.prepare('UPDATE schedule_rules SET weekdays=? WHERE id=?').run('0123456',saved.rule!.id)
    database.db.insert(scheduleRules).values({...saved.rule!,id:'overlap'}).run()
    const overlap=state();expect(()=>review()).toThrow();expect(state()).toEqual(overlap)
  })
})
