import Fastify,{type FastifyInstance} from 'fastify'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {createApp,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {sessionDigest} from './access.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',RELAY_BINARY:'',DEVICES_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
let app:App,server:FastifyInstance,changed:ReturnType<typeof vi.fn>
const path='/api/categories/'+encodeURIComponent('AÇÃO Çãó')
beforeEach(async()=>{app=await createApp(':memory:');server=Fastify();changed=vi.fn();registerRoutes(app,server,changed);await server.ready()})
afterEach(async()=>{await server.close();await app.flush();app.close()})
it('GET não grava; PUT cego428; dois PUT somente um commit',async()=>{
  const read=await server.inject(path+'/review');expect(read.statusCode).toBe(200);expect(read.headers['cache-control']).toBe('private, no-store');expect(changed).not.toHaveBeenCalled()
  expect((await server.inject({url:path,method:'PUT',payload:{color:'#112233'}})).statusCode).toBe(428)
  const responses=await Promise.all([1,2].map(()=>server.inject({url:path,method:'PUT',headers:{'if-match':read.headers.etag!},payload:{color:'#112233'}})))
  expect(responses.map(row=>row.statusCode).sort()).toEqual([200,409]);expect(changed).toHaveBeenCalledOnce()
  expect(app.sqlite.prepare("SELECT COUNT(*) n FROM operator_decisions WHERE kind='CATEGORY_COLOR_CHANGED'").get()).toEqual({n:1})
})
it('falha pós-commit retorna applied e aviso, nunca finge rollback',async()=>{
  const read=await server.inject(path+'/review');changed.mockImplementation(()=>{throw new Error('callback failed')})
  const result=await server.inject({url:path,method:'PUT',headers:{'if-match':read.headers.etag!},payload:{color:'#112233'}})
  expect(result.statusCode).toBe(200);expect(result.json()).toMatchObject({applied:true,color:'#112233'});expect(result.json().refreshError).toContain('gravada')
})
it('rota parametrizada compartilhada permite só conferência ao usuário limitado, sem abrir recursos globais',async()=>{
  app.sqlite.exec("INSERT INTO users VALUES('limited','Limited','NO_LOGIN','ADMIN',1,'now')")
  app.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest('CATEGORY_LIMITED_TOKEN'),'limited','2099-01-01','now')
  app.sqlite.prepare('INSERT INTO user_access VALUES(?,?,NULL,?)').run('limited',JSON.stringify(['allowed']),'now')
  app.sqlite.prepare("INSERT INTO media_assets(id,content_hash,path,title,kind,duration_frames,category_id,created_at) VALUES('asset','PRIVATE_HASH','PRIVATE_PATH','PRIVATE_TITLE','VIDEO',25,?,'now')").run('AÇÃO Çãó')
  app.sqlite.exec("INSERT INTO channels(id,name,width,height,rate_num,rate_den,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES('denied','PRIVATE_CHANNEL',320,180,25,1,-23,-1,5,'now'); INSERT INTO rundowns(id,channel_id,name,date,planned_start,created_at,updated_at) VALUES('rd-denied','denied','PRIVATE_RUNDOWN','2099-01-01',0,'now','now')")
  const headers={cookie:'rplayout_session=CATEGORY_LIMITED_TOKEN'},before={revision:app.sqlite.prepare('SELECT * FROM category_revision').all(),categories:app.sqlite.prepare('SELECT * FROM categories').all(),links:app.sqlite.prepare('SELECT category_id FROM media_assets').all()}
  const read=await server.inject({url:path+'/review',headers})
  expect(read.statusCode,read.body).toBe(200);expect(read.json()).toMatchObject({canEdit:false,stored:false,items:1})
  expect(read.headers['cache-control']).toBe('private, no-store');expect(read.headers.etag).toBeTruthy();expect(read.body).not.toContain('PRIVATE_')
  const head=await server.inject({url:path+'/review',method:'HEAD',headers});expect(head.statusCode).toBe(200);expect(head.body).toBe('')
  for(const method of ['PUT','DELETE'] as const)expect((await server.inject({url:path,method,headers:{...headers,'if-match':read.headers.etag!},...(method==='PUT'?{payload:{color:'#ffffff'}}:{})})).statusCode).toBe(403)
  expect((await server.inject({url:'/api/host-metrics/history',headers})).statusCode).toBe(403)
  expect((await server.inject({url:'/api/rundowns/rd-denied',headers})).statusCode).toBe(403)
  expect((await server.inject({url:path+'/review'})).statusCode).toBe(401)
  expect({revision:app.sqlite.prepare('SELECT * FROM category_revision').all(),categories:app.sqlite.prepare('SELECT * FROM categories').all(),links:app.sqlite.prepare('SELECT category_id FROM media_assets').all()}).toEqual(before)
  expect(app.sqlite.prepare("SELECT COUNT(*) n FROM operator_decisions WHERE kind IN ('CATEGORY_COLOR_CHANGED','CATEGORY_REMOVED')").get()).toEqual({n:0})
  expect(changed).not.toHaveBeenCalled()
})
