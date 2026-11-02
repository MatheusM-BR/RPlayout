import { afterAll, beforeAll, describe, expect, it,vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { createApp, type App } from '../app.js'
import { registerRoutes } from '../routes.js'
import { channels, transmissionPresets, outputProfiles } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { SECRET_PREFIX } from './secret-vault.js'
import {configurationRevision} from '../db/channel-configuration.js'
import {channelConfigurationETag} from '@rplayout/protocol'
import {EngineTransport} from './engine.js'

// This is repository/HTTP/profile coverage, not a physical publisher test.
// Never discover and start installation runtimes or external targets here.
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))

describe('presets persistentes de transmissão', () => {
  let app: App
  let server: FastifyInstance
  const headers=()=>({'if-match':channelConfigurationETag('preset-channel',configurationRevision(app.db,'preset-channel'))})

  beforeAll(async () => {
    app = await createApp(':memory:')
    await app.db.insert(channels).values({
      id: 'preset-channel', name: 'Canal Presets', rateNum: 30000, rateDen: 1001,
      width: 1920, height: 1080, scan: 'PROGRESSIVE', fieldOrder: 'TFF',
      targetLufs: -24, ceilingDbtp: -1, limiterLookaheadMs: 5, createdAt: new Date().toISOString(),
    })
    server = Fastify()
    registerRoutes(app, server, () => {})
    await server.ready()
  })

  afterAll(async () => { await server.close();app.close() })

  it('protege segredo no SQLite, preserva aplicação ao perfil e mascara respostas', async () => {
    const srtSecret = 'SenhaSrtNaoPodeVazar'
    const create = await server.inject({ method: 'POST', url: '/api/channels/preset-channel/transmission-presets', headers:headers(), payload: {
      name: 'SRT Afiliada', kind: 'SRT', target: `srt://198.51.100.40:9000?mode=caller&passphrase=${srtSecret}`,
    } })
    expect(create.statusCode).toBe(201)
    expect(create.body).not.toContain(srtSecret)
    expect(create.body).toContain('passphrase=')

    const presetId = JSON.parse(create.body).preset.id as string
    const listed = await server.inject({ method: 'GET', url: '/api/channels/preset-channel/transmission-presets' })
    expect(listed.body).not.toContain(srtSecret)

    const applied = await server.inject({ method: 'POST', url: `/api/channels/preset-channel/transmission-presets/${presetId}/apply`, headers:headers(), payload: {} })
    expect(applied.statusCode).toBe(201)
    expect(app.runtimes.get('preset-channel')?.transport).not.toBeInstanceOf(EngineTransport)
    expect(applied.body).not.toContain(srtSecret)
    const stored = app.sqlite.prepare('SELECT target FROM transmission_presets WHERE id=?').get(presetId) as { target: string }
    expect(stored.target).toMatch(new RegExp('^' + SECRET_PREFIX))
    expect(stored.target).not.toContain(srtSecret)
    expect((await app.db.select().from(transmissionPresets).where(eq(transmissionPresets.id, presetId)))[0]!.target).toContain(srtSecret)
    expect((await app.db.select().from(outputProfiles).where(eq(outputProfiles.channelId, 'preset-channel'))).some(row => row.target.includes(srtSecret))).toBe(true)
    expect(JSON.stringify(app.sqlite.prepare('SELECT target FROM output_profiles').all())).not.toContain(srtSecret)

    const outputs = await server.inject({ method: 'GET', url: '/api/channels/preset-channel/outputs' })
    expect(outputs.body).not.toContain(srtSecret)

    const rtmpKey = 'rtmp-stream-key-nao-vaza'
    const rtmp = await server.inject({ method: 'POST', url: '/api/channels/preset-channel/transmission-presets', headers:headers(), payload: {
      name: 'CDN Principal', kind: 'RTMP', target: `rtmps://live.example.test/app/${rtmpKey}`,
    } })
    expect(rtmp.statusCode).toBe(201)
    expect(rtmp.body).not.toContain(rtmpKey)
  })

  it('remove somente o preset solicitado', async () => {
    const created = await server.inject({ method: 'POST', url: '/api/channels/preset-channel/transmission-presets', headers:headers(), payload: {
      name: 'Temporário', kind: 'RTMP', target: 'rtmp://localhost/live/chave-temporaria',
    } })
    expect(created.statusCode,created.body).toBe(201)
    const id = JSON.parse(created.body).preset.id as string
    const removed = await server.inject({ method: 'DELETE', url: `/api/channels/preset-channel/transmission-presets/${id}`,headers:headers() })
    expect(removed.statusCode).toBe(200)
    const list = await server.inject({ method: 'GET', url: '/api/channels/preset-channel/transmission-presets' })
    expect(JSON.parse(list.body).presets.some((preset: { id: string }) => preset.id === id)).toBe(false)
  })

  it('recusa criar preset com o segredo já mascarado sem gravar conexão inválida', async () => {
    const before = app.db.select().from(transmissionPresets).all().length
    for (const target of ['srt://host:9000?passphrase=REDACTED', 'rtmps://cdn.example/app/REDACTED']) {
      const response = await server.inject({ method: 'POST', url: '/api/channels/preset-channel/transmission-presets', headers:headers(), payload: { name: 'Máscara inválida', kind: target.startsWith('srt:') ? 'SRT' : 'RTMP', target } })
      expect(response.statusCode).toBe(400)
    }
    expect(app.db.select().from(transmissionPresets).all()).toHaveLength(before)
  })
})
