import { randomUUID } from 'node:crypto'
import type {
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
  /** Nível de áudio em dBFS (L/R RMS) */
  audioDbfs?: number
  /** Intervalo decorrido em milissegundos desde a última amostra (default: 100ms) */
  deltaMs?: number
  /** Timestamp da medição em ms (default: Date.now()) */
  timestampMs?: number
}

export interface PgmProbeStatusResult {
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

export type AutoActionCallback = (action: PgmProbeAutoAction, alert: PgmProbeAlert) => void

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
  private actionCallback: AutoActionCallback | null = null

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
    const delta = input.deltaMs ?? (this.lastSampleTimeMs ? Math.max(0, now - this.lastSampleTimeMs) : 100)
    this.lastSampleTimeMs = now
    this.lastSampleAt = new Date(now).toISOString()
    if (input.audioDbfs !== undefined) this.lastAudioDbfs = input.audioDbfs

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
            autoActionTriggered: 'SLATE_INJECTED',
            timestamp: new Date(now).toISOString(),
          }
          this.activeBlackAlert = alert
          this.history.push(alert)
          this.emergencySlateActive = true
          this.actionCallback?.('SLATE_INJECTED', alert)
          triggeredAlerts.push(alert)
        } else {
          this.activeBlackAlert.durationMs = this.blackDurationMs
        }
      }
    } else {
      if (this.activeBlackAlert) {
        this.activeBlackAlert.active = false
        this.activeBlackAlert.durationMs = this.blackDurationMs
        this.activeBlackAlert = null
      }
      this.blackDurationMs = 0
    }

    // 2. Verificação de Freeze Frame (> 2.0s)
    if (input.isFreeze) {
      this.freezeDurationMs += delta
      if (this.freezeDurationMs >= this.thresholds.freezeThresholdMs) {
        if (!this.activeFreezeAlert) {
          const alert: PgmProbeAlert = {
            id: randomUUID(),
            type: 'FREEZE_FRAME',
            durationMs: this.freezeDurationMs,
            thresholdMs: this.thresholds.freezeThresholdMs,
            active: true,
            autoActionTriggered: 'CONTINGENCY_LOOP',
            timestamp: new Date(now).toISOString(),
          }
          this.activeFreezeAlert = alert
          this.history.push(alert)
          this.actionCallback?.('CONTINGENCY_LOOP', alert)
          triggeredAlerts.push(alert)
        } else {
          this.activeFreezeAlert.durationMs = this.freezeDurationMs
        }
      }
    } else {
      if (this.activeFreezeAlert) {
        this.activeFreezeAlert.active = false
        this.activeFreezeAlert.durationMs = this.freezeDurationMs
        this.activeFreezeAlert = null
      }
      this.freezeDurationMs = 0
    }

    // 3. Verificação de Silêncio (< -60 dBFS por > 3.0s)
    const isSilence = input.audioDbfs !== undefined && input.audioDbfs <= this.thresholds.silenceDbfs
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
            autoActionTriggered: 'FAILOVER_HOST_B',
            timestamp: new Date(now).toISOString(),
          }
          this.activeSilenceAlert = alert
          this.history.push(alert)
          this.actionCallback?.('FAILOVER_HOST_B', alert)
          triggeredAlerts.push(alert)
        } else {
          this.activeSilenceAlert.durationMs = this.silenceDurationMs
        }
      }
    } else {
      if (this.activeSilenceAlert) {
        this.activeSilenceAlert.active = false
        this.activeSilenceAlert.durationMs = this.silenceDurationMs
        this.activeSilenceAlert = null
      }
      this.silenceDurationMs = 0
    }

    return triggeredAlerts
  }

  /** Dispara manualmente a injeção do Slate institucional de emergência. */
  triggerEmergencySlate(reason = 'MANUAL_DISPATCH'): PgmProbeAlert {
    this.emergencySlateActive = true
    const alert: PgmProbeAlert = {
      id: randomUUID(),
      type: 'BLACK_FRAME',
      durationMs: 0,
      thresholdMs: 0,
      active: true,
      autoActionTriggered: 'SLATE_INJECTED',
      timestamp: new Date().toISOString(),
    }
    this.history.push(alert)
    this.actionCallback?.('SLATE_INJECTED', alert)
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
