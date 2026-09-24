import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { createApp, type App } from '../app.js'
import { registerRoutes } from '../routes.js'
import { asRun, channels, mediaAssets } from '../db/schema.js'

describe('Rotas e Endpoints da Fase C (Continuidade, Compliance e Sonda PGM)', () => {
  let app: App
  let server: FastifyInstance

  beforeAll(async () => {
    app = await createApp(':memory:')

    // Cria canal de teste
    await app.db.insert(channels).values({
      id: 'ch-fase-c',
      name: 'TV Continuidade 24/7',
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

    // Insere mídias e registros de as-run para testes de compliance e BXF
    await app.db.insert(mediaAssets).values([
      {
        id: 'asset-prog-1',
        contentHash: 'hash-prog-1',
        title: 'Programa Nacional 1',
        path: 'c:/media/prog1.mp4',
        durationFrames: 54000, // 30 min
        kind: 'VIDEO',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'asset-comm-1',
        contentHash: 'hash-comm-1',
        title: 'Spot Comercial Banco',
        path: 'c:/media/comm1.mp4',
        durationFrames: 900, // 30s
        kind: 'VIDEO',
        createdAt: new Date().toISOString(),
      },
    ])

    await app.db.insert(asRun).values([
      {
        id: 'asrun-rec-1',
        channelId: 'ch-fase-c',
        rundownId: 'rd-c',
        itemId: 'item-prog-1',
        mediaId: 'asset-prog-1',
        title: 'Programa Nacional 1',
        type: 'VT',
        startedAt: new Date(Date.now() - 1800 * 1000).toISOString(),
        endedAt: new Date(Date.now() - 300 * 1000).toISOString(),
        plannedStart: 0,
        actualStart: 0,
        airedFrames: 45000, // 25 min
        plannedFrames: 54000,
        endedBy: 'NEXT',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'asrun-rec-2',
        channelId: 'ch-fase-c',
        rundownId: 'rd-c',
        itemId: 'item-comm-1',
        mediaId: 'asset-comm-1',
        title: 'Spot Comercial Banco',
        type: 'COMMERCIAL',
        startedAt: new Date(Date.now() - 250 * 1000).toISOString(),
        endedAt: new Date(Date.now() - 220 * 1000).toISOString(),
        plannedStart: 45000,
        actualStart: 45000,
        airedFrames: 900, // 30s
        plannedFrames: 900,
        endedBy: 'NEXT',
        createdAt: new Date().toISOString(),
      },
    ])

    server = Fastify()
    registerRoutes(app, server, () => {})
    await server.ready()
  })

  afterAll(async () => {
    await server.close()
  })

  it('GET /api/v1/continuity/cache/status retorna status e autonomia offline', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/continuity/cache/status',
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.coverage48hPercent).toBeDefined()
    expect(body.offlineAutonomyHours).toBeDefined()
    expect(body.status).toBeDefined()
    expect(['AIR_GAP_READY', 'SYNCHRONIZING', 'DEGRADED', 'QUOTA_WARNING']).toContain(body.status)
  })

  it('POST /api/v1/continuity/cache/warm dispara pré-aquecimento forçado da grade', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/continuity/cache/warm',
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.ok).toBe(true)
    expect(body.status).toBeDefined()
  })

  it('GET /api/v1/engineering/pgm-probe/status retorna telemetria e alertas ativos', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/engineering/pgm-probe/status',
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.alerts).toBeDefined()
    expect(Array.isArray(body.alerts)).toBe(true)
    expect(body.emergencySlateActive).toBeDefined()
    expect(body.thresholds).toBeDefined()
    expect(body.thresholds.blackThresholdMs).toBe(2000)
    expect(body.thresholds.silenceThresholdMs).toBe(3000)
    expect(body.thresholds.freezeThresholdMs).toBe(2000)
  })

  it('POST /api/v1/engineering/pgm-probe/emergency-slate dispara e reseta Slate manual', async () => {
    // 1. Dispara emergência manual
    const triggerRes = await server.inject({
      method: 'POST',
      url: '/api/v1/engineering/pgm-probe/emergency-slate',
      payload: {
        reason: 'Queda de encoder remoto',
      },
    })

    expect(triggerRes.statusCode).toBe(200)
    const triggerData = JSON.parse(triggerRes.body)
    expect(triggerData.ok).toBe(true)
    expect(triggerData.emergencySlateActive).toBe(true)
    expect(triggerData.alert.autoActionTriggered).toBe('SLATE_INJECTED')

    // 2. Reseta emergência manual
    const resetRes = await server.inject({
      method: 'POST',
      url: '/api/v1/engineering/pgm-probe/emergency-slate',
      payload: {
        action: 'RESET',
      },
    })

    expect(resetRes.statusCode).toBe(200)
    const resetData = JSON.parse(resetRes.body)
    expect(resetData.ok).toBe(true)
    expect(resetData.emergencySlateActive).toBe(false)
  })

  it('GET /api/v1/compliance/asrun/bxf exporta As-Run formal em XML SMPTE-2021 BXF', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/compliance/asrun/bxf?channelId=ch-fase-c',
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('application/xml')
    expect(res.headers['content-disposition']).toContain('attachment; filename="asrun.bxf.xml"')
    expect(res.body).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(res.body).toContain('<BxfMessage')
    expect(res.body).toContain('messageType="AsRun"')
    expect(res.body).toContain('TV Continuidade 24/7')
    expect(res.body).toContain('Spot Comercial Banco')
    expect(res.body).toContain('ExecutionResult status="PLAYED_FULL"')
  })

  it('GET /api/v1/compliance/ancine/summary calcula conformidade de 25% de comerciais', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/compliance/ancine/summary?channelId=ch-fase-c',
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.hourlyCommercialPercent).toBeDefined()
    expect(body.maxAllowedCommercialPercent).toBe(25.0)
    expect(body.compliant).toBe(true)
    expect(body.nationalContentMinutes).toBeGreaterThan(0)
  })

  it('GET /api/v1/compliance/asrun/csv exporta As-Run formal estruturado em CSV', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/compliance/asrun/csv?channelId=ch-fase-c',
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/csv')
    expect(res.body).toContain('id,itemId,title,eventType,scheduledStart')
    expect(res.body).toContain('Spot Comercial Banco')
    expect(res.body).toContain('COMMERCIAL')
  })
})
