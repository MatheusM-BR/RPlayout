import Fastify,{type FastifyInstance} from 'fastify'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {createApp,runtimeFor,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {channels,liveSources,operatorDecisions,liveSourceVersions,channelProjectVersions} from '../db/schema.js'
import {sessionDigest} from './access.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
let app:App,server:FastifyInstance,notify:ReturnType<typeof vi.fn>
beforeEach(async()=>{
  app=await createApp(':memory:');notify=vi.fn()
  for(const id of ['a','b'])app.db.insert(channels).values({id,name:id,width:320,height:180,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:'now'}).run()
  server=Fastify();registerRoutes(app,server,notify);await server.ready()
})
afterEach(async()=>{await server.close();app.close();vi.restoreAllMocks()})
const body={channelId:'a',name:'Estúdio çãó',kind:'NDI',targetUrl:'ndi:Estúdio çãó'}
const review=async(id='a',cookie?:string)=>server.inject({method:'GET',url:`/api/channels/${id}/live-source-review`,headers:cookie?{cookie}:{}})
const current=async(id='a')=>({'if-match':(await review(id)).headers.etag as string})
const state=()=>[app.db.select().from(liveSources).all(),app.db.select().from(liveSourceVersions).all(),app.db.select().from(channelProjectVersions).all(),app.db.select().from(operatorDecisions).all().filter(row=>row.kind==='LIVE_SOURCE_EDITED')]
async function source(){const result=await server.inject({method:'POST',url:'/api/sources/live',payload:body,headers:await current()});expect(result.statusCode).toBe(201);return result.json()}
describe('HTTP de cadastro live não é comando de comutação',()=>{
  it('revisão privada é estável e os aliases exigem revisão original',async()=>{
    const first=await review(),before=state()
    expect(first.statusCode).toBe(200);expect(first.headers['cache-control']).toBe('private, no-store')
    expect((await review()).json()).toEqual(first.json());expect(state()).toEqual(before)
    for(const url of ['/api/sources/live','/api/v1/sources/live'])expect((await server.inject({method:'POST',url,payload:body})).statusCode).toBe(428)
    expect(state()).toEqual(before)
    const result=await server.inject({method:'POST',url:'/api/v1/sources/live',payload:body,headers:{'if-match':first.headers.etag as string}})
    expect(result.statusCode).toBe(201);expect(result.json()).toMatchObject({applied:true,automaticTake:false,physicalSignalValidated:false})
    expect((await server.inject({method:'POST',url:'/api/sources/live',payload:body,headers:{'if-match':first.headers.etag as string}})).statusCode).toBe(409)
  })
  it('criar/renomear/excluir preserva runtime e preview/PGM existentes, sem rebuild',async()=>{
    const runtime=(await runtimeFor(app,'a'))!,cue=vi.spyOn(runtime.transport,'cue'),take=vi.spyOn(runtime.transport,'take'),stop=vi.spyOn(runtime.transport,'stop'),close=vi.spyOn(runtime,'close')
    await runtime.transport.cue({kind:'SOURCE',source:'ndi:PROGRAM_FIXTURE'});cue.mockClear()
    const before=runtime.transport.state().preview,created=await source()
    const edited=await server.inject({method:'PUT',url:`/api/sources/live/${created.id}`,payload:{name:'Novo apelido'},headers:await current()})
    expect(edited.statusCode).toBe(200)
    expect((await server.inject({method:'DELETE',url:`/api/v1/sources/live/${created.id}`,headers:await current()})).statusCode).toBe(200)
    expect(app.runtimes.get('a')).toBe(runtime);expect(runtime.transport.state().preview).toEqual(before)
    for(const spy of [cue,take,stop,close])expect(spy).not.toHaveBeenCalled()
    expect(app.db.select().from(operatorDecisions).all().filter(row=>row.kind==='LIVE_SOURCE_EDITED')).toHaveLength(3)
  })
  it('auditoria real falha: captura/edit/delete não deixam dados ou contadores parciais',async()=>{
    const created=await source()
    app.sqlite.exec("CREATE TRIGGER fixture_live_audit_fail BEFORE INSERT ON operator_decisions WHEN NEW.kind='LIVE_SOURCE_EDITED' BEGIN SELECT RAISE(ABORT,'FIXTURE_AUDIT_FAIL'); END")
    for(const [method,url,payload] of [['POST','/api/sources/live',body],['PUT',`/api/sources/live/${created.id}`,{name:'Não gravar'}],['DELETE',`/api/sources/live/${created.id}`,undefined]] as const){
      const before=state(),res=await server.inject({method,url,payload,headers:await current()})
      expect(res.statusCode).toBe(500);expect(state()).toEqual(before)
    }
    expect(notify).toHaveBeenCalledTimes(1)
  })
  it('refresh posterior falho informa applied:true, sem rollback falso ou repetição',async()=>{
    notify.mockImplementation(()=>{throw new Error('UI_FAIL')})
    const created=await source()
    expect(created).toMatchObject({applied:true,refreshError:expect.any(String)})
    expect(app.db.select().from(liveSources).all()).toHaveLength(1)
    expect(app.db.select().from(operatorDecisions).all().filter(row=>row.kind==='LIVE_SOURCE_EDITED')).toHaveLength(1)
  })
  it('PUT não move dono, prova de outro canal e par estrangeiro são recusados',async()=>{
    const created=await source(),before=state()
    expect((await server.inject({method:'PUT',url:`/api/sources/live/${created.id}`,payload:{channelId:'b'},headers:await current()})).statusCode).toBe(400)
    expect((await server.inject({method:'PUT',url:`/api/sources/live/${created.id}`,payload:{name:'Novo'},headers:await current('b')})).statusCode).toBe(400)
    expect((await server.inject({method:'POST',url:'/api/sources/live',payload:{...body,pairedSourceId:'missing'},headers:await current()})).statusCode).toBe(400)
    expect(state()).toEqual(before)
  })
  it.each(['account','role','station','channel','session'])('acesso é reconferido dentro da transação: %s',async revoked=>{
    const created=await source(),token='source-session',now=new Date().toISOString(),cookie=`rplayout_session=${token}`
    app.sqlite.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run('user','user','fixture-not-login','ADMIN',1,now)
    app.sqlite.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(sessionDigest(token),'user','2099-01-01',now)
    app.sqlite.prepare('INSERT INTO user_access VALUES (?,?,?,?)').run('user',JSON.stringify(['a']),null,now)
    expect((await review('b',cookie)).statusCode).toBe(403)
    const baseline=await review('a',cookie);expect(baseline.statusCode).toBe(200)
    const before=state(),transaction=app.db.transaction.bind(app.db)
    vi.spyOn(app.db,'transaction').mockImplementation(((callback:any,config:any)=>{
      if(revoked==='account')app.sqlite.prepare("UPDATE users SET enabled=0 WHERE id='user'").run()
      if(revoked==='role')app.sqlite.prepare("UPDATE users SET role='VIEWER' WHERE id='user'").run()
      if(revoked==='station')app.sqlite.prepare("UPDATE user_access SET station_ips='[\"192.0.2.1\"]' WHERE user_id='user'").run()
      if(revoked==='channel')app.sqlite.prepare("UPDATE user_access SET channel_ids='[\"b\"]' WHERE user_id='user'").run()
      if(revoked==='session')app.sqlite.prepare("DELETE FROM sessions WHERE user_id='user'").run()
      return transaction(callback,config)
    }) as typeof app.db.transaction)
    const result=await server.inject({method:'PUT',url:`/api/sources/live/${created.id}`,headers:{cookie,'if-match':baseline.headers.etag as string},payload:{name:'Não deve gravar'}})
    expect(result.statusCode).toBe(403);expect(state()).toEqual(before)
  })
})
