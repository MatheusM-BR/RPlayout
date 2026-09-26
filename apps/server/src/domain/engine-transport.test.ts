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
let commands: Array<{ id: number; cmd: string; item?: { itemId: string; path: string }; bus?: 'pgm' | 'pvw'; frames?: number }>
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
  it('faz preroll do próximo item e avança sem reabrir o arquivo', async () => {
    const first = join(directory, 'primeiro.mkv'); const second = join(directory, 'segundo.mkv')
    writeFileSync(first, 'video'); writeFileSync(second, 'video')
    start(view([first, second]))
    event({ event: 'ready', channelId: channel.id })
    await transport.take('grade', '0')

    transport.tick()
    await vi.waitFor(() => expect(transport.state().preparedItemId).toBe('1'))
    expect(commands.filter((command) => command.cmd === 'load').map((command) => command.item?.itemId)).toEqual(['0', '1'])

    event({ event: 'eos', itemId: '0' })
    await vi.waitFor(() => expect(transport.state().onAir?.itemId).toBe('1'))
    expect(commands.filter((command) => command.cmd === 'load').map((command) => command.item?.itemId)).toEqual(['0', '1'])
  })

  it('envia seek ao engine e atualiza a posição real do programa e preview', async () => {
    const good = join(directory, 'bom.mkv'); writeFileSync(good, 'video')
    start(view([good])); await transport.take('grade', '0')
    await transport.seek('pgm', 125)
    expect(commands.at(-1)).toMatchObject({ cmd: 'seek', bus: 'pgm', frames: 125 })
    expect(transport.state().onAir?.elapsed).toBe(125)
    await transport.cue({ kind: 'ITEM', id: '0' })
    event({ event: 'previewPosition', itemId: '0', frames: 50, duration: 250 })
    expect(transport.state().previewPosition).toEqual({ frames: 50, duration: 250 })
  })

  it('arma uma fonte ao vivo no preview e leva exatamente essa fonte ao PGM no TAKE', async () => {
    const live = {
      ...view(['']),
      items: [{
        item: { id: 'live-1', sourceRef: 'srt://127.0.0.1:9000?mode=listener', type: 'LIVE', autoNext: false },
        asset: null,
        trim: { in: 0, out: 0 },
        gainDb: 0,
      }],
      schedule: { items: [{ id: 'live-1', state: 'SCHEDULED', duration: 1500 }] },
    } as unknown as RundownView
    start(live)

    await transport.cue({ kind: 'ITEM', id: 'live-1' })
    expect(commands.at(-1)).toMatchObject({ cmd: 'preview', item: { itemId: 'live-1', source: 'srt://127.0.0.1:9000?mode=listener' } })
    expect(transport.state().preview).toEqual({ kind: 'ITEM', id: 'live-1' })

    await transport.take('grade', 'live-1')
    expect(commands.filter((command) => command.cmd === 'take')).toHaveLength(1)
    expect(transport.state().onAir?.itemId).toBe('live-1')
  })

  it('abre uma fonte direta no PVW sem tratá-la como asset do MAM', async () => {
    start(view([]))
    await transport.cue({ kind: 'SOURCE', source: 'ndi:ESTUDIO (vMix - Output 1)', title: 'Estúdio' })
    expect(commands.at(-1)).toMatchObject({
      cmd: 'preview', item: { itemId: 'source:ndi:ESTUDIO (vMix - Output 1)', source: 'ndi:ESTUDIO (vMix - Output 1)' },
    })
    expect(transport.state().preview).toEqual({ kind: 'SOURCE', source: 'ndi:ESTUDIO (vMix - Output 1)', title: 'Estúdio' })
  })

  it('encaminha a fonte OMT descoberta ao engine para diagnóstico ou recepção', async () => {
    start(view([]))
    await transport.cue({ kind: 'SOURCE', source: 'omt:nmos-camera-a', title: 'Câmera OMT' })
    expect(commands.at(-1)).toMatchObject({
      cmd: 'preview', item: { itemId: 'source:omt:nmos-camera-a', source: 'omt:nmos-camera-a' },
    })
    expect(transport.state().preview).toEqual({ kind: 'SOURCE', source: 'omt:nmos-camera-a', title: 'Câmera OMT' })
  })

  it('troca somente o publisher de uma saída de rede sem comandar stop ou load', async () => {
    start(view([]))
    await transport.reconfigureOutput({
      id: 'destino-rtmp', kind: 'rtmp', target: 'rtmp://cdn.example/live', bitrateKbps: 4000,
    })
    expect(commands).toHaveLength(1)
    expect(commands[0]).toMatchObject({
      cmd: 'replaceOutput', outputId: 'destino-rtmp',
      output: { id: 'destino-rtmp', kind: 'rtmp', target: 'rtmp://cdn.example/live' },
    })
  })
})
