import Fastify,{type FastifyInstance} from 'fastify'
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
import {eq} from 'drizzle-orm'
import {createApp,runtimeFor,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {channels,rundowns,rundownItems,mediaAssets,scheduleRules,operatorDecisions,asRun} from '../db/schema.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
let app:App,server:FastifyInstance
const endpoint=(day=false)=>`/api/rundowns/future/autofill${day?'-day':''}`
const revision=()=>app.concurrency.generateETag('future')
const rows=()=>app.db.select().from(rundownItems).orderBy(rundownItems.id).all()
const audits=()=>app.db.select().from(operatorDecisions).all()
async function preview(day=false,extra:object={}){
  const response=await server.inject({method:'POST',url:endpoint(day),headers:{'if-match':revision()},payload:{...(day?{}:{minutes:2}),preview:true,...extra}})
  expect(response.statusCode,response.body).toBe(200);return response.json()
}
const apply=(proposal:any,day=false,extra:object={},header=revision())=>server.inject({method:'POST',url:endpoint(day),headers:{'if-match':header},payload:{proposalId:proposal.proposal.id,...extra}})
beforeEach(async()=>{
  app=await createApp(':memory:');const now=new Date().toISOString()
  app.db.insert(channels).values({id:'ch',name:'QA',rateNum:25,rateDen:1,width:320,height:180,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:now}).run()
  for(const id of ['today','future']){
    app.db.insert(rundowns).values({id,channelId:'ch',name:id,date:id==='today'?'2026-10-02':'2026-10-03',plannedStart:0,loop:false,createdAt:now,updatedAt:now}).run()
    app.db.insert(rundownItems).values({id:`live-${id}`,rundownId:id,sortOrder:0,title:'Estúdio',type:'LIVE',sourceRef:'ndi:CAM',durationOverride:2500,minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',autoNext:false,loop:false,locked:false}).run()
  }
  app.db.insert(mediaAssets).values({id:'vt',title:'VT Conferido',path:'C:/ação.mp4',contentHash:'hash-one',kind:'VIDEO',durationFrames:2500,
    durationNs:100_000_000_000,rateNum:25,rateDen:1,width:320,height:180,hasAudio:true,interlaceMode:'progressive',qcStatus:'APPROVED',
    defaultTrim:{in:50,out:2500},defaultTrimRateNum:25,defaultTrimRateDen:1,defaultAudio:{mode:'MANUAL',gainDb:-4,measured:null},createdAt:now}).run()
  app.db.insert(scheduleRules).values({id:'band',channelId:'ch',name:'Manhã',weekdays:'0123456',startMinute:0,endMinute:2,categories:[],avoidHours:0,createdAt:now}).run()
  const runtime=(await runtimeFor(app,'ch'))!;await runtime.load('today');await runtime.transport.take('today','live-today');await runtime.transport.cue({kind:'ITEM',id:'live-today'})
  server=Fastify();registerRoutes(app,server,()=>{});await server.ready()
})
afterEach(async()=>{await server.close();app.close()})
describe('montagem aplica somente a proposta persistida que foi conferida',()=>{
  it.each([false,true])('revisão persiste protegida, sem editar grade, PGM ou undo; dia=%s',async day=>{
    const before=rows(),version=revision(),transport=app.runtimes.get('ch')!.transport.state(),review=await preview(day)
    expect(review.proposal).toMatchObject({rundownId:'future',channelId:'ch',kind:day?'DAY':'WINDOW'})
    expect(review.plan.items.map((item:any)=>item.mediaId)).toEqual(['vt'])
    expect(review.plan.items[0]).toMatchObject({trim:{in:50,out:2500},durationFrames:2450})
    const stored=app.sqlite.prepare('SELECT payload FROM operator_decisions WHERE id=?').get(review.proposal.id) as {payload:string}
    expect(stored.payload).toMatch(/^rplayout-secret:v1:/);expect(stored.payload).not.toContain('VT Conferido')
    expect(rows()).toEqual(before);expect(revision()).toBe(version);expect(app.history.state('future').canUndo).toBe(false)
    expect(app.runtimes.get('ch')!.transport.state()).toMatchObject({onAir:{itemId:transport.onAir?.itemId,startedAt:transport.onAir?.startedAt},preview:transport.preview})
  })
  it('"Por Intervalo" avisa antes de aplicar o que será cortado na grade existente (A7)',async()=>{
    // O ao vivo (00:00:00–00:01:40) atravessa 00:01:00, onde entra o 1º item com hora fixa.
    const review=await preview(false,{insertAtMinute:1})
    expect(review.plan.items[0].anchor).toMatchObject({kind:'FIXED',at:1500})
    expect(review.impact).toEqual([expect.objectContaining({itemId:'live-future',title:'Estúdio',kind:'TRIMMED',beforeFrames:2500,afterFrames:1500})])
    // Sem interseção com o conteúdo existente, nada é cortado.
    expect((await preview(false)).impact).toEqual([])
  })
  it.each([false,true])('não aplica às cegas ou sem proposta; dia=%s',async day=>{
    const before=rows(),beforeAudits=audits()
    expect((await server.inject({method:'POST',url:endpoint(day),payload:day?{}:{minutes:2}})).statusCode).toBe(428)
    expect((await server.inject({method:'POST',url:endpoint(day),headers:{'if-match':revision()},payload:day?{}:{minutes:2}})).statusCode).toBe(428)
    expect(rows()).toEqual(before);expect(audits().filter(row=>row.rundownId==='future')).toEqual(beforeAudits.filter(row=>row.rundownId==='future'))
  })
  it.each([false,true])('aplica linhas exatas, não nova seleção, preserva PGM e permite undo/redo; dia=%s',async day=>{
    const review=await preview(day),before=rows(),transport=app.runtimes.get('ch')!.transport.state()
    app.db.insert(mediaAssets).values({id:'new',title:'Novo candidato',path:'C:/new.mp4',contentHash:'new',kind:'VIDEO',durationFrames:3000,rateNum:25,rateDen:1,createdAt:'now'}).run()
    const response=await apply(review,day);expect(response.statusCode,response.body).toBe(200)
    expect(response.json().plan).toEqual(review.plan)
    const inserted=rows().filter(row=>row.mediaId==='vt')
    expect(inserted).toHaveLength(1);expect(inserted[0]).toMatchObject({trim:{in:50,out:2500},audio:{mode:'MANUAL',gainDb:-4},minDuration:2450})
    expect(rows().some(row=>row.mediaId==='new')).toBe(false)
    const accepted=rows()
    for(const action of ['undo','redo']){
      const result=await server.inject({method:'POST',url:`/api/rundowns/future/${action}`,headers:{'if-match':revision()},payload:{}})
      expect(result.statusCode,result.body).toBe(200);expect(rows()).toEqual(action==='undo'?before:accepted)
    }
    expect(audits().filter(row=>row.kind==='AUTO_FILLED')).toHaveLength(1)
    expect(audits().filter(row=>row.kind==='AUTOFILL_APPLIED')).toHaveLength(1)
    expect(app.runtimes.get('ch')!.executionView?.rundown.id).toBe('today')
    expect(app.runtimes.get('ch')!.transport.state()).toMatchObject({onAir:{itemId:transport.onAir?.itemId,startedAt:transport.onAir?.startedAt},preview:transport.preview})
  })
  it('conferência velha não pode usar revisão nova para ultrapassar escritor posterior',async()=>{
    const review=await preview();app.sqlite.exec("UPDATE rundown_items SET notes='Estação B' WHERE id='live-future'")
    const before=rows();expect((await apply(review)).statusCode).toBe(409);expect(rows()).toEqual(before)
  })
  it.each([
    ['hash',()=>app.sqlite.exec("UPDATE media_assets SET content_hash='alterado' WHERE id='vt'")],
    ['corte',()=>app.sqlite.exec("UPDATE media_assets SET default_trim='{"+'"in":75,"out":2500'+"}' WHERE id='vt'")],
    ['QC',()=>app.sqlite.exec("UPDATE media_assets SET qc_status='BLOCKED' WHERE id='vt'")],
    ['áudio',()=>app.sqlite.exec("UPDATE media_assets SET default_audio='{"+'"mode":"MANUAL","gainDb":-8,"measured":null'+"}' WHERE id='vt'")],
    ['canal',()=>app.sqlite.exec("UPDATE channels SET target_lufs=-16 WHERE id='ch'")],
  ] as const)('alteração de %s invalida sem nova escolha ou inserção parcial',async(_kind,change)=>{
    const review=await preview();change();const before=rows(),version=revision()
    expect((await apply(review)).statusCode).toBe(409);expect(rows()).toEqual(before);expect(revision()).toBe(version)
    expect(app.history.state('future').canUndo).toBe(false);expect(audits().some(row=>row.kind==='AUTOFILL_APPLIED')).toBe(false)
  })
  it('pauta modificada fora da revisão editorial invalida o dia conferido',async()=>{
    const review=await preview(true),version=revision();app.sqlite.exec("UPDATE schedule_rules SET start_minute=10,end_minute=12 WHERE id='band'")
    expect(revision()).toBe(version);expect((await apply(review,true)).statusCode).toBe(409)
  })
  it('histórico protegido funciona e novo as-run invalida a seleção conferida',async()=>{
    app.db.insert(operatorDecisions).values({id:'preference',rundownId:'future',kind:'ITEM_ADDED',payload:{mediaId:'vt'},createdAt:'now'}).run()
    const review=await preview();expect(review.plan.items[0].explanation.preference).toBeGreaterThan(0)
    app.db.insert(asRun).values({id:'aired',channelId:'ch',rundownId:'today',itemId:'live-today',mediaId:'vt',title:'VT',type:'VT',actualStart:0,createdAt:new Date().toISOString(),startedAt:new Date().toISOString()}).run()
    expect((await apply(review)).statusCode).toBe(409)
  })
  it.each(['AUTO_FILLED','AUTOFILL_APPLIED'])('falha na auditoria %s reverte consumo, linhas, revisão e undo; pode repetir após corrigir',async kind=>{
    const review=await preview(),before=rows(),version=revision()
    app.sqlite.exec(`CREATE TRIGGER reject_fill BEFORE INSERT ON operator_decisions WHEN NEW.kind='${kind}' BEGIN SELECT RAISE(ABORT,'QA audit failure'); END`)
    expect((await apply(review)).statusCode).toBe(500);expect(rows()).toEqual(before);expect(revision()).toBe(version)
    expect(app.history.state('future').canUndo).toBe(false);expect(audits().some(row=>row.kind==='AUTOFILL_APPLIED')).toBe(false)
    app.sqlite.exec('DROP TRIGGER reject_fill');expect((await apply(review)).statusCode).toBe(200)
  })
  it('mesma proposta só tem um vencedor e não repete após undo',async()=>{
    const review=await preview(),captured=revision(),replies=await Promise.all([apply(review,false,{},captured),apply(review,false,{},captured)])
    expect(replies.map(reply=>reply.statusCode).sort()).toEqual([200,409])
    expect((await server.inject({method:'POST',url:'/api/rundowns/future/undo',headers:{'if-match':revision()},payload:{}})).statusCode).toBe(200)
    expect((await apply(review)).statusCode).toBe(409);expect(rows().filter(row=>row.mediaId==='vt')).toHaveLength(0)
  })
  it('proposta não muda de destino, modo ou critérios na aplicação',async()=>{
    const review=await preview(),before=rows()
    expect((await apply(review,true)).statusCode).toBe(409)
    expect((await apply(review,false,{minutes:10})).statusCode).toBe(400)
    expect((await server.inject({method:'POST',url:'/api/rundowns/today/autofill',headers:{'if-match':app.concurrency.generateETag('today')},payload:{proposalId:review.proposal.id}})).statusCode).toBe(409)
    expect(rows()).toEqual(before)
  })
  it('expiração, fonte de inserção ausente e proposta vazia têm bloqueio específico',async()=>{
    const review=await preview(),row=audits().find(row=>row.id===review.proposal.id)!
    app.db.update(operatorDecisions).set({payload:{...row.payload,expiresAt:'2020-01-01T00:00:00Z'}}).where(eq(operatorDecisions.id,row.id)).run()
    const expired=await apply(review);expect(expired.statusCode).toBe(409);expect(expired.json().error).toContain('expirou')
    const missing=await server.inject({method:'POST',url:endpoint(),payload:{minutes:2,preview:true,insertAfterItemId:'absent'}})
    expect(missing.statusCode).toBe(409)
    const empty=await preview(false,{categories:['SEM_MÍDIA']});expect(empty.plan.items).toEqual([])
    expect((await apply(empty)).statusCode).toBe(409)
  })
  it('gap de segundos retorna proposta aplicável, âncora exata e nunca grava até confirmação',async()=>{
    app.sqlite.exec("UPDATE media_assets SET default_trim=NULL,default_trim_rate_num=NULL,default_trim_rate_den=NULL,duration_frames=250,duration_ns=10000000000,category_id='FILLER' WHERE id='vt'")
    const before=rows(),response=await server.inject({method:'POST',url:'/api/v1/rundowns/future/autofill-gap',payload:{gapDurationMs:10500,gapStartMs:60500}})
    expect(response.statusCode,response.body).toBe(200);const review=response.json()
    expect(rows()).toEqual(before);expect(review.applyParameters).toEqual({proposalId:review.proposal.id})
    const accepted=await apply(review);expect(accepted.statusCode,accepted.body).toBe(200)
    expect(rows().find(row=>row.mediaId==='vt')?.anchor).toEqual({kind:'FIXED',at:1513})
  })
})
