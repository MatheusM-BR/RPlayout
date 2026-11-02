import Fastify,{type FastifyInstance} from 'fastify'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {createApp,runtimeFor,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {channels} from '../db/schema.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
let app:App,server:FastifyInstance
beforeEach(async()=>{
  app=await createApp(':memory:')
  app.db.insert(channels).values({id:'ch',name:'ch',width:320,height:180,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:new Date().toISOString()}).run()
  await runtimeFor(app,'ch');server=Fastify();registerRoutes(app,server,()=>{});await server.ready()
})
afterEach(async()=>{await server.close();app.close()})
const audits=()=>(app.sqlite.prepare("SELECT payload FROM operator_decisions WHERE kind='API_MUTATION'").all() as unknown[]).map(row=>JSON.stringify(row))
describe('auditoria HTTP não grava o ponto de monitor',()=>{
  it('batidas de /watching não viram linha de auditoria; outro POST continua auditado',async()=>{
    for(let i=0;i<20;i++)expect((await server.inject({method:'POST',url:'/api/channels/ch/watching',payload:{bus:'pvw'}})).statusCode).toBe(200)
    expect(audits()).toHaveLength(0)
    const inspection=await server.inject({method:'POST',url:'/api/channels/ch/qc/inspection',payload:{viewerId:'77777777-7777-4777-8777-777777777777',sourceRef:'ndi:OLD',watching:false}})
    expect(inspection.statusCode).toBe(200)
    expect(audits()).toHaveLength(1)
  })
})
