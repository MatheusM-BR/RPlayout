import Fastify,{type FastifyInstance} from 'fastify'
import {randomUUID} from 'node:crypto'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {eq} from 'drizzle-orm'
import {createApp,runtimeFor,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {channels,rundowns,rundownItems,mediaAssets,liveSources,operatorDecisions} from '../db/schema.js'
import {reviewedPublish} from './test-operational-review.js'
import {EngineTransport} from './engine.js'
import {OperationalInsertions} from './operational-insertion.js'
import {Interruptions} from './interruptions.js'
import {sessionDigest} from './access.js'
import {channelConfigurationETag} from '@rplayout/protocol'
import {configurationRevision} from '../db/channel-configuration.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',RELAY_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
let app:App,server:FastifyInstance
beforeEach(async()=>{
  app=await createApp(':memory:');const now=new Date().toISOString()
  for(const id of ['ch','other'])app.db.insert(channels).values({id,name:id,width:320,height:180,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:now}).run()
  app.db.insert(rundowns).values({id:'rd',channelId:'ch',name:'Grade',date:now.slice(0,10),plannedStart:0,loop:false,createdAt:now,updatedAt:now}).run()
  app.db.insert(mediaAssets).values({id:'media',contentHash:'a'.repeat(64),path:'original.mp4',title:'VT ÇÃO',kind:'VIDEO',durationFrames:1000,hasAudio:false,createdAt:now}).run()
  for(const [n,id] of ['vt','next'].entries())app.db.insert(rundownItems).values({id,rundownId:'rd',sortOrder:n,title:id,type:'VT',mediaId:'media',minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',autoNext:false,loop:false,locked:false}).run()
  app.db.insert(liveSources).values({id:'source',channelId:'ch',name:'CÂMERA (ÇÃO)',kind:'NDI',targetUrl:'ndi:CÂMERA (ÇÃO)',enabled:true,createdAt:now}).run()
  const runtime=(await runtimeFor(app,'ch'))!;await runtime.load('rd')
  server=Fastify();registerRoutes(app,server,()=>{});await server.ready();await reviewedPublish(server,'rd');await runtime.transport.take('rd','vt')
})
afterEach(async()=>{vi.restoreAllMocks();await server.close();app.close()})
const input=(mode:'NEXT'|'NOW'='NEXT',live=false)=>({requestId:randomUUID(),mode,...(live?{sourceId:'source',durationFrames:2500}:{mediaId:'media'})})
const review=async(value=input())=>{const res=await server.inject({method:'POST',url:'/api/channels/ch/operational-insert/review',payload:value});expect(res.statusCode,res.body).toBe(200);return {input:value,reviewToken:res.json().reviewToken,confirm:true}}
const execute=(payload:object,headers:Record<string,string>={})=>server.inject({method:'POST',url:'/api/channels/ch/operational-insert',payload,headers})
function native(){
  const runtime=app.runtimes.get('ch')!,simulated=runtime.transport,double=Object.create(EngineTransport.prototype)
  for(const key of Object.getOwnPropertyNames(Object.getPrototypeOf(simulated)))if(key!=='constructor'&&typeof(simulated as any)[key]==='function')double[key]=(simulated as any)[key].bind(simulated)
  let program:ReturnType<typeof simulated.state>['onAir']|undefined
  double.state=()=>({...simulated.state(),...(program!==undefined?{onAir:program}:{}),mode:'NATIVE'})
  const prepare=vi.fn(async()=>{}),take=vi.fn(async(_view:any,id:string,current:()=>boolean,beforeTake:()=>void,commit:(previous:{itemId:string;frames:number})=>void)=>{current();beforeTake();const previous=double.state().onAir;program={...previous,itemId:id,elapsed:0};commit({itemId:previous.itemId,frames:143})})
  double.insertOperational=vi.fn(async(work:any)=>work({prepare,take}));double.processId=()=>null
  double.mutateConfiguration=async(work:()=>Promise<unknown>)=>work()
  Object.defineProperty(runtime,'transport',{value:double})
  return {runtime,prepare,take,double}
}
describe('inserção urgente usa edição publicada e confirmação operacional',()=>{
  it('NEXT não altera PGM/CUE nem publica rascunho; duplicata não cria outra revisão',async()=>{
    const fixture=native(),before=fixture.runtime.operationalRevision!.id
    app.db.update(rundownItems).set({title:'Rascunho pendente'}).where(eq(rundownItems.id,'next')).run()
    await fixture.runtime.refresh()
    const body=await review(),res=await execute(body);expect(res.statusCode,res.body).toBe(200)
    expect(res.json()).toMatchObject({run:{phase:'CONFIRMED',mode:'NEXT',nativeProgramConfirmed:false,physicalOutputValidated:false}})
    expect(fixture.runtime.transport.state().onAir?.itemId).toBe('vt');expect(fixture.runtime.transport.state().preview).toBeNull()
    expect(fixture.runtime.operationalRevision!.id).not.toBe(before)
    expect(fixture.runtime.executionView!.items.map(row=>row.item.title)).toEqual(['vt','VT ÇÃO','next'])
    expect(fixture.runtime.view!.items.map(row=>row.item.title)).toEqual(['vt','Rascunho pendente'])
    expect(app.db.select().from(rundownItems).all()).toHaveLength(2)
    const revision=fixture.runtime.operationalRevision!.id
    expect((await execute(body)).json()).toMatchObject({deduplicated:true});expect(fixture.prepare).toHaveBeenCalledTimes(1);expect(fixture.take).not.toHaveBeenCalled();expect(fixture.runtime.operationalRevision!.id).toBe(revision)
  })
  it('NOW só comita depois do PGM confirmado; mantém cursor para retornar ao VT',async()=>{
    const fixture=native(),body=await review(input('NOW',true)),res=await execute(body)
    expect(res.statusCode,res.body).toBe(200);expect(res.json()).toMatchObject({run:{phase:'CONFIRMED',nativeProgramConfirmed:true}})
    expect(fixture.runtime.transport.state().onAir?.itemId).toBe(`urgent:${body.input.requestId}`)
    expect(fixture.runtime.executionView!.items[1]?.item).toMatchObject({title:'CÂMERA (ÇÃO)',sourceRef:'ndi:CÂMERA (ÇÃO)'})
    expect(new Interruptions(app.sqlite).list('ch')).toMatchObject([{item_id:'vt',frames:143,state:'PENDING'}])
    await execute(body);expect(fixture.take).toHaveBeenCalledTimes(1)
  })
  it('NOW em simulação não cria revisão nem anuncia corte nativo',async()=>{
    const old=app.runtimes.get('ch')!.operationalRevision!.id,body=await review(input('NOW')),res=await execute(body)
    expect(res.statusCode,res.body).toBe(409);expect(res.body).toContain('Simulação');expect(app.runtimes.get('ch')!.operationalRevision!.id).toBe(old)
  })
  it.each(['QC','source','occurrence'])('prova superada por %s não prepara/corta',async change=>{
    const fixture=native(),body=await review(input('NEXT',change==='source'))
    if(change==='QC')app.db.update(mediaAssets).set({qcStatus:'BLOCKED'}).where(eq(mediaAssets.id,'media')).run()
    if(change==='source')app.db.update(liveSources).set({name:'Outro nome'}).where(eq(liveSources.id,'source')).run()
    if(change==='occurrence')await fixture.runtime.transport.stop()
    const res=await execute(body);expect(res.statusCode,res.body).toBe(409);expect(fixture.prepare).not.toHaveBeenCalled();expect(fixture.take).not.toHaveBeenCalled()
  })
  it('revogação durante preroll impede commit e conserva a edição original',async()=>{
    const fixture=native(),body=await review(),old=fixture.runtime.operationalRevision!.id,now=new Date().toISOString(),token='insert-session'
    app.sqlite.prepare('INSERT INTO users(id,username,password_hash,role,enabled,created_at) VALUES(?,?,?,?,1,?)').run('editor','editor','unused','ADMIN',now)
    app.sqlite.prepare('INSERT INTO sessions(token,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(sessionDigest(token),'editor',new Date(Date.now()+60_000).toISOString(),now)
    fixture.prepare.mockImplementationOnce(async()=>{app.sqlite.exec('DELETE FROM sessions')})
    const res=await execute(body,{cookie:`rplayout_session=${token}`});expect(res.statusCode,res.body).toBe(403);expect(fixture.runtime.operationalRevision!.id).toBe(old)
    expect(new OperationalInsertions(app.db).read(body.input.requestId)?.phase).toBe('FAILED');expect(app.configurationChanges.status('ch').state).toBe('IDLE')
  })
  it('erro antes do TAKE preserva edição; erro depois do despacho cerca recuperação e pedidos',async()=>{
    const fixture=native(),old=fixture.runtime.operationalRevision!.id,body=await review(input('NOW'))
    fixture.take.mockImplementationOnce(async(_v,_id,current,beforeTake)=>{current();beforeTake();throw new Error('ACK lost')})
    const res=await execute(body);expect(res.statusCode,res.body).toBe(409);expect(fixture.runtime.operationalRevision!.id).toBe(old)
    expect(new OperationalInsertions(app.db).read(body.input.requestId)?.phase).toBe('UNCERTAIN');expect(app.configurationChanges.canRecover('ch')).toBe(false)
    const duplicate=await execute(body);expect(duplicate.statusCode).toBe(409);expect(duplicate.json().deduplicated).toBe(true);expect(fixture.take).toHaveBeenCalledTimes(1)
    expect((await server.inject({method:'POST',url:'/api/channels/ch/operational-insert/review',payload:input()})).statusCode).toBe(409)
  })
  it('falha da auditoria NEXT reverte edição/command juntos',async()=>{
    const fixture=native(),old=fixture.runtime.operationalRevision!.id,body=await review()
    app.sqlite.exec("CREATE TRIGGER qa_insert BEFORE INSERT ON operator_decisions WHEN NEW.kind='OPERATIONAL_INSERT_COMMITTED' BEGIN SELECT RAISE(ABORT,'audit failed'); END")
    const res=await execute(body);expect(res.statusCode,res.body).toBe(409);expect(fixture.runtime.operationalRevision!.id).toBe(old);expect(new OperationalInsertions(app.db).read(body.input.requestId)?.phase).toBe('FAILED')
    expect(app.configurationChanges.status('ch').state).toBe('IDLE')
  })
  it('falha da auditoria depois do corte não descreve revisão antiga como confirmação',async()=>{
    const fixture=native(),body=await review(input('NOW'))
    app.sqlite.exec("CREATE TRIGGER qa_insert BEFORE INSERT ON operator_decisions WHEN NEW.kind='OPERATIONAL_INSERT_COMMITTED' BEGIN SELECT RAISE(ABORT,'audit failed'); END")
    const res=await execute(body);expect(res.statusCode,res.body).toBe(409);expect(fixture.runtime.transport.state().onAir?.itemId).toBe(`urgent:${body.input.requestId}`)
    expect(fixture.runtime.operationalRevision).toBeNull();expect(fixture.runtime.executionView!.items[1]?.item.id).toBe(`urgent:${body.input.requestId}`)
    expect(app.configurationChanges.status('ch').state).toBe('UNCERTAIN')
  })
  it('usar ativo já publicado não muda o corte dos outros itens por padrão novo',async()=>{
    native();app.db.update(mediaAssets).set({defaultTrim:{in:50,out:500},defaultTrimRateNum:25,defaultTrimRateDen:1}).where(eq(mediaAssets.id,'media')).run()
    const res=await execute(await review());expect(res.statusCode,res.body).toBe(200)
    const entries=app.runtimes.get('ch')!.executionView!.items
    expect(entries.map(row=>row.trim)).toEqual([{in:0,out:1000},{in:50,out:500},{in:0,out:1000}])
  })
  it('consulta privada não repete comando nem carrega runtime; outro canal não vê o pedido',async()=>{
    const fixture=native(),body=await review();await execute(body)
    const runtime=app.runtimes.get('ch')!;app.runtimes.delete('ch')
    try{
      const res=await server.inject(`/api/channels/ch/operational-insert/${body.input.requestId}`)
      expect(res.statusCode,res.body).toBe(200);expect(res.headers['cache-control']).toBe('private, no-store')
      expect(res.json()).toMatchObject({run:{phase:'CONFIRMED',nativeProgramConfirmed:false},automaticTake:false})
      expect(res.json().run).not.toHaveProperty('digest');expect(app.runtimes.has('ch')).toBe(false)
      expect((await server.inject(`/api/channels/other/operational-insert/${body.input.requestId}`)).statusCode).toBe(404)
      expect(fixture.prepare).toHaveBeenCalledTimes(1);expect(fixture.take).not.toHaveBeenCalled()
    }finally{app.runtimes.set('ch',runtime)}
  })
  it('preparação lenta impede segundo escritor e mantém a revisão até o commit',async()=>{
    const fixture=native(),old=fixture.runtime.operationalRevision!.id,firstBody=await review(),secondBody=await review()
    let entered!:()=>void,release!:()=>void
    const started=new Promise<void>(resolve=>entered=resolve),waiting=new Promise<void>(resolve=>release=resolve)
    fixture.prepare.mockImplementationOnce(async()=>{entered();await waiting})
    const first=execute(firstBody);first.then(()=>{})
    await started
    expect(fixture.runtime.operationalRevision!.id).toBe(old)
    expect(app.configurationChanges.canRecover('ch')).toBe(false)
    const status=await server.inject(`/api/channels/ch/operational-insert/${firstBody.input.requestId}`)
    expect(status.json()).toMatchObject({run:{phase:'PREPARING'},configurationOperation:{phase:'INSERT_PREPARING'},automaticTake:false})
    expect((await execute(secondBody)).statusCode).toBe(409);expect(fixture.prepare).toHaveBeenCalledTimes(1)
    release();expect((await first).statusCode).toBe(200)
    expect(fixture.runtime.operationalRevision!.id).not.toBe(old)
  })
  it.each(['disabled','other-channel','changed-bytes'])('%s impede preparar candidato indisponível',async condition=>{
    const fixture=native(),body=await review(input('NEXT',condition!=='changed-bytes'))
    if(condition==='disabled')app.db.update(liveSources).set({enabled:false}).where(eq(liveSources.id,'source')).run()
    if(condition==='other-channel')app.db.update(liveSources).set({channelId:'other'}).where(eq(liveSources.id,'source')).run()
    if(condition==='changed-bytes')app.db.update(mediaAssets).set({contentHash:'b'.repeat(64)}).where(eq(mediaAssets.id,'media')).run()
    expect((await execute(body)).statusCode).toBe(409);expect(fixture.prepare).not.toHaveBeenCalled();expect(fixture.take).not.toHaveBeenCalled()
  })
  it('reconciliação parada encerra a cerca sem repetir inserção inconclusiva',async()=>{
    const fixture=native(),body=await review(input('NOW'))
    fixture.take.mockImplementationOnce(async(_v,_id,current,beforeTake)=>{current();beforeTake();throw new Error('ACK lost')})
    await execute(body);const status=app.configurationChanges.status('ch')
    const reconcile=()=>server.inject({method:'POST',url:'/api/channels/ch/configuration-operation/reconcile',headers:{'if-match':channelConfigurationETag('ch',configurationRevision(app.db,'ch'))},payload:{runId:status.runId,confirm:true}})
    expect((await reconcile()).statusCode).toBe(409)
    await fixture.runtime.transport.stop()
    await fixture.runtime.transport.cue(null)
    const res=await reconcile();expect(res.statusCode,res.body).toBe(200);expect(res.json()).toMatchObject({automaticTake:false})
    expect(app.configurationChanges.status('ch').state).toBe('IDLE')
    expect((await execute(body)).statusCode).toBe(409);expect(fixture.take).toHaveBeenCalledTimes(1)
    expect(new OperationalInsertions(app.db).read(body.input.requestId)?.phase).toBe('UNCERTAIN')
    expect(app.runtimes.get('ch')!.transport.state().onAir).toBeNull()
  })
})
