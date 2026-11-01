/**
 * Item 12 (achado no ar, r88-35): POST /api/channels/:id/transport com
 * {action:'stop', bus:'pvw'} parava o PGM (19,5 s fora do ar) e suspendia a
 * continuidade publicada e a publicação automática.
 */
import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { createApp, runtimeFor, type App, type ChannelRuntime } from '../app.js'
import { registerRoutes, transportBusRefusal } from '../routes.js'
import { channels } from '../db/schema.js'

vi.mock('../config.js', async (original) => ({ ...await original<Record<string, unknown>>(), ENGINE_BINARY: '', MEDIAMTX_BINARY: '', DEVICES_BINARY: '', ENCODERS_BINARY: '', AUTH_USER: '', AUTH_PASSWORD: '', DEFAULT_ROLE: 'ADMIN', EXTERNAL_CONTROL_TOKEN: 'token-de-teste' }))

let app: App, server: FastifyInstance, runtime: ChannelRuntime
let stop: MockInstance, cue: MockInstance, continuity: MockInstance, publication: MockInstance
beforeEach(async () => {
  app = await createApp(':memory:')
  app.db.insert(channels).values({ id: 'ch', name: 'Canal', width: 1920, height: 1080, rateNum: 25, rateDen: 1, targetLufs: -23, ceilingDbtp: -1, limiterLookaheadMs: 5, createdAt: new Date().toISOString() }).run()
  runtime = (await runtimeFor(app, 'ch'))!
  stop = vi.spyOn(runtime.transport, 'stop') as unknown as MockInstance
  cue = vi.spyOn(runtime.transport, 'cue') as unknown as MockInstance
  continuity = vi.spyOn(app.publishedContinuity, 'suspend') as unknown as MockInstance
  publication = vi.spyOn(app.schedulePublication, 'suspend') as unknown as MockInstance
  server = Fastify(); registerRoutes(app, server, () => {}); await server.ready()
})
afterEach(async () => { vi.restoreAllMocks(); await server.close(); app.close() })

const transport = (payload: object) => server.inject({ method: 'POST', url: '/api/channels/ch/transport', payload })
const external = (payload: object) => server.inject({ method: 'POST', url: '/api/external/control', payload: { channelId: 'ch', ...payload }, headers: { 'x-rplayout-control-token': 'token-de-teste' } })

describe('STOP com bus "pvw" nunca toca o PGM', () => {
  it('limpa só o preview: não chama transport.stop() nem suspende continuidade ou publicação', async () => {
    const response = await transport({ action: 'stop', bus: 'pvw' })
    expect(response.statusCode, response.body).toBe(200)
    expect(cue).toHaveBeenCalledWith(null)
    expect(stop).not.toHaveBeenCalled()
    expect(continuity).not.toHaveBeenCalled()
    expect(publication).not.toHaveBeenCalled()
  })

  it('com comando pendente (TAKE aguardando sinal), recusa em vez de arriscar a troca do PGM', async () => {
    ;(runtime.transport as unknown as { hasPendingCommand: () => boolean }).hasPendingCommand = () => true
    const response = await transport({ action: 'stop', bus: 'pvw' })
    expect(response.statusCode).toBe(409)
    expect(cue).not.toHaveBeenCalled()
    expect(stop).not.toHaveBeenCalled()
  })

  it('STOP sem bus (ou com bus "pgm") continua parando o PGM', async () => {
    expect((await transport({ action: 'stop' })).statusCode).toBe(200)
    expect(stop).toHaveBeenCalledTimes(1)
    expect(continuity).toHaveBeenCalledTimes(1)
  })

  it('TAKE/PARK com bus "pvw" e CUE com bus "pgm" são recusados, não reinterpretados', async () => {
    for (const payload of [{ action: 'take', bus: 'pvw' }, { action: 'park', bus: 'pvw' }, { action: 'cue', bus: 'pgm' }]) {
      const response = await transport(payload)
      expect(response.statusCode, JSON.stringify(payload)).toBe(400)
    }
    expect(transportBusRefusal('seek', 'pvw')).toBeNull()
    expect(stop).not.toHaveBeenCalled()
  })

  it('controle externo: STOP com bus "pvw" é recusado com 400 (antes o bus era descartado e o PGM parava)', async () => {
    const response = await external({ action: 'stop', bus: 'pvw' })
    expect(response.statusCode).toBe(400)
    expect(response.json().error).toMatch(/PGM/)
    expect(stop).not.toHaveBeenCalled()
    expect(continuity).not.toHaveBeenCalled()
    expect(publication).not.toHaveBeenCalled()
  })
})
