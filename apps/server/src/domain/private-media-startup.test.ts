import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { spawn } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Channel } from '@rplayout/protocol'
import { EngineTransport } from './engine.js'
import { RelaySupervisor } from './relays.js'
import { engineProcessEnvironment, mediaProcessEnvironment } from './media-process-environment.js'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))
const secret = 'PRIVATE_PROCESS_CREDENTIAL'
const uri = `srt://127.0.0.1:61499?mode=caller&passphrase=${secret}`
const channel = { id: 'qa', name: 'QA', width: 320, height: 180, rate: { num: 25, den: 1 }, scan: 'PROGRESSIVE', fieldOrder: 'TFF', ceilingDbtp: -1 } as Channel
function processFixture() {
  const input: string[] = []
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(), exitCode: null })
  child.stdin.on('data', data => input.push(data.toString()))
  vi.mocked(spawn).mockReturnValueOnce(child as unknown as ReturnType<typeof spawn>)
  return { child, input }
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.mocked(spawn).mockReset() })

describe('endereços privados entre servidor e processos de mídia', () => {
  it.each([undefined, '', '0', 'true', ' 1 ', secret])('mantém software sem opt-in exato: %s', value => {
    const environment = { RPLAYOUT_HARDWARE_DECODE: value, RPLAYOUT_VAULT_KEY: secret, GST_PLUGIN_PATH: 'plugins' }
    expect(engineProcessEnvironment(environment)).toEqual({GST_PLUGIN_PATH:'plugins'})
  })
  it('encaminha opt-in canônico somente ao engine, sem herdar credenciais', () => {
    const environment = { rplayout_hardware_decode:'1', RPLAYOUT_CONTROL_TOKEN:secret, RPLAYOUT_ENGINE_OUTPUT:uri }
    expect(engineProcessEnvironment(environment)).toEqual({RPLAYOUT_HARDWARE_DECODE:'1'})
    expect(mediaProcessEnvironment(environment)).toEqual({})
  })
  it('inicialização real do supervisor passa opt-in ao spawn do engine', () => {
    vi.stubEnv('RPLAYOUT_HARDWARE_DECODE','1');vi.stubEnv('RPLAYOUT_CONTROL_TOKEN',secret)
    processFixture()
    const engine = new EngineTransport(channel, () => null, () => null, { binary:'own-fake-engine', outputs:[uri], preview:null, bitrateKbps:500 })
    try {
      expect(vi.mocked(spawn).mock.calls[0]?.[2]?.env).toHaveProperty('RPLAYOUT_HARDWARE_DECODE','1')
      expect(JSON.stringify(vi.mocked(spawn).mock.calls)).not.toContain(secret)
    }finally{engine.close()}
  })
  it('engine recebe saída/preview pelo pipe sem argv/ambiente com credenciais', () => {
    vi.stubEnv('RPLAYOUT_ENGINE_OUTPUT', uri); vi.stubEnv('RPLAYOUT_VAULT_KEY', secret)
    const fixture = processFixture()
    const engine = new EngineTransport(channel, () => null, () => null, { binary: 'own-fake-engine', outputs: [uri], preview: uri, bitrateKbps: 500 })
    try {
      expect(vi.mocked(spawn).mock.calls[0]?.[1]).toContain('--private-outputs-stdin')
      expect(JSON.stringify(vi.mocked(spawn).mock.calls)).not.toContain(secret)
      expect(JSON.parse(fixture.input[0]!)).toEqual({ outputs: [uri], preview: uri })
    } finally { engine.close() }
  })
  it('relay recebe conexão pelo pipe e repete configuração privada após falha', () => {
    vi.stubEnv('RPLAYOUT_CONTROL_TOKEN', secret)
    const first = processFixture(), second = processFixture(), supervisor = new RelaySupervisor('own-fake-relay')
    const target = { id: 'one', name: 'QA', source: 'rtsp://127.0.0.1/estúdio/pgm', url: uri }
    try {
      supervisor.sync([target])
      expect(JSON.parse(first.input[0]!)).toEqual({ from: target.source, to: uri })
      expect(first.child.stdin.writableEnded).toBe(true)
      first.child.emit('exit', 1)
      supervisor.tick(Date.now() + 40_000)
      expect(JSON.parse(second.input[0]!)).toEqual({ from: target.source, to: uri })
      expect(vi.mocked(spawn).mock.calls).toHaveLength(2)
      for (const call of vi.mocked(spawn).mock.calls) expect(call[1]).toEqual(['--private-connection-stdin'])
      expect(JSON.stringify(vi.mocked(spawn).mock.calls)).not.toContain(secret)
      expect(supervisor.status()[0]?.url).not.toContain(secret)
    } finally { supervisor.closeAll() }
  })
  it('watchdog do engine reenvia a configuração privada sem expor argv', () => {
    vi.useFakeTimers()
    const first = processFixture(), second = processFixture()
    const engine = new EngineTransport(channel, () => null, () => null, { binary: 'own-fake-engine', outputs: [uri], preview: null, bitrateKbps: 500 })
    try {
      first.child.emit('exit', 1, null)
      engine.watchdog(); vi.advanceTimersByTime(40_000); engine.watchdog()
      expect(JSON.parse(second.input[0]!)).toEqual({ outputs: [uri], preview: null })
      expect(vi.mocked(spawn).mock.calls).toHaveLength(2)
      expect(JSON.stringify(vi.mocked(spawn).mock.calls)).not.toContain(secret)
    } finally { engine.close(); vi.useRealTimers() }
  })
  it('pipe quebrado não derruba o servidor nem anuncia relay no ar', () => {
    const { child } = processFixture(), supervisor = new RelaySupervisor('own-fake-relay')
    supervisor.sync([{ id: 'one', name: 'QA', source: 'rtsp://127.0.0.1/pgm', url: uri }])
    expect(() => child.stdin.emit('error', new Error(secret))).not.toThrow()
    expect(child.kill).toHaveBeenCalledOnce()
    expect(supervisor.status()[0]).toMatchObject({ state: 'FALHOU', delivered: 0 })
    expect(JSON.stringify(supervisor.status())).not.toContain(secret)
    supervisor.closeAll()
  })
  it('não herda cofre/admin/token/destino e conserva runtime/encoder/GStreamer', () => {
    const result = mediaProcessEnvironment({ Path: 'runtime', GST_PLUGIN_PATH: 'plugins', RPLAYOUT_ENCODER: 'x264', rplayout_omt_runtime: 'libomt.dll', RPLAYOUT_VAULT_KEY: secret, RPLAYOUT_ADMIN_PASSWORD: secret, RPLAYOUT_CONTROL_TOKEN: secret, RPLAYOUT_ENGINE_OUTPUT: uri })
    expect(result).toEqual({ Path: 'runtime', GST_PLUGIN_PATH: 'plugins', RPLAYOUT_ENCODER: 'x264', rplayout_omt_runtime: 'libomt.dll' })
  })
})
