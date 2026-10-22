import Fastify,{type FastifyInstance} from 'fastify'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {createApp,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',RELAY_BINARY:'',DEVICES_BINARY:'',PROXY_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
let app:App,server:FastifyInstance
beforeEach(async()=>{
  app=await createApp(':memory:');server=Fastify();registerRoutes(app,server,()=>{});await server.ready()
  app.sqlite.exec("INSERT INTO media_assets(id,content_hash,path,title,kind,duration_frames,created_at) VALUES('a','hash','fixture.mp4','Fixture','VIDEO',25,'now');INSERT INTO media_versions(id,asset_id,revision,content_hash,metadata,created_at) VALUES('v','a',1,'hash','{}','now');INSERT INTO media_jobs(id,version_id,kind,state,error,created_at,updated_at) VALUES('j','v','PROXY','FAILED','Trabalho legado sem responsável identificável. Confira se o servidor anterior encerrou antes de solicitar nova tentativa.','now','now')")
})
afterEach(async()=>{await server.close();await app.flush();app.close()})
const retry=(payload:object)=>server.inject({method:'POST',url:'/api/media/jobs/j/retry',payload})
it('diagnóstico não revela identidade e retry legado exige confirmação explícita',async()=>{
  const body=(await server.inject('/api/media/jobs')).json()
  expect(body.jobs[0].retryRequiresConfirmation).toBe(true);expect(body.jobs[0]).not.toHaveProperty('owner_host');expect(body.jobs[0]).not.toHaveProperty('owner_pid')
  expect((await retry({})).statusCode).toBe(409)
  expect(app.sqlite.prepare('SELECT state,attempts FROM media_jobs').get()).toEqual({state:'FAILED',attempts:0})
  expect((await retry({confirmedPreviousStopped:true})).statusCode).toBe(200)
})
it('confirmar não toma job RUNNING remoto nem encerra processo',async()=>{
  app.sqlite.exec("UPDATE media_jobs SET state='RUNNING',owner_host='foreign',owner_pid=2147483647,owner_boot='foreign'")
  expect((await retry({confirmedPreviousStopped:true})).statusCode).toBe(409)
  expect(app.sqlite.prepare('SELECT state,owner_boot FROM media_jobs').get()).toEqual({state:'RUNNING',owner_boot:'foreign'})
})
it('recusa confirmação adulterada ou force',async()=>{
  for(const payload of [{confirmedPreviousStopped:'yes'},{force:true}])expect((await retry(payload)).statusCode).toBe(400)
})
