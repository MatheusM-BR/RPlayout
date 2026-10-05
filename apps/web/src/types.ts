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
  readonly editorialRevision?:number
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
  readonly editorialRevision?:number
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
  /** Recovery promise may still be settling after PGM is already visible. */
  reconfiguration?: { ready: boolean; reason: string | null }
  transport: {
    mode?: 'NATIVE' | 'SIMULATED'
    channelId: string
    rundownId: string | null
    onAir: { itemId: string; startedAt: Frames; elapsed: Frames } | null
    preview: PreviewTarget | null
    previewPosition: { frames: Frames; duration: Frames } | null
    preparedItemId: string | null
    preparingItemId: string | null
    playing: boolean
    standby: boolean
    liveSources: Array<{
      source: string
      itemId: string
      state: 'IDLE' | 'CUEING' | 'PVW_READY' | 'TAKE_PENDING' | 'ON_PGM' | 'LOST' | 'FAILED'
      message: string | null
      changedAt: string
      busStates?: Partial<Record<'pgm' | 'pvw', 'IDLE' | 'CUEING' | 'PVW_READY' | 'TAKE_PENDING' | 'ON_PGM' | 'LOST' | 'FAILED'>>
      busItemIds?: Partial<Record<'pgm' | 'pvw', string>>
      measurements?: Partial<Record<'pgm' | 'pvw', {
        width: number | null; height: number | null; rateNum: number | null; rateDen: number | null
        interlaceMode: string | null; audioChannels: number | null; sampleRate: number | null
        videoAgeMs: number | null; audioAgeMs: number | null; videoPresent: boolean; audioPresent: boolean
        receivedFrames: number; arrivalJitterMs: number | null; sampledAt: string
      }>>
    }>
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
  configurationRevision?:number
  id: string
  name: string
  kind: 'RTMP' | 'SRT' | 'FILE' | 'SDI' | 'NDI' | 'OMT'
  role: 'PROGRAM' | 'PREVIEW' | 'MONITOR' | 'EXTRA'
  target: string
  /** Destino efetivo: derivado nos gerenciados, guardado nos demais. */
  resolvedTarget: string | null
  displayUrl?: string | null
  streamUrls?: Record<string, string> | null
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

export interface ConfigurationOperation {state:'IDLE'|'APPLYING'|'UNCERTAIN';runId:string|null;reason:string|null;ownerLocal:boolean|null;reconcilable:boolean;phase:string|null}

export interface TransmissionPreset {
  id: string
  channelId: string
  name: string
  kind: 'SRT' | 'RTMP'
  /** Sempre sanitizado pela API: jamais contém passphrase ou stream key. */
  target: string
  createdAt: string
}

/** Situação da varredura do acervo. */
/** Uma pasta onde o acervo procura arquivo. */
export interface MediaRoot {
  id: string
  path: string
  label: string
  /** A pasta existe agora? Unidade de rede desconectada some sem avisar. */
  present: boolean
}

export interface ServerFolderBrowser {
  path: string
  parent: string | null
  directories: Array<{ name: string; path: string }>
}

export interface ScanStatus {
  available: boolean
  running: boolean
  root: string | null
  /** As pastas do acervo. Ausente nas respostas antigas do servidor. */
  folders?: MediaRoot[]
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
  /** Snapshot returned by the library, never a fresh read to authorize a draft. */
  qcRevision?:number
  fileName: string
  thumbnailUrl: string
}

export interface LibraryFolder {
  /** Identidade estável da pasta: raiz + caminho de dentro dela. */
  key: string
  rootId: string
  /** Nome da raiz a que esta pasta pertence. */
  rootLabel: string
  /** Caminho de dentro da raiz. Vazio é a própria raiz. */
  path: string
  /** O que aparece na tela. */
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
  inspection?: string | null
}

export interface Snapshot {
  view: RundownView | null
  executionView?: RundownView | null
  operationalRevision?: { id: string; revision: number; publishedAt: string } | null
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
  transport: 'SRT' | 'RTMP' | 'OTHER'
  mode: 'CALLER' | 'LISTENER' | 'RENDEZVOUS' | 'UNKNOWN'
  latencyMs: number | null
  rttMs: number | null
  lossPct: number | null
  bitrateKbps: number | null
  primary: boolean
  backupFor: string | null
}

/** Saída de rede do canal, como o engine reporta. */
export interface PublisherStatus {
  url: string
  health: 'connecting' | 'onAir' | 'retrying' | 'failed' | 'idle'
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
  family: 'SDI' | 'NDI' | 'OMT' | 'GUEST'
  discovery?: 'DISCOVERED' | 'CONFIGURED'
}

export interface SourceFamily {
  available: boolean
  /** Por que a família está vazia: sem placa, sem plugin, sem convidado. */
  reason: string | null
  sources: LiveSource[]
}

export interface SourceList {
  sdi: SourceFamily
  sdiOutputs: SourceFamily
  ndi: SourceFamily
  omt: SourceFamily
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
  rateNum?: number | null
  rateDen?: number | null
  executionKind?: 'NATIVE' | 'SIMULATED' | 'UNKNOWN'
  durationEvidence?: 'ENGINE_POSITION' | 'CLOCK_ESTIMATE' | 'UNKNOWN'
  plannedFrames: number | null
  endedBy: string | null
}

/** O que a montagem automática propôs. */
export interface FillPlan {
  window: number
  leftover: number
  reason: 'FILLED' | 'OUT_OF_MATERIAL'
  items: { mediaId: string; title: string; durationFrames: number; explanation?: { category: string | null; lastAiredAt: string | null; preference: number } }[]
}
export interface FillProposal {
  id:string;rundownId:string;channelId:string;editorialRevision:number;expiresAt:string;kind:'WINDOW'|'DAY'
}
export type FillResponse=Partial<Snapshot>&{plan:FillPlan;proposal:FillProposal;bands?:{rule:string;items:number;leftover:number}[]}

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

/** Fase D: Tipos de Camadas Gráficas do CG Dinâmico (RGBA) */
export type GraphicLayerType =
  | 'STATION_LOGO'   // Layer 0: Logotipo / Station Bug
  | 'ONAIR_CLOCK'    // Layer 1: Relógio NTP & Temperatura
  | 'CRAWL_TICKER'   // Layer 2: Rodapé de Notícias Contínuo
  | 'LOWER_THIRD'    // Layer 3: Tarja de Apresentador e Programa
