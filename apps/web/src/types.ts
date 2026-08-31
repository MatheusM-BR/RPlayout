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
