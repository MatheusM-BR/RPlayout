import Fastify,{type FastifyInstance} from 'fastify'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {createApp,runtimeFor,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {channels,rundowns,rundownItems,qcDecisions,mediaAssets,secondaryEvents,scheduleRules,operatorDecisions} from '../db/schema.js'
import type {TransportState} from './transport.js'

vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
let app:App,server:FastifyInstance
const etag=(rid='today')=>app.concurrency.generateETag(rid)
const write=(url:string,payload:object,revision?:string)=>server.inject({method:url.endsWith('/move')?'POST':'PATCH',url,payload,headers:revision?{'if-match':revision}:{}})
beforeEach(async()=>{
  app=await createApp(':memory:');const now=new Date().toISOString()
  for(const id of ['a','b'])await app.db.insert(channels).values({id,name:id,rateNum:25,rateDen:1,width:320,height:180,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:now})
  for(const id of ['today','tomorrow','other']){
    await app.db.insert(rundowns).values({id,channelId:id==='other'?'b':'a',name:id,date:id==='tomorrow'?'2026-10-02':'2026-10-01',plannedStart:0,loop:false,createdAt:now,updatedAt:now})
    for(const [index,suffix] of ['one','two','three'].entries())await app.db.insert(rundownItems).values({id:`${id}-${suffix}`,rundownId:id,sortOrder:index*10,title:suffix,type:'LIVE',sourceRef:`ndi:${suffix}`,durationOverride:2500,minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',autoNext:true,loop:false,locked:false,blockId:index<2?'block-'+id:null})
  }
  const runtime=(await runtimeFor(app,'a'))!;await runtime.load('today');await runtime.transport.take('today','today-one')
  server=Fastify();registerRoutes(app,server,()=>{});await server.ready();await app.sources.list()
})
afterEach(async()=>{await server.close();app.close()})
const rows=()=>app.sqlite.prepare('SELECT id,title,sort_order,anchor FROM rundown_items ORDER BY id').all()
const versions=()=>app.sqlite.prepare('SELECT * FROM editorial_revision_counters ORDER BY scope,rundown_id,item_id').all()
const sameTransport=(actual:TransportState,before:TransportState)=>{
  // Playback continues in real time while the editorial API is being checked.
  expect(actual.onAir?.elapsed ?? 0).toBeGreaterThanOrEqual(before.onAir?.elapsed ?? 0)
  expect({...actual,onAir:actual.onAir?{...actual.onAir,elapsed:0}:null}).toEqual({...before,onAir:before.onAir?{...before.onAir,elapsed:0}:null})
}

describe('edição canônica usa a revisão que o operador viu, nunca escrita cega',()=>{
  it('API preserva canais/matriz, exige revisão e desfaz sem trocar CUE/PGM',async()=>{
    const runtime=app.runtimes.get('a')!;await runtime.transport.cue({kind:'ITEM',id:'today-two'})
    const before=runtime.transport.state(),version=etag('tomorrow')
    const payload={scope:'ITEM',audioTrack:1,audio:{mode:'MANUAL',gainDb:-3,measured:null,routing:{mode:'MATRIX',matrix:[[0,0,-1,0],[0,0,0,1]]}}}
    const url='/api/items/tomorrow-two/audio'
    expect((await server.inject({method:'POST',url,payload})).statusCode).toBe(428)
    const accepted=await server.inject({method:'POST',url,payload,headers:{'if-match':version}})
    expect(accepted.statusCode,accepted.body).toBe(200)
    expect(accepted.json().view.items.find((entry:any)=>entry.item.id==='tomorrow-two').audio).toEqual(payload.audio)
    expect(app.db.select().from(rundownItems).all().find(row=>row.id==='tomorrow-two')?.audioTrack).toBe(1)
    expect((await server.inject({method:'POST',url,payload,headers:{'if-match':version}})).statusCode).toBe(409)
    sameTransport(runtime.transport.state(),before)
    expect((await server.inject({method:'POST',url:'/api/rundowns/tomorrow/undo',headers:{'if-match':etag('tomorrow')},payload:{}})).statusCode).toBe(200)
    expect(app.db.select().from(rundownItems).all().find(row=>row.id==='tomorrow-two')?.audio).toBeNull()
    sameTransport(runtime.transport.state(),before)
  })
  it('API recusa matriz inválida e mix AUTO sem medição própria sem escrever',async()=>{
    const url='/api/items/tomorrow-two/audio',before=versions()
    const send=(audio:object)=>server.inject({method:'POST',url,headers:{'if-match':etag('tomorrow')},payload:{scope:'ITEM',audioTrack:1,audio}})
    expect((await send({mode:'MANUAL',gainDb:0,measured:null,routing:{mode:'MATRIX',matrix:[[2],[0]]}})).statusCode).toBe(400)
    const response=await send({mode:'AUTO',gainDb:0,measured:null,routing:{mode:'LEFT_ONLY'}})
    expect(response.statusCode,response.body).toBe(409);expect(response.json().error).toBe('AUDIO_ROUTING_INVALID')
    expect(versions()).toEqual(before)
    expect(app.db.select().from(rundownItems).all().find(row=>row.id==='tomorrow-two')?.audioTrack).toBeNull()
  })
  it('snapshot atual e de outra data possuem revisão da própria grade sem afetar PGM',async()=>{
    const runtime=app.runtimes.get('a')!,before=runtime.transport.state().onAir
    const current=(await server.inject({url:'/api/rundowns/today'})).json().view
    const future=(await server.inject({url:'/api/rundowns/tomorrow'})).json().view
    expect(current.editorialRevision).toBe(app.concurrency.getRundownVersion('today'))
    expect(future.editorialRevision).toBe(app.concurrency.getRundownVersion('tomorrow'))
    expect(current.items.every((entry:any)=>entry.editorialRevision===current.editorialRevision)).toBe(true)
    expect(runtime.transport.state().onAir?.itemId).toBe(before?.itemId);expect(runtime.view?.rundown.id).toBe('today')
    // A cached runtime may be older than an independent DB writer. GET must
    // return both updated rows and their matching revision, not a mixed pair.
    app.sqlite.exec("UPDATE rundown_items SET title='Escritor externo' WHERE id='today-one'")
    const fresh=(await server.inject({url:'/api/rundowns/today'})).json().view
    expect(fresh.items[0].item.title).toBe('Escritor externo');expect(fresh.editorialRevision).toBe(current.editorialRevision+1)
  })
  it.each(['/api/items/today-one','/api/items/today-one/move'])('recusa falta de revisão, ETag inválido e revisão superada sem escrever: %s',async url=>{
    const payload=url.endsWith('/move')?{toIndex:2}:{notes:'Local'}
    const before=rows(),counters=versions(),stale=etag()
    expect((await write(url,payload)).statusCode).toBe(428)
    expect((await write(url,payload,'w/"broken"')).statusCode).toBe(400)
    expect(rows()).toEqual(before);expect(versions()).toEqual(counters);expect(app.history.state('today').canUndo).toBe(false)
    app.sqlite.exec("UPDATE rundown_items SET notes='Outro operador' WHERE id='today-one'")
    const changed=rows(),latest=versions()
    expect((await write(url,payload,stale)).statusCode).toBe(409)
    expect(rows()).toEqual(changed);expect(versions()).toEqual(latest);expect(app.history.state('today').canUndo).toBe(false)
  })
  it('duas edições canônicas com a mesma versão têm só uma vencedora',async()=>{
    const version=etag()
    const responses=await Promise.all(['Estação A','Estação B'].map(title=>write('/api/items/today-one',{title},version)))
    expect(responses.map(res=>res.statusCode).sort()).toEqual([200,409])
    const winner=responses.find(res=>res.statusCode===200)!.json().view
    expect(app.sqlite.prepare("SELECT title FROM rundown_items WHERE id='today-one'").get()).toEqual({title:winner.items[0].item.title})
    expect(winner.editorialRevision).toBe(app.concurrency.getRundownVersion('today'))
  })
  it.each(['/api/items/today-one','/api/items/today-one/move'])('falha na reordenação reverte campos, ordem, revisão e desfazer: %s',async url=>{
    const before=rows(),counters=versions(),version=etag()
    app.sqlite.exec("CREATE TRIGGER fail_order BEFORE UPDATE OF sort_order ON rundown_items WHEN NEW.id='today-two' BEGIN SELECT RAISE(ABORT,'falha de ordem'); END")
    const payload=url.endsWith('/move')?{toIndex:2}:{title:'Não gravado',anchor:{kind:'FIXED',at:5000}}
    expect((await write(url,payload,version)).statusCode).toBe(500)
    expect(rows()).toEqual(before);expect(versions()).toEqual(counters);expect(app.history.state('today').canUndo).toBe(false)
    expect(app.runtimes.get('a')?.transport.state().onAir?.itemId).toBe('today-one')
  })
  it('move bloco inteiro de forma atômica e conserva publicação/PGM da data atual',async()=>{
    const runtime=app.runtimes.get('a')!,original=runtime.transport.state().onAir?.itemId
    const res=await write('/api/items/tomorrow-three/move',{toIndex:0},etag('tomorrow'))
    expect(res.statusCode).toBe(200)
    expect(res.json().view.items.map((entry:any)=>entry.item.id)).toEqual(['tomorrow-three','tomorrow-one','tomorrow-two'])
    expect(runtime.view?.rundown.id).toBe('today');expect(runtime.transport.state().onAir?.itemId).toBe(original)
    expect((await server.inject({method:'POST',url:'/api/rundowns/tomorrow/undo',headers:{'if-match':etag('tomorrow')},payload:{}})).statusCode).toBe(200)
    expect(app.sqlite.prepare("SELECT id FROM rundown_items WHERE rundown_id='tomorrow' ORDER BY sort_order").all()).toEqual(['one','two','three'].map(suffix=>({id:'tomorrow-'+suffix})))
  })
  it('QC global invalida formulários de todos os canais que usam o conteúdo',async()=>{
    const now=new Date().toISOString()
    await app.db.insert(mediaAssets).values({id:'shared',title:'VT',path:'C:/test.mp4',contentHash:'hash',kind:'VIDEO',durationFrames:250,rateNum:25,rateDen:1,createdAt:now})
    app.sqlite.exec("UPDATE rundown_items SET media_id='shared' WHERE id IN ('today-one','other-one')")
    const a=etag(),b=etag('other')
    await app.db.insert(qcDecisions).values({id:'global',assetId:'shared',contentHash:'hash',channelId:'@all',status:'BLOCKED',notes:'Reprovado',checks:{playable:false,errors:[],warnings:[]},createdAt:now})
    expect((await write('/api/items/today-one',{title:'A antiga'},a)).statusCode).toBe(409)
    expect((await write('/api/items/other-one',{title:'B antiga'},b)).statusCode).toBe(409)
  })
  const structuralOperations=[
    {method:'POST' as const,url:'/api/rundowns/today/items',payload:{type:'LIVE',sourceRef:'ndi:New',title:'New',durationOverride:250}},
    {method:'DELETE' as const,url:'/api/items/today-two'},
    {method:'POST' as const,url:'/api/rundowns/today/items/bulk-delete',payload:{ids:['today-two','today-three']}},
    {method:'POST' as const,url:'/api/rundowns/today/blocks',payload:{itemIds:['today-one','today-three']}},
    {method:'POST' as const,url:'/api/blocks/block-today/ungroup',payload:{}},
  ]
  it.each(structuralOperations)('exige revisão e não altera grade, CUE ou histórico com edição antiga: $url',async operation=>{
    const runtime=app.runtimes.get('a')!;await runtime.transport.cue({kind:'ITEM',id:'today-two'})
    const before=app.sqlite.prepare('SELECT * FROM rundown_items ORDER BY id').all(),counters=versions(),transport=runtime.transport.state(),stale=etag()
    expect((await server.inject(operation)).statusCode).toBe(428)
    expect((await server.inject({...operation,headers:{'if-match':'w/"invalid"'}})).statusCode).toBe(400)
    expect(app.sqlite.prepare('SELECT * FROM rundown_items ORDER BY id').all()).toEqual(before)
    expect(versions()).toEqual(counters);sameTransport(runtime.transport.state(),transport)
    expect(app.history.state('today').canUndo).toBe(false)
    app.sqlite.exec("UPDATE rundown_items SET notes='Outra estação' WHERE id='today-three'")
    const current=app.sqlite.prepare('SELECT * FROM rundown_items ORDER BY id').all(),latest=versions()
    expect((await server.inject({...operation,headers:{'if-match':stale}})).statusCode).toBe(409)
    expect(app.sqlite.prepare('SELECT * FROM rundown_items ORDER BY id').all()).toEqual(current)
    expect(versions()).toEqual(latest);sameTransport(runtime.transport.state(),transport)
    expect(app.history.state('today').canUndo).toBe(false)
  })
  it.each(structuralOperations.filter(operation=>operation.method==='POST' && !operation.url.endsWith('/ungroup')))
    ('escrita estrutural é atômica mesmo quando a segunda linha falha: $url',async operation=>{
      const before=app.sqlite.prepare('SELECT * FROM rundown_items ORDER BY id').all(),counters=versions(),transport=app.runtimes.get('a')!.transport.state()
      const deleting=operation.url.endsWith('bulk-delete')
      app.sqlite.exec(deleting
        ? "CREATE TRIGGER fail_structure BEFORE DELETE ON rundown_items WHEN OLD.id='today-three' BEGIN SELECT RAISE(ABORT,'falha estrutural'); END"
        : "CREATE TRIGGER fail_structure BEFORE UPDATE OF sort_order ON rundown_items WHEN NEW.id='today-two' BEGIN SELECT RAISE(ABORT,'falha estrutural'); END")
      expect((await server.inject({...operation,headers:{'if-match':etag()}})).statusCode).toBe(500)
      expect(app.sqlite.prepare('SELECT * FROM rundown_items ORDER BY id').all()).toEqual(before)
      expect(versions()).toEqual(counters);expect(app.history.state('today').canUndo).toBe(false)
      sameTransport(app.runtimes.get('a')!.transport.state(),transport)
    })
  it('remove e desfaz linha com eventos secundários; preserva CUE/PGM de outra data',async()=>{
    const now=new Date().toISOString()
    const event={id:'secondary',channelId:'a',rundownItemId:'tomorrow-one',name:'Logo',type:'GRAPHICS_OVERLAY' as const,targetLayer:'STATION_LOGO' as const,triggerMode:'OFFSET_FROM_START' as const,offsetFrames:0,templateId:'',payload:{},enabled:true}
    await app.db.insert(secondaryEvents).values({id:event.id,channelId:'a',itemId:'tomorrow-one',definition:event,createdAt:now,updatedAt:now})
    const runtime=app.runtimes.get('a')!,transport=runtime.transport.state()
    expect((await server.inject({method:'DELETE',url:'/api/items/tomorrow-one',headers:{'if-match':etag('tomorrow')}})).statusCode).toBe(200)
    expect(app.db.select().from(secondaryEvents).all()).toHaveLength(0)
    sameTransport(runtime.transport.state(),transport)
    expect((await server.inject({method:'POST',url:'/api/rundowns/tomorrow/undo',headers:{'if-match':etag('tomorrow')},payload:{}})).statusCode).toBe(200)
    expect(app.db.select().from(secondaryEvents).all()[0]?.definition).toEqual(event)
    expect(app.sqlite.prepare("SELECT id FROM rundown_items WHERE id='tomorrow-one'").get()).toEqual({id:'tomorrow-one'})
    expect((await server.inject({method:'POST',url:'/api/rundowns/tomorrow/redo',headers:{'if-match':etag('tomorrow')},payload:{}})).statusCode).toBe(200)
    expect(app.db.select().from(secondaryEvents).all()).toHaveLength(0)
    sameTransport(runtime.transport.state(),transport)
  })
  it('recusa seleções estrangeiras e duplicadas; não remove o PGM',async()=>{
    for(const operation of [
      {method:'DELETE' as const,url:'/api/items/today-one'},
      {method:'POST' as const,url:'/api/rundowns/today/items/bulk-delete',payload:{ids:['today-two','tomorrow-two']}},
      {method:'POST' as const,url:'/api/rundowns/today/blocks',payload:{itemIds:['today-two','tomorrow-two']}},
      {method:'POST' as const,url:'/api/rundowns/today/blocks',payload:{itemIds:['today-two','today-two']}},
    ]){
      const before=rows(),counters=versions()
      expect((await server.inject({...operation,headers:{'if-match':etag()}})).statusCode).toBe(400)
      expect(rows()).toEqual(before);expect(versions()).toEqual(counters)
      expect(app.history.state('today').canUndo).toBe(false)
    }
  })
  it('a visão do calendário e a grade recém-criada carregam sua própria revisão',async()=>{
    const calendar=(await server.inject({url:'/api/channels/a/rundowns?date=2026-10-02'})).json().view
    expect(calendar.editorialRevision).toBe(app.concurrency.getRundownVersion('tomorrow'))
    expect(calendar.items.every((entry:any)=>entry.editorialRevision===calendar.editorialRevision)).toBe(true)
    const created=(await server.inject({method:'POST',url:'/api/channels/a/rundowns',payload:{date:'2026-10-03'}})).json().view
    expect(created.editorialRevision).toBe(app.concurrency.getRundownVersion(created.rundown.id))
    expect((await server.inject({method:'POST',url:`/api/rundowns/${created.rundown.id}/items`,headers:{'if-match':`w/"${created.editorialRevision}"`},payload:{type:'LIVE',sourceRef:'ndi:Estúdio',title:'Estúdio'}})).statusCode).toBe(200)
    expect(app.runtimes.get('a')!.view?.rundown.id).toBe('today')
  })
  it.each(['single','bulk'])('remover PRÓXIMO não limpa CUE de outra linha: %s',async kind=>{
    const runtime=app.runtimes.get('a')!
    await runtime.transport.cue({kind:'ITEM',id:'today-three'})
    expect(runtime.transport.state().preparedItemId).toBe('today-two')
    const operation=kind==='single'
      ? {method:'DELETE' as const,url:'/api/items/today-two'}
      : {method:'POST' as const,url:'/api/rundowns/today/items/bulk-delete',payload:{ids:['today-two']}}
    expect((await server.inject({...operation,headers:{'if-match':etag()}})).statusCode).toBe(200)
    expect(runtime.transport.state().onAir?.itemId).toBe('today-one')
    expect(runtime.transport.state().preview).toEqual({kind:'ITEM',id:'today-three'})
  })
  it.each(['undo','redo'])('histórico exige revisão da tela e preserva operação com revisão superada: %s',async action=>{
    expect((await write('/api/items/tomorrow-two',{notes:'Edição'},etag('tomorrow'))).statusCode).toBe(200)
    if(action==='redo')expect((await server.inject({method:'POST',url:'/api/rundowns/tomorrow/undo',headers:{'if-match':etag('tomorrow')},payload:{}})).statusCode).toBe(200)
    const url=`/api/rundowns/tomorrow/${action}`,before=rows(),counters=versions(),history=app.history.state('tomorrow'),stale=etag('tomorrow')
    expect((await server.inject({method:'POST',url,payload:{}})).statusCode).toBe(428)
    expect(rows()).toEqual(before);expect(versions()).toEqual(counters);expect(app.history.state('tomorrow')).toEqual(history)
    app.sqlite.exec("UPDATE rundown_items SET notes='Outra estação' WHERE id='tomorrow-three'")
    const current=rows(),latest=versions()
    expect((await server.inject({method:'POST',url,headers:{'if-match':stale},payload:{}})).statusCode).toBe(409)
    expect(rows()).toEqual(current);expect(versions()).toEqual(latest);expect(app.history.state('tomorrow')).toEqual(history)
  })
  it('revisão nova da tela não permite desfazer sobre uma alteração posterior da própria linha',async()=>{
    expect((await write('/api/items/tomorrow-two',{notes:'Original'},etag('tomorrow'))).statusCode).toBe(200)
    app.sqlite.exec("UPDATE rundown_items SET title='Outra estação' WHERE id='tomorrow-two'")
    const before=rows(),counters=versions()
    const res=await server.inject({method:'POST',url:'/api/rundowns/tomorrow/undo',headers:{'if-match':etag('tomorrow')},payload:{}})
    expect(res.statusCode).toBe(409);expect(res.json().error).toBe('HISTORY_SUPERSEDED')
    expect(rows()).toEqual(before);expect(versions()).toEqual(counters);expect(app.history.state('tomorrow').canUndo).toBe(true)
  })
  it('dois pedidos de desfazer na mesma revisão não desfazem dois passos',async()=>{
    await write('/api/items/tomorrow-two',{notes:'Primeiro'},etag('tomorrow'))
    await write('/api/items/tomorrow-three',{notes:'Segundo'},etag('tomorrow'))
    const version=etag('tomorrow')
    const responses=await Promise.all([1,2].map(()=>server.inject({method:'POST',url:'/api/rundowns/tomorrow/undo',headers:{'if-match':version},payload:{}})))
    expect(responses.map(res=>res.statusCode).sort()).toEqual([200,409])
    expect(app.sqlite.prepare("SELECT notes FROM rundown_items WHERE id='tomorrow-two'").get()).toEqual({notes:'Primeiro'})
    expect(app.sqlite.prepare("SELECT notes FROM rundown_items WHERE id='tomorrow-three'").get()).toEqual({notes:null})
    expect(app.history.state('tomorrow')).toMatchObject({canUndo:true,canRedo:true})
  })
  it('desfazer inserção não apaga o item que já entrou em PGM',async()=>{
    const before=rows()
    const accepted=await server.inject({method:'POST',url:'/api/rundowns/today/items',headers:{'if-match':etag()},payload:{type:'LIVE',title:'Nova no ar',sourceRef:'ndi:NOVA',durationOverride:2500}})
    expect(accepted.statusCode).toBe(200)
    const id=accepted.json().view.items.find((entry:any)=>entry.item.title==='Nova no ar').item.id
    const runtime=app.runtimes.get('a')!;await runtime.transport.take('today',id)
    const current=rows(),counters=versions()
    const rejected=await server.inject({method:'POST',url:'/api/rundowns/today/undo',headers:{'if-match':etag()},payload:{}})
    expect(rejected.statusCode).toBe(409);expect(rejected.json().error).toContain('item no ar')
    expect(rows()).toEqual(current);expect(versions()).toEqual(counters)
    expect(runtime.transport.state().onAir?.itemId).toBe(id)
    await runtime.transport.stop()
    expect((await server.inject({method:'POST',url:'/api/rundowns/today/undo',headers:{'if-match':etag()},payload:{}})).statusCode).toBe(200)
    expect(rows()).toEqual(before)
  })
  const automationOperations=[
    {url:'/api/rundowns/tomorrow/playlist',payload:{text:'C:/fixture.mp4',replace:false}},
    {url:'/api/rundowns/tomorrow/autofill',payload:{minutes:2}},
    {url:'/api/rundowns/tomorrow/autofill-day',payload:{}},
  ]
  const reviewAutomation=async(operation:typeof automationOperations[number])=>{
    if(operation.url.endsWith('/playlist'))return operation
    const review=await server.inject({method:'POST',url:operation.url,payload:{...operation.payload,preview:true}})
    expect(review.statusCode,review.body).toBe(200)
    return {...operation,payload:{proposalId:review.json().proposal.id}}
  }
  const enableAutomation=async()=>{
    const now=new Date().toISOString()
    await app.db.insert(mediaAssets).values({id:'auto-asset',title:'VT auto',path:'C:/fixture.mp4',contentHash:'auto-hash',kind:'VIDEO',durationFrames:2500,durationNs:100_000_000_000,rateNum:25,rateDen:1,width:320,height:180,interlaceMode:'progressive',hasAudio:true,qcStatus:'APPROVED',createdAt:now})
    await app.db.insert(scheduleRules).values({id:'band',channelId:'a',name:'Pauta QA',weekdays:'0123456',startMinute:0,endMinute:2,categories:[],avoidHours:0,createdAt:now})
  }
  const scopeRows=()=>app.sqlite.prepare('SELECT id,trim,audio,audio_track FROM rundown_items ORDER BY id').all()
  const wideScopeFixture=async()=>{
    await enableAutomation()
    app.sqlite.exec("UPDATE rundown_items SET type='VT',source_ref=NULL,media_id='auto-asset' WHERE id IN ('tomorrow-two','other-two')")
  }
  const reviewScope=async(scope:string)=>{
    const response=await server.inject({url:`/api/items/tomorrow-two/edit-scope?scope=${scope}`,headers:{'if-match':etag('tomorrow')}})
    expect(response.statusCode,response.body).toBe(200);return response.json().review
  }
  const scopedBody=(kind:string,gain=-3)=>kind==='trim'?{trim:{in:25,out:250},scope:'ITEM'}:{audio:{mode:'MANUAL',gainDb:gain,measured:null},audioTrack:1,scope:'ITEM'}
  it.each(['ALL_RUNDOWNS','ASSET_DEFAULT'])('revisão de escopo é somente leitura, com canal/dia e sem caminho privado: %s',async scope=>{
    await wideScopeFixture()
    const before=scopeRows(),counters=versions(),review=await reviewScope(scope)
    expect(review).toMatchObject({itemId:'tomorrow-two',sourceRevision:app.concurrency.getRundownVersion('tomorrow'),scope,references:2})
    expect(review.owners.map((owner:any)=>[owner.channelId,owner.rundownId,owner.count]).sort()).toEqual([['a','tomorrow',1],['b','other',1]])
    expect(JSON.stringify(review)).not.toContain('C:/fixture.mp4')
    expect(scopeRows()).toEqual(before);expect(versions()).toEqual(counters);expect(app.history.state('tomorrow').canUndo).toBe(false)
  })
  it('consulta do escopo mantém revisão da origem, não a substitui pela atual',async()=>{
    await wideScopeFixture()
    const url='/api/items/tomorrow-two/edit-scope?scope=ALL_RUNDOWNS',old=etag('tomorrow')
    expect((await server.inject({url})).statusCode).toBe(428)
    app.sqlite.exec("UPDATE rundown_items SET notes='Posterior' WHERE id='tomorrow-two'")
    expect((await server.inject({url,headers:{'if-match':old}})).statusCode).toBe(409)
  })
  it.each(['ALL_RUNDOWNS','ASSET_DEFAULT'])('API de corte conserva tempo entre canais e undo repõe dados e unidade: %s',async scope=>{
    await wideScopeFixture()
    app.sqlite.exec("UPDATE channels SET rate_num=50 WHERE id='b'")
    const before=app.db.select().from(rundownItems).all(),assets=app.db.select().from(mediaAssets).all()
    const review=await reviewScope(scope)
    const response=await server.inject({method:'POST',url:'/api/items/tomorrow-two/trim',headers:{'if-match':etag('tomorrow')},payload:{scope,scopeReviewToken:review.token,trim:{in:25,out:100}}})
    expect(response.statusCode,response.body).toBe(200)
    if(scope==='ALL_RUNDOWNS')expect(app.sqlite.prepare("SELECT trim FROM rundown_items WHERE id='other-two'").get()).toEqual({trim:'{"in":50,"out":200}'})
    else {
      const shared=(await server.inject({url:'/api/rundowns/other'})).json().view.items.find((entry:any)=>entry.item.id==='other-two')
      expect(shared.trim).toEqual({in:50,out:200})
      expect(app.db.select().from(mediaAssets).get()).toMatchObject({defaultTrimRateNum:25,defaultTrimRateDen:1})
    }
    expect((await server.inject({method:'POST',url:'/api/rundowns/tomorrow/undo',headers:{'if-match':etag('tomorrow')},payload:{}})).statusCode).toBe(200)
    expect(app.db.select().from(rundownItems).all()).toEqual(before);expect(app.db.select().from(mediaAssets).all()).toEqual(assets)
    expect(app.runtimes.get('a')!.transport.state().onAir?.itemId).toBe('today-one')
  })
  it('trecho vazio após conversão é conflito explícito, não erro genérico nem escrita parcial',async()=>{
    await wideScopeFixture()
    app.sqlite.exec("UPDATE channels SET rate_num=1 WHERE id='b'")
    const review=await reviewScope('ALL_RUNDOWNS'),before=app.db.select().from(rundownItems).all(),counters=versions()
    const response=await server.inject({method:'POST',url:'/api/items/tomorrow-two/trim',headers:{'if-match':etag('tomorrow')},payload:{scope:'ALL_RUNDOWNS',scopeReviewToken:review.token,trim:{in:0,out:1}}})
    expect(response.statusCode,response.body).toBe(409);expect(response.json().error).toBe('TRIM_CADENCE_UNREPRESENTABLE')
    expect(app.db.select().from(rundownItems).all()).toEqual(before);expect(versions()).toEqual(counters)
    expect(app.history.state('tomorrow').canUndo).toBe(false)
  })
  it.each(['trim','audio'].flatMap(kind=>['ALL_RUNDOWNS','ASSET_DEFAULT'].map(scope=>({kind,scope}))))('confirmar $kind/$scope não altera outra grade superada, mesmo com revisão atual da origem',async({kind,scope})=>{
    await wideScopeFixture()
    const review=await reviewScope(scope),sourceRevision=etag('tomorrow'),url=`/api/items/tomorrow-two/${kind}`,payload={...scopedBody(kind),scope}
    expect((await server.inject({method:'POST',url,headers:{'if-match':sourceRevision},payload})).statusCode).toBe(428)
    app.sqlite.prepare('UPDATE rundown_items SET audio=?,notes=? WHERE id=?').run(JSON.stringify({mode:'MANUAL',gainDb:-2,measured:null}),'Outro operador','other-two')
    expect(etag('tomorrow')).toBe(sourceRevision)
    const before=scopeRows(),counters=versions(),asset=app.db.select().from(mediaAssets).all()
    const rejected=await server.inject({method:'POST',url,headers:{'if-match':sourceRevision},payload:{...payload,scopeReviewToken:review.token}})
    expect(rejected.statusCode,rejected.body).toBe(409);expect(rejected.json().error).toBe('SCOPE_REVIEW_SUPERSEDED')
    expect(scopeRows()).toEqual(before);expect(versions()).toEqual(counters);expect(app.db.select().from(mediaAssets).all()).toEqual(asset)
    expect(app.history.state('tomorrow').canUndo).toBe(false)
    const refreshed=await reviewScope(scope)
    expect(refreshed.token).not.toBe(review.token)
    const accepted=await server.inject({method:'POST',url,headers:{'if-match':sourceRevision},payload:{...payload,scopeReviewToken:refreshed.token}})
    expect(accepted.statusCode,accepted.body).toBe(200)
    expect(app.runtimes.get('a')!.transport.state().onAir?.itemId).toBe('today-one')
  })
  it.each(['trim','audio'])('corte/áudio exige revisão capturada antes de gravar qualquer campo: %s',async kind=>{
    const url=`/api/items/tomorrow-two/${kind}`,payload=scopedBody(kind),before=scopeRows(),counters=versions(),old=etag('tomorrow')
    expect((await server.inject({method:'POST',url,payload})).statusCode).toBe(428)
    expect((await server.inject({method:'POST',url,headers:{'if-match':'w/"invalid"'},payload})).statusCode).toBe(400)
    expect(scopeRows()).toEqual(before);expect(versions()).toEqual(counters);expect(app.history.state('tomorrow').canUndo).toBe(false)
    app.sqlite.exec("UPDATE rundown_items SET notes='Outra estação' WHERE id='tomorrow-two'")
    const latest=versions()
    expect((await server.inject({method:'POST',url,headers:{'if-match':old},payload})).statusCode).toBe(409)
    expect(scopeRows()).toEqual(before);expect(versions()).toEqual(latest);expect(app.history.state('tomorrow').canUndo).toBe(false)
  })
  it.each(['trim','audio'])('escopo restrito confirmado pode ser desfeito com campos/trilha juntos: %s',async kind=>{
    const before=scopeRows()
    const response=await server.inject({method:'POST',url:`/api/items/tomorrow-two/${kind}`,headers:{'if-match':etag('tomorrow')},payload:scopedBody(kind)})
    expect(response.statusCode,response.body).toBe(200)
    if(kind==='audio')expect(app.sqlite.prepare("SELECT audio_track FROM rundown_items WHERE id='tomorrow-two'").get()).toEqual({audio_track:1})
    expect((await server.inject({method:'POST',url:'/api/rundowns/tomorrow/undo',headers:{'if-match':etag('tomorrow')},payload:{}})).statusCode).toBe(200)
    expect(scopeRows()).toEqual(before)
  })
  it.each(['trim','audio'])('só uma confirmação de corte/áudio vence na mesma revisão: %s',async kind=>{
    const revision=etag('tomorrow')
    const responses=await Promise.all([1,2].map(gain=>server.inject({method:'POST',url:`/api/items/tomorrow-two/${kind}`,headers:{'if-match':revision},payload:scopedBody(kind,-gain)})))
    expect(responses.map(res=>res.statusCode).sort()).toEqual([200,409])
    expect(app.history.state('tomorrow').canUndo).toBe(true)
  })
  it('falha no ganho reverte a trilha já preparada, nível e contadores, sem histórico fictício',async()=>{
    const before=scopeRows(),counters=versions()
    app.sqlite.exec("CREATE TRIGGER fail_level BEFORE UPDATE OF audio ON rundown_items BEGIN SELECT RAISE(ABORT,'falha após selecionar trilha'); END")
    const response=await server.inject({method:'POST',url:'/api/items/tomorrow-two/audio',headers:{'if-match':etag('tomorrow')},payload:scopedBody('audio')})
    expect(response.statusCode).toBe(500)
    expect(scopeRows()).toEqual(before);expect(versions()).toEqual(counters);expect(app.history.state('tomorrow').canUndo).toBe(false)
  })
  it.each(automationOperations)('importação/montagem não escreve com revisão ausente ou superada: $url',async operation=>{
    await enableAutomation()
    const before=rows(),counters=versions(),stale=etag('tomorrow')
    expect((await server.inject({method:'POST',...operation})).statusCode).toBe(428)
    expect(rows()).toEqual(before);expect(versions()).toEqual(counters)
    app.sqlite.exec("UPDATE rundown_items SET notes='Outra estação' WHERE id='tomorrow-three'")
    const current=rows(),latest=versions()
    expect((await server.inject({method:'POST',...operation,headers:{'if-match':stale}})).statusCode).toBe(409)
    expect(rows()).toEqual(current);expect(versions()).toEqual(latest);expect(app.history.state('tomorrow').canUndo).toBe(false)
  })
  it.each(automationOperations)('importação/montagem não deixa inserção parcial nem versão/histórico fictícios: $url',async operation=>{
    await enableAutomation()
    const before=rows(),counters=versions()
    app.sqlite.exec("CREATE TRIGGER fail_automation BEFORE UPDATE OF sort_order ON rundown_items WHEN NEW.id='tomorrow-two' BEGIN SELECT RAISE(ABORT,'falha depois da inserção'); END")
    const res=await server.inject({method:'POST',...await reviewAutomation(operation),headers:{'if-match':etag('tomorrow')}})
    expect(res.statusCode,res.body).toBe(500)
    expect(rows()).toEqual(before);expect(versions()).toEqual(counters);expect(app.history.state('tomorrow').canUndo).toBe(false)
    expect(app.sqlite.prepare("SELECT * FROM playlist_versions WHERE rundown_id='tomorrow'").all()).toHaveLength(0)
  })
  it.each(automationOperations)('importação/montagem aceita revisão e permite desfazer/refazer sem tocar no PGM: $url',async operation=>{
    await enableAutomation()
    const before=rows(),transport=app.runtimes.get('a')!.transport.state()
    const accepted=await server.inject({method:'POST',...await reviewAutomation(operation),headers:{'if-match':etag('tomorrow')}})
    expect(accepted.statusCode,accepted.body).toBe(200)
    const changed=rows();expect(changed.length).toBeGreaterThan(before.length)
    const revision=accepted.json().view.editorialRevision
    expect(revision).toBe(app.concurrency.getRundownVersion('tomorrow'))
    expect((await server.inject({method:'POST',url:'/api/rundowns/tomorrow/undo',headers:{'if-match':etag('tomorrow')},payload:{}})).statusCode).toBe(200)
    expect(rows()).toEqual(before)
    expect((await server.inject({method:'POST',url:'/api/rundowns/tomorrow/redo',headers:{'if-match':etag('tomorrow')},payload:{}})).statusCode).toBe(200)
    expect(rows()).toEqual(changed);sameTransport(app.runtimes.get('a')!.transport.state(),transport)
  })
  it('proposta persistida não altera grade, contadores, histórico de undo ou PGM',async()=>{
    await enableAutomation()
    const before=rows(),counters=versions()
    expect((await server.inject({method:'POST',url:'/api/rundowns/tomorrow/autofill',payload:{minutes:2,preview:true}})).statusCode).toBe(200)
    expect(rows()).toEqual(before);expect(versions()).toEqual(counters);expect(app.history.state('tomorrow').canUndo).toBe(false)
  })
  it.each(automationOperations)('importação/montagem usa cadência atual mesmo se o runtime em outra data ficou antigo: $url',async operation=>{
    await enableAutomation()
    app.sqlite.exec("UPDATE channels SET rate_num=50 WHERE id='a'")
    expect(app.runtimes.get('a')!.channel.rate.num).toBe(25)
    const response=await server.inject({method:'POST',...await reviewAutomation(operation),headers:{'if-match':etag('tomorrow')}})
    expect(response.statusCode,response.body).toBe(200)
    const inserted=response.json().view.items.filter((entry:any)=>entry.item.mediaId==='auto-asset')
    expect(inserted.length).toBeGreaterThan(0)
    expect(inserted.every((entry:any)=>entry.item.minDuration===5000)).toBe(true)
    if(operation.url.endsWith('/autofill'))expect(response.json().plan.items[0].durationFrames).toBe(5000)
    expect(app.runtimes.get('a')!.transport.state().onAir?.itemId).toBe('today-one')
  })
  it.each(automationOperations)('importação/montagem resolve corte padrão na unidade do canal: $url',async operation=>{
    await enableAutomation()
    app.sqlite.exec(`UPDATE media_assets SET default_trim='{"in":50,"out":1500}',default_trim_rate_num=50,default_trim_rate_den=1 WHERE id='auto-asset'`)
    const response=await server.inject({method:'POST',...await reviewAutomation(operation),headers:{'if-match':etag('tomorrow')}})
    expect(response.statusCode,response.body).toBe(200)
    const inserted=response.json().view.items.filter((entry:any)=>entry.item.mediaId==='auto-asset')
    expect(inserted.length).toBeGreaterThan(0)
    expect(inserted.every((entry:any)=>entry.trim.in===25 && entry.trim.out===750 && entry.item.minDuration===725)).toBe(true)
  })
  it('importar para editorial não registra publicação operacional',async()=>{
    await enableAutomation()
    const response=await server.inject({method:'POST',url:'/api/rundowns/tomorrow/playlist',headers:{'if-match':etag('tomorrow')},payload:{text:'C:/fixture.mp4',replace:true}})
    expect(response.statusCode,response.body).toBe(200)
    const decisions=app.db.select().from(operatorDecisions).all().filter(row=>row.rundownId==='tomorrow')
    expect(decisions.some(row=>row.kind==='EDITORIAL_PLAYLIST_IMPORTED' && row.payload.editorialOnly===true)).toBe(true)
    expect(decisions.some(row=>row.kind.includes('PUBLISHED'))).toBe(false)
    expect(app.sqlite.prepare("SELECT * FROM operational_playlist_revisions WHERE rundown_id='tomorrow'").all()).toHaveLength(0)
  })
})
