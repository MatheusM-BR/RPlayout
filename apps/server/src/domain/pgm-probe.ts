import { randomUUID } from 'node:crypto'
import type {
  IncidentContext,
  PgmProbeAlert,
  PgmProbeAlertType,
  PgmProbeAutoAction,
  PgmProbeThresholds,
} from '@rplayout/protocol'

export interface PgmProbeTelemetryInput {
  /** Se o frame atual está classificado como tela preta (ex: Y < 16) */
  isBlack?: boolean
  /** Se o frame atual está congelado (diferença entre frames consecutivos ~ 0) */
  isFreeze?: boolean
  /** Actual unchanged-picture duration from the native detector, not debounced twice. */
  freezeDurationMs?:number
  /** Nível de áudio em dBFS (L/R RMS) */
  audioDbfs?: number
  /** Intervalo decorrido em milissegundos desde a última amostra (default: 100ms) */
  deltaMs?: number
  /** Timestamp da medição em ms (default: Date.now()) */
  timestampMs?: number
}

export interface PgmProbeStatusResult {
  automaticActionsEnabled: boolean
  alerts: PgmProbeAlert[]
  activeAlerts: PgmProbeAlert[]
  emergencySlateActive: boolean
  lastIncidentAt?: string
  lastSampleAt?: string
  metrics: {
    blackDurationMs: number
    freezeDurationMs: number
    silenceDurationMs: number
    audioDbfs: number | null
  }
  thresholds: PgmProbeThresholds
}

export type AutoActionCallback = (action: PgmProbeAutoAction, alert: PgmProbeAlert) =>
  { ok: boolean; message?: string } | Promise<{ ok: boolean; message?: string }>

export interface ProbeTransition {key:string;alert:PgmProbeAlert;state:'active'|'recovered'|'unobserved';occurredAt:string;context:IncidentContext|null}

export class PgmProbe {
  private thresholds: PgmProbeThresholds = {
    blackThresholdMs: 2000,
    silenceThresholdMs: 3000,
    freezeThresholdMs: 2000,
    silenceDbfs: -60.0,
    defaultAutoAction: 'SLATE_INJECTED',
  }

  private blackDurationMs = 0
  private freezeDurationMs = 0
  private silenceDurationMs = 0
  private lastSampleTimeMs: number | null = null
  private lastSampleAt: string | undefined
  private lastAudioDbfs: number | null = null

  private activeBlackAlert: PgmProbeAlert | null = null
  private activeFreezeAlert: PgmProbeAlert | null = null
  private activeSilenceAlert: PgmProbeAlert | null = null

  private emergencySlateActive = false
  private history: PgmProbeAlert[] = []
  private transitions=new Map<string,ProbeTransition>()
  private contextProvider:(()=>IncidentContext)|null=null
  onContext(provider:()=>IncidentContext):void{this.contextProvider=provider}
  pendingTransitions():ProbeTransition[]{return [...this.transitions.values()].map(row=>({...row,alert:{...row.alert},context:row.context?structuredClone(row.context):null}))}
  confirmTransitions(keys:string[]):void{for(const key of keys)this.transitions.delete(key)}
  private transition(alert:PgmProbeAlert,state:ProbeTransition['state'],now=Date.now()):void{
    const key=alert.id+':'+state
    let context:IncidentContext|null=null;try{context=this.contextProvider?structuredClone(this.contextProvider()):null}catch{/* Missing context must not suppress a real alarm. */}
    this.transitions.set(key,{key,alert:{...alert},state,occurredAt:state==='active'?alert.timestamp:new Date(now).toISOString(),context})
  }
  private actionCallback: AutoActionCallback | null = null
  private automaticActions = false
  private pendingAction: { action: PgmProbeAutoAction; result: Promise<{ ok: boolean; message?: string }> } | null = null

  constructor(
    customThresholds?: Partial<PgmProbeThresholds>,
    onAction?: AutoActionCallback,
  ) {
    if (customThresholds) {
      this.thresholds = { ...this.thresholds, ...customThresholds }
    }
    if (onAction) {
      this.actionCallback = onAction
    }
  }

  onAction(callback: AutoActionCallback): void {
    this.actionCallback = callback
  }
  setAutomaticActions(enabled: boolean): void { this.automaticActions = enabled }
  idle(): void {
    for (const alert of [this.activeBlackAlert, this.activeFreezeAlert, this.activeSilenceAlert]) if (alert) {alert.active = false;this.transition(alert,'unobserved')}
    this.activeBlackAlert = null; this.activeFreezeAlert = null; this.activeSilenceAlert = null
    this.blackDurationMs = 0; this.freezeDurationMs = 0; this.silenceDurationMs = 0
    this.lastSampleTimeMs = null
    this.lastSampleAt = undefined
    this.lastAudioDbfs = null
  }

  private async runAction(action: PgmProbeAutoAction, alert: PgmProbeAlert, manual = false,override?:AutoActionCallback): Promise<void> {
    alert.requestedAction = action
    if (!manual && !this.automaticActions) { alert.actionStatus = 'DISABLED'; alert.actionMessage = 'Intervenção automática desligada; alerta requer decisão do operador.'; return }
    if (!override&&!this.actionCallback) { alert.actionStatus = 'FAILED'; alert.actionMessage = 'Não há runtime conectado para executar a intervenção.'; return }
    alert.actionStatus = 'PENDING'
    try {
      if (this.pendingAction && (override||this.pendingAction.action !== action)) {
        alert.actionStatus = 'FAILED'
        alert.actionMessage = 'Há outra intervenção aguardando confirmação. Confira o PGM antes de solicitar uma ação diferente.'
        return
      }
      if (!this.pendingAction) {
        const callback = override??this.actionCallback!
        // Trava antes de invocar o runtime: as três métricas podem cruzar seus
        // limites no mesmo feed. A confirmação é compartilhada, não três TAKEs.
        const pending = { action, result: Promise.resolve().then(() => callback(action, alert)) }
        this.pendingAction = pending
        void pending.result.then(
          () => { if (this.pendingAction === pending) this.pendingAction = null },
          () => { if (this.pendingAction === pending) this.pendingAction = null },
        )
      }
      const result = await this.pendingAction.result
      alert.actionStatus = result.ok ? 'SUCCEEDED' : 'FAILED'
      alert.actionMessage = result.message
      if (result.ok) {
        alert.autoActionTriggered = action
        if (action === 'SLATE_INJECTED') this.emergencySlateActive = true
      }
    } catch (error) { alert.actionStatus = 'FAILED'; alert.actionMessage = error instanceof Error ? error.message : String(error) }
  }

  setThresholds(custom: Partial<PgmProbeThresholds>): void {
    this.thresholds = { ...this.thresholds, ...custom }
  }

  getThresholds(): PgmProbeThresholds {
    return { ...this.thresholds }
  }

  /**
   * Alimenta a sonda com as métricas acústicas e visuais do PGM.
   * Retorna os alertas ativos após o processamento.
   */
  feedMetrics(input: PgmProbeTelemetryInput): PgmProbeAlert[] {
    const now = input.timestampMs ?? Date.now()
    const proposedDelta = input.deltaMs ?? (this.lastSampleTimeMs !== null ? Math.max(0, now - this.lastSampleTimeMs) : 100)
    const delta = Number.isFinite(proposedDelta) ? Math.max(0, proposedDelta) : 0
    this.lastSampleTimeMs = now
    this.lastSampleAt = new Date(now).toISOString()
    this.lastAudioDbfs = input.audioDbfs !== undefined && Number.isFinite(input.audioDbfs) ? input.audioDbfs : null

    const triggeredAlerts: PgmProbeAlert[] = []

    // 1. Verificação de Black Frame (> 2.0s)
    if (input.isBlack) {
      this.blackDurationMs += delta
      if (this.blackDurationMs >= this.thresholds.blackThresholdMs) {
        if (!this.activeBlackAlert) {
          const alert: PgmProbeAlert = {
            id: randomUUID(),
            type: 'BLACK_FRAME',
            durationMs: this.blackDurationMs,
            thresholdMs: this.thresholds.blackThresholdMs,
            active: true,
            timestamp: new Date(now).toISOString(),
          }
          this.activeBlackAlert = alert
          this.history.push(alert)
          this.transition(alert,'active',now)
          void this.runAction(this.thresholds.defaultAutoAction, alert)
          triggeredAlerts.push(alert)
        } else {
          this.activeBlackAlert.durationMs = this.blackDurationMs
        }
      }
    } else if(input.isBlack===false) {
      if (this.activeBlackAlert) {
        this.activeBlackAlert.active = false
        this.activeBlackAlert.durationMs = this.blackDurationMs
        this.transition(this.activeBlackAlert,'recovered',now)
        this.activeBlackAlert = null
      }
      this.blackDurationMs = 0
    } else this.blackDurationMs=0

    // 2. Verificação de Freeze Frame (> 2.0s)
    const measuredFreeze=typeof input.freezeDurationMs==='number'&&Number.isFinite(input.freezeDurationMs)&&input.freezeDurationMs>=0?input.freezeDurationMs:null
    const freezing=measuredFreeze!==null?measuredFreeze>0:input.isFreeze
    if (freezing) {
      this.freezeDurationMs = measuredFreeze??(this.freezeDurationMs+delta)
      if (this.freezeDurationMs >= this.thresholds.freezeThresholdMs) {
        if (!this.activeFreezeAlert) {
          const alert: PgmProbeAlert = {
            id: randomUUID(),
            type: 'FREEZE_FRAME',
            durationMs: this.freezeDurationMs,
            thresholdMs: this.thresholds.freezeThresholdMs,
            active: true,
            timestamp: new Date(now).toISOString(),
          }
          this.activeFreezeAlert = alert
          this.history.push(alert)
          this.transition(alert,'active',now)
          void this.runAction(this.thresholds.defaultAutoAction, alert)
          triggeredAlerts.push(alert)
        } else {
          this.activeFreezeAlert.durationMs = this.freezeDurationMs
        }
      }
    } else if(freezing===false) {
      if (this.activeFreezeAlert) {
        this.activeFreezeAlert.active = false
        this.activeFreezeAlert.durationMs = this.freezeDurationMs
        this.transition(this.activeFreezeAlert,'recovered',now)
        this.activeFreezeAlert = null
      }
      this.freezeDurationMs = 0
    } else this.freezeDurationMs=0

    // 3. Verificação de Silêncio (< -60 dBFS por > 3.0s)
    const isSilence = this.lastAudioDbfs !== null && this.lastAudioDbfs <= this.thresholds.silenceDbfs
    if (isSilence) {
      this.silenceDurationMs += delta
      if (this.silenceDurationMs >= this.thresholds.silenceThresholdMs) {
        if (!this.activeSilenceAlert) {
          const alert: PgmProbeAlert = {
            id: randomUUID(),
            type: 'SILENCE',
            durationMs: this.silenceDurationMs,
            thresholdMs: this.thresholds.silenceThresholdMs,
            active: true,
            timestamp: new Date(now).toISOString(),
          }
          this.activeSilenceAlert = alert
          this.history.push(alert)
          this.transition(alert,'active',now)
          void this.runAction(this.thresholds.defaultAutoAction, alert)
          triggeredAlerts.push(alert)
        } else {
          this.activeSilenceAlert.durationMs = this.silenceDurationMs
        }
      }
    } else if(this.lastAudioDbfs!==null) {
      if (this.activeSilenceAlert) {
        this.activeSilenceAlert.active = false
        this.activeSilenceAlert.durationMs = this.silenceDurationMs
        this.transition(this.activeSilenceAlert,'recovered',now)
        this.activeSilenceAlert = null
      }
      this.silenceDurationMs = 0
    } else this.silenceDurationMs=0

    return triggeredAlerts
  }

  /** Dispara manualmente a injeção do Slate institucional de emergência. */
  async triggerEmergencySlate(reason = 'MANUAL_DISPATCH',callback?:AutoActionCallback): Promise<PgmProbeAlert> {
    return this.triggerAction('SLATE_INJECTED', reason,callback)
  }

  async triggerAction(action: PgmProbeAutoAction, reason = 'MANUAL_DISPATCH',callback?:AutoActionCallback): Promise<PgmProbeAlert> {
    const alert: PgmProbeAlert = {
      id: randomUUID(),
      type: 'BLACK_FRAME',
      durationMs: 0,
      thresholdMs: 0,
      active: true,
      timestamp: new Date().toISOString(),
    }
    this.history.push(alert)
    alert.actionMessage = reason
    await this.runAction(action, alert, true,callback)
    return alert
  }

  /** Cancela o estado de emergência e remove o Slate do ar. */
  resetEmergencySlate(): void {
    this.emergencySlateActive = false
    if (this.activeBlackAlert) {
      this.activeBlackAlert.active = false
      this.activeBlackAlert = null
    }
    this.blackDurationMs = 0
  }

  /** Retorna a telemetria completa e os alertas ativos. */
  getStatus(): PgmProbeStatusResult {
    const activeAlerts: PgmProbeAlert[] = []
    if (this.activeBlackAlert) activeAlerts.push(this.activeBlackAlert)
    if (this.activeFreezeAlert) activeAlerts.push(this.activeFreezeAlert)
    if (this.activeSilenceAlert) activeAlerts.push(this.activeSilenceAlert)

    const lastAlert = this.history[this.history.length - 1]

    return {
      automaticActionsEnabled: this.automaticActions,
      alerts: [...this.history],
      activeAlerts,
      emergencySlateActive: this.emergencySlateActive,
      lastIncidentAt: lastAlert?.timestamp,
      lastSampleAt: this.lastSampleAt,
      metrics: {
        blackDurationMs: this.blackDurationMs,
        freezeDurationMs: this.freezeDurationMs,
        silenceDurationMs: this.silenceDurationMs,
        audioDbfs: this.lastAudioDbfs,
      },
      thresholds: { ...this.thresholds },
    }
  }

  /** Limpa o histórico mantendo alertas ativos se existirem. */
  clearHistory(): void {
    const actives = this.getStatus().activeAlerts
    this.history = [...actives]
  }
}
