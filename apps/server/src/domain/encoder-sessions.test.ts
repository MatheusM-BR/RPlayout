import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EncoderSessions, probeEncoders, programEncodedOutputs, type EncoderProbe } from './encoder-sessions.js'
import { validateOutputProfile, monitorProfilePatch, type OutputProfileRow } from './outputs.js'
import type { PublisherState } from './transport.js'
import { createApp, runtimeFor, serviceMonitorHardware, serviceMonitors, type App } from '../app.js'
import { channels } from '../db/schema.js'

vi.mock('../config.js', async original => ({ ...await original<Record<string, unknown>>(), ENGINE_BINARY: '', MEDIAMTX_BINARY: '', DEVICES_BINARY: '', ENCODERS_BINARY: '' }))

const geforce: EncoderProbe = { encoders: [{ name: 'nvh264enc', hardware: true, available: true, sessions: 8, unlimited: false }], hardware: 'nvh264enc', hardwareSessions: 8 }
const quadro: EncoderProbe = { encoders: [{ name: 'nvh264enc', hardware: true, available: true, sessions: 12, unlimited: true }], hardware: 'nvh264enc', hardwareSessions: null }
const none: EncoderProbe = { encoders: [{ name: 'x264enc', hardware: false, available: true, sessions: null, unlimited: true }], hardware: null, hardwareSessions: 0 }
const key = (channelId: string, bus: string, tier: 'ref' | 'std' | 'lite') => ({ channelId, bus, tier })
/** Linhas `publisher` exatamente como o engine Rust as serializa. */
const engineFixture = (): PublisherState[] => readFileSync(new URL('./__fixtures__/engine-hardware-failed.jsonl', import.meta.url), 'utf8')
  .trim().split('\n').map((line) => { const { event, ...report } = JSON.parse(line) as { event: string } & PublisherState; expect(event).toBe('publisher'); return report })

describe('sessões de placa: programa primeiro, monitores com o que sobra', () => {
  it('GeForce com 8 sessões e 6 saídas de programa empresta só 2 aos monitores', () => {
    const sessions = new EncoderSessions(geforce, () => 6)
    expect(sessions.request(key('a', 'mon', 'ref'))).toBe(true)
    expect(sessions.request(key('a', 'pvw', 'std'))).toBe(true)
    expect(sessions.request(key('b', 'mon', 'ref'))).toBe(false)
    expect(sessions.status()).toMatchObject({ total: 8, reservedForProgram: 6, monitorsInUse: 2, free: 0 })
    sessions.release(key('a', 'mon', 'ref'))
    expect(sessions.request(key('b', 'mon', 'ref'))).toBe(true)
  })

  it('canal novo no ar aumenta a reserva: monitor novo não ganha sessão, o já concedido fica até sair', () => {
    let programs = 6
    const sessions = new EncoderSessions(geforce, () => programs)
    expect(sessions.request(key('a', 'mon', 'ref'))).toBe(true)
    programs = 8
    expect(sessions.request(key('a', 'pvw', 'ref'))).toBe(false)
    expect(sessions.status().free).toBe(0)
  })

  it('o leve nunca pede placa; sem placa ninguém ganha; Quadro não tem limite', () => {
    expect(new EncoderSessions(geforce, () => 0).request(key('a', 'mon', 'lite'))).toBe(false)
    expect(new EncoderSessions(none, () => 0).request(key('a', 'mon', 'ref'))).toBe(false)
    const unlimited = new EncoderSessions(quadro, () => 40)
    for (let i = 0; i < 30; i++) expect(unlimited.request(key(`c${i}`, 'mon', 'ref'))).toBe(true)
    expect(unlimited.status().free).toBeNull()
  })

  it('relatório REAL do engine (fixture gerada pelo Rust): hardwareFailed ensina a capacidade', () => {
    // Gerada por monitor_bench::relatorio_real_de_falha_de_placa_vira_fixture_do_servidor.
    // O engine não põe nada em `degraded` quando a placa falha: o servidor antigo
    // dependia de casar texto em `degraded` e nunca aprendia.
    const [monitor] = engineFixture()
    expect(monitor!.tiers![0]!.degraded).toBeUndefined()
    expect(monitor!.tiers![0]!.hardwareFailed).toMatch(/session/)
    const sessions = new EncoderSessions(geforce, () => 6)
    sessions.request(key('canal-a', 'mon', 'std'))
    sessions.request(key('canal-a', 'mon', 'ref'))
    sessions.observe('canal-a', 'mon', monitor!)
    expect(sessions.has(key('canal-a', 'mon', 'std'))).toBe(false)
    expect(sessions.has(key('canal-a', 'mon', 'ref'))).toBe(true)
    expect(sessions.status()).toMatchObject({ total: 7, monitorsInUse: 1, free: 0 })
    expect(sessions.status().learned).toMatch(/capacidade ajustada para 7/)
  })

  it('devolução ao programa (sem hardwareFailed) devolve a sessão mas não ensina capacidade', () => {
    const sessions = new EncoderSessions(geforce, () => 6)
    sessions.request(key('a', 'mon', 'ref'))
    sessions.observe('a', 'mon', { url: 'srt://x/a/mon', health: 'onAir', attempts: 0, delivered: 1,
      tiers: [{ tier: 'ref', health: 'onAir', encoder: 'x264enc', hardware: false, delivered: 1, uptimeMs: 1, degraded: 'placa devolvida ao programa' }] })
    expect(sessions.has(key('a', 'mon', 'ref'))).toBe(false)
    expect(sessions.status().total).toBe(8)
  })

  it('nível concedido que o engine relata em x264 devolve a sessão e ensina o limite real', () => {
    const sessions = new EncoderSessions(geforce, () => 6)
    sessions.request(key('a', 'mon', 'ref'))
    sessions.request(key('a', 'mon', 'std'))
    const report: PublisherState = {
      url: 'srt://127.0.0.1:8890?streamid=publish:a/mon', health: 'onAir', attempts: 0, delivered: 9,
      tiers: [
        { tier: 'ref', health: 'onAir', encoder: 'x264enc', hardware: false, delivered: 1, uptimeMs: 10, degraded: undefined, error: 'nvh264enc: placa falhou (session)' },
        { tier: 'std', health: 'onAir', encoder: 'nvh264enc', hardware: true, delivered: 1, uptimeMs: 10 },
      ],
    }
    sessions.observe('a', 'mon', { ...report, tiers: [{ ...report.tiers![0]!, hardwareFailed: 'nvh264enc: session' }, report.tiers![1]!] })
    expect(sessions.has(key('a', 'mon', 'ref'))).toBe(false)
    expect(sessions.has(key('a', 'mon', 'std'))).toBe(true)
    expect(sessions.status().total).toBe(7)
    expect(sessions.status().learned).toMatch(/capacidade ajustada para 7/)
  })

  it('reserva conta saídas codificadas de verdade, não monitores, QC parado nem NDI', () => {
    const base = { attempts: 0, delivered: 0 }
    const list: PublisherState[] = [
      { ...base, url: 'rtmp://127.0.0.1:1935/a/pgm', health: 'onAir' },
      { ...base, url: 'srt://destino:9000', health: 'retrying' },
      { ...base, url: 'ndi:PGM', health: 'onAir' },
      { ...base, url: 'srt://127.0.0.1:8890?streamid=publish:a/mon', health: 'onAir', tiers: [{ tier: 'std', health: 'onAir', hardware: false, delivered: 0, uptimeMs: 0 }] },
      { ...base, url: 'srt://127.0.0.1:8890?streamid=publish:a/pvw', health: 'idle' },
      { ...base, outputId: 'qc-inspection', url: 'srt://127.0.0.1:8890?streamid=publish:a/qc', health: 'onAir' },
    ]
    expect(programEncodedOutputs(list)).toBe(2)
  })

  it('sonda ausente ou quebrada é "sem placa", nunca derruba a partida', async () => {
    expect(await probeEncoders('')).toMatchObject({ hardwareSessions: 0 })
    expect(await probeEncoders('/nao/existe/rplayout-encoders')).toMatchObject({ hardwareSessions: 0 })
  })
})

describe('proteção do perfil de monitor (sem limite artificial)', () => {
  const row = (patch: Partial<OutputProfileRow>): OutputProfileRow => ({
    id: 'm', channelId: 'c', name: 'Monitor', kind: 'RTMP', target: '', role: 'MONITOR', width: null, height: null,
    rateNum: null, rateDen: null, scan: null, bitrateKbps: null, enabled: true, createdAt: 'now', ...patch,
  })
  const channel = { width: 1920, height: 1080, rate: { num: 25, den: 1 }, scan: 'INTERLACED' as const }

  it('aceita automático, 1080p na cadência de campo e 8 Mbps', () => {
    expect(() => validateOutputProfile(row({}), channel)).not.toThrow()
    expect(() => validateOutputProfile(row({ width: 1920, height: 1080, rateNum: 50, rateDen: 1, bitrateKbps: 8000, scan: 'PROGRESSIVE' }), channel)).not.toThrow()
    expect(() => validateOutputProfile(row({ role: 'PREVIEW', width: 1280, height: 720, bitrateKbps: 3000 }), channel)).not.toThrow()
  })

  it('recusa o que faria do monitor uma saída de programa disfarçada', () => {
    expect(() => validateOutputProfile(row({ bitrateKbps: 12000 }), channel)).toThrow(/8000/)
    expect(() => validateOutputProfile(row({ width: 3840, height: 2160 }), { ...channel, width: 3840, height: 2160 })).toThrow(/1920×1080/)
    expect(() => validateOutputProfile(row({ rateNum: 60, rateDen: 1 }), channel)).toThrow(/cadência/)
    expect(() => validateOutputProfile(row({ scan: 'INTERLACED' }), channel)).toThrow(/progressivo/)
    expect(() => validateOutputProfile(row({ width: 1280 }), channel)).toThrow(/juntas/)
  })

  it('perfil legado forçado (240p/15/450) volta a automático; teto do operador fica', () => {
    expect(monitorProfilePatch(row({ width: 428, height: 240, rateNum: 15, rateDen: 1, bitrateKbps: 450, scan: 'PROGRESSIVE' }), channel))
      .toEqual({ width: null, height: null, rateNum: null, rateDen: null, scan: null, bitrateKbps: null })
    expect(monitorProfilePatch(row({ width: 1280, height: 720, bitrateKbps: 3000 }), channel)).toEqual({})
    expect(monitorProfilePatch(row({ bitrateKbps: 20000 }), channel)).toEqual({ bitrateKbps: 8000 })
  })
})

describe('runtime: um pedido por nível, concessão de placa e desligamento', () => {
  let app: App
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 20, 19, 0, 0))
    app = await createApp(':memory:')
    app.db.insert(channels).values({ id: 'ch', name: 'Monitor QA', rateNum: 25, rateDen: 1, width: 1920, height: 1080, targetLufs: -23, ceilingDbtp: -1, limiterLookaheadMs: 5, createdAt: new Date().toISOString() }).run()
  })
  afterEach(() => { app.close(); vi.useRealTimers() })

  it('REF ganha placa, PADRÃO fica em x264 quando acabam as sessões, e ambos desligam após 20 s', async () => {
    const runtime = (await runtimeFor(app, 'ch'))!
    ;(runtime as unknown as { monitores: Set<string> }).monitores.add('mon')
    app.encoderSessions!.setProbe({ ...geforce, hardwareSessions: 1 })
    const set = vi.spyOn(runtime.transport, 'setMonitor').mockImplementation(() => {})
    runtime.watching('mon', 'ref')
    runtime.watching('mon', 'std')
    expect(set).toHaveBeenNthCalledWith(1, 'mon', true, 'ref', true, expect.any(Number))
    expect(set).toHaveBeenNthCalledWith(2, 'mon', true, 'std', false, expect.any(Number))
    expect(runtime.monitorTiersWatched().map((t) => `${t.tier}:${t.hardware}`).sort()).toEqual(['ref:true', 'std:false'])
    vi.setSystemTime(Date.now() + 21_000)
    ;(runtime as unknown as { podarMonitores(): void }).podarMonitores()
    expect(set).toHaveBeenCalledWith('mon', false, 'ref', false)
    expect(set).toHaveBeenCalledWith('mon', false, 'std', false)
    expect(app.encoderSessions!.status().monitorsInUse).toBe(0)
  })

  it('recusa da placa no programa do canal B (relatório real) revoga a placa dos monitores do canal A, via servidor', async () => {
    app.db.insert(channels).values({ id: 'chb', name: 'Canal B', rateNum: 25, rateDen: 1, width: 1920, height: 1080, targetLufs: -23, ceilingDbtp: -1, limiterLookaheadMs: 5, createdAt: new Date().toISOString() }).run()
    const a = (await runtimeFor(app, 'ch'))!
    const b = (await runtimeFor(app, 'chb'))!
    ;(a as unknown as { monitores: Set<string> }).monitores.add('mon')
    app.encoderSessions!.setProbe(geforce)
    const setA = vi.spyOn(a.transport, 'setMonitor').mockImplementation(() => {})
    a.watching('mon', 'ref')
    expect(setA).toHaveBeenLastCalledWith('mon', true, 'ref', true, expect.any(Number))
    const retry = vi.fn()
    ;(b.transport as unknown as { retryHardware: () => void }).retryHardware = retry
    const [, program] = engineFixture()
    expect(program!.hardwareRefusals).toBe(1)
    vi.spyOn(b.transport, 'publishers').mockReturnValue([program!])
    serviceMonitorHardware(app)
    expect(setA).toHaveBeenLastCalledWith('mon', true, 'ref', false, expect.any(Number))
    expect(app.encoderSessions!.status().monitorsInUse).toBe(0)
    expect(retry).toHaveBeenCalledTimes(1)
    expect(a.monitorTiersWatched().find((t) => t.tier === 'ref')?.hardware).toBe(false)
    // A mesma recusa não revoga de novo; uma nova, sem nada a revogar, não pede retry inútil.
    serviceMonitorHardware(app)
    vi.spyOn(b.transport, 'publishers').mockReturnValue([{ ...program!, hardwareRefusals: 2 }])
    serviceMonitorHardware(app)
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('sem nenhum navegador conectado (live() nunca chamado), 20 s sem heartbeat desligam o nível e devolvem placa e CPU', async () => {
    const runtime = (await runtimeFor(app, 'ch'))!
    ;(runtime as unknown as { monitores: Set<string> }).monitores.add('mon').add('pvw')
    app.encoderSessions!.setProbe(geforce)
    const set = vi.spyOn(runtime.transport, 'setMonitor').mockImplementation(() => {})
    const live = vi.spyOn(runtime, 'live')
    runtime.watching('mon', 'ref')
    runtime.watching('pvw')
    expect(app.encoderSessions!.status().monitorsInUse).toBe(1)
    vi.setSystemTime(Date.now() + 10_000)
    serviceMonitors(app)
    expect(set).not.toHaveBeenCalledWith('mon', false, 'ref', false)
    vi.setSystemTime(Date.now() + 11_000)
    serviceMonitors(app)
    expect(live).not.toHaveBeenCalled()
    expect(set).toHaveBeenCalledWith('mon', false, 'ref', false)
    expect(set).toHaveBeenCalledWith('pvw', false)
    expect(app.encoderSessions!.status()).toMatchObject({ monitorsInUse: 0, software: { inUseMpx: 0 } })
  })

  it('o laço do servidor chama o serviço dos monitores fora do "if" de audiência, e live() não poda mais', () => {
    const index = readFileSync(new URL('../index.ts', import.meta.url), 'utf8')
    const call = index.indexOf('serviceMonitors(app)')
    const audience = index.indexOf('if (sockets.size > 0)')
    expect(call).toBeGreaterThan(0)
    expect(audience).toBeGreaterThan(call)
    // A chamada está no topo do ciclo, antes do laço por canal (que tem `return`s).
    expect(index.slice(call, audience)).toContain('for (const runtime of app.runtimes.values())')
    const appSource = readFileSync(new URL('../app.ts', import.meta.url), 'utf8')
    const liveBody = appSource.slice(appSource.indexOf('  live() {'), appSource.indexOf('  live() {') + 200)
    expect(liveBody).not.toContain('podarMonitores')
  })

  it('pedido sem nível continua sendo o leve no caminho histórico', async () => {
    const runtime = (await runtimeFor(app, 'ch'))!
    ;(runtime as unknown as { monitores: Set<string> }).monitores.add('pvw')
    const set = vi.spyOn(runtime.transport, 'setMonitor').mockImplementation(() => {})
    runtime.watching('pvw')
    expect(set).toHaveBeenLastCalledWith('pvw', true)
  })

  it('multiview composto (mv): mesmos níveis, mesma concessão de placa, rebaixado ao teto do mosaico', async () => {
    const runtime = (await runtimeFor(app, 'ch'))!
    ;(runtime as unknown as { monitores: Set<string> }).monitores.add('mv')
    app.encoderSessions!.setProbe({ ...geforce, hardwareSessions: 1 })
    const set = vi.spyOn(runtime.transport, 'setMonitor').mockImplementation(() => {})
    // Teto padrão do mosaico: PADRÃO. Quem pede REF recebe PADRÃO.
    expect(runtime.multiviewCeiling()).toBe('std')
    expect(runtime.watching('mv', 'ref')).toBe('std')
    expect(set).toHaveBeenLastCalledWith('mv', true, 'std', true, expect.any(Number))
    expect(app.encoderSessions!.status().grants).toEqual([{ channelId: 'ch', bus: 'mv', tier: 'std' }])
    // A sessão do mosaico conta no orçamento da placa: o PGM em PADRÃO fica em x264.
    ;(runtime as unknown as { monitores: Set<string> }).monitores.add('mon')
    runtime.watching('mon', 'std')
    expect(set).toHaveBeenLastCalledWith('mon', true, 'std', false, expect.any(Number))
    // O engine relatou o nível do mosaico em software (placa recusou): a sessão volta.
    vi.spyOn(runtime.transport, 'publishers').mockReturnValue([{ url: 'srt://127.0.0.1:8890?streamid=publish:ch/mv', health: 'onAir', attempts: 0, delivered: 1,
      tiers: [{ tier: 'std', health: 'onAir', encoder: 'x264enc', hardware: false, delivered: 1, uptimeMs: 1 }] }])
    ;(runtime as unknown as { podarMonitores(): void }).podarMonitores()
    expect(app.encoderSessions!.status().monitorsInUse).toBe(0)
    // Teto LEVE: tudo vira o leve, no caminho histórico do mosaico.
    runtime.multiviewComposition = { layout: 'MV_2X2', quality: 'LEVE', cells: [] }
    expect(runtime.watching('mv', 'std')).toBe('lite')
    expect(set).toHaveBeenLastCalledWith('mv', true)
    expect(runtime.monitorTiersWatched().some((t) => t.bus === 'mv' && t.tier === 'lite')).toBe(true)
  })
})

describe('orçamento de CPU dos monitores em software: da máquina, não do processo', () => {
  // Escada que o engine publica (`ladders`) para um canal 1080p25: REF cheio,
  // geometria do PADRÃO e o LEVE (Mpx/s).
  const ladders = [
    { tier: 'ref' as const, mpx: [51.84, 23.04, 2.568] },
    { tier: 'std' as const, mpx: [23.04, 2.568] },
    { tier: 'lite' as const, mpx: [2.568] },
  ]
  const publisher = (channel: string, bus: string): PublisherState => ({ url: `srt://127.0.0.1:8890?streamid=publish:${channel}/${bus}`, health: 'idle', attempts: 0, delivered: 0, ladders })

  it('soma os Mpx/s de todos os canais: o segundo canal recebe o degrau que cabe no que sobra', () => {
    const sessions = new EncoderSessions(none, () => 0, 60)
    expect(sessions.requestSoftware(key('a', 'mon', 'ref'), ladders[0]!.mpx)).toBe(51.84)
    expect(sessions.requestSoftware(key('b', 'mon', 'ref'), ladders[0]!.mpx)).toBe(2.568)
    expect(sessions.requestSoftware(key('b', 'mv', 'std'), ladders[1]!.mpx)).toBe(2.568)
    expect(sessions.status().software.inUseMpx).toBeCloseTo(51.84 + 2 * 2.568)
    // O mesmo nível pedido de novo não reserva duas vezes.
    expect(sessions.requestSoftware(key('a', 'mon', 'ref'), ladders[0]!.mpx)).toBe(51.84)
    sessions.releaseSoftware(key('a', 'mon', 'ref'))
    expect(sessions.requestSoftware(key('c', 'pvw', 'std'), ladders[1]!.mpx)).toBe(23.04)
    // Na placa só consulta: não reserva.
    expect(sessions.requestSoftware(key('c', 'pvw', 'ref'), ladders[0]!.mpx, false)).toBe(23.04)
    expect(sessions.hasSoftware(key('c', 'pvw', 'ref'))).toBe(false)
  })

  it('sem escada (engine acabou de subir) reserva o que sobra até o relatório dizer o perfil real', () => {
    const sessions = new EncoderSessions(none, () => 0, 60)
    expect(sessions.requestSoftware(key('a', 'mon', 'ref'), null)).toBe(60)
    expect(sessions.requestSoftware(key('b', 'mon', 'std'), ladders[1]!.mpx)).toBe(2.568)
    sessions.observe('a', 'mon', { ...publisher('a', 'mon'), health: 'onAir', tiers: [{ tier: 'ref', health: 'onAir', encoder: 'x264enc', hardware: false, delivered: 1, uptimeMs: 1, profile: { width: 1280, height: 720, fpsN: 25, fpsD: 1, bitrateKbps: 2000, quality: 20 } }] })
    expect(sessions.status().software.inUseMpx).toBeCloseTo(23.04 + 2.568)
  })

  it('placa que cai para x264 passa a contar o perfil real em software', () => {
    const sessions = new EncoderSessions(geforce, () => 0, 60)
    sessions.request(key('a', 'mon', 'ref'))
    sessions.observe('a', 'mon', { ...publisher('a', 'mon'), health: 'onAir', tiers: [{ tier: 'ref', health: 'onAir', encoder: 'x264enc', hardware: false, delivered: 1, uptimeMs: 1, hardwareFailed: 'session', profile: { width: 1920, height: 1080, fpsN: 25, fpsD: 1, bitrateKbps: 4000, quality: 20 } }] })
    expect(sessions.status().software.grants).toEqual([{ channelId: 'a', bus: 'mon', tier: 'ref', mpx: 51.84 }])
  })

  describe('runtime: dois canais, um orçamento', () => {
    let app: App
    beforeEach(async () => {
      vi.stubEnv('RPLAYOUT_MONITOR_SW_MPX', '60')
      vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 20, 19, 0, 0))
      app = await createApp(':memory:')
      for (const id of ['ca', 'cb']) app.db.insert(channels).values({ id, name: `Canal ${id}`, rateNum: 25, rateDen: 1, width: 1920, height: 1080, targetLufs: -23, ceilingDbtp: -1, limiterLookaheadMs: 5, createdAt: new Date().toISOString() }).run()
    })
    afterEach(() => { app.close(); vi.useRealTimers(); vi.unstubAllEnvs() })

    it('REF de dois canais em software: o primeiro abre cheio, o segundo desce; o mv entra na conta; o desligamento devolve', async () => {
      const a = (await runtimeFor(app, 'ca'))!, b = (await runtimeFor(app, 'cb'))!
      expect(app.encoderSessions!.softwareBudgetMpx).toBe(60)
      for (const runtime of [a, b]) {
        ;(runtime as unknown as { monitores: Set<string> }).monitores.add('mon').add('mv')
        vi.spyOn(runtime.transport, 'publishers').mockReturnValue([publisher(runtime.channel.id, 'mon'), publisher(runtime.channel.id, 'mv')])
      }
      const setA = vi.spyOn(a.transport, 'setMonitor').mockImplementation(() => {})
      const setB = vi.spyOn(b.transport, 'setMonitor').mockImplementation(() => {})
      a.watching('mon', 'ref')
      expect(setA).toHaveBeenLastCalledWith('mon', true, 'ref', false, 51.84)
      b.watching('mon', 'ref')
      expect(setB).toHaveBeenLastCalledWith('mon', true, 'ref', false, 2.568)
      // Multiview (teto PADRÃO) do canal B: conta no mesmo orçamento.
      b.watching('mv', 'std')
      expect(setB).toHaveBeenLastCalledWith('mv', true, 'std', false, 2.568)
      expect(app.encoderSessions!.status().software.inUseMpx).toBeLessThanOrEqual(60)
      // A reafirmação a cada 5 s repete o mesmo orçamento (o engine não reabre).
      vi.setSystemTime(Date.now() + 6_000)
      b.watching('mon', 'ref')
      expect(setB).toHaveBeenLastCalledWith('mon', true, 'ref', false, 2.568)
      // 20 s sem olhar o REF do canal A: devolve os 51,84 Mpx/s.
      vi.setSystemTime(Date.now() + 15_000)
      b.watching('mon', 'ref'); b.watching('mv', 'std')
      ;(a as unknown as { podarMonitores(): void }).podarMonitores()
      expect(app.encoderSessions!.status().software.inUseMpx).toBeCloseTo(2 * 2.568)
    })
  })
})
