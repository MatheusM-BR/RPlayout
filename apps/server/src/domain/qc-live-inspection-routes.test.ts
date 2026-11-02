import Fastify,{type FastifyInstance} from 'fastify'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {createApp,runtimeFor,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {channels} from '../db/schema.js'
import {sessionDigest} from './access.js'
import {sourceWire} from './source-wire.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
let app:App,server:FastifyInstance
const viewerId='77777777-7777-4777-8777-777777777777',raw='srt://127.0.0.1:9000?passphrase=PRIVATE_QC_SECRET'
beforeEach(async()=>{
  app=await createApp(':memory:')
  for(const id of ['ch','other'])app.db.insert(channels).values({id,name:id,width:320,height:180,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:new Date().toISOString()}).run()
  await runtimeFor(app,'ch');server=Fastify();registerRoutes(app,server,()=>{});await server.ready()
})
afterEach(async()=>{await server.close();app.close();vi.restoreAllMocks()})
const watch=(payload:object,headers?:Record<string,string>,id='ch')=>server.inject({method:'POST',url:`/api/channels/${id}/qc/inspection`,payload,headers})
describe('API de inspeção live não é comando de comutação',()=>{
  it('fonte cifrada é resolvida somente na fronteira privada, com owner e limites públicos',async()=>{
    const runtime=app.runtimes.get('ch')!,spy=vi.spyOn(runtime.qcInspection,'watch').mockResolvedValue(undefined),cue=vi.spyOn(runtime.transport,'cue'),take=vi.spyOn(runtime.transport,'take')
    const response=await watch({viewerId,sourceRef:sourceWire().reference(raw),watching:true})
    expect(response.statusCode,response.body).toBe(200);expect(response.json()).toMatchObject({rendition:'qc-encoded',profileFromSource:true,maxWidth:3840,maxHeight:2160,maxFps:60,maxBitrateKbps:50000})
    expect(spy).toHaveBeenCalledWith(expect.stringContaining(viewerId),raw,true,expect.any(Function))
    expect(response.body).not.toContain('PRIVATE_QC_SECRET');expect(cue).not.toHaveBeenCalled();expect(take).not.toHaveBeenCalled()
    const audit=app.sqlite.prepare("SELECT payload FROM operator_decisions WHERE kind='API_MUTATION'").all()
    expect(JSON.stringify(audit)).not.toContain('PRIVATE_QC_SECRET')
  })
  it('simulado não passa como inspeção nativa nem altera CUE/PGM',async()=>{
    const runtime=app.runtimes.get('ch')!;await runtime.transport.cue({kind:'SOURCE',source:'ndi:LIVE'})
    const before=runtime.transport.state(),response=await watch({viewerId,sourceRef:'ndi:LIVE',watching:true})
    expect(response.statusCode).toBe(409);expect(response.body).toContain('engine e servidor de mídia')
    expect(runtime.transport.state()).toEqual(before)
  })
  it('pedido antigo ou malformado não chama controle nativo',async()=>{
    const runtime=app.runtimes.get('ch')!,spy=vi.spyOn(runtime.qcInspection,'watch')
    for(const payload of [{viewerId,sourceRef:'ndi:LIVE',watching:true,extra:true},{viewerId:'bad',sourceRef:'ndi:LIVE',watching:true},{viewerId,sourceRef:'srt:protected:v1:invalid',watching:true}])expect((await watch(payload)).statusCode).toBe(400)
    expect(spy).not.toHaveBeenCalled()
    expect((await watch({viewerId,sourceRef:'ndi:OLD',watching:true})).statusCode).toBe(409)
    expect((await watch({viewerId,sourceRef:'ndi:OLD',watching:false})).statusCode).toBe(200)
  })
  it('canal/estação/origem continuam obrigatórios; sessão diferencia viewers com o mesmo UUID',async()=>{
    const now=new Date().toISOString(),token='qc-session'
    app.sqlite.prepare('INSERT INTO users(id,username,password_hash,role,enabled,created_at) VALUES(?,?,?,?,1,?)').run('user','qc','unused','OPERATOR',now)
    app.sqlite.prepare('INSERT INTO sessions(token,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(sessionDigest(token),'user','2099-01-01',now)
    app.sqlite.prepare('INSERT INTO user_access(user_id,channel_ids,station_ips,updated_at) VALUES(?,?,?,?)').run('user',JSON.stringify(['other']),null,now)
    const spy=vi.spyOn(app.runtimes.get('ch')!.qcInspection,'watch').mockResolvedValue(undefined),payload={viewerId,sourceRef:'ndi:LIVE',watching:true},headers={cookie:`rplayout_session=${token}`}
    expect((await watch(payload,headers)).statusCode).toBe(403);expect(spy).not.toHaveBeenCalled()
    app.sqlite.prepare('UPDATE user_access SET channel_ids=NULL WHERE user_id=?').run('user')
    expect((await watch(payload,{...headers,origin:'https://foreign.invalid',host:'localhost'})).statusCode).toBe(403)
    expect((await watch(payload,headers)).statusCode).toBe(200);expect(spy).toHaveBeenLastCalledWith(`${sessionDigest(token)}:${viewerId}`,'ndi:LIVE',true,expect.any(Function))
    expect((await watch(payload)).statusCode).toBe(401)
    const second='another-session'
    app.sqlite.prepare('INSERT INTO sessions(token,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(sessionDigest(second),'user','2099-01-01',now)
    expect((await watch(payload,{cookie:`rplayout_session=${second}`})).statusCode).toBe(200)
    expect(spy).toHaveBeenLastCalledWith(`${sessionDigest(second)}:${viewerId}`,'ndi:LIVE',true,expect.any(Function))
    app.sqlite.prepare('UPDATE user_access SET station_ips=? WHERE user_id=?').run(JSON.stringify(['192.0.2.3']),'user')
    expect((await watch(payload,headers)).statusCode).toBe(401)
  })
})
