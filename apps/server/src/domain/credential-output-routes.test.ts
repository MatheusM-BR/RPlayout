import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createApp, runtimeFor, type App } from '../app.js'
import { registerRoutes } from '../routes.js'
import { channels, destinations, outputProfiles, operatorDecisions } from '../db/schema.js'
import { redactUrl } from './relays.js'
import {configurationRevision} from '../db/channel-configuration.js'
import {channelConfigurationETag} from '@rplayout/protocol'

vi.mock('../config.js', async original => ({ ...await original<Record<string, unknown>>(), ENGINE_BINARY: '', MEDIAMTX_BINARY: '', DEVICES_BINARY: '', RELAY_BINARY: '', AUTH_USER: '', AUTH_PASSWORD: '', DEFAULT_ROLE: 'ADMIN' }))
let app: App, server: FastifyInstance
const raw = 'srt://127.0.0.1:9000?mode=caller&passphrase=PRIVATE_OUTPUT_KEY&stream_key=PRIVATE_QUERY_KEY'
beforeEach(async () => {
  app = await createApp(':memory:')
  await app.db.insert(channels).values({ id: 'ch', name: 'Canal', rateNum: 25, rateDen: 1, width: 320, height: 180, targetLufs: -23, ceilingDbtp: -1, limiterLookaheadMs: 5, createdAt: new Date().toISOString() })
  server = Fastify(); registerRoutes(app, server, () => {}); await server.ready()
})
afterEach(async () => { await server.close(); app.close() })
const headers=()=>({'if-match':channelConfigurationETag('ch',configurationRevision(app.db,'ch'))})
describe('editar endereço público não grava máscara sobre uma credencial', () => {
  it('criar/aplicar/editar/remover saída não altera banco ou runtime durante recuperação', async () => {
    const created = (await server.inject({method:'POST',url:'/api/channels/ch/outputs',headers:headers(),payload:{name:'SRT',kind:'SRT',target:raw}})).json().output
    const preset = (await server.inject({method:'POST',url:'/api/channels/ch/transmission-presets',headers:{'if-match':channelConfigurationETag('ch',configurationRevision(app.db,'ch'))},payload:{name:'Preset',kind:'SRT',target:raw}})).json().preset
    const previous = (await runtimeFor(app,'ch'))!
    const guard = vi.spyOn(previous,'assertReconfigurationReady').mockImplementation(() => { throw new Error('Recuperação pendente') })
    for (const request of [
      {method:'POST' as const,url:'/api/channels/ch/outputs',payload:{name:'Novo',kind:'SRT',target:raw}},
      {method:'POST' as const,url:`/api/channels/ch/transmission-presets/${preset.id}/apply`,payload:{}},
      {method:'PATCH' as const,url:`/api/outputs/${created.id}`,payload:{name:'Alterado'}},
      {method:'DELETE' as const,url:`/api/outputs/${created.id}`},
    ]) expect((await server.inject(request)).statusCode).toBe(409)
    expect(app.db.select().from(outputProfiles).all()).toHaveLength(1)
    expect(app.db.select().from(outputProfiles).get()?.name).toBe('SRT')
    expect(app.runtimes.get('ch')).toBe(previous)
    guard.mockRestore()
  })
  it('saída conserva endereço privado ao salvar seu nome/cópia pública e rejeita máscara nova', async () => {
    const result = await server.inject({ method: 'POST', url: '/api/channels/ch/outputs',headers:headers(), payload: { name: 'SRT privada', kind: 'SRT', target: raw, enabled: false } })
    expect(result.statusCode).toBe(200); expect(result.body).not.toContain('PRIVATE_')
    const { output } = result.json(); expect(output.target).toBe(redactUrl(raw))
    expect((await server.inject({ method: 'PATCH', url: `/api/outputs/${output.id}`,headers:headers(), payload: { name: 'Apelido alterado', target: output.target } })).statusCode).toBe(200)
    expect(app.db.select().from(outputProfiles).where(eq(outputProfiles.id, output.id)).get()).toMatchObject({ name: 'Apelido alterado', target: raw })
    expect((await server.inject({ method: 'PATCH', url: `/api/outputs/${output.id}`,headers:headers(), payload: { target: output.target.replace(':9000', ':9001') } })).statusCode).toBe(400)
    expect((await server.inject({ method: 'PATCH', url: `/api/outputs/${output.id}`,headers:headers(), payload: { kind: 'RTMP', target: output.target } })).statusCode).toBe(400)
    expect(app.db.select().from(outputProfiles).where(eq(outputProfiles.id, output.id)).get()?.target).toBe(raw)
    expect((await server.inject({ method: 'POST', url: '/api/channels/ch/outputs', payload: { name: 'Máscara', kind: 'SRT', target: output.target, enabled: false } })).statusCode).toBe(400)
    expect((await server.inject({ method: 'PATCH', url: '/api/outputs/absent', payload: { name: 'Ausente' } })).statusCode).toBe(404)
    const audit = app.db.select().from(operatorDecisions).where(eq(operatorDecisions.rundownId,'@security')).all()
    expect(audit).toEqual(expect.arrayContaining([
      expect.objectContaining({kind:'OUTPUT_CREATED',payload:expect.objectContaining({channelId:'ch',outputId:output.id})}),
      expect.objectContaining({kind:'OUTPUT_UPDATED',payload:expect.objectContaining({fields:['name','target'],applied:'CONTROLLED_RESTART_REQUESTED'})}),
    ]))
    expect(JSON.stringify(audit)).not.toContain('PRIVATE_')
    expect(audit.filter(row=>row.kind==='OUTPUT_UPDATED')).toHaveLength(1)
  })
  it('destino preserva credencial, não admite endereço parcialmente mascarado e não anuncia ID inexistente', async () => {
    await app.db.insert(destinations).values({ id: 'destination', channelId: 'ch', name: 'Privado', url: raw, enabled: false, createdAt: new Date().toISOString() })
    expect((await server.inject({ method: 'PATCH', url: '/api/destinations/destination', payload: { name: 'Outro nome', url: redactUrl(raw), enabled: false } })).statusCode).toBe(200)
    expect(app.db.select().from(destinations).where(eq(destinations.id, 'destination')).get()).toMatchObject({ name: 'Outro nome', url: raw })
    expect((await server.inject({ method: 'PATCH', url: '/api/destinations/destination', payload: { url: redactUrl(raw).replace('9000', '9001') } })).statusCode).toBe(400)
    expect((await server.inject({ method: 'POST', url: '/api/channels/ch/destinations', payload: { name: 'Máscara', url: redactUrl(raw) } })).statusCode).toBe(400)
    expect((await server.inject({ method: 'PATCH', url: '/api/destinations/absent', payload: { name: 'Ausente' } })).statusCode).toBe(404)
    expect(app.db.select().from(destinations).where(eq(destinations.id, 'destination')).get()?.url).toBe(raw)
  })
  it('redige nomes de parâmetro alternativos, RTMP de um segmento e conserva Unicode não-URL', () => {
    for (const url of ['rtmp://host/PRIVATE_KEY', 'rtmp://host/app/PRIVATE_KEY', 'srt://host:9000?stream_key=PRIVATE_KEY&passwd=PRIVATE_PASSWORD&streamid=PRIVATE_ID']) expect(redactUrl(url)).not.toContain('PRIVATE_')
    expect(redactUrl('ndi:ESTÚDIO ÇÃO')).toBe('ndi:ESTÚDIO ÇÃO')
    expect(redactUrl('C:\\Mídia\\AÇÃO.mkv')).toBe('C:\\Mídia\\AÇÃO.mkv')
  })
})
