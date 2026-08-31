import {
  framesSinceMidnight,
  type Frames,
  type OnAirState,
  type PreviewTarget,
} from '@rplayout/protocol'
import type { RundownView } from './plan.js'

export interface TransportState {
  readonly channelId: string
  readonly rundownId: string | null
  readonly onAir: OnAirState | null
  /** O que está aberto no preview: item da grade ou arquivo do explorador. */
  readonly preview: PreviewTarget | null
  readonly playing: boolean
  /** Grade parada com um item armado, esperando o take. */
  readonly standby: boolean
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
  private preview: PreviewTarget | null = null
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
      preview: this.preview,
      playing: this.playing,
      standby: !this.playing && this.preview?.kind === 'ITEM',
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
    this.preview = null
  }

  cue(target: PreviewTarget | null): void {
    this.preview = target
  }

  /**
   * Tira do ar e deixa armado onde parou. Parar não é perder o lugar: o
   * operador quase sempre quer voltar do mesmo ponto.
   */
  stop(): void {
    if (this.onAirItemId) this.preview = { kind: 'ITEM', id: this.onAirItemId }
    this.playing = false
    this.onAirItemId = null
  }

  /** Arma a grade no primeiro item, parada, pronta para entrar no ar. */
  park(itemId: string): void {
    this.playing = false
    this.onAirItemId = null
    this.preview = { kind: 'ITEM', id: itemId }
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

    const playable = (position: number): string | null => {
      const candidate = view.items
        .slice(position)
        .find((v) => view.schedule.items.find((i) => i.id === v.item.id)?.state !== 'DROPPED')
      return candidate?.item.id ?? null
    }

    // Programação não acaba: chegou no fim, volta para o topo.
    const next = playable(index + 1) ?? (view.rundown.loop ? playable(0) : null)
    if (!next) {
      this.stop()
      return true
    }

    this.onAirItemId = next
    this.startedAt = this.startedAt + duration
    return true
  }
}
