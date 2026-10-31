import { randomUUID } from 'node:crypto'
import {
  WATCHDOG_DETECTIONS, WATCHDOG_DETECTION_LABELS, WATCHDOG_STATE_LABELS, effectiveWatchdogPolicy, signalSampleAge,
  type LiveWatchdogPolicy, type WatchdogConditionView, type WatchdogDetection, type WatchdogDetectionAction,
  type WatchdogInputStatus, type WatchdogMetrics, type WatchdogSample, type WatchdogState, type WatchdogWaitArt,
} from '@rplayout/protocol'

/**
 * Watchdog das entradas ao vivo: detectores (puros) e a máquina de estados
 * OK → SUSPEITA → ESPERA → CONTINGÊNCIA → RETORNO → OK, por entrada.
 *
 * A máquina não executa nada sozinha: devolve efeitos (pôr/tirar a arte de
 * espera, acionar a contingência, sintonizar a entrada no PVW, voltar à live)
 * e só avança quando o executor confirma. Assim um TAKE nunca é presumido.
 */

export interface RawCondition {
  raw: boolean
  /** Duração medida pelo engine (idade do último quadro, conteúdo parado...). */
  measuredMs?: number | null
}
export type Detections = Record<WatchdogDetection, RawCondition>

export interface DetectorContext {
  now: number
  /** Cadência nominal do canal, em quadros por segundo. */
  channelFps: number
  audioExpected: boolean
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
export const LOSS_RAW_MS = 750
export const AUDIO_RAW_MS = 1000
/** Logo depois do TAKE as janelas de medição ainda estão enchendo. */
export const STARTUP_GRACE_MS = 2000

/** Taxa efetiva: quadros novos por segundo quando há conteúdo mudando; quadro
 * repetido pela fonte não conta como quadro. Conteúdo totalmente parado é
 * congelamento (outra detecção), e aí vale a taxa de chegada. */
export function effectiveFps(sample: WatchdogSample | null): number | null {
  if (!sample || !finite(sample.arrivalFps)) return null
  return finite(sample.distinctFps) && sample.distinctFps >= 1 ? Math.min(sample.arrivalFps, sample.distinctFps) : sample.arrivalFps
}

export function referenceFps(sample: WatchdogSample | null, policy: LiveWatchdogPolicy, channelFps: number): number {
  if (policy.fpsReference === 'SOURCE' && sample && finite(sample.rateNum) && finite(sample.rateDen) && sample.rateNum > 0 && sample.rateDen > 0) return sample.rateNum / sample.rateDen
  return channelFps
}

/** Idade real do último quadro: a idade medida no engine mais o atraso da entrega. */
function effectiveAge(age: number | null | undefined, sampleAge: number | null): number | null {
  return finite(age) && sampleAge !== null ? age + sampleAge : null
}

export function detect(sample: WatchdogSample | null, policy: LiveWatchdogPolicy, context: DetectorContext): { detections: Detections; metrics: WatchdogMetrics } {
  const sampleAge = sample ? signalSampleAge(sample.sampledAt, context.now) : null
  const videoAge = effectiveAge(sample?.videoAgeMs, sampleAge)
  // A telemetria chega a cada 500 ms: abaixo de 750 ms a idade é só o intervalo
  // entre amostras, não falta de quadro. A duração real vem da idade medida.
  const loss = videoAge === null || videoAge > LOSS_RAW_MS
  const config = policy.detections
  const ref = referenceFps(sample, policy, context.channelFps)
  const warm = (sample?.receivedFrames ?? 0) >= ref * 2
  const lumaFresh = !!sample && finite(sample.lumaMeanPercent) && finite(sample.lumaStdPercent) && finite(sample.lumaSampleAgeMs) && sample.lumaSampleAgeMs <= 1000
  const black = !loss && lumaFresh && sample!.lumaStdPercent! <= config.BLACK.stdMaxPercent && (sample!.lumaMeanPercent! <= config.BLACK.lumaMaxPercent || config.BLACK.anyFlat)
  // Congelado: impressão bit a bit (existente) ou grade de luma parada (tolera a
  // requantização dos quadros-chave de uma fonte recodificada).
  const exact = sample && finite(sample.sampledContentUnchangedMs) && finite(sample.contentSampleAgeMs) && sample.contentSampleAgeMs <= 1000 ? sample.sampledContentUnchangedMs : null
  const still = lumaFresh && finite(sample!.lumaStaticMs) ? sample!.lumaStaticMs : null
  const unchanged = exact === null && still === null ? null : Math.max(exact ?? 0, still ?? 0)
  // Imagem parada é congelamento, não "taxa baixa": aí só a taxa de chegada conta.
  const fps = unchanged !== null && unchanged >= 1000 ? (finite(sample?.arrivalFps) ? sample!.arrivalFps! : null) : effectiveFps(sample)
  const audioAge = effectiveAge(sample?.audioAgeMs, sampleAge)
  const audioSeen = !!sample && sample.audioAgeMs !== null && sample.audioAgeMs !== undefined
  const stalledMs = finite(sample?.audioStalledMs) ? sample!.audioStalledMs! : 0
  const ratio = finite(sample?.audioSampleRatio) ? sample!.audioSampleRatio! : null
  // Mesmo raciocínio da perda de vídeo: a telemetria tem 500 ms de cadência.
  const audioStall = !loss && audioSeen && (audioAge === null || audioAge > AUDIO_RAW_MS || stalledMs >= 300 || (ratio !== null && ratio < 0.5))
  const detections: Detections = {
    SIGNAL_LOSS: { raw: loss, measuredMs: videoAge },
    LOW_FPS: { raw: !loss && warm && fps !== null && fps < ref * config.LOW_FPS.minPercent / 100 },
    BLACK: { raw: black },
    // Quadro preto parado é "preto", não "congelado": o limiar do preto é o
    // que governa a tolerância a fade-to-black.
    FREEZE: { raw: !loss && !black && unchanged !== null && unchanged >= 1000, measuredMs: unchanged },
    SILENCE: { raw: context.audioExpected && !loss && audioSeen && !audioStall && finite(sample?.audioRmsDbfs) && sample!.audioRmsDbfs! <= config.SILENCE.dbfs },
    AUDIO_STALL: { raw: context.audioExpected && audioStall, measuredMs: audioStall ? Math.max(audioAge ?? 0, stalledMs) : null },
    AUDIO_MISSING: { raw: context.audioExpected && !loss && !!sample && !audioSeen },
    LOW_BITRATE: { raw: !!sample && finite(sample.inputKbps) && sample.inputKbps < config.LOW_BITRATE.minKbps },
  }
  return {
    detections,
    metrics: {
      videoAgeMs: videoAge, effectiveFps: fps, referenceFps: ref,
      lumaPercent: lumaFresh ? sample!.lumaMeanPercent! : null, lumaStdPercent: lumaFresh ? sample!.lumaStdPercent! : null,
      audioDbfs: finite(sample?.audioRmsDbfs) ? sample!.audioRmsDbfs! : null,
      audioStalledMs: audioStall ? Math.max(audioAge ?? 0, stalledMs) : null,
      inputKbps: finite(sample?.inputKbps) ? sample!.inputKbps! : null,
    },
  }
}

export type WatchdogEffect = 'SHOW_WAIT' | 'HIDE_WAIT' | 'ENTER_CONTINGENCY' | 'MONITOR_SOURCE' | 'RETURN_LIVE'
export interface WatchdogEvent {
  at: number
  kind: 'TRANSITION' | 'CONDITION' | 'CONDITION_CLEARED' | 'ACTION' | 'ACTION_FAILED' | 'OPERATOR'
  severity: 'INFO' | 'WARN' | 'CRITICAL'
  message: string
  detection?: WatchdogDetection
  from?: WatchdogState
  to?: WatchdogState
  durationMs?: number
  thresholdMs?: number
}
interface Condition { since: number; lastTrue: number; confirmed: boolean; announced: boolean }

const RETRY_MS = 10_000

export class WatchdogMachine {
  state: WatchdogState = 'OK'
  stateSince: number
  waitSince: number | null = null
  returnSince: number | null = null
  returnFrom: 'ESPERA' | 'CONTINGENCIA' | null = null
  awaitingOperator = false
  holdContingency = false
  waitArtOnAir = false
  contingencyOnAir = false
  monitoring = false
  /** Canal sem PVW: a entrada não pode ser observada durante a contingência;
   * o retorno vira tentativa de TAKE (que só corta com quadro real). */
  blindReturn = false
  contingencySince: number | null = null
  /** Sem PVW, retorno que volta a falhar logo dobra a espera da próxima tentativa (até 60 s). */
  private blindDelayMs: number | null = null
  private lastReturnAt: number | null = null
  /** Contingência acionada sem conteúdo (sem playlist configurada ou recusada). */
  contingencyWithoutContent = false
  pending: WatchdogEffect | null = null
  lastError: string | null = null
  retryAt = 0
  readonly conditions = new Map<WatchdogDetection, Condition>()
  private events: WatchdogEvent[] = []
  private policy: LiveWatchdogPolicy | null = null

  /** Aquecimento: logo depois do TAKE (inicial ou de retorno) as janelas de medição ainda enchem. */
  private graceUntil: number
  constructor(readonly sourceKey: string, now: number, private readonly label = sourceKey) { this.stateSince = now; this.graceUntil = now + STARTUP_GRACE_MS }

  drainEvents(): WatchdogEvent[] { const events = this.events; this.events = []; return events }
  private emit(event: Omit<WatchdogEvent, 'at'>, now: number) { this.events.push({ ...event, at: now }) }
  private go(to: WatchdogState, now: number, reason: string) {
    if (to === this.state) return
    const from = this.state
    this.state = to; this.stateSince = now
    if (to !== 'RETORNO') this.awaitingOperator = false
    this.emit({ kind: 'TRANSITION', severity: to === 'CONTINGENCIA' || to === 'ESPERA' ? 'CRITICAL' : to === 'SUSPEITA' ? 'WARN' : 'INFO', from, to,
      message: `${this.label}: ${WATCHDOG_STATE_LABELS[from]} → ${WATCHDOG_STATE_LABELS[to]} (${reason})` }, now)
  }
  private actionOf(detection: WatchdogDetection): WatchdogDetectionAction {
    const action = this.policy?.detections[detection].action ?? 'OFF'
    // ALERT_ONLY nunca age: as detecções de ação viram alertas.
    return action === 'ACT' && this.policy?.mode !== 'AUTOMATIC' ? 'ALERT' : action
  }
  private describe(names: WatchdogDetection[]) { return names.map(name => WATCHDOG_DETECTION_LABELS[name].toLowerCase()).join(' + ') || 'sem condição' }

  private updateConditions(now: number, detections: Detections, policy: LiveWatchdogPolicy) {
    for (const detection of WATCHDOG_DETECTIONS) {
      const config = policy.detections[detection], raw = detections[detection]
      let condition = this.conditions.get(detection)
      if (config.action === 'OFF') { if (condition) this.clearCondition(detection, condition, now); continue }
      if (raw.raw) {
        const measuredSince = finite(raw.measuredMs) ? now - raw.measuredMs : now
        if (!condition) { condition = { since: measuredSince, lastTrue: now, confirmed: false, announced: false }; this.conditions.set(detection, condition) }
        else { condition.lastTrue = now; condition.since = Math.min(condition.since, measuredSince) }
        const duration = now - condition.since
        if (!condition.confirmed && duration >= config.thresholdMs) {
          condition.confirmed = true
          if (!condition.announced) {
            condition.announced = true
            const acts = this.actionOf(detection) === 'ACT'
            this.emit({ kind: 'CONDITION', severity: acts ? 'CRITICAL' : 'WARN', detection, durationMs: duration, thresholdMs: config.thresholdMs,
              message: `${this.label}: ${WATCHDOG_DETECTION_LABELS[detection]} há ${(duration / 1000).toFixed(1)} s (limite ${(config.thresholdMs / 1000).toFixed(1)} s)${acts ? '' : ' — só alerta'}.` }, now)
          }
        }
      } else if (condition && now - condition.lastTrue >= policy.clearHoldMs) this.clearCondition(detection, condition, now)
    }
  }
  private clearCondition(detection: WatchdogDetection, condition: Condition, now: number) {
    this.conditions.delete(detection)
    if (condition.announced) this.emit({ kind: 'CONDITION_CLEARED', severity: 'INFO', detection, durationMs: condition.lastTrue - condition.since,
      message: `${this.label}: ${WATCHDOG_DETECTION_LABELS[detection]} normalizado (${((condition.lastTrue - condition.since) / 1000).toFixed(1)} s).` }, now)
  }
  /** Zera as condições sem registrar recuperação (troca de barramento observado). */
  private forgetConditions() { this.conditions.clear() }

  conditionViews(now: number): WatchdogConditionView[] {
    return [...this.conditions].map(([detection, condition]) => ({ detection, action: this.actionOf(detection), durationMs: now - condition.since,
      thresholdMs: this.policy?.detections[detection].thresholdMs ?? 0, confirmed: condition.confirmed }))
  }

  step(now: number, detections: Detections, policy: LiveWatchdogPolicy): WatchdogEffect[] {
    this.policy = policy
    if (now < this.graceUntil && !this.contingencyOnAir) return []
    this.updateConditions(now, detections, policy)
    if (this.pending) return []
    const automatic = policy.mode === 'AUTOMATIC'
    const entries = [...this.conditions]
    const failing = entries.filter(([name, condition]) => condition.confirmed && this.actionOf(name) === 'ACT').map(([name]) => name)
    const present = entries.filter(([name]) => this.actionOf(name) === 'ACT').map(([name]) => name)
    const effects: WatchdogEffect[] = []
    switch (this.state) {
      case 'OK':
        if (entries.length) this.go('SUSPEITA', now, this.describe(entries.map(([name]) => name)))
        break
      case 'SUSPEITA':
        if (failing.length && automatic) {
          this.go('ESPERA', now, this.describe(failing)); this.waitSince = now
          if (policy.waitArt.kind !== 'HOLD_LAST_FRAME') effects.push('SHOW_WAIT')
        } else if (!entries.length) this.go('OK', now, 'condições normalizadas')
        break
      case 'ESPERA':
        if (!automatic) { this.leaveIntervention(now, effects, 'modo automático desligado'); break }
        if (failing.length) {
          if (now - (this.waitSince ?? now) >= policy.waitMs) {
            this.go('CONTINGENCIA', now, `${this.describe(failing)} além de ${(policy.waitMs / 1000).toFixed(0)} s`)
            this.enterContingency(now, policy, effects)
          } else if (policy.waitArt.kind !== 'HOLD_LAST_FRAME' && !this.waitArtOnAir && now >= this.retryAt) effects.push('SHOW_WAIT')
        } else if (!present.length) { this.go('RETORNO', now, 'sinal íntegro'); this.returnFrom = 'ESPERA'; this.returnSince = now }
        break
      case 'CONTINGENCIA':
        if (!automatic && !this.contingencyOnAir) { this.leaveIntervention(now, effects, 'modo automático desligado'); break }
        if (this.contingencyWithoutContent && policy.contingencyRevisionId && !this.contingencyOnAir && now >= this.retryAt) { this.enterContingency(now, policy, effects); break }
        if (this.contingencyOnAir && this.blindReturn) {
          // Sem PVW para medir: depois de T2 na reserva, tenta voltar. O TAKE de
          // live só corta com quadro confirmado; recusado, a reserva continua.
          if (now - (this.contingencySince ?? now) >= (this.blindDelayMs ?? policy.returnStableMs) && now >= this.retryAt) {
            this.go('RETORNO', now, 'tentativa de retorno sem PVW para medir'); this.returnFrom = 'CONTINGENCIA'; this.returnSince = now - policy.returnStableMs
          } else break
        } else if (this.contingencyOnAir && !this.monitoring && now >= this.retryAt) { effects.push('MONITOR_SOURCE'); break }
        if (!present.length && (this.monitoring || !this.contingencyOnAir)) { this.go('RETORNO', now, 'sinal da entrada íntegro'); this.returnFrom = 'CONTINGENCIA'; this.returnSince = now }
        break
      case 'RETORNO': {
        const back = this.returnFrom === 'CONTINGENCIA' ? 'CONTINGENCIA' : 'ESPERA'
        if (!(this.blindReturn && this.contingencyOnAir)) {
          if (failing.length) { this.go(back, now, `${this.describe(failing)} voltou`); this.returnSince = null; break }
          if (present.length) { this.returnSince = now; this.awaitingOperator = false; break }
        }
        if (now - (this.returnSince ?? now) < policy.returnStableMs) break
        if (policy.returnMode === 'MANUAL' || this.holdContingency || !automatic) {
          if (!this.awaitingOperator) this.emit({ kind: 'TRANSITION', severity: 'WARN', message: `${this.label}: sinal estável há ${(policy.returnStableMs / 1000).toFixed(0)} s; aguardando o operador voltar para a live.` }, now)
          this.awaitingOperator = true
          break
        }
        if (now < this.retryAt) break
        this.returnEffect(effects)
        break
      }
    }
    return effects
  }
  private returnEffect(effects: WatchdogEffect[]) {
    if (this.contingencyOnAir) effects.push('RETURN_LIVE')
    else if (this.waitArtOnAir) effects.push('HIDE_WAIT')
    else this.finishReturn(this.stateSince)
  }
  private enterContingency(now: number, policy: LiveWatchdogPolicy, effects: WatchdogEffect[]) {
    // Histerese do retorno às cegas: voltou e caiu de novo em menos de 60 s?
    this.blindDelayMs = this.lastReturnAt !== null && now - this.lastReturnAt < 60_000 ? Math.min(60_000, 2 * (this.blindDelayMs ?? policy.returnStableMs)) : null
    if (policy.contingencyRevisionId) { this.contingencyWithoutContent = false; effects.push('ENTER_CONTINGENCY') }
    else {
      this.contingencyWithoutContent = true
      this.emit({ kind: 'ACTION_FAILED', severity: 'CRITICAL', message: `${this.label}: sem playlist de contingência configurada; arte de espera mantida.` }, now)
    }
  }
  private leaveIntervention(now: number, effects: WatchdogEffect[], reason: string) {
    if (this.waitArtOnAir) effects.push('HIDE_WAIT')
    this.go(this.conditions.size ? 'SUSPEITA' : 'OK', now, reason); this.waitSince = null
  }
  private finishReturn(now: number) {
    this.lastReturnAt = now
    this.go('OK', now, 'retorno à live confirmado')
    this.waitSince = null; this.returnSince = null; this.returnFrom = null; this.awaitingOperator = false; this.holdContingency = false
    this.contingencyWithoutContent = false; this.lastError = null; this.retryAt = 0
    this.forgetConditions(); this.graceUntil = now + STARTUP_GRACE_MS
  }

  /** O executor terminou um efeito. Sem confirmação, o estado não avança. */
  complete(effect: WatchdogEffect, ok: boolean, now: number, message?: string) {
    if (this.pending === effect) this.pending = null
    if (!ok) {
      this.lastError = message ?? 'Ação não confirmada.'
      this.retryAt = now + RETRY_MS
      this.emit({ kind: 'ACTION_FAILED', severity: 'CRITICAL', message: `${this.label}: ${effectLabel[effect]} não confirmado — ${this.lastError}` }, now)
      if (effect === 'RETURN_LIVE' && this.state === 'RETORNO') {
        this.go('CONTINGENCIA', now, 'retorno recusado'); this.returnSince = null
        // Sem PVW, a próxima tentativa espera de novo T2 (no mínimo 10 s).
        if (this.blindReturn) { this.contingencySince = now; this.retryAt = now + Math.max(RETRY_MS, this.policy?.returnStableMs ?? 0) }
      }
      if (effect === 'ENTER_CONTINGENCY') this.contingencyWithoutContent = true
      return
    }
    this.lastError = null
    this.emit({ kind: 'ACTION', severity: 'INFO', message: `${this.label}: ${effectLabel[effect]} confirmado.` }, now)
    switch (effect) {
      case 'SHOW_WAIT': this.waitArtOnAir = true; break
      case 'HIDE_WAIT':
        this.waitArtOnAir = false
        if (this.state === 'RETORNO' && !this.contingencyOnAir) this.finishReturn(now)
        break
      case 'ENTER_CONTINGENCY':
        // A arte de espera sai junto; a partir daqui a entrada é observada no PVW.
        this.contingencyOnAir = true; this.waitArtOnAir = false; this.monitoring = false; this.contingencyWithoutContent = false; this.contingencySince = now
        this.forgetConditions()
        break
      case 'MONITOR_SOURCE': this.monitoring = true; break
      case 'RETURN_LIVE': this.contingencyOnAir = false; this.monitoring = false; this.contingencySince = null; this.finishReturn(now); break
    }
  }
  begin(effect: WatchdogEffect) { this.pending = effect }

  /** Retoma uma contingência já no ar (a máquina anterior se perdeu num reinício). */
  adoptContingency(now: number) {
    this.state = 'CONTINGENCIA'; this.stateSince = now; this.contingencyOnAir = true; this.contingencySince = now; this.waitSince = now
    this.emit({ kind: 'TRANSITION', severity: 'WARN', to: 'CONTINGENCIA', message: `${this.label}: contingência no ar encontrada ao iniciar; watchdog retomou o acompanhamento e o retorno.` }, now)
  }

  /** Operador: "voltar para a live agora". */
  operatorReturn(now: number, actor: string | null): WatchdogEffect[] {
    if (this.pending) return []
    this.holdContingency = false
    this.emit({ kind: 'OPERATOR', severity: 'WARN', message: `${this.label}: operador${actor ? ` ${actor}` : ''} pediu "voltar para a live agora" em ${WATCHDOG_STATE_LABELS[this.state]}.` }, now)
    if (this.state !== 'RETORNO') { this.go('RETORNO', now, 'retorno pedido pelo operador'); this.returnFrom = this.contingencyOnAir ? 'CONTINGENCIA' : 'ESPERA' }
    this.returnSince = now
    const effects: WatchdogEffect[] = []
    this.retryAt = 0
    this.returnEffect(effects)
    // Condições recomeçam do zero: a live tem de falhar de novo por inteiro.
    this.forgetConditions()
    return effects
  }
  /** Operador: "manter contingência" (liga/desliga). */
  operatorHold(now: number, hold: boolean, actor: string | null) {
    this.holdContingency = hold
    this.emit({ kind: 'OPERATOR', severity: 'INFO', message: `${this.label}: operador${actor ? ` ${actor}` : ''} ${hold ? 'manteve a contingência (retorno só manual)' : 'liberou o retorno automático'}.` }, now)
  }

  /** Executor externo mudou o PGM (TAKE manual): a intervenção deixa de valer. */
  abandon(now: number, reason: string) {
    this.emit({ kind: 'TRANSITION', severity: 'INFO', from: this.state, to: 'OK', message: `${this.label}: watchdog encerrou o acompanhamento — ${reason}.` }, now)
  }

  status(now: number, base: { sourceId: string | null; name: string; kind: string | null; bus: 'pgm' | 'pvw'; itemId: string | null; metrics: WatchdogMetrics }, policy: LiveWatchdogPolicy): WatchdogInputStatus {
    return {
      sourceKey: this.sourceKey, ...base, state: this.state, stateSince: new Date(this.stateSince).toISOString(), mode: policy.mode,
      waitRemainingMs: this.state === 'ESPERA' && this.waitSince !== null ? Math.max(0, policy.waitMs - (now - this.waitSince)) : null,
      stableMs: this.state === 'RETORNO' && this.returnSince !== null ? now - this.returnSince : null,
      awaitingOperator: this.awaitingOperator, holdContingency: this.holdContingency, waitArtOnAir: this.waitArtOnAir,
      contingencyOnAir: this.contingencyOnAir, blindReturn: this.blindReturn, pendingAction: this.pending, lastError: this.lastError, conditions: this.conditionViews(now),
    }
  }
}

const effectLabel: Record<WatchdogEffect, string> = {
  SHOW_WAIT: 'arte de espera no ar', HIDE_WAIT: 'retirada da arte de espera', ENTER_CONTINGENCY: 'entrada da contingência',
  MONITOR_SOURCE: 'monitoramento da entrada no PVW', RETURN_LIVE: 'retorno à live',
}

/** Uma entrada ao vivo como o transporte a descreve, já resolvida no catálogo. */
export interface WatchdogObservedSource {
  sourceKey: string
  sourceId: string | null
  name: string
  kind: string | null
  itemId: string | null
  sample: WatchdogSample | null
}

export interface WatchdogExecutor {
  showWait(art: WatchdogWaitArt, key: string): Promise<void>
  hideWait(): Promise<void>
  enterContingency(revisionId: string): Promise<void>
  monitorSource(sourceKey: string): Promise<void>
  returnLive(): Promise<void>
  /** A contingência acionada pelo watchdog continua no PGM? */
  contingencyActive(): boolean
  /** O canal tem PVW para observar a entrada durante a contingência? */
  canMonitor?(): boolean
  /** Reserva no ar cuja origem é uma entrada ao vivo (ex.: servidor reiniciado
   * durante a contingência): o watchdog a retoma em vez de abandoná-la. */
  contingencyOrigin?(): WatchdogObservedSource | null
}

export interface WatchdogTickInput {
  now: number
  policy: LiveWatchdogPolicy
  channelFps: number
  /** Entrada ao vivo no PGM, quando há. */
  program: WatchdogObservedSource | null
  /** Entradas no PVW (inclui a monitorada durante a contingência). */
  preview: WatchdogObservedSource[]
}

export interface RecordedWatchdogEvent extends WatchdogEvent { sourceKey: string; sourceId: string | null; sourceName: string; bus: 'pgm' | 'pvw' }

/** Watchdog de um canal: acompanha a live do PGM (age) e as do PVW (só alerta). */
export class ChannelLiveWatchdog {
  private program: { machine: WatchdogMachine; source: WatchdogObservedSource; metrics: WatchdogMetrics; monitorMissingSince?: number | null } | null = null
  private previews = new Map<string, { machine: WatchdogMachine; source: WatchdogObservedSource; metrics: WatchdogMetrics; seenAt: number }>()
  private recorded: RecordedWatchdogEvent[] = []
  readonly history: RecordedWatchdogEvent[] = []

  constructor(private readonly executor: WatchdogExecutor) {}

  drain(): RecordedWatchdogEvent[] { const events = this.recorded; this.recorded = []; return events }
  private collect(machine: WatchdogMachine, source: WatchdogObservedSource, bus: 'pgm' | 'pvw') {
    for (const event of machine.drainEvents()) {
      const row = { ...event, sourceKey: source.sourceKey, sourceId: source.sourceId, sourceName: source.name, bus }
      this.recorded.push(row); this.history.push(row)
    }
    if (this.history.length > 200) this.history.splice(0, this.history.length - 200)
  }

  private run(machine: WatchdogMachine, effects: WatchdogEffect[], policy: LiveWatchdogPolicy, now: () => number) {
    const effect = effects[0]
    if (!effect) return
    machine.begin(effect)
    const work = (): Promise<void> => {
      switch (effect) {
        case 'SHOW_WAIT': return this.executor.showWait(policy.waitArt, `watchdog-${randomUUID()}`)
        case 'HIDE_WAIT': return this.executor.hideWait()
        case 'ENTER_CONTINGENCY': return this.executor.enterContingency(policy.contingencyRevisionId!)
        case 'MONITOR_SOURCE': return this.executor.monitorSource(machine.sourceKey)
        case 'RETURN_LIVE': return this.executor.returnLive()
      }
    }
    void Promise.resolve().then(work).then(() => machine.complete(effect, true, now()), (error: unknown) => machine.complete(effect, false, now(), error instanceof Error ? error.message : String(error)))
  }

  tick(input: WatchdogTickInput, clock: () => number = Date.now): void {
    const { now } = input
    const off = input.policy.mode === 'OFF'
    // PGM: começa a acompanhar quando uma live entra no ar.
    let tracked = this.program
    if (tracked && !tracked.machine.pending) {
      const machine = tracked.machine
      const sameOnAir = input.program?.sourceKey === machine.sourceKey
      if (machine.contingencyOnAir && !this.executor.contingencyActive()) {
        if (sameOnAir) { machine.contingencyOnAir = false; machine.monitoring = false; machine.complete('RETURN_LIVE', true, now) }
        else { machine.abandon(now, 'contingência substituída por comando do operador'); this.collect(machine, tracked.source, 'pgm'); tracked = this.program = null }
      } else if (!machine.contingencyOnAir && !sameOnAir) {
        machine.abandon(now, 'a entrada saiu do PGM')
        if (machine.waitArtOnAir) this.run(machine, ['HIDE_WAIT'], input.policy, clock)
        this.collect(machine, tracked.source, 'pgm'); tracked = this.program = null
      }
    }
    if (!tracked && !input.program && !off && this.executor.contingencyActive()) {
      const origin = this.executor.contingencyOrigin?.() ?? null
      if (origin) {
        const machine = new WatchdogMachine(origin.sourceKey, now, origin.name)
        machine.adoptContingency(now)
        tracked = this.program = { machine, source: origin, metrics: detect(null, input.policy, { now, channelFps: input.channelFps, audioExpected: true }).metrics }
      }
    }
    if (!tracked && input.program && !off) tracked = this.program = { machine: new WatchdogMachine(input.program.sourceKey, now, input.program.name), source: input.program, metrics: detect(null, input.policy, { now, channelFps: input.channelFps, audioExpected: true }).metrics }
    if (tracked) {
      const machine = tracked.machine
      const observed = machine.contingencyOnAir ? input.preview.find(source => source.sourceKey === machine.sourceKey) ?? null : input.program
      if (observed) tracked.source = { ...observed, sample: observed.sample }
      // Um CUE do operador (ou a troca de item da reserva) pode tirar a entrada
      // do PVW: depois de 4 s sem ela, o watchdog volta a sintonizá-la.
      if (machine.contingencyOnAir && machine.monitoring && !machine.pending && !observed) {
        tracked.monitorMissingSince ??= now
        if (now - tracked.monitorMissingSince > 4000) { machine.monitoring = false; tracked.monitorMissingSince = null }
      } else tracked.monitorMissingSince = null
      machine.blindReturn = this.executor.canMonitor?.() === false
      const policy = effectiveWatchdogPolicy(input.policy, tracked.source.sourceId)
      const audioExpected = policy.overrides[tracked.source.sourceId ?? '']?.audioExpected !== false
      const result = detect(machine.contingencyOnAir && !observed ? null : observed?.sample ?? null, policy, { now, channelFps: input.channelFps, audioExpected })
      tracked.metrics = result.metrics
      if (policy.mode === 'OFF' && !machine.waitArtOnAir && !machine.contingencyOnAir) { this.program = null }
      else this.run(machine, machine.step(now, result.detections, policy.mode === 'OFF' ? { ...policy, mode: 'ALERT_ONLY' } : policy), policy, clock)
      this.collect(machine, tracked.source, 'pgm')
    }
    // PVW: só alerta, nunca age.
    const watched = new Set<string>()
    if (input.policy.monitorPreview && !off) for (const source of input.preview) {
      if (this.program?.machine.contingencyOnAir && source.sourceKey === this.program.machine.sourceKey) continue
      if (input.program?.sourceKey === source.sourceKey) continue
      watched.add(source.sourceKey)
      let entry = this.previews.get(source.sourceKey)
      if (!entry) { entry = { machine: new WatchdogMachine(source.sourceKey, now, source.name), source, metrics: detect(null, input.policy, { now, channelFps: input.channelFps, audioExpected: true }).metrics, seenAt: now }; this.previews.set(source.sourceKey, entry) }
      entry.source = source; entry.seenAt = now
      const policy = effectiveWatchdogPolicy(input.policy, source.sourceId)
      const result = detect(source.sample, policy, { now, channelFps: input.channelFps, audioExpected: policy.overrides[source.sourceId ?? '']?.audioExpected !== false })
      entry.metrics = result.metrics
      entry.machine.step(now, result.detections, { ...policy, mode: 'ALERT_ONLY' })
      this.collect(entry.machine, source, 'pvw')
    }
    for (const key of [...this.previews.keys()]) if (!watched.has(key)) this.previews.delete(key)
  }

  operatorReturn(now: number, actor: string | null, policy: LiveWatchdogPolicy, clock: () => number = Date.now): void {
    const tracked = this.program
    if (!tracked) throw new Error('Nenhuma entrada ao vivo acompanhada pelo watchdog neste canal.')
    if (tracked.machine.pending) throw new Error('Há uma ação do watchdog aguardando confirmação do engine.')
    if (tracked.machine.state === 'OK' || tracked.machine.state === 'SUSPEITA') throw new Error('A live já está no ar sem intervenção do watchdog.')
    this.run(tracked.machine, tracked.machine.operatorReturn(now, actor), policy, clock)
    this.collect(tracked.machine, tracked.source, 'pgm')
  }
  operatorHold(now: number, hold: boolean, actor: string | null): void {
    const tracked = this.program
    if (!tracked) throw new Error('Nenhuma entrada ao vivo acompanhada pelo watchdog neste canal.')
    tracked.machine.operatorHold(now, hold, actor)
    this.collect(tracked.machine, tracked.source, 'pgm')
  }

  status(now: number, policy: LiveWatchdogPolicy): WatchdogInputStatus[] {
    const rows: WatchdogInputStatus[] = []
    if (this.program) {
      const { machine, source, metrics } = this.program
      rows.push(machine.status(now, { sourceId: source.sourceId, name: source.name, kind: source.kind, bus: 'pgm', itemId: source.itemId, metrics }, effectiveWatchdogPolicy(policy, source.sourceId)))
    }
    for (const { machine, source, metrics } of this.previews.values()) rows.push({ ...machine.status(now, { sourceId: source.sourceId, name: source.name, kind: source.kind, bus: 'pvw', itemId: source.itemId, metrics }, effectiveWatchdogPolicy(policy, source.sourceId)), mode: 'ALERT_ONLY' })
    return rows
  }
  /** Há intervenção do watchdog no ar (arte de espera ou contingência)? */
  intervening(): boolean { return Boolean(this.program && (this.program.machine.waitArtOnAir || this.program.machine.contingencyOnAir || this.program.machine.pending)) }
}
