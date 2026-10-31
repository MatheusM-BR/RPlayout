import {
  framesSinceMidnight,
  msToFrames,
  framesToMs,
  type Frames,
  type OnAirState,
  type PreviewTarget,
  type LiveSignalAssessment,
} from '@rplayout/protocol'
import type { RundownView } from './plan.js'
import type { MeterReading } from './meters.js'
import { liveDurationLimit } from './live-timing.js'
import type {ProgramTrim} from './program-trim.js'
export interface ProgramVideoProbe {luma:number;black:boolean;freeze:boolean;freezeDurationMs?:number;sampleAgeMs?:number|null}

/** Situação de uma saída de rede do canal, como o engine reporta. */
export interface PublisherState {
  readonly outputId?: string
  readonly url: string
  readonly health: 'connecting' | 'onAir' | 'retrying' | 'failed' | 'idle'
  /** Tentativas desde a última entrega. Zera quando volta a entregar. */
  readonly attempts: number
  readonly delivered: number
  /** Native generation changes whenever the delivery counter is reset. */
  readonly generation?: number
  readonly error?: string
}

/** Estado de uma entrada viva que o engine de fato abriu nesta sessão. */
export type LiveSourceSignalState = 'IDLE' | 'CUEING' | 'PVW_READY' | 'TAKE_PENDING' | 'ON_PGM' | 'LOST' | 'FAILED'

export interface LiveSourceMeasurement {
  width: number | null; height: number | null; rateNum: number | null; rateDen: number | null
  interlaceMode: string | null; audioChannels: number | null; sampleRate: number | null
  videoAgeMs: number | null; audioAgeMs: number | null; videoPresent: boolean; audioPresent: boolean
  receivedFrames: number; arrivalJitterMs: number | null
  sampledContentUnchangedMs?:number|null;contentSampleAgeMs?:number|null;contentSampleFrames?:number
  /** Watchdog: medições baratas no pad decodificado (engine novo; ausentes no antigo). */
  arrivalFps?:number|null;distinctFps?:number|null;lumaMeanPercent?:number|null;lumaStdPercent?:number|null;lumaSampleAgeMs?:number|null
  lumaUnsupportedFormat?:string|null;lumaDeltaPercent?:number|null;lumaStaticMs?:number|null;audioRmsDbfs?:number|null;audioSampleRatio?:number|null;audioStalledMs?:number|null;inputKbps?:number|null
}

export interface LiveSourceSignal {
  readonly source: string
  readonly itemId: string
  readonly state: LiveSourceSignalState
  readonly message: string | null
  readonly changedAt: string
  readonly busStates?: Partial<Record<'pgm' | 'pvw', LiveSourceSignalState>>
  /** Active item binding per bus; the most recent source event can be from QC. */
  readonly busItemIds?: Partial<Record<'pgm' | 'pvw', string>>
  /** Catalog metadata echoed by the current native decoder; not signal health. */
  readonly nativeCatalogBindings?: Partial<Record<'pgm' | 'pvw', string>>
  /** Diagnosis at snapshot time; consumers must re-evaluate sample freshness. */
  readonly busSignals?: Partial<Record<'pgm' | 'pvw', LiveSignalAssessment>>
  readonly measurements?: Partial<Record<'pgm' | 'pvw', LiveSourceMeasurement & { sampledAt: string }>>
}

export interface TransportState {
  readonly mode?: 'NATIVE' | 'SIMULATED'
  readonly channelId: string
  readonly rundownId: string | null
  readonly onAir: OnAirState | null
  /** Actual mounted file bounds; absent for live/simulator or no confirmed PGM. */
  readonly programTrim?:ProgramTrim|null
  /** O que está aberto no preview: item da grade ou arquivo do explorador. */
  readonly preview: PreviewTarget | null
  readonly previewPosition: { readonly frames: Frames; readonly duration: Frames } | null
  /** Decoder delivery only; not proof of publisher/browser picture quality. */
  readonly previewFrame?:{itemId:string;decoderId:number;delivered:boolean;ageMs:number|null;pausedFile:boolean;sampledAt:number}|null
  /** Item já aberto e decodificado no slot alternativo do programa. */
  readonly preparedItemId: string | null
  /** Item cujo preroll está acontecendo neste instante. */
  readonly preparingItemId: string | null
  readonly playing: boolean
  /** Grade parada com um item armado, esperando o take. */
  readonly standby: boolean
  /** Fontes vivas abertas pelo engine; descoberta sozinha não aparece aqui. */
  readonly liveSources: readonly LiveSourceSignal[]
}

/**
 * O que o servidor precisa de um transporte, seja ele simulado ou o engine de
 * verdade. Manter os dois atrás do mesmo contrato é o que permite trocar um
 * pelo outro sem tocar em rota nem em interface.
 */
export interface OverlayCommand {
  slot: number
  action: 'in' | 'out' | 'cut' | 'off'
  svg?: string | null
  animation?: import('@rplayout/protocol').OverlayAnimation | null
}

export interface Transport {
  commandRevision?(): number
  state(): TransportState
  take(rundownId: string, itemId: string, resumeFrames?: Frames): void | Promise<void>
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
  /** Análise do quadro PGM emitida pelo compositor real; nula no simulador. */
  videoProbe(): ProgramVideoProbe | null
  signalSample(now?:number,maxAgeMs?:number):{meter:MeterReading|null;videoProbe:ProgramVideoProbe|null}
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
  graphicConfirmed?(svg: string | null, fadeMs: number, authorize?:()=>void): Promise<void>
  /** Overlay 1–8 (entrada/saída/corte/desliga). Sem engine, só confirma. */
  overlay?(command: OverlayCommand): Promise<void>
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
  /** Estado único (OK/ALERTA/REINICIANDO/FALHA). Opcional: o simulado deriva da saúde. */
  engineStatus?(): import('./engine-status.js').EngineStatus
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
  private commandSequence = 0
  commandRevision(): number { return this.commandSequence }
  private rundownId: string | null = null
  private onAirItemId: string | null = null
  private startedAt: Frames = 0
  private startedAtMs = 0
  private preview: PreviewTarget | null = null
  private playing = false

  constructor(
    private readonly channelId: string,
    /** Devolve a grade resolvida agora — é dela que sai a duração de cada item. */
    private readonly view: () => RundownView | null,
  ) {}

  state(): TransportState {
    const view = this.view()
    const preview = this.preview
    let preparedItemId: string | null = null

    // Próximo é uma pré-seleção automática, separada do CUE manual no PVW.
    // O simulador precisa preservar essa diferença para a interface não
    // ensinar que um item "próximo" foi confirmado pelo operador.
    if (view && view.items.length > 0) {
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
    }

    return {
      mode: 'SIMULATED',
      channelId: this.channelId,
      rundownId: this.rundownId,
      onAir: this.onAir(),
      preview,
      previewPosition: null,
      preparedItemId,
      preparingItemId: null,
      playing: this.playing,
      standby: !this.playing && (preview?.kind === 'ITEM' || preparedItemId !== null),
      liveSources: [],
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
      elapsed: this.elapsedFrames(),
    }
  }

  private elapsedFrames(): Frames {
    const rate = this.view()?.channel.rate
    return rate ? Math.max(0, msToFrames(Date.now() - this.startedAtMs, rate)) : 0
  }

  take(rundownId: string, itemId: string, resumeFrames = 0): void {
    this.commandSequence++
    this.rundownId = rundownId
    this.onAirItemId = itemId
    this.startedAt = this.nowFrames() - Math.max(0, Math.floor(resumeFrames))
    const rate = this.view()?.channel.rate
    this.startedAtMs = Date.now() - (rate ? framesToMs(Math.max(0, Math.floor(resumeFrames)), rate) : 0)
    this.playing = true

    // O próximo fica preparado internamente; PVW só recebe conteúdo quando
    // o operador faz CUE. TAKE nunca transforma o próximo automático em CUE.
    const view = this.view()
    if (view && view.items.length > 0) {
      const idx = view.items.findIndex((v) => v.item.id === itemId)
      if (idx >= 0 && idx + 1 < view.items.length) {
        this.preview = null
      } else if (view.rundown.loop) {
        this.preview = null
      } else {
        this.preview = null
      }
    } else {
      this.preview = null
    }
  }

  cue(target: PreviewTarget | null): void {
    this.commandSequence++
    this.preview = target
  }

  /**
   * Tira do ar e deixa armado onde parou. Parar não é perder o lugar: o
   * operador quase sempre quer voltar do mesmo ponto.
   */
  stop(): void {
    this.commandSequence++
    if (this.onAirItemId) this.preview = { kind: 'ITEM', id: this.onAirItemId }
    this.playing = false
    this.onAirItemId = null
  }

  /** Arma a grade no primeiro item, parada, pronta para entrar no ar. */
  park(itemId: string): void {
    this.commandSequence++
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
    const isLive = current.item.type === 'LIVE' || Boolean(current.item.sourceRef || current.item.liveEndpoint)
    const liveLimit = isLive ? liveDurationLimit(current.item, scheduled?.duration ?? 0) : null
    if (isLive && liveLimit === null) return false
    const duration = liveLimit ?? scheduled?.duration ?? 0
    const elapsed = this.elapsedFrames()
    if (elapsed < duration) return false

    if (!current.item.autoNext) {
      this.commandSequence++
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
    this.commandSequence++
    this.startedAt = this.startedAt + duration
    this.startedAtMs += framesToMs(duration, view.channel.rate)

    // Mantém o próximo preparado, sem fingir que ele foi posto em CUE.
    const nextIdx = view.items.findIndex((v) => v.item.id === next)
    if (nextIdx >= 0 && nextIdx + 1 < view.items.length) {
      this.preview = null
    } else if (view.rundown.loop) {
      this.preview = null
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
    this.commandSequence++
    if (bus === 'pgm' && this.onAirItemId && this.playing) {
      this.startedAt = this.nowFrames() - Math.max(0, frames)
      const rate = this.view()?.channel.rate
      if (rate) this.startedAtMs = Date.now() - framesToMs(Math.max(0, frames), rate)
    }
  }

  processId(): number | null {
    return null
  }

  setMonitor(): void {
    // Sem engine não há codificação para ligar nem desligar.
  }

  /** Sem engine não há o que desenhar; o estado do grafismo mora no servidor. */
  graphic(): void {}

  /** Sem engine o overlay só é registrado no servidor. */
  async overlay(): Promise<void> {}

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

  videoProbe(): { luma: number; black: boolean; freeze: boolean } | null {
    return null
  }
  signalSample(){return {meter:null,videoProbe:null}}

  close(): void {
    // Nada a encerrar: o simulado não tem processo nem soquete.
  }
}
