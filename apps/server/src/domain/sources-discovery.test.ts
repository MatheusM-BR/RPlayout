import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '../db/client.js'
import { Sources } from './sources.js'

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: spawnMock }))

function probeChild() {
  return Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn() })
}
function fakeDb(saved: object[] = []) {
  let query = 0
  return { select: () => ({ from: () => ({ where: async () => query++ === 0 ? [] : saved }) }) } as unknown as Db
}
const family = (sources: object[] = []) => ({ available: true, sources })
function result() {
  return {
    decklink: family([{ reference: 'sdi:0', label: 'DeckLink Capture' }]),
    decklinkOutputs: family([{ reference: 'sdi:2', label: 'DeckLink Output' }]),
    ndi: family([{ reference: 'ndi:CAM', label: 'Câmera São João' }]), omt: family(),
  }
}

beforeEach(() => { spawnMock.mockReset(); vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('descoberta real de dispositivos', () => {
  it('separa entrada e saída, preserva Unicode mesmo dividido entre buffers', async () => {
    const child = probeChild()
    spawnMock.mockReturnValue(child)
    const sources = new Sources(fakeDb(), 'devices')
    const pending = sources.list()
    const bytes = Buffer.from(JSON.stringify(result()))
    const split = bytes.indexOf(Buffer.from('â')) + 1
    child.stdout.emit('data', bytes.subarray(0, split))
    child.stdout.emit('data', bytes.subarray(split))
    child.emit('close', 0)
    const list = await pending
    expect(list.sdi.sources.map((s) => s.reference)).toEqual(['sdi:0'])
    expect(list.sdiOutputs.sources.map((s) => s.reference)).toEqual(['sdi:2'])
    expect(list.ndi.sources[0]).toMatchObject({ label: 'Câmera São João', discovery: 'DISCOVERED' })
    expect(await sources.list()).toBe(list)
    expect(spawnMock).toHaveBeenCalledTimes(1)
  })
  it('cadastro manual não vira prova de placa ou runtime instalado', async () => {
    const child = probeChild()
    spawnMock.mockReturnValue(child)
    const pending = new Sources(fakeDb([{ kind: 'SDI', targetUrl: 'sdi:7', name: 'Salva', enabled: true }]), 'devices').list()
    child.stdout.emit('data', Buffer.from(JSON.stringify({ ...result(), decklink: { available: false, reason: 'Plugin ausente', sources: [] } })))
    child.emit('close', 0)
    const list = await pending
    expect(list.sdi.available).toBe(false)
    expect(list.sdi.reason).toBe('Plugin ausente')
    expect(list.sdi.sources[0]).toMatchObject({ reference: 'sdi:7', discovery: 'CONFIGURED' })
  })
  it('encerra a própria descoberta travada e informa tempo limite', async () => {
    const child = probeChild()
    spawnMock.mockReturnValue(child)
    const pending = new Sources(fakeDb(), 'devices', 15_000, 100).list()
    await vi.advanceTimersByTimeAsync(100)
    expect((await pending).sdi.reason).toContain('tempo limite')
    expect(child.kill).toHaveBeenCalledOnce()
  })
  it('expõe falha de runtime em vez de afirmar que não existe placa', async () => {
    const child = probeChild()
    spawnMock.mockReturnValue(child)
    const pending = new Sources(fakeDb(), 'devices').list()
    child.stderr.emit('data', Buffer.from('GStreamer não inicializou'))
    child.emit('close', 1)
    expect((await pending).sdi.reason).toContain('GStreamer não inicializou')
  })
  it('rejeita resposta inválida e informa necessidade de atualizar o pacote', async () => {
    const child = probeChild()
    spawnMock.mockReturnValue(child)
    const pending = new Sources(fakeDb(), 'devices').list()
    child.stdout.emit('data', Buffer.from('{"decklink":{}}'))
    child.emit('close', 0)
    expect((await pending).sdi.reason).toContain('dados inválidos')
  })
})
