import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, runtimeFor, type App } from '../app.js'
import { registerRoutes } from '../routes.js'
import {reviewedPublish,reviewedRollback} from './test-operational-review.js'
import { channels, rundowns, rundownItems, users, sessions } from '../db/schema.js'
import { sessionDigest } from './access.js'
import { eq } from 'drizzle-orm'
import {channelConfigurationETag} from '@rplayout/protocol'
import {configurationRevision} from '../db/channel-configuration.js'
import { createHash } from 'node:crypto'

vi.mock('../config.js', async importOriginal => ({ ...await importOriginal<Record<string, unknown>>(), ENGINE_BINARY: '', MEDIAMTX_BINARY: '', DEVICES_BINARY: '', DEFAULT_ROLE: 'ADMIN' }))

let app: App, server: FastifyInstance
beforeEach(async () => {
  app = await createApp(':memory:')
  const now = new Date().toISOString()
  await app.db.insert(channels).values({ id: 'ch', name: 'Canal', rateNum: 25, rateDen: 1, width: 320, height: 180, targetLufs: -23, ceilingDbtp: -1, limiterLookaheadMs: 5, createdAt: now })
  for (const id of ['today', 'tomorrow']) {
    await app.db.insert(rundowns).values({ id, channelId: 'ch', name: id, date: id === 'today' ? '2026-09-30' : '2026-10-01', plannedStart: 0, loop: false, createdAt: now, updatedAt: now })
    await app.db.insert(rundownItems).values({ id: `live-${id}`, rundownId: id, sortOrder: 0, title: id, type: 'LIVE', sourceRef: 'ndi:CAM', durationOverride: 2500, minDuration: 0, anchor: { kind: 'FLOW' }, onOverrun: 'PUSH', autoNext: true, loop: false, locked: false })
  }
  const runtime = (await runtimeFor(app, 'ch'))!
  await runtime.load('today')
  await runtime.transport.take('today', 'live-today')
  server = Fastify()
  registerRoutes(app, server, () => {})
  await server.ready()
  await app.sources.list()
})
afterEach(async () => { await server.close(); app.close() })

describe('publicação não é troca implícita de grade', () => {
  it('editar grade não autoriza restaurar entradas/saídas de um projeto', async () => {
    const project = (await server.inject({method:'POST',url:'/api/channels/ch/projects',payload:{label:'Projeto QA'}})).json().project
    const now = new Date().toISOString(), token = 'QA_RESTORE_ONLY'
    await app.db.insert(users).values({id:'operator',username:'operator',passwordHash:'not-used',role:'OPERATOR',enabled:true,createdAt:now})
    await app.db.insert(sessions).values({token:sessionDigest(token),userId:'operator',expiresAt:new Date(Date.now()+60_000).toISOString(),createdAt:now})
    const previous = app.runtimes.get('ch')!
    const result = await server.inject({method:'POST',url:`/api/channels/ch/projects/${project.id}/restore`,payload:{},headers:{cookie:`rplayout_session=${token}`}})
    expect(result.statusCode).toBe(403)
    expect(result.json().error).toContain('Supervisor')
    expect(app.runtimes.get('ch')).toBe(previous)
  })
  it('restauração exige STOP e CUE limpo, preserva publicação e reconstrói o runtime', async () => {
    const previous = app.runtimes.get('ch')!
    await reviewedPublish(server,'today')
    const revision = previous.operationalRevision!
    const project = (await server.inject({method:'POST',url:'/api/channels/ch/projects',payload:{label:'Projeto QA'}})).json().project
    const url = `/api/channels/ch/projects/${project.id}/restore`
    expect((await server.inject({method:'POST',url,payload:{}})).statusCode).toBe(409)
    await previous.transport.stop(); await previous.transport.cue({kind:'ITEM',id:'live-today'})
    expect((await server.inject({method:'POST',url,payload:{}})).statusCode).toBe(409)
    await previous.transport.cue(null)
    const restored = await server.inject({method:'POST',url,payload:{}})
    expect(restored.statusCode).toBe(200)
    expect(restored.json()).toMatchObject({controlledInterruption:true,recoveryRequested:false})
    const current = app.runtimes.get('ch')!
    expect(current).not.toBe(previous)
    expect(current.operationalRevision?.id).toBe(revision.id)
    expect(current.transport.state().onAir).toBeNull()
  })
  it('geometria passa pela proteção de recuperação antes de alterar o banco', async () => {
    const previous = app.runtimes.get('ch')!
    const guard = vi.spyOn(previous, 'assertReconfigurationReady').mockImplementation(() => { throw new Error('Recuperação pendente') })
    const response = await server.inject({ method: 'PATCH', url: '/api/channels/ch', payload: { width: 640 },headers:{'if-match':channelConfigurationETag('ch',configurationRevision(app.db,'ch'))} })
    expect(response.statusCode).toBe(409)
    expect(app.db.select().from(channels).where(eq(channels.id, 'ch')).get()?.width).toBe(320)
    expect(app.runtimes.get('ch')).toBe(previous)
    guard.mockRestore()
  })
  it('disponibilidade de reconfiguração é publicada sem alterar hash canônico N+1',async()=>{
    const runtime=app.runtimes.get('ch')!
    expect(runtime.reconfigurationStatus()).toEqual({ready:true,reason:null})
    const response=(await server.inject({url:'/api/n1/state'})).json()
    expect(response.channels[0].reconfiguration).toEqual({ready:true,reason:null})
    const canonical=response.channels.map(({channelId,state,health}:any)=>({channelId,state,health}))
    expect(createHash('sha256').update(JSON.stringify(canonical)).digest('hex')).toBe(response.stateHash)
    runtime.close()
    expect(runtime.live().reconfiguration.ready).toBe(false)
    expect(()=>runtime.assertReconfigurationReady()).toThrow('encerrado')
  })
  it('geometria salva checkpoint antes de retirar runtime e recarrega sua grade', async () => {
    const previous = app.runtimes.get('ch')!, order: string[] = []
    const checkpoint = vi.spyOn(previous, 'checkpoint').mockImplementation(() => { order.push('checkpoint') })
    const close = previous.close.bind(previous)
    vi.spyOn(previous, 'close').mockImplementation(() => { order.push('close'); close() })
    const response = await server.inject({ method: 'PATCH', url: '/api/channels/ch', payload: { width: 640 },headers:{'if-match':channelConfigurationETag('ch',configurationRevision(app.db,'ch'))} })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ controlledInterruption: true, recoveryRequested: false, formatChanged: true })
    expect(order).toEqual(['checkpoint', 'close'])
    expect(app.runtimes.get('ch')?.executionView?.rundown.id).toBe('today')
    checkpoint.mockRestore()
  })
  it('mudança de cadência não reinterpreta durações em quadros da grade existente', async () => {
    const previous = app.runtimes.get('ch')!
    const response = await server.inject({ method: 'PATCH', url: '/api/channels/ch', payload: { rateNum: 50 },headers:{'if-match':channelConfigurationETag('ch',configurationRevision(app.db,'ch'))} })
    expect(response.statusCode).toBe(409)
    expect(response.json().error).toContain('quadros')
    expect(app.db.select().from(channels).where(eq(channels.id, 'ch')).get()?.rateNum).toBe(25)
    expect(app.runtimes.get('ch')).toBe(previous)
  })
  it('reinício explícito retira runtime antigo e informa interrupção controlada, sem fingir PGM simulado recuperado', async () => {
    const previous = app.runtimes.get('ch')!, close = vi.spyOn(previous, 'close')
    const response = await server.inject({ method: 'POST', url: '/api/channels/ch/restart', payload: {} })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ok:true,controlledInterruption:true})
    expect(close).toHaveBeenCalledTimes(1)
    const current = app.runtimes.get('ch')!
    expect(current).not.toBe(previous)
    expect(current.executionView?.rundown.id).toBe('today')
    expect(current.transport.state().onAir).toBeNull()
  })
  it('consulta/configuração de reserva não corta o PGM; simulação não confirma entrada real', async () => {
    const runtime=app.runtimes.get('ch')!
    await runtime.transport.cue({kind:'ITEM',id:'live-today'})
    await reviewedPublish(server,'today')
    const revision=runtime.operationalRevision!, before=runtime.transport.state()
    const result=await server.inject({url:'/api/v1/engineering/pgm-probe/contingency-loop?channelId=ch'})
    expect(result.statusCode).toBe(200);expect(result.json()).toMatchObject({nativeEngine:false,loopRevisionId:null,origin:null})
    expect(result.json().options).toEqual([expect.objectContaining({revisionId:revision.id,rundownId:'today'})])
    expect((await server.inject({method:'POST',url:'/api/v1/engineering/pgm-probe/contingency-loop',payload:{channelId:'ch',action:'CONFIGURE',revisionId:revision.id}})).statusCode).toBe(409)
    expect((await server.inject({method:'POST',url:'/api/v1/engineering/pgm-probe/contingency-loop',payload:{channelId:'ch',action:'CONFIGURE',revisionId:null}})).statusCode).toBe(200)
    const enter=await server.inject({method:'POST',url:'/api/v1/engineering/pgm-probe/contingency-loop',payload:{channelId:'ch',action:'ENTER'}})
    expect(enter.statusCode).toBe(409);expect(enter.json().alert.actionStatus).toBe('FAILED')
    expect((await server.inject({method:'POST',url:'/api/v1/engineering/pgm-probe/contingency-loop',payload:{channelId:'ch',action:'RETURN'}})).statusCode).toBe(409)
    expect(runtime.transport.state()).toMatchObject({preview:before.preview,onAir:{itemId:before.onAir?.itemId,startedAt:before.onAir?.startedAt}})
    expect(runtime.operationalRevision).toEqual(revision)
  })
  it('diagnóstico N+1 não expõe credenciais do CUE/engine e mantém hash do estado real',async()=>{
    const runtime=app.runtimes.get('ch')!
    const sourceRef='srt://host:9000?passphrase=N1_SOURCE_SECRET&latency=120'
    await runtime.transport.cue({kind:'SOURCE',source:sourceRef,title:'SRT — QA'})
    const health=runtime.transport.health()
    const work=vi.spyOn(runtime.transport,'health').mockReturnValue({...health,error:'Não conectou rtmp://host/live/N1_KEY_SECRET'})
    const originalState=runtime.transport.state()
    const frozenState=vi.spyOn(runtime.transport,'state').mockReturnValue(originalState)
    try{
      const real=[{channelId:'ch',state:runtime.transport.state(),health:runtime.transport.health()}]
      const result=await server.inject({url:'/api/n1/state'})
      expect(result.statusCode).toBe(200)
      expect(result.body).not.toContain('N1_SOURCE_SECRET');expect(result.body).not.toContain('N1_KEY_SECRET')
      expect(result.json().stateHash).toBe(createHash('sha256').update(JSON.stringify(real)).digest('hex'))
      expect(runtime.transport.state().preview).toMatchObject({kind:'SOURCE',source:sourceRef})
      expect((await server.inject({method:'POST',url:'/api/n1/compare',payload:{stateHash:result.json().stateHash,channels:result.json().channels}})).json().match).toBe(true)
    }finally{work.mockRestore();frozenState.mockRestore()}
  })
  it('copiar para outra data preserva zonas e live sem tocar PGM/CUE/revisão',async()=>{
    const runtime=app.runtimes.get('ch')!
    await runtime.transport.cue({kind:'ITEM',id:'live-today'})
    const zones=[{id:'z',label:'Jornal',from:0,to:2500,priority:5}]
    await server.inject({method:'PUT',url:'/api/rundowns/today/protected-zones',headers:{'if-match':app.concurrency.generateETag('today')},payload:{zones}})
    await reviewedPublish(server,'today')
    const before=runtime.transport.state(),revision=runtime.operationalRevision
    const result=await server.inject({method:'POST',url:'/api/channels/ch/rundowns',payload:{date:'2026-10-02',copyFromRundownId:'today'}})
    expect(result.statusCode).toBe(200)
    expect(result.json().rundown.protectedZones).toEqual(zones)
    expect(result.json().view.items[0].item.sourceRef).toBe('ndi:CAM')
    expect(runtime.executionView?.rundown.id).toBe('today');expect(runtime.operationalRevision).toEqual(revision)
    expect(runtime.transport.state()).toMatchObject({preview:before.preview,onAir:{itemId:before.onAir?.itemId,startedAt:before.onAir?.startedAt}})
    const count=(app.sqlite.prepare('SELECT count(*) n FROM rundowns').get() as {n:number}).n
    expect((await server.inject({method:'POST',url:'/api/channels/ch/rundowns',payload:{date:'2026-10-03',copyFromRundownId:'missing'}})).statusCode).toBe(404)
    expect(app.sqlite.prepare('SELECT count(*) n FROM rundowns').get()).toEqual({n:count})
  })
  it('zona editorial não muda política publicada ou PGM/CUE; simulação mostra diferença', async () => {
    const runtime=app.runtimes.get('ch')!
    await runtime.transport.cue({kind:'ITEM',id:'live-today'})
    await reviewedPublish(server,'today')
    const state=runtime.transport.state(),revision=runtime.operationalRevision
    const zones=[{id:'news',label:'Jornal — ação',from:0,to:2500,priority:5}]
    const response=await server.inject({method:'PUT',url:'/api/rundowns/today/protected-zones',headers:{'if-match':app.concurrency.generateETag('today')},payload:{zones}})
    expect(response.statusCode).toBe(200)
    expect(response.json().publicationRequired).toBe(true)
    expect(runtime.view?.rundown.protectedZones).toEqual(zones)
    expect(runtime.executionView?.rundown.protectedZones).toEqual([])
    expect(runtime.operationalRevision).toEqual(revision)
    expect(runtime.transport.state()).toMatchObject({preview:state.preview,onAir:{itemId:state.onAir?.itemId,startedAt:state.onAir?.startedAt}})
    expect((await server.inject({url:'/api/rundowns/today/operational-simulation'})).json().differences.timingPolicyChanged).toBe(true)
    expect(app.sqlite.prepare("SELECT count(*) n FROM operator_decisions WHERE kind='PROTECTED_ZONES_EDITED'").get()).toEqual({n:1})
    const stale=await server.inject({method:'PUT',url:'/api/rundowns/today/protected-zones',headers:{'if-match':app.concurrency.generateETag('today')},payload:{zones:[],expectedZones:[]}})
    expect(stale.statusCode).toBe(409)
    expect(runtime.view?.rundown.protectedZones).toEqual(zones)
    const publish=await reviewedPublish(server,'today')
    expect(publish.statusCode).toBe(201)
    expect(runtime.executionView?.rundown.protectedZones).toEqual(zones)
  })
  it('edita zona de outra data sem trocar execução e rejeita intervalo inválido', async () => {
    const runtime=app.runtimes.get('ch')!,before=runtime.transport.state()
    const zones=[{id:'night',label:'Virada',from:24*3600*25,to:25*3600*25,priority:4}]
    expect((await server.inject({method:'PUT',url:'/api/rundowns/tomorrow/protected-zones',headers:{'if-match':app.concurrency.generateETag('tomorrow')},payload:{zones}})).statusCode).toBe(200)
    expect(runtime.executionView?.rundown.id).toBe('today')
    expect(runtime.transport.state().onAir?.itemId).toBe(before.onAir?.itemId)
    for (const invalid of [[{...zones[0],to:0}],[{...zones[0],to:50*3600*25}],[zones[0],zones[0]]]) expect((await server.inject({method:'PUT',url:'/api/rundowns/tomorrow/protected-zones',headers:{'if-match':app.concurrency.generateETag('tomorrow')},payload:{zones:invalid}})).statusCode).toBe(400)
  })
  it('disparo manual devolve falha persistida e não a transforma em sucesso ou repetição',async()=>{
    const runtime=app.runtimes.get('ch')!
    await runtime.transport.stop()
    const added=await server.inject({method:'POST',headers:{'if-match':app.concurrency.generateETag('today')},url:'/api/items/live-today/secondary-events',payload:{name:'Manual',type:'GRAPHICS_OVERLAY',targetLayer:'LOWER_THIRD',triggerMode:'MANUAL',offsetFrames:0,templateId:'',payload:{title:'Teste'}}})
    expect(added.statusCode).toBe(200)
    expect((await reviewedPublish(server,'today')).statusCode).toBe(201)
    await runtime.transport.take('today','live-today')
    const work=vi.spyOn(runtime.graphics,'triggerLayer').mockImplementation(()=>{throw new Error('passphrase=secret-fixture')})
    const request={method:'POST' as const,url:`/api/channels/ch/secondary-events/${added.json().event.id}/fire`,payload:{}}
    for(let i=0;i<2;i++) {
      const result=await server.inject(request)
      expect(result.statusCode).toBe(409)
      expect(result.json()).toMatchObject({run:{state:'FAILED'},physicalExecutionConfirmed:false})
      expect(result.body).not.toContain('secret-fixture')
    }
    expect(work).toHaveBeenCalledTimes(1)
    work.mockRestore()
  })
  it('disparo manual confirmado localmente retorna o mesmo ledger; estado incerto exige conferência',async()=>{
    const runtime=app.runtimes.get('ch')!
    await runtime.transport.stop()
    const added=await server.inject({method:'POST',headers:{'if-match':app.concurrency.generateETag('today')},url:'/api/items/live-today/secondary-events',payload:{name:'Manual',type:'GRAPHICS_OVERLAY',targetLayer:'LOWER_THIRD',triggerMode:'MANUAL',offsetFrames:0,templateId:'',payload:{title:'Teste'}}})
    expect((await reviewedPublish(server,'today')).statusCode).toBe(201)
    await runtime.transport.take('today','live-today')
    const work=vi.spyOn(runtime.graphics,'triggerLayer'),request={method:'POST' as const,url:`/api/channels/ch/secondary-events/${added.json().event.id}/fire`,payload:{}}
    const first=await server.inject(request),second=await server.inject(request)
    expect(first.statusCode).toBe(200);expect(second.statusCode).toBe(200)
    expect(first.json()).toMatchObject({status:'EXECUTED',physicalExecutionConfirmed:false})
    expect(second.json().run.id).toBe(first.json().run.id)
    expect(work).toHaveBeenCalledTimes(1)
    app.sqlite.prepare("UPDATE secondary_event_runs SET state='FIRING' WHERE id=?").run(first.json().run.id)
    const uncertain=await server.inject(request)
    expect(uncertain.statusCode).toBe(409);expect(uncertain.json().run.state).toBe('FIRING')
    expect(work).toHaveBeenCalledTimes(1)
    work.mockRestore()
  })
  it('recusa restauração de projeto durante PGM, sem mudar banco, CUE ou item no ar',async()=>{
    const runtime=app.runtimes.get('ch')!,before=runtime.transport.state()
    const saved=await server.inject({method:'POST',url:'/api/channels/ch/projects',payload:{label:'Antes'}})
    expect(saved.statusCode).toBe(200)
    await app.db.update(rundownItems).set({title:'Preservar edição'}).where(eq(rundownItems.id,'live-today'))
    const restore=await server.inject({method:'POST',url:`/api/channels/ch/projects/${saved.json().project.id}/restore`,payload:{}})
    expect(restore.statusCode).toBe(409)
    expect(runtime.transport.state().onAir?.itemId).toBe(before.onAir?.itemId)
    expect(app.sqlite.prepare("SELECT title FROM rundown_items WHERE id='live-today'").get()).toEqual({title:'Preservar edição'})
  })
  it('programa evento de outra data sem trocar PGM; exige publicação para executar e restringe remoção ao item',async()=>{
    const runtime=app.runtimes.get('ch')!,before=runtime.transport.state()
    const add=await server.inject({method:'POST',headers:{'if-match':app.concurrency.generateETag('tomorrow')},url:'/api/items/live-tomorrow/secondary-events',payload:{name:'Crédito',targetLayer:'LOWER_THIRD',triggerMode:'OFFSET_BEFORE_END',offsetFrames:125,durationFrames:200,templateId:'',payload:{title:'QA'}}})
    expect(add.statusCode).toBe(200)
    const event=add.json().event
    expect(add.json().requiresPublication).toBe(true)
    expect((await server.inject({url:'/api/items/live-tomorrow/secondary-events'})).json()).toMatchObject({events:[{id:event.id}],rate:{num:25,den:1}})
    expect(runtime.executionView?.rundown.id).toBe('today')
    expect(runtime.transport.state().onAir?.itemId).toBe(before.onAir?.itemId)
    expect((await server.inject({method:'POST',url:`/api/channels/ch/secondary-events/${event.id}/fire`,payload:{}})).statusCode).toBe(409)
    expect((await server.inject({method:'DELETE',headers:{'if-match':app.concurrency.generateETag('today')},url:`/api/items/live-today/secondary-events/${event.id}`})).statusCode).toBe(404)
    expect((await server.inject({method:'DELETE',headers:{'if-match':app.concurrency.generateETag('tomorrow')},url:`/api/items/live-tomorrow/secondary-events/${event.id}`})).statusCode).toBe(200)
    expect(runtime.transport.state().onAir?.itemId).toBe(before.onAir?.itemId)
  })
  it('edita, insere, remove, desfaz e programa grafismos de outra data sem alterar PGM ou CUE', async () => {
    const runtime = app.runtimes.get('ch')!
    await runtime.transport.cue({ kind: 'ITEM', id: 'live-today' })
    const before = runtime.transport.state()
    const operations = [
      { method: 'PATCH' as const, url: '/api/items/live-tomorrow', payload: { title: 'Amanhã editado' } },
      { method: 'POST' as const, url: '/api/rundowns/tomorrow/items', payload: { type: 'LIVE', title: 'Entrada extra', sourceRef: 'omt:STUDIO', durationOverride: 250 } },
      { method: 'POST' as const, url: '/api/items/live-tomorrow/move', payload: { toIndex: 1 } },
      { method: 'GET' as const, url: '/api/items/live-tomorrow/graphics' },
      { method: 'POST' as const, url: '/api/rundowns/tomorrow/undo' },
      { method: 'POST' as const, url: '/api/rundowns/tomorrow/items/bulk-delete', payload: { ids: ['live-today'] } },
      { method: 'DELETE' as const, url: '/api/items/live-tomorrow' },
    ]
    for (const operation of operations) {
      const response = await server.inject({...operation,headers:{'if-match':app.concurrency.generateETag('tomorrow')}})
      expect(response.statusCode, `${operation.method} ${operation.url}: ${response.body}`).toBe(operation.url.endsWith('bulk-delete') ? 400 : 200)
      expect(runtime.view?.rundown.id).toBe('today')
      expect(runtime.executionView?.rundown.id).toBe('today')
      const after = runtime.transport.state()
      expect({ ...after, onAir: after.onAir && { ...after.onAir, elapsed: 0 } }).toEqual({ ...before, onAir: before.onAir && { ...before.onAir, elapsed: 0 } })
    }
    expect(app.sqlite.prepare("SELECT title FROM rundown_items WHERE id='live-today'").get()).toEqual({ title: 'today' })
  })
  it('consultar, exportar e simular compensação de outra data não altera execução nem CUE', async () => {
    const runtime = app.runtimes.get('ch')!
    const before = runtime.transport.state()
    for (const url of ['/api/rundowns/tomorrow', '/api/rundowns/tomorrow/export.csv', '/api/rundowns/tomorrow/compensation-report', '/api/v1/schedule/compensation-report?rundownId=tomorrow']) {
      const response = await server.inject({ method: 'GET', url })
      expect(response.statusCode).toBe(200)
      expect(runtime.executionView?.rundown.id).toBe('today')
      const after = runtime.transport.state()
      expect({ ...after, onAir: after.onAir && { ...after.onAir, elapsed: 0 } }).toEqual({ ...before, onAir: before.onAir && { ...before.onAir, elapsed: 0 } })
      expect(after.onAir!.elapsed).toBeGreaterThanOrEqual(before.onAir!.elapsed)
    }
  })
  it('simula e publica outra data sem substituir PGM nem a execução carregada', async () => {
    const runtime = app.runtimes.get('ch')!
    const simulation = await server.inject({ method: 'GET', url: '/api/rundowns/tomorrow/operational-simulation' })
    expect(simulation.statusCode).toBe(200)
    expect(simulation.json().simulated.rundown.id).toBe('tomorrow')
    const published = await reviewedPublish(server,'tomorrow')
    expect(published.statusCode).toBe(201)
    expect(runtime.executionView?.rundown.id).toBe('today')
    expect(runtime.transport.state().onAir?.itemId).toBe('live-today')
    const revisions = await server.inject({ method: 'GET', url: '/api/rundowns/tomorrow/operational-playlists' })
    expect(revisions.json().revisions).toHaveLength(1)
    const rollback = await reviewedRollback(server,'tomorrow',revisions.json().revisions[0].id)
    expect(rollback.statusCode).toBe(200)
    expect(rollback.json().revision).toBe(2)
    expect(runtime.executionView?.rundown.id).toBe('today')
    expect(runtime.transport.state().onAir?.itemId).toBe('live-today')
  })
  it('recusa carregar outra grade enquanto PGM está ativo; permite depois de parar e limpar CUE', async () => {
    const request = { method: 'POST' as const, url: '/api/channels/ch/load-rundown', payload: { rundownId: 'tomorrow' } }
    expect((await server.inject(request)).statusCode).toBe(409)
    expect(app.runtimes.get('ch')!.executionView?.rundown.id).toBe('today')
    await app.runtimes.get('ch')!.transport.stop()
    await app.runtimes.get('ch')!.transport.cue(null)
    expect((await server.inject(request)).statusCode).toBe(200)
    expect(app.runtimes.get('ch')!.executionView?.rundown.id).toBe('tomorrow')
  })
  it('não transfere CUE da grade anterior; operador limpa o preview antes de ativar outra', async () => {
    const runtime = app.runtimes.get('ch')!
    await runtime.transport.stop(); await runtime.transport.cue({ kind: 'ITEM', id: 'live-today' })
    const request = { method: 'POST' as const, url: '/api/channels/ch/load-rundown', payload: { rundownId: 'tomorrow' } }
    const rejected = await server.inject(request)
    expect(rejected.statusCode).toBe(409); expect(rejected.json().error).toContain('Limpe o CUE')
    expect(runtime.executionView?.rundown.id).toBe('today')
    expect(runtime.transport.state().preview).toEqual({ kind: 'ITEM', id: 'live-today' })
    expect((await server.inject({ method: 'POST', url: '/api/channels/ch/transport', payload: { action: 'cue', itemId: null } })).statusCode).toBe(200)
    expect((await server.inject(request)).statusCode).toBe(200)
    expect(runtime.executionView?.rundown.id).toBe('tomorrow')
    expect(runtime.transport.state().preview).toBeNull()
  })
  it('primeira publicação protege fonte do item no ar, mesmo sem revisão anterior', async () => {
    await app.db.update(rundownItems).set({ sourceRef: 'omt:ALTERADA' }).where(eq(rundownItems.id, 'live-today'))
    const result = await reviewedPublish(server,'today')
    expect(result.statusCode).toBe(409)
    expect(result.json().error).toContain('fonte')
    expect(app.runtimes.get('ch')!.executionView?.items[0]?.item.sourceRef).toBe('ndi:CAM')
  })
  it('cache temporal usa somente a playlist publicada carregada e live não prova autonomia', async () => {
    const runtime = app.runtimes.get('ch')!
    const state = runtime.transport.state()
    const empty = await server.inject({ url: '/api/v1/continuity/cache/status?channelId=ch' })
    expect(empty.statusCode).toBe(200)
    expect(empty.json()).toMatchObject({ coverageBasis: 'ORDERED_PLAYLIST', revisionId: null, offlineAutonomyHours: 0 })
    const published = await reviewedPublish(server,'today')
    expect(published.statusCode).toBe(201)
    const result = await server.inject({ url: '/api/v1/continuity/cache/status?channelId=ch' })
    expect(result.json()).toMatchObject({ coverageBasis: 'ORDERED_PLAYLIST', revisionId: runtime.operationalRevision!.id, offlineAutonomyHours: 0, coverage48hPercent: 0 })
    expect(runtime.executionView?.rundown.id).toBe('today')
    expect(runtime.transport.state().onAir?.itemId).toBe(state.onAir?.itemId)
    expect((await server.inject({ url: '/api/v1/cache/status?channelId=unknown' })).statusCode).toBe(404)
  })
})
