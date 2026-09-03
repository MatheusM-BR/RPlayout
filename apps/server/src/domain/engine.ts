import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import {
  durationIn,
  framesSinceMidnight,
  isStill,
  secondsToFrames,
  STILL_DEFAULT_SECONDS,
  type Channel,
  type Fit,
  type MediaAsset,
  type Frames,
  type OnAirState,
  type PreviewTarget,
} from '@rplayout/protocol'
import { MediaMtx } from './mediamtx.js'
import type { MeterReading } from './meters.js'
import { SILENCE } from './meters.js'
import type { RundownView } from './plan.js'
import type { PublisherState, Transport, TransportState } from './transport.js'

/** O que o engine precisa saber para pôr um item no ar. */
interface EngineItem {
  itemId: string
  path: string
  /** Fonte ao vivo já resolvida para endereço concreto. */
  source?: string
  trimIn: Frames
  trimOut: Frames
  gainDb: number
  /** Proporção diferente da do canal: barra preta ou corte. */
  fit?: Fit
  /** Trilha de áudio, na ordem em que o arquivo as declara. */
  audioTrack?: number
}

type EngineEvent =
  | { event: 'ready'; channelId: string }
  | { event: 'ack'; id: number; ok: boolean; error?: string }
  | { event: 'state'; onAir?: string; armed?: string; preview?: string }
  | { event: 'position'; itemId: string; frames: number; duration: number }
  | { event: 'eos'; itemId: string }
  | { event: 'sourceLost'; itemId: string; reason: string }
  | {
      event: 'levels'
      bus: 'pgm' | 'pvw'
      peak: number[]
      momentary: number
      shortTerm: number
      integrated: number
      range: number
      truePeak: number
      correlation: number
      gainReduction: number
    }
  | { event: 'output'; frames: number }
  | ({ event: 'publisher' } & PublisherState)
  | { event: 'error'; message: string }

export interface EngineOptions {
  /** Caminho do binário do engine. */
  readonly binary: string
  /** Saídas do canal, no formato que o engine entende. */
  readonly outputs: readonly string[]
  /** Saída do barramento de preview. Nulo deixa o canal sem preview de vídeo. */
  readonly preview: string | null
  readonly bitrateKbps: number
}

/**
 * Transporte apoiado no engine de verdade.
 *
 * Cumpre o mesmo contrato do simulado, então rota e interface não sabem qual
 * dos dois está no comando. A diferença é que aqui o tempo não é calculado:
 * ele é reportado por quem está de fato tocando o arquivo.
 */
/** Espera entre tentativas de subir o engine de novo. */
const RESTART_DELAY_MS = 1_000
/**
 * Quanto tempo sem quadro novo é considerado congelamento.
 *
 * O engine reporta o contador a cada segundo; três segundos sem andar é longe
 * demais de um soluço e perto o bastante para o ar não ficar preto meio minuto.
 */
const STALL_MS = 3_000

export class EngineTransport implements Transport {
  private child: ChildProcess
  private nextId = 1
  private rundownId: string | null = null
  private onAirItemId: string | null = null
  private armedItemId: string | null = null
  private elapsed: Frames = 0
  /** Último nível que o engine recebeu para o item no ar. */
  private appliedGainDb: number | null = null
  /**
   * Quando o item ao vivo no ar deve sair, em frames desde a meia-noite.
   *
   * Arquivo acaba sozinho e avisa; fonte ao vivo não acaba nunca. Quem marca a
   * hora de sair de um estúdio é a grade, e sem isto o item ao vivo ficaria no
   * ar para sempre e a programação pararia atrás dele.
   */
  private liveEndsAt: Frames | null = null
  private preview: PreviewTarget | null = null
  private meter: MeterReading | null = null
  private previewReading: MeterReading | null = null
  /** Uma entrada por saída de rede, chaveada pela URL de destino. */
  private readonly publisherStates = new Map<string, PublisherState>()
  private dirty = false
  private alive = true
  private readonly args: string[]
  private readonly binary: string
  /** Watchdog: quadros do programa e quando eles andaram pela última vez. */
  private framesOut = 0
  private lastFrames = 0
  private lastProgress = Date.now()
  private restartAt: number | null = null
  /** Quantas vezes o engine já teve de ser ressuscitado neste canal. */
  restarts = 0
  /** Último erro do engine, para a interface não ficar adivinhando. */
  lastError: string | null = null

  constructor(
    private readonly channel: Channel,
    private readonly view: () => RundownView | null,
    /** Acervo, para o preview abrir arquivo que nem está na grade. */
    private readonly asset: (assetId: string) => MediaAsset | null,
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
      // O teto do limiter é do canal: é a promessa que o canal faz ao destino.
      '--ceiling',
      String(channel.ceilingDbtp),
      // A varredura muda a cadência de composição dentro do engine, nunca a da
      // grade: 1080i5994 são 29,97 quadros aqui e 59,94 campos lá dentro.
      '--scan',
      channel.scan === 'INTERLACED' ? 'interlaced' : 'progressive',
      '--field-order',
      channel.fieldOrder === 'BFF' ? 'bff' : 'tff',
    ]
    for (const output of options.outputs) args.push('--output', output)
    if (options.preview) args.push('--preview', options.preview)

    this.args = args
    this.binary = options.binary
    this.child = this.spawnChild()
  }

  /**
   * Sobe o processo do engine e liga os canais de conversa com ele.
   *
   * Está numa função à parte porque o watchdog precisa fazer isto de novo: um
   * playout que fica meses no ar não pode depender de o primeiro processo
   * nunca morrer.
   */
  private spawnChild(): ChildProcess {
    const child = spawn(this.binary, this.args, { stdio: ['pipe', 'pipe', 'pipe'] })

    if (child.stdout) {
      createInterface({ input: child.stdout }).on('line', (line) => this.absorb(line))
    }
    // O engine loga no stderr de propósito, para nunca sujar o canal de dados.
    child.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(`[engine ${this.channel.name}] ${chunk.toString()}`)
    })
    // Cano quebrado não pode derrubar o servidor.
    //
    // Escrever na entrada de um processo que já morreu emite `error` no
    // socket, e evento `error` sem ouvinte em Node **encerra o processo**. O
    // caminho é curtíssimo: o engine cai (o que acontece), alguém apaga o
    // canal, o `close()` escreve o `shutdown` no filho morto, e o servidor
    // inteiro vai junto -- levando os outros canais, que não tinham nada com
    // isso. Foi assim que apagar canal virou "Internal Server Error".
    child.stdin?.on('error', (erro) => {
      this.alive = false
      this.lastError = `A entrada do engine fechou: ${erro.message}`
    })
    child.stdout?.on('error', () => {})
    child.stderr?.on('error', () => {})

    child.on('exit', (code) => {
      this.alive = false
      this.lastError = `O engine encerrou com código ${code ?? 'desconhecido'}.`
      this.dirty = true
    })

    this.alive = true
    this.framesOut = 0
    this.lastFrames = 0
    this.lastProgress = Date.now()
    return child
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
      case 'sourceLost':
        // Fonte ao vivo que cai não anda com a grade: o estúdio pode voltar, e
        // a hora de sair continua sendo a que a grade marcou. O engine fica
        // tentando reabrir; aqui só registramos para o operador ver.
        this.fail(`fonte ao vivo caiu: ${event.reason}`)
        break
      case 'levels':
        if (event.bus === 'pgm') this.meter = toMeter(event)
        else this.previewReading = toMeter(event)
        break
      case 'publisher':
        this.publisherStates.set(event.url, {
          url: event.url,
          health: event.health,
          attempts: event.attempts,
          delivered: event.delivered,
          error: event.error,
        })
        break
      case 'output':
        // Contador de quadros do programa: é a prova objetiva de que o canal
        // continua produzindo, e o que o watchdog observa.
        this.framesOut = event.frames
        break
      case 'ack':
        if (!event.ok && event.error) this.fail(event.error)
        break
      case 'error':
        this.fail(event.message)
        break
      default:
        break
    }
  }

  /**
   * Guarda e mostra. Erro de engine que só vive num campo é erro invisível: o
   * canal pode estar sem sair para lugar nenhum e o log não dizer nada.
   */
  private fail(message: string): void {
    this.lastError = message
    process.stderr.write(`[engine ${this.channel.name}] ERRO ${message}\n`)
  }

  /**
   * Grafismo no programa. O engine recebe SVG pronto: quem preenche campo é o
   * servidor, e assim o modelo de template muda sem recompilar o que está no
   * ar.
   */
  graphic(svg: string | null, fadeMs: number): void {
    this.send({ cmd: 'graphic', svg, fadeMs })
  }

  /**
   * Vigia o engine e o levanta quando ele cai ou congela.
   *
   * Duas mortes diferentes, um tratamento só. Processo que morreu é fácil de
   * ver; processo vivo que parou de entregar quadro é o caso perigoso -- do
   * lado de fora parece que está tudo bem, e o ar está preto.
   *
   * Ressuscitar não basta: o item que estava no ar volta, porque um canal que
   * acorda mudo é tão inútil quanto um canal morto.
   */
  watchdog(): void {
    if (!this.alive) {
      // Espera curta entre tentativas: se o engine não sobe, insistir sem
      // pausa transforma um defeito em tempestade de processos.
      this.restartAt ??= Date.now() + RESTART_DELAY_MS
      if (Date.now() < this.restartAt) return

      this.restartAt = null
      this.restarts += 1
      this.child = this.spawnChild()
      this.restore()
      return
    }

    if (this.framesOut !== this.lastFrames) {
      this.lastFrames = this.framesOut
      this.lastProgress = Date.now()
      return
    }
    if (Date.now() - this.lastProgress < STALL_MS) return

    // Vivo e parado: derruba: o caminho de volta é o mesmo do processo morto,
    // e ter um caminho só é o que faz o conserto ser testável.
    this.fail('O programa parou de produzir quadros; reiniciando o engine.')
    this.lastProgress = Date.now()
    this.child.kill('SIGKILL')
  }

  health(): { restarts: number; error: string | null } {
    return { restarts: this.restarts, error: this.lastError }
  }

  /** Põe de volta no ar o que estava no ar quando o engine caiu. */
  private restore(): void {
    const itemId = this.onAirItemId
    if (!itemId) return
    const spec = this.specFor(itemId)
    if (!spec) return
    this.send({ cmd: 'load', item: spec })
    this.send({ cmd: 'take' })
    this.appliedGainDb = spec.gainDb
  }

  private send(command: Record<string, unknown>): void {
    if (!this.alive) return
    try {
      this.child.stdin?.write(`${JSON.stringify({ id: this.nextId++, ...command })}\n`)
    } catch (falha) {
      // O filho morreu entre a checagem e a escrita. Não há a quem mandar a
      // ordem, e derrubar o servidor por causa disso seria trocar um canal
      // perdido por todos eles.
      this.alive = false
      this.lastError = falha instanceof Error ? falha.message : 'O engine não aceitou a ordem.'
    }
  }

  /** Traduz um item da grade para o que o engine sabe abrir. */
  private specFor(itemId: string): EngineItem | null {
    const view = this.view()
    const entry = view?.items.find((candidate) => candidate.item.id === itemId)
    if (!entry) return null

    // Item ao vivo não tem arquivo: tem fonte, e a duração vem da grade, não do
    // conteúdo. Corte em zero é a forma de dizer isso ao engine.
    if (entry.item.sourceRef) {
      const source = resolveSource(entry.item.sourceRef)
      if (!source) return null
      return {
        itemId,
        path: '',
        source,
        trimIn: 0,
        trimOut: 0,
        gainDb: entry.gainDb,
        fit: entry.item.fit,
      }
    }

    if (!entry.asset) return null

    // Imagem parada não tem tempo dentro do arquivo: o corte dela é a duração
    // que a grade marcou. Sem isto o item entraria com zero quadro.
    const still = isStill(entry.asset)
    const stillOut =
      entry.item.durationOverride ?? secondsToFrames(STILL_DEFAULT_SECONDS, this.channel.rate)

    return {
      itemId,
      path: entry.asset.path,
      trimIn: still ? 0 : entry.trim.in,
      trimOut: still ? stillOut : entry.trim.out,
      gainDb: entry.gainDb,
      fit: entry.item.fit,
      audioTrack: entry.item.audioTrack ?? 0,
    }
  }

  /**
   * O que o preview deve abrir para este alvo.
   *
   * Arquivo do explorador entra inteiro: quem está olhando o acervo quer ver o
   * arquivo, não o corte que alguém definiu na grade.
   */
  private specForPreview(target: PreviewTarget): EngineItem | null {
    if (target.kind === 'ITEM') return this.specFor(target.id)

    const asset = this.asset(target.id)
    if (!asset) return null
    return {
      itemId: asset.id,
      path: asset.path,
      trimIn: 0,
      // A parada não acaba sozinha: no preview ela fica um tempo fixo, o
      // suficiente para o operador olhar.
      trimOut: isStill(asset)
        ? secondsToFrames(STILL_DEFAULT_SECONDS, this.channel.rate)
        : durationIn(asset, this.channel.rate),
      gainDb: 0,
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
      this.lastError = 'Este item não tem arquivo nem fonte que o engine saiba abrir.'
      return
    }

    this.rundownId = rundownId
    // Se já estava armado, o load é dispensável e o take sai na hora.
    if (this.armedItemId !== itemId) this.send({ cmd: 'load', item: spec })
    this.send({ cmd: 'take' })

    this.onAirItemId = itemId
    this.elapsed = 0
    this.liveEndsAt = spec.source === undefined ? null : this.plannedEnd(itemId)
    // O item entra com o nível que o `load` levou; a partir daí o `syncGain`
    // acompanha.
    this.appliedGainDb = spec.gainDb
    this.preview = null
    this.dirty = true
    // O item entrou no ar: o preview não tem mais o que mostrar dele.
    this.send({ cmd: 'preview', item: null })
    this.preload(itemId)
  }

  cue(target: PreviewTarget | null): void {
    this.preview = target
    this.dirty = true

    // O preview é um tocador à parte: abre o arquivo de novo, no barramento
    // dele. É o que permite olhar um arquivo sem encostar no que vai ao ar.
    this.send({ cmd: 'preview', item: target ? this.specForPreview(target) : null })

    // Armar item da grade também arma no engine: o take seguinte não paga o
    // preço de abrir o arquivo.
    if (target?.kind === 'ITEM') {
      const spec = this.specFor(target.id)
      if (spec && this.armedItemId !== target.id) this.send({ cmd: 'load', item: spec })
    }
  }

  stop(): void {
    const wasOnAir = this.onAirItemId
    this.send({ cmd: 'stop' })
    this.onAirItemId = null
    this.elapsed = 0
    this.liveEndsAt = null
    this.dirty = true
    // O que saiu do ar volta para o preview: é dali que o operador retoma, e
    // passar pelo cue é o que faz o monitor de preview acompanhar.
    if (wasOnAir) this.cue({ kind: 'ITEM', id: wasOnAir })
  }

  park(itemId: string): void {
    this.send({ cmd: 'stop' })
    this.onAirItemId = null
    this.elapsed = 0
    this.cue({ kind: 'ITEM', id: itemId })
  }

  /** Hora de saída que a grade marcou para este item, em frames. */
  private plannedEnd(itemId: string): Frames | null {
    const row = this.view()?.schedule.items.find((entry) => entry.id === itemId)
    if (!row) return null
    return framesSinceMidnight(new Date(), this.channel.rate) + row.duration
  }

  tick(): boolean {
    this.syncGain()
    this.endLiveWhenDue()
    const changed = this.dirty
    this.dirty = false
    return changed
  }

  /**
   * Tira do ar o item ao vivo quando dá a hora que a grade marcou.
   *
   * Arquivo acaba e avisa; fonte ao vivo não acaba. Sem isto a programação
   * pararia atrás de um estúdio que ficou no ar para sempre.
   */
  private endLiveWhenDue(): void {
    if (this.liveEndsAt === null || !this.onAirItemId) return
    if (framesSinceMidnight(new Date(), this.channel.rate) < this.liveEndsAt) return

    const itemId = this.onAirItemId
    this.liveEndsAt = null
    this.advanceAfter(itemId)
  }

  /**
   * Leva ao engine o nível do item no ar quando ele muda.
   *
   * Aqui e não em quem edita: nível muda por diálogo de áudio, por escopo que
   * pega vários itens, por desfazer e por refazer. Reconciliar a partir do
   * estado cobre todos esses caminhos de uma vez -- e o engine troca o ganho
   * sem interromper o que está no ar, então não há custo em aplicar já.
   */
  private syncGain(): void {
    const itemId = this.onAirItemId
    if (!itemId) {
      this.appliedGainDb = null
      return
    }

    const entry = this.view()?.items.find((candidate) => candidate.item.id === itemId)
    if (!entry) return

    if (this.appliedGainDb !== null && Math.abs(entry.gainDb - this.appliedGainDb) < 0.01) return
    this.appliedGainDb = entry.gainDb
    this.send({ cmd: 'setGain', gainDb: entry.gainDb })
  }

  programMeter(): MeterReading | null {
    return this.meter
  }

  /** Medição do barramento de preview, quando há algo aberto nele. */
  previewMeter(): MeterReading | null {
    return this.previewReading
  }

  /**
   * Situação das saídas de rede do canal.
   *
   * Cada saída tem pipeline próprio no engine e reconecta sozinha, então uma
   * delas caída não diz nada sobre o programa — mas o operador precisa ver a
   * diferença entre "no ar" e "no ar chegando a algum lugar".
   */
  publishers(): readonly PublisherState[] {
    return [...this.publisherStates.values()]
  }

  /** Liga ou desliga um monitor. O engine faz isso sem tocar no programa. */
  setMonitor(bus: 'pvw' | 'mon', on: boolean): void {
    this.send({ cmd: 'monitor', bus, on })
  }

  close(): void {
    this.send({ cmd: 'shutdown' })
    this.alive = false
    setTimeout(() => this.child.kill(), 1000).unref()
  }
}

/**
 * Referência de fonte vira endereço.
 *
 * `sdi:` e `ndi:` passam direto -- quem sabe abrir placa e NDI é o engine, e
 * traduzir isso aqui seria o servidor fingir que entende de hardware.
 * Convidado vira leitura no servidor de mídia local, onde ele publica, e por
 * RTSP em loopback como os relays: nunca pela rede.
 */
function resolveSource(ref: string): string | null {
  if (ref.includes('://')) return ref

  const separator = ref.indexOf(':')
  if (separator <= 0) return null
  const kind = ref.slice(0, separator)
  const rest = ref.slice(separator + 1)

  if (kind === 'sdi' || kind === 'ndi') return ref
  if (kind === 'guest') return MediaMtx.internalRead(`guest/${rest}`)
  if (kind === 'path') return MediaMtx.internalRead(rest)
  return null
}

/**
 * Converte a medição do engine para o formato do medidor.
 *
 * Aqui não há aproximação: o engine mede pela BS.1770-4, com ponderação K,
 * gate e pico verdadeiro sobreamostrado. O que chega já é LUFS de verdade.
 */
function toMeter(event: {
  peak: number[]
  momentary: number
  shortTerm: number
  integrated: number
  range: number
  truePeak: number
  correlation: number
  gainReduction: number
}): MeterReading {
  if (event.peak.length === 0) return SILENCE

  return {
    peakDbfs: event.peak,
    momentaryLufs: event.momentary,
    shortTermLufs: event.shortTerm,
    integratedLufs: event.integrated,
    rangeLu: event.range,
    truePeakDbtp: event.truePeak,
    gainReductionDb: event.gainReduction,
    correlation: event.correlation,
  }
}
