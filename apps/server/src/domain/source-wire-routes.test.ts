import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, runtimeFor, type App } from '../app.js'
import { registerRoutes } from '../routes.js'
import {reviewedPublish} from './test-operational-review.js'
import { channels, rundowns, rundownItems } from '../db/schema.js'
import { getLiveSource } from './srt.js'
import { sourceWire } from './source-wire.js'
import { sessionDigest } from './access.js'
import { EngineCommandRejected } from './engine.js'

vi.mock('../config.js', async original => ({ ...await original<Record<string, unknown>>(), ENGINE_BINARY: '', MEDIAMTX_BINARY: '', DEVICES_BINARY: '', AUTH_USER: '', AUTH_PASSWORD: '', DEFAULT_ROLE: 'ADMIN' }))
const raw = 'srt://127.0.0.1:9000?mode=caller&latency=120&passphrase=PRIVATE_SOURCE_SECRET'
let app: App, server: FastifyInstance
beforeEach(async () => {
  app = await createApp(':memory:'); const now = new Date().toISOString()
  for (const id of ['ch', 'other']) await app.db.insert(channels).values({ id, name: id, rateNum: 25, rateDen: 1, width: 320, height: 180, targetLufs: -23, ceilingDbtp: -1, limiterLookaheadMs: 5, createdAt: now })
  await app.db.insert(rundowns).values({ id: 'today', channelId: 'ch', name: 'today', date: '2026-10-01', plannedStart: 0, loop: false, createdAt: now, updatedAt: now })
  await app.db.insert(rundownItems).values({ id: 'live', rundownId: 'today', sortOrder: 0, title: 'Fonte', type: 'LIVE', sourceRef: raw, liveEndpoint: raw, durationOverride: 2500, minDuration: 0, anchor: { kind: 'FLOW' }, onOverrun: 'PUSH', autoNext: true, loop: false, locked: false })
  await (await runtimeFor(app, 'ch'))!.load('today')
  server = Fastify(); registerRoutes(app, server, () => {}); await server.ready()
})
afterEach(async () => { await server.close(); app.close(); vi.restoreAllMocks() })
describe('HTTP público preserva referências executáveis privadas', () => {
  it('CRUD oculta URI/config, nome preserva credenciais e duas fontes não se confundem', async () => {
    const headers=async()=>({'if-match':(await server.inject('/api/channels/ch/live-source-review')).headers.etag as string})
    const payload = { channelId: 'ch', name: 'EXTERNA ÇÃO', kind: 'SRT', targetUrl: raw, srtConfig: { mode: 'caller', host: '127.0.0.1', port: 9000, latencyMs: 120, passphrase: 'PRIVATE_SOURCE_SECRET' } }
    const created = await server.inject({ method: 'POST', url: '/api/sources/live', headers:await headers(),payload })
    expect(created.statusCode).toBe(201); expect(created.body).not.toContain('PRIVATE_SOURCE_SECRET')
    const source = created.json(); expect(source.credentialProtected).toBe(true); expect(source.controlRef).toBe(sourceWire().reference(raw))
    expect((await server.inject(`/api/sources/live/${source.id}`)).json().controlRef).toBe(source.controlRef)
    expect((await server.inject('/api/sources/live?channelId=ch')).body).not.toContain('PRIVATE_SOURCE_SECRET')
    expect((await server.inject({ method: 'PUT', url: `/api/sources/live/${source.id}`,headers:await headers(), payload: { name: 'NOVO APELIDO', targetUrl: source.controlRef } })).statusCode).toBe(200)
    expect(await getLiveSource(app.db, source.id, true)).toMatchObject({ name: 'NOVO APELIDO', targetUrl: raw, srtConfig: { passphrase: 'PRIVATE_SOURCE_SECRET' } })
    const second = (await server.inject({ method: 'POST', url: '/api/sources/live',headers:await headers(), payload: { ...payload, targetUrl: raw.replace('PRIVATE_SOURCE_SECRET', 'SECOND_SOURCE_SECRET') } })).json()
    expect(second.controlRef).not.toBe(source.controlRef)
  })
  it('CUE de referência abre URI real; TAKE do preview acha o evento e conserva segredo privado', async () => {
    const runtime = app.runtimes.get('ch')!, reference = sourceWire().reference(raw)
    const cue = await server.inject({ method: 'POST', url: '/api/channels/ch/transport', payload: { action: 'cue', sourceRef: reference, sourceTitle: 'EXTERNA' } })
    expect(cue.statusCode).toBe(200); expect(cue.body).not.toContain('PRIVATE_SOURCE_SECRET')
    expect(cue.json().live.transport.preview).toMatchObject({ kind: 'SOURCE', source: reference })
    expect(runtime.transport.state().preview).toMatchObject({ kind: 'SOURCE', source: raw })
    const take = await server.inject({ method: 'POST', url: '/api/channels/ch/transport', payload: { action: 'take' } })
    expect(take.statusCode).toBe(200); expect(take.json().live.transport.onAir.itemId).toBe('live'); expect(take.body).not.toContain('PRIVATE_SOURCE_SECRET')
    expect(runtime.executionView!.items[0]!.item.sourceRef).toBe(raw)
    const state = await server.inject('/api/state'); expect(state.body).not.toContain('PRIVATE_SOURCE_SECRET')
    const exported = await server.inject('/api/rundowns/today/export.csv'); expect(exported.statusCode).toBe(200); expect(exported.body).not.toContain('PRIVATE_SOURCE_SECRET'); expect(exported.body).toContain('REDACTED')
  })
  it('inserção/edição publica URI real; snapshots não gravam referência ou máscara na grade', async () => {
    const reference = sourceWire().reference(raw)
    const created = await server.inject({ method: 'POST', url: '/api/rundowns/today/items',headers:{'if-match':app.concurrency.generateETag('today')}, payload: { title: 'Nova entrada', type: 'LIVE', sourceRef: reference, liveEndpoint: reference, durationOverride: 250 } })
    expect(created.statusCode).toBe(200); expect(created.body).not.toContain('PRIVATE_SOURCE_SECRET')
    const rows = app.sqlite.prepare('SELECT id FROM rundown_items WHERE title=?').all('Nova entrada') as { id: string }[]
    expect(rows).toHaveLength(1)
    expect(app.runtimes.get('ch')!.view!.items.find(entry => entry.item.id === rows[0]!.id)?.item.sourceRef).toBe(raw)
    expect((await reviewedPublish(server,'today')).statusCode).toBe(201)
    expect(app.runtimes.get('ch')!.executionView!.items.find(entry => entry.item.id === rows[0]!.id)?.item.sourceRef).toBe(raw)
  })
  it('referência adulterada ou endereço mascarado não dispara CUE; canal/sessão ainda autorizam', async () => {
    const runtime = app.runtimes.get('ch')!, cue = vi.spyOn(runtime.transport, 'cue')
    for (const sourceRef of ['srt:protected:v1:invalid', 'srt://127.0.0.1:9000?passphrase=REDACTED']) expect((await server.inject({ method: 'POST', url: '/api/channels/ch/transport', payload: { action: 'cue', sourceRef } })).statusCode).toBe(400)
    expect(cue).not.toHaveBeenCalled()
    const now = new Date().toISOString(), token = 'restricted-session'
    app.sqlite.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run('restricted', 'restricted', 'not-a-login-hash', 'ADMIN', 1, now)
    app.sqlite.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(sessionDigest(token), 'restricted', '2099-01-01', now)
    app.sqlite.prepare('INSERT INTO user_access (user_id,channel_ids,station_ips,updated_at) VALUES (?,?,?,?)').run('restricted', JSON.stringify(['other']), null, now)
    const payload = { action: 'cue', sourceRef: sourceWire().reference(raw) }
    expect((await server.inject({ method: 'POST', url: '/api/channels/ch/transport', payload })).statusCode).toBe(401)
    expect((await server.inject({ method: 'POST', url: '/api/channels/ch/transport', payload, headers: { cookie: `rplayout_session=${token}` } })).statusCode).toBe(403)
    expect(cue).not.toHaveBeenCalled()
  })
  it('CUE recusado pelo engine responde 409 com a mensagem (A4), não 500',async()=>{
    const runtime=app.runtimes.get('ch')!
    vi.spyOn(runtime.transport,'cue').mockRejectedValueOnce(new EngineCommandRejected('este canal não tem barramento de preview'))
    const cue=await server.inject({method:'POST',url:'/api/channels/ch/transport',payload:{action:'cue',sourceRef:sourceWire().reference(raw)}})
    expect(cue.statusCode).toBe(409)
    expect(cue.json()).toMatchObject({error:'este canal não tem barramento de preview',refused:true,action:'cue'})
    vi.spyOn(runtime.transport,'cue').mockRejectedValueOnce(new Error('O arquivo do preview não está disponível. Atualize o acervo.'))
    expect((await server.inject({method:'POST',url:'/api/channels/ch/transport',payload:{action:'cue',sourceRef:sourceWire().reference(raw)}})).statusCode).toBe(422)
  })
})
