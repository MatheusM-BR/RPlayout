/**
 * Achado 7 da revisão da r88-36: `await probeEncoders` atrasava em até 30 s a
 * subida dos canais. A sonda agora roda em segundo plano, com cache entre
 * partidas invalidado pelo binário, pelo GStreamer e pelo driver.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

const slow = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? '/tmp'}/rplayout-probe-${process.pid}-${Date.now()}`
  return { dir, binary: `${dir}/rplayout-encoders`, cache: `${dir}/cache.json` }
})
vi.mock('../config.js', async (original) => ({ ...await original<Record<string, unknown>>(), ENGINE_BINARY: '', MEDIAMTX_BINARY: '', DEVICES_BINARY: '', ENCODERS_BINARY: slow.binary, ENCODERS_CACHE_FILE: slow.cache }))

import { EncoderSessions, encoderProbeFingerprint, programHardwareSessions, startEncoderProbe, type EncoderProbe } from './encoder-sessions.js'
import { createApp } from '../app.js'

const geforce: EncoderProbe = { encoders: [{ name: 'nvh264enc', hardware: true, available: true, sessions: 5, unlimited: false }], hardware: 'nvh264enc', hardwareSessions: 5 }
const dirs: string[] = [slow.dir]
afterAll(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }) })
afterEach(() => { vi.restoreAllMocks() })

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'rplayout-probe-cache-')); dirs.push(dir)
  const binary = join(dir, 'rplayout-encoders'); writeFileSync(binary, 'versão 1')
  return { dir, binary, cacheFile: join(dir, 'sub', 'cache.json') }
}

describe('sonda de codificadores em segundo plano, com cache', () => {
  it('sem cache: capacidade 0 enquanto a sonda roda; depois vale e vira cache; a próxima partida nem roda a sonda', async () => {
    const { binary, cacheFile } = setup()
    const sessions = new EncoderSessions({ encoders: [], hardware: null, hardwareSessions: 0 }, () => 0)
    let finish!: (probe: EncoderProbe) => void
    const probe = vi.fn(() => new Promise<EncoderProbe>((resolve) => { finish = resolve }))
    const running = startEncoderProbe({ binary, cacheFile, sessions, programHardwareSessions: () => 0, probe, log: () => {} })
    await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(1))
    expect(sessions.status().total).toBe(0)
    expect(sessions.request({ channelId: 'a', bus: 'mon', tier: 'ref' })).toBe(false)
    finish(geforce)
    expect(await running).toBe('probe')
    expect(sessions.status().total).toBe(5)
    expect(JSON.parse(readFileSync(cacheFile, 'utf8')).probe.hardwareSessions).toBe(5)

    const again = new EncoderSessions({ encoders: [], hardware: null, hardwareSessions: 0 }, () => 0)
    const probe2 = vi.fn(async () => geforce)
    expect(await startEncoderProbe({ binary, cacheFile, sessions: again, programHardwareSessions: () => 0, probe: probe2, log: () => {} })).toBe('cache')
    expect(probe2).not.toHaveBeenCalled()
    expect(again.status().total).toBe(5)
  })

  it('cache invalidado quando muda o binário, o GStreamer ou o driver', async () => {
    const { binary } = setup()
    const base = await encoderProbeFingerprint(binary, {}, 'linux')
    expect(await encoderProbeFingerprint(binary, {}, 'linux')).toBe(base)
    expect(await encoderProbeFingerprint(binary, { GST_PLUGIN_PATH: '/opt/gst-1.26/plugins' }, 'linux')).not.toBe(base)
    writeFileSync(binary, 'versão 2')
    expect(await encoderProbeFingerprint(binary, {}, 'linux')).not.toBe(base)
    // Driver/GStreamer no Windows: as DLLs entram pela data e tamanho.
    const { dir } = setup()
    const system = join(dir, 'System32')
    const env = { SystemRoot: dir, GSTREAMER_1_0_ROOT_MSVC_X86_64: join(dir, 'gst') }
    const before = await encoderProbeFingerprint(binary, env, 'win32')
    mkdirSync(system, { recursive: true })
    writeFileSync(join(system, 'nvEncodeAPI64.dll'), 'driver 560')
    const driver = await encoderProbeFingerprint(binary, env, 'win32')
    expect(driver).not.toBe(before)
    mkdirSync(join(dir, 'gst', 'bin'), { recursive: true })
    writeFileSync(join(dir, 'gst', 'bin', 'gstreamer-1.0-0.dll'), 'gst 1.24')
    expect(await encoderProbeFingerprint(binary, env, 'win32')).not.toBe(driver)
  })

  it('sessões que o programa abriu durante a sonda são somadas de volta; sonda que falhou não vira cache', async () => {
    const { binary, cacheFile } = setup()
    const sessions = new EncoderSessions({ encoders: [], hardware: null, hardwareSessions: 0 }, () => 0)
    let programs = 0
    await startEncoderProbe({ binary, cacheFile, sessions, programHardwareSessions: () => programs, probe: async () => { programs = 2; return { ...geforce, hardwareSessions: 3 } }, log: () => {} })
    expect(sessions.status().total).toBe(5)
    expect(programHardwareSessions([
      { url: 'rtmp://x/a/pgm', health: 'onAir', attempts: 0, delivered: 1, encoder: 'nvh264enc' },
      { url: 'srt://x', health: 'onAir', attempts: 0, delivered: 1, encoder: 'x264enc' },
      { url: 'srt://x/a/mon', health: 'onAir', attempts: 0, delivered: 1, tiers: [{ tier: 'ref', health: 'onAir', encoder: 'nvh264enc', hardware: true, delivered: 1, uptimeMs: 1 }] },
    ])).toBe(1)
    const other = setup()
    await startEncoderProbe({ binary: other.binary, cacheFile: other.cacheFile, sessions, programHardwareSessions: () => 0, probe: async () => ({ encoders: [], hardware: null, hardwareSessions: 0 }), log: () => {} })
    expect(existsSync(other.cacheFile)).toBe(false)
  })

  it('a partida não espera a sonda: createApp volta antes de a sonda (lenta) terminar', async () => {
    mkdirSync(slow.dir, { recursive: true })
    writeFileSync(slow.binary, '#!/bin/sh\nsleep 4\necho \'{"encoders":[],"hardware":null,"hardwareSessions":0}\'\n'); chmodSync(slow.binary, 0o755)
    const started = Date.now()
    const app = await createApp(':memory:')
    try {
      expect(Date.now() - started).toBeLessThan(3_000)
      expect(app.encoderSessions!.status().total).toBe(0)
    } finally { app.close() }
  })
})
