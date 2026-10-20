import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '../db/client.js'
import { Sources,scopedSourceList } from './sources.js'

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
  it('não elimina cadastros com mesmo endereço e filtra por canal sem alterar cache',async()=>{
    const child=probeChild();spawnMock.mockReturnValue(child)
    const sources=new Sources(fakeDb([{id:'a1',channelId:'a',kind:'NDI',targetUrl:'CAM',name:'Entrada São José',enabled:true},{id:'b1',channelId:'b',kind:'NDI',targetUrl:'ndi:CAM',name:'PRIVATE_OTHER_CHANNEL',enabled:true}]),'devices')
    const pending=sources.list();child.stdout.emit('data',Buffer.from(JSON.stringify(result())));child.emit('close',0)
    const list=await pending
    expect(list.ndi.sources).toHaveLength(3)
    expect(list.ndi.sources.map(row=>row.configuredId)).toEqual([undefined,'a1','b1'])
    const scoped=scopedSourceList(list,id=>id==='a','a')
    expect(scoped.ndi.sources.map(row=>row.label)).toEqual(['Câmera São João','Entrada São José'])
    expect(JSON.stringify(scoped)).not.toContain('PRIVATE_OTHER_CHANNEL');expect(list.ndi.sources).toHaveLength(3)
    expect(await sources.list()).toBe(list)
    const guest={...list,guests:{available:true,reason:null,sources:[{reference:'guest:PRIVATE',label:'PRIVATE',family:'GUEST' as const,channelId:'b'}]}}
    expect(scopedSourceList(guest,id=>id==='a').guests.sources).toEqual([])
  })
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
  it('resultado vencido volta na hora e a nova varredura roda em segundo plano; reescanear espera',async()=>{
    const first=probeChild(),second=probeChild(),third=probeChild()
    spawnMock.mockReturnValueOnce(first).mockReturnValueOnce(second).mockReturnValueOnce(third)
    const sources=new Sources(fakeDb(),'devices',1_000)
    const pending=sources.list();first.stdout.emit('data',Buffer.from(JSON.stringify(result())));first.emit('close',0)
    const initial=await pending
    await vi.advanceTimersByTimeAsync(1_001)
    expect(await sources.list()).toBe(initial)
    expect(spawnMock).toHaveBeenCalledTimes(2)
    expect(await sources.list()).toBe(initial) // same background scan, no third spawn
    expect(spawnMock).toHaveBeenCalledTimes(2)
    second.stdout.emit('data',Buffer.from(JSON.stringify({...result(),ndi:family([{reference:'ndi:NEW',label:'Nova'}])})));second.emit('close',0)
    await vi.advanceTimersByTimeAsync(0)
    expect((await sources.list()).ndi.sources.map(row=>row.reference)).toEqual(['ndi:NEW'])
    let settled=false
    const forced=sources.list(true).then(value=>{settled=true;return value})
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)
    third.stdout.emit('data',Buffer.from(JSON.stringify(result())));third.emit('close',0)
    expect((await forced).ndi.sources.map(row=>row.reference)).toEqual(['ndi:CAM'])
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
