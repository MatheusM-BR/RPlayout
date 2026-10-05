import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createApp, runtimeFor, type App } from '../app.js'
import { registerRoutes } from '../routes.js'
import { channels, rundowns, rundownItems, mediaAssets, users, sessions } from '../db/schema.js'
import { reviewedPublish } from './test-operational-review.js'
import { sessionDigest } from './access.js'

vi.mock('../config.js', async original => ({ ...await original<Record<string,unknown>>(), ENGINE_BINARY:'', MEDIAMTX_BINARY:'', DEVICES_BINARY:'', AUTH_USER:'', AUTH_PASSWORD:'', DEFAULT_ROLE:'ADMIN' }))
let app: App, server: FastifyInstance
beforeEach(async()=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date(2026,8,30,23,59,58))
  app=await createApp(':memory:');const stamp=new Date().toISOString()
  app.db.insert(channels).values({id:'ch',name:'Virada QA',rateNum:25,rateDen:1,width:320,height:180,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:stamp}).run()
  app.db.insert(rundowns).values({id:'rd',channelId:'ch',name:'Grade original',date:'2026-09-30',plannedStart:(24*3600-2)*25,loop:false,publicationRequired:true,createdAt:stamp,updatedAt:stamp}).run()
  app.db.insert(mediaAssets).values({id:'asset',path:'C:/fixture/clip.mp4',title:'VT',kind:'VIDEO',contentHash:'a'.repeat(64),durationFrames:6000,durationNs:240_000_000_000,rateNum:25,rateDen:1,qcStatus:'APPROVED',createdAt:stamp}).run()
  for(const [order,id] of ['pgm','next'].entries())app.db.insert(rundownItems).values({id,rundownId:'rd',sortOrder:order,title:id,type:'VT',mediaId:'asset',durationOverride:6000,minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',autoNext:true,loop:false,locked:false}).run()
  const runtime=(await runtimeFor(app,'ch'))!;await runtime.load('rd')
  server=Fastify();registerRoutes(app,server,()=>{});await server.ready()
})
afterEach(async()=>{await server.close();app.close();vi.useRealTimers()})
const status=async()=>{const res=await server.inject('/api/scheduler/status');expect(res.statusCode,res.body).toBe(200);return res.json().channels[0]}
async function play(){const published=await reviewedPublish(server,'rd');expect(published.statusCode,published.body).toBe(201);const runtime=app.runtimes.get('ch')!;await runtime.transport.take('rd','pgm');await runtime.transport.cue({kind:'ITEM',id:'next'});await runtime.refresh();return runtime}
describe('relógio e horizonte HTTP usam a execução congelada',()=>{
  it('consulta não chama montagem, não publica nem passa grade sem revisão como execução',async()=>{
    const counts=app.sqlite.prepare('SELECT count(*) n FROM operator_decisions').get()
    expect(await status()).toMatchObject({source:'NONE',mode:'NO_EXECUTION',minutesRemaining:null,coverageReady:false,automaticHandover:false})
    expect(app.sqlite.prepare('SELECT count(*) n FROM operator_decisions').get()).toEqual(counts)
  })
  it('PGM/CUE e duração atravessam meia-noite, com clocks >24h em grade e timeline',async()=>{
    const runtime=await play(), before=runtime.transport.state()
    vi.setSystemTime(new Date(2026,9,1,0,0,2));await runtime.refresh()
    const result=await status()
    expect(result).toMatchObject({source:'PUBLISHED',rundownDate:'2026-09-30',mode:'FINITE',minutesRemaining:7,coverageReady:false})
    expect(result.nowFrames).toBe((24*3600+2)*25)
    expect(runtime.transport.state()).toMatchObject({onAir:{itemId:'pgm',elapsed:100,startedAt:before.onAir?.startedAt},preview:before.preview})
    expect(runtime.executionView?.schedule.items[0]?.start).toBe((24*3600-2)*25)
    expect(runtime.live().now).toBe(result.nowFrames)
    const timeline=(await server.inject('/api/channels/ch/timeline')).json()
    expect(timeline.nowFrames).toBe(result.nowFrames)
    const multi=(await server.inject('/api/v1/timeline/rd/multitrack')).json()
    expect(multi.currentPlayheadFrames).toBe(result.nowFrames)
  })
  it('mudar data/duração editorial não prolonga cobertura publicada nem corta PGM/CUE',async()=>{
    const runtime=await play(), before=runtime.transport.state(), publishedId=runtime.operationalRevision?.id
    vi.setSystemTime(new Date(2026,9,1,0,0,2))
    app.db.update(rundowns).set({date:'2026-10-02'}).where(eq(rundowns.id,'rd')).run()
    app.db.update(rundownItems).set({durationOverride:49*3600*25}).where(eq(rundownItems.id,'next')).run()
    await runtime.refresh()
    expect(runtime.view?.rundown.date).toBe('2026-10-02')
    expect(await status()).toMatchObject({revisionId:publishedId,rundownDate:'2026-09-30',minutesRemaining:7,coverageReady:false})
    const browsing=(await server.inject('/api/rundowns/rd')).json()
    expect(browsing.view.rundown.date).toBe('2026-10-02')
    expect(browsing.executionView.rundown.date).toBe('2026-09-30')
    expect(runtime.transport.state()).toMatchObject({onAir:{itemId:'pgm',elapsed:100,startedAt:before.onAir?.startedAt},preview:before.preview})
  })
  it('status não revela canal sem permissão ao operador autenticado',async()=>{
    const stamp=new Date().toISOString()
    app.db.insert(channels).values({id:'other',name:'Privado',rateNum:25,rateDen:1,width:320,height:180,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:stamp}).run()
    await runtimeFor(app,'other')
    app.db.insert(users).values({id:'operator',username:'operator',passwordHash:'not-used',role:'OPERATOR',enabled:true,createdAt:stamp}).run()
    app.db.insert(sessions).values({token:sessionDigest('horizon-scope'),userId:'operator',expiresAt:new Date(Date.now()+60_000).toISOString(),createdAt:stamp}).run()
    app.sqlite.prepare('INSERT INTO user_access VALUES (?,?,?,?)').run('operator',JSON.stringify(['ch']),null,stamp)
    const result=await server.inject({url:'/api/scheduler/status',headers:{cookie:'rplayout_session=horizon-scope'}})
    expect(result.statusCode,result.body).toBe(200);expect(result.json().channels.map((row:any)=>row.channelId)).toEqual(['ch'])
  })
  it('data impossível é rejeitada; novo canal e lista do dia usam dia local, não UTC',async()=>{
    const before=app.db.select().from(rundowns).all().length
    const invalid=await server.inject({method:'POST',url:'/api/channels/ch/rundowns',payload:{date:'2026-02-30'}})
    expect(invalid.statusCode,invalid.body).toBe(400);expect(app.db.select().from(rundowns).all()).toHaveLength(before)
    const created=await server.inject({method:'POST',url:'/api/channels',payload:{name:'Noite local'}})
    expect(created.statusCode,created.body).toBe(200)
    expect(app.db.select().from(rundowns).where(eq(rundowns.id,created.json().rundownId)).get()?.date).toBe('2026-09-30')
    expect((await server.inject('/api/playlists')).json().date).toBe('2026-09-30')
  })
})
