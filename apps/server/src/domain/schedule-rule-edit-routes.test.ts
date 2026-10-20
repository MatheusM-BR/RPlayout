import Fastify,{type FastifyInstance} from 'fastify'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {createApp,runtimeFor,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {channels,scheduleRules,rundowns,mediaAssets} from '../db/schema.js'
import {sessionDigest} from './access.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
let app:App,server:FastifyInstance,notify:ReturnType<typeof vi.fn>
const band={name:'Manhã Ç',weekdays:'0123456',startMinute:60,endMinute:120,categories:[],avoidHours:0}
beforeEach(async()=>{
  app=await createApp(':memory:');notify=vi.fn()
  for(const id of ['a','b'])app.db.insert(channels).values({id,name:id,width:320,height:180,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:'now'}).run()
  server=Fastify();registerRoutes(app,server,notify);await server.ready()
})
afterEach(async()=>{await server.close();app.close();vi.restoreAllMocks()})
const review=(id='a',cookie?:string)=>server.inject({url:`/api/channels/${id}/rules`,headers:cookie?{cookie}:{}})
const headers=async(id='a')=>({'if-match':(await review(id)).headers.etag as string})
const create=async(id='a')=>(await server.inject({method:'POST',url:`/api/channels/${id}/rules`,payload:band,headers:await headers(id)})).json()
const state=()=>({rows:app.sqlite.prepare('SELECT * FROM schedule_rules ORDER BY id').all(),versions:app.sqlite.prepare('SELECT * FROM schedule_rule_versions ORDER BY channel_id').all(),projects:app.sqlite.prepare('SELECT * FROM channel_project_versions ORDER BY channel_id').all(),success:app.sqlite.prepare("SELECT * FROM operator_decisions WHERE kind='SCHEDULE_RULE_EDITED' ORDER BY rowid").all()})
function account(){const now=new Date().toISOString();app.sqlite.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('user','user','fixture-not-login','ADMIN',1,now);app.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest('rule-session'),'user','2099-01-01',now);app.sqlite.prepare('INSERT INTO user_access VALUES(?,?,?,?)').run('user','["a"]',null,now);return 'rplayout_session=rule-session'}
describe('HTTP de faixas é editorial, não comando de playout',()=>{
  it('GET estável privado e CREATE/PATCH/DELETE exigem revisão original',async()=>{
    const first=await review(),before=state();expect(first.statusCode).toBe(200);expect(first.headers['cache-control']).toBe('private, no-store')
    expect((await review()).json()).toEqual(first.json());expect(state()).toEqual(before)
    expect((await server.inject({method:'POST',url:'/api/channels/a/rules',payload:band})).statusCode).toBe(428)
    const saved=await create();for(const method of ['PATCH','DELETE'] as const)expect((await server.inject({method,url:`/api/rules/${saved.rule.id}`,...(method==='PATCH'?{payload:{name:'Draft'}}:{})})).statusCode).toBe(428)
    expect((await server.inject({method:'POST',url:'/api/channels/a/rules',payload:{...band,startMinute:120,endMinute:180},headers:{'if-match':first.headers.etag as string}})).statusCode).toBe(409)
    expect(state().rows).toHaveLength(1);expect(state().success).toHaveLength(1)
  })
  it('alterar faixa não recria engine, sintoniza ou altera preview/PGM',async()=>{
    const runtime=(await runtimeFor(app,'a'))!,cue=vi.spyOn(runtime.transport,'cue'),take=vi.spyOn(runtime.transport,'take'),stop=vi.spyOn(runtime.transport,'stop'),close=vi.spyOn(runtime,'close')
    await runtime.transport.cue({kind:'SOURCE',source:'ndi:SIMULATED_PREVIEW'});cue.mockClear();const before=runtime.transport.state().preview
    const saved=await create();expect(saved).toMatchObject({applied:true,editorialOnly:true,automaticTake:false});expect(saved.rules).toEqual([saved.rule])
    expect(runtime.transport.state().preview).toEqual(before);expect(app.runtimes.get('a')).toBe(runtime)
    for(const spy of [cue,take,stop,close])expect(spy).not.toHaveBeenCalled()
  })
  it.each(['CREATE','UPDATE','DELETE'])('falha de auditoria real em %s reverte operação inteira',async operation=>{
    const saved=operation==='CREATE'?null:await create(),original=await headers(),before=state(),calls=notify.mock.calls.length
    app.sqlite.exec("CREATE TRIGGER rule_audit_fail BEFORE INSERT ON operator_decisions WHEN NEW.kind='SCHEDULE_RULE_EDITED' BEGIN SELECT RAISE(ABORT,'RULE_AUDIT_FIXTURE'); END")
    const response=await server.inject({method:operation==='CREATE'?'POST':operation==='UPDATE'?'PATCH':'DELETE',url:operation==='CREATE'?'/api/channels/a/rules':`/api/rules/${saved.rule.id}`,headers:original,...(operation==='DELETE'?{}:{payload:operation==='CREATE'?band:{name:'Draft'}})})
    expect(response.statusCode).toBe(500);expect(state()).toEqual(before);expect(notify).toHaveBeenCalledTimes(calls)
  })
  it('falha pós-commit é configuração gravada com aviso, não rollback/replay',async()=>{
    notify.mockImplementation(()=>{throw new Error('refresh failed')});const saved=await create()
    expect(saved).toMatchObject({applied:true,refreshError:expect.any(String)});expect(state().rows).toHaveLength(1);expect(state().success).toHaveLength(1)
  })
  it('acesso ao dono real cobre PATCH/DELETE e não aceita spoof de channelId',async()=>{
    const foreign=await create('b'),local=await create(),cookie=account()
    expect((await review('a',cookie)).statusCode).toBe(200);expect((await review('b',cookie)).statusCode).toBe(403)
    const before=state();for(const method of ['PATCH','DELETE'] as const){const result=await server.inject({method,url:`/api/rules/${foreign.rule.id}?channelId=a`,headers:{cookie,'if-match':foreign.eTag},...(method==='PATCH'?{payload:{name:'Foreign'}}:{})});expect(result.statusCode).toBe(403)}
    expect(state()).toEqual(before)
    const proof=(await review('a',cookie)).headers.etag as string
    expect((await server.inject({method:'PATCH',url:`/api/rules/${local.rule.id}`,headers:{cookie,'if-match':proof},payload:{name:'Local'}})).statusCode).toBe(200)
  })
  it.each(['disabled','role','station','channel','session','owner','archive'])('reconfere %s no commit',async change=>{
    const saved=await create(),cookie=account(),original=await review('a',cookie),before=state(),transaction=app.db.transaction.bind(app.db)
    vi.spyOn(app.db,'transaction').mockImplementation(((callback:any,config:any)=>{
      if(change==='disabled')app.sqlite.prepare('UPDATE users SET enabled=0').run()
      if(change==='role')app.sqlite.prepare("UPDATE users SET role='VIEWER'").run()
      if(change==='station')app.sqlite.prepare("UPDATE user_access SET station_ips='[\"192.0.2.1\"]'").run()
      if(change==='channel')app.sqlite.prepare("UPDATE user_access SET channel_ids='[\"b\"]'").run()
      if(change==='session')app.sqlite.prepare('DELETE FROM sessions').run()
      if(change==='owner')app.sqlite.prepare("UPDATE schedule_rules SET channel_id='b'").run()
      if(change==='archive')app.sqlite.prepare("UPDATE channels SET archived_at='now' WHERE id='a'").run()
      return transaction(callback,config)
    }) as typeof app.db.transaction)
    const response=await server.inject({method:'PATCH',url:`/api/rules/${saved.rule.id}`,headers:{cookie,'if-match':original.headers.etag as string},payload:{name:'Not applied'}})
    expect(response.statusCode).toBe(change==='archive'?409:403)
    expect(state().success).toEqual(before.success);expect(app.db.select().from(scheduleRules).get()?.name).toBe(band.name)
    if(!['owner','archive'].includes(change))expect(state()).toEqual(before)
  })
  async function day(){
    const now=new Date().toISOString()
    app.db.insert(rundowns).values({id:'day',channelId:'a',name:'Day',date:'2026-10-05',plannedStart:0,loop:false,createdAt:now,updatedAt:now}).run()
    app.db.insert(mediaAssets).values({id:'asset',title:'Placeholder metadata',path:'C:/fixture-not-decoded.mp4',contentHash:'fixture-hash',kind:'VIDEO',durationFrames:1500,durationNs:60_000_000_000,rateNum:25,rateDen:1,width:320,height:180,hasAudio:true,interlaceMode:'progressive',qcStatus:'APPROVED',createdAt:now}).run()
    app.db.insert(scheduleRules).values({id:'day-band',channelId:'a',name:'Original',weekdays:'0123456',startMinute:0,endMinute:1,categories:[],avoidHours:0,createdAt:now}).run()
    const response=await server.inject({method:'POST',url:'/api/rundowns/day/autofill-day',payload:{preview:true}})
    expect(response.statusCode,response.body).toBe(200);expect(response.json().plan.items.length).toBeGreaterThan(0)
    return {proposal:response.json().proposal,etag:app.concurrency.generateETag('day')}
  }
  it.each(['same-value','ABA'])('montagem diária recusa pauta alterada e revertida: %s',async change=>{
    const original=await day(),before=app.sqlite.prepare('SELECT * FROM rundown_items').all()
    if(change==='ABA')app.sqlite.prepare("UPDATE schedule_rules SET name='Changed' WHERE id='day-band'").run()
    app.sqlite.prepare("UPDATE schedule_rules SET name='Original' WHERE id='day-band'").run()
    expect(app.concurrency.generateETag('day')).toBe(original.etag)
    const response=await server.inject({method:'POST',url:'/api/rundowns/day/autofill-day',headers:{'if-match':original.etag},payload:{proposalId:original.proposal.id}})
    expect(response.statusCode).toBe(409);expect(response.json().error).toContain('pauta mudou');expect(app.sqlite.prepare('SELECT * FROM rundown_items').all()).toEqual(before)
  })
  it('faixas de outro canal não invalidam proposta diária local; aplicação continua editorial',async()=>{
    const original=await day();await create('b')
    const response=await server.inject({method:'POST',url:'/api/rundowns/day/autofill-day',headers:{'if-match':original.etag},payload:{proposalId:original.proposal.id}})
    expect(response.statusCode,response.body).toBe(200);expect(response.json().proposal.consumed).toBe(true)
    expect(app.sqlite.prepare("SELECT count(*) n FROM operational_playlist_revisions").get()).toEqual({n:0})
  })
  it('pauta inválida não entra em proposta diária nem é normalizada',async()=>{
    await day();app.sqlite.prepare("UPDATE schedule_rules SET weekdays='00' WHERE id='day-band'").run()
    const response=await server.inject({method:'POST',url:'/api/rundowns/day/autofill-day',payload:{preview:true}})
    expect(response.statusCode).toBe(409);expect(app.sqlite.prepare("SELECT weekdays FROM schedule_rules WHERE id='day-band'").get()).toEqual({weekdays:'00'})
  })
})
