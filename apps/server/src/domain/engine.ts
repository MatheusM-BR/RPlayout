import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { DiagnosticLines, sanitizeDiagnostic } from './sanitize-diagnostic.js'
import { mediaProcessEnvironment } from './media-process-environment.js'
import { FileVersionVerifier, MediaVersionError, isMediaSha, mediaFileIdentity } from './file-version.js'
import {randomUUID} from 'node:crypto'
import {
  durationIn,
  resolvedAudioRouting,
  validateAuxiliaryPairs,
  knownInputAudioChannels,
  qcApproved,
  assessQc,
  framesSinceMidnight,
  isStill,
  secondsToFrames,
  framesToMs,
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
import { liveDurationLimit } from './live-timing.js'
import { priorityLives, type LivePriorityEvent } from './priority-live.js'
import type {
  LiveSourceSignal,
  LiveSourceSignalState,
  LiveSourceMeasurement,
  PublisherState,
  Transport,
  TransportState,
} from './transport.js'

/** O que o engine precisa saber para pôr um item no ar. */
interface EngineItem {
  itemId: string
  path: string
  /** Published file identity checked by the server, not by the native decoder. */
  contentHash?: string
  /** Fonte ao vivo já resolvida para endereço concreto. */
  source?: string
  trimIn: Frames
  trimOut: Frames
  startOffsetFrames?: Frames
  gainDb: number
  /** Proporção diferente da do canal: barra preta ou corte. */
  fit?: Fit
  /** Trilha de áudio, na ordem em que o arquivo as declara. */
  audioTrack?: number
  audioRouting?:import('@rplayout/protocol').AudioRouting
  auxiliaryPairs?:readonly import('@rplayout/protocol').AuxiliaryAudioPair[]
}
const specificationKey = (item: EngineItem): string => JSON.stringify([
  item.itemId, item.path, item.source ?? null, item.trimIn, item.trimOut,
  item.gainDb, item.fit ?? 'PILLARBOX', item.audioTrack ?? 0, item.startOffsetFrames ?? 0,item.audioRouting??{mode:'DEFAULT'},item.auxiliaryPairs??[],item.contentHash??null,
])

type EngineEvent =
  | { event:'fenceRequest';ownerId:string;nonce:number }
  | { event:'fenceApplied';nonce:number;term:number }
  | { event: 'ready'; channelId: string }
  | { event: 'ack'; id: number; ok: boolean; error?: string }
  | { event: 'state'; onAir?: string; armed?: string; preview?: string }
  | { event: 'position'; itemId: string; frames: number; duration: number }
  | { event: 'previewPosition'; itemId: string; frames: number; duration: number }
  | { event: 'eos'; itemId: string }
  | { event: 'sourceLost'; itemId: string; reason: string }
  | { event: 'sourceReady'; itemId: string; bus: 'pgm' | 'pvw' }
  | { event: 'sourceTelemetry'; itemId: string; bus: 'pgm' | 'pvw'; signal: LiveSourceMeasurement }
  | { event: 'itemError'; itemId: string; bus: 'pgm' | 'pvw'; message: string }
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
  | { event: 'videoProbe'; luma: number; black: boolean; freeze: boolean }
  | { event: 'output'; frames: number }
  | ({ event: 'publisher'; outputId?: string } & PublisherState)
  | { event: 'error'; message: string }
  | { event: 'warning'; message: string }

export type EnginePlaylistBoundary = { kind: 'HOLD'; reason: string } | {
  kind: 'TAKE'; view: RundownView; itemId: string; stillCurrent: () => boolean
  commit: (previous: { itemId: string; frames: number } | null) => void
  beforeTake: () => void; failed: (error: Error) => void
}
export interface EngineOptions {
  /** Per-native-owner witness grant. No Node timer can extend native expiry. */
  readonly fenceLease?:(ownerId:string,nonce:number)=>Promise<{term:number;ttlMs:number}>
  /** Caminho do binário do engine. */
  readonly binary: string
  /** Saídas do canal, no formato que o engine entende. */
  readonly outputs: readonly string[]
  /** Saída do barramento de preview. Nulo deixa o canal sem preview de vídeo. */
  readonly preview: string | null
  readonly qcPreview?: string | null
  readonly bitrateKbps: number
  /** Stable published revision identity, independent of periodic view rebuilds. */
  readonly executionIdentity?: () => string | null
  readonly onLivePriority?: (event: LivePriorityEvent) => void
  readonly onTakeConfirmed?: (itemId: string, startPositionFrames: number, recovered: boolean, previous: {itemId:string;frames:number;reason:string} | null) => void
  readonly onProgramCleared?: (reason: string, lastPositionFrames: number) => void
  /** Runs inside the native command queue at a natural, non-looping EOS.
   * The provider must NOT enqueue another transport operation. */
  readonly onPlaylistEnd?: (itemId: string) => Promise<EnginePlaylistBoundary | null>
  readonly onPreparePlaylistEnd?: () => Promise<{view:RundownView;itemId:string;stillCurrent:()=>boolean}|null>
  /** Unknown playlist cut must not auto-replay an older PGM after a crash. */
  readonly canRecoverProgram?: () => boolean
  readonly canRestartEngine?: () => boolean
  readonly onProcessStarted?: (pid:number|null) => void
  readonly canStartProgram?:()=>boolean
}
export interface TakeLifecycle {validate:()=>void;beforeTake:()=>void;confirmed:(native:boolean)=>void}

/**
 * Transporte apoiado no engine de verdade.
 *
 * Cumpre o mesmo contrato do simulado, então rota e interface não sabem qual
 * dos dois está no comando. A diferença é que aqui o tempo não é calculado:
 * ele é reportado por quem está de fato tocando o arquivo.
 */
/** Espera entre tentativas de subir o engine de novo. */
const RESTART_DELAY_MS = 1_000
/** Limite para um defeito persistente não virar uma tempestade de processos. */
// Um binário ausente ou uma dependência do GStreamer quebrada não se resolve
// em segundos. Limitar a cinco minutos evita a tempestade de processos que
// consome CPU/GPU enquanto ainda preserva a recuperação automática depois que
// o operador corrige a instalação.
const RESTART_BACKOFF_MAX_MS = 300_000
/**
 * Quanto tempo **observado** sem quadro novo é considerado congelamento.
 *
 * O engine reporta o contador a cada segundo; três segundos sem andar é longe
 * demais de um soluço e perto o bastante para o ar não ficar preto meio minuto.
 */
const STALL_MS = 3_000
/**
 * Prazo para o primeiro quadro depois de subir o processo.
 *
 * Montar o pipeline não é instantâneo: há codificador para inicializar (NVENC
 * demora), placa para abrir e estado para chegar em PLAYING. Enquanto isso o
 * contador está em zero, e cobrar do processo recém-nascido o mesmo prazo de
 * um canal em regime é o que fecha o laço mais cruel deste arquivo -- matar
 * porque não subiu a tempo, e a morte custar mais uma montagem, para sempre.
 */
const BOOT_MS = 20_000
/** A fresh portable GStreamer registry can take longer than pipeline startup.
 * Before native Ready there is no program to preserve; allow bounded cold
 * discovery without killing a healthy first launch every twenty seconds.
 * Does not change the independent native HA lease or the 3s running watchdog. */
const COLD_START_MS = 90_000
/**
 * Maior intervalo entre dois tiques que ainda conta como tempo observado.
 *
 * O tique nominal é de 50 ms. Um intervalo muito maior que isso quer dizer que
 * o laço de eventos do Node ficou preso -- varredura de acervo, uma resposta
 * grande, o que for. E aqui está a armadilha: o relatório de quadros chega
 * pelo **mesmo** laço. Quando ele destrava, o Node roda a fase de temporizador
 * antes da de entrada e saída, então o watchdog acorda primeiro e vê um vão de
 * vários segundos com o contador parado -- só que parado porque ninguém leu, e
 * não porque ninguém produziu. Contar esse vão contra o engine é acusar quem
 * estava trabalhando. Tempo que não pudemos observar não conta.
 */
const TIQUE_SADIO_MS = 250
/**
 * Quanto esperamos um processo mandado matar de fato morrer.
 *
 * Passado disso, o problema deixou de ser o motor travado e passou a ser o
 * nosso pedido de encerrar não ter surtido efeito -- e essas duas coisas
 * pedem providências diferentes de quem opera.
 */
const MORTE_DEMORADA_MS = 10_000
/**
 * Por quanto tempo um aviso do motor continua valendo como alerta.
 *
 * Descarte de quadro é rajada: o aviso chega enquanto a máquina está apertada
 * e some quando alivia. Segurar por meio minuto é o que faz o operador ver o
 * recado mesmo tendo olhado para a tela depois -- e é curto o bastante para o
 * alerta sumir sozinho quando o problema passa.
 */
const AVISO_VALE_MS = 30_000

/** Espera antes de uma nova tentativa, limitada para não gerar tempestade. */
export function restartDelayMs(consecutiveFailures: number): number {
  const streak = Number.isFinite(consecutiveFailures)
    ? Math.max(0, Math.floor(consecutiveFailures))
    : 0
  return Math.min(RESTART_BACKOFF_MAX_MS, RESTART_DELAY_MS * 2 ** Math.min(streak, 9))
}

/** Perfil que pode ser substituído sem recriar o processo do engine. */
export interface HotOutputProfile {
  readonly id: string
  readonly kind: 'rtmp' | 'srt' | 'file'
  readonly target: string
  readonly width?: number
  readonly height?: number
  readonly rateNum?: number
  readonly rateDen?: number
  readonly scan?: 'progressive' | 'interlaced'
  readonly bitrateKbps?: number
  readonly role?: 'mon'
}

/** O que o watchdog sabe do motor entre um tique e o outro. */
export interface Vigilia {
  /** Milissegundos desde o tique anterior. */
  vao: number
  /** O contador de quadros mudou desde o último tique? */
  andou: boolean
  /** Silêncio já observado, em milissegundos. */
  semQuadroMs: number
  /** O contador já andou alguma vez desde que este processo subiu? */
  booted: boolean
  /** False only while the native process has not confirmed pipeline startup. */
  ready?: boolean
}

/**
 * A decisão do watchdog, sem processo nenhum por perto.
 *
 * Está separada porque é a única parte que dá para testar sem subir um engine
 * de verdade -- e é justamente a parte que errava.
 */
export function decidirVigilia(v: Vigilia): {
  semQuadroMs: number
  booted: boolean
  matar: boolean
} {
  if (v.andou) return { semQuadroMs: 0, booted: true, matar: false }
  const semQuadroMs = v.semQuadroMs + (v.vao <= TIQUE_SADIO_MS ? v.vao : 0)
  return {
    semQuadroMs,
    booted: v.booted,
    matar: semQuadroMs >= (v.booted ? STALL_MS : v.ready===false ? COLD_START_MS : BOOT_MS),
  }
}

export class EngineTransport implements Transport {
  private readonly startupWaiters=new Set<{resolve:()=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>()
  private child: ChildProcess
  private nextId = 1
  private rundownId: string | null = null
  private onAirItemId: string | null = null
  private armedItemId: string | null = null
  /** Preroll antecipado em andamento; evita enfileirar o mesmo load a cada tick. */
  private preparingItemId: string | null = null
  /** Falhas de preroll desta versão da grade; uma mídia ruim não vira tempestade. */
  private readonly preparationFailures = new Set<string>()
  private preparationView: RundownView | null = null
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
  private liveStartedAtMs: number | null = null
  private priorityObservedAt: number | null = null
  private priorityContext: string | null = null
  private readonly handledPriorityLives = new Set<string>()
  private priorityTake: LivePriorityEvent | null = null
  private preview: PreviewTarget | null = null
  private previewSpecification: string | null = null
  private previewFileVersion: string | null = null
  /** TAKE ao vivo aceito, porém aguardando o primeiro quadro no PGM. */
  private pendingLiveTake: { rundownId: string; itemId: string; spec: EngineItem } | null = null
  private pendingPlaylistTake: { view: RundownView; spec: EngineItem; commit: (previous: { itemId: string; frames: number } | null) => void; confirmed: boolean; failure: Error | null; settled?:()=>void } | null = null
  private previewPosition: { frames: Frames; duration: Frames } | null = null
  private meter: MeterReading | null = null
  private previewReading: MeterReading | null = null
  private pgmVideoProbe: { luma: number; black: boolean; freeze: boolean } | null = null
  /** Uma entrada por saída de rede, chaveada pela URL de destino. */
  private readonly publisherStates = new Map<string, PublisherState>()
  /** Estado comprovado das fontes vivas abertas nesta sessão. */
  private readonly sourceSignals = new Map<string, LiveSourceSignal>()
  private dirty = false
  private alive = true
  private readonly args: string[]
  private readonly binary: string
  /** Watchdog: quadros do programa e há quanto tempo observado eles não andam. */
  private framesOut = 0
  private lastFrames = 0
  /** Milissegundos de silêncio que o watchdog de fato conseguiu observar. */
  private semQuadroMs = 0
  /** Instante do tique anterior, para saber quanto do vão pôde ser observado. */
  private lastTick = Date.now()
  /** O contador já andou desde que este processo subiu? */
  private booted = false
  private ready = false
  private restartAt: number | null = null
  /** Reinícios consecutivos sem um quadro saudável entre eles. */
  private restartStreak = 0
  /** Quantas vezes o engine já teve de ser ressuscitado neste canal. */
  restarts = 0
  /** Dessas, quantas foram morte do processo e quantas foram nós que matamos. */
  private deaths = 0
  private stalls = 0
  /** Último erro do engine, para a interface não ficar adivinhando. */
  lastError: string | null = null
  /** Configuration restoration must not race a decoder awaiting TAKE. */
  hasPendingCommand(): boolean { return this.pending.size > 0 || this.pendingLiveTake !== null || this.priorityTake !== null || this.pendingPlaylistTake !== null || this.advancing || this.preparingBoundary }
  /** Último aviso e quando ele chegou. Caduca sozinho: veja `AVISO_VALE_MS`. */
  private lastWarning: string | null = null
  private warningAt = 0
  private closed = false
  private operation: Promise<void> = Promise.resolve()
  private readonly fileVersions = new FileVersionVerifier()
  private readonly pending = new Map<number, {
    resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; since: number
  }>()
  private readonly desiredMonitors = new Map<'pvw' | 'mon', boolean>()
  private recoveryCursor: { itemId: string; frames: Frames } | null = null
  private programEndReason = 'STOP'
  private pendingProgramExit: {itemId:string;frames:number;reason:string;targetItemId:string} | null = null
  private armedSpecification: string | null = null
  private armedFileVersion: string | null = null
  private advancing = false
  private preparingBoundary = false
  private nextBoundaryPreparationAt = 0
  private desiredGraphic: { svg: string | null; fadeMs: number } | null = null
  private committedOutputs:readonly string[]
  private fenceOwner:string|null=null
  private fencePendingOwner:string|null=null
  private fenceTerm:number|null=null
  private fenceNonce=0

  constructor(
    private readonly channel: Channel,
    private readonly view: () => RundownView | null,
    /** Acervo, para o preview abrir arquivo que nem está na grade. */
    private readonly asset: (assetId: string) => MediaAsset | null,
    private readonly options: EngineOptions,
  ) {
    this.committedOutputs=[...options.outputs]
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
      '--audio-channels',
      String(channel.audioChannels??2),
      // A varredura muda a cadência de composição dentro do engine, nunca a da
      // grade: 1080i5994 são 29,97 quadros aqui e 59,94 campos lá dentro.
      '--scan',
      channel.scan === 'INTERLACED' ? 'interlaced' : 'progressive',
      '--field-order',
      channel.fieldOrder === 'BFF' ? 'bff' : 'tff',
    ]
    args.push('--private-outputs-stdin')

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
    this.fenceOwner=this.options.fenceLease?randomUUID():null
    this.fencePendingOwner=null;this.fenceTerm=null;this.fenceNonce=0
    // O launcher pode ser iniciado pelo Explorer, sem o PATH do GStreamer.
    // Nesse caso o Windows encerra o processo com 0xC0000135 antes de ele
    // escrever qualquer log. Inclua a instalação padrão explicitamente.
    const gstBin = process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64
      ? join(process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64, 'bin')
      : 'C:\\Program Files\\gstreamer\\1.0\\msvc_x86_64\\bin'
    const envPath = process.platform === 'win32'
      ? `${gstBin};${process.env.PATH ?? ''}`
      : process.env.PATH
    const child = spawn(this.binary, this.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...mediaProcessEnvironment(), PATH: envPath },
    })
    try{this.options.onProcessStarted?.(child.pid??null)}catch(error){child.kill('SIGKILL');throw error}
    child.on('error', (error) => {
      if (this.closed || this.child !== child) return
      this.alive = false
      this.ready = false
      this.fail(`Não foi possível iniciar o engine: ${error.message}`)
      this.rejectPending(this.lastError!)
      this.dirty = true
    })

    if (child.stdout) {
      createInterface({ input: child.stdout }).on('line', (line) => {
        if (!this.closed && this.child === child) this.absorb(line)
      })
    }
    // O engine loga no stderr de propósito, para nunca sujar o canal de dados.
    const diagnostics = new DiagnosticLines(line => process.stderr.write(`[engine ${sanitizeDiagnostic(this.channel.name)}] ${line}\n`))
    child.stderr?.on('data', (chunk: Buffer) => diagnostics.write(chunk))
    child.stderr?.on('end', () => diagnostics.end())
    // Cano quebrado não pode derrubar o servidor.
    //
    // Escrever na entrada de um processo que já morreu emite `error` no
    // socket, e evento `error` sem ouvinte em Node **encerra o processo**. O
    // caminho é curtíssimo: o engine cai (o que acontece), alguém apaga o
    // canal, o `close()` escreve o `shutdown` no filho morto, e o servidor
    // inteiro vai junto -- levando os outros canais, que não tinham nada com
    // isso. Foi assim que apagar canal virou "Internal Server Error".
    child.stdin?.on('error', (erro) => {
      if (this.closed || this.child !== child) return
      this.alive = false
      this.lastError = sanitizeDiagnostic(`A entrada do engine fechou: ${erro.message}`)
      this.rejectPending(this.lastError)
      child.kill()
    })
    child.stdout?.on('error', () => {})
    child.stderr?.on('error', () => {})

    child.on('exit', (code, signal) => {
      if (this.closed || this.child !== child) return
      this.alive = false
      if (this.onAirItemId) {
        this.recoveryCursor = { itemId: this.onAirItemId, frames: this.elapsed }
        this.reportProgramCleared(code===75?'HA_FENCE_EXPIRED':'ENGINE_FAILURE')
      }
      this.onAirItemId = null
      this.armedItemId = null
      this.armedSpecification = null
      this.meter = SILENCE
      this.previewReading = SILENCE
      this.publisherStates.clear()
      // Sinal e código separados: quem morreu por SIGKILL nosso não é o mesmo
      // caso de quem morreu por conta própria, e a mensagem tem de deixar isso
      // legível para quem está lendo o log às três da manhã.
      this.lastError = code===75?'Posse HA expirou no engine nativo; publicação encerrada antes de nova concessão.':signal
        ? `O engine foi encerrado por ${signal}.`
        : `O engine encerrou com código ${code ?? 'desconhecido'}.`
      for (const value of this.sourceSignals.values()) {
        if (value.state === 'IDLE') continue
        for (const bus of ['pgm','pvw'] as const) this.updateSource({ itemId: value.itemId, source: value.source }, 'LOST', 'Engine encerrado; aguardando nova confirmação de sinal.', bus)
      }
      this.failPriorityTake(this.lastError)
      this.pendingLiveTake = null
      this.liveStartedAtMs = null
      if (!this.matandoPorTravamento) this.deaths += 1
      this.matandoPorTravamento = false
      this.mateiEm = null
      this.rejectPending(this.lastError)
      this.dirty = true
    })

    // Private pipe is also reused after a watchdog restart. Do not place URLs
    // in argv or environment variables (both are visible in process tools).
    child.stdin?.write(JSON.stringify({ outputs: this.committedOutputs, preview: this.options.preview,...(this.options.qcPreview?{qcPreview:this.options.qcPreview}:{}),...(this.fenceOwner?{fenceOwner:this.fenceOwner}:{}) }) + '\n')
    this.alive = true
    this.ready = false
    this.framesOut = 0
    this.lastFrames = 0
    this.semQuadroMs = 0
    this.lastTick = Date.now()
    this.booted = false
    return child
  }

  /** Verdadeiro entre o nosso SIGKILL e o `exit` que ele provoca. */
  private matandoPorTravamento = false
  /** Quando mandamos matar. Nulo quer dizer que não há morte pendente. */
  private mateiEm: number | null = null

  private absorb(line: string): void {
    if (line.trim() === '') return

    let event: EngineEvent
    try {
      event = JSON.parse(line) as EngineEvent
    } catch {
      return
    }

    switch (event.event) {
      case 'fenceRequest': {
        const obtain=this.options.fenceLease,owner=this.fenceOwner,child=this.child
        if(!obtain||event.ownerId!==owner||!Number.isSafeInteger(event.nonce)||event.nonce<=0||this.fencePendingOwner===owner)break
        this.fencePendingOwner=owner
        void obtain(owner,event.nonce).then(grant=>{
          if(this.closed||this.child!==child||this.fenceOwner!==owner)return
          this.send({cmd:'fenceGrant',ownerId:owner,nonce:event.nonce,term:grant.term,ttlMs:grant.ttlMs})
        }).catch(()=>{if(!this.closed&&this.child===child)this.fail('Concessão HA não confirmada; engine nativo encerrará a publicação ao expirar a posse.')})
          .finally(()=>{if(this.fencePendingOwner===owner)this.fencePendingOwner=null})
        break
      }
      case 'fenceApplied':
        if(this.options.fenceLease&&Number.isSafeInteger(event.term)&&event.term>0&&event.nonce>this.fenceNonce){this.fenceTerm=event.term;this.fenceNonce=event.nonce;this.dirty=true}
        break
      case 'ready':
        if(this.options.fenceLease&&this.fenceTerm===null){this.fail('Engine não confirmou a cerca HA nativa; publicação recusada.');this.child.kill('SIGKILL');break}
        // Erros de uma sessão anterior não podem manter readiness em 503
        // depois que o novo processo confirmou inicialização.
        this.lastError = null
        if(!this.booted)this.semQuadroMs=0
        this.ready = true
        for(const waiter of this.startupWaiters){clearTimeout(waiter.timer);waiter.resolve()}
        this.startupWaiters.clear()
        this.dirty = true
        break
      case 'state':
        if (this.onAirItemId && !event.onAir) this.reportProgramCleared(this.programEndReason)
        if (this.priorityTake && this.onAirItemId === this.priorityTake.previousItemId && event.onAir === this.priorityTake.itemId) this.priorityTake.previousFrames = this.elapsed
        this.onAirItemId = event.onAir ?? null
        if (this.armedItemId !== (event.armed ?? null)) this.armedSpecification = null
        this.armedItemId = event.armed ?? null
        const playlistTake = this.pendingPlaylistTake
        if (playlistTake && !playlistTake.confirmed && playlistTake.spec.itemId === this.onAirItemId) {
          playlistTake.confirmed = true
          // Install the execution snapshot before checkpoint/as-run callbacks.
          // A successful load or an ACK alone cannot replace the running plan.
          try {
            playlistTake.commit(this.pendingProgramExit)
          } catch (error) {
            playlistTake.failure = new Error('O engine confirmou a troca de PGM, mas o registro da playlist falhou: ' + (error instanceof Error ? error.message : String(error)))
            this.fail(playlistTake.failure.message)
          }
          this.confirmTake(playlistTake.view.rundown.id, playlistTake.spec)
          if(playlistTake.spec.source)this.updateSource(playlistTake.spec,'ON_PGM',null)
          playlistTake.settled?.()
        }
        if (this.pendingLiveTake?.itemId === this.onAirItemId) {
          this.confirmLiveTake(this.pendingLiveTake)
        }
        this.dirty = true
        break
      case 'position':
        // A posição é a fonte da verdade sobre quanto já foi ao ar.
        if (event.itemId === this.onAirItemId) this.elapsed = event.frames
        if (this.pendingProgramExit?.itemId===event.itemId && event.itemId!==this.pendingProgramExit.targetItemId) this.pendingProgramExit.frames=event.frames
        break
      case 'previewPosition':
        // Fonte direta não possui id de item/asset; vídeo ao vivo não envia
        // posição pesquisável de qualquer forma.
        if (this.preview?.kind !== 'SOURCE' && this.preview && event.itemId === this.preview.id) {
          this.previewPosition = { frames: event.frames, duration: event.duration }
          this.dirty = true
        }
        break
      case 'eos':
        if (event.itemId === this.onAirItemId) {
          this.programEndReason = 'EOS'
          this.advanceAfter(event.itemId)
        }
        break
      case 'itemError':
        this.updateSourceForItem(event.itemId, 'FAILED', event.message, event.bus)
        this.fail(event.message)
        if (this.pendingLiveTake?.itemId === event.itemId) {
          this.pendingLiveTake = null
          this.pendingProgramExit = null
        }
        if (this.pendingPlaylistTake?.spec.itemId === event.itemId && !this.pendingPlaylistTake.confirmed) {this.pendingPlaylistTake.failure = new Error(sanitizeDiagnostic(event.message));this.pendingPlaylistTake.settled?.()}
        if (this.priorityTake?.itemId === event.itemId) {
          this.failPriorityTake(event.message)
        }
        if (event.bus === 'pgm' && event.itemId === this.onAirItemId) {
          this.programEndReason = 'FAILED_MEDIA_ERROR'
          this.advanceAfter(event.itemId, true)
        }
        break
      case 'sourceLost':
        // Fonte ao vivo que cai não anda com a grade: o estúdio pode voltar, e
        // a hora de sair continua sendo a que a grade marcou. O engine fica
        // tentando reabrir; aqui só registramos para o operador ver.
        this.updateSourceForItem(event.itemId, 'LOST', event.reason)
        this.fail(`fonte ao vivo caiu: ${event.reason}`)
        break
      case 'sourceReady':
        this.updateSourceForItem(event.itemId, event.bus === 'pgm' ? 'ON_PGM' : 'PVW_READY', null, event.bus)
        this.dirty = true
        break
      case 'sourceTelemetry': {
        const source = this.sourceForItem(event.itemId)
        if (!source) break
        const previous = this.sourceSignals.get(source)
        if (!previous) break
        // Decoded input telemetry is independent for PGM and PVW. Preparing
        // the same source in QC cannot erase its confirmed program tally.
        this.sourceSignals.set(source, { ...previous, measurements: { ...previous.measurements,
          [event.bus]: { ...event.signal, sampledAt: new Date().toISOString() } } })
        this.dirty = true
        break
      }
      case 'levels':
        if (event.bus === 'pgm') this.meter = toMeter(event)
        else this.previewReading = toMeter(event)
        break
      case 'videoProbe':
        this.pgmVideoProbe = { luma: event.luma, black: event.black, freeze: event.freeze }
        break
      case 'publisher':
        this.publisherStates.set(event.outputId ?? event.url, {
          url: event.url,
          health: event.health,
          attempts: event.attempts,
          delivered: event.delivered,
          error: event.error == null ? event.error : sanitizeDiagnostic(event.error),
        })
        break
      case 'output':
        // Contador de quadros do programa: é a prova objetiva de que o canal
        // continua produzindo, e o que o watchdog observa.
        this.framesOut = event.frames
        break
      case 'ack':
        {
          const pending = this.pending.get(event.id)
          if (pending) {
            clearTimeout(pending.timer)
            this.pending.delete(event.id)
            if (event.ok) pending.resolve()
            else pending.reject(new Error(sanitizeDiagnostic(event.error ?? 'O engine recusou o comando.')))
          }
        }
        if (!event.ok && event.error) this.fail(event.error)
        break
      case 'error':
        this.fail(event.message)
        break
      case 'warning':
        // Aviso não é falha: não mexe em `lastError`, que é o que a interface
        // mostra como "o motor está com problema". Vive por conta própria e
        // caduca sozinho.
        this.lastWarning = sanitizeDiagnostic(event.message)
        this.warningAt = Date.now()
        this.dirty = true
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
    this.lastError = sanitizeDiagnostic(message)
    this.dirty = true
    process.stderr.write(`[engine ${sanitizeDiagnostic(this.channel.name)}] ERRO ${this.lastError}\n`)
  }

  /**
   * Grafismo no programa. O engine recebe SVG pronto: quem preenche campo é o
   * servidor, e assim o modelo de template muda sem recompilar o que está no
   * ar.
   */
  graphic(svg: string | null, fadeMs: number): void {
    this.desiredGraphic = { svg, fadeMs }
    this.send({ cmd: 'graphic', svg, fadeMs })
  }
  graphicConfirmed(svg: string | null, fadeMs: number): Promise<void> {
    return this.enqueue(async () => {
      await this.request({ cmd: 'graphic', svg, fadeMs })
      this.desiredGraphic = { svg, fadeMs }
    })
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
    if (this.closed) return
    const agora = Date.now()
    const vao = agora - this.lastTick
    this.lastTick = agora

    if (!this.alive) {
      if(this.options.canRestartEngine && !this.options.canRestartEngine())return
      // Backoff progressivo: se o engine não sobe, insistir sem pausa
      // transforma um defeito em tempestade de processos. Aumentamos somente
      // entre mortes consecutivas; um processo que voltou a produzir quadro
      // limpa a sequência mais abaixo.
      const espera = restartDelayMs(this.restartStreak)
      this.restartAt ??= agora + espera
      if (agora < this.restartAt) return

      this.restartAt = null
      this.restartStreak += 1
      this.restarts += 1
      this.child = this.spawnChild()
      this.restore()
      return
    }

    // load/preview fazem preroll síncrono no Rust. Nesse intervalo o contador
    // não é publicado, embora o pipeline do programa continue trabalhando.
    if ([...this.pending.values()].some((command) => agora - command.since < 30_000)) {
      this.semQuadroMs = 0
      return
    }

    const decisao = decidirVigilia({
      vao,
      andou: this.framesOut !== this.lastFrames,
      semQuadroMs: this.semQuadroMs,
      booted: this.booted,
      ready: this.ready,
    })
    const andou = this.framesOut !== this.lastFrames
    this.lastFrames = this.framesOut
    this.semQuadroMs = decisao.semQuadroMs
    this.booted = decisao.booted
    if (andou) this.restartStreak = 0
    if (!decisao.matar) return

    // Vivo e parado: derruba: o caminho de volta é o mesmo do processo morto,
    // e ter um caminho só é o que faz o conserto ser testável.
    //
    // A mensagem carrega a prova. "O motor precisou ser levantado 21x" sem
    // dizer o que foi visto manda o operador procurar uma queda que talvez
    // nunca tenha existido -- foi exatamente o que aconteceu aqui.
    // Uma travada é uma travada, mesmo que o processo demore a morrer -- ou não
    // morra. Contar de novo a cada tentativa fazia o alerta dizer "levantado 1x
    // (4 por ficar sem entregar quadro)", números que não fecham entre si e
    // que mandam procurar quatro quedas onde houve uma.
    if (this.mateiEm === null) this.stalls += 1
    this.fail(
      this.booted
        ? `O programa parou de produzir quadros: ${(this.semQuadroMs / 1000).toFixed(1)}s ` +
            `observados sem sair do quadro ${this.framesOut}. Reiniciando o engine.`
        : `O engine não produziu o primeiro quadro em ${(this.semQuadroMs / 1000).toFixed(1)}s ` +
            'desde que subiu. Reiniciando o engine.',
    )
    this.semQuadroMs = 0
    this.matandoPorTravamento = true
    // Processo que não morre depois de mandado matar é um caso à parte, e
    // grave: o watchdog acha que levantou o motor e não levantou. Sem dizer
    // isso, o canal fica preto para sempre com o log jurando que agiu.
    if (this.mateiEm !== null && Date.now() - this.mateiEm > MORTE_DEMORADA_MS) {
      this.fail(
        `Mandei encerrar o engine há ${((Date.now() - this.mateiEm) / 1000).toFixed(0)}s e ` +
          'ele não encerrou. O canal não vai voltar sozinho.',
      )
    }
    this.mateiEm ??= Date.now()
    this.child.kill('SIGKILL')
  }

  /** Aviso recente do motor, ou nulo se não houve nenhum ou já caducou. */
  warning(): string | null {
    if (this.lastWarning === null) return null
    if (Date.now() - this.warningAt > AVISO_VALE_MS) return null
    return this.lastWarning
  }

  health(): { restarts: number; deaths: number; stalls: number; error: string | null; ready: boolean;fencing:{enabled:boolean;term:number|null;nonce:number} } {
    return {
      restarts: this.restarts,
      deaths: this.deaths,
      stalls: this.stalls,
      error: this.lastError,
      ready: this.alive && !this.closed && this.ready && this.recoveryCursor === null,
      fencing:{enabled:Boolean(this.options.fenceLease),term:this.fenceTerm,nonce:this.fenceNonce},
    }
  }

  /** Põe de volta no ar o que estava no ar quando o engine caiu. */
  private restore(): void {
    for (const [bus, on] of this.desiredMonitors) this.send({ cmd: 'monitor', bus, on })
    if (this.desiredGraphic) this.send({ cmd: 'graphic', ...this.desiredGraphic })
    const cursor = this.recoveryCursor
    if (cursor && this.rundownId) void this.recover(this.rundownId, cursor.itemId, cursor.frames)
      .catch((error: Error) => this.fail(error.message))
    else if (this.preview) void this.cue(this.preview).catch((error: Error) => this.fail(error.message))
  }

  /**
   * Troca o destino de um slot RTMP/SRT/FILE já existente sem recriar o PGM.
   * O engine conserva os canais interligados e substitui só o publisher.
   * Criar/remover slots ou mexer em SDI/NDI/OMT continua exigindo reinício
   * controlado, pois essas operações alteram a topologia/relógio do canal.
   */
  reconfigureOutput(output: HotOutputProfile): Promise<void> {
    return this.enqueue(() => this.request({ cmd: 'replaceOutput', outputId: output.id, output }))
  }

  /** Called synchronously only after the configuration transaction commits.
   * The watchdog must never boot the obsolete destination after a hot ACK. */
  commitOutputProfile(output:HotOutputProfile):void{
    let found=false
    const updated=this.committedOutputs.map(encoded=>{
      try{if(JSON.parse(encoded).id===output.id){found=true;return JSON.stringify(output)}}catch{/* legacy shortcuts have no stable slot ID */}
      return encoded
    })
    if(!found)throw new Error('A saída não pertence à configuração de partida deste engine. Reconcilie o canal antes de outra troca.')
    this.committedOutputs=updated
  }

  /** Configuration DB work and publisher ACK share one queue entry. The
   * supplied apply function must only be used during this awaited callback. */
  mutateConfiguration<T>(action: (apply: (output: HotOutputProfile) => Promise<void>) => Promise<T>): Promise<T> {
    return this.mutatePlaylist(() => action(output => this.request({ cmd: 'replaceOutput', outputId: output.id, output })))
  }

  private rejectPending(message: string): void {
    for(const waiter of this.startupWaiters){clearTimeout(waiter.timer);waiter.reject(new Error(message))}
    this.startupWaiters.clear()
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error(message))
    }
    this.pending.clear()
  }

  private enqueue<T>(action: () => Promise<T>, requireAlive = true): Promise<T> {
    const result = this.operation.then(() => {
      if (this.closed || requireAlive && !this.alive) throw new Error('O engine está indisponível.')
      return action()
    })
    this.operation = result.then(() => {}, () => {})
    return result
  }

  /** Publication shares the native transport queue. Its DB commit and runtime
   * installation cannot overtake a CUE/TAKE still preparing a decoder. A live
   * ACK isn't a confirmed cut, so that separate pending state is refused. */
  mutatePlaylist<T>(action: () => Promise<T>, changesExecution = () => true): Promise<T> {
    return this.enqueue(async () => {
      if (changesExecution() && (this.pendingLiveTake || this.priorityTake)) throw new Error('Há uma entrada ao vivo aguardando confirmação. Cancele pelo CUE/STOP ou aguarde o PGM antes de ativar outra revisão.')
      return action()
    }, false)
  }

  private awaitNativeReady():Promise<void>{
    if(this.ready)return Promise.resolve()
    if(!this.alive||this.closed)return Promise.reject(new Error('O engine está indisponível.'))
    return new Promise((resolve,reject)=>{
      const waiter={resolve,reject,timer:setTimeout(()=>{
        const message='O engine não confirmou Ready em 90 segundos. Confira plugins/runtime; nenhum TAKE foi enviado.'
        this.fail(message);this.alive=false;this.rejectPending(message);this.child.kill('SIGKILL')
      },COLD_START_MS)}
      this.startupWaiters.add(waiter)
    })
  }

  private async request(command: Record<string, unknown>): Promise<void> {
    // Starting a 30s decoder/ACK deadline before gst_init has scanned a fresh
    // registry kills a valid cold launch. Wait for real native Ready first;
    // close/exit/startup timeout reject this wait, never fabricate readiness.
    await this.awaitNativeReady()
    if (!this.alive || this.closed) return Promise.reject(new Error('O engine está indisponível.'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const message = `O engine não confirmou ${String(command.cmd)} em 30 segundos.`
        this.fail(message)
        this.alive = false
        this.rejectPending(message)
        this.child.kill()
      }, 30_000)
      this.pending.set(id, { resolve, reject, timer, since: Date.now() })
      this.child.stdin?.write(`${JSON.stringify({ id, ...command })}\n`, (error) => {
        if (error) this.rejectPending(error.message)
      })
    })
  }

  private send(command: Record<string, unknown>): void {
    if (!this.alive || this.closed) return
    try {
      this.child.stdin?.write(`${JSON.stringify({ id: this.nextId++, ...command })}\n`)
    } catch (falha) {
      // O filho morreu entre a checagem e a escrita. Não há a quem mandar a
      // ordem, e derrubar o servidor por causa disso seria trocar um canal
      // perdido por todos eles.
      this.alive = false
      this.lastError = falha instanceof Error ? sanitizeDiagnostic(falha.message) : 'O engine não aceitou a ordem.'
    }
  }

  /** Traduz um item da grade para o que o engine sabe abrir. */
  private specFor(itemId: string, view: RundownView | null = this.view()): EngineItem | null {
    const entry = view?.items.find((candidate) => candidate.item.id === itemId)
    if (!entry) return null
    const auxiliaryPairs=entry.audio?.auxiliaryPairs??[]
    const track=entry.item.audioTrack??0
    const known=knownInputAudioChannels(entry.asset,track)
    if(validateAuxiliaryPairs(auxiliaryPairs,this.channel.audioChannels??2,known))return null
    // An old/imported AUTO preset is not proof of the loudness of a new mix.
    if(entry.audio?.mode==='AUTO' && (resolvedAudioRouting(entry.audio).mode!=='DEFAULT'||(entry.item.audioTrack??0)>0||entry.audio.analysisId) && !entry.audio.measured)return null

    // Item ao vivo não tem arquivo: tem fonte, e a duração vem da grade, não do
    // conteúdo. Corte em zero é a forma de dizer isso ao engine.
    const sourceRef = entry.item.sourceRef ?? entry.item.liveEndpoint ?? entry.item.liveConfig?.sourceEndpoint
    if (sourceRef) {
      const source = resolveSource(sourceRef)
      if (!source) return null
      return {
        itemId,
        path: '',
        source,
        trimIn: 0,
        trimOut: 0,
        gainDb: entry.gainDb,
        audioTrack:entry.item.audioTrack??0,
        audioRouting:entry.audio?resolvedAudioRouting(entry.audio):{mode:'DEFAULT'},
        auxiliaryPairs,
        fit: entry.item.fit,
      }
    }

    if (!entry.asset || entry.asset.probeError || entry.asset.ignored || !qcApproved(entry.asset.qcStatus ?? 'APPROVED') || entry.asset.kind !== 'VIDEO' || (view?.channel.qcProfile && !assessQc(entry.asset, view.channel.qcProfile).playable)) return null
    if ((view?.rundown.publicationRequired || this.options.executionIdentity?.()) && !isMediaSha(entry.asset.contentHash)) return null

    // Imagem parada não tem tempo dentro do arquivo: o corte dela é a duração
    // que a grade marcou. Sem isto o item entraria com zero quadro.
    const still = isStill(entry.asset)
    const stillOut =
      entry.item.durationOverride ?? secondsToFrames(STILL_DEFAULT_SECONDS, this.channel.rate)

    return {
      itemId,
      path: entry.asset.path,
      contentHash: entry.asset.contentHash,
      trimIn: still ? 0 : entry.trim.in,
      trimOut: still ? stillOut : entry.trim.out,
      gainDb: entry.gainDb,
      fit: entry.item.fit,
      audioTrack: entry.item.audioTrack ?? 0,
      audioRouting:entry.audio?resolvedAudioRouting(entry.audio):{mode:'DEFAULT'},
      auxiliaryPairs,
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

    // Uma fonte ao vivo aberta no MAM/QC não é um asset. Abrir a mesma URI
    // aqui reaproveita o pipeline de ingestão do engine e evita uma segunda
    // chamada HTTP/RTSP/SRT só para desenhar o PVW.
    if (target.kind === 'SOURCE') {
      const source = resolveSource(target.source)
      return source ? { itemId: `source:${source}`, path: '', source, trimIn: 0, trimOut: 0, gainDb: 0 } : null
    }

    const asset = this.asset(target.id)
    // Inspection is allowed before approval. Only specFor/PGM gates QC status.
    if (!asset || asset.probeError || asset.kind !== 'VIDEO') return null
    return {
      itemId: asset.id,
      path: asset.path,
      contentHash: asset.contentHash,
      trimIn: 0,
      // A parada não acaba sozinha: no preview ela fica um tempo fixo, o
      // suficiente para o operador olhar.
      trimOut: isStill(asset)
        ? secondsToFrames(STILL_DEFAULT_SECONDS, this.channel.rate)
        : durationIn(asset, this.channel.rate),
      gainDb: 0,
    }
  }

  private async checkFile(spec: EngineItem): Promise<string | null> {
    if (spec.source) return null
    if (spec.path.includes('://')) {
      if (isMediaSha(spec.contentHash)) throw new MediaVersionError('Versão de mídia não é um arquivo local verificável. Importe e publique uma cópia local antes de usar no ar.')
      return null // Unversioned legacy URIs are not proof of an approved SHA.
    }
    let identity: string
    try {
      const info = await stat(spec.path, { bigint: true })
      if (!info.isFile()) throw new Error('não é arquivo')
      identity = mediaFileIdentity(info)
    } catch {
      throw new Error('Arquivo indisponível: ' + spec.path)
    }
    if (isMediaSha(spec.contentHash)) {
      let verified: string | null = null
      try { verified = await this.fileVersions.verify(spec.path, spec.contentHash) } catch {}
      if (!verified) {
        if (this.armedItemId === spec.itemId) { this.armedSpecification = null; this.armedFileVersion = null }
        throw new MediaVersionError('O arquivo mudou ou sua versão publicada não pôde ser verificada. PGM anterior preservado; faça nova ingestão/QC e publique a versão correta, ou restaure a cópia da versão publicada.')
      }
      identity = verified
    }
    return identity
  }

  /** Uma passagem limitada: uma grade em loop só com falhas deve parar. */
  private async playFrom(rundownId: string, itemId: string, resumeFrames = 0, exact = false, copyRetry = true,lifecycle?:TakeLifecycle): Promise<void> {
    if(!lifecycle && this.options.canStartProgram?.()===false)throw new Error('Há TAKE de retorno inconclusivo. Pare o PGM, limpe o CUE e confira a pendência antes de outra entrada.')
    lifecycle?.validate()
    const view = this.view()
    const executionIdentity = this.options.executionIdentity?.()
    const index = view?.items.findIndex((entry) => entry.item.id === itemId) ?? -1
    if (!view || view.rundown.id !== rundownId || index < 0) throw new Error('O item não está nesta grade.')
    const candidates = exact ? [view.items[index]!] : [...view.items.slice(index), ...(view.rundown.loop ? view.items.slice(0, index) : [])]
    const failedPaths = new Set<string>()
    let lastFailure = 'Nenhum item disponível para reprodução.'
    let versionFailure = false
    for (const entry of candidates) {
      if (view.schedule.items.find((row) => row.id === entry.item.id)?.state === 'DROPPED') continue
      const spec = this.specFor(entry.item.id)
      if (!spec) {
        lastFailure = entry.item.title + ': ' + (entry.asset?.probeError ?? ((view.rundown.publicationRequired || this.options.executionIdentity?.()) && entry.asset && !isMediaSha(entry.asset.contentHash) ? 'mídia publicada sem SHA válido; reimporte, confira no QC e publique a versão correta' : 'sem arquivo ou fonte válida'))
        versionFailure = Boolean((view.rundown.publicationRequired || this.options.executionIdentity?.()) && entry.asset && !isMediaSha(entry.asset.contentHash))
        this.fail(lastFailure)
        continue
      }
      if (failedPaths.has(spec.path || spec.source!)) continue
      if (exact && this.preview?.kind === 'ITEM' && this.preview.id === spec.itemId && this.previewSpecification !== specificationKey(spec)) throw new Error('O item publicado mudou após o CUE. Faça CUE novamente para conferir a mídia e os cortes antes do TAKE.')
      if (spec.itemId === itemId && resumeFrames > 0) {
        spec.startOffsetFrames = spec.source ? Math.max(0, Math.floor(resumeFrames))
          : Math.min(Math.max(0, Math.floor(resumeFrames)), Math.max(0, spec.trimOut - spec.trimIn - 1))
      }
      try {
        const fileVersion = await this.checkFile(spec)
        lifecycle?.validate()
        if (exact && this.preview?.kind === 'ITEM' && this.preview.id === spec.itemId && this.previewFileVersion !== fileVersion) throw new MediaVersionError('O arquivo mudou após o CUE, mesmo que seu SHA tenha sido restaurado. Faça CUE novamente antes do TAKE; PGM anterior preservado.')
        if (this.armedItemId !== spec.itemId || this.armedSpecification !== specificationKey(spec) || this.armedFileVersion !== fileVersion) {
          this.armedItemId = null
          await this.request({ cmd: 'load', item: spec })
          this.armedSpecification = specificationKey(spec)
          this.armedFileVersion = fileVersion
        }
        const current = this.specFor(spec.itemId)
        if (current && spec.startOffsetFrames !== undefined) current.startOffsetFrames = spec.startOffsetFrames
        const changed = ['itemId','path','source','trimIn','trimOut','gainDb','fit','audioTrack','startOffsetFrames','audioRouting','auxiliaryPairs','contentHash'].filter(field => current && JSON.stringify(current[field as keyof EngineItem]) !== JSON.stringify(spec[field as keyof EngineItem]))
        const currentView = this.view(), hash = entry.asset?.contentHash
        // An archive/cache becoming available changes the decoder path, not
        // the published version. Runtime resolves those copies by SHA-256.
        // Re-preroll once at the new path before sending TAKE; never bypass a
        // changed revision/hash/QC/cut or reuse the already loaded old path.
        if (copyRetry && changed.length === 1 && changed[0] === 'path' && hash && /^[a-f0-9]{64}$/i.test(hash) && currentView?.items.find(row => row.item.id === spec.itemId)?.asset?.contentHash === hash && currentView.rundown.id === rundownId && this.options.executionIdentity?.() === executionIdentity && !(exact && this.preview?.kind === 'ITEM' && this.preview.id === spec.itemId)) return this.playFrom(rundownId, spec.itemId, resumeFrames, exact, false,lifecycle)
        if (this.view()?.rundown.id !== rundownId || this.options.executionIdentity?.() !== executionIdentity || !current || specificationKey(current) !== specificationKey(spec)) throw new Error(`A revisão ou a mídia mudou durante o preroll. PGM anterior preservado; faça CUE novamente. Contrato alterado: ${this.options.executionIdentity?.() !== executionIdentity ? 'revisão' : this.view()?.rundown.id !== rundownId ? 'grade' : !current ? 'disponibilidade/QC' : changed.join(', ')}.`)
        if (await this.checkFile(spec) !== fileVersion) {
          this.armedSpecification = null; this.armedFileVersion = null
          throw new MediaVersionError('O arquivo foi alterado durante o preroll, mesmo que seu SHA tenha sido restaurado. PGM anterior preservado; prepare o item novamente.')
        }
        const verifiedCurrent = this.specFor(spec.itemId)
        if (verifiedCurrent && spec.startOffsetFrames !== undefined) verifiedCurrent.startOffsetFrames = spec.startOffsetFrames
        if (this.view()?.rundown.id !== rundownId || this.options.executionIdentity?.() !== executionIdentity || !verifiedCurrent || specificationKey(verifiedCurrent) !== specificationKey(spec)) throw new Error('A revisão ou a mídia mudou durante a verificação. PGM anterior preservado; faça CUE novamente.')
        if(lifecycle && spec.source)throw new Error('Retorno de VT exige arquivo, não uma entrada ao vivo.')
        if(!lifecycle && this.options.canStartProgram?.()===false)throw new Error('Há retorno de VT inconclusivo. Nenhum TAKE será enviado.')
        lifecycle?.beforeTake()
        const pending = spec.source === undefined ? null : { rundownId, itemId: spec.itemId, spec }
        if (pending) {
          this.pendingLiveTake = pending
          this.updateSource(spec, 'TAKE_PENDING', 'Aguardando o primeiro quadro antes de trocar o PGM.')
        }
        this.pendingProgramExit=this.onAirItemId ? {itemId:this.onAirItemId,frames:Math.max(0,Math.floor(this.elapsed)),reason:this.priorityTake?.itemId===spec.itemId ? 'LIVE_PRIORITY' : this.programEndReason==='STOP' ? 'TAKE' : this.programEndReason,targetItemId:spec.itemId} : null
        await this.request({ cmd: 'take' })
        // O ACK de uma live só confirma que o decoder iniciou. A troca real
        // chega depois no evento `state`, quando há quadro no PGM.
        if (pending) {
          if (this.pendingLiveTake === pending && this.onAirItemId === spec.itemId) this.confirmLiveTake(pending)
          if (this.pendingLiveTake === pending) this.dirty = true
          return
        }
      } catch (failure) {
        this.pendingProgramExit=null
        if (this.pendingLiveTake?.itemId === spec.itemId) this.pendingLiveTake = null
        lastFailure = failure instanceof Error ? failure.message : 'Falha ao abrir item.'
        versionFailure = failure instanceof MediaVersionError
        this.fail(entry.item.title + ': ' + lastFailure)
        if(lifecycle)throw failure
        failedPaths.add(spec.path || spec.source!)
        // Sem engine não tente a grade inteira: deixe o watchdog recuperar.
        if (!this.alive || this.closed) throw failure
        continue
      }
      this.confirmTake(rundownId, spec)
      lifecycle?.confirmed(true)
      await this.request({ cmd: 'preview', item: null })
      return
    }
    // Uma tentativa manual fracassada preserva o que já estava no ar.
    if (!this.onAirItemId) this.preview = null
    this.dirty = true
    if (versionFailure) throw new MediaVersionError('Nenhum item reproduzível. ' + lastFailure)
    throw new Error('Nenhum item reproduzível. ' + lastFailure)
  }

  /** Recebe a confirmação tardia da primeira imagem ao vivo no PGM. */
  private confirmLiveTake(pending: { rundownId: string; itemId: string; spec: EngineItem }): void {
    if (this.pendingLiveTake !== pending) return
    this.pendingLiveTake = null
    this.updateSource(pending.spec, 'ON_PGM', null)

    // Só fecha o PVW se ele ainda representa a mesma entrada. Uma nova
    // seleção feita durante o preroll não pode ser apagada por confirmação
    // atrasada da fonte anterior.
    const samePreview =
      (this.preview?.kind === 'ITEM' && this.preview.id === pending.itemId) ||
      (this.preview?.kind === 'SOURCE' && this.preview.source === pending.spec.source)
    this.confirmTake(pending.rundownId, pending.spec)
    if (!samePreview) return
    void this.enqueue(() => this.request({ cmd: 'preview', item: null }))
      .catch((error: Error) => this.fail(error.message))
  }

  /** Estado compartilhado por qualquer TAKE já efetivado no PGM. */
  private confirmTake(rundownId: string, spec: EngineItem): void {
    const recovered = this.recoveryCursor?.itemId === spec.itemId
    const previous=this.pendingProgramExit
    this.pendingProgramExit=null
    this.programEndReason = 'STOP'
    if (this.priorityObservedAt === null) this.priorityObservedAt = Date.now()
    if (this.priorityTake?.itemId === spec.itemId) {
      this.emitLivePriority({ ...this.priorityTake, kind: 'CONFIRMED', occurredAt: new Date(Date.now()).toISOString() })
      this.priorityTake = null
    }
    this.recoveryCursor = null
    this.rundownId = rundownId
    this.preparationFailures.clear()
    this.elapsed = spec.startOffsetFrames ?? 0
    try { this.options.onTakeConfirmed?.(spec.itemId, this.elapsed, recovered, previous) }
    catch (error) { this.fail('Falha ao registrar TAKE confirmado: ' + (error instanceof Error ? error.message : String(error))) }
    this.liveStartedAtMs = spec.source === undefined ? null : Date.now() - framesToMs(this.elapsed, this.channel.rate)
    this.liveEndsAt = spec.source === undefined ? null : this.plannedEnd(spec.itemId)
    this.appliedGainDb = spec.gainDb
    this.preview = null
    this.previewSpecification = null
    this.previewFileVersion = null
    this.previewPosition = null
    this.previewReading = SILENCE
    this.dirty = true
  }

  private reportProgramCleared(reason: string): void {
    this.pendingProgramExit=null
    try { this.options.onProgramCleared?.(reason, Math.max(0, Math.floor(this.elapsed))) }
    catch (error) { this.fail('Falha ao registrar saída de PGM: ' + (error instanceof Error ? error.message : String(error))) }
  }

  private advanceAfter(itemId: string, failed = false): void {
    if (this.advancing) return
    this.advancing = true
    void this.enqueue(async () => {
      const view = this.view()
      if (!view || this.onAirItemId !== itemId) return
      const index = view.items.findIndex((entry) => entry.item.id === itemId)
      const current = view.items[index]
      if (!current) return
      const candidates = [...view.items.slice(index + 1), ...(view.rundown.loop ? view.items.slice(0, index + 1) : [])]
      const next = candidates.find(entry => view.schedule.items.find(timing => timing.id === entry.item.id)?.state !== 'DROPPED')
      if (!failed && current.item.loop) {
        await this.playFrom(view.rundown.id, current.item.id)
        return
      }
      if (!failed && !current.item.autoNext) return
      if (!next) {
        if (!failed && this.options.onPlaylistEnd) {
          // Keep the last valid frame while the next frozen edition is
          // checked/prerolled. Neither a failed load nor an ACK is a cut.
          let boundary: EnginePlaylistBoundary | null = null
          try {
            boundary = await this.options.onPlaylistEnd(itemId)
            if (boundary?.kind === 'HOLD') { this.fail(boundary.reason); return }
            if (boundary?.kind === 'TAKE') {
              await this.takeFromPlaylistNow(boundary.view, boundary.itemId, boundary.commit,
                boundary.stillCurrent, 0, 'PLAYLIST_BOUNDARY', boundary.beforeTake)
              return
            }
          } catch (error) {
            const failure = error instanceof Error ? error : new Error(String(error))
            if (boundary?.kind === 'TAKE') {
              try { boundary.failed(failure) } catch (recordError) { this.fail('Falha no registro da virada: ' + String(recordError)) }
            }
            this.fail('Virada não confirmada; confira o PGM antes de tentar novamente. ' + failure.message)
            return
          }
        }
        await this.request({ cmd: 'stop' })
        this.liveEndsAt = null
        return
      }
      try {
        await this.playFrom(view.rundown.id, next.item.id)
      } catch (failure) {
        await this.request({ cmd: 'stop' })
        this.liveEndsAt = null
        throw failure
      }
    }).catch((error: Error) => this.fail(error.message)).finally(() => { this.advancing = false })
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
      mode: 'NATIVE',
      channelId: this.channel.id,
      rundownId: this.rundownId,
      onAir,
      preview: this.preview,
      previewPosition: this.previewPosition,
      preparedItemId: this.armedItemId,
      preparingItemId: this.preparingItemId,
      playing: this.onAirItemId !== null,
      standby: this.onAirItemId === null && this.preview?.kind === 'ITEM',
      liveSources: [...this.sourceSignals.values()].map(signal => {
        const onPgm = this.onAirItemId ? this.specFor(this.onAirItemId)?.source === signal.source : false
        const onPvw = this.preview ? this.specForPreview(this.preview)?.source === signal.source : false
        const busStates: Partial<Record<'pgm' | 'pvw', LiveSourceSignalState>> = {}
        for (const [bus, active] of [['pgm',onPgm],['pvw',onPvw]] as const) {
          const original = signal.busStates?.[bus]
          if (!original) continue
          if (!active) { busStates[bus] = ['ON_PGM','PVW_READY'].includes(original) ? 'IDLE' : original; continue }
          const measurement = signal.measurements?.[bus]
          const age = measurement ? Math.max(0,Date.now()-Date.parse(measurement.sampledAt)) : 0
          const lost = measurement && (age > 2500 || (measurement.videoAgeMs !== null && (!measurement.videoPresent || measurement.videoAgeMs + age > 2000)))
          busStates[bus] = lost && original !== 'FAILED' ? 'LOST' : original
        }
        const state = onPgm ? busStates.pgm ?? signal.state : onPvw ? busStates.pvw ?? signal.state
          : (['FAILED','LOST','CUEING','TAKE_PENDING'].includes(signal.state) ? signal.state : 'IDLE')
        const message = state === 'IDLE' ? 'Fonte não está sintonizada neste barramento.'
          : state === 'LOST' && signal.state !== 'LOST' ? 'Fonte sem quadro recente (mais de 2 segundos); a imagem anterior não prova sinal ativo.' : signal.message
        const busItemIds:Partial<Record<'pgm'|'pvw',string>>={}
        if(onPgm && this.onAirItemId)busItemIds.pgm=this.onAirItemId
        const previewSpec=this.preview ? this.specForPreview(this.preview) : null
        if(onPvw && previewSpec)busItemIds.pvw=previewSpec.itemId
        return { ...signal, state, message, busStates,busItemIds }
      }).sort((a, b) => b.changedAt.localeCompare(a.changedAt)),
    }
  }

  take(rundownId: string, itemId: string, resumeFrames = 0): Promise<void> {
    // A manual TAKE means this exact CUE, never a silently selected later item.
    return this.enqueue(() => this.playFrom(rundownId, itemId, resumeFrames, true))
  }
  takeWithLifecycle(rundownId:string,itemId:string,frames:number,lifecycle:TakeLifecycle):Promise<void>{
    return this.enqueue(()=>this.playFrom(rundownId,itemId,frames,true,true,lifecycle))
  }

  recover(rundownId:string,itemId:string,frames:number):Promise<void> {
    return this.enqueue(async()=>{
      if(this.options.canRecoverProgram && !this.options.canRecoverProgram())throw new Error('Passagem de playlist sem conclusão durável. Recuperação automática bloqueada; confira o PGM antes de retomar.')
      await this.playFrom(rundownId,itemId,frames,true)
    })
  }

  /** Prepare a different published file playlist without loading it into the
   * runtime first. Commit only upon the native PGM identity confirmation. */
  takeFromPlaylist(view: RundownView, itemId: string, commit: (previous: { itemId: string; frames: number } | null) => void,
    stillCurrent: () => boolean, resumeFrames = 0, reason = 'CONTINGENCY'): Promise<void> {
    return this.enqueue(() => this.takeFromPlaylistNow(view,itemId,commit,stillCurrent,resumeFrames,reason))
  }

  /** One queue entry spans proof/DB work and native preroll/TAKE. Do not call
   * ordinary queued transport methods from this awaited callback. */
  insertOperational<T>(work:(commands:{prepare:(view:RundownView,itemId:string,current:()=>boolean)=>Promise<void>;take:(view:RundownView,itemId:string,current:()=>boolean,beforeTake:()=>void,commit:(previous:{itemId:string;frames:number}|null)=>void)=>Promise<void>})=>Promise<T>):Promise<T>{
    return this.mutatePlaylist(()=>work({prepare:async(view,itemId,current)=>{
      const spec=this.specFor(itemId,view);if(!spec || !current())throw new Error('Item indisponível ou inserção superada.')
      const version=await this.checkFile(spec)
      if(!current())throw new Error('A inserção mudou durante a verificação.')
      await this.request({cmd:'load',item:spec})
      if(await this.checkFile(spec)!==version || !current())throw new Error('Mídia/QC/execução mudou durante a preparação; PGM anterior preservado.')
      this.armedSpecification=specificationKey(spec);this.armedFileVersion=version
      if(spec.source)this.updateSource(spec,'IDLE','Entrada preparada; descoberta/ACK não comprovam quadro no PGM.')
    },take:(view,itemId,current,beforeTake,commit)=>this.takeFromPlaylistNow(view,itemId,commit,current,0,'OPERATIONAL_INSERT_NOW',beforeTake)}))
  }

  private async takeFromPlaylistNow(view: RundownView, itemId: string, commit: (previous: { itemId: string; frames: number } | null) => void,
    stillCurrent: () => boolean, resumeFrames: number, reason: string, beforeTake?: () => void): Promise<void> {
      if(reason!=='OPERATIONAL_INSERT_NOW' && this.options.canStartProgram?.()===false)throw new Error('Há retorno de VT inconclusivo. Nenhum novo TAKE será automático.')
      if (view.channel.id !== this.channel.id || view.rundown.channelId !== this.channel.id) throw new Error('Playlist pertence a outro canal.')
      const spec = this.specFor(itemId, view)
      if (!spec || spec.source && reason!=='OPERATIONAL_INSERT_NOW') throw new Error('A troca de playlist exige um arquivo de vídeo aprovado e reproduzível.')
      if (spec.itemId === this.onAirItemId) throw new Error('Este item já está no PGM; use o fluxo de revisão da playlist atual, não uma troca de grade.')
      if (!stillCurrent()) throw new Error('O estado operacional mudou; prepare novamente a troca de playlist.')
      if (this.pendingLiveTake) {
        await this.request({ cmd: 'cancelTake' })
        this.pendingLiveTake = null
        this.failPriorityTake('Entrada pendente cancelada pela troca de playlist.')
      }
      const fileVersion = await this.checkFile(spec)
      if (resumeFrames > 0) spec.startOffsetFrames = Math.min(Math.floor(resumeFrames), Math.max(0, spec.trimOut - spec.trimIn - 1))
      // The file load acknowledges only after a valid preroll at Mark In.
      if (reason !== 'PLAYLIST_BOUNDARY' || this.armedItemId !== spec.itemId || this.armedSpecification !== specificationKey(spec) || this.armedFileVersion !== fileVersion) {
        this.armedItemId = null
        await this.request({ cmd: 'load', item: spec })
        this.armedSpecification = specificationKey(spec)
        this.armedFileVersion = fileVersion
      }
      if (!stillCurrent()) throw new Error('A playlist mudou durante o preroll; PGM anterior preservado. Prepare novamente.')
      if (await this.checkFile(spec) !== fileVersion) {
        this.armedSpecification = null; this.armedFileVersion = null
        throw new MediaVersionError('O arquivo da próxima playlist foi alterado durante o preroll; PGM anterior preservado. Prepare novamente.')
      }
      if (!stillCurrent()) throw new Error('A playlist mudou durante a verificação; PGM anterior preservado. Prepare novamente.')
      if(reason!=='OPERATIONAL_INSERT_NOW' && this.options.canStartProgram?.()===false)throw new Error('Há retorno de VT inconclusivo. Nenhum TAKE será enviado.')
      beforeTake?.()
      let settled!:()=>void
      const signal=new Promise<void>(resolve=>settled=resolve)
      const pending = { view, spec, commit, confirmed: false, failure: null as Error | null,settled }
      this.pendingPlaylistTake = pending
      if(spec.source)this.updateSource(spec,'TAKE_PENDING','Aguardando o primeiro quadro antes de confirmar inserção no PGM.')
      this.pendingProgramExit = this.onAirItemId ? { itemId: this.onAirItemId, frames: Math.max(0, Math.floor(this.elapsed)), reason, targetItemId: itemId } : null
      try {
        try { await this.request({ cmd: 'take' }) }
        catch (error) { if (!pending.confirmed) throw error }
        if(spec.source && !pending.confirmed && !pending.failure){
          let timer:ReturnType<typeof setTimeout>|undefined
          try{await Promise.race([signal,new Promise<void>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Entrada não entregou quadro confirmado no PGM em 30 segundos. Confira a pendência antes de repetir.')),30_000)})])}
          finally{if(timer)clearTimeout(timer)}
        }
        if (pending.failure) throw pending.failure
        if (!pending.confirmed) throw new Error('TAKE aceito sem confirmação do arquivo no PGM; playlist operacional não foi substituída.')
        // A preview cleanup failure cannot undo or misreport a confirmed cut.
        try { await this.request({ cmd: 'preview', item: null }) }
        catch (error) { this.fail('PGM confirmado; falha ao limpar PVW: ' + (error instanceof Error ? error.message : String(error))) }
      } catch(error){
        if(spec.source && !pending.confirmed){try{await this.request({cmd:'cancelTake'})}catch{/* outcome stays uncertain */}}
        throw error
      } finally {
        if (this.pendingPlaylistTake === pending) this.pendingPlaylistTake = null
        this.pendingProgramExit = null
      }
  }

  cue(target: PreviewTarget | null): Promise<void> {
    return this.enqueue(async () => {
      // Uma nova escolha do operador vence a fonte que ainda aguardava vídeo.
      // Sem cancelar no engine, a fonte antiga podia cortar o PGM sozinha
      // quando o sinal voltasse.
      if (this.pendingLiveTake) {
        await this.request({ cmd: 'cancelTake' })
        this.pendingLiveTake = null
        this.failPriorityTake('Entrada prioritária cancelada por um novo CUE do operador.')
      }
      const spec = target ? this.specForPreview(target) : null
      if (target && !spec) throw new Error('O arquivo do preview não está disponível. Atualize o acervo.')
      const fileVersion = spec ? await this.checkFile(spec) : null
      const currentPreview = target ? this.specForPreview(target) : null
      if (spec && (!currentPreview || specificationKey(currentPreview) !== specificationKey(spec))) throw new Error('A mídia mudou durante a verificação do CUE. Selecione novamente o preview.')
      if (spec?.source) this.updateSource(spec, 'CUEING', 'Abrindo a fonte e aguardando o primeiro quadro no PVW.')
      try {
        await this.request({ cmd: 'preview', item: spec })
        if (spec && !spec.source) {
          try {
            const verifiedVersion = await this.checkFile(spec), verifiedPreview = target ? this.specForPreview(target) : null
            if (verifiedVersion !== fileVersion || !verifiedPreview || specificationKey(verifiedPreview) !== specificationKey(spec)) throw new MediaVersionError('A mídia mudou durante a preparação do CUE. Selecione novamente o preview; PGM anterior preservado.')
          } catch (error) {
            this.preview = null; this.previewSpecification = null; this.previewFileVersion = null; this.previewPosition = null; this.previewReading = SILENCE; this.dirty = true
            try { await this.request({ cmd: 'preview', item: null }) } catch {}
            throw error
          }
        }
      } catch (error) {
        if (spec?.source) this.updateSource(spec, 'FAILED', error instanceof Error ? error.message : 'O engine recusou abrir a fonte.', 'pvw')
        throw error
      }
      this.preview = target
      this.previewSpecification = spec ? specificationKey(spec) : null
      this.previewFileVersion = fileVersion
      this.previewPosition = spec && !spec.source ? { frames: 0, duration: Math.max(0, spec.trimOut - spec.trimIn) } : null
      this.previewReading = SILENCE
      this.dirty = true
    })
  }

  /** Atualiza apenas quando há uma fonte concreta; arquivo MAM nunca entra aqui. */
  private updateSource(spec: Pick<EngineItem, 'itemId' | 'source'>, state: LiveSourceSignalState, message: string | null, bus?: 'pgm' | 'pvw'): void {
    if (!spec.source) return
    const previous = this.sourceSignals.get(spec.source)
    const targetBus = bus ?? (state === 'CUEING' || state === 'PVW_READY' ? 'pvw' : 'pgm')
    const measurements = { ...previous?.measurements }
    if (state === 'CUEING') delete measurements.pvw
    this.sourceSignals.set(spec.source, {
      source: spec.source,
      itemId: spec.itemId,
      state,
      message: message === null ? null : sanitizeDiagnostic(message),
      changedAt: new Date().toISOString(),
      busStates: { ...previous?.busStates, [targetBus]: state },
      measurements,
    })
  }

  private sourceForItem(itemId: string): string | undefined {
    return itemId.startsWith('source:')
      ? itemId.slice('source:'.length)
      : this.specFor(itemId)?.source
  }
  private updateSourceForItem(itemId: string, state: LiveSourceSignalState, message: string | null, bus?: 'pgm' | 'pvw'): void {
    const source = this.sourceForItem(itemId)
    if (source) this.updateSource({ itemId, source }, state, message, bus ?? (itemId === this.onAirItemId ? 'pgm' : 'pvw'))
  }

  stop(): Promise<void> {
    return this.enqueue(async () => {
      await this.request({ cmd: 'stop' })
      this.failPriorityTake('Entrada prioritária cancelada por STOP.')
      this.pendingLiveTake = null
      this.recoveryCursor = null
      this.elapsed = 0
      this.liveEndsAt = null
      this.liveStartedAtMs = null
      this.dirty = true
    })
  }

  park(itemId: string): Promise<void> {
    return this.enqueue(async () => {
      const spec = this.specFor(itemId)
      if (!spec) throw new Error('O primeiro item não está disponível. Atualize a grade.')
      const fileVersion = await this.checkFile(spec)
      await this.request({ cmd: 'load', item: spec })
      if (await this.checkFile(spec) !== fileVersion) throw new MediaVersionError('O arquivo mudou durante o preroll; PGM anterior preservado. Prepare novamente.')
      await this.request({ cmd: 'stop' })
      this.failPriorityTake('Entrada prioritária cancelada ao armar a grade.')
      this.pendingLiveTake = null
      await this.request({ cmd: 'preview', item: spec })
      this.recoveryCursor = null
      this.elapsed = 0
      this.liveEndsAt = null
      this.liveStartedAtMs = null
      this.preview = { kind: 'ITEM', id: itemId }
      this.previewSpecification = specificationKey(spec)
      this.previewFileVersion = fileVersion
      this.previewPosition = { frames: 0, duration: Math.max(0, spec.trimOut - spec.trimIn) }
      this.dirty = true
    })
  }

  seek(bus: 'pgm' | 'pvw', frames: Frames): Promise<void> {
    return this.enqueue(async () => {
      await this.request({ cmd: 'seek', bus, frames: Math.max(0, Math.round(frames)) })
      if (bus === 'pgm') this.elapsed = Math.max(0, Math.round(frames))
      else if (this.previewPosition) this.previewPosition = { ...this.previewPosition, frames: Math.max(0, Math.min(this.previewPosition.duration, Math.round(frames))) }
      this.dirty = true
    })
  }

  /** Hora de saída que a grade marcou para este item, em frames. */
  private plannedEnd(itemId: string): Frames | null {
    const view = this.view()
    const row = view?.schedule.items.find((entry) => entry.id === itemId)
    const entry = view?.items.find(entry => entry.item.id === itemId)
    if (!row || !entry || this.liveStartedAtMs === null) return null
    const limit = liveDurationLimit(entry.item, row.duration)
    return limit === null ? null : this.liveStartedAtMs + framesToMs(limit, this.channel.rate)
  }

  tick(): boolean {
    this.syncGain()
    this.enterPriorityLiveWhenDue()
    this.endLiveWhenDue()
    this.prepareAhead()
    const changed = this.dirty
    this.dirty = false
    return changed
  }

  private failPriorityTake(reason: string): void {
    if (!this.priorityTake) return
    this.emitLivePriority({ ...this.priorityTake, kind: 'FAILED', reason: sanitizeDiagnostic(reason), occurredAt: new Date(Date.now()).toISOString() })
    this.priorityTake = null
  }

  private emitLivePriority(event: LivePriorityEvent): void {
    try { this.options.onLivePriority?.(event) }
    catch (error) { this.fail('Falha ao registrar entrada prioritária: ' + (error instanceof Error ? error.message : String(error))) }
  }

  private enterPriorityLiveWhenDue(): void {
    const now = Date.now(), view = this.view()
    if (!view || !this.onAirItemId) { this.priorityObservedAt = now; return }
    const context = `${view.rundown.id}:${view.rundown.date ?? new Date(now).toDateString()}`
    if (context !== this.priorityContext) { this.priorityContext = context; this.handledPriorityLives.clear() }
    const since = this.priorityObservedAt ?? now
    if (now < since) { this.priorityObservedAt = now; return }
    // Keep the observation window while another TAKE awaits its first frame.
    // Otherwise an anchor crossed during that wait would be lost forever.
    if (this.priorityTake || this.pendingLiveTake || this.pendingPlaylistTake || this.options.canStartProgram?.()===false) return
    this.priorityObservedAt = now
    const target = priorityLives(view, now).find(target => !this.handledPriorityLives.has(target.key) && target.itemId !== this.onAirItemId && target.atMs > since && target.atMs <= now)
    if (!target) return
    this.handledPriorityLives.add(target.key)
    const previousItemId = this.onAirItemId
    this.priorityTake = { kind: 'REQUESTED', rundownId: target.rundownId, itemId: target.itemId, previousItemId, previousFrames: this.elapsed, scheduledAt: new Date(target.atMs).toISOString(), occurredAt: new Date(now).toISOString() }
    this.emitLivePriority(this.priorityTake)
    void this.enqueue(async () => {
      const current = this.view()
      const unchanged = current && priorityLives(current, Date.now()).some(candidate => candidate.key === target.key)
      if (!unchanged || this.onAirItemId !== previousItemId) { this.failPriorityTake('Grade ou PGM mudou antes da entrada prioritária.'); return }
      try { await this.playFrom(target.rundownId, target.itemId, 0, true) }
      catch (error) { this.failPriorityTake(error instanceof Error ? error.message : 'A fonte não abriu.'); this.fail('Entrada prioritária recusada; PGM anterior preservado.') }
    }).catch(error => this.failPriorityTake(error instanceof Error ? error.message : 'Falha na fila do engine.'))
  }

  /**
   * Tira do ar o item ao vivo quando dá a hora que a grade marcou.
   *
   * Arquivo acaba e avisa; fonte ao vivo não acaba. Sem isto a programação
   * pararia atrás de um estúdio que ficou no ar para sempre.
   */
  private endLiveWhenDue(): void {
    if(this.pendingPlaylistTake || this.options.canStartProgram?.()===false)return
    if (this.liveStartedAtMs === null || !this.onAirItemId) return
    this.liveEndsAt = this.plannedEnd(this.onAirItemId)
    if (this.liveEndsAt === null) return
    if (Date.now() < this.liveEndsAt) return

    const itemId = this.onAirItemId
    this.liveEndsAt = null
    this.liveStartedAtMs = null
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

  videoProbe(): { luma: number; black: boolean; freeze: boolean } | null {
    return this.pgmVideoProbe
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

  /**
   * Arma o próximo item reproduzível enquanto o atual ainda está no ar.
   *
   * É o modelo A/B de continuidade: o slot A toca e o B fica em PAUSED no
   * primeiro quadro. Quando chega o EOS, `playFrom` encontra o item já armado
   * e o take deixa de pagar abertura de arquivo, descoberta de trilhas e seek.
   */
  private prepareAhead(): void {
    if(this.pendingPlaylistTake || this.options.canStartProgram?.()===false)return
    if (!this.ready || !this.alive || this.closed || !this.onAirItemId || this.preparingItemId || this.pendingLiveTake) return

    const view = this.view()
    if (!view) return
    if (view !== this.preparationView) {
      this.preparationView = view
    }

    const index = view.items.findIndex((entry) => entry.item.id === this.onAirItemId)
    if (index < 0) return
    const candidates = [
      ...view.items.slice(index + 1),
      ...(view.rundown.loop ? view.items.slice(0, index) : []),
    ]
    const failed = (id: string) => { const spec = this.specFor(id); return !spec || this.preparationFailures.has(specificationKey(spec)) }
    const upcoming = priorityLives(view, Date.now()).find(target => target.atMs > Date.now() && target.atMs-Date.now() <= 5000 && target.itemId !== this.onAirItemId && !failed(target.itemId))
    const upcomingItem = upcoming ? view.items.find(entry => entry.item.id === upcoming.itemId) : undefined
    const next = upcomingItem ?? candidates.find((entry) => {
      if (entry.item.id === this.onAirItemId || failed(entry.item.id)) return false
      return view.schedule.items.find((row) => row.id === entry.item.id)?.state !== 'DROPPED' &&
        this.specFor(entry.item.id) !== null
    })
    if (!next) {
      const current=view.items[index]!,duration=view.schedule.items.find(row=>row.id===current.item.id)?.duration ?? 0
      if(!current.item.autoNext || current.item.loop || view.rundown.loop || !this.options.onPreparePlaylistEnd || this.preparingBoundary || duration-this.elapsed>5*this.channel.rate.num/this.channel.rate.den || Date.now()<this.nextBoundaryPreparationAt)return
      this.nextBoundaryPreparationAt=Date.now()+1000
      this.preparingBoundary=true
      const origin=this.onAirItemId,revision=this.options.executionIdentity?.()
      let boundarySpecKey:string|null=null
      void this.enqueue(async()=>{
        const prepared=await this.options.onPreparePlaylistEnd!()
        if(!prepared || this.onAirItemId!==origin || this.options.executionIdentity?.()!==revision || !prepared.stillCurrent())return
        const spec=this.specFor(prepared.itemId,prepared.view)
        if(!spec || spec.source || this.preparationFailures.has(specificationKey(spec)) || this.armedItemId===spec.itemId && this.armedSpecification===specificationKey(spec))return
        boundarySpecKey=specificationKey(spec)
        this.preparingItemId=spec.itemId;this.dirty=true
        const fileVersion = await this.checkFile(spec)
        if(!prepared.stillCurrent() || this.onAirItemId!==origin)return
        await this.request({cmd:'load',item:spec})
        if (await this.checkFile(spec) !== fileVersion) throw new Error('O arquivo mudou durante o preroll da próxima playlist.')
        this.armedSpecification=specificationKey(spec)
        this.armedFileVersion=fileVersion
      }).catch(error=>{if(boundarySpecKey)this.preparationFailures.add(boundarySpecKey);this.fail('Preroll da próxima playlist falhou: '+String(error))}).finally(()=>{this.preparingBoundary=false;this.preparingItemId=null;this.dirty=true})
      return
    }

    const spec = this.specFor(next.item.id)
    if (!spec) return
    if (this.armedItemId === spec.itemId && this.armedSpecification === specificationKey(spec)) return
    this.preparingItemId = next.item.id
    this.dirty = true
    void this.enqueue(async () => {
      // Uma ordem manual pode ter mudado o ar enquanto aguardávamos a fila.
      if (this.onAirItemId === spec.itemId || (this.armedItemId === spec.itemId && this.armedSpecification === specificationKey(spec))) return
      const current = this.specFor(spec.itemId)
      if (!current || specificationKey(current) !== specificationKey(spec)) return
      const fileVersion = await this.checkFile(spec)
      await this.request({ cmd: 'load', item: spec })
      if (await this.checkFile(spec) !== fileVersion) throw new Error('O arquivo mudou durante o preroll do próximo item.')
      this.armedSpecification = specificationKey(spec)
      this.armedFileVersion = fileVersion
    }).catch((failure: unknown) => {
      this.preparationFailures.add(specificationKey(spec))
      const message = failure instanceof Error ? failure.message : 'Falha no preroll.'
      this.fail(`${next.item.title}: preroll falhou — ${message}`)
    }).finally(() => {
      if (this.preparingItemId === spec.itemId) this.preparingItemId = null
      this.dirty = true
    })
  }

  processId(): number | null {
    return this.child.pid ?? null
  }

  /** Liga ou desliga um monitor. O engine faz isso sem tocar no programa. */
  setMonitor(bus: 'pvw' | 'mon', on: boolean): void {
    this.desiredMonitors.set(bus, on)
    this.send({ cmd: 'monitor', bus, on })
  }

  /** No CUE/LOAD/TAKE; serialized with them and bound to the active source. */
  qcMonitor(source:string,on:boolean,authorize:()=>void=()=>{}):Promise<void> {
    return this.enqueue(async()=>{
      authorize()
      if(!this.options.qcPreview)throw new Error('Inspeção ao vivo em qualidade indisponível nesta instalação.')
      const target=this.preview
      const spec=target?.kind==='SOURCE'?this.specForPreview(target):null
      if(!spec?.source || spec.source!==resolveSource(source))throw new Error('A fonte do QC não é mais o preview ativo.')
      await this.request({cmd:'qcMonitor',itemId:spec.itemId,on})
    })
  }

  close(): void {
    if (this.closed) return
    this.failPriorityTake('Entrada prioritária cancelada ao encerrar o canal.')
    const child = this.child
    this.send({ cmd: 'shutdown' })
    this.closed = true
    this.alive = false
    this.rejectPending('O canal foi encerrado.')
    this.onAirItemId = null
    this.preview = null
    this.previewPosition = null
    this.meter = SILENCE
    this.previewReading = SILENCE
    setTimeout(() => child.kill(), 1000).unref()
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

  // OMT uses the official native runtime, not SMPTE-2110 or NMOS. Preserve
  // its discovered reference so the engine can report SDK/source failures.
  if (kind === 'sdi' || kind === 'ndi' || kind === 'omt') return ref
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
