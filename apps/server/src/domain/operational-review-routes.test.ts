import Fastify,{type FastifyInstance} from 'fastify'
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
import {eq} from 'drizzle-orm'
import {createApp,runtimeFor,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {channels,rundowns,rundownItems,mediaAssets,graphicTemplates,itemGraphics,secondaryEvents} from '../db/schema.js'
import {reviewedPublish} from './test-operational-review.js'

vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',DEFAULT_ROLE:'ADMIN'}))
let app:App,server:FastifyInstance
beforeEach(async()=>{
  app=await createApp(':memory:');const now=new Date().toISOString()
  app.db.insert(channels).values({id:'ch',name:'QA',rateNum:25,rateDen:1,width:320,height:180,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:now}).run()
  app.db.insert(mediaAssets).values({id:'reserve',path:'C:/reserve.mp4',title:'Reserva',contentHash:'a'.repeat(64),kind:'VIDEO',durationFrames:250,rateNum:25,rateDen:1,qcStatus:'APPROVED',createdAt:now}).run()
  for(const id of ['rd','other']){
    app.db.insert(rundowns).values({id,channelId:'ch',name:id,date:'2026-10-02',plannedStart:0,loop:false,createdAt:now,updatedAt:now}).run()
    app.db.insert(rundownItems).values({id:`live-${id}`,rundownId:id,sortOrder:0,title:'Estúdio',type:'LIVE',sourceRef:'ndi:CAM',liveFallbackMediaId:'reserve',durationOverride:500,minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',locked:false,autoNext:false,loop:false}).run()
  }
  server=Fastify();registerRoutes(app,server,()=>{});await server.ready()
})
afterEach(async()=>{await server.close();app.close()})
async function inspect(id='rd'){const reply=await server.inject(`/api/rundowns/${id}/operational-simulation`);expect(reply.statusCode,reply.body).toBe(200);return reply.json().review}
const header=(version:number)=>({'if-match':`w/"${version}"`})
const publish=(review:any,version=review.editorialRevision,id='rd')=>server.inject({method:'POST',url:`/api/rundowns/${id}/operational-publish`,headers:header(version),payload:{reviewToken:review.token}})
function persisted(){return {revisions:app.sqlite.prepare('SELECT * FROM operational_playlist_revisions ORDER BY id').all(),audit:app.sqlite.prepare("SELECT * FROM operator_decisions WHERE kind LIKE 'OPERATIONAL_PLAYLIST_%' ORDER BY id").all()}}
async function rollbackReview(sourceId:string){const version=(await inspect()).editorialRevision;const reply=await server.inject({url:`/api/rundowns/rd/operational-rollback-review?revisionId=${sourceId}`,headers:header(version)});expect(reply.statusCode,reply.body).toBe(200);return reply.json().review}
const rollback=(review:any,sourceId=review.sourceRevisionId)=>server.inject({method:'POST',url:'/api/rundowns/rd/operational-rollback',headers:header(review.editorialRevision),payload:{revisionId:sourceId,reviewToken:review.token}})

describe('publicação e rollback somente do plano conferido',()=>{
  it('protege CUE de corte automático alterado por duração de outro item',async()=>{
    const runtime=(await runtimeFor(app,'ch'))!;await runtime.load('rd');await runtime.transport.take('rd','live-rd')
    const origin=runtime.transport.state().onAir!.startedAt
    for(const [order,id] of ['cue-auto','cue-boundary'].entries())app.db.insert(rundownItems).values({id,rundownId:'rd',sortOrder:order+1,title:id,type:'VT',mediaId:'reserve',durationOverride:125,trim:{in:0,out:125},minDuration:75,trimmable:id==='cue-auto',anchor:id==='cue-boundary'?{kind:'FIXED',at:origin+625}:{kind:'FLOW'},onOverrun:'PUSH',locked:false,autoNext:false,loop:false}).run()
    await reviewedPublish(server,'rd');await runtime.transport.cue({kind:'ITEM',id:'cue-auto'})
    const before=persisted(),original=runtime.executionView!.items.find(row=>row.item.id==='cue-auto')!.trim
    app.db.update(rundownItems).set({durationOverride:550}).where(eq(rundownItems.id,'live-rd')).run()
    const result=await publish(await inspect());expect(result.statusCode,result.body).toBe(409);expect(result.json().error).toContain('CUE')
    expect(persisted()).toEqual(before);expect(runtime.executionView!.items.find(row=>row.item.id==='cue-auto')!.trim).toEqual(original)
  })
  it('commit de publicação com refresh falho é informado como gravado, sem repetir revisão',async()=>{
    const runtime=(await runtimeFor(app,'ch'))!;await runtime.load('rd');await runtime.transport.take('rd','live-rd')
    const review=await inspect(),refresh=vi.spyOn(runtime,'refresh').mockRejectedValue(new Error('fixture refresh unavailable'))
    try{
      const result=await publish(review);expect(result.statusCode,result.body).toBe(201)
      expect(result.json()).toMatchObject({applied:true,executionUpdated:false,revision:1})
      expect(result.json().refreshError).toContain('gravada')
      expect((await publish(review)).statusCode).toBe(409)
      expect(persisted().revisions).toHaveLength(1);expect(persisted().audit).toHaveLength(1)
    }finally{refresh.mockRestore()}
  })
  it('commit de rollback com refresh falho não é apresentado como rollback recusado',async()=>{
    const runtime=(await runtimeFor(app,'ch'))!;await runtime.load('rd');await runtime.transport.take('rd','live-rd')
    const first=(await reviewedPublish(server,'rd')).json().id;await reviewedPublish(server,'rd')
    const review=await rollbackReview(first),refresh=vi.spyOn(runtime,'refresh').mockRejectedValue(new Error('fixture refresh unavailable'))
    try{
      const result=await rollback(review);expect(result.statusCode,result.body).toBe(200)
      expect(result.json()).toMatchObject({applied:true,executionUpdated:false,revision:3,snapshotAvailable:true})
      expect(result.json().refreshError).toContain('gravado')
      expect((await rollback(review)).statusCode).toBe(409);expect(persisted().revisions).toHaveLength(3)
    }finally{refresh.mockRestore()}
  })
  it('publicação urgente não altera o corte do item aberto no CUE',async()=>{
    const runtime=(await runtimeFor(app,'ch'))!;await runtime.load('rd')
    app.db.insert(rundownItems).values({id:'cue-vt',rundownId:'rd',sortOrder:1,title:'CUE',type:'VT',mediaId:'reserve',durationOverride:null,trim:{in:0,out:250},minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',locked:false,autoNext:false,loop:false}).run()
    await reviewedPublish(server,'rd');await runtime.transport.take('rd','live-rd');await runtime.transport.cue({kind:'ITEM',id:'cue-vt'})
    const before=persisted(),state=runtime.transport.state()
    app.db.update(rundownItems).set({trim:{in:25,out:200}}).where(eq(rundownItems.id,'cue-vt')).run()
    const result=await publish(await inspect());expect(result.statusCode,result.body).toBe(409);expect(result.json().error).toContain('CUE')
    expect(persisted()).toEqual(before);expect(runtime.transport.state().preview).toEqual(state.preview)
    expect(runtime.transport.state().onAir!.itemId).toBe('live-rd')
  })
  it('rollback não altera o item aberto no CUE mesmo preservando PGM',async()=>{
    const runtime=(await runtimeFor(app,'ch'))!;await runtime.load('rd')
    app.db.insert(rundownItems).values({id:'cue-vt',rundownId:'rd',sortOrder:1,title:'CUE',type:'VT',mediaId:'reserve',durationOverride:null,trim:{in:0,out:250},minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',locked:false,autoNext:false,loop:false}).run()
    const first=(await reviewedPublish(server,'rd')).json().id
    app.db.update(rundownItems).set({trim:{in:25,out:200}}).where(eq(rundownItems.id,'cue-vt')).run()
    await reviewedPublish(server,'rd');await runtime.transport.take('rd','live-rd');await runtime.transport.cue({kind:'ITEM',id:'cue-vt'})
    const before=persisted(),review=await rollbackReview(first)
    const result=await rollback(review);expect(result.statusCode,result.body).toBe(409);expect(result.json().error).toContain('CUE');expect(persisted()).toEqual(before)
  })
  it('consulta é estável e não altera execução, grade ou auditoria',async()=>{
    const runtime=(await runtimeFor(app,'ch'))!;await runtime.load('rd');await runtime.transport.take('rd','live-rd')
    const before=persisted(),state=runtime.transport.state(),review=await inspect(),again=await inspect()
    expect(again).toEqual(review);expect(persisted()).toEqual(before)
    expect(runtime.transport.state()).toMatchObject({onAir:{itemId:state.onAir?.itemId,startedAt:state.onAir?.startedAt},preview:state.preview})
  })
  it('não publica sem a versão e conferência, e rejeita prova malformada',async()=>{
    const review=await inspect(),url='/api/rundowns/rd/operational-publish',before=persisted()
    expect((await server.inject({method:'POST',url,payload:{reviewToken:review.token}})).statusCode).toBe(428)
    expect((await server.inject({method:'POST',url,headers:header(review.editorialRevision),payload:{}})).statusCode).toBe(428)
    expect((await server.inject({method:'POST',url,headers:header(review.editorialRevision),payload:{reviewToken:'short'}})).statusCode).toBe(400)
    expect((await publish({...review,token:'Z'.repeat(43)})).statusCode).toBe(409)
    expect(persisted()).toEqual(before)
  })
  it('uma prova de outra grade não autoriza a publicação',async()=>{
    const review=await inspect('other'),version=(await inspect()).editorialRevision
    expect((await publish(review,version)).statusCode).toBe(409);expect(persisted().revisions).toHaveLength(0)
  })
  it.each(['item','hash','defaultTrim','defaultAudio','QC','channel','graphics'] as const)('alteração em %s invalida a prova mesmo reenviando uma versão atual',async kind=>{
    const now=new Date().toISOString()
    if(kind==='graphics'){
      app.db.insert(graphicTemplates).values({id:'art',name:'Arte',svg:'<svg/>',fields:[],fadeMs:0,createdAt:now}).run()
      app.db.insert(itemGraphics).values({id:'cue',itemId:'live-rd',templateId:'art',atSeconds:0,values:{},createdAt:now}).run()
    }
    const review=await inspect()
    if(kind==='item')app.db.update(rundownItems).set({title:'Alterado'}).where(eq(rundownItems.id,'live-rd')).run()
    if(kind==='hash')app.db.update(mediaAssets).set({contentHash:'b'.repeat(64)}).where(eq(mediaAssets.id,'reserve')).run()
    if(kind==='defaultTrim')app.db.update(mediaAssets).set({defaultTrim:{in:25,out:125},defaultTrimRateNum:25,defaultTrimRateDen:1}).where(eq(mediaAssets.id,'reserve')).run()
    if(kind==='defaultAudio')app.db.update(mediaAssets).set({defaultAudio:{mode:'MANUAL',gainDb:-4,measured:null}}).where(eq(mediaAssets.id,'reserve')).run()
    if(kind==='QC')app.db.update(mediaAssets).set({qcStatus:'REJECTED'}).where(eq(mediaAssets.id,'reserve')).run()
    if(kind==='channel')app.db.update(channels).set({targetLufs:-20}).where(eq(channels.id,'ch')).run()
    if(kind==='graphics')app.db.update(graphicTemplates).set({svg:'<svg>NEW</svg>'}).where(eq(graphicTemplates.id,'art')).run()
    const current=await inspect(),before=persisted()
    const response=await publish(review,current.editorialRevision)
    expect(response.statusCode,response.body).toBe(409);expect(persisted()).toEqual(before)
  })
  it('mudança no endpoint físico invalida a conferência sem depender de revisão editorial',async()=>{
    const now=new Date().toISOString()
    app.sqlite.prepare('INSERT INTO external_devices VALUES (?,?,?,?,?,?,?)').run('router','Matriz','VIDEOHUB_ROUTER','127.0.0.1',9990,1,now)
    const definition={id:'device-event',rundownItemId:'live-rd',type:'DEVICE_AUTOMATION' as const,targetLayer:'LOWER_THIRD' as const,triggerMode:'MANUAL' as const,offsetFrames:0,templateId:'',payload:{},enabled:true,deviceConfig:{deviceId:'router',targetDevice:'VIDEOHUB_ROUTER' as const,action:'PING' as const,params:{}}}
    app.db.insert(secondaryEvents).values({id:definition.id,channelId:'ch',itemId:'live-rd',definition,createdAt:now,updatedAt:now}).run()
    const review=await inspect();app.sqlite.prepare("UPDATE external_devices SET port=9991 WHERE id='router'").run()
    expect((await inspect()).editorialRevision).toBe(review.editorialRevision)
    expect((await publish(review)).statusCode).toBe(409);expect(persisted().revisions).toHaveLength(0)
  })
  it('duas confirmações do mesmo plano não criam duas revisões',async()=>{
    const review=await inspect(),results=await Promise.all([publish(review),publish(review)])
    expect(results.map(row=>row.statusCode).sort()).toEqual([201,409]);expect(persisted().revisions).toHaveLength(1);expect(persisted().audit).toHaveLength(1)
  })
  it('falha ao gravar auditoria reverte publicação, ativação e numeração',async()=>{
    expect((await reviewedPublish(server,'rd')).statusCode).toBe(201)
    const review=await inspect(),before=persisted()
    app.sqlite.exec("CREATE TRIGGER reject_publish_audit BEFORE INSERT ON operator_decisions WHEN NEW.kind='OPERATIONAL_PLAYLIST_PUBLISHED' BEGIN SELECT RAISE(ABORT,'QA audit failure'); END")
    expect((await publish(review)).statusCode).toBe(409);expect(persisted()).toEqual(before)
    app.sqlite.exec('DROP TRIGGER reject_publish_audit')
    expect((await publish(review)).json().revision).toBe(2)
  })
  it.each(['trim','audio'] as const)('publicação não altera %s herdado do VT que já está em PGM',async kind=>{
    app.db.update(rundownItems).set({type:'VT',sourceRef:null,mediaId:'reserve',liveFallbackMediaId:null,durationOverride:null}).where(eq(rundownItems.id,'live-rd')).run()
    const runtime=(await runtimeFor(app,'ch'))!;await runtime.load('rd');await runtime.transport.take('rd','live-rd')
    expect((await reviewedPublish(server,'rd')).statusCode).toBe(201)
    const state=runtime.transport.state(),before=persisted()
    if(kind==='trim')app.db.update(mediaAssets).set({defaultTrim:{in:25,out:200},defaultTrimRateNum:25,defaultTrimRateDen:1}).where(eq(mediaAssets.id,'reserve')).run()
    else app.db.update(mediaAssets).set({defaultAudio:{mode:'MANUAL',gainDb:-4,measured:null}}).where(eq(mediaAssets.id,'reserve')).run()
    const response=await publish(await inspect())
    expect(response.statusCode,response.body).toBe(409);expect(response.json().error).toContain('herdado')
    expect(persisted()).toEqual(before);expect(runtime.transport.state()).toMatchObject({onAir:{itemId:state.onAir?.itemId,startedAt:state.onAir?.startedAt}})
  })
  it('padrão novo não bloqueia um VT no ar que conserva seu corte e áudio explícitos',async()=>{
    app.db.update(rundownItems).set({type:'VT',sourceRef:null,mediaId:'reserve',liveFallbackMediaId:null,durationOverride:null,trim:{in:0,out:250},audio:{mode:'OFF',gainDb:0,measured:null}}).where(eq(rundownItems.id,'live-rd')).run()
    const runtime=(await runtimeFor(app,'ch'))!;await runtime.load('rd');await runtime.transport.take('rd','live-rd')
    expect((await reviewedPublish(server,'rd')).statusCode).toBe(201)
    app.db.update(mediaAssets).set({defaultTrim:{in:25,out:200},defaultTrimRateNum:25,defaultTrimRateDen:1,defaultAudio:{mode:'MANUAL',gainDb:-4,measured:null}}).where(eq(mediaAssets.id,'reserve')).run()
    expect((await reviewedPublish(server,'rd')).statusCode).toBe(201)
  })
  it('falha de auditoria no rollback conserva a revisão anterior ativa e permite nova confirmação',async()=>{
    const source=(await reviewedPublish(server,'rd')).json().id;await reviewedPublish(server,'rd')
    const review=await rollbackReview(source),before=persisted()
    app.sqlite.exec("CREATE TRIGGER reject_rollback_audit BEFORE INSERT ON operator_decisions WHEN NEW.kind='OPERATIONAL_PLAYLIST_ROLLBACK' BEGIN SELECT RAISE(ABORT,'QA rollback failure'); END")
    expect((await rollback(review)).statusCode).toBe(409);expect(persisted()).toEqual(before)
    app.sqlite.exec('DROP TRIGGER reject_rollback_audit')
    expect((await rollback(review)).json().revision).toBe(3)
  })
  it('rollback exige prova vinculada à revisão de origem e cria auditoria atômica',async()=>{
    const first=await reviewedPublish(server,'rd');expect(first.statusCode).toBe(201)
    app.db.update(rundownItems).set({title:'Novo editorial'}).where(eq(rundownItems.id,'live-rd')).run()
    const second=await reviewedPublish(server,'rd');expect(second.statusCode).toBe(201)
    const review=await rollbackReview(first.json().id),before=persisted()
    expect((await rollback(review,second.json().id)).statusCode).toBe(409);expect(persisted()).toEqual(before)
    const restored=await rollback(review);expect(restored.statusCode,restored.body).toBe(200);expect(restored.json().revision).toBe(3)
    expect(app.db.select().from(rundownItems).where(eq(rundownItems.id,'live-rd')).get()?.title).toBe('Novo editorial')
    expect(persisted().audit).toHaveLength(3)
  })
  it('mudança na revisão ativa invalida uma conferência anterior de rollback',async()=>{
    const source=(await reviewedPublish(server,'rd')).json().id
    await reviewedPublish(server,'rd');const review=await rollbackReview(source)
    await reviewedPublish(server,'rd');const before=persisted()
    expect((await rollback(review)).statusCode).toBe(409);expect(persisted()).toEqual(before)
  })
  it('automação editorial quebrada não impede conferir e restaurar uma revisão válida',async()=>{
    const source=(await reviewedPublish(server,'rd')).json().id,now=new Date().toISOString()
    const definition={id:'broken',rundownItemId:'live-rd',type:'DEVICE_AUTOMATION' as const,targetLayer:'LOWER_THIRD' as const,triggerMode:'MANUAL' as const,offsetFrames:0,templateId:'',payload:{},enabled:true,deviceConfig:{deviceId:'missing',targetDevice:'VIDEOHUB_ROUTER' as const,action:'PING' as const,params:{}}}
    app.db.insert(secondaryEvents).values({id:definition.id,channelId:'ch',itemId:'live-rd',definition,createdAt:now,updatedAt:now}).run()
    const simulation=await server.inject('/api/rundowns/rd/operational-simulation')
    expect(simulation.statusCode).toBe(409);expect(simulation.json().error).toContain('Equipamento')
    const version=app.concurrency.getRundownVersion('rd')
    const inspected=await server.inject({url:`/api/rundowns/rd/operational-rollback-review?revisionId=${source}`,headers:header(version)})
    expect(inspected.statusCode,inspected.body).toBe(200)
    expect((await rollback(inspected.json().review)).statusCode).toBe(200)
    expect(app.db.select().from(secondaryEvents).all()).toHaveLength(1)
  })
})
