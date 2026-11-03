/** Item 14: tarja "SEM ÁUDIO" marcada no QC, com registro de quem e quando. */
import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createApp, type App } from '../app.js'
import { registerRoutes } from '../routes.js'
import { channels, mediaAssets, operatorDecisions } from '../db/schema.js'
import { INTENTIONAL_SILENCE_DECISION } from './intentional-silence.js'

vi.mock('../config.js', async (original) => ({ ...await original<Record<string, unknown>>(), ENGINE_BINARY: '', MEDIAMTX_BINARY: '', DEVICES_BINARY: '', ENCODERS_BINARY: '', AUTH_USER: '', AUTH_PASSWORD: '', DEFAULT_ROLE: 'ADMIN' }))

let app: App, server: FastifyInstance
beforeEach(async () => {
  app = await createApp(':memory:')
  const now = new Date().toISOString()
  app.db.insert(channels).values({ id: 'ch', name: 'Canal', width: 1920, height: 1080, rateNum: 25, rateDen: 1, targetLufs: -23, ceilingDbtp: -1, limiterLookaheadMs: 5, createdAt: now }).run()
  app.db.insert(mediaAssets).values({ id: 'vt', contentHash: 'h1', path: '/m/finaliza.mxf', title: 'Finaliza Gado Canal', kind: 'VIDEO', durationFrames: 2275, hasAudio: false, createdAt: now } as never).run()
  server = Fastify(); registerRoutes(app, server, () => {}); await server.ready()
})
afterEach(async () => { await server.close(); app.close() })

describe('SEM ÁUDIO no QC', () => {
  it('marca, aparece no QC e no acervo, e fica no log de decisões; versão diferente do arquivo é recusada', async () => {
    const put = (body: object) => server.inject({ method: 'PUT', url: '/api/assets/vt/intentional-silence', payload: body })
    expect((await put({ channelId: 'ch', contentHash: 'outra', on: true })).statusCode).toBe(409)
    expect((await put({ channelId: 'ch', contentHash: 'h1', on: true })).statusCode).toBe(200)
    expect((await server.inject('/api/assets/vt/qc?channelId=ch')).json().intentionalSilence).toBe(true)
    const assets = (await server.inject('/api/assets')).json().assets as { id: string; intentionalSilence?: boolean }[]
    expect(assets.find((asset) => asset.id === 'vt')?.intentionalSilence).toBe(true)
    const decisions = app.db.select().from(operatorDecisions).where(eq(operatorDecisions.kind, INTENTIONAL_SILENCE_DECISION)).all()
    expect(decisions).toHaveLength(1)
    expect(decisions[0]!.createdAt).toMatch(/^\d{4}-/)
    expect(decisions[0]!.payload).toMatchObject({ assetId: 'vt', contentHash: 'h1', on: true, channelId: 'ch' })
  })
})
