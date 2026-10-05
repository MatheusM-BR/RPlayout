import Fastify,{type FastifyInstance} from 'fastify'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {randomUUID} from 'node:crypto'
import {eq} from 'drizzle-orm'
import {createApp,runtimeFor,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {channels,rundowns,rundownItems,mediaAssets,users,sessions,operationalPlaylistRevisions} from '../db/schema.js'
import {publishOperationalPlaylist} from './operational-playlist.js'
import {getChannel} from '../db/repo.js'
import {inspectBoundary,PlaylistBoundaryLedger} from './playlist-boundary.js'
import {sessionDigest} from './access.js'
import {EngineTransport} from './engine.js'

vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN',EXTERNAL_CONTROL_TOKEN:'boundary-local-qa'}))
let app:App,server:FastifyInstance,source:string,target:string,id:string
const url='/api/channels/ch/next-playlist'
const ledger=()=>new PlaylistBoundaryLedger(app.db,'ch')
beforeEach(async()=>{
  app=await createApp(':memory:');const stamp=new Date().toISOString();id=randomUUID()
  for(const ch of ['ch','private'])app.db.insert(channels).values({id:ch,name:ch,rateNum:25,rateDen:1,width:320,height:180,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:stamp}).run()
  app.db.insert(mediaAssets).values({id:'asset',title:'Aprovado',path:'C:/QA/ação.mp4',contentHash:'a'.repeat(64),kind:'VIDEO',durationFrames:250,rateNum:25,rateDen:1,qcStatus:'APPROVED',createdAt:stamp}).run()
  for(const rd of ['source','target','private']){
    app.db.insert(rundowns).values({id:rd,channelId:rd==='private'?'private':'ch',name:rd,date:'2026-10-02',plannedStart:0,loop:false,createdAt:stamp,updatedAt:stamp}).run()
    app.db.insert(rundownItems).values({id:'vt-'+rd,rundownId:rd,sortOrder:0,title:rd,type:'VT',mediaId:'asset',minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',autoNext:true,loop:false,locked:false}).run()
  }
  source=(await publishOperationalPlaylist(app.db,(await getChannel(app.db,'ch'))!,'source',null)).id
  target=(await publishOperationalPlaylist(app.db,(await getChannel(app.db,'ch'))!,'target',null)).id
  const runtime=(await runtimeFor(app,'ch'))!;await runtime.load('source')
  server=Fastify();registerRoutes(app,server,()=>{});await server.ready()
})
afterEach(async()=>{await server.close();app.close();vi.useRealTimers()})
const queue=()=>ledger().enqueue(id,inspectBoundary(app.db,'ch',source,target,{userId:null,username:null}))
const command=(action:string,headers:Record<string,string>={})=>server.inject({method:'POST',url,headers,payload:{action,requestId:id}})
async function account(role:string,channelIds:string[]|null=null){
  const stamp=new Date().toISOString(),token=randomUUID()
  app.db.insert(users).values({id:'actor',username:'actor',passwordHash:'unused',role,enabled:true,createdAt:stamp}).run()
  app.db.insert(sessions).values({token:sessionDigest(token),userId:'actor',expiresAt:new Date(Date.now()+60_000).toISOString(),createdAt:stamp}).run()
  app.sqlite.prepare('INSERT INTO user_access VALUES (?,?,?,?)').run('actor',channelIds?JSON.stringify(channelIds):null,null,stamp)
  return {cookie:`rplayout_session=${token}`}
}

describe('HTTP da próxima playlist não é TAKE e mantém o escopo do canal',()=>{
  async function continuity(native=false){
    vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-02T00:00:01'))
    app.db.update(rundowns).set({plannedStart:250}).where(eq(rundowns.id,'target')).run()
    target=(await publishOperationalPlaylist(app.db,(await getChannel(app.db,'ch'))!,'target',null)).id
    if(native){
      const runtime=app.runtimes.get('ch')!,original=runtime.transport
      Object.assign(runtime,{transport:Object.assign(Object.create(EngineTransport.prototype),{state:()=>original.state(),health:()=>({ready:true}),processId:()=>process.pid,close:()=>original.close(),stop:()=>original.stop(),mutatePlaylist:async(action:()=>Promise<unknown>)=>action()})})
    }
    return '/api/channels/ch/published-continuity'
  }
  it('política recorrente é consulta sem habilitação, privada por canal e recusa simulador',async()=>{
    const path=await continuity(),before=app.sqlite.prepare('SELECT count(*) n FROM operator_decisions').get()
    expect((await server.inject(path)).json()).toMatchObject({state:'DISABLED',version:0,nativeEngine:false})
    const review=await server.inject(path+'/review?maxLateMinutes=5');expect(review.statusCode,review.body).toBe(200)
    expect(app.sqlite.prepare('SELECT count(*) n FROM operator_decisions').get()).toEqual(before)
    const denied=await server.inject({method:'POST',url:path,payload:{action:'ENABLE',version:0,maxLateMinutes:5,reviewToken:review.json().review.token}})
    expect(denied.statusCode).toBe(409);expect(denied.body).toContain('simulador');expect(app.publishedContinuity.status('ch').state).toBe('DISABLED')
    const headers=await account('OPERATOR',['ch'])
    expect((await server.inject({url:'/api/channels/private/published-continuity',headers})).statusCode).toBe(403)
    expect((await server.inject({url:path+'/review?maxLateMinutes=5',headers})).statusCode).toBe(403)
  })
  it('API nativa mock exige conferência/revisão e desligamento não altera PGM',async()=>{
    const path=await continuity(true),headers=await account('PROGRAMMER',['ch'])
    const review=await server.inject({url:path+'/review?maxLateMinutes=5',headers});expect(review.statusCode,review.body).toBe(200)
    const command={action:'ENABLE',version:0,maxLateMinutes:5}
    expect((await server.inject({method:'POST',url:path,headers,payload:command})).statusCode).toBe(428)
    const enabled=await server.inject({method:'POST',url:path,headers,payload:{...command,reviewToken:review.json().review.token}})
    expect(enabled.statusCode,enabled.body).toBe(200);expect(enabled.json()).toMatchObject({state:'ENABLED',version:1})
    expect((await server.inject({method:'POST',url:path,headers,payload:{...command,reviewToken:review.json().review.token}})).statusCode).toBe(409)
    const status=(await server.inject({url:path,headers})).json();expect(status).not.toHaveProperty('worker');expect(status).not.toHaveProperty('owner');expect(status).not.toHaveProperty('channelContract');expect(status.workerState).toBe('CURRENT_SERVER')
    expect((await server.inject({method:'POST',url,headers,payload:{action:'CANCEL',requestId:randomUUID()}})).statusCode).toBe(409)
    expect(app.publishedContinuity.status('ch')).toMatchObject({state:'ENABLED',version:1})
    expect((await server.inject({method:'POST',url:path,headers,payload:{action:'DISABLE',version:0}})).statusCode).toBe(409)
    expect(app.publishedContinuity.status('ch').state).toBe('ENABLED')
    const disabled=await server.inject({method:'POST',url:path,headers,payload:{action:'DISABLE',version:1}})
    expect(disabled.statusCode,disabled.body).toBe(200);expect(disabled.json()).toMatchObject({state:'DISABLED',version:2})
    expect(app.runtimes.get('ch')!.transport.state().onAir).toBeNull()
  })
  it('consulta separa simulador, usa nome publicado e não revela prova/dono/processo',async()=>{
    const run=queue();app.db.update(rundowns).set({name:'RASCUNHO NOVO'}).where(eq(rundowns.id,'target')).run()
    const response=await server.inject(url),body=response.json()
    expect(response.statusCode,response.body).toBe(200)
    expect(body).toMatchObject({channelId:'ch',nativeEngine:false,sourceRevisionId:source,current:{id,state:'QUEUED'},automaticPolicy:'ONE_REVIEWED_EOS'})
    expect(body.options).toContainEqual(expect.objectContaining({name:'target',revisionId:target}))
    expect(response.body).not.toContain(run.plan.token);expect(response.body).not.toContain('processOwner');expect(response.body).not.toContain('owner')
    expect(app.runtimes.get('ch')!.transport.state().onAir).toBeNull()
    expect((await server.inject('/api/scheduler/status')).json().channels[0].automaticHandover).toBe(false)
  })
  it('conferência é somente leitura; simulador não aceita anúncio de passagem real',async()=>{
    const before=app.sqlite.prepare('SELECT count(*) n FROM operator_decisions').get()
    const response=await server.inject(`${url}/review?revisionId=${target}`)
    expect(response.statusCode,response.body).toBe(200)
    expect(response.json()).toMatchObject({nativeEngine:false,review:{sourceRevisionId:source,targetRevisionId:target,firstItemId:'vt-target'}})
    expect(app.sqlite.prepare('SELECT count(*) n FROM operator_decisions').get()).toEqual(before)
    const denied=await server.inject({method:'POST',url,payload:{action:'QUEUE',requestId:id,sourceRevisionId:source,targetRevisionId:target,reviewToken:response.json().review.token}})
    expect(denied.statusCode,denied.body).toBe(409);expect(denied.body).toContain('simulador')
    expect(ledger().list()).toEqual([])
  })
  it('origem substituída ou destino republicado exige nova conferência',async()=>{
    await publishOperationalPlaylist(app.db,(await getChannel(app.db,'ch'))!,'target',null)
    expect((await server.inject(`${url}/review?revisionId=${target}`)).statusCode).toBe(409)
    const response=await server.inject({method:'POST',url,payload:{action:'QUEUE',requestId:id,sourceRevisionId:'changed',targetRevisionId:target}})
    expect(response.statusCode).toBe(409);expect(ledger().list()).toEqual([])
  })
  it('cancelamento é explícito e SWITCHING não pode ser reaberto ou cancelado silenciosamente',async()=>{
    queue();ledger().phase(id,['QUEUED'],'PREPARING',()=>true)
    expect((await command('CANCEL')).statusCode).toBe(200);expect(ledger().read(id)?.state).toBe('CANCELLED')
    id=randomUUID();queue();ledger().phase(id,['QUEUED'],'PREPARING',()=>true);ledger().phase(id,['PREPARING'],'SWITCHING',()=>true)
    expect((await command('CANCEL')).statusCode).toBe(409);expect(ledger().read(id)?.state).toBe('SWITCHING')
    expect((await command('RECONCILE')).statusCode).toBe(409)
  })
  it('STOP canônico e externo cancelam uma autorização ainda não disparada',async()=>{
    queue();expect((await server.inject({method:'POST',url:'/api/channels/ch/transport',payload:{action:'stop'}})).statusCode).toBe(200)
    expect(ledger().read(id)?.state).toBe('CANCELLED')
    id=randomUUID();queue();const response=await server.inject({method:'POST',url:'/api/external/control',headers:{'x-rplayout-control-token':'boundary-local-qa'},payload:{channelId:'ch',action:'stop'}})
    expect(response.statusCode,response.body).toBe(200);expect(ledger().read(id)?.state).toBe('CANCELLED')
  })
  it('papel operador não publica; escopo oculta canal estrangeiro e sessão revogada não autoriza',async()=>{
    const headers=await account('OPERATOR',['ch'])
    expect((await server.inject({url:`${url}/review?revisionId=${target}`,headers})).statusCode).toBe(403)
    expect((await command('CANCEL',headers)).statusCode).toBe(403)
    expect((await server.inject({url:'/api/channels/private/next-playlist',headers})).statusCode).toBe(403)
    app.db.update(users).set({role:'ADMIN',enabled:false}).where(eq(users.id,'actor')).run()
    expect((await server.inject({url,headers})).statusCode).toBe(401)
  })
  it('destino de outro canal e corpo com permissão forjada são rejeitados',async()=>{
    const foreign=(await publishOperationalPlaylist(app.db,(await getChannel(app.db,'private'))!,'private',null)).id
    expect((await server.inject(`${url}/review?revisionId=${foreign}`)).statusCode).toBe(409)
    expect((await server.inject({method:'POST',url,payload:{action:'CANCEL',requestId:id,owner:{role:'ADMIN'}}})).statusCode).toBe(400)
    expect(app.db.select().from(operationalPlaylistRevisions).where(eq(operationalPlaylistRevisions.active,true)).all()).toHaveLength(3)
  })
})
