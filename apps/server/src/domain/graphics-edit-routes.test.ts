import Fastify,{type FastifyInstance} from 'fastify'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {createApp,runtimeFor,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {channels} from '../db/schema.js'
import {sessionDigest} from './access.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
let app:App,server:FastifyInstance,notify:ReturnType<typeof vi.fn>
const draft={channelId:'a',name:'Arte Çãó',svg:'<g><text>{{nome}}</text></g>'}
beforeEach(async()=>{app=await createApp(':memory:');notify=vi.fn();for(const id of ['a','b'])app.db.insert(channels).values({id,name:id,width:320,height:180,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:'now'}).run();server=Fastify();registerRoutes(app,server,notify);await server.ready()})
afterEach(async()=>{await server.close();app.close();vi.restoreAllMocks()})
const read=(id:string|null='a',cookie?:string)=>server.inject({url:`/api/graphics/review${id===null?'':`?channelId=${id}`}`,headers:cookie?{cookie}:{}})
const headers=async(id:string|null='a')=>({'if-match':(await read(id)).headers.etag as string})
const create=async(id:string|null='a')=>(await server.inject({method:'POST',url:'/api/graphics',payload:{...draft,channelId:id},headers:await headers(id)})).json()
const state=()=>Object.fromEntries(['channels','graphic_templates','graphics_versions','channel_project_versions','channel_configuration_versions','editorial_revision_counters'].map(table=>[table,app.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
const success=()=>app.sqlite.prepare("SELECT * FROM operator_decisions WHERE kind IN ('GRAPHIC_TEMPLATE_EDITED','SLATE_CONFIGURATION_CHANGED') ORDER BY rowid").all()
function account(){const now=new Date().toISOString();app.sqlite.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('user','user','not-login','ADMIN',1,now);app.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest('graphics-session'),'user','2099-01-01',now);app.sqlite.prepare('INSERT INTO user_access VALUES(?,?,?,?)').run('user','["a"]',null,now);return 'rplayout_session=graphics-session'}
describe('HTTP de templates e apresentação técnica conferidos',()=>{
  it('review estável privado e CRUD/slate cegos recusados sem mutação',async()=>{
    const original=await read(),before=state();expect(original.statusCode).toBe(200);expect(original.headers['cache-control']).toBe('private, no-store');expect((await read()).json()).toEqual(original.json());expect(state()).toEqual(before)
    expect((await server.inject({method:'POST',url:'/api/graphics',payload:draft})).statusCode).toBe(428)
    const saved=await create();for(const method of ['PATCH','DELETE']as const)expect((await server.inject({method,url:`/api/graphics/${saved.template.id}`,...(method==='PATCH'?{payload:{name:'Blind'}}:{})})).statusCode).toBe(428)
    expect((await server.inject({method:'PATCH',url:'/api/channels/a/slate',payload:{templateId:saved.template.id}})).statusCode).toBe(428)
    expect(success()).toHaveLength(1)
  })
  it('dois pedidos da mesma revisão têm um vencedor e uma auditoria',async()=>{
    const original=await headers(),responses=await Promise.all([1,2].map(n=>server.inject({method:'POST',url:'/api/graphics',headers:original,payload:{...draft,name:`Arte ${n}`}})))
    expect(responses.map(row=>row.statusCode).sort()).toEqual([200,409]);expect(success()).toHaveLength(1)
  })
  it.each(['CREATE','UPDATE','DELETE','SLATE'])('auditoria SQL falha em %s reverte linhas/counters sem efeito no runtime',async kind=>{
    const saved=kind==='CREATE'?null:await create(),runtime=(await runtimeFor(app,'a'))!,setSlate=vi.spyOn(runtime,'setSlate'),before=state(),audits=success(),calls=notify.mock.calls.length
    app.sqlite.exec("CREATE TRIGGER fixture_graphics_audit_fail BEFORE INSERT ON operator_decisions WHEN NEW.kind IN ('GRAPHIC_TEMPLATE_EDITED','SLATE_CONFIGURATION_CHANGED') BEGIN SELECT RAISE(ABORT,'GRAPHICS_AUDIT_FIXTURE'); END")
    const response=await server.inject({method:kind==='CREATE'?'POST':kind==='DELETE'?'DELETE':'PATCH',url:kind==='CREATE'?'/api/graphics':kind==='SLATE'?'/api/channels/a/slate':`/api/graphics/${saved.template.id}`,headers:await headers(),...(kind==='DELETE'?{}:{payload:kind==='CREATE'?draft:kind==='SLATE'?{templateId:saved.template.id}:{name:'Draft'}})})
    expect(response.statusCode).toBe(500);expect(state()).toEqual(before);expect(success()).toEqual(audits);expect(setSlate).not.toHaveBeenCalled();expect(notify).toHaveBeenCalledTimes(calls)
  })
  it('templates/slate preservam fonte preparada e não recriam runtime ou dão TAKE',async()=>{
    const runtime=(await runtimeFor(app,'a'))!;await runtime.transport.cue({kind:'SOURCE',source:'ndi:SIMULATED_NOT_PHYSICAL'});const preview=runtime.transport.state().preview,cue=vi.spyOn(runtime.transport,'cue'),take=vi.spyOn(runtime.transport,'take'),close=vi.spyOn(runtime,'close')
    const saved=await create(),response=await server.inject({method:'PATCH',url:'/api/channels/a/slate',headers:await headers(),payload:{templateId:saved.template.id}})
    expect(response.statusCode,response.body).toBe(200);expect(response.json()).toMatchObject({applied:true,runtimeConfigurationApplied:true,automaticTake:false,physicalOutputValidated:false})
    expect(runtime.transport.state().preview).toEqual(preview);expect(app.runtimes.get('a')).toBe(runtime);for(const spy of [cue,take,close])expect(spy).not.toHaveBeenCalled()
  })
  it('falha após commit não inventa rollback ou pede replay',async()=>{
    const saved=await create(),runtime=(await runtimeFor(app,'a'))!;vi.spyOn(runtime,'setSlate').mockImplementation(()=>{throw new Error('RUNTIME_FIXTURE')})
    const response=await server.inject({method:'PATCH',url:'/api/channels/a/slate',headers:await headers(),payload:{templateId:saved.template.id}})
    expect(response.statusCode).toBe(200);expect(response.json()).toMatchObject({applied:true,runtimeConfigurationApplied:false,refreshError:'RUNTIME_FIXTURE'});expect(success()).toHaveLength(2)
    notify.mockImplementation(()=>{throw new Error('NOTIFY_FIXTURE')});expect(await create('b')).toMatchObject({applied:true,refreshError:'NOTIFY_FIXTURE'})
  })
  it('conta restrita usa global mas não edita; dono real não é query/body spoof',async()=>{
    const shared=await create(null),foreign=await create('b'),local=await create(),cookie=account();expect((await read(null,cookie)).statusCode).toBe(200);expect((await read('b',cookie)).statusCode).toBe(403)
    for(const row of [shared,foreign])for(const method of ['PATCH','DELETE']as const){const response=await server.inject({method,url:`/api/graphics/${row.template.id}?channelId=a`,headers:{cookie,'if-match':row.eTag},...(method==='PATCH'?{payload:{name:'Spoof'}}:{})});expect(response.statusCode).toBe(403)}
    expect((await server.inject({method:'PATCH',url:'/api/channels/a/slate',headers:{cookie,'if-match':(await read('a',cookie)).headers.etag as string},payload:{templateId:shared.template.id}})).statusCode).toBe(200)
    expect((await server.inject({method:'PATCH',url:`/api/graphics/${local.template.id}`,headers:{cookie,'if-match':(await read('a',cookie)).headers.etag as string},payload:{channelId:null}})).statusCode).toBe(403)
  })
  it.each(['disabled','role','station','channel','session','owner','archive'])('autoridade é reconferida em %s antes da escrita',async change=>{
    const saved=await create(),cookie=account(),original=await read('a',cookie),before=state(),audits=success(),transaction=app.db.transaction.bind(app.db)
    vi.spyOn(app.db,'transaction').mockImplementation(((callback:any,config:any)=>{
      if(change==='disabled')app.sqlite.exec('UPDATE users SET enabled=0')
      if(change==='role')app.sqlite.exec("UPDATE users SET role='VIEWER'")
      if(change==='station')app.sqlite.exec("UPDATE user_access SET station_ips='[\"192.0.2.1\"]'")
      if(change==='channel')app.sqlite.exec("UPDATE user_access SET channel_ids='[\"b\"]'")
      if(change==='session')app.sqlite.exec('DELETE FROM sessions')
      if(change==='owner')app.sqlite.exec("UPDATE graphic_templates SET channel_id='b'")
      if(change==='archive')app.sqlite.exec("UPDATE channels SET archived_at='now' WHERE id='a'")
      return transaction(callback,config)
    })as typeof app.db.transaction)
    const response=await server.inject({method:'PATCH',url:`/api/graphics/${saved.template.id}`,headers:{cookie,'if-match':original.headers.etag as string},payload:{name:'Not applied'}})
    expect(response.statusCode).toBe(change==='archive'?409:403);expect(success()).toEqual(audits);if(!['owner','archive'].includes(change))expect(state()).toEqual(before)
  })
  it('shared revision alterada/revertida bloqueia a escolha de slate já conferida',async()=>{
    const saved=await create(null),original=await headers();app.sqlite.exec('UPDATE graphic_templates SET name=name');const before=state()
    const response=await server.inject({method:'PATCH',url:'/api/channels/a/slate',headers:original,payload:{templateId:saved.template.id}});expect(response.statusCode).toBe(409);expect(state()).toEqual(before)
  })
})
