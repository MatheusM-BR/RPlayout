import type {
  AudioLevel,
  PreviewTarget,
  Channel,
  Frames,
  MediaAsset,
  ResolveResult,
  Rundown,
  RundownItem,
  Trim,
  ValueSource,
} from '@rplayout/protocol'

export interface ItemView {
  item: RundownItem
  asset: MediaAsset | null
  trim: Trim
  trimSource: ValueSource
  audio: AudioLevel
  audioSource: ValueSource
  gainDb: number
  siblingCount: number
}

export interface RundownView {
  rundown: Rundown
  channel: Channel
  items: ItemView[]
  schedule: ResolveResult
}

export interface MeterReading {
  peakDbfs: number[]
  momentaryLufs: number
  shortTermLufs: number
  integratedLufs: number
  truePeakDbtp: number
  gainReductionDb: number
  correlation: number
}

export interface Live {
  transport: {
    channelId: string
    rundownId: string | null
    onAir: { itemId: string; startedAt: Frames; elapsed: Frames } | null
    preview: PreviewTarget | null
    playing: boolean
    standby: boolean
  }
  now: Frames
  meters: { program: MeterReading; preview: MeterReading }
}

/** Arquivo do explorador, com o caminho já quebrado para exibição. */
export interface LibraryAsset extends MediaAsset {
  fileName: string
  thumbnailUrl: string
}

export interface LibraryFolder {
  name: string
  assets: LibraryAsset[]
}

export interface HistoryState {
  canUndo: boolean
  canRedo: boolean
  undoLabel: string | null
  redoLabel: string | null
}

export interface Snapshot {
  view: RundownView | null
  live: Live
  history: HistoryState
}

export interface PathStatus {
  name: string
  ready: boolean
  source: string | null
  readers: number
  bytesReceived: number
}

export interface GuestKey {
  id: string
  channelId: string
  label: string
  streamKey: string
  enabled: boolean
  createdAt: string
  publishUrl: string
}

export interface Destination {
  id: string
  channelId: string
  name: string
  url: string
  enabled: boolean
  createdAt: string
}

export interface RelayStatus {
  id: string
  name: string
  url: string
  state: 'CONECTANDO' | 'NO AR' | 'CAIU' | 'FALHOU'
  attempts: number
  reason: string | null
  delivered: number
  streams: string[]
}

export interface Distribution {
  server: {
    running: boolean
    exposed: boolean
    host: string
    ports: Record<string, number>
  }
  channels: {
    channelId: string
    program: string
    clean: string
    urls: Record<string, string> | null
  }[]
  guests: GuestKey[]
  destinations: Destination[]
  relays: RelayStatus[]
  paths: PathStatus[]
}
