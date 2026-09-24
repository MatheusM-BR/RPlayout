/**
 * Sinalização SCTE-35 (IP) e SCTE-104 (SDI) para Ad Insertion / DPI e Automação de Estúdio.
 *
 * Em conformidade com:
 * - ANSI/SCTE 35 (2020): Digital Program Insertion Cueing Message for Cable
 * - ANSI/SCTE 104 (2019): Automation System to Compression System Communications Interface
 * - SMPTE 2010: Vertical Ancillary Data Mapping of SCTE-104 Messages
 */

export interface Scte35Message {
  readonly spliceEventId: number
  readonly ptsTime: number
  readonly durationSeconds?: number
  readonly autoReturn: boolean
  readonly prerollMs: number
  readonly uniqueProgramId?: number
  readonly segmentationTypeId?: number
  readonly availNum?: number
  readonly availsExpected?: number
  readonly outOfNetwork?: boolean
  readonly commandType?: 'SPLICE_INSERT' | 'TIME_SIGNAL'
}

export type ExternalDeviceTarget =
  | 'ATEM_SWITCHER'
  | 'VIDEOHUB_ROUTER'
  | 'GPIO_RELAY'
  | 'BLACKMAGIC_ATEM'
  | 'LEITCH_ROUTER'

export interface ExternalDeviceCommand {
  readonly targetDevice: 'ATEM_SWITCHER' | 'VIDEOHUB_ROUTER' | 'GPIO_RELAY'
  readonly action: string
  readonly params: Record<string, unknown>
  readonly token?: string
}

export interface Scte104Message {
  readonly eventId: number
  readonly preRollMs: number
  readonly durationSeconds?: number
  readonly resultDid?: number // Default: 0x41
  readonly resultSdid?: number // Default: 0x07
  readonly vancLine?: number // Default: 13
  readonly autoReturn?: boolean
  readonly uniqueProgramId?: number
  readonly rawBytes?: Uint8Array
}

export interface ExternalControlResult {
  readonly success: boolean
  readonly targetDevice: string
  readonly action: string
  readonly latencyMs: number
  readonly pgmTimecode?: string
  readonly status: 'SUCCESS' | 'ERROR_TIMEOUT' | 'FAILED'
  readonly error?: string
  readonly details?: Record<string, unknown>
}

export interface ExternalControlAuditEntry {
  readonly id: string
  readonly timestamp: string
  readonly pgmTimecode: string
  readonly targetDevice: string
  readonly action: string
  readonly latencyMs: number
  readonly executionStatus: 'SUCCESS' | 'ERROR_TIMEOUT' | 'FAILED'
  readonly details?: Record<string, unknown>
  readonly error?: string
}
