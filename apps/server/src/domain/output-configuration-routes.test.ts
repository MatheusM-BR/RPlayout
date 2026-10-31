import Fastify,{type FastifyInstance} from 'fastify'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {eq} from 'drizzle-orm'
import {channelConfigurationETag} from '@rplayout/protocol'
import {createApp,runtimeFor,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {channels,outputProfiles,operatorDecisions} from '../db/schema.js'
import {configurationRevision} from '../db/channel-configuration.js'
import {EngineTransport,type HotOutputProfile} from './engine.js'
import {sessionDigest} from './access.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',RELAY_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
let app:App,server:FastifyInstance,apply:ReturnType<typeof vi.fn>,commit:ReturnType<typeof vi.fn>
const target='srt://localhost:9000?mode=caller&passphrase=PRIVATE_OUTPUT',next='srt://localhost:9001?mode=caller&passphrase=PRIVATE_NEXT'
beforeEach(async()=>{
  app=await createApp(':memory:');const now=new Date().toISOString()
  for(const id of ['ch','other'])app.db.insert(channels).values({id,name:id,width:1920,height:1080,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:now}).run()
  app.db.insert(outputProfiles).values({id:'out',channelId:'ch',name:'SRT',kind:'SRT',role:'EXTRA',target,enabled:true,createdAt:now}).run()
  const runtime=(await runtimeFor(app,'ch'))!,simulated=runtime.transport,native=Object.create(EngineTransport.prototype)
  // Deterministic protocol ACK double, not a physical transmitter.
  for(const key of Object.getOwnPropertyNames(Object.getPrototypeOf(simulated)))if(key!=='constructor' && typeof (simulated as any)[key]==='function')native[key]=(simulated as any)[key].bind(simulated)
  apply=vi.fn(async(_profile:HotOutputProfile)=>{});commit=vi.fn()
  native.mutateConfiguration=async(action:(sendOutput:(profile:HotOutputProfile)=>Promise<void>)=>Promise<unknown>)=>action(apply)
  native.processId=()=>null;native.commitOutputProfile=commit;native.closeGracefully=async()=>({ownedNativeProcessesStopped:true,graceful:true,forceRequested:false})
  Object.defineProperty(runtime,'transport',{value:native})
  server=Fastify();registerRoutes(app,server,()=>{});await server.ready()
})
afterEach(async()=>{vi.restoreAllMocks();await server.close();app.close()})
const headers=(id='ch')=>({'if-match':channelConfigurationETag(id,configurationRevision(app.db,id))})
const profile=()=>app.db.select().from(outputProfiles).where(eq(outputProfiles.id,'out')).get()!
const patch=(body:object={target:next},proof:Record<string,string>={...headers()})=>server.inject({method:'PATCH',url:'/api/outputs/out',payload:body,headers:proof})
const audit=()=>app.db.select().from(operatorDecisions).all().filter(row=>row.kind==='OUTPUT_UPDATED')

describe('configuração de saída confirma versão e compensa efeitos sem fingir rollback físico',()=>{
  it('snapshot privado retorna prova em cada saída, sem comando nem segredo',async()=>{
    const response=await server.inject('/api/channels/ch/outputs')
    expect(response.statusCode).toBe(200);expect(response.headers.etag).toBe(headers()['if-match'])
    expect(response.headers['cache-control']).toBe('private, no-store')
    expect(response.json()).toMatchObject({configurationRevision:configurationRevision(app.db,'ch'),outputs:[{id:'out',configurationRevision:configurationRevision(app.db,'ch')}],configurationOperation:{state:'IDLE'}})
    expect(response.body).not.toContain('PRIVATE_');expect(apply).not.toHaveBeenCalled()
  })
  it.each(['create','patch','delete'] as const)('%s exige revisão original antes de comandos/auditoria',async action=>{
    const request={method:action==='create'?'POST':action==='patch'?'PATCH':'DELETE',url:action==='create'?'/api/channels/ch/outputs':'/api/outputs/out',...(action==='delete'?{}:{payload:action==='create'?{name:'Novo',kind:'SRT',target:next}:{target:next}})} as const
    for(const [proof,status] of [[{},428],[{'if-match':'*'},400],[headers('other'),400]] as const){
      const response=await server.inject({...request,headers:proof});expect(response.statusCode,response.body).toBe(status)
    }
    expect(profile().target).toBe(target);expect(app.db.select().from(outputProfiles).all()).toHaveLength(1);expect(apply).not.toHaveBeenCalled();expect(audit()).toHaveLength(0)
  })
  it('ABA invalida o rascunho e não despacha publisher',async()=>{
    const proof=headers()
    app.db.update(outputProfiles).set({name:'Temporário'}).where(eq(outputProfiles.id,'out')).run()
    app.db.update(outputProfiles).set({name:'SRT'}).where(eq(outputProfiles.id,'out')).run()
    expect((await patch({target:next},proof)).statusCode).toBe(409);expect(apply).not.toHaveBeenCalled()
  })
  it.each(['create','delete'] as const)('falha na auditoria %s não deixa mudança parcial nem reinício',async action=>{
    const before=configurationRevision(app.db,'ch'),close=vi.spyOn(app.runtimes.get('ch')!,'close')
    app.sqlite.exec(`CREATE TRIGGER qa_atomic BEFORE INSERT ON operator_decisions WHEN NEW.kind='OUTPUT_${action==='create'?'CREATED':'REMOVED'}' BEGIN SELECT RAISE(ABORT,'QA atomic audit'); END`)
    const result=await server.inject({method:action==='create'?'POST':'DELETE',url:action==='create'?'/api/channels/ch/outputs':'/api/outputs/out',headers:headers(),...(action==='create'?{payload:{name:'Novo',kind:'SRT',target:next}}:{})})
    expect(result.statusCode,result.body).toBe(409);expect(configurationRevision(app.db,'ch')).toBe(before);expect(app.db.select().from(outputProfiles).all()).toHaveLength(1);expect(close).not.toHaveBeenCalled();expect(apply).not.toHaveBeenCalled()
  })
  it('duas confirmações não sobrepõem publisher durante ACK lento',async()=>{
    let release!:()=>void,entered!:()=>void
    const started=new Promise<void>(resolve=>entered=resolve),waiting=new Promise<void>(resolve=>release=resolve)
    apply.mockImplementationOnce(async()=>{entered();await waiting})
    const proof=headers(),first=patch({target:next},proof);first.then(()=>{})
    await started
    const second=await patch({target:'srt://localhost:9999'},proof)
    expect(second.statusCode,second.body).toBe(409);expect(apply).toHaveBeenCalledTimes(1)
    release();expect((await first).statusCode).toBe(200);expect(profile().target).toBe(next)
  })
  it('ACK e commit preservam runtime e atualizam o perfil de watchdog depois da transação',async()=>{
    const before=configurationRevision(app.db,'ch'),runtime=app.runtimes.get('ch')!,close=vi.spyOn(runtime,'close')
    apply.mockImplementation(async()=>{expect(profile().target).toBe(target);expect(audit()).toHaveLength(0);expect(commit).not.toHaveBeenCalled();expect(app.configurationChanges.status('ch')).toMatchObject({state:'APPLYING',phase:'HOT_DISPATCHED'})})
    commit.mockImplementation(()=>{expect(profile().target).toBe(next);expect(audit()).toHaveLength(1)})
    const response=await patch()
    expect(response.statusCode,response.body).toBe(200);expect(response.json()).toMatchObject({applied:'hot',restartRequired:false,configurationRevision:before+1,physicalOutputValidated:false})
    expect(app.runtimes.get('ch')).toBe(runtime);expect(close).not.toHaveBeenCalled();expect(apply).toHaveBeenCalledTimes(1);expect(commit).toHaveBeenCalledTimes(1)
    expect(app.configurationChanges.status('ch').state).toBe('IDLE')
    const publicAudit=await server.inject('/api/audit?channelId=ch');expect(publicAudit.statusCode).toBe(200);expect(publicAudit.body).not.toContain('PRIVATE_')
  })
  it('falha de auditoria reverte DB/contador e restaura o publisher anterior por ACK',async()=>{
    const before=configurationRevision(app.db,'ch')
    app.sqlite.exec("CREATE TRIGGER qa_output_audit BEFORE INSERT ON operator_decisions WHEN NEW.kind='OUTPUT_UPDATED' BEGIN SELECT RAISE(ABORT,'QA atomic audit'); END")
    const result=await patch()
    expect(result.statusCode,result.body).toBe(409);expect(result.json()).toMatchObject({previousProfileRestored:true,physicalOutputValidated:false})
    expect(apply.mock.calls.map(call=>call[0].target)).toEqual([next,target]);expect(profile().target).toBe(target);expect(configurationRevision(app.db,'ch')).toBe(before);expect(audit()).toHaveLength(0);expect(commit).not.toHaveBeenCalled();expect(app.configurationChanges.status('ch').state).toBe('IDLE')
  })
  it.each(['sessão','papel','canal'])('reconfere %s após ACK; não grava e restaura a saída anterior',async condition=>{
    const now=new Date().toISOString(),token='output-session'
    app.sqlite.prepare('INSERT INTO users(id,username,password_hash,role,enabled,created_at) VALUES(?,?,?,?,1,?)').run('editor','editor','unused','ADMIN',now)
    app.sqlite.prepare('INSERT INTO sessions(token,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(sessionDigest(token),'editor',new Date(Date.now()+60_000).toISOString(),now)
    apply.mockImplementationOnce(async()=>{
      if(condition==='sessão')app.sqlite.exec('DELETE FROM sessions')
      if(condition==='papel')app.sqlite.exec("UPDATE users SET role='OPERATOR' WHERE id='editor'")
      if(condition==='canal')app.sqlite.prepare('INSERT INTO user_access(user_id,channel_ids,station_ips,updated_at) VALUES(?,?,NULL,?)').run('editor',JSON.stringify(['other']),now)
    })
    const result=await patch({target:next},{...headers(),cookie:`rplayout_session=${token}`})
    expect(result.statusCode,result.body).toBe(403);expect(result.json().previousProfileRestored).toBe(true);expect(profile().target).toBe(target);expect(apply).toHaveBeenCalledTimes(2);expect(audit()).toHaveLength(0)
  })
  it('falha de comando também compensa porque rejeição pode ter ocorrido depois de retirar a saída',async()=>{
    apply.mockRejectedValueOnce(new Error('failed srt://host:1?passphrase=PRIVATE_OUTPUT'))
    const result=await patch();expect(result.statusCode).toBe(409);expect(result.body).not.toContain('PRIVATE_');expect(result.json().previousProfileRestored).toBe(true)
    expect(apply).toHaveBeenCalledTimes(2);expect(profile().target).toBe(target)
  })
  it('retorno sem ACK persiste incerteza, bloqueia próximos comandos e exige reconciliação parada',async()=>{
    apply.mockRejectedValue(new Error('timeout'))
    const result=await patch();expect(result.statusCode).toBe(409);expect(result.json().configurationUncertain).toBe(true)
    const status=app.configurationChanges.status('ch');expect(status).toMatchObject({state:'UNCERTAIN',reconcilable:true})
    expect(profile().target).toBe(target);expect(commit).not.toHaveBeenCalled()
    await patch();expect(apply).toHaveBeenCalledTimes(2)
    const reconciled=await server.inject({method:'POST',url:'/api/channels/ch/configuration-operation/reconcile',headers:headers(),payload:{runId:status.runId,confirm:true}})
    expect(reconciled.statusCode,reconciled.body).toBe(200);expect(reconciled.json()).toMatchObject({automaticTake:false,physicalOutputValidated:false})
    expect(app.configurationChanges.status('ch').state).toBe('IDLE');expect(app.runtimes.get('ch')!.transport.state()).toMatchObject({playing:false,onAir:null,preview:null})
  })
  it('escritor fora da cerca durante ACK não é sobrescrito por compensação',async()=>{
    apply.mockImplementationOnce(async()=>{app.db.update(outputProfiles).set({target:'srt://localhost:9002'}).where(eq(outputProfiles.id,'out')).run()})
    const result=await patch();expect(result.statusCode).toBe(409);expect(result.json().configurationUncertain).toBe(true)
    expect(profile().target).toBe('srt://localhost:9002');expect(apply).toHaveBeenCalledTimes(1);expect(audit()).toHaveLength(0)
  })
  it.each(['playing','onAir','preview'] as const)('reconciliação recusa %s sem fechar canal ou repetir publisher',async field=>{
    apply.mockRejectedValue(new Error('timeout'));await patch()
    const runtime=app.runtimes.get('ch')!,close=vi.spyOn(runtime,'close'),status=app.configurationChanges.status('ch'),state=runtime.transport.state()
    vi.spyOn(runtime.transport,'state').mockReturnValue({...state,...(field==='playing'?{playing:true}:field==='onAir'?{onAir:{itemId:'vt',elapsed:1} as any}:{preview:{kind:'ASSET',id:'qc'}})})
    const result=await server.inject({method:'POST',url:'/api/channels/ch/configuration-operation/reconcile',headers:headers(),payload:{runId:status.runId,confirm:true}})
    expect(result.statusCode,result.body).toBe(409);expect(close).not.toHaveBeenCalled();expect(apply).toHaveBeenCalledTimes(2);expect(app.configurationChanges.status('ch').state).toBe('UNCERTAIN')
  })
  it('reconciliação conserva pendência se a prova da configuração ficou antiga',async()=>{
    apply.mockRejectedValue(new Error('timeout'));await patch()
    const status=app.configurationChanges.status('ch'),proof=headers(),close=vi.spyOn(app.runtimes.get('ch')!,'close')
    app.db.update(outputProfiles).set({name:'Novo nome'}).where(eq(outputProfiles.id,'out')).run()
    const result=await server.inject({method:'POST',url:'/api/channels/ch/configuration-operation/reconcile',headers:proof,payload:{runId:status.runId,confirm:true}})
    expect(result.statusCode,result.body).toBe(409);expect(close).not.toHaveBeenCalled();expect(app.configurationChanges.status('ch').state).toBe('UNCERTAIN')
  })
  it('commit durável com falha do perfil de recuperação não anuncia reversão falsa',async()=>{
    commit.mockImplementation(()=>{throw new Error('startup mismatch')})
    const result=await patch();expect(result.statusCode).toBe(200);expect(result.json()).toMatchObject({applied:'hot',configurationUncertain:true,physicalOutputValidated:false})
    expect(profile().target).toBe(next);expect(audit()).toHaveLength(1);expect(app.configurationChanges.status('ch').state).toBe('UNCERTAIN')
  })
  it('preview full/null/inconsistente é recusado antes de qualquer comando; PGM não muda',async()=>{
    app.db.update(outputProfiles).set({role:'PREVIEW',target:'',width:426,height:240,rateNum:15,rateDen:1,scan:'PROGRESSIVE',bitrateKbps:450}).where(eq(outputProfiles.id,'out')).run()
    for(const body of [{bitrateKbps:6000},{bitrateKbps:null},{width:1920},{height:null},{rateNum:60},{scan:'INTERLACED'},{rateDen:null}]){
      const result=await patch(body);expect(result.statusCode,result.body).toBe(400)
    }
    expect(apply).not.toHaveBeenCalled();expect(profile().bitrateKbps).toBe(450)
    expect((await server.inject({method:'DELETE',url:'/api/outputs/out',headers:headers()})).statusCode).toBe(409)
    expect((await patch({target:'srt://localhost:9002'})).statusCode).toBe(422)
  })
  it('protocolo e destino incompatíveis são recusados antes do engine',async()=>{
    expect((await patch({kind:'RTMP'})).statusCode).toBe(400)
    expect((await patch({kind:'FILE',target:'srt://localhost:9000'})).statusCode).toBe(400)
    expect(apply).not.toHaveBeenCalled()
  })
})
