/**
 * Timeline Visual Multicamada (Fase E)
 *
 * Suporte a 4 pistas verticais sincronizadas:
 * 1. Master Video / PGM
 * 2. Secondary Events / CG
 * 3. SCTE-35 / DPI Markers
 * 4. Audio Loudness Envelope (EBU R128)
 */

export type TimelineTrackType =
  | 'MASTER_VIDEO'
  | 'SECONDARY_EVENTS'
  | 'SCTE35_DPI'
  | 'AUDIO_LOUDNESS'

export type TimelineZoomLevel =
  | 'ZOOM_24H'
  | 'ZOOM_1H'
  | 'ZOOM_5M'
  | 'ZOOM_10S'

export type BroadcastItemCategory =
  | 'LIVE'
  | 'NEWS'
  | 'DRAMA'
  | 'COMMERCIAL'
  | 'PROMO'
  | 'FILLER'
  | 'GAP'

export interface TimelineTrackMarker {
  readonly id: string
  readonly trackIndex: 1 | 2 | 3 | 4
  readonly type: 'PRIMARY_VIDEO' | 'CG_EVENT' | 'SCTE35_CUE' | 'AUDIO_ENVELOPE'
  readonly startMs: number
  readonly durationMs: number
  readonly endMs: number
  readonly label: string
  readonly category: BroadcastItemCategory
  readonly colorHex: string
  readonly isGap?: boolean
  readonly metadata?: Record<string, unknown>
}

export interface TimelineAudioPoint {
  readonly timeMs: number
  readonly lufsIntegrated: number
  readonly truePeakDbtp: number
}

export interface TimelineTrack {
  readonly type: TimelineTrackType
  readonly index: 1 | 2 | 3 | 4
  readonly name: string
  readonly items: TimelineTrackMarker[]
  readonly loudnessPoints?: TimelineAudioPoint[]
}

export interface TimelineMultiTrackData {
  readonly rundownId: string
  readonly date: string
  readonly tracks: TimelineTrack[]
  readonly currentPlayheadFrames: number
  readonly currentPlayheadMs?: number
  readonly totalDurationFrames?: number
  readonly totalDurationMs?: number
  readonly gapCount?: number
  readonly zoomLevel?: TimelineZoomLevel
  readonly tenantId?: string
  readonly channelId?: string
  readonly rundownVersion?: number
  readonly eTag?: string
}

export interface TimelineViewportState {
  readonly zoomLevel: TimelineZoomLevel
  readonly pixelsPerMillisecond: number
  readonly viewportStartMs: number
  readonly viewportEndMs: number
  readonly playheadMs: number
  readonly followPlayhead: boolean
}

export const BROADCAST_CATEGORY_COLORS: Record<BroadcastItemCategory, string> = {
  LIVE: '#DC2626',
  NEWS: '#2563EB',
  DRAMA: '#7C3AED',
  COMMERCIAL: '#EA580C',
  PROMO: '#059669',
  FILLER: '#475569',
  GAP: '#EAB308',
}
