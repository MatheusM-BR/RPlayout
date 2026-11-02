import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, runtimeFor, type App } from '../app.js'
import { registerRoutes } from '../routes.js'
import {reviewedPublish} from './test-operational-review.js'
import { channels, rundowns, rundownItems } from '../db/schema.js'
import { globalStudioAutomationGateway } from './external-control.js'
import { sessionDigest } from './access.js'
import { equipmentIdentity } from './device-automation.js'
import { activeOperationalPlaylist, readOperationalPayload } from './operational-playlist.js'

vi.mock('../config.js', async original => ({ ...await original<Record<string, unknown>>(), ENGINE_BINARY: '', MEDIAMTX_BINARY: '', DEVICES_BINARY: '', AUTH_USER: '', AUTH_PASSWORD: '', DEFAULT_ROLE: 'ADMIN' }))
let app: App, server: FastifyInstance
const device = { id: 'router', kind: 'VIDEOHUB_ROUTER', host: '127.0.0.1', port: 9990, enabled: true }
const payload = { name: 'Consulta da matriz', type: 'DEVICE_AUTOMATION', targetLayer: 'LOWER_THIRD', triggerMode: 'MANUAL', offsetFrames: 0, deviceConfig: { deviceId: 'router', targetDevice: 'VIDEOHUB_ROUTER', action: 'PING', params: {} } }
beforeEach(async () => {
  app = await createApp(':memory:')
  const now = new Date().toISOString()
  app.db.insert(channels).values({ id: 'ch', name: 'Canal', rateNum: 25, rateDen: 1, width: 320, height: 180, targetLufs: -23, ceilingDbtp: -1, limiterLookaheadMs: 5, createdAt: now }).run()
  app.db.insert(rundowns).values({ id: 'day', channelId: 'ch', name: 'Grade', date: '2026-10-01', plannedStart: 0, loop: false, createdAt: now, updatedAt: now }).run()
  app.db.insert(rundownItems).values({ id: 'live', rundownId: 'day', sortOrder: 0, title: 'Estúdio', type: 'LIVE', sourceRef: 'ndi:ESTÚDIO', durationOverride: 2500, minDuration: 0, anchor: { kind: 'FLOW' }, onOverrun: 'PUSH', autoNext: true, loop: false, locked: false }).run()
  app.sqlite.prepare('INSERT INTO external_devices VALUES (?,?,?,?,?,?,?)').run(device.id, 'Matriz QA', device.kind, device.host, device.port, 1, now)
  const runtime = (await runtimeFor(app, 'ch'))!
  await runtime.load('day'); await runtime.transport.take('day', 'live'); await runtime.transport.cue({ kind: 'ITEM', id: 'live' })
  server = Fastify(); registerRoutes(app, server, () => {}); await server.ready()
})
afterEach(async () => { vi.restoreAllMocks(); await server.close(); app.close() })
const add = (body: Record<string, unknown> = payload, headers?: Record<string, string>) => server.inject({ method: 'POST', url: '/api/items/live/secondary-events', payload: body, headers:{'if-match':app.concurrency.generateETag('day'),...headers} })

describe('automação publicada por evento sem comandos implícitos', () => {
  it('programar, simular e publicar preservam PGM/CUE e congelam endpoint apenas na revisão', async () => {
    const send = vi.spyOn(globalStudioAutomationGateway, 'execute'), runtime = app.runtimes.get('ch')!, before = runtime.transport.state()
    const added = await add({ ...payload, deviceConfig: { ...payload.deviceConfig, configurationHash: 'a'.repeat(64) } })
    expect(added.statusCode).toBe(200); expect(added.json().event.deviceConfig.configurationHash).toBeUndefined()
    expect((await server.inject('/api/rundowns/day/operational-simulation')).statusCode).toBe(200)
    expect((await reviewedPublish(server,'day')).statusCode).toBe(201)
    const frozen = readOperationalPayload((await activeOperationalPlaylist(app.db, 'day'))!.payload)
    const event = frozen.secondaryEvents!.find(event => event.id === added.json().event.id)!
    expect(event.deviceConfig?.configurationHash).toBe(equipmentIdentity(device))
    app.sqlite.prepare('UPDATE external_devices SET port=9991 WHERE id=?').run(device.id)
    const diff = await server.inject('/api/rundowns/day/operational-simulation')
    expect(diff.statusCode).toBe(200); expect(diff.json().differences.graphicsChanged).toContain('live')
    expect(readOperationalPayload((await activeOperationalPlaylist(app.db, 'day'))!.payload).secondaryEvents!.find(row => row.id === event.id)?.deviceConfig?.configurationHash).toBe(equipmentIdentity(device))
    expect(runtime.transport.state()).toMatchObject({ preview: before.preview, onAir: { itemId: before.onAir?.itemId, startedAt: before.onAir?.startedAt } })
    expect(send).not.toHaveBeenCalled()
  })
  it('tipo/portas/equipamento explícitos e ausência de credencial são obrigatórios', async () => {
    const send = vi.spyOn(globalStudioAutomationGateway, 'execute')
    for (const config of [undefined, { ...payload.deviceConfig, token: 'PRIVATE_TOKEN' }, { ...payload.deviceConfig, deviceId: 'absent' }, { ...payload.deviceConfig, targetDevice: 'ATEM_SWITCHER' }, { ...payload.deviceConfig, action: 'ROUTE_CROSSPOINT', params: { source: 2 } }]) expect((await add({ ...payload, deviceConfig: config })).statusCode).toBe(400)
    expect((await add({ ...payload, durationFrames: 25 })).statusCode).toBe(400)
    expect((await add({ ...payload, type: 'GRAPHICS_OVERLAY' })).statusCode).toBe(400)
    app.sqlite.prepare('UPDATE external_devices SET enabled=0 WHERE id=?').run(device.id)
    expect((await add()).statusCode).toBe(400); expect(send).not.toHaveBeenCalled()
  })
  it('PGM simulado não envia mesmo após publicar e TAKE; falha não é repetida', async () => {
    const send = vi.spyOn(globalStudioAutomationGateway, 'execute'), runtime = app.runtimes.get('ch')!
    await runtime.transport.stop()
    const added = await add(); expect(added.statusCode).toBe(200)
    await reviewedPublish(server,'day')
    await runtime.transport.take('day', 'live')
    for (let n = 0; n < 2; n++) {
      const result = await server.inject({ method: 'POST', url: `/api/channels/ch/secondary-events/${added.json().event.id}/fire`, payload: {} })
      expect(result.statusCode).toBe(409); expect(result.json()).toMatchObject({ run: { state: 'FAILED' }, physicalExecutionConfirmed: false })
    }
    expect(send).not.toHaveBeenCalled()
  })
  it('programador edita grade, mas não cadastra nem remove comando físico', async () => {
    const added = await add(), now = new Date().toISOString(), token = 'programmer-session'
    app.sqlite.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run('editor', 'editor', 'unused-hash', 'PROGRAMMER', 1, now)
    app.sqlite.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(sessionDigest(token), 'editor', '2099-01-01', now)
    const headers = { cookie: `rplayout_session=${token}`,'if-match':app.concurrency.generateETag('day') }
    expect((await add(payload, headers)).statusCode).toBe(403)
    expect((await server.inject({ method: 'DELETE', url: `/api/items/live/secondary-events/${added.json().event.id}`, headers })).statusCode).toBe(403)
    expect((await server.inject({ url: '/api/items/live/secondary-events', headers })).json().events).toHaveLength(1)
  })
})
