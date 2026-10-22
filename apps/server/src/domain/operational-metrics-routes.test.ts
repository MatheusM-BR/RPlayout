import {afterEach,it,expect,vi} from 'vitest'
import Fastify from 'fastify'
import {createApp,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {sessionDigest} from './access.js'
import type {HostMetricSample} from './host-metrics.js'
let app:App|undefined,server:ReturnType<typeof Fastify>|undefined
afterEach(async()=>{await server?.close();await app?.close();vi.restoreAllMocks()})
it('histórico por canal preserva restrição global e não contamina amostra compartilhada',async()=>{
  app=await createApp(':memory:');server=Fastify();registerRoutes(app,server,()=>{})
  app.sqlite.exec("INSERT INTO users VALUES('u','MetricsAdmin','NO_LOGIN','ADMIN',1,'now')")
  app.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest('test-metrics-token'),'u','2099-01-01','now')
  app.sqlite.prepare('INSERT INTO user_access(user_id,channel_ids,station_ips,updated_at) VALUES(?,?,NULL,?)').run('u',JSON.stringify(['allowed']),new Date().toISOString())
  const sample={generatedAt:new Date().toISOString(),operations:{version:1,capturedAt:new Date().toISOString(),available:true,channelsTruncated:false,channels:[{channelId:'allowed',itemId:'public-item'},{channelId:'denied',itemId:'PRIVATE_DENIED_ITEM'}]}} as unknown as HostMetricSample
  vi.spyOn(app.hostMetrics,'latest').mockResolvedValue(sample)
  app.sqlite.prepare('INSERT INTO host_metric_samples VALUES(?,?)').run(sample.generatedAt,JSON.stringify(sample))
  const headers={cookie:'rplayout_session=test-metrics-token'}
  for(const url of ['/api/host-metrics','/api/host-metrics/history'])expect((await server.inject({url,headers})).statusCode).toBe(403)
  const response=await server.inject({url:'/api/channels/allowed/operational-metrics/history',headers});expect(response.statusCode,response.body).toBe(200);expect(response.body).toContain('public-item');expect(response.body).not.toContain('PRIVATE_DENIED_ITEM')
  expect((await server.inject({url:'/api/channels/denied/operational-metrics/history',headers})).statusCode).toBe(403)
  expect((await server.inject({url:'/api/host-metrics/history?channelId=denied',headers})).statusCode).toBe(403)
  expect(sample.operations!.channels).toHaveLength(2)
  const readPage=vi.spyOn(app.hostMetrics,'historyPage')
  expect((await server.inject({url:'/api/host-metrics/history?limit=1',headers})).statusCode).toBe(403)
  expect(readPage).not.toHaveBeenCalled()
  const until=new Date(Date.now()-1000).toISOString()
  for(let offset=0;offset<3;offset++){
    const sampledAt=new Date(Date.parse(until)-offset*1000).toISOString()
    app.sqlite.prepare('INSERT INTO host_metric_samples VALUES(?,?)').run(sampledAt,JSON.stringify({...sample,generatedAt:sampledAt}))
  }
  const first=(await server.inject({url:`/api/channels/allowed/operational-metrics/history?hours=1&limit=2&until=${encodeURIComponent(until)}`,headers})).json()
  expect(first.samples).toHaveLength(2);expect(first.totalSamples).toBe(3);expect(first.until).toBe(until);expect(first.nextBefore).toBeTruthy()
  const second=await server.inject({url:`/api/channels/allowed/operational-metrics/history?hours=1&limit=2&until=${encodeURIComponent(until)}&before=${encodeURIComponent(first.nextBefore)}`,headers})
  expect(second.statusCode).toBe(200);expect(second.json().samples).toHaveLength(1);expect(second.json().nextBefore).toBeNull();expect(second.body).not.toContain('PRIVATE_DENIED_ITEM')
  const timestamps=[...first.samples,...second.json().samples].map(row=>row.sampledAt)
  expect(new Set(timestamps).size).toBe(3)
  for(const query of [`before=${encodeURIComponent(until)}`,`until=invalid`,`until=${encodeURIComponent(until)}&before=invalid`,`until=${encodeURIComponent(new Date(Date.now()+60000).toISOString())}`]){
    expect((await server.inject({url:`/api/channels/allowed/operational-metrics/history?${query}`,headers})).statusCode).toBe(400)
  }
})
it('pagina histórico global sem duplicar, incluir coletas novas ou deslocar janela após retenção',async()=>{
  app=await createApp(':memory:');server=Fastify();registerRoutes(app,server,()=>{})
  app.sqlite.exec("INSERT INTO users VALUES('global-metrics','GlobalMetrics','NO_LOGIN','ADMIN',1,'now')")
  app.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest('global-metrics-token'),'global-metrics','2099-01-01','now')
  const headers={cookie:'rplayout_session=global-metrics-token'},until=new Date(Date.now()-2000).toISOString()
  const stamps=Array.from({length:5},(_,index)=>new Date(Date.parse(until)-index*1000).toISOString())
  for(const generatedAt of stamps)app.sqlite.prepare('INSERT INTO host_metric_samples VALUES(?,?)').run(generatedAt,JSON.stringify({generatedAt,cpu:{percent:null},operations:{version:1,available:true,channelsTruncated:false,channels:[]}}))
  const query=`hours=1&limit=2&until=${encodeURIComponent(until)}`
  const firstResponse=await server.inject({url:'/api/host-metrics/history?'+query,headers})
  expect(firstResponse.statusCode,firstResponse.body).toBe(200)
  const first=firstResponse.json();expect(first.samples.map((row:any)=>row.generatedAt)).toEqual(stamps.slice(0,2));expect(first.totalSamples).toBe(5);expect(first.until).toBe(until)
  const newer=new Date(Date.parse(until)+1000).toISOString()
  app.sqlite.prepare('INSERT INTO host_metric_samples VALUES(?,?)').run(newer,JSON.stringify({generatedAt:newer}))
  const second=(await server.inject({url:'/api/host-metrics/history?'+query+'&before='+encodeURIComponent(first.nextBefore),headers})).json()
  expect(second.samples.map((row:any)=>row.generatedAt)).toEqual(stamps.slice(2,4));expect(second.totalSamples).toBe(5);expect(second.since).toBe(first.since)
  const last=(await server.inject({url:'/api/host-metrics/history?'+query+'&before='+encodeURIComponent(second.nextBefore),headers})).json()
  expect(last.samples.map((row:any)=>row.generatedAt)).toEqual(stamps.slice(4));expect(last.nextBefore).toBeNull()
  expect(new Set([...first.samples,...second.samples,...last.samples].map(row=>row.generatedAt)).size).toBe(5)
  // Simulated expiry affects availability, never moves the query or re-collects.
  app.sqlite.prepare('DELETE FROM host_metric_samples WHERE sampled_at<?').run(first.nextBefore)
  const collect=vi.spyOn(app.hostMetrics,'latest')
  const expired=(await server.inject({url:'/api/host-metrics/history?'+query+'&before='+encodeURIComponent(first.nextBefore),headers})).json()
  expect(expired.samples).toEqual([]);expect(expired.nextBefore).toBeNull();expect(expired.until).toBe(until);expect(expired.since).toBe(first.since);expect(expired.totalSamples).toBe(2);expect(collect).not.toHaveBeenCalled()
  for(const invalid of ['before='+encodeURIComponent(until),'until=invalid',query+'&before=invalid',query+'&before='+encodeURIComponent(first.since),'until='+encodeURIComponent(new Date(Date.now()+60000).toISOString()),'limit=5001'])expect((await server.inject({url:'/api/host-metrics/history?'+invalid,headers})).statusCode).toBe(400)
})
