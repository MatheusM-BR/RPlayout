import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import Fastify from 'fastify'
import {createApp,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {sessionDigest} from './access.js'
import {ClockMonitor} from './clock-monitor.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:''}))
let app:App,server:ReturnType<typeof Fastify>
const headers={cookie:'rplayout_session=clock-fixture-token'}
beforeEach(async()=>{
  app=await createApp(':memory:');server=Fastify();registerRoutes(app,server,()=>{})
  app.sqlite.exec("INSERT INTO users VALUES('u','Operador','NO_LOGIN','OPERATOR',1,'now')")
  app.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest('clock-fixture-token'),'u','2099-01-01','now')
  app.sqlite.prepare('INSERT INTO user_access(user_id,channel_ids,station_ips,updated_at) VALUES(?,?,NULL,?)').run('u','["a"]','now')
})
afterEach(async()=>{await server.close();await app.close()})
it('GET /api/clock exige sessão e devolve estado, servidores, plataforma e limiares',async()=>{
  expect((await server.inject({url:'/api/clock'})).statusCode).toBe(401)
  const before=await server.inject({url:'/api/clock',headers})
  expect(before.statusCode,before.body).toBe(200);expect(before.json()).toMatchObject({state:'UNVERIFIED',checkedAt:null,offsetMs:null})
  const monitor=new ClockMonitor(app.db,{servers:['s1','s2']},{query:async server=>({offsetMs:server==='s1'?12:14,rttMs:6,stratum:2}),exec:async()=>{throw new Error('x')},emit:vi.fn(async()=>{}) as never})
  ;(app as {clockMonitor:ClockMonitor}).clockMonitor=monitor
  await monitor.round()
  const response=await server.inject({url:'/api/clock',headers})
  expect(response.statusCode).toBe(200);expect(response.headers['cache-control']).toBe('private, no-store')
  const body=response.json()
  expect(body).toMatchObject({state:'OK',offsetMs:13,rttMs:6,thresholds:{warnMs:50,criticalMs:500},servers:[{host:'s1',offsetMs:12,rttMs:6,stratum:2,ok:true},{host:'s2',ok:true}]})
  expect(Date.parse(body.checkedAt)).not.toBeNaN();expect(body.platform).toMatchObject({platform:process.platform})
  monitor.close()
})
