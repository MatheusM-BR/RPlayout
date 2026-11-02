import Fastify,{type FastifyInstance} from 'fastify'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {eq} from 'drizzle-orm'
import {randomUUID} from 'node:crypto'
import {createApp,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {channels,rundowns,scheduleRules,users,sessions,operatorDecisions} from '../db/schema.js'
import {SchedulePublication} from './schedule-publication.js'
import {planScheduleDay} from './schedule-day.js'
import {sessionDigest} from './access.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
let app:App,server:FastifyInstance
const path='/api/channels/ch/schedule-publication'
beforeEach(async()=>{
  app=await createApp(':memory:');const stamp=new Date().toISOString()
  for(const id of ['ch','private']){
    app.db.insert(channels).values({id,name:id,rateNum:25,rateDen:1,width:320,height:180,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:stamp}).run()
    app.db.insert(rundowns).values({id:'rd-'+id,channelId:id,name:id,date:'2026-10-03',plannedStart:0,loop:false,createdAt:stamp,updatedAt:stamp}).run()
    app.db.insert(scheduleRules).values({id:'rule-'+id,channelId:id,name:'Completa',weekdays:'0123456',startMinute:0,endMinute:1440,categories:[],avoidHours:0,createdAt:stamp}).run()
  }
  Object.assign(app,{schedulePublication:new SchedulePublication(app.db,'fixture',async()=>null,async(request)=>planScheduleDay(request))})
  server=Fastify();registerRoutes(app,server,()=>{});await server.ready()
})
afterEach(async()=>{await server.close();app.close()})
async function account(role:string){const token=randomUUID(),stamp=new Date().toISOString()
  app.db.insert(users).values({id:'actor',username:'actor',passwordHash:'unused',role,enabled:true,createdAt:stamp}).run()
  app.db.insert(sessions).values({token:sessionDigest(token),userId:'actor',expiresAt:new Date(Date.now()+60000).toISOString(),createdAt:stamp}).run()
  app.sqlite.prepare('INSERT INTO user_access VALUES (?,?,?,?)').run('actor',JSON.stringify(['ch']),null,stamp)
  return {cookie:`rplayout_session=${token}`}
}
describe('API de montagem/publicação tem versão, prova e direitos de canal',()=>{
  it('status/conferência não escrevem nem instalam runtime, enable exige prova e versão atuais',async()=>{
    const before=app.db.select().from(operatorDecisions).all()
    const status=await server.inject(path);expect(status.statusCode).toBe(200);expect(status.json()).toMatchObject({state:'DISABLED',version:0,workerAvailable:true})
    const review=await server.inject(path+'/review?daysAhead=2&maxItems=2000');expect(review.statusCode,review.body).toBe(200)
    expect(app.db.select().from(operatorDecisions).all()).toEqual(before);expect(app.runtimes.size).toBe(0)
    const body={action:'ENABLE',version:0,daysAhead:2,maxItems:2000}
    expect((await server.inject({method:'POST',url:path,payload:body})).statusCode).toBe(428)
    const enabled=await server.inject({method:'POST',url:path,payload:{...body,reviewToken:review.json().review.token}})
    expect(enabled.statusCode,enabled.body).toBe(200);expect(enabled.json()).toMatchObject({state:'ENABLED',version:1})
    expect((await server.inject({method:'POST',url:path,payload:{...body,reviewToken:review.json().review.token}})).statusCode).toBe(409)
    expect((await server.inject({method:'POST',url:path,payload:{action:'DISABLE',version:0}})).statusCode).toBe(409)
    expect((await server.inject({method:'POST',url:path,payload:{action:'DISABLE',version:1}})).json()).toMatchObject({state:'DISABLED',version:2})
    expect(app.runtimes.size).toBe(0)
  })
  it('operador não habilita e programador não lê/autoriza canal privado',async()=>{
    const headers=await account('OPERATOR')
    expect((await server.inject({url:path,headers})).statusCode).toBe(200)
    expect((await server.inject({url:path+'/review?daysAhead=2&maxItems=2000',headers})).statusCode).toBe(403)
    expect((await server.inject({method:'POST',url:path,headers,payload:{action:'ENABLE',version:0}})).statusCode).toBe(403)
    app.db.update(users).set({role:'PROGRAMMER'}).where(eq(users.id,'actor')).run()
    expect((await server.inject({url:'/api/channels/private/schedule-publication',headers})).statusCode).toBe(403)
    expect((await server.inject({url:'/api/channels/private/schedule-publication/review?daysAhead=2&maxItems=2000',headers})).statusCode).toBe(403)
  })
  it('conta revogada perde autorização; pauta alterada recusa prova mesmo com versão de política atual',async()=>{
    const headers=await account('PROGRAMMER'),review=await server.inject({url:path+'/review?daysAhead=2&maxItems=2000',headers})
    expect(review.statusCode,review.body).toBe(200)
    const body={action:'ENABLE',version:0,daysAhead:2,maxItems:2000,reviewToken:review.json().review.token}
    app.db.update(scheduleRules).set({name:'Pauta alterada'}).where(eq(scheduleRules.id,'rule-ch')).run()
    expect((await server.inject({method:'POST',url:path,headers,payload:body})).statusCode).toBe(409)
    app.db.update(users).set({enabled:false}).where(eq(users.id,'actor')).run()
    expect((await server.inject({method:'POST',url:path,headers,payload:body})).statusCode).toBe(401)
    expect(app.schedulePublication.status('ch').state).toBe('DISABLED')
  })
  it('STOP sem direito não suspende; STOP autorizado suspende automação editorial',async()=>{
    const headers=await account('SUPERVISOR'),review=await server.inject({url:path+'/review?daysAhead=2&maxItems=2000',headers})
    expect((await server.inject({method:'POST',url:path,headers,payload:{action:'ENABLE',version:0,daysAhead:2,maxItems:2000,reviewToken:review.json().review.token}})).statusCode).toBe(200)
    app.db.update(users).set({role:'OPERATOR'}).where(eq(users.id,'actor')).run()
    expect((await server.inject({method:'POST',url:'/api/channels/ch/transport',headers,payload:{action:'stop'}})).statusCode).toBe(403)
    expect(app.schedulePublication.status('ch').state).toBe('ENABLED')
    app.db.update(users).set({role:'SUPERVISOR'}).where(eq(users.id,'actor')).run()
    const stopped=await server.inject({method:'POST',url:'/api/channels/ch/transport',headers,payload:{action:'stop'}})
    expect(stopped.statusCode,stopped.body).toBe(200);expect(app.schedulePublication.status('ch').state).toBe('SUSPENDED')
  })
})
