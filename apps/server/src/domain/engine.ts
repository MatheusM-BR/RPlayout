import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import {
  framesSinceMidnight,
  type Channel,
  type Frames,
  type OnAirState,
  type PreviewTarget,
} from '@rplayout/protocol'
import type { MeterReading } from './meters.js'
import { SILENCE } from './meters.js'
import type { RundownView } from './plan.js'
import type { Transport, TransportState } from './transport.js'

/** O que o engine precisa saber para pôr um item no ar. */
interface EngineItem {
  itemId: string
  path: string
  trimIn: Frames
  trimOut: Frames
  gainDb: number
}

type EngineEvent =
  | { event: 'ready'; channelId: string }
  | { event: 'ack'; id: number; ok: boolean; error?: string }
  | { event: 'state'; onAir?: string; armed?: string }
  | { event: 'position'; itemId: string; frames: number; duration: number }
  | { event: 'eos'; itemId: string }
  | { event: 'levels'; peak: number[]; rms: number[] }
  | { event: 'output'; frames: number }
  | { event: 'error'; message: string }

export interface EngineOptions {
  /** Caminho do binário do engine. */
  readonly binary: string
  /** Saídas do canal, no formato que o engine entende. */
  readonly outputs: readonly string[]
  readonly bitrateKbps: number
}

/**
 * Transporte apoiado no engine de verdade.
 *
 * Cumpre o mesmo contrato do simulado, então rota e interface não sabem qual
 * dos dois está no comando. A diferença é que aqui o tempo não é calculado:
 * ele é reportado por quem está de fato tocando o arquivo.
 */
export class EngineTransport implements Transport {
  private readonly child: ChildProcess
  private nextId = 1
  private rundownId: string | null = null
  private onAirItemId: string | null = null
  private armedItemId: string | null = null
  private elapsed: Frames = 0
  private preview: PreviewTarget | null = null
  private meter: MeterReading | null = null
  private dirty = false
  private alive = true
  /** Último erro do engine, para a interface não ficar adivinhando. */
  lastError: string | null = null

  constructor(
    private readonly channel: Channel,
    private readonly view: () => RundownView | null,
    options: EngineOptions,
  ) {
    const args = [
      '--channel-id',
      channel.id,
      '--width',
      String(channel.width),
      '--height',
      String(channel.height),
      '--fps-num',
      String(channel.rate.num),
      '--fps-den',
      String(channel.rate.den),
      '--bitrate',
      String(options.bitrateKbps),
    ]
    for (const output of options.outputs) args.push('--output', output)

    this.child = spawn(options.binary, args, { stdio: ['pipe', 'pipe', 'pipe'] })

    if (this.child.stdout) {
      createInterface({ input: this.child.stdout }).on('line', (line) => this.absorb(line))
    }
    // O engine loga no stderr de propósito, para nunca sujar o canal de dados.
    this.child.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(`[engine ${channel.name}] ${chunk.toString()}`)
    })
    this.child.on('exit', (code) => {
      this.alive = false
      this.lastError = `O engine encerrou com código ${code ?? 'desconhecido'}.`
      this.dirty = true
    })
  }

  private absorb(line: string): void {
    if (line.trim() === '') return

    let event: EngineEvent
    try {
      event = JSON.parse(line) as EngineEvent
    } catch {
      return
    }

    switch (event.event) {
      case 'state':
        this.onAirItemId = event.onAir ?? null
        this.armedItemId = event.armed ?? null
        this.dirty = true
        break
      case 'position':
        // A posição é a fonte da verdade sobre quanto já foi ao ar.
        this.elapsed = event.frames
        break
      case 'eos':
        this.advanceAfter(event.itemId)
        break
      case 'levels':
        this.meter = toMeter(event.peak, event.rms)
        break
      case 'ack':
        if (!event.ok && event.error) this.lastError = event.error
        break
      case 'error':
        this.lastError = event.message
        break
      default:
        break
    }
  }

  private send(command: Record<string, unknown>): void {
    if (!this.alive) return
    this.child.stdin?.write(`${JSON.stringify({ id: this.nextId++, ...command })}\n`)
  }

  /** Traduz um item da grade para o que o engine sabe abrir. */
  private specFor(itemId: string): EngineItem | null {
    const view = this.view()
    const entry = view?.items.find((candidate) => candidate.item.id === itemId)
    if (!entry?.asset) return null

    return {
      itemId,
      path: entry.asset.path,
      trimIn: entry.trim.in,
      trimOut: entry.trim.out,
      gainDb: entry.gainDb,
    }
  }

  /** Deixa o próximo item aberto e parado, para o take seguinte ser imediato. */
  private preload(afterItemId: string): void {
    const view = this.view()
    if (!view) return

    const index = view.items.findIndex((entry) => entry.item.id === afterItemId)
    if (index < 0) return

    const next = view.items
      .slice(index + 1)
      .find(
        (entry) =>
          view.schedule.items.find((row) => row.id === entry.item.id)?.state !== 'DROPPED',
      )
    const candidate = next ?? (view.rundown.loop ? view.items[0] : undefined)
    if (!candidate) return

    const spec = this.specFor(candidate.item.id)
    if (spec) this.send({ cmd: 'load', item: spec })
  }

  private advanceAfter(itemId: string): void {
    const view = this.view()
    if (!view) return

    const index = view.items.findIndex((entry) => entry.item.id === itemId)
    if (index < 0) return

    const current = view.items[index]
    if (current && !current.item.autoNext) {
      this.send({ cmd: 'stop' })
      this.onAirItemId = null
      this.dirty = true
      return
    }

    const next = view.items
      .slice(index + 1)
      .find(
        (entry) =>
          view.schedule.items.find((row) => row.id === entry.item.id)?.state !== 'DROPPED',
      )
    // Programação não acaba: chegou no fim, volta para o topo.
    const candidate = next ?? (view.rundown.loop ? view.items[0] : undefined)
    if (!candidate) {
      this.send({ cmd: 'stop' })
      this.onAirItemId = null
      this.dirty = true
      return
    }

    this.take(view.rundown.id, candidate.item.id)
  }

  state(): TransportState {
    const onAir: OnAirState | null = this.onAirItemId
      ? {
          itemId: this.onAirItemId,
          startedAt: framesSinceMidnight(new Date(), this.channel.rate) - this.elapsed,
          elapsed: this.elapsed,
        }
      : null

    return {
      channelId: this.channel.id,
      rundownId: this.rundownId,
      onAir,
      preview: this.preview,
      playing: this.onAirItemId !== null,
      standby: this.onAirItemId === null && this.preview?.kind === 'ITEM',
    }
  }

  take(rundownId: string, itemId: string): void {
    const spec = this.specFor(itemId)
    if (!spec) {
      this.lastError = 'Este item não tem arquivo para o engine abrir.'
      return
    }

    this.rundownId = rundownId
    // Se já estava armado, o load é dispensável e o take sai na hora.
    if (this.armedItemId !== itemId) this.send({ cmd: 'load', item: spec })
    this.send({ cmd: 'take' })

    this.onAirItemId = itemId
    this.elapsed = 0
    this.preview = null
    this.dirty = true
    this.preload(itemId)
  }

  cue(target: PreviewTarget | null): void {
    this.preview = target
    this.dirty = true

    // Armar item da grade também arma no engine: o take seguinte não paga o
    // preço de abrir o arquivo.
    if (target?.kind === 'ITEM') {
      const spec = this.specFor(target.id)
      if (spec && this.armedItemId !== target.id) this.send({ cmd: 'load', item: spec })
    }
  }

  stop(): void {
    if (this.onAirItemId) this.preview = { kind: 'ITEM', id: this.onAirItemId }
    this.send({ cmd: 'stop' })
    this.onAirItemId = null
    this.elapsed = 0
    this.dirty = true
  }

  park(itemId: string): void {
    this.send({ cmd: 'stop' })
    this.onAirItemId = null
    this.elapsed = 0
    this.cue({ kind: 'ITEM', id: itemId })
  }

  tick(): boolean {
    const changed = this.dirty
    this.dirty = false
    return changed
  }

  programMeter(): MeterReading | null {
    return this.meter
  }

  close(): void {
    this.send({ cmd: 'shutdown' })
    this.alive = false
    setTimeout(() => this.child.kill(), 1000).unref()
  }
}

/**
 * Converte a medição do engine para o formato do medidor.
 *
 * O `level` do GStreamer entrega pico e RMS em dBFS, não loudness. Enquanto a
 * medição R128 em tempo real não existe no pipeline, o campo de loudness leva o
 * RMS — que é uma aproximação, e está marcado como tal para ninguém tomar por
 * conformidade.
 */
function toMeter(peak: number[], rms: number[]): MeterReading {
  if (peak.length === 0) return SILENCE

  const loudest = Math.max(...peak)
  const average = rms.length > 0 ? Math.max(...rms) : loudest

  return {
    peakDbfs: peak,
    momentaryLufs: average,
    shortTermLufs: average,
    integratedLufs: average,
    truePeakDbtp: loudest,
    // Ainda não há limiter no pipeline, então não há redução de ganho a medir.
    gainReductionDb: 0,
    correlation: 1,
  }
}
