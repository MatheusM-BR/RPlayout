import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { createApp, type App } from '../app.js'
import { registerRoutes } from '../routes.js'
import { asRun, channels, rundowns, rundownItems } from '../db/schema.js'

describe('rotas XMLTV e comprovante comercial', () => {
  let app: App
  let server: FastifyInstance

  beforeAll(async () => {
    app = await createApp(':memory:')
    const now = new Date().toISOString()
    await app.db.insert(channels).values({ id: 'epg-ch', name: 'TV EPG', rateNum: 25, rateDen: 1, width: 1920, height: 1080, scan: 'PROGRESSIVE', fieldOrder: 'TFF', targetLufs: -23, ceilingDbtp: -1, limiterLookaheadMs: 5, createdAt: now })
    await app.db.insert(rundowns).values({ id: 'epg-rd', channelId: 'epg-ch', name: 'Grade EPG', plannedStart: 0, loop: false, date: '2026-09-24', createdAt: now, updatedAt: now })
    await app.db.insert(rundownItems).values({ id: 'epg-item', rundownId: 'epg-rd', sortOrder: 1, type: 'VT', title: 'Programa XMLTV', mediaId: null, durationOverride: 1500, minDuration: 1, anchor: { kind: 'FLOW' }, onOverrun: 'PUSH', locked: false, autoNext: true, loop: false })
    await app.db.insert(asRun).values({ id: 'epg-asrun', channelId: 'epg-ch', rundownId: 'epg-rd', itemId: 'epg-item', mediaId: null, title: 'Comercial de Teste', type: 'COMMERCIAL', startedAt: '2026-09-24T12:00:00.000Z', endedAt: '2026-09-24T12:00:30.000Z', plannedStart: 0, actualStart: 0, airedFrames: 750, plannedFrames: 750, endedBy: 'NEXT', createdAt: now })
    server = Fastify()
    registerRoutes(app, server, () => {})
    await server.ready()
  })

  afterAll(async () => { await server.close(); app.close() })

  it('disponibiliza o feed XMLTV sob a mesma autorização de exportação', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/channels/epg-ch/epg.xml' })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('application/xml')
    expect(response.body).toContain('Programa XMLTV')
  })

  it('entrega o comprovante comercial como PDF real', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/channels/epg-ch/reports/commercial.pdf?since=2026-09-24T00:00:00.000Z&until=2026-09-25T00:00:00.000Z' })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('application/pdf')
    expect(response.rawPayload.subarray(0, 8).toString()).toBe('%PDF-1.4')
  })
})
