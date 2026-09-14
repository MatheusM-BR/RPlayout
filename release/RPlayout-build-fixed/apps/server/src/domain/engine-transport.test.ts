import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Channel } from '@rplayout/protocol'
import { EngineTransport } from './engine.js'
import type { RundownView } from './plan.js'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))

const channel = { id: 'channel', name: 'Test', width: 320, height: 180,
  rate: { num: 25, den: 1 }, scan: 'PROGRESSIVE', fieldOrder: 'TFF', ceilingDbtp: -1 } as Channel
let directory: string
let transport: EngineTransport
let child: EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> }
let commands: Array<{ id: number; cmd: string; item?: { itemId: string; path: string } }>
let onAir: string | undefined
let armed: string | undefined
let rejectLoad: string | null
let holdLoad: boolean

function event(value: object): void { child.stdout.write(JSON.stringify(value) + '\n') }
function ack(id: number, ok = true): void { event({ event: 'ack', id, ok, error: ok ? undefined : 'decoder recusou o arquivo' }) }
function view(paths: string[], loop = false): RundownView {
  return {
    channel, rundown: { id: 'grade', channelId: channel.id, loop },
    items: paths.map((path, index) => ({ item: { id: String(index), autoNext: true, audioTrack: 0 },
      asset: { id: String(index), path, kind: 'VIDEO', probeError: null }, trim: { in: 0, out: 250 }, gainDb: 0 })),
    schedule: { items: paths.map((_, index) => ({ id: String(index), state: 'SCHEDULED', duration: 250 })) },
  } as unknown as RundownView
}
function start(value: RundownView): void {
  transport = new EngineTransport(channel, () => value, () => null,
    { binary: 'fake-engine', outputs: ['null'], preview: null, bitrateKbps: 500 })
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'playout-transport-'))
  commands = []; onAir = undefined; armed = undefined; rejectLoad = null; holdLoad = false
  child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() })
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)
  child.stdin.on('data', (data: Buffer) => {
    const command = JSON.parse(data.toString()) as typeof commands[number]
    commands.push(command)
    queueMicrotask(() => {
      if (command.cmd === 'load' && holdLoad) return
      if (command.cmd === 'load' && command.item?.path === rejectLoad) { armed = undefined; ack(command.id, false); return }
      if (command.cmd === 'load') armed = command.item?.itemId
      if (command.cmd === 'take') { onAir = armed; armed = undefined }
      if (command.cmd === 'stop') onAir = undefined
      event({ event: 'state', onAir, armed })
      ack(command.id)
    })
  })
})
afterEach(() => { transport?.close(); rmSync(directory, { recursive: true, force: true }); vi.restoreAllMocks() })

describe('transporte real confirmado pelo engine', () => {
  it('pula arquivo ausente e só envia take depois de load confirmado', async () => {
    const good = join(directory, 'bom.mkv'); writeFileSync(good, 'video')
    start(view([join(directory, 'sumiu.mkv'), good]))
    await transport.take('grade', '0')
    expect(commands.filter((c) => c.cmd === 'load').map((c) => c.item?.itemId)).toEqual(['1'])
    expect(commands.map((c) => c.cmd)).toEqual(['load', 'take', 'preview'])
    expect(transport.state().onAir?.itemId).toBe('1')
  })
  it('não anuncia no ar nem dispara take enquanto load está pendente', async () => {
    const good = join(directory, 'bom.mkv'); writeFileSync(good, 'video'); holdLoad = true
    start(view([good]))
    const action = transport.take('grade', '0')
    await vi.waitFor(() => expect(commands).toHaveLength(1))
    expect(transport.state().onAir).toBeNull()
    armed = '0'; event({ event: 'state', armed }); ack(commands[0]!.id)
    await action
    expect(transport.state().onAir?.itemId).toBe('0')
  })
  it('recusa do decoder não dispara take no arquivo errado e avança para o válido', async () => {
    const bad = join(directory, 'corrompido.mkv'); const good = join(directory, 'bom.mkv')
    writeFileSync(bad, 'x'); writeFileSync(good, 'video'); rejectLoad = bad
    start(view([bad, good], true)); await transport.take('grade', '0')
    expect(commands.map((c) => c.cmd)).toEqual(['load', 'load', 'take', 'preview'])
    expect(transport.state().onAir?.itemId).toBe('1')
  })
  it('grade em loop sem arquivos termina a tentativa sem loop de comandos', async () => {
    start(view([join(directory, 'ausente.mkv')], true))
    await expect(transport.take('grade', '0')).rejects.toThrow('Nenhum item reproduzível')
    expect(commands).toHaveLength(0)
    expect(transport.state().playing).toBe(false)
  })
  it('erro ao iniciar executável não derruba o servidor', () => {
    start(view([])); child.emit('error', new Error('ENOENT'))
    expect(transport.health().error).toContain('ENOENT')
  })
  it('não mata engine em preroll só porque o relatório de quadros está bloqueado', async () => {
    const good = join(directory, 'bom.mkv'); writeFileSync(good, 'video'); holdLoad = true
    start(view([good])); event({ event: 'output', frames: 100 }); transport.watchdog()
    const action = transport.take('grade', '0')
    await vi.waitFor(() => expect(commands).toHaveLength(1))
    let now = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => now)
    for (let i = 0; i < 100; i++) { now += 50; transport.watchdog() }
    expect(child.kill).not.toHaveBeenCalled()
    armed = '0'; event({ event: 'state', armed }); ack(commands[0]!.id); await action
  })
})
