import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { createApp, type App } from '../app.js'
import { registerRoutes } from '../routes.js'
import { channels } from '../db/schema.js'
import {
  Graphics,
  SecondaryEventScheduler,
} from './graphics.js'
import {
  StudioAutomationGateway,
  GpioRelayDriver,
} from './external-control.js'
import { SimulatedTransport } from './transport.js'
import type { SecondaryEvent, Channel } from '@rplayout/protocol'

describe('Fase D — Eventos Secundários, SCTE e Automação de Estúdio', () => {
  let app: App
  let server: FastifyInstance
  const testChannel: Channel = {
    id: 'ch-fase-d',
    name: 'TV Principal HD',
    rate: { num: 60, den: 1 },
    width: 1920,
    height: 1080,
    scan: 'PROGRESSIVE',
    fieldOrder: 'TFF',
    targetLufs: -24,
    ceilingDbtp: -1,
    limiterLookaheadMs: 5,
    programSdiDeviceId: null,
    slateTemplateId: null,
    createdAt: new Date().toISOString(),
  }

  beforeAll(async () => {
    app = await createApp(':memory:')

    await app.db.insert(channels).values({
      id: testChannel.id,
      name: testChannel.name,
      rateNum: testChannel.rate.num,
      rateDen: testChannel.rate.den,
      width: testChannel.width,
      height: testChannel.height,
      scan: testChannel.scan,
      fieldOrder: testChannel.fieldOrder,
      targetLufs: testChannel.targetLufs,
      ceilingDbtp: testChannel.ceilingDbtp,
      limiterLookaheadMs: testChannel.limiterLookaheadMs,
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

  describe('Cenário 1: Agendador de Eventos Secundários e Camadas RGBA', () => {
    it('dispara Logo e Lower-Third aos 5s de bloco e descarte automático após 8s', async () => {
      const transport = new SimulatedTransport(testChannel.id, () => null)
      const graphics = new Graphics(testChannel, transport)

      const firedActions: { eventId: string; mode: string }[] = []
      const scheduler = new SecondaryEventScheduler((event, mode) => {
        firedActions.push({ eventId: event.id, mode })
        if (mode === 'FIRE') {
          graphics.triggerLayer(event.targetLayer, 'SHOW', {
            templateId: event.templateId,
            payload: event.payload,
            durationFrames: event.durationFrames,
          })
        } else if (mode === 'DISMISS') {
          graphics.triggerLayer(event.targetLayer, 'HIDE')
        }
      })

      const logoEvent: SecondaryEvent = {
        id: 'sec-logo-01',
        targetLayer: 'STATION_LOGO',
        triggerMode: 'OFFSET_FROM_START',
        offsetFrames: 300, // 5 segundos a 60 fps
        templateId: 'tpl-logo',
        payload: { title: 'CANAL 1' },
        enabled: true,
      }

      const lowerEvent: SecondaryEvent = {
        id: 'sec-lower-01',
        targetLayer: 'LOWER_THIRD',
        triggerMode: 'OFFSET_FROM_START',
        offsetFrames: 300,
        durationFrames: 480, // 8 segundos a 60 fps
        templateId: 'tpl-lower',
        payload: { title: 'RODRIGO SILVEIRA', subtitle: 'Genebra' },
        enabled: true,
      }

      scheduler.setEvents([logoEvent, lowerEvent])

      // 1. Antes do offset (frame 290): nada dispara
      await scheduler.tick('item-bloco-01', 290, 18000)
      expect(firedActions.length).toBe(0)
      expect(graphics.getLayers().STATION_LOGO.active).toBe(false)
      expect(graphics.getLayers().LOWER_THIRD.active).toBe(false)

      // 2. No frame 300 (00:00:05:00): ambas as camadas entram no ar
      await scheduler.tick('item-bloco-01', 300, 18000)
      expect(firedActions.filter((a) => a.mode === 'FIRE').length).toBe(2)
      expect(graphics.getLayers().STATION_LOGO.active).toBe(true)
      expect(graphics.getLayers().LOWER_THIRD.active).toBe(true)

      // 3. No frame 779: Lower-Third ainda ativa
      await scheduler.tick('item-bloco-01', 779, 18000)
      expect(graphics.getLayers().LOWER_THIRD.active).toBe(true)

      // 4. No frame 780 (300 + 480): Lower-Third sofre DISMISS automático, Logo permanece ativo
      await scheduler.tick('item-bloco-01', 780, 18000)
      expect(firedActions.some((a) => a.eventId === 'sec-lower-01' && a.mode === 'DISMISS')).toBe(true)
      expect(graphics.getLayers().LOWER_THIRD.active).toBe(false)
      expect(graphics.getLayers().STATION_LOGO.active).toBe(true)
    })

    it('resolve disparo de OFFSET_BEFORE_END corretamente (Pre-roll SCTE)', async () => {
      const firedEvents: string[] = []
      const scheduler = new SecondaryEventScheduler((event) => {
        firedEvents.push(event.id)
      })

      const scteEvent: SecondaryEvent = {
        id: 'sec-scte-01',
        targetLayer: 'LOWER_THIRD',
        triggerMode: 'OFFSET_BEFORE_END',
        offsetFrames: 240, // 4s antes do fim a 60 fps
        templateId: 'scte-insert',
        payload: { spliceEventId: 55102 },
        enabled: true,
      }
      scheduler.setEvents([scteEvent])

      // Duração total: 36000 quadros. Disparo esperado: 36000 - 240 = 35760 quadros
      await scheduler.tick('item-bloco-02', 35700, 36000)
      expect(firedEvents.length).toBe(0)

      await scheduler.tick('item-bloco-02', 35760, 36000)
      expect(firedEvents).toContain('sec-scte-01')
    })
  })

  describe('Cenário 2: Gateway de Automação Externa (ATEM, Videohub, GPIO)', () => {
    it('recusa comutação ATEM quando não existe equipamento físico cadastrado', async () => {
      const gateway = new StudioAutomationGateway()
      const result = await gateway.execute({
        targetDevice: 'ATEM_SWITCHER',
        action: 'TAKE',
        params: { input: 3, transition: 'CUT' },
      })

      expect(result.success).toBe(false)
      expect(result.status).toBe('FAILED')
      expect(result.latencyMs).toBeLessThanOrEqual(50)
      expect(result.error).toMatch(/não configurado/i)

      const audits = gateway.getAuditEntries()
      expect(audits.length).toBeGreaterThan(0)
      expect(audits[0]?.targetDevice).toBe('ATEM_SWITCHER')
      expect(audits[0]?.executionStatus).toBe('FAILED')
    })

    it('recusa roteamento Videohub sem equipamento físico cadastrado', async () => {
      const gateway = new StudioAutomationGateway()
      const result = await gateway.execute({
        targetDevice: 'VIDEOHUB_ROUTER',
        action: 'ROUTE_CROSSPOINT',
        params: { destination: 4, source: 2 },
      })

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/não configurado/i)
    })

    it('controla relé GPIO em modos PULSE e LATCH', async () => {
      const driver = new GpioRelayDriver()

      const pulseResult = await driver.execute('PULSE', { pin: 2, durationMs: 100 })
      expect(pulseResult.success).toBe(true)
      expect(pulseResult.details?.mode).toBe('PULSE')
      expect(driver.getPinState(2)).toBe(true)

      const latchResult = await driver.execute('LATCH', { pin: 5, state: true })
      expect(latchResult.success).toBe(true)
      expect(driver.getPinState(5)).toBe(true)
    })
  })

  describe('Cenário 3: Rotas REST API (Fase D Endpoints)', () => {
    it('GET /api/v1/graphics/layers retorna estado das 4 camadas RGBA', async () => {
      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/graphics/layers?channelId=${testChannel.id}`,
      })

      expect(res.statusCode).toBe(200)
      const data = res.json()
      expect(data.channelId).toBe(testChannel.id)
      expect(data.layers).toBeDefined()
      expect(data.layers.STATION_LOGO).toBeDefined()
      expect(data.layers.ONAIR_CLOCK).toBeDefined()
      expect(data.layers.CRAWL_TICKER).toBeDefined()
      expect(data.layers.LOWER_THIRD).toBeDefined()
    })

    it('POST /api/v1/graphics/layers/:layer/trigger aciona camada gráfica', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/graphics/layers/STATION_LOGO/trigger',
        payload: {
          channelId: testChannel.id,
          action: 'SHOW',
          payload: { title: 'REDE TESTE' },
          opacity: 0.85,
        },
      })

      expect(res.statusCode).toBe(200)
      const data = res.json()
      expect(data.success).toBe(true)
      expect(data.layerState.layer).toBe('STATION_LOGO')
      expect(data.layerState.active).toBe(true)
      expect(data.layerState.svg).toContain('REDE TESTE')
    })

    it('POST /api/v1/scte/splice-insert dispara marcador SCTE-35 e SCTE-104', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/scte/splice-insert',
        payload: {
          channelId: testChannel.id,
          spliceEventId: 77201,
          durationSeconds: 30.0,
          prerollMs: 4000,
          uniqueProgramId: 101,
        },
      })

      expect(res.statusCode).toBe(200)
      const data = res.json()
      expect(data.success).toBe(true)
      expect(data.spliceEventId).toBe(77201)
      expect(data.prerollMs).toBe(4000)
      expect(data.scte35Hex).toBeDefined()
      expect(data.scte104Hex).toBeDefined()
      expect(data.vancLine).toBe(13)
    })

    it('POST /api/v1/external/control não confirma hardware não cadastrado', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/external/control',
        payload: {
          targetDevice: 'ATEM_SWITCHER',
          action: 'TAKE',
          params: { input: 2 },
          channelId: testChannel.id,
        },
      })

      expect(res.statusCode).toBe(200)
      const data = res.json()
      expect(data.success).toBe(false)
      expect(data.targetDevice).toBe('ATEM_SWITCHER')
      expect(data.action).toBe('TAKE')
    })
  })
})
