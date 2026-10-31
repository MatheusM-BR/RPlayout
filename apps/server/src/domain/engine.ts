import { spawn, type ChildProcess } from 'node:child_process'
import type { EngineStatus } from './engine-status.js'
import {readNativeLiveReplacementCapability,NativeLiveReplacementWire,type NativeLiveReplacementRequest,type NativeLiveReplacementReceipt,type NativeLiveReplacementOperation} from './native-live-replacement.js'
import {resolveLiveProgramBinding,type LiveProgramBinding} from './live-program-binding.js'
import {createHash} from 'node:crypto'
import {nativeSourceConnectionSignature} from './native-live-replacement-ledger.js'
import {matchesProgramHoldReceipt,programHoldExpected,parseProgramHoldState,type ProgramHoldExpected,type ProgramHoldReceipt,type ProgramHoldState} from './program-hold-receipt.js'
import {matchesProgramHoldRestoreReceipt,programHoldRestoreExpected,type ProgramHoldRestoreExpected} from './program-hold-receipt.js'
import { createInterface } from 'node:readline'
import {readPreviewFrame,type PreviewFrameObservation} from './preview-frame.js'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { DiagnosticLines, sanitizeDiagnostic } from './sanitize-diagnostic.js'
import { engineProcessEnvironment } from './media-process-environment.js'
import {StderrTail,describeEngineExit,writeEngineCrashReport} from './engine-crash-report.js'
import {freemem,totalmem} from 'node:os'
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
  signalSampleAge,
  signalBufferIsRecent,
  assessLiveSignal,
  type LiveSignalAssessment,
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
import type {ProgramVideoProbe} from './transport.js'
import type { RundownView } from './plan.js'
import {assertTrimAudio} from './plan.js'
import { liveDurationLimit } from './live-timing.js'
import {executionTrim} from './execution-trim.js'
import {executionTimingKey,freezeExecutionTiming,type FrozenExecutionTiming} from './execution-timing.js'
import {assertProgramTrim,type ProgramTrim} from './program-trim.js'
import {readNativeProgramAdmissionCursor,type NativeProgramAdmission} from './native-program-admission.js'
import { priorityLives, type LivePriorityEvent } from './priority-live.js'
import type {
  LiveSourceSignal,
  LiveSourceSignalState,
  LiveSourceMeasurement,
  PublisherState,
  Transport,
  TransportState,
} from './transport.js'

export interface NativeShutdownResult {ownedNativeProcessesStopped:boolean;graceful:boolean;forceRequested:boolean}
export interface NativeReplacementStopProof {engineGeneration:string;nativeRequestId:number;previousOwnedGenerationExited:boolean}
export interface NativeReplacementPersistence {
 validate:(operation:NativeLiveReplacementOperation,request:NativeLiveReplacementRequest)=>void
 beforeSend:(operation:NativeLiveReplacementOperation,request:NativeLiveReplacementRequest)=>void
 /** COMMITTED/current requires atomic journal+binding+checkpoint persistence. */
 receipt:(receipt:NativeLiveReplacementReceipt,currentProgramContext:boolean)=>LiveProgramBinding|undefined
 stopped:(proof:NativeReplacementStopProof)=>void
}
/** Authorization of ONE queued command. Installed inside the transport queue
 * for that command only, never retained for later commands or receipts. */
export interface NativeReplacementAction {
 validate:(operation:NativeLiveReplacementOperation,request:NativeLiveReplacementRequest)=>void
 beforeSend:(operation:NativeLiveReplacementOperation,request:NativeLiveReplacementRequest)=>void
}

/** O que o engine precisa saber para pôr um item no ar. */
interface EngineItem {
  itemId: string
  path: string
  /** Published file identity checked by the server, not by the native decoder. */
  contentHash?: string
  /** Fonte ao vivo já resolvida para endereço concreto. */
  source?: string
  configuredSourceId?: string
  sourceType?:string
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
  item.itemId, item.path, item.source ?? null, item.configuredSourceId ?? null, item.trimIn, item.trimOut,
  item.gainDb, item.fit ?? 'PILLARBOX', item.audioTrack ?? 0, item.startOffsetFrames ?? 0,item.audioRouting??{mode:'DEFAULT'},item.auxiliaryPairs??[],item.contentHash??null,
])

type EngineEvent =
  | {event:'liveReplacement';id:unknown;receipt:unknown;replayed?:unknown}
  | ProgramHoldReceipt
  | { event:'fenceRequest';ownerId:string;nonce:number }
  | { event:'fenceApplied';nonce:number;term:number }
  | { event: 'ready'; channelId: string; decoderIdentity?: boolean;programAdmission?:boolean;programOutputsHeld?:boolean;previewAdmission?:boolean;engineGeneration?:unknown;liveReplacementProtocol?:unknown }
  | { event:'programOutputs';held:boolean;ownerId:string;term:number;itemId:string|null;decoderId:number|null;cursor:unknown }
  | { event: 'ack'; id: number; ok: boolean; error?: string; decoderId?: number }
  | { event: 'state'; onAir?: string; armed?: string; preview?: string; onAirDecoderId?: number; armedDecoderId?: number;programHold?:unknown;programSelectionUncertain?:unknown }
  | { event: 'position'; itemId: string; decoderId?:number|null; frames: number; duration: number }
  | { event: 'previewPosition'; itemId: string; frames: number; duration: number }
  | ({event:'previewFrame'}&PreviewFrameObservation)
  | { event: 'eos'; itemId: string }
  | { event: 'sourceLost'; itemId: string; reason: string; decoderId?: number }
  | { event: 'sourceReady'; itemId: string; bus: 'pgm' | 'pvw'; decoderId?: number; configuredSourceId?: string | null }
  | { event: 'sourceTelemetry'; itemId: string; bus: 'pgm' | 'pvw'; signal: LiveSourceMeasurement; decoderId?: number; configuredSourceId?: string | null }
  | { event: 'itemError'; itemId: string; bus: 'pgm' | 'pvw'; message: string; decoderId?: number }
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
  | ({ event:'videoProbe' } & ProgramVideoProbe)
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
  readonly onSignalObservation?:()=>void
  /** Where an unexpected native exit leaves its report (exit code + stderr tail). */
  readonly crashReportDirectory?:string
  /** Per-native-owner witness grant. No Node timer can extend native expiry. */
  readonly fenceLease?:(ownerId:string,nonce:number)=>Promise<{term:number;ttlMs:number}>
  /** Promotion preparation only: native PGM consumers do not exist until
   * explicitly admitted. Every new process generation starts held again. */
  readonly holdProgramOutputs?:boolean
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
  readonly executionOccurrenceId?:()=>string|null
  readonly onLivePriority?: (event: LivePriorityEvent) => void
  readonly onTakeConfirmed?: (itemId: string, startPositionFrames: number, recovered: boolean, previous: {itemId:string;frames:number;reason:string} | null) => void
  readonly onHeldRecoveryConfirmed?:(attempt:{rundownId:string;itemId:string;frames:number;programTrim:ProgramTrim},proof:{itemId:string;decoderId:number;frames:number})=>Promise<void>
  /** Terminal refusal of the exact native live opening, after its positive ACK. */
  readonly onRecoveryRejected?: (attempt:{rundownId:string;itemId:string;frames:number},error:EngineCommandRejected)=>void
  readonly onStopConfirmed?:()=>void
  /** Runs inside the durable STOP section (after the owned sessions' journal),
   * so a refusal keeps the same native-selection block as a session failure. */
  readonly onStopDurable?:(proof:{engineGeneration:string|null;nativeRequestId:number})=>void
  readonly onProgramCleared?: (reason: string, lastPositionFrames: number) => void
  /** Runs inside the native command queue at a natural, non-looping EOS.
   * The provider must NOT enqueue another transport operation. */
  readonly onPlaylistEnd?: (itemId: string) => Promise<EnginePlaylistBoundary | null>
  readonly onPreparePlaylistEnd?: () => Promise<{view:RundownView;itemId:string;stillCurrent:()=>boolean}|null>
  /** Unknown playlist cut must not auto-replay an older PGM after a crash. */
  readonly canRecoverProgram?: () => boolean
  readonly canRestartEngine?: () => boolean
  readonly onProcessStarted?: (pid:number|null,spawnToken:string) => void
  readonly canStartProgram?:()=>boolean
  /** Shared-DB lifetime ownership, independent of the native HA witness. */
  readonly assertExecutionOwned?:()=>void
  readonly beforeProcessStart?:(spawnToken:string)=>void
  readonly onProcessExited?:(pid:number|null,spawnToken:string)=>void
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
/** Erro de um engine que continua pronto vira ALERTA por este tempo. */
const ERRO_VALE_MS = 5 * 60_000
/** Recusa de comando fica visível (título/log) por este tempo. */
const REJEICAO_VALE_MS = 5 * 60_000
/** Reinícios seguidos sem um quadro saudável: o watchdog não está resolvendo. */
const REINICIOS_ATE_FALHA = 3
/** Subida/recuperação que não termina neste tempo deixa de ser "reiniciando". */
const SUBIDA_ATE_FALHA_MS = 90_000

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

export class EngineCommandRejected extends Error {}
export class EngineTransport implements Transport {
  private readonly startupWaiters=new Set<{resolve:()=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>()
  private child: ChildProcess
  private nextId = 1
  private rundownId: string | null = null
  private onAirItemId: string | null = null
  private onAirStartedAt: number | null = null
  private mountedProgramTrim:{itemId:string;trimIn:number;trimOut:number;contentHash?:string}|null=null
  private mountedLiveSpec:EngineItem|null=null
  private programLiveBinding:LiveProgramBinding|null=null
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
  /** Last preview command actually sent; includes opening/clearing before ACK.
   * Historical source rows are not ownership of the currently requested bus. */
  private requestedLivePreview: { itemId: string; source: string; decoderId?: number } | null = null
  private decoderIdentity = false
  private pgmDecoderId: number | undefined
  private armedDecoderId: number | undefined
  private previewSpecification: string | null = null
  private previewTiming:FrozenExecutionTiming|null=null
  private previewFileVersion: string | null = null
  /** TAKE ao vivo aceito, porém aguardando o primeiro quadro no PGM. */
  private pendingLiveTake: { rundownId: string; itemId: string; spec: EngineItem; decoderId?:number;liveBinding?:LiveProgramBinding } | null = null
  private pendingPlaylistTake: { view: RundownView; spec: EngineItem; commit: (previous: { itemId: string; frames: number } | null) => void; confirmed: boolean; failure: Error | null; settled?:()=>void } | null = null
  private previewPosition: { frames: Frames; duration: Frames } | null = null
  private meter: MeterReading | null = null
  private pgmMeterAt:number|null=null
  private pgmVideoProbeAt:number|null=null
  private previewReading: MeterReading | null = null
  private previewFrameBinding:{itemId:string;decoderId?:number}|null=null
  private nativePreviewFrame:(PreviewFrameObservation&{observedAt:number;sampledAt:number})|null=null
  private pgmVideoProbe: ProgramVideoProbe | null = null
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
  /** Quando `lastError` foi registrado: erro antigo de um engine saudável não
   * pode manter o cabeçalho vermelho para sempre ("cry wolf"). */
  private lastErrorAt: number | null = null
  /** Último comando recusado pelo engine. Recusa é resposta, não falha: o
   * engine continua saudável e quem pediu recebe a mensagem. */
  private lastRejection: { message: string; at: number } | null = null
  /** Início do processo atual, para separar "subindo" de "travado ao subir". */
  private childStartedAt = Date.now()
  /** Configuration restoration must not race a decoder awaiting TAKE. */
  hasPendingCommand(): boolean { return this.queuedOperations > 0 || this.pending.size > 0 || (this.replacementWire?.health().pending??0)>0 || this.pendingLiveTake !== null || this.priorityTake !== null || this.pendingPlaylistTake !== null || this.advancing || this.preparingBoundary }
  commandRevision(): number { return this.commandSequence }
  /** Último aviso e quando ele chegou. Caduca sozinho: veja `AVISO_VALE_MS`. */
  private lastWarning: string | null = null
  private warningAt = 0
  private closed = false
  private readonly admittedReceipts=new Map<string,{action:'CUE'|'TAKE';revisionId:string|null;proof:{itemId:string;ownerId:string;term:number;programChanged:false;signalConfirmed:false}|{itemId:string;decoderId:number;ownerId:string;term:number;elapsed:number;nativeConfirmed:true}}>()
  private operation: Promise<void> = Promise.resolve()
  private queuedOperations = 0
  private commandSequence = 0
  private readonly fileVersions = new FileVersionVerifier()
  private readonly pending = new Map<number, {
    resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; since: number
    previewOpening?: { itemId: string; source: string }
    previewFrameOpening?:{itemId:string;decoderId?:number}
    programHold?: {expected:ProgramHoldExpected;receipt?:ProgramHoldReceipt}
    programHoldRestore?:{expected:ProgramHoldRestoreExpected;receipt?:ProgramHoldReceipt}
  }>()
  private readonly desiredMonitors = new Map<'pvw' | 'mon', boolean>()
  private recoveryCursor: { itemId: string; frames: Frames;programTrim?:ProgramTrim;programHold?:'HELD'|'UNCONFIRMED';liveProgramBinding?:LiveProgramBinding } | null = null
  private programEndReason = 'STOP'
  private pendingProgramExit: {itemId:string;frames:number;reason:string;targetItemId:string} | null = null
  private armedSpecification: string | null = null
  private armedFileVersion: string | null = null
  private advancing = false
  private preparingBoundary = false
  private nextBoundaryPreparationAt = 0
  private desiredGraphic: { svg: string | null; fadeMs: number } | null = null
  /** Overlays no ar, para repor (em corte) se o engine reiniciar. */
  private desiredOverlays = new Map<number, { svg: string; animation: import('@rplayout/protocol').OverlayAnimation | null }>()
  private committedOutputs:readonly string[]
  private fenceOwner:string|null=null
  private fencePendingOwner:string|null=null
  private fenceTerm:number|null=null
  private fenceNonce=0
  private nativeProgramAdmission=false
  private nativePreviewAdmission=false
  private previewAdmissionStarted=false
  private programOutputsHeld=false
  private nativeProgramHold:ProgramHoldState|null=null
  private nativeHoldUnsafe=false
  private nativeReplacementCapability:{supported:boolean;engineGeneration:string|null}={supported:false,engineGeneration:null}
  private nativeSelectionUncertain=false
  private nativeReportedSelectionUncertain=false
  private replacementReceiptUncertain:string|null=null
  private boundRecoveryInProgress=false
  private stopAwaitingDurable=false
  private replacementWire:NativeLiveReplacementWire|null=null
  private readonly replacementSessions=new Map<string,{request:NativeLiveReplacementRequest;persistence:NativeReplacementPersistence;child:ChildProcess;executionId:string;revisionId:string;start:number|null;action?:NativeReplacementAction|null}>()
  private pendingReplacementBinding:{request:NativeLiveReplacementRequest;binding:LiveProgramBinding;spec:EngineItem;start:number|null}|null=null
  private pendingProgramAdmission:{ownerId:string;term:number;itemId:string|null;decoderId:number|null;minimumElapsed:number;trim:ProgramTrim|null;paused?:boolean}|null=null
  private nativeProgramAdmissionProof:NativeProgramAdmission|null=null
  private nativeProgramPosition:{itemId:string;decoderId:number;frames:number;observedAt:number}|null=null
  /** Track every owned generation, including ones no longer selected by the
   * watchdog. A kill/error/closed pipe is not proof that native outputs ended. */
  private readonly ownedNativeChildren=new Set<ChildProcess>()
  private readonly nativeExitObservers=new Set<()=>void>()
  private confirmedClose:Promise<{ownedNativeProcessesStopped:boolean}>|null=null
  private gracefulClose:Promise<NativeShutdownResult>|null=null
  private shutdownForceTimer:ReturnType<typeof setTimeout>|null=null
  private shutdownForceRequested=false
  private readonly nativeExitOutcomes=new WeakMap<ChildProcess,{code:number|null;signal:NodeJS.Signals|null}>()
  fenceBinding():{ownerId:string;term:number}|null {
    return this.alive&&this.ready&&!this.closed&&this.child?.pid&&this.fenceOwner&&this.fenceTerm!==null?{ownerId:this.fenceOwner,term:this.fenceTerm}:null
  }
  programDecoderBinding():{itemId:string;decoderId:number}|null {
    return this.alive&&this.ready&&!this.closed&&!this.nativeSelectionUncertain&&this.onAirItemId&&Number.isSafeInteger(this.pgmDecoderId)&&this.pgmDecoderId!>0?{itemId:this.onAirItemId,decoderId:this.pgmDecoderId!}:null
  }
  programPositionEvidence():{itemId:string;decoderId:number;frames:number}|null {
    const sample=this.nativeProgramPosition,decoder=this.programDecoderBinding()
    if(!sample||!decoder||this.programOutputsHeld||this.nativeHoldUnsafe||this.nativeSelectionUncertain||this.replacementWire?.health().selectionUncertain||this.pendingReplacementBinding||sample.itemId!==decoder.itemId||sample.decoderId!==decoder.decoderId||performance.now()-sample.observedAt>2000)return null
    return {itemId:sample.itemId,decoderId:sample.decoderId,frames:sample.frames}
  }
  liveProgramBindingSnapshot():LiveProgramBinding|null{
    return this.programLiveBinding&&this.programDecoderBinding()?.itemId===this.programLiveBinding.context.itemId?structuredClone(this.programLiveBinding):null
  }
  nativeLiveSelection(){
    const decoder=this.programDecoderBinding(),spec=this.mountedLiveSpec,gen=this.nativeReplacementCapability.engineGeneration
    if(!decoder||!spec?.source||spec.itemId!==decoder.itemId||!spec.configuredSourceId||!gen||!this.nativeReplacementCapability.supported||this.programOutputsHeld||this.nativeHoldUnsafe||this.pendingLiveTake||this.pendingPlaylistTake||this.replacementWire?.health().selectionUncertain)throw new Error('PGM não oferece uma live catalogada/geração confirmada para troca.')
    const prefix=spec.source.split(':',1)[0]!.toLowerCase(),sourceType=({ndi:'NDI',omt:'OMT',sdi:'SDI',decklink:'SDI',srt:'SRT',rtmp:'RTMP',rtmps:'RTMP',rtsp:'RTSP',rtsps:'RTSP'} as Record<string,string>)[prefix]
    if(!sourceType)throw new Error('Fonte atual não oferece contrato de troca catalogada.')
    const policySignature=createHash('sha256').update(JSON.stringify([this.channel.audioChannels??2,this.appliedGainDb??spec.gainDb,spec.fit??'PILLARBOX',spec.audioTrack??0,spec.audioRouting??{mode:'DEFAULT'},spec.auxiliaryPairs??[]])).digest('hex')
    return {engineGeneration:gen,itemId:decoder.itemId,decoderId:decoder.decoderId,sourceId:spec.configuredSourceId,
      sourceConnectionSignature:nativeSourceConnectionSignature(spec.configuredSourceId,sourceType,spec.source),policySignature}
  }
  private replacementContextCurrent(transactionId:string,preparedDecoderId?:number){
    const session=this.replacementSessions.get(transactionId)
    return Boolean(session&&session.child===this.child&&session.executionId===this.options.executionOccurrenceId?.()&&session.revisionId===this.options.executionIdentity?.()
      &&this.onAirItemId===session.request.itemId&&(this.pgmDecoderId===session.request.expectedDecoderId||preparedDecoderId!==undefined&&this.pgmDecoderId===preparedDecoderId||this.pgmDecoderId===this.pendingReplacementBinding?.binding.receipt.preparedDecoderId||this.programLiveBinding?.receipt.transactionId===transactionId))
  }
  private applyReplacementBinding():boolean{
    const pending=this.pendingReplacementBinding
    if(!pending||this.nativeReportedSelectionUncertain||!this.replacementContextCurrent(pending.request.transactionId)
      ||this.onAirItemId!==pending.request.itemId||this.pgmDecoderId!==pending.binding.receipt.preparedDecoderId)return false
    const old=this.mountedLiveSpec?.source,row=old?this.sourceSignals.get(old):null
    if(old&&row){const measurements={...row.measurements},nativeCatalogBindings={...row.nativeCatalogBindings};delete measurements.pgm;delete nativeCatalogBindings.pgm;this.sourceSignals.set(old,{...row,measurements,nativeCatalogBindings})}
    this.programLiveBinding=structuredClone(pending.binding);this.mountedLiveSpec=structuredClone(pending.spec)
    this.onAirStartedAt=pending.start;this.elapsed=Math.max(this.elapsed,pending.binding.receipt.programFrames!)
    if(this.replacementReceiptUncertain===pending.request.transactionId){this.replacementReceiptUncertain=null;this.nativeSelectionUncertain=false}
    this.updateSource(pending.spec,'ON_PGM',null,'pgm');this.pendingReplacementBinding=null;this.dirty=true
    return true
  }
  private replacementTransport():NativeLiveReplacementWire{
    if(this.replacementWire)return this.replacementWire
    this.replacementWire=new NativeLiveReplacementWire({
      nextId:()=>this.nextId++,assertOwned:()=>{if(!this.options.assertExecutionOwned)throw new Error('Troca nativa exige posse durável.');this.options.assertExecutionOwned()},
      validate:(operation,request)=>{
        const session=this.replacementSessions.get(request.transactionId);if(!session)throw new Error('Transação nativa desconhecida.')
        if(operation==='PREPARE'||operation==='COMMIT'){
          const actual=this.nativeLiveSelection()
          if(actual.engineGeneration!==request.engineGeneration||actual.itemId!==request.itemId||actual.decoderId!==request.expectedDecoderId||actual.sourceId!==request.expectedSourceId||this.mountedLiveSpec?.source===request.targetSource||!this.replacementContextCurrent(request.transactionId))throw new Error('Contexto do PGM mudou antes da troca.')
        }
        if(session.action)session.action.validate(operation,request);else session.persistence.validate(operation,request)
      },
      beforeSend:(operation,request)=>{const session=this.replacementSessions.get(request.transactionId)!;if(session.action)session.action.beforeSend(operation,request);else session.persistence.beforeSend(operation,request)},
      fence:()=>this.fenceBinding(),
      fenceRequired:()=>Boolean(this.options.fenceLease),
      write:(message,failed)=>{if(!this.alive||this.closed||!this.ready||!this.child.stdin?.writable)throw new Error('Pipe nativo indisponível.');this.child.stdin.write(JSON.stringify(message)+'\n',error=>{if(error)failed(error)})},
      recordReceipt:receipt=>{
        const session=this.replacementSessions.get(receipt.transactionId);if(!session)throw new Error('Recibo sem transação pertencente ao engine.')
        const current=this.replacementContextCurrent(receipt.transactionId,receipt.preparedDecoderId??undefined)
        try{
          const binding=session.persistence.receipt(receipt,current)
          if(receipt.phase==='COMMITTED'&&current){
            if(!binding||!this.mountedLiveSpec)throw new Error('Corte sem vínculo/checkpoint duráveis.')
            const source=resolveLiveProgramBinding(binding,{channelId:this.channel.id,rundownId:this.rundownId,revisionId:session.revisionId,executionId:session.executionId,itemId:receipt.itemId,elapsed:Math.max(this.elapsed,receipt.programFrames!),playing:true,realEngine:true})
            if(binding.receipt.transactionId!==receipt.transactionId||JSON.stringify(binding.receipt)!==JSON.stringify(receipt)||source.source!==session.request.targetSource||source.configuredSourceId!==receipt.targetSourceId)throw new Error('Vínculo persistido diverge da fonte confirmada.')
            if(this.programLiveBinding?.receipt.transactionId!==receipt.transactionId||this.replacementReceiptUncertain===receipt.transactionId){
              this.pendingReplacementBinding={request:session.request,binding,spec:{...this.mountedLiveSpec,...source},start:session.start}
              this.applyReplacementBinding()
            }
          }
        }catch(error){if(receipt.phase==='COMMITTED'&&current){this.replacementReceiptUncertain=receipt.transactionId;this.nativeSelectionUncertain=true;this.fail('Corte nativo observado sem confirmação durável; novas trocas/checkpoint bloqueados.')}throw error}
      },
      selectionObserved:receipt=>Boolean(this.programDecoderBinding()&&this.programLiveBinding?.receipt.transactionId===receipt.transactionId&&
        (this.pgmDecoderId===receipt.preparedDecoderId||this.mountedLiveSpec?.source&&this.sourceSignals.get(this.mountedLiveSpec.source)?.nativeCatalogBindings?.pgm===receipt.targetSourceId)),
    })
    this.replacementWire.ready({engineGeneration:this.nativeReplacementCapability.engineGeneration,liveReplacementProtocol:this.nativeReplacementCapability.supported?1:0,decoderIdentity:this.decoderIdentity})
    return this.replacementWire
  }
  /** Installs the caller's per-command authorization inside the queue slot and
   * removes it when that command settles (ACK, timeout or refusal). */
  private async withReplacementAction<T>(transactionId:string,action:NativeReplacementAction|undefined,work:()=>Promise<T>):Promise<T>{
    const session=this.replacementSessions.get(transactionId)
    if(!session||!action)return work()
    session.action=action
    try{return await work()}finally{if(session.action===action)session.action=null}
  }
  prepareNativeLiveReplacement(request:NativeLiveReplacementRequest,persistence:NativeReplacementPersistence,action?:NativeReplacementAction):Promise<NativeLiveReplacementReceipt>{
    return this.enqueue(async()=>{
      await this.awaitNativeReady()
      if(!this.replacementSessions.has(request.transactionId)){
        this.nativeLiveSelection()
        if(this.replacementSessions.size>=256)throw new Error('Limite de transações nativas da sessão atingido.')
        const executionId=this.options.executionOccurrenceId?.(),revisionId=this.options.executionIdentity?.()
        if(!executionId||!revisionId)throw new Error('Troca exige ocorrência e revisão publicadas.')
        this.replacementSessions.set(request.transactionId,{request:structuredClone(request),persistence,child:this.child,executionId,revisionId,start:this.onAirStartedAt,action:null})
      }
      return this.withReplacementAction(request.transactionId,action,()=>this.replacementTransport().prepare(request))
    })
  }
  nativeLiveReplacementCommand(operation:'COMMIT'|'CANCEL'|'STATUS',transactionId:string,action?:NativeReplacementAction):Promise<NativeLiveReplacementReceipt>{
    return this.enqueue(async()=>{
      if(!this.replacementSessions.has(transactionId))throw new Error('Transação não pertence à sessão nativa; consultar journal durável.')
      const wire=this.replacementTransport()
      return this.withReplacementAction(transactionId,action,()=>operation==='COMMIT'?wire.commit(transactionId):operation==='CANCEL'?wire.cancel(transactionId):wire.status(transactionId))
    })
  }
  /** Lets the runtime tell whether this process still owns a journal's session. */
  ownsNativeReplacementSession(transactionId:string):boolean{return this.replacementSessions.has(transactionId)}

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
    this.replacementWire?.disconnected()
    this.nativeReplacementCapability={supported:false,engineGeneration:null}
    this.nativeProgramAdmission=false;this.programOutputsHeld=Boolean(this.options.holdProgramOutputs)
    this.pendingProgramAdmission=null
    this.nativeProgramAdmissionProof=null
    this.decoderIdentity=false;this.pgmDecoderId=undefined;this.armedDecoderId=undefined
    this.previewFrameBinding=null;this.nativePreviewFrame=null
    for(const [source,signal]of this.sourceSignals)this.sourceSignals.set(source,{...signal,nativeCatalogBindings:{}})
    this.options.assertExecutionOwned?.()
    const spawnToken=randomUUID()
    this.options.beforeProcessStart?.(spawnToken)
    this.fenceOwner=this.options.fenceLease?randomUUID():null
    this.nativeProgramPosition=null
    this.nativePreviewAdmission=false;this.previewAdmissionStarted=false
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
    let child:ChildProcess
    try{child = spawn(this.binary, this.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...engineProcessEnvironment(), PATH: envPath },
    })}catch(error){
      // Synchronous spawn rejection returned no ChildProcess. Retire only
      // this reserved generation; never assume that an error with PID died.
      try{this.options.onProcessExited?.(null,spawnToken)}catch{}
      throw error
    }
    this.ownedNativeChildren.add(child)
    const retired=()=>{
      this.ownedNativeChildren.delete(child)
      if(this.closed&&!this.ownedNativeChildren.size)this.clearShutdownForceTimer()
      for(const observe of this.nativeExitObservers)observe()
    }
    child.on('error', (error) => {
      // Error can mean a failed kill/IPC too, not process death. Only a
      // spawn error without PID proves no native child was opened.
      if(child.pid===undefined){retired();try{this.options.onProcessExited?.(null,spawnToken)}catch{}}
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
    const stderrTail = new StderrTail(), spawnedAt = Date.now()
    const diagnostics = new DiagnosticLines(line => { stderrTail.push(line); process.stderr.write(`[engine ${sanitizeDiagnostic(this.channel.name)}] ${line}\n`) })
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
      this.nativeExitOutcomes.set(child,{code,signal})
      retired()
      try{this.options.onProcessExited?.(child.pid??null,spawnToken)}catch{}
      if (this.closed || this.child !== child) return
      // An exit we did not ask for leaves a report next to the data: code
      // name and the last diagnostic lines (Rust panics land on stderr).
      if (!this.matandoPorTravamento && (code !== 0 || signal) && this.options.crashReportDirectory) {
        diagnostics.end()
        const file = writeEngineCrashReport(this.options.crashReportDirectory, { channelId: this.channel.id, channelName: this.channel.name, code, signal: signal ?? null, pid: child.pid ?? null, startedAt: spawnedAt, at: Date.now(), stderr: stderrTail.snapshot(), memory: { freeBytes: freemem(), totalBytes: totalmem() } })
        process.stderr.write(`[engine ${sanitizeDiagnostic(this.channel.name)}] encerrado: ${describeEngineExit(code, signal ?? null)}${file ? `; relatório em ${file}` : ''}\n`)
      }
      this.alive = false
      if (this.onAirItemId) {
        const hold=this.nativeProgramHold
        this.recoveryCursor = { itemId: this.onAirItemId, frames: hold?.status==='HELD'&&hold.frames!==null?hold.frames:this.elapsed,programTrim:this.programTrimFor(this.onAirItemId)??undefined,
          ...(this.programLiveBinding?{liveProgramBinding:structuredClone(this.programLiveBinding)}:{}),
          ...(this.nativeHoldUnsafe||this.nativeSelectionUncertain?{programHold:!this.nativeSelectionUncertain&&hold?.status==='HELD'?'HELD' as const:'UNCONFIRMED' as const}:{}) }
        this.reportProgramCleared(code===75?'HA_FENCE_EXPIRED':'ENGINE_FAILURE')
      }
      this.onAirItemId = null
      this.requestedLivePreview = null
      this.qcOpenSource = null
      this.armedItemId = null
      this.armedSpecification = null
      this.meter = SILENCE
      this.pgmMeterAt=null;this.pgmVideoProbeAt=null;this.pgmVideoProbe=null
      this.previewReading = SILENCE
      this.publisherStates.clear()
      this.notifySignalObservation()
      // Sinal e código separados: quem morreu por SIGKILL nosso não é o mesmo
      // caso de quem morreu por conta própria, e a mensagem tem de deixar isso
      // legível para quem está lendo o log às três da manhã.
      this.lastError = code===75?'Posse HA expirou no engine nativo; publicação encerrada antes de nova concessão.':signal
        ? `O engine foi encerrado por ${signal}.`
        : `O engine encerrou com ${describeEngineExit(code, null)}.`
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
    try{
      // Exit/error listeners precede PID registration so a failed durable
      // registration still observes the termination of our own child.
      this.options.onProcessStarted?.(child.pid??null,spawnToken)
      this.options.assertExecutionOwned?.()
      child.stdin?.write(JSON.stringify({ outputs: this.committedOutputs, preview: this.options.preview,...(this.options.qcPreview?{qcPreview:this.options.qcPreview}:{}),...(this.fenceOwner?{fenceOwner:this.fenceOwner}:{}),...(this.options.holdProgramOutputs?{holdProgramOutputs:true}:{}) }) + '\n')
    }catch(error){child.kill('SIGKILL');throw error}
    this.alive = true
    this.ready = false
    this.childStartedAt = Date.now()
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
    if(this.replacementWire?.absorb(event)){this.dirty=true;return}

    switch (event.event) {
      case 'programHold':{
        const pending=this.pending.get(event.id)
        if(pending?.programHold&&matchesProgramHoldReceipt(event,event.id,pending.programHold.expected)&&this.onAirItemId===event.itemId&&this.pgmDecoderId===event.decoderId)pending.programHold.receipt=event
        if(pending?.programHoldRestore&&matchesProgramHoldRestoreReceipt(event,event.id,pending.programHoldRestore.expected))pending.programHoldRestore.receipt=event
        break
      }
      case 'fenceRequest': {
        const obtain=this.options.fenceLease,owner=this.fenceOwner,child=this.child
        if(!obtain||event.ownerId!==owner||!Number.isSafeInteger(event.nonce)||event.nonce<=0||this.fencePendingOwner===owner)break
        this.fencePendingOwner=owner
        void obtain(owner,event.nonce).then(grant=>{
          if(this.closed||this.child!==child||this.fenceOwner!==owner)return
          this.send({cmd:'fenceGrant',ownerId:owner,nonce:event.nonce,term:grant.term,ttlMs:grant.ttlMs})
        }).catch(()=>{if(!this.closed&&this.child===child)this.fail('Concessão nativa não confirmada; engine encerrará a publicação ao expirar a posse.')})
          .finally(()=>{if(this.fencePendingOwner===owner)this.fencePendingOwner=null})
        break
      }
      case 'fenceApplied':
        if(this.options.fenceLease&&Number.isSafeInteger(event.term)&&event.term>0&&event.nonce>this.fenceNonce){this.fenceTerm=event.term;this.fenceNonce=event.nonce;this.dirty=true}
        break
      case 'programOutputs': {
        const pending=this.pendingProgramAdmission
        if(pending&&this.options.holdProgramOutputs&&this.nativeProgramAdmission&&this.programOutputsHeld&&event.ownerId===pending.ownerId&&event.term===pending.term&&event.ownerId===this.fenceOwner&&event.term===this.fenceTerm&&event.itemId===pending.itemId&&event.decoderId===pending.decoderId&&this.onAirItemId===pending.itemId&&(this.pgmDecoderId??null)===pending.decoderId&&event.held===false){
          try{
            const cursor=readNativeProgramAdmissionCursor(event.cursor,pending)
            this.nativeProgramAdmissionProof={channelId:this.channel.id,ownerId:event.ownerId,term:event.term,itemId:event.itemId,decoderId:event.decoderId,elapsed:cursor.elapsed,firstVideoConfirmed:cursor.firstVideoConfirmed,...(pending.trim?{programTrim:{...pending.trim}}:{}),...(cursor.paused===true?{paused:true}:{})}
            this.programOutputsHeld=false;this.dirty=true
          }catch{this.fail('Prova nativa de posição/corte inválida; admissão incerta.');const child=this.child;this.close();child.kill('SIGKILL')}
        }
        else {this.fail('Admissão de saídas sem pedido/cursor/dono/termo atuais; engine será encerrado.');const child=this.child;this.close();child.kill('SIGKILL')}
        break
      }
      case 'ready':
        this.nativeReplacementCapability=readNativeLiveReplacementCapability(event)
        this.nativePreviewAdmission=event.previewAdmission===true
        if(this.options.holdProgramOutputs&&this.options.preview&&!this.nativePreviewAdmission){this.fail('Engine não suporta preview retido; preparo recusado.');const child=this.child;this.close();child.kill('SIGKILL');break}
        this.nativeProgramAdmission=event.programAdmission===true
        if(this.options.holdProgramOutputs&&(!this.nativeProgramAdmission||event.programOutputsHeld!==true||event.channelId!==this.channel.id||event.decoderIdentity!==true)){this.fail('Engine não confirmou retenção/decoder/canal nativos; preparação recusada.');const child=this.child;this.close();child.kill('SIGKILL');break}
        this.programOutputsHeld=event.programOutputsHeld===true
        this.decoderIdentity=event.decoderIdentity===true
        if(this.options.fenceLease&&this.fenceTerm===null){this.fail('Engine não confirmou a cerca HA nativa; publicação recusada.');this.child.kill('SIGKILL');break}
        // Erros de uma sessão anterior não podem manter readiness em 503
        // depois que o novo processo confirmou inicialização.
        this.lastError = null
        if(!this.booted)this.semQuadroMs=0
        this.ready = true
        this.replacementWire?.ready(event)
        for(const waiter of this.startupWaiters){clearTimeout(waiter.timer);waiter.resolve()}
        this.startupWaiters.clear()
        this.dirty = true
        break
      case 'state':
        if(event.programSelectionUncertain===true)this.nativeReportedSelectionUncertain=true
        if(event.programSelectionUncertain===true&&!this.nativeSelectionUncertain){
          this.nativeReportedSelectionUncertain=true
          this.nativeSelectionUncertain=true
          for(const [source,row]of this.sourceSignals){
            const measurements={...row.measurements},nativeCatalogBindings={...row.nativeCatalogBindings}
            delete measurements.pgm;delete nativeCatalogBindings.pgm
            this.sourceSignals.set(source,{...row,measurements,nativeCatalogBindings})
          }
          this.fail('Seleção nativa de PGM inconclusiva; checkpoint e novos cortes bloqueados até STOP confirmado.')
        }
        const changedOccurrence=this.onAirItemId!==(event.onAir??null)||this.decoderIdentity&&this.pgmDecoderId!==event.onAirDecoderId
        if(this.decoderIdentity && this.pgmDecoderId!==event.onAirDecoderId && this.onAirItemId===event.onAir){
          const source=this.sourceForItem(event.onAir ?? ''),row=source?this.sourceSignals.get(source):undefined
          if(source && row){const measurements={...row.measurements};delete measurements.pgm
            const nativeCatalogBindings={...row.nativeCatalogBindings};delete nativeCatalogBindings.pgm
            this.sourceSignals.set(source,{...row,measurements,nativeCatalogBindings})}
        }
        if(this.pgmDecoderId!==event.onAirDecoderId||this.onAirItemId!==(event.onAir??null))this.nativeProgramPosition=null
        this.pgmDecoderId=event.onAirDecoderId
        this.armedDecoderId=event.armedDecoderId
        // A live TAKE can be accepted before its armed decoder identity is
        // reported. Bind once to the current matching native armed state;
        // never overwrite a known identity with a later/stale incarnation.
        if(this.decoderIdentity&&this.pendingLiveTake&&this.pendingLiveTake.itemId===event.armed&&this.pendingLiveTake.decoderId===undefined&&Number.isSafeInteger(event.armedDecoderId)&&event.armedDecoderId!>0)this.pendingLiveTake.decoderId=event.armedDecoderId
        if (this.onAirItemId && !event.onAir) this.reportProgramCleared(this.programEndReason)
        if (this.priorityTake && this.onAirItemId === this.priorityTake.previousItemId && event.onAir === this.priorityTake.itemId) this.priorityTake.previousFrames = this.elapsed
        this.onAirItemId = event.onAir ?? null
        const replacementApplied=this.applyReplacementBinding()
        if(changedOccurrence&&!replacementApplied)this.onAirStartedAt=null
        if(event.programHold!==undefined){
          this.nativeProgramHold=parseProgramHoldState(event.programHold,this.onAirItemId,event.onAirDecoderId)
          // Never offer a held/inconclusive cursor as a playing checkpoint.
          this.nativeHoldUnsafe=Boolean(this.onAirItemId)&&this.nativeProgramHold?.status!=='RUNNING'
        }else if(this.nativeProgramHold?.itemId!==this.onAirItemId||this.nativeProgramHold?.decoderId!==event.onAirDecoderId){
          this.nativeProgramHold=null;this.nativeHoldUnsafe=false
        }
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
        if (this.pendingLiveTake?.itemId === this.onAirItemId && this.decoderMatches(event.onAirDecoderId,this.pendingLiveTake.decoderId)) {
          this.confirmLiveTake(this.pendingLiveTake)
        }
        this.dirty = true
        break
      case 'position':
        if(this.decoderIdentity&&event.decoderId!==undefined&&event.decoderId!==this.pgmDecoderId)break
        if(event.itemId===this.onAirItemId&&event.decoderId===this.pgmDecoderId&&Number.isSafeInteger(event.decoderId)&&event.decoderId!>0&&Number.isSafeInteger(event.frames)&&event.frames>=0)this.nativeProgramPosition={itemId:event.itemId,decoderId:event.decoderId!,frames:event.frames,observedAt:performance.now()}
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
      case 'previewFrame':{
        const sample=readPreviewFrame(event,this.previewFrameBinding)
        if(sample){this.nativePreviewFrame={...sample,observedAt:performance.now(),sampledAt:Date.now()};this.dirty=true}
        break
      }
      case 'eos':
        if (event.itemId === this.onAirItemId) {
          this.programEndReason = 'EOS'
          this.advanceAfter(event.itemId)
        }
        break
      case 'itemError':
        // Live errors from a discarded decoder must not rebind the bus or
        // cancel a newer TAKE. A genuine pending TAKE failure is still handled
        // even when the previous PGM uses this same endpoint.
        if (this.sourceForItem(event.itemId,event.bus)
          && !this.sourceEventMatchesBus(event.itemId, event.bus, event.decoderId)
          && !(event.bus === 'pgm' && (this.pendingLiveTake?.itemId === event.itemId
            || this.pendingPlaylistTake?.spec.itemId === event.itemId
            || this.priorityTake?.itemId === event.itemId)
            && this.decoderMatches(event.decoderId,this.armedDecoderId))) break
        this.updateSourceForItem(event.itemId, 'FAILED', event.message, event.bus,
          event.bus==='pgm'&&event.itemId===this.onAirItemId&&this.decoderIdentity&&!this.decoderMatches(event.decoderId,this.pgmDecoderId))
        this.fail(event.message)
        if (event.bus==='pgm' && this.pendingLiveTake?.itemId === event.itemId && this.decoderMatches(event.decoderId,this.pendingLiveTake.decoderId)) {
          const opening=this.pendingLiveTake,cursor=this.recoveryCursor
          this.pendingLiveTake = null
          this.pendingProgramExit = null
          // A native live itemError on this pending PGM decoder is emitted only
          // after service_pending_take refuses it. PVW/stale/legacy identities
          // cannot authorize another TAKE, nor can silence or a lost ACK.
          if(this.decoderIdentity && cursor?.itemId===opening.itemId){
            this.recoveryCursor=null
            this.options.onRecoveryRejected?.({rundownId:opening.rundownId,itemId:opening.itemId,frames:cursor.frames},new EngineCommandRejected(sanitizeDiagnostic(event.message)))
          }
          // Automatic advance into a live that never delivered a frame: the
          // previous item already ended, so "previous PGM preserved" is a
          // frozen/black last frame. Continue the grade after the live.
          else if(this.programEndReason==='EOS'&&this.onAirItemId&&this.onAirItemId!==opening.itemId)this.skipFailedLive(opening.rundownId,opening.itemId,this.onAirItemId)
        }
        if (this.pendingPlaylistTake?.spec.itemId === event.itemId && !this.pendingPlaylistTake.confirmed) {this.pendingPlaylistTake.failure = new Error(sanitizeDiagnostic(event.message));this.pendingPlaylistTake.settled?.()}
        if (this.priorityTake?.itemId === event.itemId) {
          this.failPriorityTake(event.message)
        }
        if (event.bus === 'pgm' && event.itemId === this.onAirItemId && this.decoderMatches(event.decoderId,this.pgmDecoderId)) {
          this.programEndReason = 'FAILED_MEDIA_ERROR'
          this.advanceAfter(event.itemId, true)
        }
        break
      case 'sourceLost':
        // Native sourceLost comes only from the selected program pipeline.
        // PVW errors carry their explicit bus through itemError instead.
        if (event.itemId !== this.onAirItemId || !this.sourceEventMatchesBus(event.itemId, 'pgm', event.decoderId)) break
        // Fonte ao vivo que cai não anda com a grade: o estúdio pode voltar, e
        // a hora de sair continua sendo a que a grade marcou. O engine fica
        // tentando reabrir; aqui só registramos para o operador ver.
        this.updateSourceForItem(event.itemId, 'LOST', event.reason, 'pgm')
        this.fail(`fonte ao vivo caiu: ${event.reason}`)
        break
      case 'sourceReady':
        if (!this.sourceEventMatchesBus(event.itemId, event.bus, event.decoderId)) break
        this.updateSourceForItem(event.itemId, event.bus === 'pgm' ? 'ON_PGM' : 'PVW_READY', null, event.bus)
        this.recordNativeCatalogBinding(event.itemId,event.bus,event.configuredSourceId,event.decoderId)
        this.dirty = true
        this.notifySignalObservation()
        break
      case 'sourceTelemetry': {
        if (!this.sourceEventMatchesBus(event.itemId, event.bus, event.decoderId)) break
        const source = this.sourceForItem(event.itemId,event.bus)
        if (!source) break
        const previous = this.sourceSignals.get(source)
        if (!previous) break
        // Decoded input telemetry is independent for PGM and PVW. Preparing
        // the same source in QC cannot erase its confirmed program tally.
        this.sourceSignals.set(source, { ...previous, measurements: { ...previous.measurements,
          [event.bus]: { ...event.signal, sampledAt: new Date().toISOString() } } })
        this.recordNativeCatalogBinding(event.itemId,event.bus,event.configuredSourceId,event.decoderId)
        this.dirty = true
        this.notifySignalObservation()
        break
      }
      case 'levels':
        if (event.bus === 'pgm') {this.meter = toMeter(event);this.pgmMeterAt=Date.now()}
        else this.previewReading = toMeter(event)
        break
      case 'videoProbe':
        this.pgmVideoProbe = { luma: event.luma, black: event.black, freeze: event.freeze,freezeDurationMs:event.freezeDurationMs,sampleAgeMs:event.sampleAgeMs }
        this.pgmVideoProbeAt=Date.now()
        break
      case 'publisher':
        this.publisherStates.set(event.outputId ?? event.url, {
          ...(event.outputId?{outputId:event.outputId}:{}),
          url: event.url,
          health: event.health,
          attempts: event.attempts,
          delivered: event.delivered,
          ...(Number.isSafeInteger(event.generation)&&event.generation!>=0?{generation:event.generation}:{}),
          error: event.error == null ? event.error : sanitizeDiagnostic(event.error),
        })
        this.notifySignalObservation()
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
            if(pending.previewFrameOpening&&this.previewFrameBinding===pending.previewFrameOpening){
              if(event.ok)this.previewFrameBinding.decoderId=event.decoderId
              else {this.previewFrameBinding=null;this.nativePreviewFrame=null}
            }
            if (pending.previewOpening && this.requestedLivePreview === pending.previewOpening) {
              if(event.ok)this.requestedLivePreview.decoderId=event.decoderId
              else this.requestedLivePreview=null
            }
            const restored=pending.programHoldRestore
            if(event.ok&&restored&&(!restored.receipt||event.decoderId!==restored.receipt.decoderId||this.onAirItemId!==restored.expected.itemId||this.pgmDecoderId!==restored.receipt.decoderId||this.nativeProgramHold?.status!=='HELD'||this.nativeProgramHold.decoderId!==restored.receipt.decoderId||this.nativeProgramHold.frames!==restored.expected.frames))pending.reject(new Error('ACK sem estado/recibo de restauração pausada da mesma geração; resultado inconclusivo.'))
            else if(event.ok&&pending.programHold&&(!pending.programHold.receipt||event.decoderId!==pending.programHold.expected.decoderId||this.onAirItemId!==pending.programHold.expected.itemId||this.pgmDecoderId!==pending.programHold.expected.decoderId))pending.reject(new Error('ACK sem recibo de pausa da mesma geração; resultado inconclusivo.'))
            else if (event.ok) pending.resolve()
            else pending.reject(new EngineCommandRejected(sanitizeDiagnostic(event.error ?? 'O engine recusou o comando.')))
          }
        }
        // Comando recusado (ex.: "este canal não tem barramento de preview")
        // não é falha do engine: quem pediu recebe a recusa e o estado do
        // motor continua OK. Fica registrado e no log como aviso.
        if (!event.ok && event.error) this.reject(event.error)
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
    this.lastErrorAt = Date.now()
    this.dirty = true
    process.stderr.write(`[engine ${sanitizeDiagnostic(this.channel.name)}] ERRO ${this.lastError}\n`)
  }

  private reject(message: string): void {
    this.lastRejection = { message: sanitizeDiagnostic(message), at: Date.now() }
    this.dirty = true
    process.stderr.write(`[engine ${sanitizeDiagnostic(this.channel.name)}] AVISO comando recusado: ${this.lastRejection.message}\n`)
  }

  /**
   * Estado único do engine para cabeçalho, cartões e incidentes.
   *
   * - OK: processo vivo e pronto (pode haver recusa recente de comando, que
   *   não muda o estado).
   * - ALERTA: vivo e pronto, mas reportou erro nos últimos minutos.
   * - REINICIANDO: morto aguardando o watchdog, ou subindo/recuperando há pouco.
   * - FALHA: não volta sozinho (reinícios seguidos sem quadro, processo que não
   *   encerra, ou subida que não termina).
   */
  engineStatus(now = Date.now()): EngineStatus {
    const rejection = this.lastRejection && now - this.lastRejection.at < REJEICAO_VALE_MS ? { ...this.lastRejection, at: new Date(this.lastRejection.at).toISOString() } : null
    const base = { message: this.lastError, rejection }
    if (this.closed) return { ...base, state: 'FAILED' }
    if (this.mateiEm !== null && now - this.mateiEm > MORTE_DEMORADA_MS) return { ...base, state: 'FAILED' }
    if (!this.alive) return { ...base, state: this.restartStreak >= REINICIOS_ATE_FALHA ? 'FAILED' : 'RESTARTING' }
    if (!this.ready || this.recoveryCursor !== null) return { ...base, state: now - this.childStartedAt > SUBIDA_ATE_FALHA_MS ? 'FAILED' : 'RESTARTING' }
    if (this.lastError !== null && this.lastErrorAt !== null && now - this.lastErrorAt < ERRO_VALE_MS) return { ...base, state: 'ALERT' }
    return { ...base, state: 'OK' }
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
  overlay(command: import('./transport.js').OverlayCommand): Promise<void> {
    return this.enqueue(async () => {
      await this.request({ cmd: 'overlay', slot: command.slot, action: command.action, svg: command.svg ?? null, animation: command.animation ?? null })
      if (command.action === 'in' || command.action === 'cut') this.desiredOverlays.set(command.slot, { svg: command.svg!, animation: command.animation ?? null })
      else this.desiredOverlays.delete(command.slot)
    })
  }
  graphicConfirmed(svg: string | null, fadeMs: number, authorize?:()=>void): Promise<void> {
    return this.enqueue(async () => {
      authorize?.()
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

  health(): { restarts: number; deaths: number; stalls: number; error: string | null; ready: boolean;fencing:{enabled:boolean;term:number|null;nonce:number};programAdmission:{supported:boolean;held:boolean};programHold:ProgramHoldState|null;nativeLiveReplacement:{supported:boolean;engineGeneration:string|null;selectionUncertain:boolean} } {
    return {
      restarts: this.restarts,
      deaths: this.deaths,
      stalls: this.stalls,
      error: this.lastError,
      ready: this.alive && !this.closed && this.ready && this.recoveryCursor === null && !this.nativeSelectionUncertain && !this.replacementWire?.health().selectionUncertain && !this.pendingReplacementBinding && !this.stopAwaitingDurable,
      nativeLiveReplacement:{...this.nativeReplacementCapability,selectionUncertain:this.nativeSelectionUncertain||Boolean(this.replacementWire?.health().selectionUncertain)||Boolean(this.pendingReplacementBinding)||this.stopAwaitingDurable},
      fencing:{enabled:Boolean(this.options.fenceLease),term:this.fenceTerm,nonce:this.fenceNonce},
      programAdmission:{supported:this.nativeProgramAdmission,held:this.programOutputsHeld},
      programHold:this.programDecoderBinding()&&this.nativeProgramHold?.itemId===this.onAirItemId&&this.nativeProgramHold.decoderId===this.pgmDecoderId?{...this.nativeProgramHold}:null,
    }
  }

  /** Põe de volta no ar o que estava no ar quando o engine caiu. */
  private restore(): void {
    const binding=this.recoveryCursor?.liveProgramBinding,canRecoverBound=Boolean(binding&&this.replacementWire?.canRecoverBinding(binding.receipt))
    if(this.nativeReportedSelectionUncertain||this.stopAwaitingDurable||this.nativeSelectionUncertain&&!canRecoverBound||this.replacementWire?.health().selectionUncertain&&!canRecoverBound){this.fail('PGM nativo inconclusivo preservado; não retomar silenciosamente a fonte anterior. Confirme STOP antes de outro corte.');return}
    for (const [bus, on] of this.desiredMonitors) this.send({ cmd: 'monitor', bus, on })
    if (this.desiredGraphic) this.send({ cmd: 'graphic', ...this.desiredGraphic })
    for (const [slot, overlay] of this.desiredOverlays) this.send({ cmd: 'overlay', slot, action: 'cut', svg: overlay.svg, animation: overlay.animation })
    const cursor = this.recoveryCursor
    if(cursor?.programHold){
      if(cursor.programHold==='HELD'&&cursor.programTrim&&this.rundownId&&this.options.onHeldRecoveryConfirmed){
        const attempt={rundownId:this.rundownId,itemId:cursor.itemId,frames:cursor.frames,programTrim:cursor.programTrim}
        void this.recoverHeld(attempt.rundownId,attempt.itemId,attempt.frames,attempt.programTrim,proof=>this.options.onHeldRecoveryConfirmed!(attempt,proof)).catch((error:Error)=>this.fail(error.message))
      }else this.fail('PGM pausado/inconclusivo preservado; retomada PLAYING bloqueada sem checkpoint/commit pausado confirmado.')
      return
    }
    if (cursor && this.rundownId) void this.recover(this.rundownId, cursor.itemId, cursor.frames,cursor.programTrim,cursor.liveProgramBinding)
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
  /** Only promotion's internal adapter calls this after fresh witness/storage
   * admission. Native owner/term/decoder are checked again across the pipe.
   * Lost ACK is not retried; the caller must retain promotion uncertainty. */
  releaseProgramOutputs(authorize:()=>Promise<void>,paused=false):Promise<NativeProgramAdmission>{
    return this.enqueue(async()=>{
      if(!this.options.holdProgramOutputs||!this.nativeProgramAdmission||!this.programOutputsHeld)throw new Error('Engine não está em preparação nativa com saídas retidas.')
      if(!this.options.assertExecutionOwned)throw new Error('Admissão exige verificação de posse da execução/storage, além da concessão nativa.')
      if(this.pendingLiveTake||this.pendingPlaylistTake||this.priorityTake)throw new Error('TAKE ainda pendente; admissão não confirmará PGM anterior/idle.')
      const child=this.child,binding=this.fenceBinding(),itemId=this.onAirItemId,decoderId=this.pgmDecoderId??null
      if(!binding||!child)throw new Error('Liberação de PGM exige concessão nativa atual.')
      const trim=itemId?this.programTrimFor(itemId):null,minimumElapsed=itemId?this.elapsed:0
      if(paused){
        const hold=this.nativeProgramHold
        if(!itemId||!trim||hold?.status!=='HELD'||hold.itemId!==itemId||hold.decoderId!==decoderId||hold.frames!==minimumElapsed)throw new Error('Admissão pausada exige decoder/corte/cursor HELD confirmados; saídas retidas.')
      }else if(this.nativeHoldUnsafe)throw new Error('PGM pausado/inconclusivo não pode ser admitido como reprodução; saídas retidas.')
      if(itemId&&(!Number.isSafeInteger(decoderId)||decoderId!<=0||!trim&&!this.sourceForItem(itemId)))throw new Error('Retomada sem decoder/corte/versão local nativos; saídas retidas.')
      this.options.assertExecutionOwned?.();await authorize();this.options.assertExecutionOwned?.()
      if(this.child!==child||this.fenceBinding()?.ownerId!==binding.ownerId||this.fenceBinding()?.term!==binding.term||this.onAirItemId!==itemId||(this.pgmDecoderId??null)!==decoderId)throw new Error('Engine/cursor/concessão mudaram antes da liberação.')
      this.pendingProgramAdmission={...binding,itemId,decoderId,minimumElapsed,trim,paused};this.nativeProgramAdmissionProof=null
      try {
        await this.request({cmd:'releaseProgramOutputs',ownerId:binding.ownerId,term:binding.term,itemId,decoderId})
        const assertSame=()=>{
          if(this.child!==child||this.programOutputsHeld||!this.alive||this.fenceBinding()?.ownerId!==binding.ownerId||this.fenceBinding()?.term!==binding.term||this.onAirItemId!==itemId||(this.pgmDecoderId??null)!==decoderId)throw new Error('Saídas sem confirmação nativa do mesmo engine/cursor; preserve a incerteza.')
          if(paused&&(this.nativeProgramHold?.status!=='HELD'||this.nativeProgramHold.decoderId!==decoderId||this.nativeProgramHold.frames!==minimumElapsed))throw new Error('PGM deixou modo/cursor pausado durante admissão.')
        }
        assertSame();await authorize();this.options.assertExecutionOwned?.();assertSame()
        if(!this.nativeProgramAdmissionProof)throw new Error('Admissão sem prova nativa de posição/corte.')
        return structuredClone(this.nativeProgramAdmissionProof)
      } catch(error) {
        // After dispatch, even an ACK timeout/authority loss may have opened
        // outputs. Stop only this owned generation; do not replay or restart.
        this.fail('Admissão de programa incerta; processo próprio encerrado sem repetição.')
        this.close();child.kill('SIGKILL');throw error
      } finally {this.pendingProgramAdmission=null}
    })
  }
  releasePreviewOutput(authorize:()=>Promise<void>):Promise<void>{
    return this.enqueue(async()=>{
      if(!this.options.holdProgramOutputs||!this.options.preview||!this.nativePreviewAdmission||this.programOutputsHeld||this.previewAdmissionStarted||!this.options.assertExecutionOwned)throw new Error('Preview local exige admissão de PGM concluída e liberação ainda não enviada.')
      const child=this.child,binding=this.fenceBinding()
      if(!child||!binding)throw new Error('Preview sem geração/concessão atuais.')
      const assertSame=()=>{
        this.options.assertExecutionOwned!()
        const now=this.fenceBinding()
        if(this.child!==child||!now||now.ownerId!==binding.ownerId||now.term!==binding.term||this.programOutputsHeld)throw new Error('Geração/concessão mudou durante admissão do preview.')
      }
      await authorize();assertSame();this.previewAdmissionStarted=true
      try{
        await this.request({cmd:'releasePreviewOutput',ownerId:binding.ownerId,term:binding.term})
        await authorize();assertSame()
      }catch(error){this.fail('Preview com resultado incerto; geração própria encerrada sem reenvio.');this.close();child.kill('SIGKILL');throw error}
    })
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
    this.replacementWire?.disconnected()
    for(const waiter of this.startupWaiters){clearTimeout(waiter.timer);waiter.reject(new Error(message))}
    this.startupWaiters.clear()
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error(message))
    }
    this.pending.clear()
  }

  private enqueue<T>(action: () => Promise<T>, requireAlive = true): Promise<T> {
    // Reserve synchronously, including the gap before the first microtask.
    // An unsuccessful or identical command still invalidates a prior review.
    this.queuedOperations++
    this.commandSequence++
    const result = this.operation.then(() => {
      if (this.closed || requireAlive && !this.alive) throw new Error('O engine está indisponível.')
      this.options.assertExecutionOwned?.()
      return action()
    }).finally(() => { this.queuedOperations-- })
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

  /** Private HA warmup only: arm a decoder at the saved offset without TAKE,
   * PVW/PGM consumers or as-run. Live LOAD is not first-video proof. */
  prepareHeldDecoder(itemId:string|null,frames:number,trim:ProgramTrim|undefined,authorize:()=>Promise<void>):Promise<{itemId:string|null;decoderId:number|null;firstVideoConfirmed:boolean}>{
    return this.enqueue(async()=>{
      await this.awaitNativeReady()
      if(!this.options.holdProgramOutputs||!this.nativeProgramAdmission||!this.programOutputsHeld||!this.decoderIdentity||!this.options.assertExecutionOwned||this.onAirItemId)throw new Error('Preparo exige engine nativo retido, sem item em PGM, e posse da execução.')
      const child=this.child
      await authorize();this.options.assertExecutionOwned()
      if(this.child!==child||!this.alive||!this.programOutputsHeld)throw new Error('Engine mudou durante o preparo.')
      if(itemId===null){if(frames!==0||trim)throw new Error('Preparo idle não admite offset/corte.');return {itemId:null,decoderId:null,firstVideoConfirmed:false}}
      if(!Number.isSafeInteger(frames)||frames<0)throw new Error('Offset de preparo inválido.')
      const entry=this.view()?.items.find(row=>row.item.id===itemId)
      if(!entry)throw new Error('Item de preparo ausente da edição local.')
      if(trim)assertProgramTrim(entry,trim,frames,this.channel.rate)
      const spec=this.specFor(itemId,this.view(),trim)
      if(!spec||!spec.source&&!trim)throw new Error('Preparo de VT exige versão/corte salvo e QC; live exige vínculo local.')
      spec.startOffsetFrames=frames
      const version=await this.checkFile(spec)
      await authorize();this.options.assertExecutionOwned()
      await this.request({cmd:'load',item:spec})
      if(this.child!==child||this.onAirItemId||!this.programOutputsHeld||this.armedItemId!==itemId||!Number.isSafeInteger(this.armedDecoderId)||this.armedDecoderId!<=0||await this.checkFile(spec)!==version)throw new Error('Decoder/cópia mudou durante o preparo retido.')
      await authorize();this.options.assertExecutionOwned()
      if(this.child!==child||!this.alive||this.onAirItemId||!this.programOutputsHeld||this.armedItemId!==itemId||!Number.isSafeInteger(this.armedDecoderId)||this.armedDecoderId!<=0)throw new Error('Estado nativo mudou ao confirmar o preparo.')
      this.armedSpecification=specificationKey(spec);this.armedFileVersion=version
      return {itemId,decoderId:this.armedDecoderId!,firstVideoConfirmed:!spec.source}
    })
  }

  /** Explicit promotion resume into the INTERNAL held program bus. This is
   * neither watchdog recovery nor permission to publish. A live TAKE ACK is
   * insufficient: wait for this generation's matching native decoder state. */
  resumeHeldProgram(rundownId:string,itemId:string,frames:number,trim:ProgramTrim|undefined,authorize:()=>Promise<void>):Promise<void>{
    return this.enqueue(async()=>{
      await this.awaitNativeReady()
      const child=this.child,binding=this.fenceBinding()
      if(!binding||!this.options.holdProgramOutputs||!this.programOutputsHeld||!this.nativeProgramAdmission||!this.decoderIdentity||!this.options.assertExecutionOwned||this.onAirItemId||this.pendingLiveTake)throw new Error('Retomada HA exige geração cercada, retida e sem programa anterior.')
      if(!Number.isSafeInteger(frames)||frames<0)throw new Error('Offset salvo inválido.')
      const entry=this.view()?.items.find(row=>row.item.id===itemId)
      if(!entry||this.view()?.rundown.id!==rundownId)throw new Error('Retomada não pertence à edição preparada.')
      if(trim)assertProgramTrim(entry,trim,frames,this.channel.rate)
      if(!this.sourceForItem(itemId)&&!trim)throw new Error('VT HA exige corte/versão nativos salvos.')
      const assertSame=()=>{
        this.options.assertExecutionOwned!()
        const now=this.fenceBinding()
        if(this.child!==child||!this.alive||!this.programOutputsHeld||!now||now.ownerId!==binding.ownerId||now.term!==binding.term)throw new Error('Geração/concessão mudou durante a retomada retida.')
      }
      await authorize();assertSame()
      this.recoveryCursor={itemId,frames,programTrim:trim}
      await this.playFrom(rundownId,itemId,frames,true,false,undefined,trim)
      const deadline=Date.now()+30000
      while(this.pendingLiveTake){
        assertSame()
        if(Date.now()>=deadline)throw new Error('Live HA não confirmou primeiro quadro; saídas permanecem retidas.')
        await new Promise<void>(resolve=>setTimeout(resolve,25))
      }
      await authorize();assertSame()
      if(this.onAirItemId!==itemId||!Number.isSafeInteger(this.pgmDecoderId)||this.pgmDecoderId!<=0||this.elapsed<frames)throw new Error('Programa interno não confirmou o item/decoder/offset solicitado.')
    })
  }

  private async request(command: Record<string, unknown>,observeId?:(id:number)=>void): Promise<void> {
    const assertSelection=()=>{const restoring=this.boundRecoveryInProgress&&!this.nativeReportedSelectionUncertain&&['load','take'].includes(String(command.cmd));if((this.nativeSelectionUncertain||this.replacementWire?.health().selectionUncertain||this.pendingReplacementBinding||this.stopAwaitingDurable)&&!restoring&&(['load','take','programHold','restoreProgramHold','setGain'].includes(String(command.cmd))||command.cmd==='seek'&&command.bus==='pgm'))throw new Error('PGM nativo inconclusivo; confirme STOP antes de alterar o programa.')}
    assertSelection()
    // Starting a 30s decoder/ACK deadline before gst_init has scanned a fresh
    // registry kills a valid cold launch. Wait for real native Ready first;
    // close/exit/startup timeout reject this wait, never fabricate readiness.
    await this.awaitNativeReady()
    assertSelection()
    this.options.assertExecutionOwned?.()
    if (!this.alive || this.closed) return Promise.reject(new Error('O engine está indisponível.'))
    // Native LOAD discards the armed decoder and its pending live TAKE without
    // an event. A live waiting for its first frame that is replaced by another
    // item (e.g. operator TAKEs a VT because the source vanished) must not
    // stay pending here: it blocked every publication indefinitely.
    if (command.cmd === 'load') {
      const next=(command.item as EngineItem|undefined)?.itemId,superseded=this.pendingLiveTake
      if (superseded && superseded.itemId !== next) {
        this.pendingLiveTake = null
        this.updateSource(superseded.spec, 'IDLE', 'TAKE substituído por outro item antes do primeiro quadro.', 'pgm')
        if (this.priorityTake?.itemId === superseded.itemId) this.failPriorityTake('TAKE substituído por outro item antes do primeiro quadro.')
        this.dirty = true
      }
    }
    if (command.cmd === 'preview') {
      const item = command.item as EngineItem | null
      this.previewFrameBinding=item?{itemId:item.itemId}:null
      this.nativePreviewFrame=null
      this.requestedLivePreview = item?.source ? {itemId:item.itemId,source:item.source} : null
      if(item?.source)this.updateSource(item,'CUEING','Abrindo a fonte e aguardando o primeiro quadro no PVW.','pvw')
    }
    const id = this.nextId++
    observeId?.(id)
    const hold=command.cmd==='programHold'?{expected:programHoldExpected(command)}:undefined
    const restoreHold=command.cmd==='restoreProgramHold'?{expected:programHoldRestoreExpected(command)}:undefined
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const message = `O engine não confirmou ${String(command.cmd)} em 30 segundos.`
        this.fail(message)
        this.alive = false
        this.rejectPending(message)
        this.child.kill()
      }, 30_000)
      this.pending.set(id, { resolve, reject, timer, since: Date.now(),
        programHold:hold,
        programHoldRestore:restoreHold,
        previewFrameOpening:command.cmd==='preview'?this.previewFrameBinding??undefined:undefined,
        previewOpening:command.cmd==='preview' ? this.requestedLivePreview ?? undefined : undefined })
      this.child.stdin?.write(`${JSON.stringify({ id, ...command })}\n`, (error) => {
        if (error) this.rejectPending(error.message)
      })
    })
  }

  private send(command: Record<string, unknown>): void {
    if (!this.alive || this.closed) return
    try {
      this.options.assertExecutionOwned?.()
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
  private specFor(itemId: string, view: RundownView | null = this.view(),programTrim?:ProgramTrim): EngineItem | null {
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
        configuredSourceId: entry.item.configuredSourceId ?? undefined,
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
    const mounted=view?.schedule.items.find(row=>row.id===itemId)?.state==='ON_AIR'&&this.onAirItemId===itemId&&this.mountedProgramTrim?.itemId===itemId?this.mountedProgramTrim:null
    let cut
    try{cut=programTrim?assertProgramTrim(entry,programTrim,0,this.channel.rate):mounted?{in:mounted.trimIn,out:mounted.trimOut}:executionTrim(entry,view?.schedule.items.find(row=>row.id===itemId),this.channel.rate,view??undefined);assertTrimAudio(entry,cut,this.channel.rate)}catch{return null}

    return {
      itemId,
      path: entry.asset.path,
      contentHash: entry.asset.contentHash,
      trimIn: mounted?.trimIn??cut.in,
      trimOut: mounted?.trimOut??cut.out,
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
  private specForTiming(itemId:string,timing:FrozenExecutionTiming,programTrim?:ProgramTrim):EngineItem|null{
    const current=this.view()
    if(!current||executionTimingKey(current)!==timing.key)return null
    return this.specFor(itemId,{...current,schedule:timing.schedule},programTrim)
  }

  private async playFrom(rundownId: string, itemId: string, resumeFrames = 0, exact = false, copyRetry = true,lifecycle?:TakeLifecycle,recoveryTrim?:ProgramTrim,liveBinding?:LiveProgramBinding): Promise<void> {
    if(!lifecycle && this.options.canStartProgram?.()===false)throw new Error('Há TAKE de retorno inconclusivo. Pare o PGM, limpe o CUE e confira a pendência antes de outra entrada.')
    lifecycle?.validate()
    const view = this.view()
    const executionIdentity = this.options.executionIdentity?.()
    const restored=liveBinding?resolveLiveProgramBinding(liveBinding,{channelId:this.channel.id,rundownId,revisionId:executionIdentity??null,
      executionId:this.options.executionOccurrenceId?.()??undefined,itemId,elapsed:resumeFrames,playing:true,realEngine:true,programTrim:recoveryTrim}):null
    const playbackSpec=(id:string,timing:FrozenExecutionTiming,trim?:ProgramTrim)=>{
      const base=this.specForTiming(id,timing,trim)
      if(restored&&id===itemId){if(!base?.source)return null;return {...base,...restored}}
      return base
    }
    const index = view?.items.findIndex((entry) => entry.item.id === itemId) ?? -1
    if (!view || view.rundown.id !== rundownId || index < 0) throw new Error('O item não está nesta grade.')
    const candidates = exact ? [view.items[index]!] : [...view.items.slice(index), ...(view.rundown.loop ? view.items.slice(0, index) : [])]
    const failedPaths = new Set<string>()
    let lastFailure = 'Nenhum item disponível para reprodução.'
    let versionFailure = false
    for (const entry of candidates) {
      if (!recoveryTrim&&view.schedule.items.find((row) => row.id === entry.item.id)?.state === 'DROPPED') continue
      const isCued=exact&&this.preview?.kind==='ITEM'&&this.preview.id===entry.item.id
      const timing=isCued&&this.previewTiming?this.previewTiming:freezeExecutionTiming(view)
      if(isCued&&timing.key!==executionTimingKey(view))throw new Error('O item publicado mudou após o CUE. Faça CUE novamente para conferir a mídia e os cortes antes do TAKE.')
      if(recoveryTrim)assertProgramTrim(entry,recoveryTrim,resumeFrames,this.channel.rate)
      const spec = playbackSpec(entry.item.id,timing,recoveryTrim)
      if (!spec) {
        lastFailure = entry.item.title + ': ' + (entry.asset?.probeError ?? ((view.rundown.publicationRequired || this.options.executionIdentity?.()) && entry.asset && !isMediaSha(entry.asset.contentHash) ? 'mídia publicada sem SHA válido; reimporte, confira no QC e publique a versão correta' : 'sem arquivo ou fonte válida'))
        versionFailure = Boolean((view.rundown.publicationRequired || this.options.executionIdentity?.()) && entry.asset && !isMediaSha(entry.asset.contentHash))
        this.fail(lastFailure)
        continue
      }
      if (failedPaths.has(spec.path || spec.source!)) continue
      if (exact && this.preview?.kind === 'ITEM' && this.preview.id === spec.itemId && this.previewSpecification !== specificationKey(spec)) throw new MediaVersionError('O item publicado mudou após o CUE. Faça CUE novamente para conferir a mídia e os cortes antes do TAKE.')
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
        const current = playbackSpec(spec.itemId,timing,recoveryTrim)
        if (current && spec.startOffsetFrames !== undefined) current.startOffsetFrames = spec.startOffsetFrames
        const changed = ['itemId','path','source','trimIn','trimOut','gainDb','fit','audioTrack','startOffsetFrames','audioRouting','auxiliaryPairs','contentHash'].filter(field => current && JSON.stringify(current[field as keyof EngineItem]) !== JSON.stringify(spec[field as keyof EngineItem]))
        const currentView = this.view(), hash = entry.asset?.contentHash
        // An archive/cache becoming available changes the decoder path, not
        // the published version. Runtime resolves those copies by SHA-256.
        // Re-preroll once at the new path before sending TAKE; never bypass a
        // changed revision/hash/QC/cut or reuse the already loaded old path.
        if (copyRetry && changed.length === 1 && changed[0] === 'path' && hash && /^[a-f0-9]{64}$/i.test(hash) && currentView?.items.find(row => row.item.id === spec.itemId)?.asset?.contentHash === hash && currentView.rundown.id === rundownId && this.options.executionIdentity?.() === executionIdentity && !(exact && this.preview?.kind === 'ITEM' && this.preview.id === spec.itemId)) return this.playFrom(rundownId, spec.itemId, resumeFrames, exact, false,lifecycle,recoveryTrim)
        if (this.view()?.rundown.id !== rundownId || this.options.executionIdentity?.() !== executionIdentity || !current || specificationKey(current) !== specificationKey(spec)) throw new MediaVersionError(`A revisão ou a mídia mudou durante o preroll. PGM anterior preservado; faça CUE novamente. Contrato alterado: ${this.options.executionIdentity?.() !== executionIdentity ? 'revisão' : this.view()?.rundown.id !== rundownId ? 'grade' : !current ? 'disponibilidade/QC' : changed.join(', ')}.`)
        if (await this.checkFile(spec) !== fileVersion) {
          this.armedSpecification = null; this.armedFileVersion = null
          throw new MediaVersionError('O arquivo foi alterado durante o preroll, mesmo que seu SHA tenha sido restaurado. PGM anterior preservado; prepare o item novamente.')
        }
        const verifiedCurrent = playbackSpec(spec.itemId,timing,recoveryTrim)
        if (verifiedCurrent && spec.startOffsetFrames !== undefined) verifiedCurrent.startOffsetFrames = spec.startOffsetFrames
        if (this.view()?.rundown.id !== rundownId || this.options.executionIdentity?.() !== executionIdentity || !verifiedCurrent || specificationKey(verifiedCurrent) !== specificationKey(spec)) throw new MediaVersionError('A revisão ou a mídia mudou durante a verificação. PGM anterior preservado; faça CUE novamente.')
        if(lifecycle && spec.source)throw new Error('Retorno de VT exige arquivo, não uma entrada ao vivo.')
        if(!lifecycle && this.options.canStartProgram?.()===false)throw new Error('Há retorno de VT inconclusivo. Nenhum TAKE será enviado.')
        lifecycle?.beforeTake()
        const pending = spec.source === undefined ? null : { rundownId, itemId: spec.itemId, spec,decoderId:this.armedDecoderId,...(liveBinding?{liveBinding}:{} ) }
        if (pending) {
          this.pendingLiveTake = pending
          this.updateSource(spec, 'TAKE_PENDING', 'Aguardando o primeiro quadro antes de trocar o PGM.')
        }
        this.pendingProgramExit=this.onAirItemId ? {itemId:this.onAirItemId,frames:Math.max(0,Math.floor(this.elapsed)),reason:this.priorityTake?.itemId===spec.itemId ? 'LIVE_PRIORITY' : this.programEndReason==='STOP' ? 'TAKE' : this.programEndReason,targetItemId:spec.itemId} : null
        await this.request({ cmd: 'take' })
        // O ACK de uma live só confirma que o decoder iniciou. A troca real
        // chega depois no evento `state`, quando há quadro no PGM.
        if (pending) {
          if (this.pendingLiveTake === pending && this.onAirItemId === spec.itemId && this.decoderMatches(this.pgmDecoderId,pending.decoderId)) this.confirmLiveTake(pending)
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
        // Exact recovery must preserve definitive native refusal as distinct
        // from timeout/unknown outcome. Never infer it from a message string.
        if(exact&&failure instanceof EngineCommandRejected)throw new EngineCommandRejected('Nenhum item reproduzível. '+lastFailure,{cause:failure})
        failedPaths.add(spec.path || spec.source!)
        // Sem engine não tente a grade inteira: deixe o watchdog recuperar.
        if (!this.alive || this.closed) throw failure
        continue
      }
      // Only the PVW that just went on air is consumed. An automatic advance
      // (EOS -> next grade line) used to clear whatever the operator had
      // armed in PVW, so a live CUEd during a short VT vanished before TAKE.
      const consumedPreview=this.previewIs(spec)
      this.confirmTake(rundownId, spec)
      lifecycle?.confirmed(true)
      if(consumedPreview)await this.request({ cmd: 'preview', item: null })
      return
    }
    // Uma tentativa manual fracassada preserva o que já estava no ar.
    if (!this.onAirItemId) this.preview = null
    this.dirty = true
    if (versionFailure) throw new MediaVersionError('Nenhum item reproduzível. ' + lastFailure)
    throw new Error('Nenhum item reproduzível. ' + lastFailure)
  }

  /** Recebe a confirmação tardia da primeira imagem ao vivo no PGM. */
  private confirmLiveTake(pending: { rundownId: string; itemId: string; spec: EngineItem;liveBinding?:LiveProgramBinding }): void {
    if (this.pendingLiveTake !== pending) return
    this.pendingLiveTake = null
    this.updateSource(pending.spec, 'ON_PGM', null)

    // Só fecha o PVW se ele ainda representa a mesma entrada. Uma nova
    // seleção feita durante o preroll não pode ser apagada por confirmação
    // atrasada da fonte anterior.
    const samePreview =
      (this.preview?.kind === 'ITEM' && this.preview.id === pending.itemId) ||
      (this.preview?.kind === 'SOURCE' && this.preview.source === pending.spec.source)
    this.confirmTake(pending.rundownId, pending.spec,pending.liveBinding)
    if (!samePreview) return
    void this.enqueue(() => this.request({ cmd: 'preview', item: null }))
      .catch((error: Error) => this.fail(error.message))
  }

  /** Whether the PVW currently armed is exactly what this spec puts on air. */
  private previewIs(spec:Pick<EngineItem,'itemId'|'source'>):boolean{
    return (this.preview?.kind==='ITEM'&&this.preview.id===spec.itemId)||(this.preview?.kind==='SOURCE'&&Boolean(spec.source)&&this.preview.source===spec.source)
  }

  /** Estado compartilhado por qualquer TAKE já efetivado no PGM. */
  private confirmTake(rundownId: string, spec: EngineItem,liveBinding?:LiveProgramBinding): void {
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
    // A grade line armed in PVW belongs to the plan that was running; when
    // another playlist takes over, that CUE no longer exists and is cleared.
    const planChanged=this.rundownId!==null&&this.rundownId!==rundownId
    this.rundownId = rundownId
    this.preparationFailures.clear()
    this.elapsed = spec.startOffsetFrames ?? 0
    this.onAirStartedAt=framesSinceMidnight(new Date(),this.channel.rate)-this.elapsed
    this.mountedProgramTrim=spec.source?null:{itemId:spec.itemId,trimIn:spec.trimIn,trimOut:spec.trimOut,contentHash:spec.contentHash}
    this.mountedLiveSpec=spec.source?structuredClone(spec):null
    this.programLiveBinding=spec.source&&liveBinding?structuredClone(liveBinding):null
    if(recovered&&liveBinding&&!this.nativeReportedSelectionUncertain){this.replacementWire?.confirmRecovered(liveBinding.receipt);this.nativeSelectionUncertain=false;this.replacementReceiptUncertain=null;this.pendingReplacementBinding=null}
    try { this.options.onTakeConfirmed?.(spec.itemId, this.elapsed, recovered, previous) }
    catch (error) { this.fail('Falha ao registrar TAKE confirmado: ' + (error instanceof Error ? error.message : String(error))) }
    this.liveStartedAtMs = spec.source === undefined ? null : Date.now() - framesToMs(this.elapsed, this.channel.rate)
    this.liveEndsAt = spec.source === undefined ? null : this.plannedEnd(spec.itemId)
    this.appliedGainDb = spec.gainDb
    if(this.previewIs(spec)||(planChanged&&this.preview?.kind==='ITEM')){
      this.preview = null
      this.previewSpecification = null
      this.previewTiming = null
      this.previewFileVersion = null
      this.previewPosition = null
      this.previewReading = SILENCE
    }
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

  /** After a refused live on automatic advance, play the next playable line
   * after it. Only while the ended item is still the PGM and the grade is the
   * same; a manual TAKE or another advance in between wins. */
  private skipFailedLive(rundownId:string,failedId:string,endedId:string):void{
    if(this.advancing)return
    this.advancing=true
    void this.enqueue(async()=>{
      const view=this.view()
      if(!view||view.rundown.id!==rundownId||this.onAirItemId!==endedId||this.pendingLiveTake)return
      const index=view.items.findIndex(entry=>entry.item.id===failedId)
      if(index<0)return
      const candidates=[...view.items.slice(index+1),...(view.rundown.loop?view.items.slice(0,index):[])]
      const next=candidates.find(entry=>entry.item.id!==failedId&&view.schedule.items.find(timing=>timing.id===entry.item.id)?.state!=='DROPPED')
      if(!next)return
      this.fail('Entrada ao vivo sem sinal na virada automática; a grade seguiu para o próximo item.')
      await this.playFrom(view.rundown.id,next.item.id)
    }).catch((error:Error)=>this.fail(error.message)).finally(()=>{this.advancing=false})
  }

  private programTrimFor(itemId:string):ProgramTrim|null{
    const mounted=this.mountedProgramTrim
    return mounted?.itemId===itemId&&isMediaSha(mounted.contentHash)?{in:mounted.trimIn,out:mounted.trimOut,contentHash:mounted.contentHash!}:null
  }

  state(): TransportState {
    const mounted=this.onAirItemId?this.programTrimFor(this.onAirItemId):null
    const onAir: OnAirState | null = this.onAirItemId
      ? {
          itemId: this.onAirItemId,
          startedAt: this.onAirStartedAt??(this.onAirStartedAt=framesSinceMidnight(new Date(),this.channel.rate)-this.elapsed),
          elapsed: this.elapsed,
          ...(mounted?{mountedDuration:mounted.out-mounted.in}:{}),
        }
      : null

    return {
      mode: 'NATIVE',
      channelId: this.channel.id,
      rundownId: this.rundownId,
      onAir,
      programTrim:this.onAirItemId?this.programTrimFor(this.onAirItemId):null,
      preview: this.preview,
      previewPosition: this.previewPosition,
      previewFrame:this.previewFrameEvidence(),
      preparedItemId: this.armedItemId,
      preparingItemId: this.preparingItemId,
      playing: this.onAirItemId !== null&&!this.nativeHoldUnsafe,
      standby: this.onAirItemId === null && this.preview?.kind === 'ITEM',
      liveSources: [...this.sourceSignals.values()].map(signal => {
        const onPgm = this.onAirItemId ? this.sourceForItem(this.onAirItemId) === signal.source : false
        const selectedPreview = this.preview ? this.specForPreview(this.preview) : null
        const onPvw = selectedPreview?.source === signal.source
          && this.requestedLivePreview?.source === signal.source
          && this.requestedLivePreview?.itemId === selectedPreview?.itemId
        const busStates: Partial<Record<'pgm' | 'pvw', LiveSourceSignalState>> = {}
        const busSignals: Partial<Record<'pgm' | 'pvw', LiveSignalAssessment>> = {}
        for (const [bus, active] of [['pgm',onPgm],['pvw',onPvw]] as const) {
          const original = signal.busStates?.[bus]
          if (!original) continue
          busSignals[bus] = assessLiveSignal({mode:'NATIVE',active,lifecycle:original,sample:signal.measurements?.[bus],policy:(this.view()?.channel??this.channel).qcProfile?.liveSignalPolicy})
          if (!active) { busStates[bus] = ['ON_PGM','PVW_READY'].includes(original) ? 'IDLE' : original; continue }
          const measurement = signal.measurements?.[bus]
          const age = measurement ? signalSampleAge(measurement.sampledAt) : null
          const lost = measurement && !signalBufferIsRecent(measurement.videoPresent,measurement.videoAgeMs,age)
          // A fresh decoder with zero frames is still opening, not a signal
          // that was acquired and subsequently lost. Keep measured NO_VIDEO
          // separate: this tally must never manufacture readiness for TAKE.
          busStates[bus] = lost && ['PVW_READY','ON_PGM','LOST'].includes(original) ? 'LOST' : original
        }
        const state = onPgm ? busStates.pgm ?? signal.state : onPvw ? busStates.pvw ?? signal.state
          : (['FAILED','LOST','CUEING','TAKE_PENDING'].includes(signal.state) ? signal.state : 'IDLE')
        const message = state === 'IDLE' ? 'Fonte não está sintonizada neste barramento.'
          : state === 'LOST' && signal.state !== 'LOST' ? 'Fonte sem quadro recente (mais de 2 segundos); a imagem anterior não prova sinal ativo.'
          : state === 'CUEING' ? openingWithoutSignalMessage(signal.source,signal.changedAt,Date.now()) ?? signal.message : signal.message
        const busItemIds:Partial<Record<'pgm'|'pvw',string>>={}
        if(onPgm && this.onAirItemId)busItemIds.pgm=this.onAirItemId
        const previewSpec=this.preview ? this.specForPreview(this.preview) : null
        if(onPvw && previewSpec)busItemIds.pvw=previewSpec.itemId
        const nativeCatalogBindings:Partial<Record<'pgm'|'pvw',string>>={}
        for(const bus of ['pgm','pvw'] as const)if(busItemIds[bus]&&signal.busItemIds?.[bus]===busItemIds[bus]&&signal.nativeCatalogBindings?.[bus])nativeCatalogBindings[bus]=signal.nativeCatalogBindings[bus]
        return { ...signal, state, message, busStates,busItemIds,busSignals,nativeCatalogBindings }
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

  recover(rundownId:string,itemId:string,frames:number,programTrim?:ProgramTrim,liveProgramBinding?:LiveProgramBinding):Promise<void> {
    return this.enqueue(async()=>{
      if(liveProgramBinding){await this.awaitNativeReady();if(!this.decoderIdentity||!this.nativeReplacementCapability.supported)throw new Error('Retomada da fonte confirmada exige engine com contrato/geração nativos compatíveis; não usar fonte original por fallback.')}
      if(this.options.canRecoverProgram && !this.options.canRecoverProgram())throw new Error('Passagem de playlist sem conclusão durável. Recuperação automática bloqueada; confira o PGM antes de retomar.')
      const entry=this.view()?.items.find(row=>row.item.id===itemId),cut=programTrim??this.programTrimFor(itemId)??undefined
      if(entry?.asset&&!entry.item.sourceRef&&!entry.item.liveEndpoint&&!entry.item.liveConfig?.sourceEndpoint&&!cut)throw new Error('Não há corte confirmado do PGM para recuperação automática. Faça CUE/TAKE explicitamente.')
      // A live ACK precedes the first valid PGM frame. Keep recovery identity
      // beyond this promise's return, until confirmTake consumes the cursor.
      this.recoveryCursor={itemId,frames,programTrim:cut,...(liveProgramBinding?{liveProgramBinding}:{} )}
      if(liveProgramBinding&&(this.nativeReportedSelectionUncertain||this.replacementWire?.health().selectionUncertain&&!this.replacementWire.canRecoverBinding(liveProgramBinding.receipt)))throw new Error('Troca inconclusiva pertence a outra fonte; STOP obrigatório antes de retomar.')
      this.boundRecoveryInProgress=Boolean(liveProgramBinding)
      try{await this.playFrom(rundownId,itemId,frames,true,true,undefined,cut,liveProgramBinding)}finally{this.boundRecoveryInProgress=false}
    })
  }

  /** Native frozen restoration only. Runtime must separately commit recovery
   * identity/as-run and release checkpoint protection after this proof. */
  recoverHeld(rundownId:string,itemId:string,frames:number,programTrim:ProgramTrim,commit?:(proof:{itemId:string;decoderId:number;frames:number})=>Promise<void>):Promise<{itemId:string;decoderId:number;frames:number}>{
    return this.enqueue(async()=>{
      const view=this.view(),execution=this.options.executionIdentity?.(),child=this.child
      if(!view||view.rundown.id!==rundownId||this.onAirItemId||this.armedItemId||this.pendingLiveTake||this.pendingPlaylistTake)throw new Error('Restauração pausada exige grade atual e PGM/preparação vazios.')
      const timing=executionTimingKey(view),entry=view.items.find(row=>row.item.id===itemId)
      if(!entry||!Number.isSafeInteger(frames)||frames<0)throw new Error('Cursor pausado ou item inválido.')
      assertProgramTrim(entry,programTrim,frames,this.channel.rate)
      const spec=this.specFor(itemId,view,programTrim)
      if(!spec||spec.source||!isMediaSha(spec.contentHash))throw new Error('Quadro pausado exige arquivo aprovado com SHA e corte confirmados.')
      spec.startOffsetFrames=frames
      const assertCurrent=()=>{
        this.options.assertExecutionOwned?.()
        const current=this.view()
        if(this.child!==child||this.closed||!this.alive||!current||current.rundown.id!==rundownId||executionTimingKey(current)!==timing||this.options.executionIdentity?.()!==execution||this.options.canRecoverProgram?.()===false)throw new Error('Contexto/posse mudou; restauração pausada inconclusiva, sem repetição automática.')
      }
      assertCurrent();const version=await this.checkFile(spec);assertCurrent()
      if(this.onAirItemId||this.armedItemId)throw new Error('PGM mudou durante a verificação do arquivo pausado.')
      this.recoveryCursor={itemId,frames,programTrim,programHold:'HELD'}
      await this.request({cmd:'restoreProgramHold',item:spec})
      assertCurrent()
      if(await this.checkFile(spec)!==version)throw new MediaVersionError('Versão mudou durante restauração pausada; checkpoint anterior preservado.')
      assertCurrent()
      const hold=this.nativeProgramHold
      if(!hold||hold.status!=='HELD'||hold.itemId!==itemId||hold.frames!==frames||hold.decoderId!==this.pgmDecoderId||this.onAirItemId!==itemId)throw new Error('Estado pausado mudou após ACK; checkpoint anterior preservado.')
      this.rundownId=rundownId;this.elapsed=frames
      this.mountedProgramTrim={itemId,trimIn:spec.trimIn,trimOut:spec.trimOut,contentHash:spec.contentHash}
      this.onAirStartedAt=framesSinceMidnight(new Date(),this.channel.rate)-frames
      const proof={itemId,decoderId:hold.decoderId,frames}
      await commit?.(proof)
      assertCurrent()
      if(this.nativeProgramHold?.status!=='HELD'||this.nativeProgramHold.decoderId!==proof.decoderId||this.nativeProgramHold.frames!==frames||this.onAirItemId!==itemId)throw new Error('PGM mudou durante commit pausado; resultado inconclusivo.')
      this.recoveryCursor=null;this.dirty=true
      return proof
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
    return this.enqueue(()=>this.cueNow(target))
  }
  private async cueNow(target:PreviewTarget|null):Promise<void>{
      // Uma nova escolha do operador vence a fonte que ainda aguardava vídeo.
      // Sem cancelar no engine, a fonte antiga podia cortar o PGM sozinha
      // quando o sinal voltasse.
      if (this.pendingLiveTake) {
        await this.request({ cmd: 'cancelTake' })
        this.pendingLiveTake = null
        this.failPriorityTake('Entrada prioritária cancelada por um novo CUE do operador.')
      }
      const currentView=this.view()
      const timing=target?.kind==='ITEM'&&currentView?freezeExecutionTiming(currentView):null
      const previewSpec=()=>target?.kind==='ITEM'&&timing?this.specForTiming(target.id,timing):target?this.specForPreview(target):null
      const spec = previewSpec()
      if (target && !spec) throw new Error('O arquivo do preview não está disponível. Atualize o acervo.')
      const fileVersion = spec ? await this.checkFile(spec) : null
      const currentPreview = previewSpec()
      if (spec && (!currentPreview || specificationKey(currentPreview) !== specificationKey(spec))) throw new Error('A mídia mudou durante a verificação do CUE. Selecione novamente o preview.')
      try {
        await this.request({ cmd: 'preview', item: spec })
        if (spec && !spec.source) {
          try {
            const verifiedVersion = await this.checkFile(spec), verifiedPreview = previewSpec()
            if (verifiedVersion !== fileVersion || !verifiedPreview || specificationKey(verifiedPreview) !== specificationKey(spec)) throw new MediaVersionError('A mídia mudou durante a preparação do CUE. Selecione novamente o preview; PGM anterior preservado.')
          } catch (error) {
            this.preview = null; this.previewSpecification = null; this.previewTiming=null; this.previewFileVersion = null; this.previewPosition = null; this.previewReading = SILENCE; this.dirty = true
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
      this.previewTiming = timing
      this.previewFileVersion = fileVersion
      this.previewPosition = spec && !spec.source ? { frames: 0, duration: Math.max(0, spec.trimOut - spec.trimIn) } : null
      this.previewReading = SILENCE
      this.dirty = true
  }

  /** Commands of a promoted generation are serialized with preroll/EOS and
   * cannot silently select a later item or address a different native owner. */
  private admittedCommandGeneration(){
    const child=this.child,binding=this.fenceBinding()
    if(!child||!binding||!this.options.holdProgramOutputs||this.programOutputsHeld||!this.nativeProgramAdmission||!this.decoderIdentity||!this.options.assertExecutionOwned)throw new Error('Controle HA exige geração nativa própria admitida.')
    return {binding,assertSame:()=>{
      this.options.assertExecutionOwned!();const now=this.fenceBinding()
      if(this.closed||!this.alive||!this.ready||this.child!==child||!now||now.ownerId!==binding.ownerId||now.term!==binding.term||this.programOutputsHeld)throw new Error('Controle perdeu geração/concessão admitida.')
    }}
  }
  admittedControlReceipt(requestId:string){
    const receipt=this.admittedReceipts.get(requestId),binding=this.fenceBinding()
    if(!receipt||!binding||this.closed||!this.alive||!this.ready||this.programOutputsHeld||receipt.proof.ownerId!==binding.ownerId||receipt.proof.term!==binding.term)return null
    try{this.options.assertExecutionOwned?.()}catch{return null}
    return structuredClone(receipt)
  }
  private recordAdmittedReceipt(requestId:string,receipt:NonNullable<ReturnType<EngineTransport['admittedControlReceipt']>>){
    if(this.admittedReceipts.has(requestId))throw new Error('Recibo nativo já existe para este UUID.')
    this.admittedReceipts.set(requestId,receipt)
    if(this.admittedReceipts.size>256)this.admittedReceipts.delete(this.admittedReceipts.keys().next().value!)
  }
  cueAdmitted(itemId:string,authorize:()=>Promise<void>,requestId:string):Promise<{itemId:string;ownerId:string;term:number;programChanged:false;signalConfirmed:false}>{
    return this.enqueue(async()=>{
      const generation=this.admittedCommandGeneration()
      if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(requestId)||this.admittedReceipts.has(requestId))throw new EngineCommandRejected('UUID do controle inválido/já confirmado; não repetir CUE.')
      await authorize();generation.assertSame()
      if(!this.view()?.items.some(entry=>entry.item.id===itemId))throw new EngineCommandRejected('CUE não pertence à edição operacional admitida.')
      if(this.pendingLiveTake||this.pendingPlaylistTake||this.priorityTake)throw new EngineCommandRejected('Há TAKE pendente; não substituí-lo implicitamente por CUE HA.')
      await this.cueNow({kind:'ITEM',id:itemId})
      generation.assertSame()
      const proof={itemId,ownerId:generation.binding.ownerId,term:generation.binding.term,programChanged:false as const,signalConfirmed:false as const}
      this.recordAdmittedReceipt(requestId,{action:'CUE',revisionId:this.options.executionIdentity?.()??null,proof})
      await authorize();generation.assertSame()
      if(this.preview?.kind!=='ITEM'||this.preview.id!==itemId)throw new Error('CUE não confirmou a seleção solicitada.')
      // An opening ACK is not a first video buffer or signal-quality proof.
      return proof
    })
  }
  takeCuedAdmitted(itemId:string,authorize:()=>Promise<void>,requestId:string):Promise<{itemId:string;decoderId:number;ownerId:string;term:number;elapsed:number;nativeConfirmed:true}>{
    return this.enqueue(async()=>{
      const generation=this.admittedCommandGeneration(),view=this.view()
      if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(requestId)||this.admittedReceipts.has(requestId))throw new EngineCommandRejected('UUID do controle inválido/já confirmado; não repetir TAKE.')
      await authorize();generation.assertSame()
      if(!view||this.preview?.kind!=='ITEM'||this.preview.id!==itemId||this.pendingLiveTake||this.pendingPlaylistTake||this.priorityTake)throw new EngineCommandRejected('TAKE HA exige exatamente o CUE atual, sem outra troca pendente.')
      let confirmed=false,confirmedDecoderId:number|null=null
      const previousDecoderId=this.programDecoderBinding()?.decoderId??null
      await this.playFrom(view.rundown.id,itemId,0,true,false,{
        validate:()=>{generation.assertSame();if(this.preview?.kind!=='ITEM'||this.preview.id!==itemId)throw new Error('CUE mudou antes do TAKE.')},
        beforeTake:()=>generation.assertSame(),
        confirmed:native=>{
          if(!native)return
          const decoder=this.programDecoderBinding()
          if(!decoder||decoder.itemId!==itemId||decoder.decoderId===previousDecoderId)return
          confirmed=true;confirmedDecoderId=decoder.decoderId
          const proof={itemId,decoderId:decoder.decoderId,ownerId:generation.binding.ownerId,term:generation.binding.term,elapsed:this.elapsed,nativeConfirmed:true as const}
          this.recordAdmittedReceipt(requestId,{action:'TAKE',revisionId:this.options.executionIdentity?.()??null,proof})
        },
      })
      const deadline=performance.now()+30000
      while(this.pendingLiveTake){
        generation.assertSame()
        if(performance.now()>=deadline){await this.request({cmd:'cancelTake'});this.pendingLiveTake=null;throw new Error('Live não confirmou quadro no prazo; TAKE não será repetido.')}
        await new Promise<void>(resolve=>setTimeout(resolve,25))
      }
      await authorize();generation.assertSame()
      const decoder=this.programDecoderBinding()
      if(!confirmed||!decoder||decoder.itemId!==itemId||decoder.decoderId!==confirmedDecoderId||!Number.isSafeInteger(this.elapsed)||this.elapsed<0)throw new Error('TAKE sem confirmação nativa atribuível ao CUE solicitado.')
      return {itemId,decoderId:decoder.decoderId,ownerId:generation.binding.ownerId,term:generation.binding.term,elapsed:this.elapsed,nativeConfirmed:true}
    })
  }

  /** Atualiza apenas quando há uma fonte concreta; arquivo MAM nunca entra aqui. */
  private updateSource(spec: Pick<EngineItem, 'itemId' | 'source'>, state: LiveSourceSignalState, message: string | null, bus?: 'pgm' | 'pvw', preserveSelectedPgm=false): void {
    if (!spec.source) return
    const previous = this.sourceSignals.get(spec.source)
    const targetBus = bus ?? (state === 'CUEING' || state === 'PVW_READY' ? 'pvw' : 'pgm')
    // A pending TAKE of another item on this same endpoint must not replace
    // the diagnostics of the PGM still selected by the native engine.
    const preservePgm = targetBus === 'pgm' && (state === 'TAKE_PENDING' || state === 'FAILED')
      && previous?.busItemIds?.pgm === this.onAirItemId && (this.onAirItemId !== spec.itemId || state==='TAKE_PENDING' || preserveSelectedPgm)
    const measurements = { ...previous?.measurements }
    const nativeCatalogBindings={...previous?.nativeCatalogBindings}
    if(!preservePgm&&(state==='CUEING'||state==='LOST'||state==='FAILED'||previous?.busItemIds?.[targetBus]!==spec.itemId))delete nativeCatalogBindings[targetBus]
    if (!preservePgm && (state === 'CUEING' || state === 'LOST' || state === 'FAILED' || previous?.busItemIds?.[targetBus] !== spec.itemId)) delete measurements[targetBus]
    this.sourceSignals.set(spec.source, {
      source: spec.source,
      itemId: spec.itemId,
      state,
      message: message === null ? null : sanitizeDiagnostic(message),
      changedAt: new Date().toISOString(),
      busStates: preservePgm ? previous?.busStates : { ...previous?.busStates, [targetBus]: state },
      busItemIds: preservePgm ? previous?.busItemIds : { ...previous?.busItemIds, [targetBus]: spec.itemId },
      measurements,
      nativeCatalogBindings,
    })
    this.notifySignalObservation()
  }

  private notifySignalObservation():void{
    try{this.options.onSignalObservation?.()}catch(error){console.error('RPlayout: observação não persistida; verificar armazenamento.',error instanceof Error?error.message:'falha de observação')}
  }

  private recordNativeCatalogBinding(itemId:string,bus:'pgm'|'pvw',configuredId:string|null|undefined,decoderId:number|undefined):void{
    const spec=bus==='pgm'?this.mountedLiveSpec?.itemId===itemId?this.mountedLiveSpec:this.specFor(itemId):this.preview?this.specForPreview(this.preview):null
    if(!spec?.source)return
    const previous=this.sourceSignals.get(spec.source)
    if(!previous)return
    const bindings={...previous.nativeCatalogBindings}
    if(this.decoderIdentity&&Number.isSafeInteger(decoderId)&&configuredId&&configuredId===spec.configuredSourceId&&previous.busItemIds?.[bus]===itemId)bindings[bus]=configuredId
    else delete bindings[bus]
    this.sourceSignals.set(spec.source,{...previous,nativeCatalogBindings:bindings})
  }

  private sourceForItem(itemId: string,bus:'pgm'|'pvw'='pgm'): string | undefined {
    if(bus==='pgm'&&this.onAirItemId===itemId&&this.mountedLiveSpec?.itemId===itemId)return this.mountedLiveSpec.source
    if(bus==='pvw'&&this.requestedLivePreview?.itemId===itemId)return this.requestedLivePreview.source
    return itemId.startsWith('source:')
      ? itemId.slice('source:'.length)
      : this.specFor(itemId)?.source
  }
  /** A discarded QC/preview decoder cannot refresh a different item using the
   * same endpoint. This binds identities, not just source names or HTTP ACKs. */
  private decoderMatches(actual:number|undefined,expected:number|undefined):boolean {
    return !this.decoderIdentity || Number.isSafeInteger(actual) && actual!>0 && actual===expected
  }
  private sourceEventMatchesBus(itemId: string, bus: 'pgm' | 'pvw',decoderId?:number): boolean {
    if(bus==='pgm'&&this.nativeSelectionUncertain)return false
    const source = this.sourceForItem(itemId,bus)
    const selected = bus === 'pgm' ? this.onAirItemId === itemId
      : this.requestedLivePreview?.itemId === itemId && this.requestedLivePreview?.source === source
    return selected && !!source && this.sourceSignals.get(source)?.busItemIds?.[bus] === itemId
      && this.decoderMatches(decoderId,bus==='pgm'?this.pgmDecoderId:this.requestedLivePreview?.decoderId)
  }
  private updateSourceForItem(itemId: string, state: LiveSourceSignalState, message: string | null, bus?: 'pgm' | 'pvw', preserveSelectedPgm=false): void {
    const selectedBus=bus??(itemId===this.onAirItemId?'pgm':'pvw'),source=this.sourceForItem(itemId,selectedBus)
    if (source) this.updateSource({ itemId, source }, state, message, selectedBus,preserveSelectedPgm)
  }

  stop(): Promise<void> {
    return this.enqueue(async () => {
      const child=this.child;let nativeRequestId=0
      this.stopAwaitingDurable=true
      await this.request({ cmd: 'stop' },id=>{nativeRequestId=id})
      if(this.onAirItemId!==null)throw new Error('STOP sem confirmação de PGM vazio; cursor preservado.')
      if(child!==this.child)throw new Error('STOP pertence a outra geração nativa.')
      try{
        for(const session of this.replacementSessions.values()){
          if(session.request.transactionId!==this.programLiveBinding?.receipt.transactionId&&!this.replacementWire?.requiresStopResolution(session.request.transactionId))continue
          const generation=this.nativeReplacementCapability.engineGeneration
          if(!generation)throw new Error('STOP sem identidade da geração nativa.')
          const previousOwnedGenerationExited=session.child!==child&&this.nativeExitOutcomes.has(session.child)
          if(session.child!==child&&!previousOwnedGenerationExited)throw new Error('Geração anterior sem saída observada; journal de corte preservado.')
          session.persistence.stopped({engineGeneration:generation,nativeRequestId,previousOwnedGenerationExited})
        }
        this.options.onStopDurable?.({engineGeneration:this.nativeReplacementCapability.engineGeneration,nativeRequestId})
      }catch(error){this.nativeSelectionUncertain=true;this.fail('STOP nativo confirmado, registro durável pendente; novas trocas bloqueadas.');throw error}
      this.replacementWire?.confirmStopped();this.pendingReplacementBinding=null;this.replacementReceiptUncertain=null;this.nativeReportedSelectionUncertain=false
      this.nativeSelectionUncertain=false
      this.programLiveBinding=null;this.mountedLiveSpec=null
      this.options.onStopConfirmed?.()
      this.stopAwaitingDurable=false
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
      const view=this.view(),timing=view?freezeExecutionTiming(view):null
      const spec = timing?this.specForTiming(itemId,timing):null
      if (!spec) throw new Error('O primeiro item não está disponível. Atualize a grade.')
      const fileVersion = await this.checkFile(spec)
      await this.request({ cmd: 'load', item: spec })
      if (await this.checkFile(spec) !== fileVersion) throw new MediaVersionError('O arquivo mudou durante o preroll; PGM anterior preservado. Prepare novamente.')
      const current=timing?this.specForTiming(itemId,timing):null
      if(!current||specificationKey(current)!==specificationKey(spec))throw new Error('A grade mudou durante a preparação; PGM anterior preservado. Prepare novamente.')
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
      this.previewTiming = timing
      this.previewFileVersion = fileVersion
      this.previewPosition = { frames: 0, duration: Math.max(0, spec.trimOut - spec.trimIn) }
      this.dirty = true
    })
  }

  seek(bus: 'pgm' | 'pvw', frames: Frames): Promise<void> {
    return this.enqueue(async () => {
      await this.request({ cmd: 'seek', bus, frames: Math.max(0, Math.round(frames)) })
      if (bus === 'pgm') {this.elapsed = Math.max(0, Math.round(frames));this.onAirStartedAt=framesSinceMidnight(new Date(),this.channel.rate)-this.elapsed}
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
    if(!this.nativeSelectionUncertain&&!this.replacementWire?.health().selectionUncertain&&!this.pendingReplacementBinding&&!this.stopAwaitingDurable){
      this.syncGain()
      this.enterPriorityLiveWhenDue()
      this.endLiveWhenDue()
      this.prepareAhead()
    }
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
    if (this.priorityTake || this.pendingLiveTake || this.pendingPlaylistTake) return
    // No anchor at all in (since, now]: advancing the window loses nothing,
    // blocked or not, so the storage-backed gate is not needed this tick.
    const crossed = priorityLives(view, now).filter(target => target.atMs > since && target.atMs <= now)
    if (!crossed.length) { this.priorityObservedAt = now; return }
    if (this.options.canStartProgram?.()===false) return
    this.priorityObservedAt = now
    const target = crossed.find(target => !this.handledPriorityLives.has(target.key) && target.itemId !== this.onAirItemId && target.atMs > since && target.atMs <= now)
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
    if(this.pendingPlaylistTake)return
    if (this.liveStartedAtMs === null || !this.onAirItemId) return
    // Storage-backed gate only when a live is actually on air (20 Hz tick).
    if(this.options.canStartProgram?.()===false)return
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
  previewFrameEvidence():(PreviewFrameObservation&{sampledAt:number})|null{
    const sample=this.nativePreviewFrame,binding=this.previewFrameBinding
    if(!this.alive||!this.ready||this.closed||!sample||!binding||!readPreviewFrame(sample,binding))return null
    const elapsed=performance.now()-sample.observedAt
    if(elapsed<0||elapsed>2000)return null
    const ageMs=sample.ageMs===null?null:sample.ageMs+Math.floor(elapsed)
    return {itemId:sample.itemId,decoderId:sample.decoderId,pausedFile:sample.pausedFile,ageMs,sampledAt:sample.sampledAt,delivered:sample.delivered&&(sample.pausedFile||ageMs!==null&&ageMs<=2000)}
  }

  videoProbe(): ProgramVideoProbe | null {
    return this.pgmVideoProbe
  }

  /** Alarm detection never accumulates time from stale cached telemetry. */
  signalSample(now=Date.now(),maxAgeMs=1500){
    const fresh=(at:number|null)=>at!==null&&now>=at&&now-at<=maxAgeMs
    const age=this.pgmVideoProbe?.sampleAgeMs
    const nativeFresh=age===undefined||(typeof age==='number'&&Number.isFinite(age)&&age>=0&&age+(now-(this.pgmVideoProbeAt??now))<=maxAgeMs)
    return {meter:fresh(this.pgmMeterAt)?this.meter:null,videoProbe:fresh(this.pgmVideoProbeAt)&&nativeFresh?this.pgmVideoProbe:null}
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
    // canStartProgram reads storage; it is checked right before any preroll
    // starts below, not on every tick where the next item is already armed.
    if(this.queuedOperations>0 || this.priorityTake || this.pendingPlaylistTake)return
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
      if(this.options.canStartProgram?.()===false)return
      this.nextBoundaryPreparationAt=Date.now()+1000
      this.preparingBoundary=true
      const origin=this.onAirItemId,revision=this.options.executionIdentity?.()
      const sequence=this.commandSequence+1
      const preparationCurrent=()=>this.commandSequence===sequence&&this.onAirItemId===origin&&this.options.executionIdentity?.()===revision
        &&!this.pendingLiveTake&&!this.pendingPlaylistTake&&!this.priorityTake&&this.options.canStartProgram?.()!==false
      let boundarySpecKey:string|null=null
      void this.enqueue(async()=>{
        if(!preparationCurrent())return
        const prepared=await this.options.onPreparePlaylistEnd!()
        if(!prepared || !preparationCurrent() || !prepared.stillCurrent())return
        const spec=this.specFor(prepared.itemId,prepared.view)
        if(!spec || spec.source || this.preparationFailures.has(specificationKey(spec)) || this.armedItemId===spec.itemId && this.armedSpecification===specificationKey(spec))return
        boundarySpecKey=specificationKey(spec)
        this.preparingItemId=spec.itemId;this.dirty=true
        const fileVersion = await this.checkFile(spec)
        if(!prepared.stillCurrent() || !preparationCurrent())return
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
    if(this.options.canStartProgram?.()===false)return
    this.preparingItemId = next.item.id
    this.dirty = true
    const origin=this.onAirItemId,revision=this.options.executionIdentity?.(),sequence=this.commandSequence+1
    const stillCurrent=()=>this.commandSequence===sequence&&this.onAirItemId===origin&&this.options.executionIdentity?.()===revision
      &&!this.pendingLiveTake&&!this.pendingPlaylistTake&&!this.priorityTake&&this.options.canStartProgram?.()!==false
    void this.enqueue(async () => {
      // Uma ordem manual pode ter mudado o ar enquanto aguardávamos a fila.
      if(!stillCurrent())return
      if (this.onAirItemId === spec.itemId || (this.armedItemId === spec.itemId && this.armedSpecification === specificationKey(spec))) return
      const current = this.specFor(spec.itemId)
      if (!current || specificationKey(current) !== specificationKey(spec)) return
      const fileVersion = await this.checkFile(spec)
      if(!stillCurrent())return
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
  setMonitorConfirmed(bus:'pvw'|'mon',on:boolean,authorize:()=>Promise<void>):Promise<void>{
    return this.enqueue(async()=>{
      const child=this.child,binding=this.fenceBinding()
      if(!child||!binding||this.programOutputsHeld||!this.options.assertExecutionOwned)throw new Error('Monitor HA exige execução própria admitida.')
      const assertSame=()=>{this.options.assertExecutionOwned!();const now=this.fenceBinding();if(this.child!==child||!now||now.ownerId!==binding.ownerId||now.term!==binding.term||this.programOutputsHeld)throw new Error('Monitor de outra geração/concessão.')}
      await authorize();assertSame()
      await this.request({cmd:'monitorAdmitted',ownerId:binding.ownerId,term:binding.term,bus,on})
      await authorize();assertSame();this.desiredMonitors.set(bus,on)
    })
  }

  /** Live source open in the QC's own decoder (never the Master's PVW). */
  private qcOpenSource:string|null=null
  qcSource():string|null { return this.qcOpenSource }

  /** Opens/closes the QC decoder. No CUE/LOAD/TAKE; PVW and PGM untouched. */
  openQcSource(source:string|null,authorize:()=>void=()=>{}):Promise<void> {
    return this.enqueue(async()=>{
      authorize()
      if(!this.options.qcPreview)throw new Error('Inspeção ao vivo em qualidade indisponível nesta instalação.')
      if(source===null){
        this.qcOpenSource=null
        await this.request({cmd:'qcSource',item:null})
        return
      }
      const resolved=resolveSource(source)
      if(!resolved)throw new Error('Fonte ao vivo inválida para o QC.')
      if(this.qcOpenSource===resolved)return
      this.qcOpenSource=null
      await this.request({cmd:'qcSource',item:{itemId:`qc:${resolved}`,path:'',source:resolved,trimIn:0,trimOut:0,gainDb:0}})
      this.qcOpenSource=resolved
    })
  }

  /** No CUE/LOAD/TAKE; serialized with them and bound to the QC decoder. */
  qcMonitor(source:string,on:boolean,authorize:()=>void=()=>{}):Promise<void> {
    return this.enqueue(async()=>{
      authorize()
      if(!this.options.qcPreview)throw new Error('Inspeção ao vivo em qualidade indisponível nesta instalação.')
      const resolved=resolveSource(source)
      if(!resolved || this.qcOpenSource!==resolved)throw new Error('A fonte não está aberta no decodificador do QC.')
      await this.request({cmd:'qcMonitor',itemId:`qc:${resolved}`,on})
    })
  }

  /** Promotion cleanup only. Observes exits of ALL generations opened by this
   * transport. Does not kill by caller-supplied PID, retire another backend's
   * owner, or infer death from process.kill()/stdio/timeout. A timeout leaves
   * an explicit false result for the durable promotion ledger. */
  closeConfirmed(timeoutMs=5000):Promise<{ownedNativeProcessesStopped:boolean}>{
    if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)return Promise.reject(new Error('Prazo de encerramento nativo inválido.'))
    if(this.confirmedClose)return this.confirmedClose
    this.confirmedClose=new Promise(resolve=>{
      let finished=false
      const finish=(stopped:boolean)=>{
        if(finished)return;finished=true;clearTimeout(timer)
        this.nativeExitObservers.delete(observe)
        resolve({ownedNativeProcessesStopped:stopped})
      }
      const observe=()=>{if(this.closed&&this.ownedNativeChildren.size===0)finish(true)}
      const timer=setTimeout(()=>finish(false),timeoutMs)
      this.nativeExitObservers.add(observe)
      this.close()
      // Only handles returned by our spawn calls, including previous generations
      // whose termination was never observed. No PID lookup/reconstruction.
      this.forceOwnedChildren('SIGKILL')
      observe()
    })
    return this.confirmedClose
  }

  /** Ordinary local shutdown only. Retain storage/ownership until real exit;
   * a deadline, successful kill or missing stdout is never exit confirmation.
   * Fenced/staged or overlapping generations keep immediate force semantics. */
  closeGracefully(graceMs=12000,exitMs=5000):Promise<NativeShutdownResult>{
    if(!Number.isSafeInteger(graceMs)||graceMs<1||graceMs>30000||!Number.isSafeInteger(exitMs)||exitMs<1||exitMs>30000)return Promise.reject(new Error('Prazo de encerramento normal inválido.'))
    if(this.gracefulClose)return this.gracefulClose
    if(this.options.fenceLease||this.options.holdProgramOutputs||this.ownedNativeChildren.size>1||(this.ownedNativeChildren.size>0&&!this.ownedNativeChildren.has(this.child))){
      return this.gracefulClose=this.closeConfirmed(exitMs).then(proof=>({...proof,graceful:false,forceRequested:this.shutdownForceRequested}))
    }
    const children=this.ownedNativeChildren.size?[...this.ownedNativeChildren]:[this.child]
    this.gracefulClose=new Promise(resolve=>{
      let finished=false
      const finish=(stopped:boolean)=>{
        if(finished)return;finished=true;clearTimeout(deadline);this.nativeExitObservers.delete(observe)
        const graceful=stopped&&!this.shutdownForceRequested&&children.every(child=>{const exit=this.nativeExitOutcomes.get(child);return exit?exit.code===0&&exit.signal===null:child.pid===undefined&&!this.ownedNativeChildren.has(child)})
        resolve({ownedNativeProcessesStopped:stopped,graceful,forceRequested:this.shutdownForceRequested})
      }
      const observe=()=>{if(this.closed&&!this.ownedNativeChildren.size)finish(true)}
      const deadline=setTimeout(()=>finish(false),graceMs+exitMs)
      this.nativeExitObservers.add(observe)
      // Never upgrade an already requested fast/forced close into more time.
      this.beginClose(graceMs,'SIGKILL');observe()
    })
    return this.gracefulClose
  }

  private clearShutdownForceTimer(){if(this.shutdownForceTimer)clearTimeout(this.shutdownForceTimer);this.shutdownForceTimer=null}
  private forceOwnedChildren(signal?:NodeJS.Signals){
    this.clearShutdownForceTimer()
    if(this.ownedNativeChildren.size)this.shutdownForceRequested=true
    for(const child of this.ownedNativeChildren)try{if(signal)child.kill(signal);else child.kill()}catch{}
  }

  close(): void {this.beginClose(1000)}
  private beginClose(graceMs:number,signal?:NodeJS.Signals): void {
    if (this.closed) return
    this.failPriorityTake('Entrada prioritária cancelada ao encerrar o canal.')
    this.closed = true
    this.alive = false
    this.rejectPending('O canal foi encerrado.')
    this.onAirItemId = null
    this.preview = null
    this.previewPosition = null
    this.meter = SILENCE
    this.pgmMeterAt=null;this.pgmVideoProbeAt=null;this.pgmVideoProbe=null
    this.previewReading = SILENCE
    // Shutdown is monotonic cleanup over OUR spawn handle, not publication.
    // A poisoned DB/expired authority must not prevent stopping this child.
    // Never use this path for load/take/grants or a caller-supplied PID.
    let sent=false
    if(this.ownedNativeChildren.has(this.child)&&this.child.stdin&&!this.child.stdin.destroyed&&!this.child.stdin.writableEnded)try{
      this.child.stdin.write(`${JSON.stringify({id:this.nextId++,cmd:'shutdown'})}\n`);sent=true
    }catch{/* A failed pipe cannot prove termination; force and observe exit. */}
    if(this.ownedNativeChildren.size){
      if(!sent)this.forceOwnedChildren('SIGKILL')
      else{this.shutdownForceTimer=setTimeout(()=>this.forceOwnedChildren(signal),graceMs);this.shutdownForceTimer.unref()}
    }
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

/** A source that has been "opening" for several seconds without a single
 * frame is, for the operator, an input without signal (cable, format or the
 * sender itself). State stays CUEING: this only names what the wait means. */
export function openingWithoutSignalMessage(source:string,changedAt:string,now:number,afterMs=5000):string|null{
  const since=Date.parse(changedAt)
  if(!Number.isFinite(since)||now-since<afterMs)return null
  const seconds=Math.floor((now-since)/1000)
  const kind=source.startsWith('sdi:')?'na entrada SDI/HDMI (confira cabo, formato do sinal e o equipamento ligado)':'na fonte (confira se o emissor está ativo e na mesma rede)'
  return `Sem sinal ${kind}: nenhum quadro recebido em ${seconds} s. O PVW abre sozinho quando o sinal chegar.`
}
