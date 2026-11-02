import { describe, expect, it } from 'vitest'
import {
  FailoverManager,
  SrtManager,
  DEFAULT_FAILOVER_CONFIG,
  createLiveSource,
  getLiveSource,
  listLiveSources,
  updateLiveSource,
  deleteLiveSource,
  getMultiviewConfig,
  saveMultiviewConfig,
  type LiveSourceRecord,
} from './srt.js'
import { openDatabase } from '../db/client.js'
import { channels } from '../db/schema.js'

describe('FailoverManager', () => {
  const dummySource: LiveSourceRecord = {
    id: 'src-1',
    channelId: 'ch-1',
    name: 'Link Externa Mochila',
    kind: 'SRT',
    targetUrl: 'srt://198.51.100.10:9000?mode=caller',
    srtConfig: { mode: 'caller', host: '198.51.100.10', port: 9000, latencyMs: 800 },
    role: 'PRIMARY',
    pairedSourceId: 'src-2',
    autoFailover: true,
    failoverConfig: {
      autoFailover: true,
      maxLossPercent: 15.0,
      maxTimeoutMs: 1500,
      maxRttMs: 2400,
      switchDelayMs: 120,
    },
    enabled: true,
    createdAt: new Date().toISOString(),
  }

  it('permanece no PRIMARY quando telemetria está OPTIMAL', () => {
    const manager = new FailoverManager()
    const result = manager.evaluateHealth(dummySource, {
      rttMs: 45,
      packetLossPercent: 0.1,
      bitrateKbps: 4500,
      packetsDropped: 0,
      packetsRetransmitted: 2,
      linkState: 'OPTIMAL',
      reconnectCount: 0,
    })
    expect(result.switchNeeded).toBe(false)
  })

  it('dispara comutação para BACKUP quando sinal está DISCONNECTED', () => {
    const manager = new FailoverManager()
    const result = manager.evaluateHealth(dummySource, {
      rttMs: 0,
      packetLossPercent: 100,
      bitrateKbps: 0,
      packetsDropped: 200,
      packetsRetransmitted: 0,
      linkState: 'DISCONNECTED',
      reconnectCount: 3,
    })
    expect(result.switchNeeded).toBe(true)
    expect(result.targetRole).toBe('BACKUP')
    expect(result.reason).toContain('desconectado ou ausente')
  })

  it('dispara comutação para BACKUP quando perda de pacotes ultrapassa teto contratado', () => {
    const manager = new FailoverManager()
    const result = manager.evaluateHealth(dummySource, {
      rttMs: 120,
      packetLossPercent: 18.5,
      bitrateKbps: 3200,
      packetsDropped: 80,
      packetsRetransmitted: 40,
      linkState: 'CRITICAL',
      reconnectCount: 0,
    })
    expect(result.switchNeeded).toBe(true)
    expect(result.targetRole).toBe('BACKUP')
    expect(result.reason).toContain('Perda de pacotes crítica')
  })

  it('dispara comutação para BACKUP quando RTT estoura o limite', () => {
    const manager = new FailoverManager()
    const result = manager.evaluateHealth(dummySource, {
      rttMs: 2600,
      packetLossPercent: 2.0,
      bitrateKbps: 3500,
      packetsDropped: 5,
      packetsRetransmitted: 10,
      linkState: 'CRITICAL',
      reconnectCount: 0,
    })
    expect(result.switchNeeded).toBe(true)
    expect(result.targetRole).toBe('BACKUP')
    expect(result.reason).toContain('RTT excedeu tolerância limite')
  })

  it('respeita histerese para auto-revert quando primário volta ao estado OPTIMAL', () => {
    const manager = new FailoverManager()
    manager.setActiveRole(dummySource.id, 'BACKUP')

    const t0 = 1000000
    // Imediatamente após voltar a OPTIMAL, ainda não deve reverter (< 30s)
    let evalRes = manager.evaluateHealth(
      dummySource,
      {
        rttMs: 40,
        packetLossPercent: 0,
        bitrateKbps: 5000,
        packetsDropped: 0,
        packetsRetransmitted: 0,
        linkState: 'OPTIMAL',
        reconnectCount: 0,
      },
      t0,
      30000,
    )
    expect(evalRes.switchNeeded).toBe(false)

    // Após 31 segundos contínuos em OPTIMAL, deve disparar Auto-Revert
    evalRes = manager.evaluateHealth(
      dummySource,
      {
        rttMs: 40,
        packetLossPercent: 0,
        bitrateKbps: 5000,
        packetsDropped: 0,
        packetsRetransmitted: 0,
        linkState: 'OPTIMAL',
        reconnectCount: 0,
      },
      t0 + 31000,
      30000,
    )
    expect(evalRes.switchNeeded).toBe(true)
    expect(evalRes.targetRole).toBe('PRIMARY')
    expect(evalRes.reason).toContain('Auto-Revert')
  })

  it('triggerSwitch notifica listeners e armazena estado', () => {
    const manager = new FailoverManager()
    let capturedEvent: any = null
    manager.onFailover((evt) => {
      capturedEvent = evt
    })

    const event = manager.triggerSwitch(dummySource, 'BACKUP', 'Interrupção manual pelo operador', {
      operator: 'master_operator',
      automatic: false,
    })

    expect(event.fromRole).toBe('PRIMARY')
    expect(event.toRole).toBe('BACKUP')
    expect(event.operator).toBe('master_operator')
    expect(capturedEvent).toEqual(event)
    expect(manager.getActiveRole(dummySource.id)).toBe('BACKUP')
  })
})

describe('SrtManager Telemetry Cache', () => {
  it('registra e consulta telemetrias com timestamp automático', () => {
    const srt = new SrtManager()
    srt.recordTelemetry('src-1', {
      rttMs: 65,
      packetLossPercent: 0.5,
      bitrateKbps: 4200,
      packetsDropped: 0,
      packetsRetransmitted: 5,
      linkState: 'OPTIMAL',
      reconnectCount: 0,
    })

    const tel = srt.getTelemetry('src-1')
    expect(tel).toBeDefined()
    expect(tel?.rttMs).toBe(65)
    expect(tel?.timestamp).toBeDefined()

    const all = srt.getAllTelemetry()
    expect(all['src-1']).toBeDefined()

    srt.clearTelemetry('src-1')
    expect(srt.getTelemetry('src-1')).toBeUndefined()
  })
})

describe('LiveSources SQLite Repository', () => {
  it('persiste fontes ao vivo, sanitiza senha e executa CRUD', async () => {
    const { db } = await openDatabase(':memory:')

    await db.insert(channels).values({
      id: 'ch-test',
      name: 'Canal Teste',
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

    const created = await createLiveSource(db, {
      channelId: 'ch-test',
      name: 'Link Mochila Jornalismo',
      kind: 'SRT',
      srtConfig: {
        mode: 'caller',
        host: '10.0.0.5',
        port: 9100,
        latencyMs: 1000,
        passphrase: 'UltraSecretPassphrase123!',
        pbkeylen: 32,
      },
      role: 'PRIMARY',
      autoFailover: true,
    })

    expect(created.id).toBeDefined()
    expect(created.targetUrl).toContain('srt://10.0.0.5:9100?')
    // Senha na resposta padrão deve vir mascarada
    expect(created.srtConfig?.passphrase).not.toBe('UltraSecretPassphrase123!')
    expect(created.srtConfig?.passphrase).toContain('•••')

    // getLiveSource
    const fetched = await getLiveSource(db, created.id)
    expect(fetched?.name).toBe('Link Mochila Jornalismo')
    expect(fetched?.srtConfig?.passphrase).toContain('•••')

    // updateLiveSource
    const updated = await updateLiveSource(db, created.id, {
      name: 'Link Mochila Jornalismo (Atualizado)',
    })
    expect(updated?.name).toBe('Link Mochila Jornalismo (Atualizado)')

    // listLiveSources
    const list = await listLiveSources(db, 'ch-test')
    expect(list.length).toBe(1)
    expect(list[0]?.id).toBe(created.id)

    // deleteLiveSource
    await deleteLiveSource(db, created.id)
    const afterDelete = await getLiveSource(db, created.id)
    expect(afterDelete).toBeNull()
  })

  it('salva e recupera configuração de Multiview', async () => {
    const { db } = await openDatabase(':memory:')

    const saved = await saveMultiviewConfig(db, 'ch-test', 'GRID_1_PLUS_3', [
      {
        id: 'cell-1',
        name: 'Estúdio 1',
        sourceUrl: 'ndi:Studio1',
        tally: 'ON_AIR',
        audioPeakDb: [-18, -18],
        syncState: 'LOCKED',
      },
    ])

    expect(saved.layout).toBe('GRID_1_PLUS_3')
    expect(saved.cells.length).toBe(1)

    const retrieved = await getMultiviewConfig(db, 'ch-test')
    expect(retrieved.layout).toBe('GRID_1_PLUS_3')
    expect(retrieved.cells[0]?.name).toBe('Estúdio 1')
  })
})
