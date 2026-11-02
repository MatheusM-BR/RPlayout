import Fastify, {type FastifyInstance} from 'fastify'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {createApp,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {channels,rundowns,rundownItems,users,sessions,graphicTemplates,itemGraphics,guestKeys,destinations,mediaAssets,qcDecisions} from '../db/schema.js'
import {sessionDigest} from './access.js'
import {randomUUID} from 'node:crypto'

vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
let app:App,server:FastifyInstance
let globalConcurrencyManager:App['concurrency'],initialVersion:number
let prefix:string
const headers=(actor='one')=>({cookie:`rplayout_session=${prefix}-${actor}`})
const rid=(channel='own')=>`${prefix}-${channel}`
const iid=(channel='own')=>`${rid(channel)}-item`
const scopeToken=async(scope:string,actor='admin')=>{
  const response=await server.inject({method:'GET',url:`/api/items/${iid()}/edit-scope?scope=${scope}`,headers:{...headers(actor),'if-match':app.concurrency.generateETag(rid())}})
  expect(response.statusCode,response.body).toBe(200);return response.json().review.token as string
}
beforeEach(async()=>{
  prefix=randomUUID()
  app=await createApp(':memory:')
  globalConcurrencyManager=app.concurrency
  const now=new Date().toISOString()
  for(const id of ['own','other','archive']){
    await app.db.insert(channels).values({id,name:id,rateNum:25,rateDen:1,width:320,height:180,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:now})
    await app.db.insert(rundowns).values({id:rid(id),channelId:id,name:id,date:'2026-10-01',plannedStart:0,loop:false,createdAt:now,updatedAt:now})
    await app.db.insert(rundownItems).values({id:iid(id),rundownId:rid(id),sortOrder:0,title:id,type:'LIVE',sourceRef:'ndi:CAM',durationOverride:2500,minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',autoNext:true,loop:false,locked:false,blockId:`block-${id}`})
    await app.db.insert(graphicTemplates).values({id:`tpl-${id}`,channelId:id,name:id,svg:'<svg/>',fields:[],fadeMs:300,createdAt:now})
    await app.db.insert(itemGraphics).values({id:`cue-${id}`,itemId:iid(id),templateId:`tpl-${id}`,values:{},atSeconds:0,createdAt:now})
    await app.db.insert(guestKeys).values({id:`guest-${id}`,channelId:id,label:id,streamKey:'test-key',enabled:false,createdAt:now})
    await app.db.insert(destinations).values({id:`dest-${id}`,channelId:id,name:id,url:'rtmp://localhost/live',enabled:false,createdAt:now})
  }
  app.sqlite.prepare('UPDATE channels SET archived_at=? WHERE id=?').run(now,'archive')
  await app.db.insert(graphicTemplates).values({id:'tpl-global',channelId:null,name:'Global',svg:'<svg/>',fields:[],fadeMs:300,createdAt:now})
  for(const id of ['one','two','admin']){
    await app.db.insert(users).values({id,username:id,passwordHash:'not-used',role:id==='admin'?'ADMIN':'SUPERVISOR',enabled:true,createdAt:now})
    await app.db.insert(sessions).values({token:sessionDigest(`${prefix}-${id}`),userId:id,expiresAt:new Date(Date.now()+60000).toISOString(),createdAt:now})
    if(id!=='admin')app.sqlite.prepare('INSERT INTO user_access VALUES (?,?,?,?)').run(id,JSON.stringify(['own','archive']),null,now)
  }
  server=Fastify();registerRoutes(app,server,()=>{});await server.ready();await app.sources.list()
  initialVersion=globalConcurrencyManager.getRundownVersion(rid())
})
afterEach(async()=>{await server.close();app.close()})

describe('propriedade e revisão das rotas colaborativas',()=>{
  it('entrega linhas e revisões correspondentes num snapshot e restringe a grade consultada',async()=>{
    const res=await server.inject({url:`/api/v1/rundowns/${rid()}/revisions`,headers:headers()})
    expect(res.statusCode).toBe(200)
    expect(res.headers.etag).toBe(globalConcurrencyManager.generateETag(rid()))
    expect(res.json()).toMatchObject({rundownId:rid(),rundownVersion:initialVersion,items:[{item:{id:iid(),title:'own'},lineVersion:globalConcurrencyManager.getLineVersion(rid(),iid())}]})
    expect((await server.inject({url:`/api/v1/rundowns/${rid('other')}/revisions?channelId=own`,headers:headers()})).statusCode).toBe(403)
    expect((await server.inject({url:'/api/v1/rundowns/missing/revisions',headers:headers('admin')})).statusCode).toBe(404)
  })
  it('não permite escrita cega e aceita somente uma de duas edições com a mesma revisão',async()=>{
    const url=`/api/v1/rundowns/${rid()}/items/${iid()}`
    expect((await server.inject({method:'PUT',url,headers:headers(),payload:{patch:{title:'Cega'}}})).statusCode).toBe(428)
    expect(globalConcurrencyManager.getRundownVersion(rid())).toBe(initialVersion)
    const responses=await Promise.all(['one','two'].map(actor=>server.inject({method:'PUT',url,headers:headers(actor),payload:{expectedRundownVersion:initialVersion,patch:{title:actor}}})))
    expect(responses.map(res=>res.statusCode).sort()).toEqual([200,409])
    const accepted=responses.find(res=>res.statusCode===200)!,rejected=responses.find(res=>res.statusCode===409)!
    expect(accepted.json().newRundownVersion).toBe(initialVersion+1)
    expect(rejected.json()).toMatchObject({error:'OPTIMISTIC_LOCK_CONFLICT',currentRundownVersion:initialVersion+1})
    expect(app.sqlite.prepare('SELECT title FROM rundown_items WHERE id=?').get(iid())).toEqual({title:accepted.json().item.title})
  })
  it('escritor legado invalida a edição; versão atual no corpo não neutraliza If-Match antigo',async()=>{
    const oldETag=globalConcurrencyManager.generateETag(rid(),iid())
    app.sqlite.prepare('UPDATE rundown_items SET title=? WHERE id=?').run('Outro operador',iid())
    const res=await server.inject({method:'PUT',url:`/api/v1/rundowns/${rid()}/items/${iid()}`,headers:{...headers(),'if-match':oldETag},payload:{expectedRundownVersion:initialVersion+1,patch:{title:'Sobrescrever'}}})
    expect(res.statusCode).toBe(409);expect(globalConcurrencyManager.getRundownVersion(rid())).toBe(initialVersion+1)
    const timeline=await server.inject({url:`/api/v1/timeline/${rid()}/multitrack`,headers:headers()})
    expect(timeline.json().rundownVersion).toBe(initialVersion+1)
  })
  it('descartar alterações não escreve nem aumenta revisão; merge usa a revisão que foi comparada',async()=>{
    const url=`/api/v1/rundowns/${rid()}/resolve-conflict`
    const discard=await server.inject({method:'POST',url,headers:headers(),payload:{itemId:iid(),clientRundownVersion:initialVersion,resolutionStrategy:'DISCARD_MINE',patch:{title:'Ignorado'}}})
    expect(discard.statusCode).toBe(200);expect(discard.json()).toMatchObject({newRundownVersion:initialVersion,resolvedData:{title:'own'}})
    const merge=await server.inject({method:'POST',url,headers:headers(),payload:{itemId:iid(),clientRundownVersion:initialVersion,resolutionStrategy:'APPLY_MERGED_FIELDS',mergedData:{title:'Mesclado'}}})
    expect(merge.statusCode).toBe(200);expect(merge.json()).toMatchObject({newRundownVersion:initialVersion+1,resolvedData:{title:'Mesclado'}})
    expect((await server.inject({method:'POST',url,headers:headers(),payload:{itemId:iid(),clientRundownVersion:initialVersion,resolutionStrategy:'OVERWRITE_FORCE',patch:{title:'Antigo'}}})).statusCode).toBe(409)
  })
  it('permite timeline própria nas duas rotas, sem conceder canal externo pela query',async()=>{
    for(const url of [`/api/v1/timeline/${rid()}/multitrack`,`/api/v1/tenants/default/channels/own/timeline`])expect((await server.inject({url,headers:headers()})).statusCode).toBe(200)
    expect((await server.inject({url:`/api/v1/timeline/${rid('other')}/multitrack?channelId=own`,headers:headers()})).statusCode).toBe(403)
  })
  it('rejeita item estrangeiro no PUT e no merge, mesmo para administrador',async()=>{
    const put=await server.inject({method:'PUT',url:`/api/v1/rundowns/${rid()}/items/${iid('other')}`,headers:headers('admin'),payload:{patch:{title:'invaded'}}})
    const merge=await server.inject({method:'POST',url:`/api/v1/rundowns/${rid()}/resolve-conflict`,headers:headers('admin'),payload:{itemId:iid('other'),clientRundownVersion:initialVersion,resolutionStrategy:'OVERWRITE_FORCE',patch:{title:'invaded'}}})
    expect(put.statusCode).toBe(404);expect(merge.statusCode).toBe(404)
    expect(app.sqlite.prepare('SELECT title FROM rundown_items WHERE id=?').get(iid('other'))).toEqual({title:'other'})
    expect(globalConcurrencyManager.getRundownVersion(rid())).toBe(initialVersion)
  })
  it('restrição inclui item da URL e bloqueia edição de outro canal',async()=>{
    expect((await server.inject({method:'PUT',url:`/api/v1/rundowns/${rid()}/items/${iid('other')}`,headers:headers(),payload:{patch:{title:'no'}}})).statusCode).toBe(403)
  })
  it('lock usa a sessão real e não libera o bloqueio de outro operador por userId forjado',async()=>{
    const url=`/api/v1/rundowns/${rid()}`
    const lock=await server.inject({method:'POST',url:`${url}/acquire-lock`,headers:headers(),payload:{itemId:iid(),userId:'admin',userName:'Inventado'}})
    expect(lock.json().lockState.lineLocks[iid()]).toBe('one')
    const release=await server.inject({method:'POST',url:`${url}/release-lock`,headers:headers('two'),payload:{itemId:iid(),userId:'one'}})
    expect(release.statusCode).toBe(409)
    expect(release.json().lockState.lineLocks[iid()]).toBe('one')
    expect((await server.inject({method:'POST',url:`${url}/acquire-lock`,headers:headers('two'),payload:{itemId:iid(),userId:'one'}})).statusCode).toBe(409)
    await server.inject({method:'POST',url:`${url}/release-lock`,headers:headers(),payload:{itemId:iid()}})
    expect((await server.inject({method:'POST',url:`${url}/acquire-lock`,headers:headers('two'),payload:{itemId:iid()}})).json().lockState.lineLocks[iid()]).toBe('two')
  })
  it('não cria lock para grade/item inexistente ou vínculo incorreto',async()=>{
    for(const [grade,item] of [[rid(),iid('other')],['missing',iid()]])expect((await server.inject({method:'POST',url:`/api/v1/rundowns/${grade}/acquire-lock`,headers:headers('admin'),payload:{itemId:item}})).statusCode).toBe(404)
    expect(globalConcurrencyManager.getLockState(rid()).lineLocks).toEqual({})
  })
  it.each([{durationOverride:-1},{durationOverride:1.5},{durationOverride:5,minDuration:6},{mediaId:'different'},{title:''}])('recusa patch inválido sem alterar revisão: %j',async patch=>{
    const res=await server.inject({method:'PUT',url:`/api/v1/rundowns/${rid()}/items/${iid()}`,headers:headers(),payload:{patch}})
    expect(res.statusCode).toBe(400);expect(globalConcurrencyManager.getRundownVersion(rid())).toBe(initialVersion)
  })
  it('rejeita revisão futura, ETag malformado e merge já superado',async()=>{
    const url=`/api/v1/rundowns/${rid()}/items/${iid()}`
    expect((await server.inject({method:'PUT',url,headers:headers(),payload:{expectedRundownVersion:99,patch:{title:'no'}}})).statusCode).toBe(409)
    expect((await server.inject({method:'PUT',url,headers:{...headers(),'if-match':'w/"1junk"'},payload:{patch:{title:'no'}}})).statusCode).toBe(400)
    expect((await server.inject({method:'POST',url:`/api/v1/rundowns/${rid()}/resolve-conflict`,headers:headers(),payload:{itemId:iid(),clientRundownVersion:99,resolutionStrategy:'OVERWRITE_FORCE',patch:{title:'no'}}})).statusCode).toBe(409)
  })
  it('edita o item próprio, respeita nulidade e registra canal na auditoria',async()=>{
    const res=await server.inject({method:'PUT',url:`/api/v1/rundowns/${rid()}/items/${iid()}`,headers:headers(),payload:{expectedRundownVersion:initialVersion,patch:{title:'Novo',durationOverride:null,notes:null}}})
    expect(res.statusCode).toBe(200);expect(res.json().item).toMatchObject({title:'Novo',durationOverride:null,notes:null})
    const audit=(await server.inject({url:'/api/audit?channelId=own',headers:headers()})).json().entries
    expect(audit.some((row:any)=>row.kind==='API_MUTATION' && row.payload.channelIds.includes('own'))).toBe(true)
  })
  it('a proposta de autofill não aprova mídia para outro canal e não insere item fictício',async()=>{
    const now=new Date().toISOString()
    await app.db.insert(mediaAssets).values({id:'filler',title:'Filler',path:'X:/filler.mp4',contentHash:'hash',kind:'VIDEO',categoryId:'FILLER',durationFrames:750,rateNum:25,rateDen:1,qcStatus:'APPROVED',createdAt:now})
    await app.db.insert(qcDecisions).values({id:'approval-other',assetId:'filler',contentHash:'hash',channelId:'other',status:'APPROVED',notes:'',checks:{playable:true,errors:[],warnings:[]},createdAt:now})
    const before=app.sqlite.prepare('SELECT COUNT(*) AS n FROM rundown_items').get()
    const res=await server.inject({method:'POST',url:`/api/v1/rundowns/${rid()}/autofill-gap`,headers:headers(),payload:{gapDurationMs:30000,gapStartMs:60000}})
    expect(res.statusCode).toBe(200);expect(res.json()).toMatchObject({applied:false,requiresReview:true,remainingGapMs:30000,applyParameters:{proposalId:res.json().proposal.id}})
    expect(res.json().plan.items).toEqual([])
    expect(app.sqlite.prepare('SELECT COUNT(*) AS n FROM rundown_items').get()).toEqual(before)
  })
})

describe('grafismos e recursos indiretos respeitam canal e arquivamento',()=>{
  it.each(['trim','audio'])('escopo %s não atravessa canal não autorizado nem grava padrão global',async kind=>{
    const now=new Date().toISOString()
    await app.db.insert(mediaAssets).values({id:'shared',title:'Compartilhado',path:'C:/shared.mp4',contentHash:'hash',kind:'VIDEO',durationFrames:2500,rateNum:25,rateDen:1,createdAt:now})
    app.sqlite.prepare('UPDATE rundown_items SET media_id=? WHERE id IN (?,?)').run('shared',iid(),iid('other'))
    const versions=app.sqlite.prepare('SELECT * FROM editorial_revision_counters ORDER BY scope,rundown_id,item_id').all()
    const value=kind==='trim'?{trim:{in:25,out:250}}:{audio:{mode:'MANUAL',gainDb:-3,measured:null}}
    for(const scope of ['ALL_RUNDOWNS','ASSET_DEFAULT']){
      const review=await server.inject({url:`/api/items/${iid()}/edit-scope?scope=${scope}`,headers:{...headers(),'if-match':app.concurrency.generateETag(rid())}})
      expect(review.statusCode).toBe(403);expect(review.body).not.toContain('C:/shared.mp4');expect(review.body).not.toContain('channelName')
      const res=await server.inject({method:'POST',url:`/api/items/${iid()}/${kind}`,headers:headers(),payload:{...value,scope}})
      expect(res.statusCode).toBe(403);expect(res.json().error).toContain('canal')
      expect(app.sqlite.prepare('SELECT * FROM editorial_revision_counters ORDER BY scope,rundown_id,item_id').all()).toEqual(versions)
      expect(app.history.state(rid()).canUndo).toBe(false)
    }
    expect(app.sqlite.prepare('SELECT default_trim,default_audio FROM media_assets WHERE id=?').get('shared')).toEqual({default_trim:null,default_audio:null})
    const own=await server.inject({method:'POST',url:`/api/items/${iid()}/${kind}`,headers:{...headers(),'if-match':app.concurrency.generateETag(rid())},payload:{...value,scope:'ITEM'}})
    expect(own.statusCode).toBe(200);expect(app.history.state(rid()).canUndo).toBe(true)
    expect(app.sqlite.prepare(`SELECT ${kind} AS value FROM rundown_items WHERE id=?`).get(iid('other'))).toEqual({value:null})
  })
  it.each(['trim','audio'])('ADMIN não altera grade arquivada por escopo %s indireto',async kind=>{
    const now=new Date().toISOString()
    await app.db.insert(mediaAssets).values({id:'archived-shared',title:'Compartilhado',path:'C:/shared.mp4',contentHash:'hash',kind:'VIDEO',durationFrames:2500,rateNum:25,rateDen:1,createdAt:now})
    app.sqlite.prepare('UPDATE rundown_items SET media_id=? WHERE id IN (?,?)').run('archived-shared',iid(),iid('archive'))
    const version=app.concurrency.getRundownVersion(rid())
    const value=kind==='trim'?{trim:{in:25,out:250}}:{audio:{mode:'MANUAL',gainDb:-3,measured:null}}
    for(const scope of ['ALL_RUNDOWNS','ASSET_DEFAULT'])expect((await server.inject({method:'POST',url:`/api/items/${iid()}/${kind}`,headers:headers('admin'),payload:{...value,scope}})).statusCode).toBe(409)
    expect(app.concurrency.getRundownVersion(rid())).toBe(version);expect(app.history.state(rid()).canUndo).toBe(false)
  })
  it('edição global autorizada audita todos os proprietários e só registra desfazer após commit',async()=>{
    const now=new Date().toISOString()
    await app.db.insert(mediaAssets).values({id:'shared-authorized',title:'Compartilhado',path:'C:/shared.mp4',contentHash:'hash',kind:'VIDEO',durationFrames:2500,rateNum:25,rateDen:1,createdAt:now})
    app.sqlite.prepare('UPDATE rundown_items SET media_id=? WHERE id IN (?,?)').run('shared-authorized',iid(),iid('other'))
    const url=`/api/items/${iid()}/trim`,payload={trim:{in:25,out:250},scope:'ASSET_DEFAULT',scopeReviewToken:await scopeToken('ASSET_DEFAULT')}
    app.sqlite.exec(`CREATE TRIGGER fail_scoped_edit BEFORE UPDATE OF trim ON rundown_items WHEN NEW.id='${iid()}' BEGIN SELECT RAISE(ABORT,'falha simulada'); END`)
    expect((await server.inject({method:'POST',url,headers:{...headers('admin'),'if-match':app.concurrency.generateETag(rid())},payload})).statusCode).toBe(500)
    expect(app.history.state(rid()).canUndo).toBe(false)
    expect(app.sqlite.prepare('SELECT default_trim FROM media_assets WHERE id=?').get('shared-authorized')).toEqual({default_trim:null})
    app.sqlite.exec('DROP TRIGGER fail_scoped_edit')
    expect((await server.inject({method:'POST',url,headers:{...headers('admin'),'if-match':app.concurrency.generateETag(rid())},payload})).statusCode).toBe(200)
    const audit=(await server.inject({url:'/api/audit',headers:headers('admin')})).json().entries
    expect(audit.some((row:any)=>row.kind==='API_MUTATION' && row.payload.channelIds.includes('own') && row.payload.channelIds.includes('other'))).toBe(true)
    expect(app.history.state(rid()).canUndo).toBe(true)
    // Another operator authorized only for the primary grade cannot use the
    // administrator's shared history to restore a foreign asset/line.
    const before=app.sqlite.prepare('SELECT default_trim FROM media_assets WHERE id=?').get('shared-authorized')
    expect((await server.inject({method:'POST',url:`/api/rundowns/${rid()}/undo`,headers:{...headers(),'if-match':app.concurrency.generateETag(rid())},payload:{}})).statusCode).toBe(403)
    expect(app.sqlite.prepare('SELECT default_trim FROM media_assets WHERE id=?').get('shared-authorized')).toEqual(before)
    expect(app.history.state(rid()).canUndo).toBe(true)
    expect((await server.inject({method:'POST',url:`/api/rundowns/${rid()}/undo`,headers:{...headers('admin'),'if-match':app.concurrency.generateETag(rid())},payload:{}})).statusCode).toBe(200)
    expect(app.sqlite.prepare('SELECT default_trim FROM media_assets WHERE id=?').get('shared-authorized')).toEqual({default_trim:null})
    expect((await server.inject({method:'POST',url:`/api/rundowns/${rid()}/redo`,headers:{...headers(),'if-match':app.concurrency.generateETag(rid())},payload:{}})).statusCode).toBe(403)
    expect(app.history.state(rid()).canRedo).toBe(true)
  })
  it('escopo amplo funciona para conta restrita quando todos os usos são autorizados',async()=>{
    const now=new Date().toISOString()
    await app.db.insert(mediaAssets).values({id:'own-only',title:'Próprio',path:'C:/own.mp4',contentHash:'hash',kind:'VIDEO',durationFrames:2500,rateNum:25,rateDen:1,createdAt:now})
    app.sqlite.prepare('UPDATE rundown_items SET media_id=? WHERE id=?').run('own-only',iid())
    expect((await server.inject({method:'POST',url:`/api/items/${iid()}/trim`,headers:{...headers(),'if-match':app.concurrency.generateETag(rid())},payload:{trim:{in:25,out:250},scope:'ASSET_DEFAULT',scopeReviewToken:await scopeToken('ASSET_DEFAULT','one')}})).statusCode).toBe(200)
    expect((await server.inject({method:'POST',url:`/api/rundowns/${rid()}/undo`,headers:{...headers(),'if-match':app.concurrency.generateETag(rid())},payload:{}})).statusCode).toBe(200)
    expect(app.sqlite.prepare('SELECT default_trim FROM media_assets WHERE id=?').get('own-only')).toEqual({default_trim:null})
  })
  it('desfazer não altera um canal arquivado após a edição e conserva a ação pendente',async()=>{
    app.history.edit(app.db,rid(),'global',{itemIds:[iid(),iid('other')]},()=>app.sqlite.prepare('UPDATE rundown_items SET title=? WHERE id IN (?,?)').run('Mudou',iid(),iid('other')))
    app.sqlite.prepare('UPDATE channels SET archived_at=? WHERE id=?').run(new Date().toISOString(),'other')
    const res=await server.inject({method:'POST',url:`/api/rundowns/${rid()}/undo`,headers:{...headers('admin'),'if-match':app.concurrency.generateETag(rid())},payload:{}})
    expect(res.statusCode).toBe(409);expect(res.json().error).toContain('arquivada')
    expect(app.sqlite.prepare('SELECT title FROM rundown_items WHERE id=?').get(iid())).toEqual({title:'Mudou'})
    expect(app.history.state(rid()).canUndo).toBe(true)
  })
  it('filtra modelos por canal e permite usar global sem editá-lo',async()=>{
    expect((await server.inject({url:'/api/graphics',headers:headers()})).json().templates.map((row:any)=>row.id).sort()).toEqual(['tpl-archive','tpl-global','tpl-own'])
    const res=await server.inject({method:'POST',url:`/api/items/${iid()}/graphics`,headers:{...headers(),'if-match':app.concurrency.generateETag(rid())},payload:{templateId:'tpl-global',atSeconds:0}})
    expect(res.statusCode).toBe(200)
    for(const options of [
      {method:'PATCH' as const,url:'/api/graphics/tpl-global?channelId=own',payload:{channelId:'own',name:'hijack'}},
      {method:'DELETE' as const,url:'/api/graphics/tpl-global?channelId=own'},
      {method:'POST' as const,url:'/api/graphics?channelId=own',payload:{name:'share',svg:'<svg/>'}},
      {method:'PATCH' as const,url:'/api/graphics/tpl-own',payload:{channelId:null}},
    ])expect((await server.inject({...options,headers:headers()})).statusCode).toBe(403)
  })
  it('não permite mover/usar template de canal externo por canal forjado',async()=>{
    expect((await server.inject({method:'PATCH',url:'/api/graphics/tpl-other?channelId=own',headers:headers(),payload:{channelId:'own',name:'hijack'}})).statusCode).toBe(403)
    expect((await server.inject({method:'POST',url:`/api/items/${iid()}/graphics`,headers:{...headers('admin'),'if-match':app.concurrency.generateETag(rid())},payload:{templateId:'tpl-other',atSeconds:0}})).statusCode).toBe(400)
    expect((await server.inject({method:'POST',url:'/api/channels/own/graphic',headers:headers('admin'),payload:{templateId:'tpl-other'}})).statusCode).toBe(400)
  })
  it.each(['cue','guest','dest'])('bloqueia remoção estrangeira e deixa remover recurso próprio: %s',async kind=>{
    const path=kind==='cue'?'item-graphics':kind==='guest'?'guests':'destinations'
    expect((await server.inject({method:'DELETE',url:`/api/${path}/${kind}-other?channelId=own`,headers:headers()})).statusCode).toBe(403)
    expect((await server.inject({method:'DELETE',url:`/api/${path}/${kind}-own`,headers:{...headers(),'if-match':app.concurrency.generateETag(rid())}})).statusCode).toBe(200)
  })
  it('canal arquivado bloqueia mutações indiretas e legadas até para ADMIN',async()=>{
    const operations=[
      {method:'DELETE' as const,url:'/api/item-graphics/cue-archive'},
      {method:'DELETE' as const,url:'/api/guests/guest-archive'},
      {method:'DELETE' as const,url:'/api/destinations/dest-archive'},
      {method:'PATCH' as const,url:'/api/graphics/tpl-archive',payload:{name:'no'}},
      {method:'PUT' as const,url:`/api/v1/rundowns/${rid('archive')}/items/${iid('archive')}`,payload:{patch:{title:'no'}}},
      {method:'POST' as const,url:`/api/v1/rundowns/${rid('archive')}/autofill-gap`,payload:{}},
      {method:'POST' as const,url:'/api/blocks/block-archive/ungroup',payload:{}},
    ]
    for(const operation of operations)expect((await server.inject({...operation,headers:headers('admin')})).statusCode).toBe(409)
  })
  it('recusa bloco com vínculo em grades diferentes sem desagrupar nenhuma',async()=>{
    app.sqlite.prepare('UPDATE rundown_items SET block_id=? WHERE id=?').run('block-own',iid('other'))
    expect((await server.inject({method:'POST',url:'/api/blocks/block-own/ungroup',headers:headers()})).statusCode).toBe(403)
    expect((await server.inject({method:'POST',url:'/api/blocks/block-own/ungroup',headers:headers('admin')})).statusCode).toBe(409)
    expect(app.sqlite.prepare('SELECT COUNT(*) AS n FROM rundown_items WHERE block_id=?').get('block-own')).toEqual({n:2})
  })
})
