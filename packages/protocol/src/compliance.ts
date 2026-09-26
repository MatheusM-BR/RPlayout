/**
 * Tipos e contratos de Continuidade, Compliance e Sonda de PGM.
 * Em conformidade com SPEC-FASE-C-CONTINUIDADE-COMPLIANCE.md,
 * SMPTE-2021 (BXF), EBU R128 e limites regulatórios da ANCINE / Lei 4.117.
 */

export type ContinuityCacheHealth =
  | 'AIR_GAP_READY'
  | 'SYNCHRONIZING'
  | 'DEGRADED'
  | 'QUOTA_WARNING'

export interface ContinuityCacheStatus {
  /** Percentual de cobertura garantida das próximas 48 horas (0.0 a 100.0%) */
  coverage48hPercent: number
  /** Percentual de cobertura da grade estendida de 7 dias (0.0 a 100.0%) */
  coverage7dPercent: number
  /** Quantidade total de arquivos validados e residentes no cache local */
  totalCachedFiles: number
  /** Espaço ocupado no SSD local pelo cache em bytes */
  totalCachedBytes: number
  /** Quota máxima configurada para o cache local em bytes */
  maxQuotaBytes: number
  /** Horas consecutivas de autonomia garantida sem dependência do storage central */
  offlineAutonomyHours: number
  /** Estado de saúde operacional do cache local */
  status: ContinuityCacheHealth
}

export type PgmProbeAlertType = 'BLACK_FRAME' | 'SILENCE' | 'FREEZE_FRAME'

export type PgmProbeAutoAction = 'SLATE_INJECTED' | 'CONTINGENCY_LOOP' | 'FAILOVER_HOST_B'

export interface PgmProbeAlert {
  id: string
  type: PgmProbeAlertType
  durationMs: number
  thresholdMs: number
  active: boolean
  autoActionTriggered?: PgmProbeAutoAction
  timestamp: string
}

export type AsRunExtendedStatus =
  | 'PLAYED_FULL'
  | 'INTERRUPTED'
  | 'DROPPED'
  | 'FAILED'

export interface AsRunRecordExtended {
  id: string
  itemId: string
  title: string
  eventType: string
  scheduledStart: string
  actualStart: string
  durationFrames: number
  deltaFrames: number
  status: AsRunExtendedStatus
  audioLufs: number
  audioTruePeakDb: number
  ancineQuotaEligible: boolean
  commercialContractId?: string
}

export interface AncineComplianceSummary {
  /** Percentual de publicidade comercial acumulado na janela horária avaliada */
  hourlyCommercialPercent: number
  /** Limite máximo regulatório permitido por hora (25.0%) */
  maxAllowedCommercialPercent: 25.0
  /** Minutagem de conteúdo nacional exibido no período */
  nationalContentMinutes: number
  /** Minutagem mínima de cota nacional de referência */
  nationalContentQuotaMin: number
  /** Indica se a programação cumpre estritamente o teto dos 25% de comerciais */
  compliant: boolean
}

/** Configuração e limiares operacionais da Sonda de Qualidade de PGM */
export interface PgmProbeThresholds {
  blackThresholdMs: number
  silenceThresholdMs: number
  freezeThresholdMs: number
  silenceDbfs: number
  defaultAutoAction: PgmProbeAutoAction
}

/** Telemetria do sincronismo de redundância N+1 (Frame-Accurate) */
export interface FrameSyncPacket {
  readonly protocolVersion: number
  readonly senderHostId: string
  readonly role: 'PRIMARY_MASTER' | 'SHADOW_STANDBY'
  readonly sequenceNumber: number
  readonly ptpTimestampMicros: number
  readonly rundownId: string
  readonly rundownHash: string
  readonly currentItemId: string
  readonly currentMediaClip: string
  readonly smpteTimecode: string
  readonly currentFrameOffset: number
  readonly itemTotalFrames: number
  readonly playoutSpeed: number
  readonly nextPreparedItemId: string
  readonly audioMetrics: {
    readonly peakDbfsLeft: number
    readonly peakDbfsRight: number
    readonly loudnessLufs: number
  }
}
