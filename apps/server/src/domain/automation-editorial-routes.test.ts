import Fastify,{type FastifyInstance} from 'fastify'
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
import {createApp,runtimeFor,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {channels,rundowns,rundownItems,graphicTemplates,itemGraphics,secondaryEvents} from '../db/schema.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',DEFAULT_ROLE:'ADMIN'}))
let app:App,server:FastifyInstance
const zone={id:'news',label:'Jornal',from:0,to:2500,priority:5}
const event={name:'Crédito',type:'GRAPHICS_OVERLAY',targetLayer:'LOWER_THIRD',triggerMode:'MANUAL',offsetFrames:0,templateId:'art',payload:{title:'Draft'}}
beforeEach(async()=>{
  app=await createApp(':memory:');const now=new Date().toISOString()
  app.db.insert(channels).values({id:'ch',name:'QA',rateNum:25,rateDen:1,width:320,height:180,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:now}).run()
  for(const id of ['today','future']){
    app.db.insert(rundowns).values({id,channelId:'ch',name:id,date:id==='today'?'2026-10-02':'2026-10-03',plannedStart:0,loop:false,createdAt:now,updatedAt:now}).run()
    app.db.insert(rundownItems).values({id:`live-${id}`,rundownId:id,sortOrder:0,title:'Estúdio',type:'LIVE',sourceRef:'ndi:CAM',durationOverride:2500,minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',locked:false,autoNext:false,loop:false}).run()
  }
  app.db.insert(graphicTemplates).values({id:'art',channelId:'ch',name:'Tarja',svg:'<svg/>',fields:[],fadeMs:0,createdAt:now}).run()
  app.db.insert(itemGraphics).values({id:'cue',itemId:'live-future',templateId:'art',values:{title:'Original'},atSeconds:5,createdAt:now}).run()
  const definition={...event,type:'GRAPHICS_OVERLAY' as const,targetLayer:'LOWER_THIRD' as const,triggerMode:'MANUAL' as const,id:'event',rundownItemId:'live-future',enabled:true}
  app.db.insert(secondaryEvents).values({id:'event',channelId:'ch',itemId:'live-future',definition,createdAt:now,updatedAt:now}).run()
  const runtime=(await runtimeFor(app,'ch'))!;await runtime.load('today');await runtime.transport.take('today','live-today');await runtime.transport.cue({kind:'ITEM',id:'live-today'})
  server=Fastify();registerRoutes(app,server,()=>{});await server.ready()
})
afterEach(async()=>{await server.close();app.close()})
const revision=(rid='future')=>app.concurrency.generateETag(rid)
const operations=[
  {kind:'zone',method:'PUT' as const,url:'/api/rundowns/future/protected-zones',payload:{zones:[zone]},audit:'PROTECTED_ZONES_EDITED'},
  {kind:'cue-add',method:'POST' as const,url:'/api/items/live-future/graphics',payload:{templateId:'art',atSeconds:10,values:{title:'New'}},audit:'ITEM_GRAPHIC_ADDED'},
  {kind:'cue-remove',method:'DELETE' as const,url:'/api/item-graphics/cue',audit:'ITEM_GRAPHIC_REMOVED'},
  {kind:'event-add',method:'POST' as const,url:'/api/items/live-future/secondary-events',payload:event,audit:'SECONDARY_EVENT_ADDED'},
  {kind:'event-remove',method:'DELETE' as const,url:'/api/items/live-future/secondary-events/event',audit:'SECONDARY_EVENT_REMOVED'},
]
function state(){return {
  zones:app.sqlite.prepare("SELECT protected_zones FROM rundowns WHERE id='future'").get(),
  cues:app.sqlite.prepare('SELECT * FROM item_graphics ORDER BY id').all(),
  // Protected envelopes are compared as exact stored rows, never printed.
  events:app.sqlite.prepare('SELECT * FROM secondary_events ORDER BY id').all(),
  versions:app.sqlite.prepare('SELECT * FROM editorial_revision_counters ORDER BY scope,rundown_id,item_id').all(),
  audit:app.sqlite.prepare("SELECT * FROM operator_decisions WHERE rundown_id='future' ORDER BY id").all()}}
const semantic=()=>({zones:state().zones,cues:app.db.select().from(itemGraphics).all(),events:app.db.select().from(secondaryEvents).all()})
const apply=(operation:typeof operations[number],etag?:string)=>server.inject({...operation,headers:etag?{'if-match':etag}:{}})
const step=(action:'undo'|'redo',extra:Record<string,string>={})=>server.inject({method:'POST',url:`/api/rundowns/future/${action}`,headers:{'if-match':revision(),...extra},payload:{}})
describe('edição de timing/grafismos/eventos ligada ao que foi exibido',()=>{
  it.each(operations)('recusa escrita cega, revisão malformada e superada sem alterar $kind',async operation=>{
    const before=state(),opened=revision()
    expect((await apply(operation)).statusCode).toBe(428)
    expect((await apply(operation,'broken')).statusCode).toBe(400)
    expect(state()).toEqual(before);expect(app.history.state('future').canUndo).toBe(false)
    app.sqlite.exec("UPDATE rundown_items SET notes='Escritor externo' WHERE id='live-future'")
    const newer=state();expect((await apply(operation,opened)).statusCode).toBe(409)
    expect(state()).toEqual(newer);expect(app.history.state('future').canUndo).toBe(false)
  })
  it.each(operations)('falha de auditoria reverte dados, contadores e histórico: $kind',async operation=>{
    const before=state()
    app.sqlite.exec(`CREATE TRIGGER reject_event_audit BEFORE INSERT ON operator_decisions WHEN NEW.kind='${operation.audit}' BEGIN SELECT RAISE(ABORT,'QA audit failure'); END`)
    expect((await apply(operation,revision())).statusCode).toBe(500)
    expect(state()).toEqual(before);expect(app.history.state('future').canUndo).toBe(false)
  })
  it.each(operations)('desfaz/refaz somente a edição aceita e preserva PGM/CUE: $kind',async operation=>{
    const before=semantic(),runtime=app.runtimes.get('ch')!,transport=runtime.transport.state()
    expect((await apply(operation,revision())).statusCode).toBe(200)
    const after=semantic();expect(after).not.toEqual(before)
    expect((await step('undo')).statusCode).toBe(200);expect(semantic()).toEqual(before)
    expect((await step('redo')).statusCode).toBe(200);expect(semantic()).toEqual(after)
    expect(runtime.executionView?.rundown.id).toBe('today')
    expect(runtime.transport.state()).toMatchObject({onAir:{itemId:transport.onAir?.itemId,startedAt:transport.onAir?.startedAt},preview:transport.preview})
  })
  it.each(operations.filter(row=>row.method!=='DELETE'))('duas gravações na mesma versão têm um vencedor: $kind',async operation=>{
    const captured=revision(),responses=await Promise.all([apply(operation,captured),apply(operation,captured)])
    expect(responses.map(response=>response.statusCode).sort()).toEqual([200,409])
    expect((state().audit as unknown[])).toHaveLength(1)
  })
  it('leituras readonly entregam eventos, grafismos e cadência com a revisão correspondente, sem load',async()=>{
    const runtime=app.runtimes.get('ch')!,pgm=runtime.transport.state().onAir?.itemId,before=state()
    const cues=(await server.inject('/api/items/live-future/graphics')).json()
    const events=(await server.inject('/api/items/live-future/secondary-events')).json()
    expect(cues).toEqual(events);expect(cues).toMatchObject({editorialRevision:app.concurrency.getRundownVersion('future'),rate:{num:25,den:1},channelId:'ch',rundownId:'future',itemId:'live-future'})
    expect(cues.cues[0].templateName).toBe('Tarja');expect(cues.events[0].id).toBe('event');expect(state()).toEqual(before)
    app.sqlite.exec("UPDATE rundown_items SET title='Novo' WHERE id='live-future'")
    expect((await server.inject({url:'/api/items/live-future/graphics',headers:{'if-match':`w/"${cues.editorialRevision}"`}})).statusCode).toBe(409)
    expect(runtime.executionView?.rundown.id).toBe('today');expect(runtime.transport.state().onAir?.itemId).toBe(pgm)
  })
  it('undo da zona não sobrescreve alteração posterior, mantendo ação pendente',async()=>{
    expect((await apply(operations[0]!,revision())).statusCode).toBe(200)
    app.sqlite.prepare("UPDATE rundowns SET protected_zones=? WHERE id='future'").run(JSON.stringify([{...zone,label:'Escritor B'}]))
    const before=state(),reply=await step('undo')
    expect(reply.statusCode).toBe(409);expect(reply.json().error).toBe('HISTORY_SUPERSEDED');expect(state()).toEqual(before);expect(app.history.state('future').canUndo).toBe(true)
  })
  it('undo de automação exige permissão atual de saídas mesmo com revisão atual',async()=>{
    const now=new Date().toISOString();app.sqlite.prepare('INSERT INTO external_devices VALUES (?,?,?,?,?,?,?)').run('router','Matriz','VIDEOHUB_ROUTER','127.0.0.1',9990,1,now)
    const response=await server.inject({method:'POST',url:'/api/items/live-future/secondary-events',headers:{'if-match':revision()},payload:{...event,type:'DEVICE_AUTOMATION',templateId:'',deviceConfig:{deviceId:'router',targetDevice:'VIDEOHUB_ROUTER',action:'PING',params:{}}}})
    expect(response.statusCode,response.body).toBe(200)
    const before=state();expect((await step('undo',{'x-rplayout-role':'PROGRAMMER'})).statusCode).toBe(403)
    expect(state()).toEqual(before);expect(app.history.state('future').canUndo).toBe(true)
    expect((await step('undo')).statusCode).toBe(200)
  })
})
