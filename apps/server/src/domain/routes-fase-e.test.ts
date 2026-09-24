import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { createApp, type App } from '../app.js'
import { registerRoutes } from '../routes.js'
import {
  channels,
  rundowns,
  rundownItems,
  mediaAssets,
  graphicTemplates,
  itemGraphics,
} from '../db/schema.js'
import { globalConcurrencyManager } from './concurrency.js'
import type { Channel } from '@rplayout/protocol'

describe('Fase E — Timeline Visual Multicamada e Operação Distribuída', () => {
  let app: App
  let server: FastifyInstance

  const testChannel: Channel = {
    id: 'ch-fase-e',
    name: 'Canal Matriz HD',
    rate: { num: 30000, den: 1001 },
    width: 1920,
    height: 1080,
    scan: 'PROGRESSIVE',
    fieldOrder: 'TFF',
    targetLufs: -23,
    ceilingDbtp: -1,
    limiterLookaheadMs: 5,
    programSdiDeviceId: null,
    slateTemplateId: null,
    createdAt: new Date().toISOString(),
  }

  const testRundownId = 'rd-fase-e-01'

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

    await app.db.insert(rundowns).values({
      id: testRundownId,
      channelId: testChannel.id,
      name: 'Grade Operacional 24h',
      plannedStart: 0,
      loop: false,
      date: '2026-09-24',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    // Inserção de ativos e itens com categorias distintas
    await app.db.insert(mediaAssets).values([
      {
        id: 'asset-news-01',
        contentHash: 'hash-news-01',
        path: '/media/jornal_da_manha.mp4',
        title: 'Jornal da Manhã - Edição Matutina',
        kind: 'VIDEO',
        durationFrames: 1800, // 60 segundos
        loudnessFile: {
          integratedLufs: -23.0,
          lra: 5.0,
          truePeakDbtp: -1.5,
          scope: 'FILE',
          measuredAt: new Date().toISOString(),
        },
        createdAt: new Date().toISOString(),
      },
      {
        id: 'asset-comm-01',
        contentHash: 'hash-comm-01',
        path: '/media/break_comercial.mp4',
        title: 'Break Comercial Patrocínio',
        kind: 'VIDEO',
        durationFrames: 900, // 30 segundos
        loudnessFile: {
          integratedLufs: -23.2,
          lra: 3.5,
          truePeakDbtp: -1.2,
          scope: 'FILE',
          measuredAt: new Date().toISOString(),
        },
        createdAt: new Date().toISOString(),
      },
      {
        id: 'asset-filler-01',
        contentHash: 'hash-filler-01',
        path: '/media/institucional_contingencia.mp4',
        title: 'Promo Institucional de Verão',
        kind: 'VIDEO',
        categoryId: 'FILLER',
        durationFrames: 900,
        createdAt: new Date().toISOString(),
      },
    ])

    // Template gráfico para CG
    await app.db.insert(graphicTemplates).values({
      id: 'tpl-lower-01',
      channelId: testChannel.id,
      name: 'Lower Third Entrevistado',
      svg: '<svg></svg>',
      fields: [{ key: 'title', label: 'Nome', defaultValue: 'Apresentador' }],
      fadeMs: 500,
      holdSeconds: 6,
      createdAt: new Date().toISOString(),
    })

    // Itens:
    // Item 1: Notícias (0 a 1800 frames = 0s a 60s)
    // Item 2: Comercial (1800 a 2700 frames = 60s a 90s)
    // Gap proposital: Item 3 agendado com FIXED em 3600 frames (120s) -> Gap de 900 frames (30s)
    await app.db.insert(rundownItems).values([
      {
        id: 'item-01',
        rundownId: testRundownId,
        sortOrder: 0,
        type: 'VT',
        eventType: 'SEQUENTIAL',
        title: 'Jornal da Manhã - Edição Matutina',
        mediaId: 'asset-news-01',
        minDuration: 100,
        durationOverride: 1800,
        anchor: { kind: 'FLOW' },
        onOverrun: 'PUSH',
        locked: false,
        autoNext: true,
        loop: false,
      },
      {
        id: 'item-02',
        rundownId: testRundownId,
        sortOrder: 1,
        type: 'COMMERCIAL',
        eventType: 'SEQUENTIAL',
        title: 'Break Comercial Patrocínio',
        mediaId: 'asset-comm-01',
        minDuration: 100,
        durationOverride: 900,
        anchor: { kind: 'FLOW' },
        onOverrun: 'PUSH',
        locked: false,
        autoNext: true,
        loop: false,
      },
      {
        id: 'item-03',
        rundownId: testRundownId,
        sortOrder: 2,
        type: 'LIVE',
        eventType: 'LIVE',
        title: 'Transmissão Ao Vivo Estúdio',
        minDuration: 100,
        durationOverride: 1800,
        anchor: { kind: 'FIXED', at: 3600 },
        onOverrun: 'PUSH',
        locked: false,
        autoNext: true,
        loop: false,
      },
    ])

    // Evento secundário de grafismo no Item 1 aos 5 segundos
    await app.db.insert(itemGraphics).values({
      id: 'gfx-01',
      itemId: 'item-01',
      templateId: 'tpl-lower-01',
      values: { title: 'Rodrigo MCR' },
      atSeconds: 5,
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

  describe('Cenário 1: Timeline Multicamada (Tracks 1 a 4) e Níveis de Zoom', () => {
    it('retorna estrutura completa das 4 pistas da timeline 24h com ETag', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/timeline/${testRundownId}/multitrack?zoom=ZOOM_1H`,
      })

      expect(response.statusCode).toBe(200)
      const data = response.json()

      expect(data.rundownId).toBe(testRundownId)
      expect(response.headers.etag).toBeDefined()
      expect(data.tracks).toHaveLength(4)

      // Pista 1: Master Video / PGM
      const track1 = data.tracks.find((t: any) => t.type === 'MASTER_VIDEO')
      expect(track1).toBeDefined()
      expect(track1.items.length).toBeGreaterThanOrEqual(3)

      const newsItem = track1.items.find((it: any) => it.id === 'item-01')
      expect(newsItem.category).toBe('NEWS')
      expect(newsItem.colorHex).toBe('#2563EB')

      const commItem = track1.items.find((it: any) => it.id === 'item-02')
      expect(commItem.category).toBe('COMMERCIAL')
      expect(commItem.colorHex).toBe('#EA580C')

      const liveItem = track1.items.find((it: any) => it.id === 'item-03')
      expect(liveItem.category).toBe('LIVE')
      expect(liveItem.colorHex).toBe('#DC2626')

      // Verificação da detecção de GAP na Pista 1
      const gapMarker = track1.items.find((it: any) => it.isGap === true)
      expect(gapMarker).toBeDefined()
      expect(gapMarker.category).toBe('GAP')
      expect(gapMarker.colorHex).toBe('#EAB308')
      expect(gapMarker.label).toContain('GAP:')
      expect(data.gapCount).toBeGreaterThanOrEqual(1)

      // Pista 2: Secondary Events / CG
      const track2 = data.tracks.find((t: any) => t.type === 'SECONDARY_EVENTS')
      expect(track2).toBeDefined()
      expect(track2.items.length).toBeGreaterThanOrEqual(1)
      const cgItem = track2.items[0]
      expect(cgItem.type).toBe('CG_EVENT')
      expect(cgItem.label).toContain('Rodrigo MCR')

      // Pista 3: SCTE-35 / DPI
      const track3 = data.tracks.find((t: any) => t.type === 'SCTE35_DPI')
      expect(track3).toBeDefined()
      const cueOut = track3.items.find((it: any) => it.id.includes('cue-out'))
      const cueIn = track3.items.find((it: any) => it.id.includes('cue-in'))
      expect(cueOut).toBeDefined()
      expect(cueOut.colorHex).toBe('#D946EF')
      expect(cueIn).toBeDefined()
      expect(cueIn.colorHex).toBe('#A21CAF')

      // Pista 4: Audio Loudness Envelope (EBU R128)
      const track4 = data.tracks.find((t: any) => t.type === 'AUDIO_LOUDNESS')
      expect(track4).toBeDefined()
      expect(track4.loudnessPoints.length).toBeGreaterThan(0)
      const r128Point = track4.loudnessPoints[0]
      expect(r128Point.lufsIntegrated).toBeCloseTo(-23.0, 0.5)

      // Viewport e Zoom
      expect(data.viewport).toBeDefined()
      expect(data.viewport.zoomLevel).toBe('ZOOM_1H')
      expect(data.viewport.pixelsPerMillisecond).toBeGreaterThan(0)
    })

    it('suporta consulta de timeline por alias de tenant e channel', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/tenants/t-brasil/channels/${testChannel.id}/timeline?zoom=ZOOM_24H`,
      })

      expect(response.statusCode).toBe(200)
      const data = response.json()
      expect(data.channelId).toBe(testChannel.id)
      expect(data.viewport.zoomLevel).toBe('ZOOM_24H')
    })
  })

  describe('Cenário 2: Autofill Inteligente de Gap em 1-Clique', () => {
    it('insere automaticamente ativo de preenchimento para zerar gap identificado', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/rundowns/${testRundownId}/autofill-gap`,
        payload: {
          gapDurationMs: 30000,
          preferredCategory: 'FILLER',
        },
      })

      expect(response.statusCode).toBe(200)
      const result = response.json()
      expect(result.success).toBe(true)
      expect(result.strategyApplied).toBe('INSERT_OPTIMAL_FILLER')
      expect(result.insertedItemId).toBeDefined()
      expect(result.newRundownVersion).toBeGreaterThan(1)

      // Valida que o item de autofill agora existe na grade
      const checkResponse = await server.inject({
        method: 'GET',
        url: `/api/v1/timeline/${testRundownId}/multitrack`,
      })
      const checkData = checkResponse.json()
      const track1 = checkData.tracks.find((t: any) => t.type === 'MASTER_VIDEO')
      const autofillItem = track1.items.find((it: any) => it.id === result.insertedItemId)
      expect(autofillItem).toBeDefined()
      expect(autofillItem.label).toContain('[AUTOFILL]')
    })
  })

  describe('Cenário 3: Edição Concorrente, Soft Locks e Detecção de 409 Conflict', () => {
    it('gerencia bloqueio de linha (soft lock) e impede bloqueio simultâneo por outro operador', async () => {
      // Operador A adquire lock na linha item-01
      const lockA = await server.inject({
        method: 'POST',
        url: `/api/v1/rundowns/${testRundownId}/acquire-lock`,
        payload: {
          itemId: 'item-01',
          userId: 'user-mcr-01',
          userName: 'Carlos MCR',
        },
      })
      expect(lockA.statusCode).toBe(200)
      expect(lockA.json().lockState.lineLocks['item-01']).toBe('user-mcr-01')

      // Operador B tenta adquirir lock na mesma linha -> 409 Conflict
      const lockB = await server.inject({
        method: 'POST',
        url: `/api/v1/rundowns/${testRundownId}/acquire-lock`,
        payload: {
          itemId: 'item-01',
          userId: 'user-traffic-02',
          userName: 'Rodrigo Tráfego',
        },
      })
      expect(lockB.statusCode).toBe(409)
      expect(lockB.json().error).toContain('bloqueada pelo usuário Carlos MCR')

      // Operador A libera o lock
      const releaseA = await server.inject({
        method: 'POST',
        url: `/api/v1/rundowns/${testRundownId}/release-lock`,
        payload: {
          itemId: 'item-01',
          userId: 'user-mcr-01',
        },
      })
      expect(releaseA.statusCode).toBe(200)

      // Operador B agora consegue adquirir o lock
      const lockB2 = await server.inject({
        method: 'POST',
        url: `/api/v1/rundowns/${testRundownId}/acquire-lock`,
        payload: {
          itemId: 'item-01',
          userId: 'user-traffic-02',
          userName: 'Rodrigo Tráfego',
        },
      })
      expect(lockB2.statusCode).toBe(200)
    })

    it('detecta conflito de versão otimista e retorna HTTP 409 estruturado para o Conflict Drawer', async () => {
      const currentRVer = globalConcurrencyManager.getRundownVersion(testRundownId)

      // Operador A salva alteração com sucesso
      const updateA = await server.inject({
        method: 'PUT',
        url: `/api/v1/rundowns/${testRundownId}/items/item-01`,
        payload: {
          expectedRundownVersion: currentRVer,
          patch: { title: 'Jornal Atualizado por Tráfego' },
        },
      })
      expect(updateA.statusCode).toBe(200)
      expect(updateA.json().item.title).toBe('Jornal Atualizado por Tráfego')
      expect(updateA.headers.etag).toBeDefined()

      // Operador B, que tinha aberto a grade na versão antiga, tenta atualizar com versão defasada
      const updateB = await server.inject({
        method: 'PUT',
        url: `/api/v1/rundowns/${testRundownId}/items/item-01`,
        headers: {
          'if-match': `w/"${currentRVer}"`,
        },
        payload: {
          expectedRundownVersion: currentRVer,
          patch: { title: 'Tentativa Concorrente do MCR' },
        },
      })

      // Backend DEVE recusar com 409 Conflict estruturado para o Conflict Drawer
      expect(updateB.statusCode).toBe(409)
      const conflictPayload = updateB.json()
      expect(conflictPayload.error).toBe('OPTIMISTIC_LOCK_CONFLICT')
      expect(conflictPayload.conflictId).toBeDefined()
      expect(conflictPayload.currentRundownVersion).toBeGreaterThan(currentRVer)
      expect(conflictPayload.serverItemState.title).toBe('Jornal Atualizado por Tráfego')
    })

    it('resolve conflito concorrente através do endpoint de merge assistido (Conflict Drawer)', async () => {
      const currentRVer = globalConcurrencyManager.getRundownVersion(testRundownId)

      // Operador opta por resolver aplicando mesclagem assistida dos campos
      const resolveResponse = await server.inject({
        method: 'POST',
        url: `/api/v1/rundowns/${testRundownId}/resolve-conflict`,
        payload: {
          itemId: 'item-01',
          clientRundownVersion: currentRVer,
          resolutionStrategy: 'APPLY_MERGED_FIELDS',
          mergedData: {
            title: 'Jornal da Manhã - Edição Mesclada',
            trimmable: true,
            notes: 'Conflito resolvido colaborativamente entre MCR e Tráfego',
          },
        },
      })

      expect(resolveResponse.statusCode).toBe(200)
      const result = resolveResponse.json()
      expect(result.success).toBe(true)
      expect(result.resolvedData.title).toBe('Jornal da Manhã - Edição Mesclada')
      expect(result.resolvedData.notes).toContain('Conflito resolvido')
      expect(result.newRundownVersion).toBeGreaterThan(currentRVer)
    })

    it('suporta estratégias OVERWRITE_FORCE e DISCARD_MINE na resolução de conflito', async () => {
      const vBefore = globalConcurrencyManager.getRundownVersion(testRundownId)

      // Estratégia DISCARD_MINE: mantém dados do servidor
      const discardRes = await server.inject({
        method: 'POST',
        url: `/api/v1/rundowns/${testRundownId}/resolve-conflict`,
        payload: {
          itemId: 'item-01',
          clientRundownVersion: vBefore,
          resolutionStrategy: 'DISCARD_MINE',
          patch: { title: 'Ignorado' },
        },
      })
      expect(discardRes.statusCode).toBe(200)
      expect(discardRes.json().resolvedData.title).toBe('Jornal da Manhã - Edição Mesclada')

      // Estratégia OVERWRITE_FORCE: força a versão do cliente
      const forceRes = await server.inject({
        method: 'POST',
        url: `/api/v1/rundowns/${testRundownId}/resolve-conflict`,
        payload: {
          itemId: 'item-01',
          clientRundownVersion: discardRes.json().newRundownVersion,
          resolutionStrategy: 'OVERWRITE_FORCE',
          patch: { title: 'Jornal Forçado pelo MCR' },
        },
      })
      expect(forceRes.statusCode).toBe(200)
      expect(forceRes.json().resolvedData.title).toBe('Jornal Forçado pelo MCR')
    })

    it('emite eventos de foco via pub/sub para presença em tempo real', async () => {
      const receivedEvents: any[] = []
      const unsubscribe = globalConcurrencyManager.subscribe((ev) => {
        receivedEvents.push(ev)
      })

      await server.inject({
        method: 'POST',
        url: `/api/v1/rundowns/${testRundownId}/acquire-lock`,
        payload: {
          itemId: 'item-02',
          userId: 'user-collab-01',
          userName: 'Marina Jornalismo',
        },
      })

      unsubscribe()
      expect(receivedEvents.length).toBeGreaterThan(0)
      const focusEv = receivedEvents.find((e) => e.type === 'RUNDOWN_USER_FOCUS')
      expect(focusEv).toBeDefined()
      expect(focusEv.userName).toBe('Marina Jornalismo')
      expect(focusEv.itemId).toBe('item-02')
    })
  })
})
