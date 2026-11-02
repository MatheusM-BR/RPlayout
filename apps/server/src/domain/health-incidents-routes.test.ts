import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import Fastify from 'fastify'
import {createApp,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {sessionDigest} from './access.js'
import {healthEvents} from '../db/schema.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:''}))
let app:App,server:ReturnType<typeof Fastify>
const headers={cookie:'rplayout_session=incident-fixture-token'}
beforeEach(async()=>{
  app=await createApp(':memory:');server=Fastify();registerRoutes(app,server,()=>{})
  app.sqlite.exec("INSERT INTO users VALUES('u','Supervisor','NO_LOGIN','SUPERVISOR',1,'now')")
  app.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest('incident-fixture-token'),'u','2099-01-01','now')
  app.sqlite.prepare('INSERT INTO user_access(user_id,channel_ids,station_ips,updated_at) VALUES(?,?,NULL,?)').run('u','["a"]','now')
  for(const [id,channelId]of [['allowed','a'],['denied','b'],['global',null]] as const)app.db.insert(healthEvents).values({id,channelId,component:'ENGINE',state:'FAILED',message:id,occurredAt:'2026-10-10T00:00:00.000Z'}).run()
})
afterEach(async()=>{await server.close();await app.close()})
it('lista e CSV agregados deixam somente incidentes dos canais autorizados',async()=>{
  for(const url of ['/api/health-events?limit=1','/api/health-events.csv']){
    const response=await server.inject({url,headers});expect(response.statusCode,response.body).toBe(200)
    expect(response.headers['cache-control']).toBe('private, no-store');expect(response.body).toContain('allowed');expect(response.body).not.toContain('denied');expect(response.body).not.toContain('global')
  }
  expect((await server.inject({url:'/api/health-events?channelId=b',headers})).statusCode).toBe(403)
})
it('reconhecimento é auditado, idempotente e sem confirmação de recuperação',async()=>{
  const request={method:'POST' as const,url:'/api/health-events/allowed/ack',headers,payload:{}}
  const first=await server.inject(request);expect(first.statusCode,first.body).toBe(200);expect(first.json()).toMatchObject({deduplicated:false,signalRecovered:false})
  const replay=await server.inject(request);expect(replay.json()).toEqual({...first.json(),deduplicated:true})
  const rows=app.sqlite.prepare("SELECT actor_username,payload FROM operator_decisions WHERE kind='HEALTH_EVENT_ACKNOWLEDGED'").all()
  expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({actor_username:'Supervisor'})
})
it('query de canal não permite reconhecer outro canal nem alerta global',async()=>{
  for(const id of ['denied','global'])expect((await server.inject({method:'POST',url:`/api/health-events/${id}/ack?channelId=a`,headers,payload:{}})).statusCode).toBe(403)
  expect((await server.inject({method:'POST',url:'/api/health-events/missing/ack?channelId=a',headers,payload:{}})).statusCode).toBe(404)
})
it('falha de auditoria responde sem gravar reconhecimento',async()=>{
  app.sqlite.exec("CREATE TRIGGER deny_health_audit BEFORE INSERT ON operator_decisions WHEN NEW.kind='HEALTH_EVENT_ACKNOWLEDGED' BEGIN SELECT RAISE(ABORT,'fixture_failure'); END")
  const response=await server.inject({method:'POST',url:'/api/health-events/allowed/ack',headers,payload:{}})
  expect(response.statusCode).toBe(409);expect(app.sqlite.prepare('SELECT acknowledged_at FROM health_events WHERE id=?').get('allowed')).toEqual({acknowledged_at:null})
})
it('página HTTP mostra o mais recente, filtra no servidor e não permite cursor de canal alheio',async()=>{
  for(let i=0;i<35;i++)app.db.insert(healthEvents).values({id:`page-${String(i).padStart(3,'0')}`,channelId:'a',component:'SIGNAL',state:'black',severity:'CRITICAL',occurredAt:'2026-10-10T01:00:00.000Z'}).run()
  const first=await server.inject({url:'/api/health-events?channelId=a&limit=30&severity=CRITICAL&acknowledgement=PENDING',headers})
  expect(first.statusCode,first.body).toBe(200);expect(first.json().events[0].id).toBe('page-034');expect(first.json().pending.critical).toBe(35)
  const {until,nextBefore}=first.json().page
  const query=new URLSearchParams({channelId:'a',limit:'30',severity:'CRITICAL',acknowledgement:'PENDING',until,beforeAt:nextBefore.occurredAt,beforeId:nextBefore.id})
  const second=await server.inject({url:'/api/health-events?'+query,headers});expect(second.statusCode,second.body).toBe(200)
  expect(second.json().events).toHaveLength(5);expect(second.json().page.hasMore).toBe(false)
  query.set('channelId','b');expect((await server.inject({url:'/api/health-events?'+query,headers})).statusCode).toBe(403)
})
it('cursor malformado e filtro desconhecido respondem 400 sem expor diagnóstico do banco',async()=>{
  for(const query of ['beforeId=allowed','until=invalid','severity=BAD','acknowledgement=BAD']){
    const response=await server.inject({url:'/api/health-events?'+query,headers});expect(response.statusCode,response.body).toBe(400);expect(response.body).not.toContain('SQLITE')
  }
})
it('pendências: sem sessão 401, canal negado 403, canal permitido lista com nível e forMe', async () => {
  const old = new Date(Date.now() - 3 * 60_000).toISOString()
  for (const [id, channelId] of [['pgm-signal:a1:active', 'a'], ['pgm-signal:b1:active', 'b']] as const)
    app.db.insert(healthEvents).values({ id, channelId, component: 'SIGNAL', state: 'black', severity: 'CRITICAL', occurredAt: old }).run()
  // Incidente de execução anterior (observação encerrada por reinício): fica no painel, não na caixa de escalonamento.
  app.db.insert(healthEvents).values({ id: 'pgm-signal:a0:active', channelId: 'a', component: 'SIGNAL', state: 'silence', severity: 'CRITICAL', occurredAt: old, observationEndedAt: old }).run()
  expect((await server.inject({ url: '/api/notifications' })).statusCode).toBe(401)
  expect((await server.inject({ url: '/api/notifications?channelId=b', headers })).statusCode).toBe(403)
  for (const url of ['/api/notifications?channelId=a', '/api/notifications']) {
    const response = await server.inject({ url, headers }); expect(response.statusCode, response.body).toBe(200)
    expect(response.headers['cache-control']).toBe('private, no-store')
    const { notifications } = response.json() as { notifications: Array<{ id: string; tier: string; forMe: boolean; minutesOpen: number }> }
    expect(notifications.map(row => row.id)).toEqual(['pgm-signal:a1:active'])
    expect(notifications[0]).toMatchObject({ tier: 'SUPERVISOR', forMe: true, minutesOpen: 3 })
  }
})
