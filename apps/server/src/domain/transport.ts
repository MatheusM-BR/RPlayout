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
  readonly health: 'connecting' | 'onAir' | 'retrying' | 'idle'
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
  readonly previewPosition: { readonly frames: Frames; readonly duration: Frames } | null
  /** Item já aberto e decodificado no slot alternativo do programa. */
  readonly preparedItemId: string | null
  /** Item cujo preroll está acontecendo neste instante. */
  readonly preparingItemId: string | null
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
  take(rundownId: string, itemId: string): void | Promise<void>
  cue(target: PreviewTarget | null): void | Promise<void>
  stop(): void | Promise<void>
  /** Arma a grade num item, parada, pronta para entrar no ar. */
  park(itemId: string): void | Promise<void>
  /** Posiciona programa ou preview em frames desde o Mark In. */
  seek(bus: 'pgm' | 'pvw', frames: Frames): void | Promise<void>
  /** Devolve true quando o estado mudou e a grade precisa ser recalculada. */
  tick(): boolean
  /** Medição real do programa, quando o transporte tem uma. */
  programMeter(): MeterReading | null
  /** Medição real do preview, quando o transporte tem uma. */
  previewMeter(): MeterReading | null
  /** Saídas de rede do canal. Vazio no simulado, que não sai para lugar nenhum. */
  publishers(): readonly PublisherState[]
  /** PID do processo de renderização, quando há engine real. */
  processId(): number | null
  /**
   * Liga ou desliga um monitor ("pvw", "mon") sem encostar no programa.
   *
   * Codificar para uma janela que ninguém abriu é gastar CPU do ar com nada --
   * e com quatro canais são quatro codificações desperdiçadas.
   */
  setMonitor(bus: 'pvw' | 'mon', on: boolean): void
  /** Põe ou tira grafismo do programa. SVG já preenchido; nulo tira. */
  graphic(svg: string | null, fadeMs: number): void
  /** Levanta o motor quando ele cai ou congela. Nada a fazer no simulado. */
  watchdog(): void
  /**
   * Saúde do motor: quantas vezes teve de ser levantado, por qual motivo, e o
   * último erro. Separar morte do processo de travamento importa: são defeitos
  /**
   * Liga ou desliga um monitor ("pvw", "mon") sem encostar no programa.
   *
   * Codificar para uma janela que ninguém abriu é gastar CPU do ar com nada --
   * e com quatro canais são quatro codificações desperdiçadas.
   */
  setMonitor(bus: 'pvw' | 'mon', on: boolean): void
  /** Põe ou tira grafismo do programa. SVG já preenchido; nulo tira. */
  graphic(svg: string | null, fadeMs: number): void
  /** Levanta o motor quando ele cai ou congela. Nada a fazer no simulado. */
  watchdog(): void
  /**
   * Saúde do motor: quantas vezes teve de ser levantado, por qual motivo, e o
   * último erro. Separar morte do processo de travamento importa: são defeitos
   * diferentes, e o alerta que junta os dois não ajuda ninguém a procurar.
   */
  health(): { restarts: number; deaths: number; stalls: number; error: string | null; ready: boolean }
  /** Aviso recente do motor -- máquina apertada, por exemplo. Nulo se não há. */
  warning(): string | null
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
    const view = this.view()
    let preview = this.preview
    let preparedItemId = preview?.kind === 'ITEM' ? preview.id : null

    // Se nenhum item foi explicitamente armado no preview, seleciona automaticamente o próximo evento
    if (!preparedItemId && view && view.items.length > 0) {
      if (this.onAirItemId) {
        const idx = view.items.findIndex((v) => v.item.id === this.onAirItemId)
        if (idx >= 0 && idx + 1 < view.items.length) {
          preparedItemId = view.items[idx + 1]?.item.id ?? null
        } else if (view.rundown.loop) {
          preparedItemId = view.items[0]?.item.id ?? null
        }
      } else {
        preparedItemId = view.items[0]?.item.id ?? null
      }
      if (!preview && preparedItemId) {
        preview = { kind: 'ITEM', id: preparedItemId }
      }
    }

    return {
      channelId: this.channelId,
      rundownId: this.rundownId,
      onAir: this.onAir(),
      preview,
      previewPosition: null,
      preparedItemId,
      preparingItemId: null,
      playing: this.playing,
      standby: !this.playing && (preview?.kind === 'ITEM' || preparedItemId !== null),
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

    // Ao ir para o ar, já pré-arma o próximo da fila para o preview
    const view = this.view()
    if (view && view.items.length > 0) {
      const idx = view.items.findIndex((v) => v.item.id === itemId)
      if (idx >= 0 && idx + 1 < view.items.length) {
        this.preview = { kind: 'ITEM', id: view.items[idx + 1]!.item.id }
      } else if (view.rundown.loop) {
        this.preview = { kind: 'ITEM', id: view.items[0]!.item.id }
      } else {
        this.preview = null
      }
    } else {
      this.preview = null
    }
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

    // Auto-arma o próximo evento no PVW
    const nextIdx = view.items.findIndex((v) => v.item.id === next)
    if (nextIdx >= 0 && nextIdx + 1 < view.items.length) {
      this.preview = { kind: 'ITEM', id: view.items[nextIdx + 1]!.item.id }
    } else if (view.rundown.loop) {
      this.preview = { kind: 'ITEM', id: view.items[0]!.item.id }
    } else {
      this.preview = null
    }

    return true
  }
  /** O simulado não sai para lugar nenhum: quem publica é o engine. */
  publishers(): readonly PublisherState[] {
    return []
  }

  seek(bus: 'pgm' | 'pvw', frames: Frames): void {
    if (bus === 'pgm' && this.onAirItemId && this.playing) this.startedAt = this.nowFrames() - Math.max(0, frames)
  }

  processId(): number | null {
    return null
  }

  setMonitor(): void {
    // Sem engine não há codificação para ligar nem desligar.
  }

  /** Sem engine não há o que desenhar; o estado do grafismo mora no servidor. */
  graphic(): void {}

  /** O simulado é o próprio processo do servidor: não há o que vigiar. */
  watchdog(): void {}

  health(): { restarts: number; deaths: number; stalls: number; error: string | null; ready: boolean } {
    return { restarts: 0, deaths: 0, stalls: 0, error: null, ready: true }
  }

  /** O simulado não tem máquina apertada: ele não decodifica nada. */
  warning(): string | null {
    return null
  }

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
