import Fastify from 'fastify'
import {describe,it,expect,vi} from 'vitest'
import {randomUUID} from 'node:crypto'
import {createApp} from '../app.js'
import {registerRoutes} from '../routes.js'
import {channels,rundowns,operatorDecisions} from '../db/schema.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
describe('HTTP receipt query does not replay compensation',()=>{
 it('returns scoped historical commit, no-store and absence without mutations',async()=>{
  const app=await createApp(':memory:'),server=Fastify(),id=randomUUID(),now=new Date().toISOString()
  try{
   app.db.insert(channels).values({id:'ch',name:'Receipt',rateNum:25,rateDen:1,width:320,height:180,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:now}).run()
   app.db.insert(rundowns).values({id:'rd',channelId:'ch',name:'Receipt',date:'2026-10-12',plannedStart:0,loop:false,createdAt:now,updatedAt:now}).run()
   app.db.insert(operatorDecisions).values({id:`operational-compensation:${id}`,rundownId:'rd',kind:'OPERATIONAL_COMPENSATION',actorUsername:null,createdAt:now,payload:{revision:2}}).run()
   registerRoutes(app,server,()=>{throw new Error('Read must not broadcast a mutation')});await server.ready()
   const before=app.db.select().from(operatorDecisions).all()
   const response=await server.inject(`/api/channels/ch/compensation/${id}`)
   expect(response.statusCode,response.body).toBe(200)
   expect(response.headers['cache-control']).toBe('private, no-store')
   expect(response.json()).toMatchObject({state:'RECORDED',revision:2,currentExecutionObserved:false})
   expect((await server.inject(`/api/channels/ch/compensation/${randomUUID()}`)).json().state).toBe('NOT_RECORDED')
   expect((await server.inject('/api/channels/ch/compensation/invalid')).statusCode).toBe(400)
   expect(app.db.select().from(operatorDecisions).all()).toEqual(before)
  }finally{await server.close();app.close()}
 })
})
