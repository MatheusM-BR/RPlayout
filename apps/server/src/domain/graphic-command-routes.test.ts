import Fastify from 'fastify'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {createApp,runtimeFor,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',RELAY_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
let app:App,server:ReturnType<typeof Fastify>
beforeEach(async()=>{
  app=await createApp(':memory:');server=Fastify();registerRoutes(app,server,()=>{})
  for(const id of ['a','b'])app.sqlite.prepare('INSERT INTO channels(id,name,width,height,rate_num,rate_den,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES(?,?,320,180,25,1,-23,-1,5,?)').run(id,id,'now')
})
afterEach(async()=>{await server.close();await app.close()})
const trigger=(payload:object)=>server.inject({method:'POST',url:'/api/v1/graphics/layers/LOWER_THIRD/trigger',payload})
it('canal explícito obrigatório, extras recusados, simulação identificada sem prova física',async()=>{
  expect((await trigger({action:'SHOW'})).statusCode).toBe(400)
  expect((await trigger({channelId:'a',action:'SHOW',extra:true})).statusCode).toBe(400)
  const response=await trigger({channelId:'a',action:'SHOW',name:'Estúdio Çãó'})
  expect(response.statusCode).toBe(200);expect(response.json()).toMatchObject({confirmation:'SIMULATED',physicalOutputValidated:false,layerState:{active:true}})
})
it('template inexistente e de outro canal não substituem a camada',async()=>{
  await trigger({channelId:'a',action:'SHOW',name:'Original'})
  expect((await trigger({channelId:'a',templateId:'missing'})).statusCode).toBe(404)
  app.sqlite.prepare('INSERT INTO graphic_templates(id,channel_id,name,svg,fields,hold_seconds,fade_ms,created_at) VALUES(?,?,?,?,?,?,?,?)').run('other','b','Other','<svg/>','[]',null,0,'now')
  expect((await trigger({channelId:'a',templateId:'other'})).statusCode).toBe(403)
  expect((await runtimeFor(app,'a'))!.graphics.onAir()?.name).toBe('Original')
})
it('slate ativo ou pendente bloqueia tanto camada quanto retirada manual',async()=>{
  const runtime=(await runtimeFor(app,'a'))!
  for(const pending of [true,false]){
    runtime.emergencyCommandPending=pending;runtime.emergencyOverlay=!pending
    expect((await trigger({channelId:'a',action:'SHOW'})).statusCode).toBe(409)
    expect((await server.inject({method:'DELETE',url:'/api/channels/a/graphic'})).statusCode).toBe(409)
    expect(runtime.graphics.onAir()).toBeNull()
  }
})
it('recibo simulado é deduplicado; histórico do canal não expõe valores do pedido',async()=>{
  const runtime=(await runtimeFor(app,'a'))!,work=vi.spyOn(runtime.graphics,'triggerLayerConfirmed')
  const request={method:'POST' as const,url:'/api/v1/graphics/layers/LOWER_THIRD/trigger',headers:{'idempotency-key':'own-stable-key'},payload:{channelId:'a',action:'SHOW',payload:{title:'PRIVATE_FIELD_VALUE'}}}
  const first=await server.inject(request),repeat=await server.inject(request)
  expect(first.statusCode).toBe(200);expect(repeat.json().graphicCommand).toMatchObject({state:'SIMULATED',replayed:true});expect(work).toHaveBeenCalledTimes(1)
  const history=await server.inject({method:'GET',url:'/api/channels/a/graphic-commands'})
  expect(history.json().commands).toHaveLength(1);expect(history.body).not.toContain('PRIVATE_FIELD_VALUE')
  const other=await server.inject({method:'GET',url:'/api/channels/b/graphic-commands'});expect(other.json().commands).toEqual([])
})
