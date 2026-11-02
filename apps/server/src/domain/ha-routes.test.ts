import Fastify,{type FastifyInstance} from 'fastify'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {eq} from 'drizzle-orm'
import {createApp,runtimeFor,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {channels,rundowns,rundownItems,mediaAssets,asRun,liveSources,qcDecisions} from '../db/schema.js'
import {reviewedPublish} from './test-operational-review.js'
import {Checkpoints} from './checkpoints.js'
import {randomUUID} from 'node:crypto'
import {hashPassword} from './auth.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',RELAY_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
let primary:App,reserve:App,server:FastifyInstance,primaryServer:FastifyInstance,lastBody:string,lastHeaders:Record<string,string>
const configure=(role:'PRIMARY'|'STANDBY')=>{
  for(const [key,value] of Object.entries({RPLAYOUT_HA_ROLE:role,RPLAYOUT_HA_CLUSTER:'integration',RPLAYOUT_HA_NODE:role==='PRIMARY'?'a':'b',RPLAYOUT_HA_PEER_NODE:role==='PRIMARY'?'b':'a',RPLAYOUT_HA_KEY:'ab'.repeat(32),RPLAYOUT_HA_PEER:role==='PRIMARY'?'http://127.0.0.1:1234':'',RPLAYOUT_HA_DB:':memory:'}))vi.stubEnv(key,value)
}
beforeEach(async()=>{
  vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,init)=>{lastBody=String(init!.body);lastHeaders=init!.headers as Record<string,string>;const reply=await server.inject({method:'POST',url:'/api/ha/replica',payload:lastBody,headers:lastHeaders});return new Response(reply.body,{status:reply.statusCode})})
  configure('PRIMARY');primary=await createApp(':memory:')
  const now=new Date().toISOString()
  primary.db.insert(channels).values({id:'ch',name:'ÇÃO',width:320,height:180,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:now}).run()
  primary.db.insert(rundowns).values({id:'rd',channelId:'ch',name:'Grade publicada',date:now.slice(0,10),plannedStart:0,loop:false,createdAt:now,updatedAt:now}).run()
  primary.db.insert(mediaAssets).values({id:'media',contentHash:'a'.repeat(64),path:'AÇÃO.mp4',title:'Original',kind:'VIDEO',durationFrames:1000,hasAudio:false,createdAt:now}).run()
  primary.db.insert(rundownItems).values({id:'vt',rundownId:'rd',sortOrder:0,title:'Publicado',type:'VT',mediaId:'media',minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',autoNext:false,loop:false,locked:false}).run()
  primary.db.insert(liveSources).values({id:'srt',channelId:'ch',name:'Link ÇÃO',kind:'SRT',targetUrl:'srt://host:1?passphrase=PRIVATE_PAIR',enabled:true,createdAt:now}).run()
  primaryServer=Fastify();registerRoutes(primary,primaryServer,()=>{});await primaryServer.ready()
  const runtime=(await runtimeFor(primary,'ch'))!;await runtime.load('rd');await reviewedPublish(primaryServer,'rd')
  primary.db.update(rundownItems).set({title:'Rascunho não aprovado'}).where(eq(rundownItems.id,'vt')).run()
  new Checkpoints(primary.sqlite).write({version:1,channelId:'ch',rundownId:'rd',revisionId:runtime.operationalRevision!.id,itemId:'vt',elapsed:77,playing:true,realEngine:false})
  primary.db.insert(asRun).values({id:'run',channelId:'ch',title:'VT',type:'VT',startedAt:now,actualStart:0,createdAt:now,revisionId:runtime.operationalRevision!.id,startPositionFrames:0,endPositionFrames:77,rateNum:25,rateDen:1}).run()
  configure('STANDBY');reserve=await createApp(':memory:')
  reserve.sqlite.prepare('INSERT INTO users(id,username,password_hash,role,enabled,created_at) VALUES(?,?,?,?,1,?)').run('admin','admin','unused','ADMIN',now)
  server=Fastify();registerRoutes(reserve,server,()=>{});await server.ready()
})
afterEach(async()=>{await server.close();await primaryServer.close();primary.close();reserve.close();vi.restoreAllMocks();vi.unstubAllEnvs()})
describe('HTTP HA não transfere autoridade de operação ou dados editoriais',()=>{
  it.each(['OPERATOR','SUPERVISOR','ADMIN_RESTRICTED'])('reconciliação exige administrador com canal e estação permitidos: %s',async mode=>{
    const now=new Date().toISOString()
    reserve.sqlite.prepare('INSERT INTO users(id,username,password_hash,role,enabled,created_at) VALUES(?,?,?,?,1,?)').run('scoped','scoped',await hashPassword('testing-password'),mode==='ADMIN_RESTRICTED'?'ADMIN':mode,now)
    reserve.sqlite.prepare('INSERT INTO user_access(user_id,channel_ids,station_ips,updated_at) VALUES(?,?,?,?)').run('scoped',JSON.stringify(mode==='ADMIN_RESTRICTED'?['other']:['ch']),JSON.stringify(['192.0.2.10']),now)
    const login=await server.inject({method:'POST',url:'/api/auth/login',remoteAddress:'192.0.2.10',payload:{username:'scoped',password:'testing-password'}})
    expect(login.statusCode).toBe(200)
    const headers={cookie:String(login.headers['set-cookie']).split(';')[0]!},payload={requestId:randomUUID(),sequence:1,channelId:'ch'}
    for(const url of ['/api/ha/rehearsal','/api/ha/rehearsal/reconcile']){
      expect((await server.inject({method:'POST',url,payload,headers,remoteAddress:'192.0.2.10'})).statusCode).toBe(403)
      expect((await server.inject({method:'POST',url,payload,headers,remoteAddress:'192.0.2.11'})).statusCode).toBe(401)
    }
    expect(reserve.runtimes.size).toBe(0)
  })
  it.each(['/api/ha/rehearsal','/api/ha/rehearsal/reconcile'])('ensaio %s não usa pareamento como login nem aceita ação de TAKE ou banco efêmero',async endpoint=>{
    await primary.ha!.tick()
    const payload={requestId:randomUUID(),sequence:1,channelId:'ch'}
    expect((await server.inject({method:'POST',url:endpoint,payload,headers:lastHeaders})).statusCode).toBe(401)
    // Development admin mode still goes through normal authorization; pairing
    // never bypasses it as it does for the dedicated replica endpoints.
    reserve.sqlite.prepare('DELETE FROM users').run()
    const response=await server.inject({method:'POST',url:endpoint,payload})
    expect(response.statusCode).toBe(409);expect(response.body).toContain('persistente')
    expect((await server.inject({method:'POST',url:endpoint,payload:{...payload,action:'take'}})).statusCode).toBe(400)
    expect((await server.inject({method:'POST',url:endpoint,payload,headers:{origin:'https://hostile.invalid'}})).statusCode).toBe(403)
    const status=await server.inject('/api/ha/rehearsal')
    expect(status.statusCode).toBe(200);expect(status.headers['cache-control']).toBe('private, no-store')
    expect(status.json()).toEqual({enabled:false,reports:[],promotionReady:false,automaticTake:false})
    expect(reserve.runtimes.size).toBe(0)
    expect((await primaryServer.inject({method:'POST',url:endpoint,payload})).statusCode).toBe(409)
  })
  it('health não apresenta transporte simulado como engine nativa pronta',async()=>{
    const primaryHealth=await primaryServer.inject('/api/health')
    expect(primaryHealth.statusCode).toBe(200)
    expect(primaryHealth.json()).toMatchObject({channels:1,engines:0,nativeEngines:0,simulatedChannels:1})
    expect((await server.inject('/api/health')).json()).toMatchObject({channels:0,engines:0,nativeEngines:0,simulatedChannels:0})
  })
  it('espelha decisões globais e do canal na ordem efetiva, sem aprovação de outro canal',async()=>{
    const now=new Date().toISOString()
    // IDs deliberately oppose insertion order; identical timestamps must not
    // move the newer global revocation ahead of the channel approval.
    for(const row of [
      {id:'z-global',channelId:'@all',status:'APPROVED' as const},
      {id:'y-channel',channelId:'ch',status:'APPROVED_WITH_NOTES' as const},
      {id:'x-other',channelId:'other',status:'APPROVED' as const},
      {id:'a-revoked',channelId:'@all',status:'BLOCKED' as const},
    ])primary.db.insert(qcDecisions).values({...row,assetId:'media',contentHash:'a'.repeat(64),notes:'QC',checks:{playable:true,errors:[],warnings:[]},actor:'tester',createdAt:now}).run()
    await primary.ha!.tick()
    const mirrored=reserve.ha!.mirror()!.channels[0]!.configuration.qc as Array<{id:string;status:string}>
    expect(mirrored.map(row=>[row.id,row.status])).toEqual([['z-global','APPROVED'],['y-channel','APPROVED_WITH_NOTES'],['a-revoked','BLOCKED']])
    expect(reserve.runtimes.size).toBe(0)
  })
  it('pareamento autentica sem conta/control token e não instala canais no banco local',async()=>{
    await primary.ha!.tick();expect(primary.ha!.status()).toMatchObject({sequence:1,pending:false,error:null})
    expect(reserve.ha!.mirror()).toMatchObject({channels:[{configuration:{sources:[{targetUrl:'srt://host:1?passphrase=PRIVATE_PAIR'}]},revisions:[{payload:{items:[{title:'Publicado'}]}}],checkpoint:{value:{elapsed:77}}}],asRun:[{id:'run',endPositionFrames:77}]})
    expect(lastBody).not.toContain('PRIVATE_');expect(lastBody).not.toContain('Publicado');expect(lastBody).not.toContain('Rascunho')
    expect(reserve.db.select().from(channels).all()).toHaveLength(0);expect(reserve.db.select().from(asRun).all()).toHaveLength(0)
    expect(reserve.runtimes.size).toBe(0);expect(await runtimeFor(reserve,'ch')).toBeNull()
    expect(reserve.ha!.status().failoverReady).toBe(false)
  })
  it('não recebe com sessão/admin token no lugar da prova HA e não corta PGM',async()=>{
    await primary.ha!.tick()
    const tampered=await server.inject({method:'POST',url:'/api/ha/replica',payload:lastBody,headers:{'content-type':'application/json','x-rplayout-control-token':'ab'.repeat(32)}})
    expect(tampered.statusCode).toBe(403);expect(reserve.ha!.status().sequence).toBe(1)
    const take=await server.inject({method:'POST',url:'/api/channels/ch/transport',payload:{action:'take',itemId:'vt'}})
    expect(take.statusCode).toBe(409);expect(take.body).toContain('Nó reserva');expect(reserve.runtimes.size).toBe(0)
    expect((await server.inject({method:'PATCH',url:'/api/channels/ch',payload:{name:'Outro'}})).statusCode).toBe(409)
  })
  it('depois de resultado perdido, entrega repetida apenas consulta confirmação persistida',async()=>{
    await primary.ha!.tick();const second=await server.inject({method:'POST',url:'/api/ha/replica',payload:lastBody,headers:lastHeaders})
    expect(second.statusCode,second.body).toBe(200);expect(second.json()).toMatchObject({sequence:1,stored:true,automaticTake:false})
    expect(reserve.ha!.status().sequence).toBe(1);expect(reserve.runtimes.size).toBe(0)
  })
})
