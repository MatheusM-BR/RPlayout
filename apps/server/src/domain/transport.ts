import {
  framesSinceMidnight,
  type Frames,
  type OnAirState,
  type PreviewTarget,
} from '@rplayout/protocol'
import type { RundownView } from './plan.js'
import type { MeterReading } from './meters.js'

/** Situação de uma saída de rede do canal, como o engine reporta. */
export interface PublisherState {
  readonly url: string
  readonly health: 'connecting' | 'onAir' | 'retrying'
  /** Tentativas desde a última entrega. Zera quando volta a entregar. */
  readonly attempts: number
  readonly delivered: number
  readonly error?: string
}

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
 * O que o servidor precisa de um transporte, seja ele simulado ou o engine de
 * verdade. Manter os dois atrás do mesmo contrato é o que permite trocar um
 * pelo outro sem tocar em rota nem em interface.
 */
export interface Transport {
  state(): TransportState
  take(rundownId: string, itemId: string): void
  cue(target: PreviewTarget | null): void
  stop(): void
  /** Arma a grade num item, parada, pronta para entrar no ar. */
  park(itemId: string): void
  /** Devolve true quando o estado mudou e a grade precisa ser recalculada. */
  tick(): boolean
  /** Medição real do programa, quando o transporte tem uma. */
  programMeter(): MeterReading | null
  /** Medição real do preview, quando o transporte tem uma. */
  previewMeter(): MeterReading | null
  /** Saídas de rede do canal. Vazio no simulado, que não sai para lugar nenhum. */
  publishers(): readonly PublisherState[]
  /** Põe ou tira grafismo do programa. SVG já preenchido; nulo tira. */
  graphic(svg: string | null, fadeMs: number): void
  /** Levanta o motor quando ele cai ou congela. Nada a fazer no simulado. */
  watchdog(): void
  close(): void
}

/**
 * Transporte simulado da F1.
 *
 * O engine ainda não existe, então quem faz o tempo andar é o relógio do
 * sistema. O contrato é o mesmo que o engine vai cumprir depois: o servidor
 * pergunta o estado, nunca calcula duração por conta própria.
 */
export class SimulatedTransport implements Transport {
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
  /** O simulado não sai para lugar nenhum: quem publica é o engine. */
  publishers(): readonly PublisherState[] {
    return []
  }

  /** Sem engine não há o que desenhar; o estado do grafismo mora no servidor. */
  graphic(): void {}

  /** O simulado é o próprio processo do servidor: não há o que vigiar. */
  watchdog(): void {}

  /** O simulado não mede nada: quem mede é o engine. */
  programMeter(): MeterReading | null {
    return null
  }

  previewMeter(): MeterReading | null {
    return null
  }

  close(): void {
    // Nada a encerrar: o simulado não tem processo nem soquete.
  }
}
