import Fastify from 'fastify'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {eq} from 'drizzle-orm'
import {createApp,runtimeFor,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {channels,rundowns,rundownItems,operationalPlaylistRevisions} from '../db/schema.js'
import {reviewedPublish} from './test-operational-review.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
let app:App,server:ReturnType<typeof Fastify>
beforeEach(async()=>{
  app=await createApp(':memory:');const now=new Date().toISOString()
  for(const id of ['ch','other'])app.db.insert(channels).values({id,name:id,width:320,height:180,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:now}).run()
  app.db.insert(rundowns).values({id:'rd',channelId:'ch',name:'Grade',date:'2026-10-09',plannedStart:0,loop:false,createdAt:now,updatedAt:now}).run()
  await (await runtimeFor(app,'ch'))!.load('rd')
  server=Fastify();registerRoutes(app,server,()=>{});await server.ready()
})
afterEach(async()=>{await server?.close();await app?.close();vi.restoreAllMocks()})
async function source(name:string,channelId='ch'){
  const review=await server.inject(`/api/channels/${channelId}/live-source-review`)
  const response=await server.inject({method:'POST',url:'/api/sources/live',headers:{'if-match':review.headers.etag as string},payload:{channelId,name,kind:'NDI',targetUrl:'ndi:CAM'}})
  expect(response.statusCode,response.body).toBe(201);return response.json() as {id:string}
}
async function insert(id:string,sourceRef='ndi:CAM'){
  return server.inject({method:'POST',url:'/api/rundowns/rd/items',headers:{'if-match':app.concurrency.generateETag('rd')},payload:{type:'LIVE',sourceRef,configuredSourceId:id,durationOverride:250}})
}
it('CRUD e inserção preservam o segundo cadastro e seu nome mesmo no mesmo endpoint',async()=>{
  await source('Estúdio São José');const selected=await source('Estúdio Óscar')
  const response=await insert(selected.id);expect(response.statusCode,response.body).toBe(200)
  const item=app.db.select().from(rundownItems).get()!
  expect(item).toMatchObject({configuredSourceId:selected.id,title:'Estúdio Óscar',sourceRef:'ndi:CAM'})
  const published=await reviewedPublish(server,'rd');expect(published.statusCode,published.body).toBe(201)
  const frozen=app.db.select().from(operationalPlaylistRevisions).get()!.payload as {items:Array<{configuredSourceId:string;title:string}>}
  expect(frozen.items[0]).toMatchObject({configuredSourceId:selected.id,title:'Estúdio Óscar'})
})
it('recusa cadastro de outro canal ou conexão divergente sem inserir item nem expor nome',async()=>{
  const foreign=await source('PRIVATE_OTHER_CHANNEL','other'),own=await source('Entrada própria')
  const denied=await insert(foreign.id);expect(denied.statusCode,denied.body).toBe(400);expect(denied.body).not.toContain('PRIVATE_OTHER_CHANNEL')
  const changed=await insert(own.id,'ndi:OTHER');expect(changed.statusCode,changed.body).toBe(409)
  expect(app.db.select().from(rundownItems).all()).toEqual([])
})
it('editar a conexão desvincula cadastro e altera a referência executável sem mudar publicação anterior',async()=>{
  const selected=await source('Entrada própria');expect((await insert(selected.id)).statusCode).toBe(200)
  const item=app.db.select().from(rundownItems).get()!,published=await reviewedPublish(server,'rd')
  expect(published.statusCode,published.body).toBe(201)
  const revision=app.db.select().from(operationalPlaylistRevisions).get()!,oldPayload=JSON.stringify(revision.payload)
  const changed=await server.inject({method:'PATCH',url:`/api/items/${item.id}`,headers:{'if-match':app.concurrency.generateETag('rd')},payload:{liveEndpoint:'ndi:OTHER'}})
  expect(changed.statusCode,changed.body).toBe(200)
  expect(app.db.select().from(rundownItems).where(eq(rundownItems.id,item.id)).get()).toMatchObject({configuredSourceId:null,sourceRef:'ndi:OTHER',liveEndpoint:'ndi:OTHER'})
  expect(JSON.stringify(app.db.select().from(operationalPlaylistRevisions).where(eq(operationalPlaylistRevisions.id,revision.id)).get()!.payload)).toBe(oldPayload)
})
