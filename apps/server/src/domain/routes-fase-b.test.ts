import { describe, expect, it, beforeAll, afterAll,vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { createApp,runtimeFor, type App } from '../app.js'
import { registerRoutes } from '../routes.js'
import { channels } from '../db/schema.js'
import { globalSrtManager } from './srt.js'
import { ProcessMetrics } from './process-metrics.js'

describe('Rotas e Endpoints da Fase B (SRT, Failover, Multiview, LiveSources)', () => {
  let app: App
  let server: FastifyInstance

  beforeAll(async () => {
    app = await createApp(':memory:')
    // Cria um canal para os testes de fontes ao vivo
    await app.db.insert(channels).values({
      id: 'ch-fase-b',
      name: 'Canal Fase B',
      rateNum: 30000,
      rateDen: 1001,
      width: 1920,
      height: 1080,
      scan: 'PROGRESSIVE',
      fieldOrder: 'TFF',
      targetLufs: -24,
      ceilingDbtp: -1,
      limiterLookaheadMs: 5,
      createdAt: new Date().toISOString(),
    })

    server = Fastify()
    registerRoutes(app, server, () => {})
    await server.ready()
  })

  afterAll(async () => {
    await server.close()
    app.close()
  })

  it('painel de processos mascara destinos e compartilha medição com todas as saídas do PID',async()=>{
    const runtime=(await runtimeFor(app,'ch-fase-b'))!
    const publisher=vi.spyOn(runtime.transport,'publishers').mockReturnValue([{url:'srt://203.0.113.2:9000?passphrase=PRIVATE-SRT',health:'onAir',attempts:0,delivered:1},
      {url:'rtmp://example.invalid/app/PRIVATE-KEY',health:'connecting',attempts:1,delivered:0}])
    const pid=vi.spyOn(runtime.transport,'processId').mockReturnValue(42)
    const measurement=vi.spyOn(ProcessMetrics.prototype,'latest').mockResolvedValue({samples:new Map([[42,{cpuTimeMs:25,memoryBytes:10000}]]),error:null})
    try {
      const response=await server.inject({method:'GET',url:'/api/processes'})
      expect(response.statusCode).toBe(200)
      expect(response.body).not.toContain('PRIVATE-SRT');expect(response.body).not.toContain('PRIVATE-KEY')
      const rows=response.json().processes.filter((row:{pid:number})=>row.pid===42)
      expect(rows).toHaveLength(3)
      expect(rows.every((row:{cpuTimeMs:number;memoryBytes:number})=>row.cpuTimeMs===25 && row.memoryBytes===10000)).toBe(true)
    } finally {publisher.mockRestore();pid.mockRestore();measurement.mockRestore()}
  })

  it('GET /api/v1/srt/telemetry retorna telemetrias registradas', async () => {
    globalSrtManager.recordTelemetry('src-camera-1', {
      rttMs: 72,
      packetLossPercent: 0.2,
      bitrateKbps: 6000,
      packetsDropped: 0,
      packetsRetransmitted: 3,
      linkState: 'OPTIMAL',
      reconnectCount: 0,
    })

    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/srt/telemetry',
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body['src-camera-1']).toBeDefined()
    expect(body['src-camera-1'].rttMs).toBe(72)
    expect(body['src-camera-1'].linkState).toBe('OPTIMAL')
  })

  it('GET /api/host-metrics entrega consumo real do host sem inventar GPU', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/host-metrics' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.generatedAt).toBeTruthy()
    expect(body.cpu.cores).toBeGreaterThan(0)
    expect(body.memory.totalBytes).toBeGreaterThan(0)
    expect(body.memory.usedBytes).toBeGreaterThanOrEqual(0)
    expect(body.gpu).toHaveProperty('utilizationPercent')
    expect(body.gpu).toHaveProperty('error')
  })

  it('CRUD completo de fontes ao vivo com mascaramento de passphrase', async () => {
    // 1. Criar fonte SRT Caller
    const createRes = await server.inject({
      method: 'POST',
      url: '/api/v1/sources/live',
      payload: {
        channelId: 'ch-fase-b',
        name: 'Link Externa Reportagem',
        kind: 'SRT',
        srtConfig: {
          mode: 'caller',
          host: '203.0.113.15',
          port: 9000,
          latencyMs: 1200,
          passphrase: 'SecretPassword2026!',
          pbkeylen: 32,
        },
        role: 'PRIMARY',
        autoFailover: true,
      },
    })

    expect(createRes.statusCode).toBe(201)
    const created = JSON.parse(createRes.body)
    expect(created.id).toBeDefined()
    expect(created.name).toBe('Link Externa Reportagem')
    expect(created.targetUrl).toContain('srt://203.0.113.15:9000?')
    expect(created.srtConfig.passphrase).not.toBe('SecretPassword2026!')
    expect(created.srtConfig.passphrase).toContain('•••')

    // 2. Listar fontes
    const listRes = await server.inject({
      method: 'GET',
      url: '/api/v1/sources/live?channelId=ch-fase-b',
    })
    expect(listRes.statusCode).toBe(200)
    const list = JSON.parse(listRes.body)
    expect(list.length).toBeGreaterThanOrEqual(1)
    expect(list.some((s: any) => s.id === created.id)).toBe(true)

    // 3. Atualizar fonte
    const updateRes = await server.inject({
      method: 'PUT',
      url: `/api/v1/sources/live/${created.id}`,
      payload: {
        name: 'Link Externa Reportagem VIP',
      },
    })
    expect(updateRes.statusCode).toBe(200)
    const updated = JSON.parse(updateRes.body)
    expect(updated.name).toBe('Link Externa Reportagem VIP')

    // 4. Force failover
    const failoverRes = await server.inject({
      method: 'POST',
      url: `/api/v1/sources/live/${created.id}/force-failover`,
      payload: {},
    })
    expect(failoverRes.statusCode).toBe(200)
    const failoverData = JSON.parse(failoverRes.body)
    expect(failoverData.ok).toBe(true)
    expect(failoverData.event.fromRole).toBe('PRIMARY')
    expect(failoverData.event.toRole).toBe('BACKUP')

    // 5. Deletar fonte
    const deleteRes = await server.inject({
      method: 'DELETE',
      url: `/api/v1/sources/live/${created.id}`,
    })
    expect(deleteRes.statusCode).toBe(200)
    expect(JSON.parse(deleteRes.body).ok).toBe(true)
  })

  it('POST /api/v1/engineering/failover/trigger chaveia par redundante', async () => {
    // Cria fonte temporária para teste de trigger
    const createRes = await server.inject({
      method: 'POST',
      url: '/api/v1/sources/live',
      payload: {
        channelId: 'ch-fase-b',
        name: 'Fonte Contingência',
        kind: 'RTMP',
        targetUrl: 'rtmp://live.stream/main',
        role: 'PRIMARY',
      },
    })
    const source = JSON.parse(createRes.body)

    const triggerRes = await server.inject({
      method: 'POST',
      url: '/api/v1/engineering/failover/trigger',
      payload: {
        sourceId: source.id,
        targetRole: 'BACKUP',
        reason: 'Manutenção programada na fibra primária',
      },
    })

    expect(triggerRes.statusCode).toBe(200)
    const result = JSON.parse(triggerRes.body)
    expect(result.ok).toBe(true)
    expect(result.event.fromRole).toBe('PRIMARY')
    expect(result.event.toRole).toBe('BACKUP')
    expect(result.event.reason).toBe('Manutenção programada na fibra primária')
  })

  it('GET e PUT /api/v1/multiview/config gerencia layout e células', async () => {
    const putRes = await server.inject({
      method: 'PUT',
      url: '/api/v1/multiview/config',
      payload: {
        channelId: 'ch-fase-b',
        layout: 'GRID_2X2',
        cells: [
          {
            id: 'c1',
            name: 'Estúdio Central',
            sourceUrl: 'ndi:StudioCentral',
            tally: 'ON_AIR',
            audioPeakDb: [-14.5, -14.2],
            syncState: 'LOCKED',
          },
          {
            id: 'c2',
            name: 'Link Externa 1',
            sourceUrl: 'srt://10.0.0.1:9000',
            tally: 'NEXT',
            audioPeakDb: [-22, -21.8],
            syncState: 'LOCKED',
          },
        ],
      },
    })

    expect(putRes.statusCode).toBe(200)
    const saved = JSON.parse(putRes.body)
    expect(saved.layout).toBe('GRID_2X2')
    expect(saved.cells.length).toBe(2)

    const getRes = await server.inject({
      method: 'GET',
      url: '/api/v1/multiview/config?channelId=ch-fase-b',
    })

    expect(getRes.statusCode).toBe(200)
    const retrieved = JSON.parse(getRes.body)
    expect(retrieved.layout).toBe('GRID_2X2')
    expect(retrieved.cells[0].name).toBe('Estúdio Central')
  })
})
