import Fastify,{type FastifyInstance} from 'fastify'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {randomUUID} from 'node:crypto'
import {createApp,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {channels,users,sessions,liveSources} from '../db/schema.js'
import {sessionDigest} from './access.js'
import {effectiveComposition,DEFAULT_COMPOSITE} from './multiview-composite.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
let app:App,server:FastifyInstance
const tokens={op:randomUUID(),sup:randomUUID()}
const as=(who:keyof typeof tokens,extra:Record<string,string>={})=>({cookie:`rplayout_session=${tokens[who]}`,...extra})
beforeEach(async()=>{
  app=await createApp(':memory:')
  const now=new Date().toISOString()
  for(const id of ['ch','outro'])await app.db.insert(channels).values({id,name:id,rateNum:25,rateDen:1,width:1920,height:1080,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:now})
  for(const [id,role] of [['op','OPERATOR'],['sup','SUPERVISOR']] as const){
    await app.db.insert(users).values({id,username:id,passwordHash:'not-used',role,enabled:true,createdAt:now})
    await app.db.insert(sessions).values({token:sessionDigest(tokens[id]),userId:id,expiresAt:new Date(Date.now()+600000).toISOString(),createdAt:now})
  }
  await app.db.insert(liveSources).values({id:'cam-a',channelId:'ch',name:'Câmera A',kind:'NDI',targetUrl:'ndi://A',role:'PRIMARY',enabled:true,autoFailover:false,createdAt:now} as never)
  await app.db.insert(liveSources).values({id:'cam-x',channelId:'outro',name:'Câmera X',kind:'NDI',targetUrl:'ndi://X',role:'PRIMARY',enabled:true,autoFailover:false,createdAt:now} as never)
  server=Fastify();registerRoutes(app,server,()=>{});await server.ready()
})
afterEach(async()=>{await server.close();app.close()})
const url='/api/channels/ch/multiview/composite'

describe('multiview composto: listar, escolher e salvar layout por canal',()=>{
  it('lista layouts e níveis, preenche automático e diz por que não há mosaico sem servidor de mídia',async()=>{
    expect((await server.inject({method:'GET',url})).statusCode).toBe(401)
    const response=await server.inject({method:'GET',url,headers:as('op')})
    expect(response.statusCode).toBe(200)
    const body=response.json()
    expect(body.layouts.map((layout:{id:string})=>layout.id)).toEqual(['MV_PGM_PVW','MV_2X2','MV_3X3','MV_4X4','MV_1_PLUS_5'])
    expect(body.qualities.map((quality:{id:string})=>quality.id)).toEqual(['REFERENCIA','PADRAO','LEVE'])
    expect(body.saved).toMatchObject({layout:'MV_PGM_PVW',quality:'PADRAO',cells:null,revision:0})
    expect(body.composition.cells.slice(0,3)).toEqual([{kind:'pgm'},{kind:'pvw'},{kind:'source',id:'cam-a'}])
    expect(body.composition.cells).toHaveLength(10)
    expect(body.available).toBe(false)
    expect(body.reason).toMatch(/servidor de mídia/)
    expect(body).toMatchObject({canSave:true,canChangeQuality:false})
    expect(response.headers.etag).toBe('"mvc:ch:0"')
  })
  it('operador salva layout e células com revisão; nível exige supervisor; revisão velha e entrada de outro canal são recusadas',async()=>{
    const put=(who:keyof typeof tokens,payload:object,etag?:string)=>server.inject({method:'PUT',url,payload,headers:as(who,etag?{'if-match':etag}:{})})
    expect((await put('op',{layout:'MV_3X3'})).statusCode).toBe(428)
    const saved=await put('op',{layout:'MV_3X3',cells:[{kind:'pgm'},{kind:'source',id:'cam-a'}]},'"mvc:ch:0"')
    expect(saved.statusCode,saved.body).toBe(200)
    expect(saved.json().saved).toMatchObject({layout:'MV_3X3',quality:'PADRAO',revision:1,savedBy:'op'})
    expect((await put('op',{layout:'MV_2X2'},'"mvc:ch:0"')).statusCode).toBe(409)
    expect((await put('op',{layout:'MV_2X2',quality:'REFERENCIA'},'"mvc:ch:1"')).statusCode).toBe(403)
    expect((await put('op',{layout:'MV_2X2',cells:[{kind:'source',id:'cam-x'}]},'"mvc:ch:1"')).statusCode).toBe(400)
    expect((await put('op',{layout:'MV_2X2',cells:Array(5).fill({kind:'pgm'})},'"mvc:ch:1"')).statusCode).toBe(400)
    expect((await put('op',{layout:'MV_9X9'},'"mvc:ch:1"')).statusCode).toBe(400)
    const quality=await put('sup',{layout:'MV_4X4',quality:'LEVE',cells:null},'"mvc:ch:1"')
    expect(quality.statusCode,quality.body).toBe(200)
    const read=(await server.inject({method:'GET',url,headers:as('sup')})).json()
    expect(read.saved).toMatchObject({layout:'MV_4X4',quality:'LEVE',cells:null,revision:2,savedBy:'sup'})
    expect(read.composition.cells).toHaveLength(16)
    expect(read.canChangeQuality).toBe(true)
    // Outro canal não herda o layout.
    expect((await server.inject({method:'GET',url:'/api/channels/outro/multiview/composite',headers:as('op')})).json().saved.revision).toBe(0)
    // Cada gravação fica na trilha de decisões.
    expect(app.sqlite.prepare("SELECT count(*) AS n FROM operator_decisions WHERE rundown_id='@multiview' AND kind='MULTIVIEW_COMPOSITE'").get()).toEqual({n:2})
  })
  it('composição efetiva: backup depois do principal, desativada fora, células salvas cortadas ao layout',()=>{
    const sources=[{id:'b',role:'BACKUP',enabled:true},{id:'a',role:'PRIMARY',enabled:true},{id:'off',role:'PRIMARY',enabled:false}]
    expect(effectiveComposition({...DEFAULT_COMPOSITE,layout:'MV_2X2'},sources).cells).toEqual([{kind:'pgm'},{kind:'pvw'},{kind:'source',id:'a'},{kind:'source',id:'b'}])
    expect(effectiveComposition({...DEFAULT_COMPOSITE,layout:'MV_2X2',cells:[{kind:'qc'}]},sources).cells).toEqual([{kind:'qc'},{kind:'empty'},{kind:'empty'},{kind:'empty'}])
  })
})
