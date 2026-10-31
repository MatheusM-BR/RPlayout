import Fastify,{type FastifyInstance} from 'fastify'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {randomUUID} from 'node:crypto'
import {createApp,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {channels,mediaAssets,sessions,users} from '../db/schema.js'
import {sessionDigest} from './access.js'
import {classifyCut,listCutMarks} from './cut-marks.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))

let app:App,server:FastifyInstance
const token=randomUUID(),now=new Date().toISOString(),hash='a'.repeat(64)
beforeEach(async()=>{
  app=await createApp(':memory:')
  for(const id of ['A','B'])app.db.insert(channels).values({id,name:`Canal ${id}`,rateNum:25,rateDen:1,width:320,height:180,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:now}).run()
  // 60 s de arquivo
  app.db.insert(mediaAssets).values({id:'vt',path:'C:/vt.mp4',title:'VT',contentHash:hash,kind:'VIDEO',durationFrames:1500,rateNum:25,rateDen:1,durationNs:60_000_000_000,qcStatus:'APPROVED',createdAt:now}).run()
  server=Fastify();registerRoutes(app,server,()=>{});await server.ready()
})
afterEach(async()=>{await server?.close();app?.close()})
function login(role:string,channelIds:string[]|null){
  app.db.insert(users).values({id:'u',username:'u',passwordHash:'x',role,enabled:true,createdAt:now}).run()
  if(channelIds)app.sqlite.prepare('INSERT INTO user_access VALUES(?,?,?,?)').run('u',JSON.stringify(channelIds),null,now)
  app.db.insert(sessions).values({token:sessionDigest(token),userId:'u',expiresAt:new Date(Date.now()+600000).toISOString(),createdAt:now}).run()
  return {cookie:`rplayout_session=${token}`}
}

describe('marcações de corte',()=>{
  it('classifica início, fim e meio',()=>{
    expect(classifyCut(0,5000,60000)).toBe('HEAD')
    expect(classifyCut(50000,60000,60000)).toBe('TAIL')
    expect(classifyCut(20000,30000,60000)).toBe('MIDDLE')
  })
  it('várias marcações por VT; ganho de tempo de cada uma; versão trocada some da lista',async()=>{
    const headers=login('SUPERVISOR',['A'])
    const post=(payload:Record<string,unknown>)=>server.inject({method:'POST',url:'/api/assets/vt/cut-marks',headers,payload:{channelId:'A',contentHash:hash,...payload}})
    const tail=await post({fromMs:48000,toMs:60000,label:'pode sair no intervalo'})
    expect(tail.statusCode,tail.body).toBe(201)
    expect(tail.json().mark).toEqual(expect.objectContaining({kind:'TAIL',savesMs:12000}))
    expect((await post({fromMs:0,toMs:3000})).json().mark).toEqual(expect.objectContaining({kind:'HEAD',savesMs:3000}))
    expect((await post({fromMs:20000,toMs:25000})).json().mark.kind).toBe('MIDDLE')
    expect((await post({fromMs:5000,toMs:4000})).statusCode).toBe(400)
    expect((await post({fromMs:0,toMs:60000})).statusCode).toBe(400)
    expect((await post({fromMs:1000,toMs:2000,contentHash:'b'.repeat(64)})).statusCode).toBe(409)
    const listed=await server.inject({url:'/api/cut-marks?assetIds=vt',headers})
    expect(listed.json().marks.map((mark:{kind:string})=>mark.kind)).toEqual(['HEAD','MIDDLE','TAIL'])
    expect(app.sqlite.prepare("SELECT count(*) AS n FROM operator_decisions WHERE kind='CUT_MARK_ADDED'").get()).toEqual({n:3})
    app.sqlite.prepare("UPDATE media_assets SET content_hash=? WHERE id='vt'").run('c'.repeat(64))
    expect(listCutMarks(app.db,['vt'])).toEqual([])
    expect(listCutMarks(app.db,['vt'],true)).toHaveLength(3)
  })
  it('remove; conta restrita só marca informando um canal seu',async()=>{
    const headers=login('SUPERVISOR',['A'])
    const created=(await server.inject({method:'POST',url:'/api/assets/vt/cut-marks',headers,payload:{channelId:'A',contentHash:hash,fromMs:50000,toMs:60000}})).json().mark
    expect((await server.inject({method:'POST',url:'/api/assets/vt/cut-marks',headers,payload:{channelId:'B',contentHash:hash,fromMs:50000,toMs:60000}})).statusCode).toBe(403)
    expect((await server.inject({method:'DELETE',url:`/api/assets/vt/cut-marks/${created.id}`,headers,payload:{channelId:'A'}})).statusCode).toBe(200)
    expect(listCutMarks(app.db,['vt'])).toEqual([])
  })
  it('operador marca corte no QC (mesma permissão da decisão de QC)',async()=>{
    const headers=login('OPERATOR',['A'])
    expect((await server.inject({method:'POST',url:'/api/assets/vt/cut-marks',headers,payload:{channelId:'A',contentHash:hash,fromMs:50000,toMs:60000}})).statusCode).toBe(201)
  })
  it('alinhamento: operador do canal pode conferir; de outro canal não',async()=>{
    const headers=login('OPERATOR',['A'])
    const body={focusItemId:'x',actions:[{kind:'INSERT',mediaId:'vt'}]}
    expect((await server.inject({method:'POST',url:'/api/channels/B/alignment-review',headers,payload:body})).statusCode).toBe(403)
    const own=await server.inject({method:'POST',url:'/api/channels/A/alignment-review',headers,payload:body})
    expect(own.statusCode).not.toBe(403)
    expect([404,409]).toContain(own.statusCode)
  })
})
