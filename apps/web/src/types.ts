import type {
  AudioLevel,
  GraphicOnAir,
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
  /** Faixa de loudness (EBU Tech 3342), em LU. */
  rangeLu: number
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
  /** Grafismo no ar, ou nulo. */
  graphic: GraphicOnAir | null
  /** O que está quebrado agora, uma linha por problema. */
  alerts: { kind: 'OUTPUT' | 'ENGINE'; message: string }[]
  now: Frames
  meters: { program: MeterReading; preview: MeterReading }
}

/** Perfil de uma saída do canal. */
export interface OutputProfile {
  id: string
  name: string
  kind: 'RTMP' | 'SRT' | 'FILE' | 'SDI'
  role: 'PROGRAM' | 'PREVIEW' | 'MONITOR' | 'EXTRA'
  target: string
  /** Destino efetivo: derivado nos gerenciados, guardado nos demais. */
  resolvedTarget: string | null
  width: number | null
  height: number | null
  rateNum: number | null
  rateDen: number | null
  scan: 'PROGRESSIVE' | 'INTERLACED' | null
  bitrateKbps: number | null
  /** Quanto esta saída usaria sem número escrito. Nulo quando não dá para saber. */
  suggestedBitrateKbps: number | null
  enabled: boolean
}

/** Situação da varredura do acervo. */
export interface ScanStatus {
  available: boolean
  running: boolean
  root: string | null
  current: string | null
  seen: number
  total: number
  added: number
  updated: number
  skipped: number
  failed: number
  finishedAt: string | null
  error: string | null
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

/** Onde a interface busca a imagem dos monitores. Nulo = sem servidor de mídia. */
export interface Monitors {
  port: number
  program: string
  preview: string | null
}

export interface Snapshot {
  view: RundownView | null
  live: Live
  history: HistoryState
  monitors: Monitors | null
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

/** Saída de rede do canal, como o engine reporta. */
export interface PublisherStatus {
  url: string
  health: 'connecting' | 'onAir' | 'retrying' | 'idle'
  attempts: number
  delivered: number
  error?: string
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
    /** Nome do formato do canal e o da saída de rede, que pode diferir. */
    format: { channel: string; network: string } | null
    program: string
    clean: string
    preview: string
    urls: Record<string, string> | null
    publishers: PublisherStatus[]
  }[]
  guests: GuestKey[]
  destinations: Destination[]
  relays: RelayStatus[]
  paths: PathStatus[]
}

/** Uma fonte ao vivo que a máquina descobriu, ou que já existe como convidado. */
export interface LiveSource {
  reference: string
  label: string
  family: 'SDI' | 'NDI' | 'GUEST'
}

export interface SourceFamily {
  available: boolean
  /** Por que a família está vazia: sem placa, sem plugin, sem convidado. */
  reason: string | null
  sources: LiveSource[]
}

export interface SourceList {
  sdi: SourceFamily
  ndi: SourceFamily
  guests: SourceFamily
}

/** Uma linha do as-run, como o servidor a devolve. */
export interface AsRunEntry {
  id: string
  title: string
  type: string
  startedAt: string
  endedAt: string | null
  plannedStart: number | null
  actualStart: number
  airedFrames: number | null
  plannedFrames: number | null
  endedBy: string | null
}

/** O que a montagem automática propôs. */
export interface FillPlan {
  window: number
  leftover: number
  reason: 'FILLED' | 'OUT_OF_MATERIAL'
  items: { mediaId: string; title: string; durationFrames: number }[]
}

/** Uma faixa da pauta: o que entra em cada hora do dia. */
export interface ScheduleRule {
  id: string
  channelId: string
  name: string
  /** Dígitos de 0 (domingo) a 6. */
  weekdays: string
  startMinute: number
  endMinute: number
  categories: string[]
  avoidHours: number
}

/** Categoria do acervo com a cor que pinta as linhas dela. */
export interface Categoria {
  id: string
  /** Hex `#rrggbb`. */
  color: string
  /** Quantos arquivos do acervo estão nela. */
  items: number
}

/** Uma lista de reprodução achada na pasta do acervo. */
export interface PlaylistFile {
  path: string
  name: string
  /** Dia a que a lista pertence, lido do nome. Nulo quando o nome não diz. */
  date: string | null
  entries: number
  /** Quantas entradas acharam arquivo no acervo. */
  matched: number
  modifiedAt: string
}

/** Uma entrada da lista, já confrontada com o acervo. */
export interface PlaylistEntryView {
  ref: string
  title: string | null
  seconds: number | null
  mediaId: string | null
  matchedBy: 'path' | 'name' | null
}
