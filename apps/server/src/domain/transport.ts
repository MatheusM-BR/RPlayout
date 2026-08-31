import { framesSinceMidnight, type Frames, type OnAirState } from '@rplayout/protocol'
import type { RundownView } from './plan.js'

export interface TransportState {
  readonly channelId: string
  readonly rundownId: string | null
  readonly onAir: OnAirState | null
  /** Item aberto no preview. Independente do que está no ar. */
  readonly previewItemId: string | null
  readonly playing: boolean
}

/**
 * Transporte simulado da F1.
 *
 * O engine ainda não existe, então quem faz o tempo andar é o relógio do
 * sistema. O contrato é o mesmo que o engine vai cumprir depois: o servidor
 * pergunta o estado, nunca calcula duração por conta própria.
 */
export class SimulatedTransport {
  private rundownId: string | null = null
  private onAirItemId: string | null = null
  private startedAt: Frames = 0
  private previewItemId: string | null = null
  private playing = false

  constructor(
    private readonly channelId: string,
    /** Devolve a grade resolvida agora — é dela que sai a duração de cada item. */
    private readonly view: () => RundownView | null,
  ) {}

  state(): TransportState {
    return {
      channelId: this.channelId,
      rundownId: this.rundownId,
      onAir: this.onAir(),
      previewItemId: this.previewItemId,
      playing: this.playing,
    }
  }

  private nowFrames(): Frames {
    const view = this.view()
    if (!view) return 0
    return framesSinceMidnight(new Date(), view.channel.rate)
  }

  private onAir(): OnAirState | null {
    if (!this.onAirItemId || !this.playing) return null
    return {
      itemId: this.onAirItemId,
      startedAt: this.startedAt,
      elapsed: Math.max(0, this.nowFrames() - this.startedAt),
    }
  }

  take(rundownId: string, itemId: string): void {
    this.rundownId = rundownId
    this.onAirItemId = itemId
    this.startedAt = this.nowFrames()
    this.playing = true
  }

  cue(itemId: string | null): void {
    this.previewItemId = itemId
  }

  stop(): void {
    this.playing = false
    this.onAirItemId = null
  }

  /**
   * Avança quando o item corrente acaba. `autoNext` falso segura no último
   * frame esperando take manual — que é como um playout de verdade se comporta
   * quando o operador quer a decisão na mão.
   */
  tick(): boolean {
    if (!this.playing || !this.onAirItemId) return false

    const view = this.view()
    if (!view) return false

    const index = view.items.findIndex((v) => v.item.id === this.onAirItemId)
    if (index < 0) return false

    const current = view.items[index]
    if (!current) return false

    const scheduled = view.schedule.items.find((i) => i.id === current.item.id)
    const duration = scheduled?.duration ?? 0
    const elapsed = this.nowFrames() - this.startedAt
    if (elapsed < duration) return false

    if (!current.item.autoNext) {
      this.playing = false
      return true
    }

    const next = view.items
      .slice(index + 1)
      .find((v) => view.schedule.items.find((i) => i.id === v.item.id)?.state !== 'DROPPED')

    if (!next) {
      this.stop()
      return true
    }

    this.onAirItemId = next.item.id
    this.startedAt = this.startedAt + duration
    return true
  }
}
