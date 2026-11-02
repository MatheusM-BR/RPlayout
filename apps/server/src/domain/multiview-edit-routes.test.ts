import Fastify,{type FastifyInstance} from 'fastify'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {createApp,runtimeFor,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {channels,multiviewConfigs} from '../db/schema.js'
import {sessionDigest} from './access.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
let app:App,server:FastifyInstance,notify:ReturnType<typeof vi.fn>
beforeEach(async()=>{
  app=await createApp(':memory:');notify=vi.fn()
  for(const id of ['a','b','default'])app.db.insert(channels).values({id,name:id,width:320,height:180,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:'now'}).run()
  server=Fastify();registerRoutes(app,server,notify);await server.ready()
})
afterEach(async()=>{await server.close();app.close();vi.restoreAllMocks()})
const review=(id:string|null='a',cookie?:string)=>server.inject({url:`/api/multiview/config${id===null?'':`?channelId=${id}`}`,headers:cookie?{cookie}:{}})
const baseline=async(id:string|null='a')=>({'if-match':(await review(id)).headers.etag as string})
const state=()=>({rows:app.sqlite.prepare('SELECT * FROM multiview_configs ORDER BY id').all(),versions:app.sqlite.prepare('SELECT * FROM multiview_versions ORDER BY scope').all(),projects:app.sqlite.prepare('SELECT * FROM channel_project_versions ORDER BY channel_id').all(),success:app.sqlite.prepare("SELECT * FROM operator_decisions WHERE kind='MULTIVIEW_EDITED' ORDER BY rowid").all()})
const payload={channelId:'a',layout:'COMPACT_LIST'}
function account(){
  const token='mv-session',now=new Date().toISOString()
  app.sqlite.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('user','user','not-a-login-hash','ADMIN',1,now)
  app.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest(token),'user','2099-01-01',now)
  app.sqlite.prepare('INSERT INTO user_access VALUES(?,?,?,?)').run('user','["a"]',null,now)
  return `rplayout_session=${token}`
}
describe('HTTP multiview confere escopo e não comanda transporte',()=>{
  it('GET/aliases privados são estáveis, PUT sem revisão recusa e revisão é consumida',async()=>{
    const first=await review(),before=state();expect(first.statusCode).toBe(200);expect(first.headers['cache-control']).toBe('private, no-store')
    expect((await review()).json()).toEqual(first.json());expect(state()).toEqual(before)
    for(const url of ['/api/multiview/config','/api/v1/multiview/config'])expect((await server.inject({method:'PUT',url,payload})).statusCode).toBe(428)
    expect(state()).toEqual(before)
    expect((await server.inject({method:'PUT',url:'/api/v1/multiview/config',payload,headers:{'if-match':first.headers.etag as string}})).statusCode).toBe(200)
    expect((await server.inject({method:'PUT',url:'/api/multiview/config',payload,headers:{'if-match':first.headers.etag as string}})).statusCode).toBe(409)
    expect(state().success).toHaveLength(1)
  })
  it('layout gravado não sintoniza/recria engine nem muda PGM/PVW',async()=>{
    const runtime=(await runtimeFor(app,'a'))!,cue=vi.spyOn(runtime.transport,'cue'),take=vi.spyOn(runtime.transport,'take'),stop=vi.spyOn(runtime.transport,'stop'),close=vi.spyOn(runtime,'close')
    await runtime.transport.cue({kind:'SOURCE',source:'ndi:SIMULATED_PREVIEW'});cue.mockClear()
    const before=runtime.transport.state().preview
    const response=await server.inject({method:'PUT',url:'/api/multiview/config',payload,headers:await baseline()})
    expect(response.statusCode).toBe(200);expect(response.json()).toMatchObject({applied:true,storedTelemetryIsHistorical:true,automaticTake:false,physicalSignalValidated:false})
    expect(app.runtimes.get('a')).toBe(runtime);expect(runtime.transport.state().preview).toEqual(before)
    for(const spy of [cue,take,stop,close])expect(spy).not.toHaveBeenCalled()
  })
  it('duas falhas reais de auditoria revertem criação e atualização',async()=>{
    for(const existing of [false,true]){
      if(existing)expect((await server.inject({method:'PUT',url:'/api/multiview/config',payload,headers:await baseline()})).statusCode).toBe(200)
      app.sqlite.exec("CREATE TRIGGER mv_audit_fail BEFORE INSERT ON operator_decisions WHEN NEW.kind='MULTIVIEW_EDITED' BEGIN SELECT RAISE(ABORT,'MV_AUDIT_FIXTURE'); END")
      const before=state(),count=notify.mock.calls.length
      expect((await server.inject({method:'PUT',url:'/api/multiview/config',payload:{...payload,layout:'GRID_1_PLUS_3'},headers:await baseline()})).statusCode).toBe(500)
      expect(state()).toEqual(before);expect(notify).toHaveBeenCalledTimes(count)
      app.sqlite.exec('DROP TRIGGER mv_audit_fail')
    }
  })
  it('falha posterior de refresh mantém applied:true e uma única gravação',async()=>{
    notify.mockImplementation(()=>{throw new Error('refresh failed')})
    const response=await server.inject({method:'PUT',url:'/api/multiview/config',payload,headers:await baseline()})
    expect(response.statusCode).toBe(200);expect(response.json()).toMatchObject({applied:true,refreshError:expect.any(String)})
    expect(state().rows).toHaveLength(1);expect(state().success).toHaveLength(1)
  })
  it('escopos global/default isolados e configuração histórica não é sinal',async()=>{
    app.db.insert(multiviewConfigs).values({id:'mv-default',channelId:'default',layout:'GRID_2X2',cells:[{id:'legacy',name:'Legacy',sourceUrl:'ndi:LEGACY',tally:'ON_AIR',syncState:'LOCKED',audioPeakDb:[-12,-12]}],updatedAt:'now'}).run()
    expect((await review(null)).json()).toMatchObject({id:null,cells:[],storedTelemetryIsHistorical:true})
    const stored=(await review('default')).json();expect(stored.physicalSignalValidated).toBe(false)
    const response=await server.inject({method:'PUT',url:'/api/multiview/config',payload:{layout:'COMPACT_LIST'},headers:await baseline(null)})
    expect(response.statusCode).toBe(200);expect(response.json().id).not.toBe('mv-default')
    expect((await review('default')).json()).toEqual(stored)
  })
  it('conta restrita não consulta/escreve global ou outro canal',async()=>{
    const cookie=account()
    expect((await review(null,cookie)).statusCode).toBe(403);expect((await review('b',cookie)).statusCode).toBe(403)
    expect((await review('a',cookie)).statusCode).toBe(200)
    const before=state()
    expect((await server.inject({method:'PUT',url:'/api/multiview/config',payload:{layout:'COMPACT_LIST'},headers:{cookie}})).statusCode).toBe(403)
    expect(state()).toEqual(before)
  })
  it.each(['disabled','role','station','channel','session'])('reconfere %s dentro da transação',async change=>{
    const cookie=account(),original=await review('a',cookie),before=state(),transaction=app.db.transaction.bind(app.db)
    vi.spyOn(app.db,'transaction').mockImplementation(((callback:any,config:any)=>{
      if(change==='disabled')app.sqlite.prepare('UPDATE users SET enabled=0').run()
      if(change==='role')app.sqlite.prepare("UPDATE users SET role='VIEWER'").run()
      if(change==='station')app.sqlite.prepare("UPDATE user_access SET station_ips='[\"192.0.2.1\"]'").run()
      if(change==='channel')app.sqlite.prepare("UPDATE user_access SET channel_ids='[\"b\"]'").run()
      if(change==='session')app.sqlite.prepare('DELETE FROM sessions').run()
      return transaction(callback,config)
    }) as typeof app.db.transaction)
    const response=await server.inject({method:'PUT',url:'/api/multiview/config',payload,headers:{cookie,'if-match':original.headers.etag as string}})
    expect(response.statusCode).toBe(403);expect(state()).toEqual(before)
  })
})
