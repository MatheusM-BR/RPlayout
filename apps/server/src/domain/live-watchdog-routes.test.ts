import Fastify,{type FastifyInstance} from 'fastify'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {randomUUID} from 'node:crypto'
import {DEFAULT_LIVE_WATCHDOG_POLICY} from '@rplayout/protocol'
import {createApp,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {channels,users,sessions,liveSources,graphicTemplates} from '../db/schema.js'
import {sessionDigest} from './access.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
let app:App,server:FastifyInstance
const tokens:Record<string,string>={}
const as=(role:string)=>({cookie:`rplayout_session=${tokens[role]}`})
beforeEach(async()=>{
  app=await createApp(':memory:')
  const now=new Date().toISOString()
  await app.db.insert(channels).values({id:'ch',name:'ch',rateNum:30000,rateDen:1001,width:320,height:180,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:now})
  for(const role of ['OPERATOR','SUPERVISOR']){
    const id=role.toLowerCase();tokens[role]=randomUUID()
    await app.db.insert(users).values({id,username:id,passwordHash:'not-used',role:role as 'OPERATOR',enabled:true,createdAt:now})
    await app.db.insert(sessions).values({token:sessionDigest(tokens[role]!),userId:id,expiresAt:new Date(Date.now()+600000).toISOString(),createdAt:now})
  }
  await app.db.insert(liveSources).values({id:'cam',channelId:'ch',name:'Câmera',kind:'SRT',targetUrl:'srt://127.0.0.1:9000?mode=listener',srtConfig:null,createdAt:now})
  server=Fastify();registerRoutes(app,server,()=>{});await server.ready()
})
afterEach(async()=>{await server.close();app.close()})
const policy=(patch:Record<string,unknown>={})=>({...structuredClone(DEFAULT_LIVE_WATCHDOG_POLICY),...patch})
const put=(role:string,body:unknown)=>server.inject({method:'PUT',url:'/api/channels/ch/live-watchdog',headers:as(role),payload:body as object})

describe('rotas do watchdog das entradas ao vivo',()=>{
  it('migração 56 cria a tabela sem tocar nas demais',()=>{
    expect(app.sqlite.prepare('SELECT name FROM schema_migrations WHERE version=56').get()).toEqual({name:'live-input-watchdog-policies'})
    expect(app.sqlite.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='live_watchdog_policies'").get()).toEqual({n:1})
  })
  it('leitura: sem sessão 401; operador lê o padrão (revisão 0, só alerta)',async()=>{
    expect((await server.inject({method:'GET',url:'/api/channels/ch/live-watchdog'})).statusCode).toBe(401)
    const read=await server.inject({method:'GET',url:'/api/channels/ch/live-watchdog',headers:as('OPERATOR')})
    expect(read.statusCode).toBe(200)
    expect(read.json()).toMatchObject({revision:0,policy:{mode:'ALERT_ONLY',waitMs:5000},inputs:[]})
    expect((await server.inject({method:'GET',url:'/api/channels/nao-existe/live-watchdog',headers:as('SUPERVISOR')})).statusCode).toBe(404)
  })
  it('configurar exige Supervisor; grava com revisão e recusa revisão velha',async()=>{
    expect((await put('OPERATOR',{revision:0,policy:policy()})).statusCode).toBe(403)
    const saved=await put('SUPERVISOR',{revision:0,policy:policy({waitMs:4000,overrides:{cam:{audioExpected:false}}})})
    expect(saved.statusCode,saved.body).toBe(200)
    expect(saved.json()).toMatchObject({revision:1,policy:{waitMs:4000},updatedBy:'supervisor'})
    expect((await put('SUPERVISOR',{revision:0,policy:policy()})).statusCode).toBe(409)
    const read=await server.inject({method:'GET',url:'/api/channels/ch/live-watchdog',headers:as('OPERATOR')})
    expect(read.json()).toMatchObject({revision:1,policy:{waitMs:4000,overrides:{cam:{audioExpected:false}}}})
    expect(app.sqlite.prepare("SELECT count(*) AS n FROM operator_decisions WHERE kind='LIVE_WATCHDOG_POLICY_CHANGED' AND actor_username='supervisor'").get()).toEqual({n:1})
  })
  it('validação: faixa, campos, entrada de outro canal, arte inexistente, slate ausente e contingência não verificada',async()=>{
    const invalid=await put('SUPERVISOR',{revision:0,policy:policy({waitMs:999_999})})
    expect(invalid.statusCode).toBe(400)
    expect(invalid.json().issues[0].path).toBe('policy.waitMs')
    expect((await put('SUPERVISOR',{revision:0,policy:{...policy(),inventado:true}})).statusCode).toBe(400)
    expect((await put('SUPERVISOR',{revision:0,policy:policy({overrides:{outra:{mode:'OFF'}}})})).statusCode).toBe(400)
    expect((await put('SUPERVISOR',{revision:0,policy:policy({waitArt:{kind:'GRAPHIC',templateId:'nao-existe'}})})).statusCode).toBe(400)
    const slate=await put('SUPERVISOR',{revision:0,policy:policy({mode:'AUTOMATIC'})})
    expect(slate.statusCode).toBe(409)
    expect(slate.json().error).toMatch(/apresentação técnica/)
    await app.db.insert(graphicTemplates).values({id:'arte',channelId:'ch',name:'Aguarde',svg:'<svg xmlns="http://www.w3.org/2000/svg"/>',fields:[],fadeMs:0,holdSeconds:null,createdAt:new Date().toISOString()} as never)
    const graphic=await put('SUPERVISOR',{revision:0,policy:policy({mode:'AUTOMATIC',waitArt:{kind:'GRAPHIC',templateId:'arte'}})})
    expect(graphic.statusCode,graphic.body).toBe(200)
    const reserve=await put('SUPERVISOR',{revision:1,policy:policy({contingencyRevisionId:'rev-inexistente'})})
    expect(reserve.statusCode).toBe(409)
    expect(reserve.json().error).toMatch(/Contingência recusada/)
  })
  it('comandos do operador: ação inválida 400; sem execução 404',async()=>{
    expect((await server.inject({method:'POST',url:'/api/channels/ch/live-watchdog/command',headers:as('OPERATOR'),payload:{action:'DESLIGAR'}})).statusCode).toBe(400)
    expect((await server.inject({method:'POST',url:'/api/channels/ch/live-watchdog/command',headers:as('OPERATOR'),payload:{action:'RETURN_NOW'}})).statusCode).toBe(404)
    expect((await server.inject({method:'POST',url:'/api/channels/ch/live-watchdog/command',payload:{action:'RETURN_NOW'}})).statusCode).toBe(401)
  })
})
