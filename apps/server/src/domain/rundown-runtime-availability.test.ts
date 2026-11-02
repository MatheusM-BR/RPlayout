import Fastify,{type FastifyInstance} from 'fastify'
import {afterEach,beforeEach,it,expect,vi} from 'vitest'
import {createApp,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
vi.mock('../app.js',async original=>({...await original<Record<string,unknown>>(),runtimeFor:vi.fn(async()=>null)}))
let app:App,server:FastifyInstance
beforeEach(async()=>{
  app=await createApp(':memory:')
  app.sqlite.exec("INSERT INTO channels(id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES('ch','QA',25,1,320,180,-23,-1,5,'now'); INSERT INTO rundowns(id,channel_id,name,planned_start,date,created_at,updated_at) VALUES('rd','ch','Grade',0,'2026-10-14','now','now')")
  server=Fastify();registerRoutes(app,server,()=>{});await server.ready()
})
afterEach(async()=>{await server.close();await app.close()})
it('existing rundown with unavailable runtime reports conflict, without editing items',async()=>{
  const response=await server.inject({method:'POST',url:'/api/rundowns/rd/items',payload:{type:'VT',mediaId:'missing'}})
  expect(response.statusCode).toBe(409)
  expect(response.json().code).toBe('CHANNEL_RUNTIME_UNAVAILABLE')
  expect(response.json().message).toContain('A grade existe')
  expect(app.sqlite.prepare('SELECT count(*) AS count FROM rundown_items').get()).toEqual({count:0})
})
it('actually absent rundown remains not found',async()=>{
  const response=await server.inject({method:'POST',url:'/api/rundowns/absent/items',payload:{type:'VT',mediaId:'missing'}})
  expect(response.statusCode).toBe(404)
})
