import Fastify,{type FastifyInstance} from 'fastify'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {createApp,runtimeFor,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {AudioMixAnalysis} from './audio-mix-analysis.js'
import {channels,rundowns,rundownItems,mediaAssets,users,sessions,operatorDecisions} from '../db/schema.js'
import {sessionDigest} from './access.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',AUDIO_ANALYSIS_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
const hash='a'.repeat(64),payload={contentHash:hash,audioTrack:0,routing:{mode:'STEREO_3_4'}},header=(revision:string,actor='operator')=>({cookie:`rplayout_session=${actor}`,'if-match':revision})
let app:App,server:FastifyInstance
beforeEach(async()=>{
  app=await createApp(':memory:');const now=new Date().toISOString()
  for(const id of ['own','other']){
    app.db.insert(channels).values({id,name:id,width:320,height:180,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:now}).run()
    app.db.insert(rundowns).values({id:'rd-'+id,channelId:id,name:id,date:'2026-10-02',plannedStart:0,loop:false,createdAt:now,updatedAt:now}).run()
    app.db.insert(mediaAssets).values({id:'asset-'+id,contentHash:hash,path:`/verified-${id}.mkv`,title:'VT',kind:'VIDEO',durationFrames:250,hasAudio:true,audioChannels:4,createdAt:now}).run()
    app.db.insert(rundownItems).values({id:'item-'+id,rundownId:'rd-'+id,sortOrder:0,title:'VT',type:'VT',mediaId:'asset-'+id,minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',autoNext:false,loop:false,locked:false}).run()
  }
  for(const [id,role] of [['operator','SUPERVISOR'],['admin','ADMIN']] as const){
    app.db.insert(users).values({id,username:id,passwordHash:'unused',role,enabled:true,createdAt:now}).run()
    app.db.insert(sessions).values({token:sessionDigest(id),userId:id,expiresAt:new Date(Date.now()+60000).toISOString(),createdAt:now}).run()
  }
  app.sqlite.prepare('INSERT INTO user_access VALUES (?,?,?,?)').run('operator',JSON.stringify(['own']),null,now)
  Object.assign(app,{audioMixAnalysis:new AudioMixAnalysis(app.db,'fixture',async()=>'/verified.mkv',async()=>({ok:true,integratedLufs:-18,lra:3,truePeakDbtp:-7,sampleFrames:48000,rate:48000,channels:2}))})
  server=Fastify();registerRoutes(app,server,()=>{});await server.ready();await app.sources.list()
})
afterEach(async()=>{await server?.close();app?.close()})
describe('medição por item respeita dono/revisão e não comanda PGM',()=>{
  it('exige revisão, rejeita superada e outro canal; medição não avança revisão',async()=>{
    const url='/api/items/item-own/audio-analysis',revision=app.concurrency.generateETag('rd-own')
    expect((await server.inject({method:'POST',url,payload,headers:{cookie:'rplayout_session=operator'}})).statusCode).toBe(428)
    expect((await server.inject({method:'POST',url:'/api/items/item-other/audio-analysis',payload,headers:header(app.concurrency.generateETag('rd-other'))})).statusCode).toBe(403)
    app.sqlite.exec("UPDATE rundown_items SET notes='outro operador' WHERE id='item-own'")
    expect((await server.inject({method:'POST',url,payload,headers:header(revision)})).statusCode).toBe(409)
    expect(app.db.select().from(operatorDecisions).all().filter(row=>row.kind==='AUDIO_MIX_ANALYSIS')).toHaveLength(0)
    const fresh=app.concurrency.generateETag('rd-own'),response=await server.inject({method:'POST',url,payload,headers:header(fresh)})
    expect(response.statusCode,response.body).toBe(202);const job=response.json().analysis
    await vi.waitFor(()=>expect(app.audioMixAnalysis.read('item-own',job.id)?.state).toBe('READY'))
    expect(app.concurrency.generateETag('rd-own')).toBe(fresh)
    const status=await server.inject({url:url+'/'+job.id,headers:header(fresh)})
    expect(status.statusCode).toBe(200);expect(status.json().analysis.worker).toBeUndefined()
    expect((await server.inject({url:'/api/items/item-other/audio-analysis/'+job.id,headers:header(fresh)})).statusCode).toBe(403)
    expect((await server.inject({url:'/api/items/item-other/audio-analysis/'+job.id,headers:header(fresh,'admin')})).statusCode).toBe(404)
  })
  it('aplicar AUTO usa medição do servidor e preserva PGM da outra data; revogação barra consulta',async()=>{
    const runtime=(await runtimeFor(app,'own'))!;await runtime.load('rd-own')
    const initial=runtime.transport.state(),revision=app.concurrency.generateETag('rd-own')
    const response=await server.inject({method:'POST',url:'/api/items/item-own/audio-analysis',payload,headers:header(revision)}),job=response.json().analysis
    await vi.waitFor(()=>expect(app.audioMixAnalysis.read('item-own',job.id)?.state).toBe('READY'))
    const apply=await server.inject({method:'POST',url:'/api/items/item-own/audio',headers:header(revision),payload:{scope:'ITEM',audioTrack:0,audio:{mode:'AUTO',gainDb:20,measured:null,routing:payload.routing,analysisId:job.id}}})
    expect(apply.statusCode,apply.body).toBe(200);expect(apply.json().view.items[0].gainDb).toBe(-5)
    expect(apply.json().view.items[0].audio.measured.integratedLufs).toBe(-18)
    expect(runtime.transport.state()).toEqual(initial)
    app.sqlite.exec("UPDATE users SET enabled=0 WHERE id='operator'")
    expect((await server.inject({url:'/api/items/item-own/audio-analysis/'+job.id,headers:header(revision)})).statusCode).toBe(401)
  })
})
