/** Achado 9: GET /api/channels/:id/monitors mostrava concessões de outros canais. */
import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, runtimeFor, type App } from '../app.js'
import { registerRoutes } from '../routes.js'
import { channels } from '../db/schema.js'

vi.mock('../config.js', async (original) => ({ ...await original<Record<string, unknown>>(), ENGINE_BINARY: '', MEDIAMTX_BINARY: '', DEVICES_BINARY: '', ENCODERS_BINARY: '', RELAY_BINARY: '', AUTH_USER: '', AUTH_PASSWORD: '', DEFAULT_ROLE: 'ADMIN' }))

let app: App, server: FastifyInstance
beforeEach(async () => {
  app = await createApp(':memory:')
  const now = new Date().toISOString()
  for (const id of ['ch', 'other']) app.db.insert(channels).values({ id, name: id, width: 1920, height: 1080, rateNum: 25, rateDen: 1, targetLufs: -23, ceilingDbtp: -1, limiterLookaheadMs: 5, createdAt: now }).run()
  server = Fastify(); registerRoutes(app, server, () => {}); await server.ready()
})
afterEach(async () => { vi.restoreAllMocks(); await server.close(); app.close() })

describe('tela técnica dos monitores', () => {
  it('lista só as concessões de placa e de CPU do próprio canal; os totais são da máquina', async () => {
    await runtimeFor(app, 'ch'); await runtimeFor(app, 'other')
    app.encoderSessions!.setProbe({ encoders: [], hardware: 'nvh264enc', hardwareSessions: 8 })
    app.encoderSessions!.request({ channelId: 'ch', bus: 'mon', tier: 'ref' })
    app.encoderSessions!.request({ channelId: 'other', bus: 'mon', tier: 'ref' })
    app.encoderSessions!.requestSoftware({ channelId: 'other', bus: 'pvw', tier: 'std' }, [10, 2])
    const response = await server.inject('/api/channels/ch/monitors')
    expect(response.statusCode).toBe(200)
    const { sessions } = response.json() as { sessions: { grants: { channelId: string }[]; monitorsInUse: number; software: { grants: unknown[]; inUseMpx: number } } }
    expect(sessions.grants).toEqual([{ channelId: 'ch', bus: 'mon', tier: 'ref' }])
    expect(sessions.software.grants).toEqual([])
    expect(sessions.monitorsInUse).toBe(2)
    expect(sessions.software.inUseMpx).toBe(10)
  })
})
