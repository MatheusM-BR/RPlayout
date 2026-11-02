import Fastify,{type FastifyInstance} from 'fastify'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {createApp,runtimeFor,ChannelRuntime,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {configurationRevision} from '../db/channel-configuration.js'
import {channelConfigurationETag} from '@rplayout/protocol'
import {channels,rundowns,operatorDecisions,channelCadenceConversions} from '../db/schema.js'
import {getChannel} from '../db/repo.js'
import {eq} from 'drizzle-orm'
import {sessionDigest} from './access.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
let app:App,server:FastifyInstance
beforeEach(async()=>{
  app=await createApp(':memory:');const now=new Date().toISOString()
  for(const id of ['ch','other']){
    app.db.insert(channels).values({id,name:id,width:320,height:180,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:now}).run()
    app.db.insert(rundowns).values({id:`rd-${id}`,channelId:id,name:id,date:'2026-10-03',plannedStart:0,loop:false,createdAt:now,updatedAt:now}).run()
  }
  server=Fastify();registerRoutes(app,server,()=>{});await server.ready()
  await (await runtimeFor(app,'ch'))!.load('rd-ch')
})
afterEach(async()=>{vi.restoreAllMocks();await server.close();app.close()})
const headers=(id='ch')=>({'if-match':channelConfigurationETag(id,configurationRevision(app.db,id))})
const patch=(payload:object,version:Record<string,string>|undefined=headers())=>server.inject({method:'PATCH',url:'/api/channels/ch',payload,headers:version})
const decisions=()=>app.db.select().from(operatorDecisions).where(eq(operatorDecisions.kind,'CHANNEL_CONFIGURATION_CHANGED')).all()

describe('confirmação da configuração vista pelo operador',()=>{
  it('consulta possui ETag do canal, sem escrita, CUE ou auditoria',async()=>{
    const before=await getChannel(app.db,'ch'),runtime=app.runtimes.get('ch')!,transport=runtime.transport.state()
    const response=await server.inject({url:'/api/channels/ch/configuration'})
    expect(response.statusCode,response.body).toBe(200);expect(response.headers.etag).toBe(headers()['if-match'])
    expect(response.json().channel).toEqual(before);expect(response.headers['cache-control']).toBe('private, no-store')
    expect(await getChannel(app.db,'ch')).toEqual(before);expect(decisions()).toHaveLength(0)
    expect(runtime.transport.state()).toEqual(transport)
  })
  it.each([undefined,'*','w/"1"','"channel:ch:0"','"channel:ch:01"','"channel:ch:9007199254740992"','"channel:other:1"','"channel:ch:1", "channel:ch:2"'])('rejeita escrita sem revisão ou malformada %s sem reconstrução',async(value)=>{
    const before=await getChannel(app.db,'ch'),runtime=app.runtimes.get('ch')!,close=vi.spyOn(runtime,'close')
    const response=await server.inject({method:'PATCH',url:'/api/channels/ch',payload:{width:640},...(value===undefined?{}:{headers:{'if-match':value}})})
    expect(response.statusCode,response.body).toBe(value===undefined?428:400)
    expect(await getChannel(app.db,'ch')).toEqual(before);expect(close).not.toHaveBeenCalled();expect(decisions()).toHaveLength(0)
  })
  it('revisão superada e ABA são recusadas sem perder os dados atuais',async()=>{
    const old=headers(),runtime=app.runtimes.get('ch')!,close=vi.spyOn(runtime,'close')
    app.sqlite.exec("UPDATE channels SET name='Outro operador' WHERE id='ch'; UPDATE channels SET name='ch' WHERE id='ch'")
    const before=await getChannel(app.db,'ch'),response=await patch({width:640},old)
    expect(response.statusCode).toBe(409);expect(response.json().configurationRevision).toBe(before!.configurationRevision)
    expect(await getChannel(app.db,'ch')).toEqual(before);expect(close).not.toHaveBeenCalled();expect(decisions()).toHaveLength(0)
  })
  it('saída alterada invalida revisão mesmo que os campos de formato permaneçam iguais',async()=>{
    const old=headers()
    app.sqlite.exec("INSERT INTO output_profiles(id,channel_id,name,kind,target,enabled,created_at) VALUES('out','ch','Arquivo','FILE','qa.mkv',0,'now')")
    expect((await patch({targetLufs:-24},old)).statusCode).toBe(409)
    expect((await getChannel(app.db,'ch'))!.targetLufs).toBe(-23);expect(decisions()).toHaveLength(0)
  })
  it('somente uma de duas confirmações da mesma revisão grava e audita',async()=>{
    const old=headers(),result=await Promise.all([patch({width:640},old),patch({width:800},old)])
    expect(result.map(row=>row.statusCode).sort()).toEqual([200,409]);expect(decisions()).toHaveLength(1)
    const current=(await getChannel(app.db,'ch'))!
    expect([640,800]).toContain(current.width);expect(current.configurationRevision).toBe(2)
    expect(decisions()[0]!.payload).toMatchObject({channelId:'ch',fields:['width'],formatChanged:true})
    expect(decisions()[0]!.payload).toMatchObject({revisionBefore:1,revisionAfter:2,before:{width:320},after:{width:current.width}})
  })
  it('falha da auditoria reverte configuração, revisões editoriais e counter, sem fechar engine',async()=>{
    const before=await getChannel(app.db,'ch'),version=app.concurrency.getRundownVersion('rd-ch'),close=vi.spyOn(app.runtimes.get('ch')!,'close')
    app.sqlite.exec("CREATE TRIGGER fail_configuration_audit BEFORE INSERT ON operator_decisions WHEN NEW.kind='CHANNEL_CONFIGURATION_CHANGED' BEGIN SELECT RAISE(ABORT,'QA audit rollback'); END")
    const response=await patch({width:640})
    expect(response.statusCode,response.body).toBe(409);expect(response.body).toContain('QA audit rollback')
    expect(await getChannel(app.db,'ch')).toEqual(before);expect(app.concurrency.getRundownVersion('rd-ch')).toBe(version)
    expect(close).not.toHaveBeenCalled();expect(decisions()).toHaveLength(0)
  })
  it.each(['sessão','papel','canal'])('revalida %s na fila antes do commit e não converte 403 em 409',async(condition)=>{
    const token='configuration-session',now=new Date().toISOString()
    app.sqlite.prepare('INSERT INTO users(id,username,password_hash,role,enabled,created_at) VALUES(?,?,?,?,1,?)').run('user','editor','unused','ADMIN',now)
    app.sqlite.prepare('INSERT INTO sessions(token,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(sessionDigest(token),'user',new Date(Date.now()+60_000).toISOString(),now)
    const opening={...headers(),cookie:`rplayout_session=${token}`},before=await getChannel(app.db,'ch')
    vi.spyOn(app.runtimes.get('ch')!,'assertReconfigurationReady').mockImplementation(()=>{
      if(condition==='sessão')app.sqlite.exec('DELETE FROM sessions')
      if(condition==='papel')app.sqlite.exec("UPDATE users SET role='OPERATOR' WHERE id='user'")
      if(condition==='canal')app.sqlite.prepare('INSERT INTO user_access(user_id,channel_ids,station_ips,updated_at) VALUES(?,?,NULL,?)').run('user',JSON.stringify(['other']),now)
    })
    const result=await patch({width:640},opening)
    expect(result.statusCode,result.body).toBe(403);expect(await getChannel(app.db,'ch')).toEqual(before);expect(decisions()).toHaveLength(0)
  })
  it('grava somente campos solicitados e relata falha de reconstrução como commit realizado',async()=>{
    vi.spyOn(app.runtimes.get('ch')!,'close').mockImplementation(()=>{throw new Error('QA rebuild failure')})
    const response=await patch({width:640})
    expect(response.statusCode,response.body).toBe(200);expect(response.json()).toMatchObject({ok:true,applied:true,formatChanged:true,engineError:'QA rebuild failure',configurationRevision:2})
    expect(await getChannel(app.db,'ch')).toMatchObject({width:640,name:'ch',height:180,targetLufs:-23})
    expect(await getChannel(app.db,'other')).toMatchObject({width:320,configurationRevision:1});expect(decisions()).toHaveLength(1)
  })
  it('recuperação recusada após rebuild permanece erro explícito, não sucesso do engine',async()=>{
    vi.spyOn(ChannelRuntime.prototype,'recoverCheckpoint').mockImplementation(async function(this:ChannelRuntime){this.recoveryError='QA recuperação recusada';return false})
    const response=await patch({width:640})
    expect(response.statusCode,response.body).toBe(200)
    expect(response.json()).toMatchObject({applied:true,engineError:'QA recuperação recusada',recoveryError:'QA recuperação recusada'})
    expect(await getChannel(app.db,'ch')).toMatchObject({width:640})
  })
  it('cadência exige revisão original e sela também o formato confirmado',async()=>{
    const body={rateNum:50,rateDen:1,format:{width:640,name:'QC 50'}},opening=headers()
    const missing=await server.inject({method:'POST',url:'/api/channels/ch/cadence-preview',payload:body})
    expect(missing.statusCode).toBe(428)
    const report=(await server.inject({method:'POST',url:'/api/channels/ch/cadence-preview',headers:opening,payload:body})).json().report
    const changed=await server.inject({method:'POST',url:'/api/channels/ch/cadence-convert',headers:opening,payload:{...body,format:{width:800,name:'QC 50'},fingerprint:report.fingerprint,confirm:true}})
    expect(changed.statusCode,changed.body).toBe(409)
    expect(app.db.select().from(channelCadenceConversions).all()).toHaveLength(0)
    const applied=await server.inject({method:'POST',url:'/api/channels/ch/cadence-convert',headers:opening,payload:{...body,fingerprint:report.fingerprint,confirm:true}})
    expect(applied.statusCode,applied.body).toBe(200)
    expect(await getChannel(app.db,'ch')).toMatchObject({width:640,name:'QC 50',rate:{num:50,den:1}})
  })
  it('consulta de configuração respeita acesso ao canal e conta revogada',async()=>{
    const token='read-config-session',now=new Date().toISOString()
    app.sqlite.prepare('INSERT INTO users(id,username,password_hash,role,enabled,created_at) VALUES(?,?,?,?,1,?)').run('limited','limited','unused','SUPERVISOR',now)
    app.sqlite.prepare('INSERT INTO sessions(token,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(sessionDigest(token),'limited',new Date(Date.now()+60_000).toISOString(),now)
    app.sqlite.prepare('INSERT INTO user_access(user_id,channel_ids,station_ips,updated_at) VALUES(?,?,NULL,?)').run('limited',JSON.stringify(['other']),now)
    const auth={cookie:`rplayout_session=${token}`}
    expect((await server.inject({url:'/api/channels/ch/configuration',headers:auth})).statusCode).toBe(403)
    expect((await server.inject({url:'/api/channels/other/configuration',headers:auth})).statusCode).toBe(200)
    app.sqlite.exec('DELETE FROM sessions')
    expect((await server.inject({url:'/api/channels/other/configuration',headers:auth})).statusCode).toBe(401)
  })
})
