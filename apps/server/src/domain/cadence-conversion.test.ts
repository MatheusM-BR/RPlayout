import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {eq} from 'drizzle-orm'
import Fastify,{type FastifyInstance} from 'fastify'
import {createApp,runtimeFor,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {channels,rundowns,rundownItems,mediaAssets,graphicTemplates,secondaryEvents,operationalPlaylistRevisions,channelCadenceConversions} from '../db/schema.js'
import {getChannel} from '../db/repo.js'
import {previewCadenceConversion,applyCadenceConversion} from './cadence-conversion.js'
import {publishOperationalPlaylist,rollbackOperationalPlaylist} from './operational-playlist.js'
import {History} from './history.js'
import {SECRET_PREFIX} from './secret-vault.js'
import {Checkpoints} from './checkpoints.js'
import {backupDatabase} from './backup.js'
import {openDatabase} from '../db/client.js'
import {mkdtemp} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {sessionDigest} from './access.js'
import {channelConfigurationETag} from '@rplayout/protocol'
import {configurationRevision} from '../db/channel-configuration.js'
import {reviewedPublish} from './test-operational-review.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',DEFAULT_ROLE:'ADMIN'}))
let app:App,server:FastifyInstance
const configurationHeaders=()=>({'if-match':channelConfigurationETag('a',configurationRevision(app.db,'a'))})
const now=new Date().toISOString(),rate={num:50,den:1}
beforeEach(async()=>{
  app=await createApp(':memory:')
  for(const id of ['a','b']){
    app.db.insert(channels).values({id,name:id,rateNum:25,rateDen:1,width:320,height:180,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:now}).run()
    app.db.insert(rundowns).values({id:`r-${id}`,channelId:id,name:id,date:'2026-10-01',plannedStart:25,loop:false,protectedZones:[{id:`zone-${id}`,label:'Protegida',from:100,to:200,priority:3}],createdAt:now,updatedAt:now}).run()
  }
  app.db.insert(mediaAssets).values({id:'asset',path:'C:/Vídeo ÇÃÓ.mp4',title:'VT',contentHash:'a'.repeat(64),kind:'VIDEO',durationFrames:1000,rateNum:25,rateDen:1,defaultTrim:{in:25,out:750},createdAt:now}).run()
  for(const id of ['a','b'])app.db.insert(rundownItems).values({id:`i-${id}`,rundownId:`r-${id}`,mediaId:'asset',sortOrder:0,title:id,type:'VT',minDuration:25,anchor:{kind:'SOFT',at:100,tolerance:25,priority:3},onOverrun:'PUSH',locked:false,autoNext:true,loop:false,durationOverride:500,elastic:{min:250,max:750}}).run()
  app.db.insert(graphicTemplates).values({id:'cg',name:'Arte',svg:'<svg/>',fields:[],fadeMs:0,createdAt:now}).run()
  app.db.insert(secondaryEvents).values({id:'event',channelId:'a',itemId:'i-a',definition:{id:'event',rundownItemId:'i-a',type:'GRAPHICS_OVERLAY',targetLayer:'LOWER_THIRD',triggerMode:'OFFSET_FROM_START',offsetFrames:75,durationFrames:100,templateId:'cg',enabled:true,payload:{}},createdAt:now,updatedAt:now}).run()
  server=Fastify();registerRoutes(app,server,()=>{});await server.ready()
})
afterEach(async()=>{await server.close();app.close()})
it('conversão de canal resolve padrão com cadência própria antes de converter e não muda o acervo',()=>{
  app.db.update(mediaAssets).set({defaultTrim:{in:50,out:1500},defaultTrimRateNum:50,defaultTrimRateDen:1}).run()
  const before=app.db.select().from(mediaAssets).get()
  const preview=previewCadenceConversion(app.db,'a',{num:30000,den:1001})
  applyCadenceConversion(app.db,'a',{num:30000,den:1001},preview.fingerprint,'QA')
  expect(app.db.select().from(rundownItems).where(eq(rundownItems.id,'i-a')).get()!.trim).toEqual({in:30,out:899})
  expect(app.db.select().from(mediaAssets).get()).toEqual(before)
})
it('converte atomicamente grade e eventos, sem mudar acervo/outro canal/publicação antiga',async()=>{
  const channel=(await getChannel(app.db,'a'))!,published=await publishOperationalPlaylist(app.db,channel,'r-a','QA')
  const before=app.db.select().from(operationalPlaylistRevisions).get()!.payload
  const asset=app.db.select().from(mediaAssets).get(),other=app.db.select().from(rundownItems).where(eq(rundownItems.id,'i-b')).get()
  const preview=previewCadenceConversion(app.db,'a',rate)
  expect(preview).toMatchObject({rundowns:1,items:1,events:1,inheritedTrims:1,activeRevisions:1,roundedValues:0})
  applyCadenceConversion(app.db,'a',rate,preview.fingerprint,'QA')
  expect(app.db.select().from(rundownItems).where(eq(rundownItems.id,'i-a')).get()).toMatchObject({trim:{in:50,out:1500},minDuration:50,durationOverride:1000,anchor:{kind:'SOFT',at:200,tolerance:50},elastic:{min:500,max:1500}})
  expect(app.db.select().from(rundowns).where(eq(rundowns.id,'r-a')).get()).toMatchObject({plannedStart:50,publicationRequired:true,protectedZones:[{from:200,to:400}]})
  expect(app.db.select().from(secondaryEvents).get()!.definition).toMatchObject({offsetFrames:150,durationFrames:200})
  expect(app.db.select().from(mediaAssets).get()).toEqual(asset)
  expect(app.db.select().from(rundownItems).where(eq(rundownItems.id,'i-b')).get()).toEqual(other)
  expect(app.db.select().from(operationalPlaylistRevisions).get()).toMatchObject({active:false,payload:before})
  await expect(rollbackOperationalPlaylist(app.db,'r-a',published.id,'QA')).rejects.toThrow('outra cadência')
  const runtime=(await runtimeFor(app,'a'))!;await runtime.load('r-a');expect(runtime.executionView).toBeNull()
  await publishOperationalPlaylist(app.db,(await getChannel(app.db,'a'))!,'r-a','QA');await runtime.refresh()
  expect(runtime.executionView?.rundown.publicationRequired).toBe(false)
  expect(app.db.select().from(channelCadenceConversions).get()!.snapshot).toHaveProperty('items')
})
it('recusa simulação superada, sem qualquer conversão parcial',()=>{
  const preview=previewCadenceConversion(app.db,'a',rate)
  app.db.update(rundownItems).set({durationOverride:600}).where(eq(rundownItems.id,'i-a')).run()
  expect(()=>applyCadenceConversion(app.db,'a',rate,preview.fingerprint,'QA')).toThrow('mudou desde')
  expect(app.db.select().from(channels).where(eq(channels.id,'a')).get()!.rateNum).toBe(25)
  expect(app.db.select().from(channelCadenceConversions).all()).toHaveLength(0)
})
it('ABA editorial/configuração não valida uma simulação antiga; formato também é selado',()=>{
  let preview=previewCadenceConversion(app.db,'a',rate,{width:640,name:'Novo'})
  expect(previewCadenceConversion(app.db,'a',rate,{name:'Novo',width:640}).fingerprint).toBe(preview.fingerprint)
  expect(()=>applyCadenceConversion(app.db,'a',rate,preview.fingerprint,'QA',{width:800,name:'Novo'})).toThrow('mudou desde')
  app.db.update(channels).set({name:'Mudou'}).where(eq(channels.id,'a')).run()
  app.db.update(channels).set({name:'a'}).where(eq(channels.id,'a')).run()
  expect(()=>applyCadenceConversion(app.db,'a',rate,preview.fingerprint,'QA',{width:640,name:'Novo'})).toThrow('mudou desde')
  preview=previewCadenceConversion(app.db,'a',rate)
  app.db.update(rundownItems).set({title:'Mudou'}).where(eq(rundownItems.id,'i-a')).run()
  app.db.update(rundownItems).set({title:'a'}).where(eq(rundownItems.id,'i-a')).run()
  expect(()=>applyCadenceConversion(app.db,'a',rate,preview.fingerprint,'QA')).toThrow('mudou desde')
  expect(app.db.select().from(channelCadenceConversions).all()).toHaveLength(0)
})
it('rollback de transação após falha não deixa canal e grade em taxas diferentes',()=>{
  const preview=previewCadenceConversion(app.db,'a',rate)
  app.sqlite.exec("CREATE TRIGGER fail_conversion BEFORE UPDATE ON rundown_items BEGIN SELECT RAISE(ABORT,'QA rollback'); END")
  expect(()=>applyCadenceConversion(app.db,'a',rate,preview.fingerprint,'QA')).toThrow('QA rollback')
  expect(app.db.select().from(channels).where(eq(channels.id,'a')).get()!.rateNum).toBe(25)
  expect(app.db.select().from(rundowns).where(eq(rundowns.id,'r-a')).get()!.publicationRequired).toBe(false)
  expect(app.db.select().from(channelCadenceConversions).all()).toHaveLength(0)
})
it('nega conversão com retorno de VT pendente',()=>{
  app.sqlite.prepare("INSERT INTO interrupted_items(id,channel_id,rundown_id,item_id,title,frames,specification,state,created_at) VALUES('pending','a','r-a','i-a','VT',10,'{}','PENDING',?)").run(now)
  const preview=previewCadenceConversion(app.db,'a',rate)
  expect(preview.pendingInterruptions).toBe(1)
  expect(()=>applyCadenceConversion(app.db,'a',rate,preview.fingerprint,'QA')).toThrow('VT interrompido')
})
it('não publica snapshot com cadência obsoleta após uma conversão concorrente',async()=>{
  const channel=(await getChannel(app.db,'a'))!,publishing=publishOperationalPlaylist(app.db,channel,'r-a','QA')
  const preview=previewCadenceConversion(app.db,'a',rate);applyCadenceConversion(app.db,'a',rate,preview.fingerprint,'QA')
  await expect(publishing).rejects.toThrow('outra cadência')
  expect(app.db.select().from(operationalPlaylistRevisions).all()).toHaveLength(0)
  expect(app.db.select().from(rundowns).where(eq(rundowns.id,'r-a')).get()!.publicationRequired).toBe(true)
})
it('exige STOP/CUE limpo; após converter bloqueia item CUE/TAKE até publicar',async()=>{
  const runtime=(await runtimeFor(app,'a'))!;await runtime.load('r-a');await runtime.transport.cue({kind:'ITEM',id:'i-a'})
  const headers=configurationHeaders()
  const report=(await server.inject({method:'POST',url:'/api/channels/a/cadence-preview',payload:{rateNum:50,rateDen:1},headers})).json().report
  const oldVersion=app.concurrency.getRundownVersion('r-a')
  const payload={rateNum:50,rateDen:1,fingerprint:report.fingerprint,confirm:true},url='/api/channels/a/cadence-convert'
  expect((await server.inject({method:'POST',url,payload,headers})).statusCode).toBe(409)
  await runtime.transport.cue(null)
  const result=await server.inject({method:'POST',url,payload,headers});expect(result.statusCode,result.body).toBe(200)
  expect(result.json()).toMatchObject({applied:true,automaticTake:false,requiresPublication:true,engineError:null})
  const current=app.runtimes.get('a')!;expect(current.transport.state().onAir).toBeNull();expect(current.executionView).toBeNull()
  const staleEdit=await server.inject({method:'PUT',url:'/api/v1/rundowns/r-a/items/i-a',payload:{expectedRundownVersion:oldVersion,patch:{durationOverride:500}}})
  expect(staleEdit.statusCode).toBe(409)
  expect(app.db.select().from(rundownItems).where(eq(rundownItems.id,'i-a')).get()!.durationOverride).toBe(1000)
  for(const action of ['cue','take','park'])expect((await server.inject({method:'POST',url:'/api/channels/a/transport',payload:{action,itemId:'i-a'}})).statusCode).toBe(409)
  expect((await reviewedPublish(server,'r-a')).statusCode).toBe(201)
  expect(current.executionView).not.toBeNull()
})
it('invalida captura antiga de desfazer após conversão',async()=>{
  const history=new History(),capture=history.prepareCapture(app.db,'r-a','antiga',{wholeRundown:true})
  capture.seal()
  history.forget('r-a');capture()
  expect(history.state('r-a').canUndo).toBe(false)
})
it('preserva estado parado e snapshot protegido em backup restaurado',async()=>{
  new Checkpoints(app.sqlite).write({version:1,channelId:'a',rundownId:'r-a',revisionId:null,itemId:'i-a',playing:true,realEngine:true,elapsed:42,rate:{num:25,den:1}})
  app.db.update(rundownItems).set({sourceRef:'srt://host:9000?passphrase=CADENCE-SECRET'}).where(eq(rundownItems.id,'i-a')).run()
  const preview=previewCadenceConversion(app.db,'a',rate);applyCadenceConversion(app.db,'a',rate,preview.fingerprint,'QA')
  const raw=app.sqlite.prepare('SELECT snapshot FROM channel_cadence_conversions').get() as {snapshot:string}
  expect(raw.snapshot.startsWith(SECRET_PREFIX)).toBe(true);expect(raw.snapshot).not.toContain('CADENCE-SECRET')
  expect(new Checkpoints(app.sqlite).read('a')).toMatchObject({playing:false,itemId:null,elapsed:0,rate})
  const directory=await mkdtemp(join(tmpdir(),'RPlayout-cadence-backup-')),backup=await backupDatabase(app.sqlite,directory)
  expect(backup.validation).toMatchObject({integrity:'ok',foreignKeys:'ok',protectedSecrets:'verified'})
  const restored=openDatabase(backup.file)
  try{
    expect(restored.db.select().from(channelCadenceConversions).get()!.snapshot).toHaveProperty('items')
    expect(restored.db.select().from(rundowns).where(eq(rundowns.id,'r-a')).get()!.publicationRequired).toBe(true)
    expect(new Checkpoints(restored.sqlite).read('a')).toMatchObject({playing:false,itemId:null,elapsed:0})
  }finally{restored.sqlite.close()}
})
it('revisão histórica sem FPS não volta ao ar após conversão',async()=>{
  const published=await publishOperationalPlaylist(app.db,(await getChannel(app.db,'a'))!,'r-a','QA')
  const {rate:ignored,...payload}=published.payload as Record<string,unknown>
  app.db.update(operationalPlaylistRevisions).set({payload}).where(eq(operationalPlaylistRevisions.id,published.id)).run()
  const preview=previewCadenceConversion(app.db,'a',rate);applyCadenceConversion(app.db,'a',rate,preview.fingerprint,'QA')
  await expect(rollbackOperationalPlaylist(app.db,'r-a',published.id,'QA')).rejects.toThrow('sem cadência registrada')
  expect(app.db.select().from(operationalPlaylistRevisions).get()!.payload).toEqual(payload)
})
it('recusa cortes/janelas/eventos que colapsariam na taxa menor',()=>{
  app.db.update(rundownItems).set({trim:{in:2,out:3}}).where(eq(rundownItems.id,'i-a')).run()
  expect(()=>previewCadenceConversion(app.db,'a',{num:1,den:1})).toThrow('Corte')
  app.db.update(rundownItems).set({trim:null,anchor:{kind:'WINDOW',from:2,to:3,priority:3}}).where(eq(rundownItems.id,'i-a')).run()
  expect(()=>previewCadenceConversion(app.db,'a',{num:1,den:1})).toThrow('Janela')
  app.db.update(rundownItems).set({anchor:{kind:'FLOW'}}).where(eq(rundownItems.id,'i-a')).run()
  app.db.update(secondaryEvents).set({definition:{id:'event',rundownItemId:'i-a',type:'GRAPHICS_OVERLAY',targetLayer:'LOWER_THIRD',triggerMode:'OFFSET_FROM_START',offsetFrames:1,durationFrames:1,templateId:'cg',enabled:true,payload:{}}}).run()
  expect(()=>previewCadenceConversion(app.db,'a',{num:1,den:1})).toThrow('Duração de evento')
})
it('nega conversão com PGM ativo e não modifica nem para o transporte',async()=>{
  const runtime=(await runtimeFor(app,'a'))!;await runtime.load('r-a');await runtime.transport.take('r-a','i-a')
  const preview=previewCadenceConversion(app.db,'a',rate),before=runtime.transport.state().onAir
  const response=await server.inject({method:'POST',url:'/api/channels/a/cadence-convert',payload:{rateNum:50,rateDen:1,fingerprint:preview.fingerprint,confirm:true}})
  expect(response.statusCode).toBe(409);expect(runtime.transport.state().onAir?.itemId).toBe(before!.itemId)
  expect(app.db.select().from(channelCadenceConversions).all()).toHaveLength(0)
})
it('Supervisor restrito não acessa conversão de outro canal',async()=>{
  const token='CADENCE_QA_SESSION'
  app.sqlite.prepare('INSERT INTO users(id,username,password_hash,role,enabled,created_at) VALUES(?,?,?,?,1,?)').run('limited','limited','unused','SUPERVISOR',now)
  app.sqlite.prepare('INSERT INTO sessions(token,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(sessionDigest(token),'limited',new Date(Date.now()+60_000).toISOString(),now)
  app.sqlite.prepare('INSERT INTO user_access(user_id,channel_ids,station_ips,updated_at) VALUES(?,?,NULL,?)').run('limited',JSON.stringify(['b']),now)
  const response=await server.inject({method:'POST',url:'/api/channels/a/cadence-preview',payload:{rateNum:50,rateDen:1},headers:{cookie:`rplayout_session=${token}`}})
  expect(response.statusCode).toBe(403)
})
it('uma nova grade sem publicação não contorna o bloqueio no canal convertido',async()=>{
  const preview=previewCadenceConversion(app.db,'a',rate);applyCadenceConversion(app.db,'a',rate,preview.fingerprint,'QA')
  app.db.insert(rundowns).values({id:'new',channelId:'a',name:'Nova',date:'2026-10-02',plannedStart:0,loop:false,createdAt:now,updatedAt:now}).run()
  const runtime=(await runtimeFor(app,'a'))!;await runtime.load('new')
  expect(runtime.view?.rundown.publicationRequired).toBe(true);expect(runtime.executionView).toBeNull()
})
