import Fastify,{type FastifyInstance} from 'fastify'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {createApp,runtimeFor,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {channels,operatorDecisions} from '../db/schema.js'
import {EngineTransport} from './engine.js'
import {sessionDigest} from './access.js'
import {NativeLiveReplacementUnknown} from './native-live-replacement.js'
import type {NativeReplacementAuthorization,NativeReplacementSession} from './native-live-replacement-session.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',RELAY_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))

let app:App,server:FastifyInstance
const TX='A'.repeat(43)
beforeEach(async()=>{
 app=await createApp(':memory:');const now=new Date().toISOString()
 for(const ch of ['ch','other'])app.db.insert(channels).values({id:ch,name:ch,width:320,height:180,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:now}).run()
 await runtimeFor(app,'ch')
 server=Fastify();registerRoutes(app,server,()=>{});await server.ready()
})
afterEach(async()=>{vi.restoreAllMocks();await server.close();app.close()})
const user=(role:string,channelIds:string[]|null=null)=>{
 const now=new Date().toISOString(),token='session-'+role
 app.sqlite.prepare('INSERT INTO users(id,username,password_hash,role,enabled,created_at) VALUES(?,?,?,?,1,?)').run('u-'+role,'u-'+role,'unused',role,now)
 if(channelIds)app.sqlite.prepare('INSERT INTO user_access(user_id,channel_ids,station_ips,updated_at) VALUES(?,?,NULL,?)').run('u-'+role,JSON.stringify(channelIds),now)
 app.sqlite.prepare('INSERT INTO sessions(token,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(sessionDigest(token),'u-'+role,new Date(Date.now()+60_000).toISOString(),now)
 return {cookie:`rplayout_session=${token}`}
}
const journalRows=()=>app.db.select().from(operatorDecisions).all().filter(row=>row.kind==='NATIVE_LIVE_REPLACEMENT_V1')
/** Native double: real routes, factory replaced to observe the per-command authorization. */
function nativeRuntime(session:Partial<NativeReplacementSession>){
 const runtime=app.runtimes.get('ch')!,simulated=runtime.transport,double=Object.create(EngineTransport.prototype)
 for(const key of Object.getOwnPropertyNames(Object.getPrototypeOf(simulated)))if(key!=='constructor'&&typeof(simulated as any)[key]==='function')double[key]=(simulated as any)[key].bind(simulated)
 double.closeGracefully=async()=>({ownedNativeProcessesStopped:true,graceful:true,forceRequested:false});double.closeConfirmed=async()=>{}
 Object.defineProperty(runtime,'transport',{value:double})
 let captured:NativeReplacementAuthorization|null=null
 const factory=vi.spyOn(runtime,'nativeReplacementSession').mockImplementation((_actor,authorize)=>{captured=authorize;return session as NativeReplacementSession})
 return {factory,authorize:()=>captured!('ch')}
}

describe('rotas da troca nativa de fonte da live (sem mídia física)',()=>{
 it('canal simulado recusa sem escrever journal nem comando',async()=>{
  const res=await server.inject({method:'POST',url:'/api/channels/ch/live-replacement',payload:{targetSourceId:'backup'},headers:{'idempotency-key':'k-1'}})
  expect(res.statusCode,res.body).toBe(409);expect(res.json().error).toContain('engine nativo')
  expect(journalRows()).toEqual([])
 })
 it('valida corpo, transação, operação e confirmação explícita antes do runtime',async()=>{
  expect((await server.inject({method:'POST',url:'/api/channels/ch/live-replacement',payload:{targetSourceId:'backup',extra:1}})).statusCode).toBe(400)
  expect((await server.inject({method:'POST',url:'/api/channels/ch/live-replacement/curto/commit',payload:{confirm:true}})).statusCode).toBe(400)
  expect((await server.inject({method:'POST',url:`/api/channels/ch/live-replacement/${TX}/take`,payload:{confirm:true}})).statusCode).toBe(400)
  expect((await server.inject({method:'POST',url:`/api/channels/ch/live-replacement/${TX}/commit`,payload:{}})).statusCode).toBe(400)
 })
 it('usuário restrito a outro canal é recusado antes da fábrica',async()=>{
  const {factory}=nativeRuntime({prepare:vi.fn()})
  const res=await server.inject({method:'POST',url:'/api/channels/ch/live-replacement',payload:{targetSourceId:'backup'},headers:{...user('OPERATOR',['other']),'idempotency-key':'k-2'}})
  expect(res.statusCode,res.body).toBe(403);expect(factory).not.toHaveBeenCalled()
 })
 it('operador pode preparar; a autorização entregue à fábrica é reavaliada a cada comando',async()=>{
  const headers=user('OPERATOR')
  let probe:(()=>void)|null=null
  const {factory,authorize}=nativeRuntime({prepare:vi.fn(async()=>{probe=authorize;authorize();return {transactionId:TX,replayed:false} as never})})
  const res=await server.inject({method:'POST',url:'/api/channels/ch/live-replacement',payload:{targetSourceId:'backup'},headers:{...headers,'idempotency-key':'k-3'}})
  expect(res.statusCode,res.body).toBe(200);expect(factory).toHaveBeenCalledWith({id:'u-OPERATOR',name:'u-OPERATOR'},expect.any(Function))
  app.sqlite.exec('DELETE FROM sessions')
  expect(()=>probe!()).toThrow()
 })
 it('papel retirado depois da criação também é recusado na reavaliação',async()=>{
  const headers=user('OPERATOR')
  let probe:(()=>void)|null=null
  const {authorize}=nativeRuntime({prepare:vi.fn(async()=>{probe=authorize;return {transactionId:TX} as never})})
  await server.inject({method:'POST',url:'/api/channels/ch/live-replacement',payload:{targetSourceId:'backup'},headers:{...headers,'idempotency-key':'k-4'}})
  app.sqlite.prepare("UPDATE users SET enabled=0 WHERE id='u-OPERATOR'").run()
  expect(()=>probe!()).toThrow()
 })
 it('COMMIT sem confirmação nativa responde 409 e não declara saída física',async()=>{
  nativeRuntime({commit:vi.fn(async()=>({transactionId:TX,nativeProgramConfirmed:false,physicalOutputValidated:false}) as never)})
  const res=await server.inject({method:'POST',url:`/api/channels/ch/live-replacement/${TX}/commit`,payload:{confirm:true}})
  expect(res.statusCode,res.body).toBe(409);expect(res.json()).toMatchObject({nativeProgramConfirmed:false,physicalOutputValidated:false})
 })
 it('resultado desconhecido é marcado e não sugere reenvio',async()=>{
  nativeRuntime({commit:vi.fn(async()=>{throw new NativeLiveReplacementUnknown()})})
  const res=await server.inject({method:'POST',url:`/api/channels/ch/live-replacement/${TX}/commit`,payload:{confirm:true}})
  expect(res.statusCode).toBe(409);expect(res.json()).toMatchObject({outcomeUnknown:true,nativeProgramConfirmed:false})
  expect(res.json().error).toContain('sem reenviar COMMIT')
 })
 it('o failover manual existente continua só metadado e não chama a fábrica',async()=>{
  const {factory}=nativeRuntime({})
  await server.inject({method:'POST',url:'/api/sources/live/qualquer/force-failover',payload:{}})
  expect(factory).not.toHaveBeenCalled()
 })
})
